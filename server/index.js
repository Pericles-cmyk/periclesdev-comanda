import express from 'express';
import http from 'http';
import {Server as SocketServer} from 'socket.io';
import {randomBytes} from 'crypto';
import fs from 'fs';
import {spawn} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import {pool,tx} from './db.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();const server=http.createServer(app);const io=new SocketServer(server,{cors:{origin:true}});
app.use(express.json({limit:'1mb'}));
const PORT=Number(process.env.PORT||3000);
const ALLOWED_TABLES=new Set(['restaurant_tables','orders','order_items','payments','categories','products','product_variants','profiles']);
const COL=/^[a-z_][a-z0-9_]*$/i;
let printAgentSocketId=null;
const backupProjectRoot=path.resolve(__dirname,'..');
const defaultBackupDir=path.join(backupProjectRoot,'backups');

async function ensureLocalInfrastructure(){
  await pool.query(`create table if not exists backup_settings(
    id integer primary key default 1 check(id=1), enabled boolean not null default true,
    frequency text not null default 'daily' check(frequency in('daily','weekly','monthly')),
    weekdays integer[] not null default array[1,2,3,4,5,6,0], monthly_day integer not null default 1,
    backup_time text not null default '03:00', destination_path text not null default '', keep_count integer not null default 14,
    last_backup_at timestamptz, last_status text, last_message text, last_file text, updated_at timestamptz not null default now()
  )`);
  await pool.query(`insert into backup_settings(id,destination_path) values(1,$1) on conflict(id) do nothing`,[defaultBackupDir]);
}
function safeBackupFileName(){const d=new Date();const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d).replace(' ','_').replaceAll(':','-');return `comanda_${fmt}.backup`}
async function runBackup(reason='manual'){
  const cfg=(await pool.query('select * from backup_settings where id=1')).rows[0];
  const destination=String(cfg?.destination_path||defaultBackupDir).trim();
  if(!destination)throw new Error('Selecione uma pasta de destino para o backup.');
  try{fs.mkdirSync(destination,{recursive:true});fs.accessSync(destination,fs.constants.W_OK)}catch{throw new Error(`A pasta de backup não está disponível: ${destination}`)}
  const file=path.join(destination,safeBackupFileName());
  await new Promise((resolve,reject)=>{
    const out=fs.createWriteStream(file,{flags:'wx'});
    const child=spawn('docker',['exec','periclesdev-comanda-db','pg_dump','-U','comanda','-d','comanda_local','-Fc'],{windowsHide:true});
    let stderr='',childDone=false,streamDone=false,failed=false;
    const finish=()=>{if(!failed&&childDone&&streamDone)resolve()};
    const fail=e=>{if(failed)return;failed=true;try{out.destroy()}catch{};reject(e)};
    child.stderr.on('data',d=>stderr+=d.toString()); child.stdout.pipe(out);
    out.on('finish',()=>{streamDone=true;finish()});
    out.on('error',e=>fail(new Error(`Não foi possível gravar o arquivo de backup: ${e.message}`)));
    child.on('error',e=>fail(new Error(`Não foi possível executar o Docker para criar o backup: ${e.message}`)));
    child.on('close',code=>{if(code!==0)return fail(new Error(stderr.trim()||`pg_dump terminou com código ${code}`));childDone=true;finish()});
  });
  const stat=fs.statSync(file);if(stat.size<100)throw new Error('O arquivo de backup foi criado vazio ou inválido.');
  const keep=Math.max(1,Math.min(365,Number(cfg?.keep_count||14)));
  const files=fs.readdirSync(destination).filter(x=>/^comanda_.*\.backup$/i.test(x)).map(name=>({name,full:path.join(destination,name),mtime:fs.statSync(path.join(destination,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  for(const old of files.slice(keep)){try{fs.unlinkSync(old.full)}catch{}}
  await pool.query(`update backup_settings set last_backup_at=now(),last_status='success',last_message=$1,last_file=$2,updated_at=now() where id=1`,[reason==='manual'?'Backup manual concluído.':'Backup automático concluído.',file]);
  return {file,size:stat.size};
}
async function markBackupFailure(error){await pool.query(`update backup_settings set last_backup_at=now(),last_status='error',last_message=$1,updated_at=now() where id=1`,[String(error?.message||error).slice(0,500)]).catch(()=>{})}
async function backupSchedulerTick(){
  try{
    const cfg=(await pool.query('select * from backup_settings where id=1')).rows[0];if(!cfg?.enabled)return;
    const nowParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).reduce((a,x)=>(a[x.type]=x.value,a),{});
    const hhmm=`${nowParts.hour}:${nowParts.minute}`;if(hhmm!==cfg.backup_time)return;
    const day=Number(nowParts.day),dow={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[nowParts.weekday];
    let due=cfg.frequency==='daily'||(cfg.frequency==='weekly'&&(cfg.weekdays||[]).includes(dow))||(cfg.frequency==='monthly'&&day===Number(cfg.monthly_day));if(!due)return;
    if(cfg.last_backup_at){const last=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(cfg.last_backup_at));const today=`${nowParts.year}-${nowParts.month}-${nowParts.day}`;if(last===today)return;}
    try{await runBackup('automatic')}catch(e){await markBackupFailure(e)}
  }catch(e){console.error('Backup scheduler:',e.message)}
}

function emit(table,event,row={}){io.emit('db-change',{table,event,row,at:new Date().toISOString()})}
function cleanUser(row){if(!row)return row;const {password_hash,...u}=row;return u}
async function auth(req,res,next){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)return res.status(401).json({error:'Sessão não encontrada.'});
  const {rows}=await pool.query(`select s.token,p.* from sessions s join profiles p on p.id=s.user_id where s.token=$1 and s.expires_at>now() and p.active=true and p.deleted_at is null`,[token]);
  if(!rows[0])return res.status(401).json({error:'Sessão expirada. Entre novamente.'});
  req.user=cleanUser(rows[0]);req.token=token;next();
}
const admin=(req,res,next)=>req.user?.role==='admin'?next():res.status(403).json({error:'Apenas administradores podem realizar esta operação.'});

app.get('/api/health',async(_req,res)=>{try{await pool.query('select 1');res.json({ok:true,realtime:true})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post('/api/auth/login',async(req,res)=>{
  const login=String(req.body.email||'').split('@')[0].trim().toLowerCase();const password=String(req.body.password||'');
  const {rows}=await pool.query(`select *, password_hash=crypt($2,password_hash) as password_ok from profiles where lower(login_name)=$1 and active=true and deleted_at is null limit 1`,[login,password]);
  const u=rows[0];if(!u?.password_ok)return res.status(401).json({error:'Nome ou senha inválidos.'});
  const token=randomBytes(32).toString('hex');await pool.query(`insert into sessions(token,user_id,expires_at) values($1,$2,now()+interval '7 days')`,[token,u.id]);
  const user={id:u.id,email:`${u.login_name}@comanda.local`};res.json({session:{access_token:token,user}});
});
app.post('/api/auth/logout',auth,async(req,res)=>{await pool.query('delete from sessions where token=$1',[req.token]);res.json({ok:true})});

function buildWhere(filters=[],params=[]){const parts=[];for(const f of filters){if(!COL.test(f.column))throw new Error('Filtro inválido.');if(f.op==='eq'){params.push(f.value);parts.push(`${f.column}=$${params.length}`)}else if(f.op==='is'){if(f.value===null)parts.push(`${f.column} is null`);else {params.push(f.value);parts.push(`${f.column} is not distinct from $${params.length}`)}}else if(f.op==='in'){params.push(f.values||[]);parts.push(`${f.column}=any($${params.length})`)}else throw new Error('Operador inválido.')}return parts.length?' where '+parts.join(' and '):''}
async function relationRows(table,rows,columns){
  if(table==='orders'&&String(columns).includes('restaurant_tables')){for(const r of rows){const q=await pool.query('select number from restaurant_tables where id=$1',[r.table_id]);r.restaurant_tables=q.rows[0]||null}}
  if(table==='products'&&String(columns).includes('categories')){for(const r of rows){const q=await pool.query('select name from categories where id=$1',[r.category_id]);r.categories=q.rows[0]||null}}
  return rows;
}
app.post('/api/query',auth,async(req,res)=>{
  try{
    const {table,action='select',columns='*',filters=[],orders=[],values,single}=req.body;if(!ALLOWED_TABLES.has(table))throw new Error('Tabela não permitida.');
    const params=[];const where=buildWhere(filters,params);
    if(action==='select'){
      let sql=`select * from ${table}${where}`;if(orders.length){const ord=orders.filter(o=>COL.test(o.column)).map(o=>`${o.column} ${o.ascending===false?'desc':'asc'}`);if(ord.length)sql+=' order by '+ord.join(',')}
      let rows=(await pool.query(sql,params)).rows;if(table==='profiles')rows=rows.map(cleanUser);rows=await relationRows(table,rows,columns);return res.json({data:single?(rows[0]||null):rows});
    }
    if(req.user.role!=='admin')return res.status(403).json({error:'Operação administrativa não permitida.'});
    if(action==='insert'){
      const list=Array.isArray(values)?values:[values];const out=[];for(const obj of list){const keys=Object.keys(obj||{}).filter(COL.test);const vals=keys.map(k=>obj[k]);const ps=keys.map((_,i)=>`$${i+1}`);const q=await pool.query(`insert into ${table}(${keys.join(',')}) values(${ps.join(',')}) returning *`,vals);out.push(q.rows[0]);emit(table,'INSERT',q.rows[0]);if(['categories','products','product_variants'].includes(table))emit('menu_updates','UPDATE',{})}return res.json({data:Array.isArray(values)?out:out[0]});
    }
    if(action==='update'){
      const keys=Object.keys(values||{}).filter(COL.test);if(!keys.length)throw new Error('Nenhum campo para atualizar.');
      const vals=keys.map(k=>values[k]);const set=keys.map((k,i)=>`${k}=$${i+1}`);const p2=[...vals];const clauses=[];
      for(const f of filters){if(!COL.test(f.column))throw new Error('Filtro inválido.');if(f.op==='eq'){p2.push(f.value);clauses.push(`${f.column}=$${p2.length}`)}else if(f.op==='is'&&f.value===null)clauses.push(`${f.column} is null`);else if(f.op==='in'){p2.push(f.values||[]);clauses.push(`${f.column}=any($${p2.length})`)}else throw new Error('Filtro de atualização inválido.')}
      if(!clauses.length)throw new Error('Atualização sem filtro não é permitida.');
      const touch=(table==='products'||table==='restaurant_tables'||table==='orders')&&!keys.includes('updated_at')?', updated_at=now()':'';
      const q=await pool.query(`update ${table} set ${set.join(',')}${touch} where ${clauses.join(' and ')} returning *`,p2);const rows=q.rows;
      for(const r of rows)emit(table,'UPDATE',r);if(['categories','products','product_variants'].includes(table))emit('menu_updates','UPDATE',{});return res.json({data:single?(rows[0]||null):rows});
    }
    throw new Error('Ação não suportada.');
  }catch(e){res.status(400).json({error:e.message})}
});

async function totals(c,orderId){const a=await c.query(`select coalesce(sum(quantity*unit_price),0)::numeric as subtotal from order_items where order_id=$1 and status='active'`,[orderId]);const o=(await c.query('select discount_amount,service_amount from orders where id=$1',[orderId])).rows[0];const subtotal=Number(a.rows[0]?.subtotal||0),discount=Number(o?.discount_amount||0),service=Number(o?.service_amount||0);return {subtotal,discount,service,total:Math.max(0,subtotal-discount+service)}}
const rpc={};
rpc.get_public_menu=async()=>{const cats=(await pool.query(`select id,name from categories where active=true order by sort_order,name`)).rows;for(const c of cats){c.products=(await pool.query(`select id,name,description,base_price from products where category_id=$1 and active=true and deleted_at is null order by sort_order,name`,[c.id])).rows;for(const p of c.products)p.variants=(await pool.query(`select id,name,price from product_variants where product_id=$1 and active=true order by sort_order,name`,[p.id])).rows}return {categories:cats,updated_at:new Date().toISOString()}};
rpc.open_table_order=async(a,u)=>tx(async c=>{const t=(await c.query('select * from restaurant_tables where id=$1 and active=true for update',[a.p_table_id])).rows[0];if(!t)throw new Error('Mesa não encontrada.');const ex=(await c.query(`select id from orders where table_id=$1 and status='open' limit 1`,[t.id])).rows[0];if(ex)return ex.id;const q=await c.query(`insert into orders(table_id,status,opened_by) values($1,'open',$2) returning id`,[t.id,u.id]);emit('orders','INSERT',{id:q.rows[0].id,table_id:t.id,status:'open'});return q.rows[0].id});
rpc.add_order_item=async(a,u)=>tx(async c=>{const o=(await c.query(`select * from orders where id=$1 and status='open' for update`,[a.p_order_id])).rows[0];if(!o)throw new Error('Comanda não está aberta.');const p=(await c.query(`select * from products where id=$1 and active=true and deleted_at is null for update`,[a.p_product_id])).rows[0];if(!p)throw new Error('Produto indisponível.');const qty=Math.max(1,Math.min(99,Number(a.p_quantity||1)));let variant=null,price=p.base_price;if(a.p_variant_id){variant=(await c.query(`select * from product_variants where id=$1 and product_id=$2 and active=true`,[a.p_variant_id,p.id])).rows[0];if(!variant)throw new Error('Opção do produto inválida.');price=variant.price}if(price===null)throw new Error('Escolha uma opção de preço.');if(p.stock_enabled){if(Number(p.stock_quantity||0)<qty)throw new Error(`Estoque insuficiente. Disponível: ${Number(p.stock_quantity||0)}`);await c.query('update products set stock_quantity=stock_quantity-$1,updated_at=now() where id=$2',[qty,p.id]);emit('products','UPDATE',{id:p.id,stock_quantity:Number(p.stock_quantity)-qty})}const q=await c.query(`insert into order_items(order_id,product_id,variant_id,product_name_snapshot,variant_name_snapshot,quantity,unit_price,notes,status,added_by) values($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) returning *`,[o.id,p.id,variant?.id||null,p.name,variant?.name||null,qty,price,a.p_notes||null,u.id]);await c.query(`update restaurant_tables set status='occupied',updated_at=now() where id=$1`,[o.table_id]);emit('order_items','INSERT',q.rows[0]);emit('restaurant_tables','UPDATE',{id:o.table_id,status:'occupied'});return q.rows[0].id});
rpc.cancel_order_item=async(a,u)=>tx(async c=>{if(u.role!=='admin')throw new Error('Apenas administrador pode remover itens.');const i=(await c.query(`select * from order_items where id=$1 and status='active' for update`,[a.p_item_id])).rows[0];if(!i)throw new Error('Item não encontrado ou já removido.');await c.query(`update order_items set status='cancelled',cancelled_by=$1,cancelled_at=now(),cancel_reason=$2 where id=$3`,[u.id,a.p_reason||null,i.id]);const p=(await c.query('select stock_enabled from products where id=$1 for update',[i.product_id])).rows[0];if(p?.stock_enabled){await c.query('update products set stock_quantity=coalesce(stock_quantity,0)+$1,updated_at=now() where id=$2',[i.quantity,i.product_id]);emit('products','UPDATE',{id:i.product_id})}const remain=Number((await c.query(`select count(*) from order_items where order_id=$1 and status='active'`,[i.order_id])).rows[0].count);if(!remain){const o=(await c.query('select table_id from orders where id=$1',[i.order_id])).rows[0];await c.query(`update restaurant_tables set status='free',updated_at=now() where id=$1`,[o.table_id]);emit('restaurant_tables','UPDATE',{id:o.table_id,status:'free'})}emit('order_items','UPDATE',{...i,status:'cancelled'});return true});
rpc.set_order_discount=async(a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const amount=Number(a.p_amount||0);if(amount<0)throw new Error('Desconto inválido.');const q=await pool.query(`update orders set discount_amount=$1,updated_at=now() where id=$2 and status='open' returning *`,[amount,a.p_order_id]);if(!q.rows[0])throw new Error('Comanda não encontrada.');emit('orders','UPDATE',q.rows[0]);return true};
rpc.add_order_payment=async(a,u)=>tx(async c=>{if(u.role!=='admin')throw new Error('Apenas administrador.');if(!['cash','pix','debit','credit'].includes(a.p_method))throw new Error('Forma de pagamento inválida.');const amount=Math.round(Number(a.p_amount||0)*100)/100;if(amount<=0)throw new Error('Valor inválido.');const o=(await c.query(`select * from orders where id=$1 and status='open' for update`,[a.p_order_id])).rows[0];if(!o)throw new Error('Comanda não encontrada ou já encerrada.');const t=await totals(c,o.id);const paid=Number((await c.query(`select coalesce(sum(amount),0) total from payments where order_id=$1`,[o.id])).rows[0].total||0);const remaining=Math.max(0,Math.round((t.total-paid)*100)/100);if(amount>remaining+0.001)throw new Error(`O valor excede o saldo restante de R$ ${remaining.toFixed(2).replace('.',',')}.`);const q=await c.query(`insert into payments(order_id,method,amount,recorded_by) values($1,$2,$3,$4) returning *`,[o.id,a.p_method,amount,u.id]);emit('payments','INSERT',q.rows[0]);return q.rows[0].id});
rpc.remove_order_payment=async(a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const q=await pool.query('delete from payments where id=$1 returning *',[a.p_payment_id]);if(q.rows[0])emit('payments','DELETE',q.rows[0]);return true};
rpc.close_order=async(a,u)=>tx(async c=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const o=(await c.query(`select * from orders where id=$1 and status='open' for update`,[a.p_order_id])).rows[0];if(!o)throw new Error('Comanda não encontrada.');const t=await totals(c,o.id);if(t.subtotal<=0)throw new Error('Não há itens na comanda.');const paid=Number((await c.query(`select coalesce(sum(amount),0) total from payments where order_id=$1`,[o.id])).rows[0].total||0);if(paid+0.001<t.total)throw new Error('Registre o pagamento completo antes de encerrar.');const q=await c.query(`update orders set status='closed',closed_by=$1,closed_at=now(),updated_at=now() where id=$2 returning *`,[u.id,o.id]);await c.query(`update restaurant_tables set status='free',updated_at=now() where id=$1`,[o.table_id]);emit('orders','UPDATE',q.rows[0]);emit('restaurant_tables','UPDATE',{id:o.table_id,status:'free'});return {order_number:o.order_number,...t}});
rpc.get_finalized_tables=async(_a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const q=await pool.query(`select o.id order_id,o.order_number,t.number table_number,o.closed_at,p.full_name closed_by_name,o.discount_amount discount,coalesce(x.subtotal,0)-o.discount_amount+o.service_amount total from orders o join restaurant_tables t on t.id=o.table_id left join profiles p on p.id=o.closed_by left join lateral(select sum(quantity*unit_price) subtotal from order_items where order_id=o.id and status='active')x on true where o.status='closed' order by o.closed_at desc`);return q.rows};
rpc.get_movement_days=async(_a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const q=await pool.query(`select (closed_at at time zone 'America/Recife')::date::text movement_date,count(*)::int orders_count,sum(coalesce(x.subtotal,0)) subtotal_total,sum(discount_amount) discount_total,sum(coalesce(x.subtotal,0)-discount_amount+service_amount) net_total from orders o left join lateral(select sum(quantity*unit_price) subtotal from order_items where order_id=o.id and status='active')x on true where status='closed' group by 1 order by 1 desc`);return q.rows};
rpc.get_daily_movement_report=async(a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const orders=(await pool.query(`select o.*,t.number table_number from orders o join restaurant_tables t on t.id=o.table_id where o.status='closed' and (o.closed_at at time zone 'America/Recife')::date=$1::date order by o.closed_at`,[a.p_date])).rows;let subtotal_total=0,discount_total=0,net_total=0;const pm={cash:0,pix:0,credit:0,debit:0};for(const o of orders){const items=(await pool.query(`select quantity,product_name_snapshot name,variant_name_snapshot variant,notes,unit_price,(quantity*unit_price) total from order_items where order_id=$1 and status='active' order by added_at`,[o.id])).rows;const payments=(await pool.query(`select method,amount from payments where order_id=$1 order by created_at`,[o.id])).rows;const subtotal=items.reduce((s,i)=>s+Number(i.total),0),discount=Number(o.discount_amount||0),total=Math.max(0,subtotal-discount+Number(o.service_amount||0));for(const p of payments)pm[p.method]=(pm[p.method]||0)+Number(p.amount||0);Object.assign(o,{order_id:o.id,items,payments,subtotal,discount,total});subtotal_total+=subtotal;discount_total+=discount;net_total+=total}return {date:a.p_date,orders_count:orders.length,subtotal_total,discount_total,net_total,payments_by_method:pm,orders}};
rpc.get_finalized_order_receipt=async(a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const o=(await pool.query(`select o.*,t.number table_number,p.full_name closed_by_name from orders o join restaurant_tables t on t.id=o.table_id left join profiles p on p.id=o.closed_by where o.id=$1 and o.status='closed'`,[a.p_order_id])).rows[0];if(!o)throw new Error('Comanda não encontrada.');const items=(await pool.query(`select * from order_items where order_id=$1 and status='active' order by added_at`,[o.id])).rows;const subtotal=items.reduce((s,i)=>s+Number(i.quantity)*Number(i.unit_price),0),discount=Number(o.discount_amount||0),total=Math.max(0,subtotal-discount+Number(o.service_amount||0));return {table_number:o.table_number,order_number:o.order_number,items,subtotal,discount,total,closed_by_name:o.closed_by_name,closed_at:o.closed_at}};
rpc.create_product_admin=async(a,u)=>tx(async c=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const cat=(await c.query('select name from categories where id=$1',[a.p_category_id])).rows[0];if(!cat)throw new Error('Categoria não encontrada.');const controlled=Boolean(a.p_stock_enabled);const q=await c.query(`insert into products(category_id,name,base_price,active,stock_enabled,stock_quantity,low_stock_threshold,sort_order) values($1,$2,$3,true,$4,$5,$6,coalesce((select max(sort_order)+10 from products where category_id=$1),10)) returning id`,[a.p_category_id,a.p_name,a.p_base_price??null,controlled,controlled?0:null,controlled?5:null]);for(const v of a.p_variants||[])await c.query(`insert into product_variants(product_id,name,price,active,sort_order) values($1,$2,$3,true,$4)`,[q.rows[0].id,v.name,v.price,v.sort_order||10]);emit('products','INSERT',{id:q.rows[0].id});emit('menu_updates','UPDATE',{});return q.rows[0].id});
rpc.set_product_stock=async(a,u)=>{if(u.role!=='admin')throw new Error('Apenas administrador.');const qty=Number(a.p_quantity);if(!Number.isInteger(qty)||qty<0)throw new Error('Quantidade inválida.');const q=await pool.query(`update products set stock_enabled=true,stock_quantity=$1,updated_at=now() where id=$2 returning *`,[qty,a.p_product_id]);if(!q.rows[0])throw new Error('Produto não encontrado.');emit('products','UPDATE',q.rows[0]);return true};
app.post('/api/rpc/:name',async(req,res,next)=>{if(req.params.name==='get_public_menu')return next();return auth(req,res,next)},async(req,res)=>{try{const fn=rpc[req.params.name];if(!fn)throw new Error('RPC local não implementada.');res.json({data:await fn(req.body,req.user)})}catch(e){res.status(400).json({error:e.message})}});


app.get('/api/backup/settings',auth,admin,async(_req,res)=>{try{res.json({data:(await pool.query('select * from backup_settings where id=1')).rows[0]})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/backup/settings',auth,admin,async(req,res)=>{try{const b=req.body||{};const frequency=['daily','weekly','monthly'].includes(b.frequency)?b.frequency:'daily';const weekdays=Array.isArray(b.weekdays)?b.weekdays.map(Number).filter(x=>x>=0&&x<=6):[];const monthlyDay=Math.max(1,Math.min(28,Number(b.monthly_day||1)));const backupTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.backup_time||''))?b.backup_time:'03:00';const destination=String(b.destination_path||'').trim();if(!destination)throw new Error('Selecione a pasta ou dispositivo de destino.');const keep=Math.max(1,Math.min(365,Number(b.keep_count||14)));await pool.query(`update backup_settings set enabled=$1,frequency=$2,weekdays=$3,monthly_day=$4,backup_time=$5,destination_path=$6,keep_count=$7,updated_at=now() where id=1`,[!!b.enabled,frequency,weekdays,monthlyDay,backupTime,destination,keep]);res.json({ok:true,data:(await pool.query('select * from backup_settings where id=1')).rows[0]})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/backup/select-folder',auth,admin,async(_req,res)=>{try{if(process.platform!=='win32')throw new Error('O seletor de pasta está disponível quando o servidor está rodando diretamente no Windows.');const script=`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Selecione a pasta ou dispositivo para os backups da Comanda'; $d.ShowNewFolderButton=$true; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $d.SelectedPath}`;const child=spawn('powershell.exe',['-NoProfile','-STA','-Command',script],{windowsHide:false});let out='',err='';child.stdout.on('data',d=>out+=d.toString());child.stderr.on('data',d=>err+=d.toString());child.on('close',code=>{const selected=out.trim();if(code!==0)return res.status(400).json({error:err.trim()||'Não foi possível abrir o seletor de pasta.'});if(!selected)return res.json({cancelled:true});res.json({path:selected})})}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/backup/run',auth,admin,async(_req,res)=>{try{const data=await runBackup('manual');res.json({ok:true,data})}catch(e){await markBackupFailure(e);res.status(400).json({error:e.message})}});
app.post('/api/backup/test-path',auth,admin,async(req,res)=>{try{const dest=String(req.body?.destination_path||'').trim();if(!dest)throw new Error('Informe uma pasta.');fs.mkdirSync(dest,{recursive:true});fs.accessSync(dest,fs.constants.W_OK);res.json({ok:true})}catch(e){res.status(400).json({error:`Destino indisponível: ${e.message}`})}});

io.on('connection',socket=>{
  socket.on('print-agent-register',async({token}={})=>{try{const q=await pool.query(`select p.role from sessions s join profiles p on p.id=s.user_id where s.token=$1 and s.expires_at>now() and p.active=true`,[token]);if(q.rows[0]?.role!=='admin')return socket.emit('print-agent-status',{ok:false,error:'Apenas administrador pode ativar o servidor de impressão.'});printAgentSocketId=socket.id;socket.emit('print-agent-status',{ok:true,active:true});io.emit('print-server-status',{active:true})}catch(e){socket.emit('print-agent-status',{ok:false,error:e.message})}});
  socket.on('print-agent-unregister',()=>{if(printAgentSocketId===socket.id){printAgentSocketId=null;io.emit('print-server-status',{active:false})}});
  socket.on('disconnect',()=>{if(printAgentSocketId===socket.id){printAgentSocketId=null;io.emit('print-server-status',{active:false})}});
});
app.get('/api/print/status',auth,async(_req,res)=>res.json({active:!!printAgentSocketId}));
app.post('/api/print/job',auth,admin,async(req,res)=>{if(!printAgentSocketId)return res.status(409).json({error:'Servidor de impressão não está ativo no notebook. Abra Painel Admin > Impressora no notebook e ative o servidor de impressão.'});const type=['receipt','report'].includes(req.body?.type)?req.body.type:'receipt';const jobId=randomBytes(8).toString('hex');io.to(printAgentSocketId).emit('print-job',{jobId,type,payload:req.body?.payload||{}});res.json({ok:true,jobId,queued:true,type})});

app.post('/api/admin-users',auth,admin,async(req,res)=>{try{const b=req.body||{};if(b.action==='create'){const full=String(b.full_name||'').trim();const login=full.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'');if(!/^\d{6,12}$/.test(String(b.password)))throw new Error('A senha deve ter entre 6 e 12 números.');const q=await pool.query(`insert into profiles(full_name,login_name,role,active,password_hash,password_updated_at) values($1,$2,$3,true,crypt($4,gen_salt('bf')),now()) returning *`,[full,login,b.role,b.password]);emit('profiles','INSERT',cleanUser(q.rows[0]));return res.json({ok:true})}if(b.action==='reset_password'){if(!/^\d{6,12}$/.test(String(b.password)))throw new Error('Senha inválida.');await pool.query(`update profiles set password_hash=crypt($1,gen_salt('bf')),password_updated_at=now() where id=$2`,[b.password,b.user_id]);await pool.query('delete from sessions where user_id=$1',[b.user_id]);return res.json({ok:true})}if(b.action==='update_profile'){const q=await pool.query(`update profiles set full_name=$1,login_name=$2,role=$3,active=$4 where id=$5 returning *`,[b.full_name,String(b.full_name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,''),b.role,b.active,b.user_id]);emit('profiles','UPDATE',cleanUser(q.rows[0]));return res.json({ok:true})}if(b.action==='delete_user'){if(b.user_id===req.user.id)throw new Error('Você não pode excluir seu próprio usuário.');const target=(await pool.query('select role from profiles where id=$1',[b.user_id])).rows[0];if(target?.role==='admin'){const count=Number((await pool.query(`select count(*) from profiles where role='admin' and active=true and deleted_at is null`)).rows[0].count);if(count<=1)throw new Error('Não é possível excluir o último administrador.')}const q=await pool.query(`update profiles set active=false,deleted_at=now() where id=$1 returning *`,[b.user_id]);await pool.query('delete from sessions where user_id=$1',[b.user_id]);emit('profiles','UPDATE',cleanUser(q.rows[0]));return res.json({ok:true})}throw new Error('Ação inválida.')}catch(e){res.status(400).json({error:e.message})}});

const dist=path.resolve(__dirname,'../dist');app.use(express.static(dist));app.get('/{*splat}',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Não encontrado.'});res.sendFile(path.join(dist,'index.html'))});
ensureLocalInfrastructure().then(()=>{setInterval(backupSchedulerTick,60_000);backupSchedulerTick();server.listen(PORT,'0.0.0.0',()=>console.log(`PericlesDev Comanda Local: http://0.0.0.0:${PORT}`));}).catch(e=>{console.error('Falha ao iniciar infraestrutura local:',e);process.exit(1)});
