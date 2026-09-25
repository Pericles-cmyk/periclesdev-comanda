import clientLogo from './assets/logo-cliente.svg';
import {LOGIN_DOMAIN,VARIANT_CATEGORY_RULES,STOCK_CATEGORY_NAMES} from './client-config';
import periclesDevLogo from './assets/periclesdev-assinatura.png';
import {useEffect,useMemo,useState} from 'react';
import {Routes,Route,Navigate,useNavigate,useParams,useLocation,Link} from 'react-router-dom';
import {supabase,localApi} from './supabase';
import QRCode from 'qrcode';
import {connectBluetoothPrinter,connectPreviousPrinter,getPrinterState,printOrderReceipt,printTestReceipt,printDailyMovementReport,disconnectPrinter} from './printer';

const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const roleLabel={waiter:'Garçom',admin:'Administrador'};

function PericlesSignature(){return <div className="project-footer">
  <div className="project-copyright">© 2026 • Todos os direitos reservados.</div>
  <div className="project-developed"><span>Desenvolvido por</span><img src={periclesDevLogo} alt="PericlesDev — Desenvolvo, Crio, Transformo" /></div>
</div>}

function loginEmailFromName(name){
  const login=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'');
  return `${login}@${LOGIN_DOMAIN}`;
}

function useSession(){
  const[s,setS]=useState(undefined);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setS(data.session));
    const{data}=supabase.auth.onAuthStateChange((_e,n)=>setS(n));
    return()=>data.subscription.unsubscribe();
  },[]);
  return s;
}

function useProfile(){
  const[profile,setProfile]=useState(null);
  useEffect(()=>{supabase.auth.getUser().then(async({data})=>{
    if(!data.user)return;
    const{data:p}=await supabase.from('profiles').select('*').eq('id',data.user.id).single();
    setProfile(p);
  })},[]);
  return profile;
}

function Login(){
  const nav=useNavigate();
  const[nome,setNome]=useState('');
  const[senha,setSenha]=useState('');
  const[err,setErr]=useState('');
  const[busy,setBusy]=useState(false);
  async function go(e){
    e.preventDefault();setErr('');
    if(!/^\d{6,12}$/.test(senha)){setErr('A senha deve ter entre 6 e 12 números.');return}
    setBusy(true);
    const{error}=await supabase.auth.signInWithPassword({email:loginEmailFromName(nome),password:senha});
    setBusy(false);
    if(error)setErr('Nome ou senha inválidos.'); else nav('/mesas');
  }
  return <div className="login"><form onSubmit={go}>
    <div className="login-brand"><img src={clientLogo} alt="Logo do cliente" className="login-logo" /></div><p className="login-subtitle">Acesso ao sistema</p>
    <label>Nome</label><input placeholder="Ex.: Isabela Silva" value={nome} onChange={e=>setNome(e.target.value)} autoComplete="username" required/>
    <label>Senha numérica</label><input placeholder="••••••" type="password" inputMode="numeric" pattern="[0-9]*" value={senha} onChange={e=>setSenha(e.target.value.replace(/\D/g,'').slice(0,12))} required/>
    {err&&<div className="err">{err}</div>}<button disabled={busy}>{busy?'Entrando...':'Entrar'}</button>
  </form><PericlesSignature /></div>;
}

function Shell({children}){
  const profile=useProfile();
  const nav=useNavigate();
  const location=useLocation();
  const[showMenuQr,setShowMenuQr]=useState(false);
  const[qrDataUrl,setQrDataUrl]=useState('');
  const[qrBusy,setQrBusy]=useState(false);
  const menuUrl=(()=>{
    if(typeof window==='undefined')return '/cardapio';
    const protocol=window.location.protocol==='https:'?'https:':'http:';
    const host=window.location.host;
    return `${protocol}//${host}/cardapio`;
  })();

  const adminTab=new URLSearchParams(location.search).get('tab')||'dashboard';
  const navItems=[
    {key:'tables',label:'Mesas',icon:'▦',to:'/mesas'},
    ...(profile?.role==='admin'?[
      {key:'history',label:'Histórico',icon:'◷',to:'/admin?tab=history'},
      {key:'menu',label:'Cardápio',icon:'♨',to:'/admin?tab=menu'},
      {key:'stock',label:'Estoque',icon:'◇',to:'/admin?tab=stock'},
      {key:'users',label:'Usuários',icon:'♙',to:'/admin?tab=users'},
      {key:'printer',label:'Impressora',icon:'▣',to:'/admin?tab=printer'},
      {key:'backup',label:'Backup',icon:'☁',to:'/admin?tab=backup'}
    ]:[])
  ];
  const isActive=item=>item.key==='tables'
    ?location.pathname==='/mesas'||location.pathname.startsWith('/comanda/')
    :location.pathname==='/admin'&&adminTab===item.key;

  async function out(){await supabase.auth.signOut();nav('/login')}
  async function openMenuQr(){
    setShowMenuQr(true);
    if(qrDataUrl)return;
    setQrBusy(true);
    try{
      const absoluteMenuUrl=/^https?:\/\//i.test(menuUrl)?menuUrl:`http://${menuUrl.replace(/^\/+/, '')}`;
      const data=await QRCode.toDataURL(absoluteMenuUrl,{width:360,margin:2,errorCorrectionLevel:'M'});
      setQrDataUrl(data);
    }catch(e){alert(e?.message||'Não foi possível gerar o QR Code.');}
    finally{setQrBusy(false);}
  }

  return <div className="app-shell">
    <aside className="desktop-sidebar">
      <div className="sidebar-brand">
        <img src={clientLogo} alt="Logo do estabelecimento" />
        <div><b>Comanda Web</b><small>Gestão de atendimento</small></div>
      </div>
      <nav className="sidebar-nav">{navItems.map(item=><Link key={item.key} className={isActive(item)?'active':''} to={item.to}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></Link>)}</nav>
      <div className="sidebar-spacer"/>
      <button type="button" className="sidebar-action" onClick={openMenuQr}><span className="nav-icon">⌁</span><span>Cardápio digital</span></button>
      <button type="button" className="sidebar-action logout" onClick={out}><span className="nav-icon">↪</span><span>Sair</span></button>
    </aside>

    <section className="app-stage">
      <header className="app-topbar">
        <div className="mobile-brand"><img src={clientLogo} alt="Logo do estabelecimento"/><span>Comanda Web</span></div>
        <div className="topbar-user">
          <span className="user-avatar">●</span>
          <span><b>{profile?.full_name||'Usuário'}</b><small>{roleLabel[profile?.role]||''}</small></span>
        </div>
        <div className="topbar-status"><span className="online-dot"/>Sistema online</div>
      </header>
      <main className="app-main">{children}</main>
      <PericlesSignature />
    </section>

    <nav className="mobile-bottom-nav">
      <Link className={location.pathname==='/mesas'||location.pathname.startsWith('/comanda/')?'active':''} to="/mesas"><span>▦</span><small>Mesas</small></Link>
      <button type="button" className={location.pathname.startsWith('/comanda/')?'active':''} onClick={()=>location.pathname.startsWith('/comanda/')?null:nav('/mesas')}><span>♨</span><small>Cardápio</small></button>
      {profile?.role==='admin'?<Link className={location.pathname==='/admin'?'active':''} to="/admin"><span>•••</span><small>Mais</small></Link>:<button type="button" onClick={openMenuQr}><span>⌁</span><small>QR</small></button>}
    </nav>

    {showMenuQr&&<div className="modal-backdrop menu-qr-backdrop" onClick={()=>setShowMenuQr(false)}>
      <div className="modal menu-qr-modal" onClick={e=>e.stopPropagation()}>
        <div className="menu-qr-head"><div><h3>Cardápio digital</h3><p>Mostre este QR Code para o cliente.</p></div><button type="button" className="modal-close-x" aria-label="Fechar" onClick={()=>setShowMenuQr(false)}>×</button></div>
        <div className="menu-qr-box">{qrBusy?<div className="qr-loading">Gerando QR Code...</div>:qrDataUrl?<img src={qrDataUrl} alt="QR Code do cardápio digital"/>:<div className="qr-loading">QR Code indisponível.</div>}</div>
        <p className="menu-qr-help">O cliente não precisa fazer login. O cardápio acompanha automaticamente as alterações de produtos, preços e disponibilidade.</p>
        <div className="menu-link-preview">{menuUrl}</div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setShowMenuQr(false)}>Fechar</button><button type="button" className="primary" onClick={()=>window.open(/^https?:\/\//i.test(menuUrl)?menuUrl:`http://${menuUrl.replace(/^\/+/, '')}`,'_blank','noopener,noreferrer')}>Abrir cardápio</button></div>
      </div>
    </div>}
  </div>;
}

function DigitalMenu(){
  const[data,setData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[err,setErr]=useState('');

  async function loadMenu(){
    const{data:menu,error}=await supabase.rpc('get_public_menu');
    if(error){setErr('Não foi possível carregar o cardápio agora.');setLoading(false);return;}
    setData(menu||{categories:[]});setErr('');setLoading(false);
  }

  useEffect(()=>{
    loadMenu();
    const ch=supabase.channel('public-digital-menu')
      .on('postgres_changes',{event:'*',schema:'public',table:'menu_updates'},()=>loadMenu())
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[]);

  const updated=data?.updated_at?new Date(data.updated_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';

  return <div className="digital-menu-page">
    <header className="digital-menu-header">
      <img src={clientLogo} alt="Logo do cliente" />
      <div><h1>Cardápio Digital</h1><p>Escolha o que vai pedir e informe ao garçom.</p></div>
    </header>
    <div className="digital-menu-live"><span className="live-dot"/> Cardápio atualizado automaticamente{updated&&<small> • última atualização {updated}</small>}</div>
    {loading?<div className="digital-menu-empty">Carregando cardápio...</div>:err?<div className="digital-menu-empty">{err}</div>:!(data?.categories||[]).length?<div className="digital-menu-empty">Nenhum produto disponível no momento.</div>:
      <main className="digital-menu-content">{data.categories.map(cat=><section className="digital-category" key={cat.id}>
        <h2>{cat.name}</h2>
        <div className="digital-product-list">{(cat.products||[]).map(p=><article className="digital-product" key={p.id}>
          <div className="digital-product-main"><div><h3>{p.name}</h3>{p.description&&<p>{p.description}</p>}</div>{p.base_price!=null&&<strong>{money(p.base_price)}</strong>}</div>
          {(p.variants||[]).length>0&&<div className="digital-variants">{p.variants.map(v=><div key={v.id}><span>{v.name}</span><b>{money(v.price)}</b></div>)}</div>}
        </article>)}</div>
      </section>)}</main>}
    <footer className="digital-menu-footer"><PericlesSignature /></footer>
  </div>;
}

function Protected({children}){const s=useSession();if(s===undefined)return <div className="center">Carregando...</div>;return s?children:<Navigate to="/login" replace/>}
function AdminOnly({children}){const p=useProfile();if(!p)return <div className="center">Carregando...</div>;return p.role==='admin'?children:<Navigate to="/mesas" replace/>}

function useTablesLive(includeInactive=false){
  const[tables,setTables]=useState([]),[orders,setOrders]=useState([]),[items,setItems]=useState([]),[loading,setLoading]=useState(true);
  async function load(){
    let tq=supabase.from('restaurant_tables').select('*').order('number');
    if(!includeInactive)tq=tq.eq('active',true);
    const[{data:t},{data:o}]=await Promise.all([tq,supabase.from('orders').select('id,table_id,order_number,opened_at,status').eq('status','open')]);
    const open=o||[];
    let its=[];
    if(open.length){
      const{data}=await supabase.from('order_items').select('order_id,quantity,unit_price,status').in('order_id',open.map(x=>x.id)).eq('status','active');
      its=data||[];
    }
    setTables(t||[]);setOrders(open);setItems(its);setLoading(false);
  }
  useEffect(()=>{
    load();
    const ch=supabase.channel(includeInactive?'tables-admin-live':'tables-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'restaurant_tables'},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'orders'},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},load).subscribe();
    return()=>supabase.removeChannel(ch);
  },[includeInactive]);
  const totalFor=orderId=>items.filter(i=>i.order_id===orderId).reduce((s,i)=>s+Number(i.unit_price)*i.quantity,0);
  return{tables,orders,items,loading,totalFor,reload:load};
}

function Mesas(){
  const{tables,orders,items,loading,totalFor}=useTablesLive(false);
  const nav=useNavigate();
  const[filter,setFilter]=useState('all');
  async function open(tableId){
    const ex=orders.find(x=>x.table_id===tableId);if(ex)return nav('/comanda/'+ex.id);
    const{data,error}=await supabase.rpc('open_table_order',{p_table_id:tableId});if(error)alert(error.message);else nav('/comanda/'+data);
  }
  const rows=tables.map(t=>{
    const existing=orders.find(x=>x.table_id===t.id);
    const order=existing&&items.some(i=>i.order_id===existing.id)?existing:null;
    return{table:t,order,total:order?totalFor(order.id):0};
  });
  const freeCount=rows.filter(x=>!x.order).length;
  const busyCount=rows.filter(x=>x.order).length;
  const openTotal=rows.reduce((sum,x)=>sum+x.total,0);
  const visible=rows.filter(x=>filter==='all'||(filter==='free'&&!x.order)||(filter==='busy'&&x.order));

  return <Shell>
    <section className="tables-page">
      <div className="tables-heading">
        <div><h1>Mesas</h1><p>Visão geral do atendimento</p></div>
        <div className="tables-live-label"><span className="online-dot"/> atualização em tempo real</div>
      </div>

      <div className="table-stats">
        <article><span className="stat-icon free">▦</span><div><strong>{freeCount}</strong><span>Mesas livres</span><small>{tables.length?Math.round(freeCount/tables.length*100):0}% disponíveis</small></div></article>
        <article><span className="stat-icon busy">▦</span><div><strong>{busyCount}</strong><span>Mesas em uso</span><small>{tables.length?Math.round(busyCount/tables.length*100):0}% ocupadas</small></div></article>
        <article><span className="stat-icon money">●</span><div><strong>{money(openTotal)}</strong><span>Total em comandas abertas</span><small>Em {busyCount} mesa(s)</small></div></article>
      </div>

      <div className="mobile-table-filter">
        <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Todas ({tables.length})</button>
        <button className={filter==='free'?'active free':''} onClick={()=>setFilter('free')}><span className="filter-dot free"/>Livres ({freeCount})</button>
        <button className={filter==='busy'?'active busy':''} onClick={()=>setFilter('busy')}><span className="filter-dot busy"/>Em uso ({busyCount})</button>
      </div>

      {loading?<div className="empty">Carregando mesas...</div>:<div className="table-card-grid">{visible.map(({table:t,order:o,total})=>
        <button className={'table-card '+(o?'busy':'free')} key={t.id} onClick={()=>open(t.id)}>
          <div className="table-card-top"><b>Mesa {String(t.number).padStart(2,'0')}</b>{o&&<span className="people-indicator">●</span>}</div>
          <div className="table-illustration"><span className="chair c1"/><span className="chair c2"/><span className="chair c3"/><span className="chair c4"/><span className="round-table">{o?'•••':'✦'}</span></div>
          {o?<div className="table-order-info"><small>Comanda #{o.order_number}</small><strong>{money(total)}</strong><span className="busy-pill">Em uso</span></div>:<span className="free-pill">Livre</span>}
        </button>)}</div>}
    </section>
  </Shell>;
}

function Comanda(){
  const{id}=useParams(),nav=useNavigate();const profile=useProfile();const[mobileOrderOpen,setMobileOrderOpen]=useState(false);
  const[order,setOrder]=useState(null),[items,setItems]=useState([]),[payments,setPayments]=useState([]),[cats,setCats]=useState([]),[prods,setProds]=useState([]),[vars,setVars]=useState([]),[cat,setCat]=useState(null),[busy,setBusy]=useState(false),[adding,setAdding]=useState(null),[qty,setQty]=useState(1),[notes,setNotes]=useState(''),[variantId,setVariantId]=useState(''),[showCloseSummary,setShowCloseSummary]=useState(false),[paymentAmount,setPaymentAmount]=useState('');
  const[cancelItem,setCancelItem]=useState(null),[cancelReason,setCancelReason]=useState('');
  const[showDiscount,setShowDiscount]=useState(false),[discountInput,setDiscountInput]=useState('');
  const[showPayment,setShowPayment]=useState(false),[selectedPaymentMethod,setSelectedPaymentMethod]=useState('');
  const paymentLabels={cash:'Dinheiro',pix:'Pix',debit:'Débito',credit:'Crédito'};

  useEffect(()=>{
    if(!showPayment)return;
    const previousOverflow=document.body.style.overflow;
    const previousPosition=document.body.style.position;
    const previousWidth=document.body.style.width;
    const scrollY=window.scrollY;
    document.body.style.overflow='hidden';
    document.body.style.position='fixed';
    document.body.style.width='100%';
    document.body.style.top=`-${scrollY}px`;
    return()=>{
      document.body.style.overflow=previousOverflow;
      document.body.style.position=previousPosition;
      document.body.style.width=previousWidth;
      document.body.style.top='';
      window.scrollTo(0,scrollY);
    };
  },[showPayment]);

  async function load(){
    const[{data:o},{data:i},{data:pay},{data:c},{data:p},{data:v}]=await Promise.all([
      supabase.from('orders').select('*,restaurant_tables(number)').eq('id',id).single(),
      supabase.from('order_items').select('*').eq('order_id',id).order('added_at'),
      supabase.from('payments').select('*').eq('order_id',id).order('created_at'),
      supabase.from('categories').select('*').eq('active',true).order('sort_order'),
      supabase.from('products').select('*').eq('active',true).is('deleted_at',null).order('sort_order'),
      supabase.from('product_variants').select('*').eq('active',true).order('sort_order')]);
    setOrder(o);setItems(i||[]);setPayments(pay||[]);setCats(c||[]);setProds(p||[]);setVars(v||[]);if(!cat&&c?.[0])setCat(c[0].id);
  }

  useEffect(()=>{
    load();const ch=supabase.channel('comanda-'+id)
      .on('postgres_changes',{event:'*',schema:'public',table:'order_items',filter:`order_id=eq.${id}`},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'orders',filter:`id=eq.${id}`},load)
      .on('postgres_changes',{event:'*',schema:'public',table:'payments',filter:`order_id=eq.${id}`},load)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'products'},load).subscribe();
    return()=>supabase.removeChannel(ch);
  },[id]);

  function beginAdd(p){if(p.stock_enabled&&Number(p.stock_quantity||0)<=0)return alert('Produto sem estoque.');const pv=vars.filter(v=>v.product_id===p.id);setAdding(p);setQty(1);setNotes('');setVariantId(pv[0]?.id||'');}
  async function confirmAdd(e){e.preventDefault();if(!adding)return;const pv=vars.filter(v=>v.product_id===adding.id);if(pv.length&&!variantId)return alert('Escolha a opção do produto.');const quantity=Math.max(1,Math.min(99,Number(qty)||1));if(adding.stock_enabled&&quantity>Number(adding.stock_quantity||0))return alert(`Estoque insuficiente. Disponível: ${Number(adding.stock_quantity||0)}`);setBusy(true);const{error}=await supabase.rpc('add_order_item',{p_order_id:id,p_product_id:adding.id,p_variant_id:variantId||null,p_quantity:quantity,p_notes:notes.trim()||null});setBusy(false);if(error)return alert(error.message);setAdding(null);setQty(1);setNotes('');setVariantId('');}

  async function confirmCancelItem(e){
    e.preventDefault();if(!cancelItem||profile?.role!=='admin')return;
    setBusy(true);
    const{error}=await supabase.rpc('cancel_order_item',{p_item_id:cancelItem.id,p_reason:cancelReason.trim()||null});
    setBusy(false);
    if(error)return alert(error.message);
    setCancelItem(null);setCancelReason('');await load();
  }

  async function saveDiscount(e){
    e.preventDefault();if(profile?.role!=='admin')return;
    const amount=Number(String(discountInput||'0').replace(',','.'));
    if(Number.isNaN(amount)||amount<0)return alert('Informe um desconto válido.');
    setBusy(true);
    const{error}=await supabase.rpc('set_order_discount',{p_order_id:id,p_amount:amount});
    setBusy(false);
    if(error)return alert(error.message);
    setShowDiscount(false);setDiscountInput('');await load();
  }

  function startCloseFlow(){
    if(profile?.role!=='admin'||!active.length)return;
    if(remaining<=0){
      setShowCloseSummary(true);
      return;
    }
    setSelectedPaymentMethod('');
    setPaymentAmount(remaining.toFixed(2).replace('.',','));
    setShowPayment(true);
  }

  async function confirmClosePayment(){
    if(profile?.role!=='admin'||remaining<=0||!selectedPaymentMethod)return;
    const amount=Math.round(Number(String(paymentAmount||'').replace(',','.'))*100)/100;
    if(!amount||amount<=0)return alert('Informe o valor desta forma de pagamento.');
    if(amount>remaining+0.001)return alert(`O valor não pode ultrapassar ${money(remaining)}.`);
    setBusy(true);
    const{error}=await supabase.rpc('add_order_payment',{p_order_id:id,p_method:selectedPaymentMethod,p_amount:amount});
    if(error){setBusy(false);return alert(error.message);}
    await load();
    setBusy(false);
    const newRemaining=Math.max(0,Math.round((remaining-amount)*100)/100);
    if(newRemaining<=0.001){setShowPayment(false);setShowCloseSummary(true);}
    else{setSelectedPaymentMethod('');setPaymentAmount(newRemaining.toFixed(2).replace('.',','));}
  }

  async function removePayment(p){
    if(profile?.role!=='admin')return;
    if(!confirm(`Remover o pagamento de ${money(p.amount)} (${paymentLabels[p.method]||p.method})?`))return;
    setBusy(true);const{error}=await supabase.rpc('remove_order_payment',{p_payment_id:p.id});setBusy(false);
    if(error)return alert(error.message);await load();
  }

  const active=items.filter(i=>i.status==='active');
  const subtotal=active.reduce((sum,i)=>sum+Number(i.unit_price)*Number(i.quantity),0);
  const discount=Number(order?.discount_amount||0);
  const service=Number(order?.service_amount||0);
  const total=Math.max(subtotal-discount+service,0);
  const paid=payments.reduce((sum,p)=>sum+Number(p.amount||0),0);
  const remaining=Math.max(total-paid,0);

  async function finalizeOrder({print=false}={}){
    if(!active.length)return alert('Não há itens na comanda para encerrar.');
    if(print){
      try{const status=await localApi.print.status();if(!status.active)return alert('O servidor de impressão não está ativo no notebook. No notebook, abra Painel Admin > Impressora, conecte a RP80-PLUS e ative “Servidor de impressão”.');}
      catch(e){return alert(e.message)}
    }
    setBusy(true);
    const{data,error}=await supabase.rpc('close_order',{p_order_id:id});
    setBusy(false);
    if(error)return alert(error.message);
    if(print){
      try{
        await localApi.print.queue({tableNumber:order?.restaurant_tables?.number,orderNumber:data.order_number,items:active,subtotal:data.subtotal,discount:data.discount,total:data.total,closedBy:profile?.full_name||'Administrador'});
        alert(`Comanda #${data.order_number} encerrada. Pedido de impressão enviado ao notebook.\nTotal: ${money(data.total)}`);
      }catch(printError){alert(`Comanda #${data.order_number} foi encerrada, mas o pedido de impressão não chegou ao notebook.\nTotal: ${money(data.total)}\n\n${printError.message}`);}
    }else alert(`Comanda #${data.order_number} encerrada sem impressão.\nTotal: ${money(data.total)}`);
    setShowCloseSummary(false);nav('/mesas');
  }

  return <Shell><button className="back" onClick={()=>nav('/mesas')}>← Voltar para mesas</button>
    <div className="title"><div><h2>Mesa {order?.restaurant_tables?.number||'...'}</h2><span>Comanda #{order?.order_number||'...'}</span></div><div className="live-total"><small>Total da comanda</small><b>{money(total)}</b></div></div>
    <div className="cats">{cats.map(c=><button className={cat===c.id?'sel':''} onClick={()=>setCat(c.id)} key={c.id}>{c.name}</button>)}</div>
    <div className="layout"><section><h3>Cardápio</h3><div className="products">{prods.filter(p=>p.category_id===cat).map(p=><button key={p.id} className={p.stock_enabled&&Number(p.stock_quantity||0)<=0?'stock-out-product':''} onClick={()=>beginAdd(p)} disabled={p.stock_enabled&&Number(p.stock_quantity||0)<=0}><b>{p.name}</b><span>{p.base_price!=null?money(p.base_price):'Escolher opção'}</span>{p.stock_enabled?<small className={Number(p.stock_quantity||0)<=0?'stock-zero':'stock-current'}>{Number(p.stock_quantity||0)<=0?'SEM ESTOQUE':`Estoque atual: ${Number(p.stock_quantity||0)}`}</small>:<small>+ adicionar</small>}</button>)}</div></section>
      <aside className={'order-aside '+(mobileOrderOpen?'mobile-open':'')}><div className="order-aside-head"><div><h3>Itens da comanda</h3><small>Mesa {order?.restaurant_tables?.number} • Comanda #{order?.order_number}</small></div><button type="button" className="order-sheet-close" onClick={()=>setMobileOrderOpen(false)} aria-label="Fechar comanda">×</button></div>{!active.length&&<p className="muted">Nenhum item lançado.</p>}{active.map(i=><div className="item item-admin-row" key={i.id}><span><b>{i.quantity}× {i.product_name_snapshot}</b><small>{i.variant_name_snapshot||''}</small>{i.notes&&<em>Obs.: {i.notes}</em>}</span><div className="item-price-actions"><b>{money(i.quantity*Number(i.unit_price))}</b>{profile?.role==='admin'&&<button type="button" className="item-remove-btn" onClick={()=>{setCancelItem(i);setCancelReason('')}}>Remover item</button>}</div></div>)}
      <div className="order-totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div>{discount>0&&<div><span>Desconto</span><b>− {money(discount)}</b></div>}<div className="sum"><span>Total</span><b>{money(total)}</b></div></div>
      {profile?.role==='admin'&&<div className="admin-order-actions"><h4>Ações do administrador</h4><div className="admin-action-buttons"><button type="button" className="secondary" onClick={()=>{setDiscountInput(discount?String(discount).replace('.',','):'');setShowDiscount(true)}}>Aplicar desconto</button></div>
      {payments.length>0&&<div className="payments-box"><b>Pagamentos</b>{payments.map(p=><div className="payment-row" key={p.id}><span>{paymentLabels[p.method]||p.method} • {money(p.amount)}</span><button type="button" onClick={()=>removePayment(p)}>Remover</button></div>)}<div className="payment-summary"><span>Pago</span><b>{money(paid)}</b></div><div className="payment-summary"><span>{remaining>0?'Falta':'Saldo'}</span><b>{money(remaining)}</b></div></div>}
      <button className="danger full" onClick={startCloseFlow} disabled={busy||!active.length}>{busy?'Processando...':'Encerrar pedido'}</button></div>}</aside></div>
    <button type="button" className="mobile-order-trigger" onClick={()=>setMobileOrderOpen(true)}>
      <span><b>▤ {active.reduce((s,i)=>s+Number(i.quantity||0),0)} itens</b><small>Ver comanda</small></span><strong>{money(total)}</strong>
    </button>

    {adding&&<div className="modal-backdrop" onClick={()=>setAdding(null)}><form className="modal product-modal" onClick={e=>e.stopPropagation()} onSubmit={confirmAdd}><h3>Adicionar {adding.name}</h3>{vars.filter(v=>v.product_id===adding.id).length>0&&<><label>Opção</label><select value={variantId} onChange={e=>setVariantId(e.target.value)}>{vars.filter(v=>v.product_id===adding.id).map(v=><option key={v.id} value={v.id}>{v.name} — {money(v.price)}</option>)}</select></>}<label>Quantidade</label><div className="qty-control"><button type="button" onClick={()=>setQty(q=>Math.max(1,Number(q)-1))}>−</button><input type="number" min="1" max="99" value={qty} onChange={e=>setQty(Math.max(1,Math.min(99,Number(e.target.value)||1)))}/><button type="button" onClick={()=>setQty(q=>Math.min(99,Number(q)+1))}>+</button></div><label>Observação do item (opcional)</label><textarea rows="3" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ex.: sem cebola, bem passado..."/><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setAdding(null)}>Cancelar</button><button className="primary" disabled={busy}>Adicionar {qty} item(ns)</button></div></form></div>}

    {cancelItem&&profile?.role==='admin'&&<div className="modal-backdrop" onClick={()=>!busy&&setCancelItem(null)}><form className="modal admin-small-modal" onClick={e=>e.stopPropagation()} onSubmit={confirmCancelItem}><h3>Remover item</h3><p><b>{cancelItem.quantity}× {cancelItem.product_name_snapshot}</b>{cancelItem.variant_name_snapshot?` • ${cancelItem.variant_name_snapshot}`:''}</p><label>Motivo (opcional)</label><textarea rows="3" value={cancelReason} onChange={e=>setCancelReason(e.target.value)} placeholder="Ex.: cliente desistiu do item"/><p className="muted">O item sairá do total, mas o cancelamento continuará registrado no histórico.</p><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setCancelItem(null)} disabled={busy}>Voltar</button><button className="danger" disabled={busy}>{busy?'Removendo...':'Confirmar remoção'}</button></div></form></div>}

    {showDiscount&&profile?.role==='admin'&&<div className="modal-backdrop" onClick={()=>!busy&&setShowDiscount(false)}><form className="modal admin-small-modal" onClick={e=>e.stopPropagation()} onSubmit={saveDiscount}><h3>Aplicar desconto</h3><p>Subtotal atual: <b>{money(subtotal)}</b></p><label>Valor do desconto (R$)</label><input inputMode="decimal" value={discountInput} onChange={e=>setDiscountInput(e.target.value.replace(/[^0-9,.]/g,''))} placeholder="0,00" autoFocus/><small>Use 0,00 para remover o desconto atual.</small><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setShowDiscount(false)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando...':'Aplicar desconto'}</button></div></form></div>}

    {showPayment&&profile?.role==='admin'&&<div className="modal-backdrop payment-backdrop" onClick={()=>!busy&&setShowPayment(false)}><div className="modal admin-small-modal payment-modal" onClick={e=>e.stopPropagation()}><div className="payment-modal-head"><div><h3>Forma de pagamento</h3><p>Escolha como o cliente vai pagar.</p></div><button type="button" className="modal-close-x" aria-label="Fechar" onClick={()=>!busy&&setShowPayment(false)}>×</button></div><div className="payment-status"><span>Total: <b>{money(total)}</b></span>{discount>0&&<span>Desconto: <b>− {money(discount)}</b></span>}<span>Valor a pagar: <b>{money(remaining)}</b></span></div><div className="quick-payment-grid payment-choice-grid"><button type="button" className={selectedPaymentMethod==='pix'?'selected':''} onClick={()=>setSelectedPaymentMethod('pix')} disabled={busy}>Pix</button><button type="button" className={selectedPaymentMethod==='cash'?'selected':''} onClick={()=>setSelectedPaymentMethod('cash')} disabled={busy}>Dinheiro</button><button type="button" className={selectedPaymentMethod==='debit'?'selected':''} onClick={()=>setSelectedPaymentMethod('debit')} disabled={busy}>Débito</button><button type="button" className={selectedPaymentMethod==='credit'?'selected':''} onClick={()=>setSelectedPaymentMethod('credit')} disabled={busy}>Crédito</button></div>{payments.length>0&&<div className="split-payment-list">{payments.map(p=><div key={p.id}><span>{paymentLabels[p.method]||p.method}</span><b>{money(p.amount)}</b></div>)}</div>}{selectedPaymentMethod&&<div className="selected-payment-confirm"><p>Pagamento selecionado: <b>{paymentLabels[selectedPaymentMethod]}</b></p><label>Valor nesta forma de pagamento</label><input className="admin-white-input" inputMode="decimal" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value.replace(/[^0-9,.]/g,''))} placeholder="0,00"/><button type="button" className="primary full" onClick={confirmClosePayment} disabled={busy}>{busy?'Confirmando...':`Registrar ${paymentLabels[selectedPaymentMethod]}`}</button><small>Saldo restante depois deste pagamento: {money(Math.max(0,remaining-(Number(String(paymentAmount||'0').replace(',','.'))||0)))}</small></div>}<div className="modal-actions payment-modal-actions"><button type="button" className="secondary" onClick={()=>setShowPayment(false)} disabled={busy}>Voltar</button></div></div></div>}

    {showCloseSummary&&<div className="modal-backdrop" onClick={()=>!busy&&setShowCloseSummary(false)}><div className="modal close-summary-modal" onClick={e=>e.stopPropagation()}><div className="close-summary-head"><div><h3>Resumo da comanda</h3><p>Mesa {order?.restaurant_tables?.number} • Comanda #{order?.order_number}</p></div><b>{money(total)}</b></div><div className="receipt-preview"><div className="receipt-table-head"><span>Item</span><span>Qtd.</span><span>Unit.</span><span>Total</span></div>{active.map(i=><div className="receipt-row" key={i.id}><div><b>{i.product_name_snapshot}</b>{i.variant_name_snapshot&&<small>{i.variant_name_snapshot}</small>}{i.notes&&<em>Obs.: {i.notes}</em>}</div><span>{i.quantity}</span><span>{money(Number(i.unit_price))}</span><strong>{money(Number(i.unit_price)*Number(i.quantity))}</strong></div>)}</div><div className="close-financial-summary"><div><span>Subtotal</span><b>{money(subtotal)}</b></div>{discount>0&&<div><span>Desconto</span><b>− {money(discount)}</b></div>}<div className="receipt-grand-total"><span>Valor total</span><b>{money(total)}</b></div>{payments.length>0&&<><div><span>Forma de pagamento</span><b>{payments.map(p=>paymentLabels[p.method]||p.method).join(' + ')}</b></div><div><span>Pago</span><b>{money(paid)}</b></div><div><span>Falta</span><b>{money(remaining)}</b></div></>}</div><p className="muted summary-note">Ao tocar em “Imprimir comanda”, o celular envia o pedido ao notebook. A RP80-PLUS deve estar conectada e o Servidor de impressão ativado no notebook.</p><div className="modal-actions close-actions"><button type="button" className="secondary" onClick={()=>setShowCloseSummary(false)} disabled={busy}>Voltar</button><button type="button" className="secondary" onClick={()=>finalizeOrder({print:false})} disabled={busy}>{busy?'Encerrando...':'Encerrar sem imprimir'}</button><button type="button" className="primary" onClick={()=>finalizeOrder({print:true})} disabled={busy}>{busy?'Processando...':'Imprimir comanda'}</button></div></div></div>}
  </Shell>;
}

function Admin(){
  const location=useLocation();
  const allowedTabs=['dashboard','finalized','history','tables','menu','stock','users','printer','backup'];
  const requestedTab=new URLSearchParams(location.search).get('tab');
  const[tab,setTab]=useState(allowedTabs.includes(requestedTab)?requestedTab:'dashboard');
  useEffect(()=>{if(allowedTabs.includes(requestedTab))setTab(requestedTab);},[requestedTab]);const{tables,orders,items,totalFor,reload}=useTablesLive(true);
  const[categories,setCategories]=useState([]),[products,setProducts]=useState([]),[variantsAdmin,setVariantsAdmin]=useState([]),[users,setUsers]=useState([]),[finalized,setFinalized]=useState([]),[movementDays,setMovementDays]=useState([]),[movementReport,setMovementReport]=useState(null);
  const[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  const[newTable,setNewTable]=useState(''),[newCat,setNewCat]=useState(''),[newProduct,setNewProduct]=useState({name:'',category_id:'',price:'',price2:'',stock_quantity:''});
  const[newUser,setNewUser]=useState({full_name:'',role:'',password:''});const[selected,setSelected]=useState(null),[mode,setMode]=useState(null),[newPass,setNewPass]=useState(''),[editName,setEditName]=useState(''),[editRole,setEditRole]=useState('waiter'),[editActive,setEditActive]=useState(true);
  const[productEdit,setProductEdit]=useState(null),[editProductActive,setEditProductActive]=useState(true),[editProductPrice,setEditProductPrice]=useState(''),[editVariantRows,setEditVariantRows]=useState([]);
  const[stockCategory,setStockCategory]=useState(''),[stockInputs,setStockInputs]=useState({});
  const[printer,setPrinter]=useState(()=>getPrinterState());
  const[printServerActive,setPrintServerActive]=useState(false);const[stopPrintAgent,setStopPrintAgent]=useState(null);
  const[backupCfg,setBackupCfg]=useState({enabled:true,frequency:'daily',weekdays:[1,2,3,4,5,6,0],monthly_day:1,backup_time:'03:00',destination_path:'',keep_count:14,last_backup_at:null,last_status:null,last_message:null,last_file:null});

  async function loadAdmin(){
    const[{data:c},{data:p},{data:v},{data:u}]=await Promise.all([
      supabase.from('categories').select('*').order('sort_order,name'),
      supabase.from('products').select('*,categories(name)').is('deleted_at',null).order('sort_order,name'),
      supabase.from('product_variants').select('*').order('sort_order,name'),
      supabase.from('profiles').select('id,full_name,login_name,role,active,password_updated_at,deleted_at').is('deleted_at',null).order('full_name')]);
    setCategories(c||[]);setProducts(p||[]);setVariantsAdmin(v||[]);setUsers(u||[]);if(!newProduct.category_id&&c?.[0])setNewProduct(x=>({...x,category_id:c[0].id}));
  }
  async function loadFinalized(){const{data,error}=await supabase.rpc('get_finalized_tables');if(!error)setFinalized(data||[]);}
  async function loadMovementDays(){const{data,error}=await supabase.rpc('get_movement_days');if(!error)setMovementDays(data||[]);}
  async function openMovementDay(day){
    setBusy(true);
    const{data,error}=await supabase.rpc('get_daily_movement_report',{p_date:day});
    setBusy(false);
    if(error)return alert(error.message);
    setMovementReport(data||null);
  }
  async function printMovementDay(){
    if(!movementReport)return;
    setBusy(true);
    try{
      const status=await localApi.print.status();
      if(!status.active)throw new Error('O servidor de impressão não está ativo no notebook. Abra Painel Admin > Impressora no notebook e ative o servidor de impressão.');
      await localApi.print.queue(movementReport,'report');
      ok('Relatório enviado ao servidor de impressão do notebook.');
    }catch(e){alert(e.message||'Não foi possível imprimir o relatório.');}
    finally{setBusy(false);}
  }
  useEffect(()=>{loadAdmin();loadFinalized();loadMovementDays();const ch=supabase.channel('finalized-admin-live').on('postgres_changes',{event:'*',schema:'public',table:'orders'},()=>{loadFinalized();loadMovementDays();}).on('postgres_changes',{event:'*',schema:'public',table:'order_items'},loadFinalized).on('postgres_changes',{event:'UPDATE',schema:'public',table:'products'},loadAdmin).subscribe();return()=>supabase.removeChannel(ch)},[]);
  function ok(text){setMsg(text);setTimeout(()=>setMsg(''),3500)}
  function newProductPriceMode(){
    const name=categories.find(c=>c.id===newProduct.category_id)?.name||'';
    const rule=VARIANT_CATEGORY_RULES[name];
    if(rule)return {variant:true,first:rule[0],second:rule[1]};
    return {variant:false,first:'Valor',second:null};
  }
  function newProductUsesStock(){
    const name=categories.find(c=>c.id===newProduct.category_id)?.name||'';
    return STOCK_CATEGORY_NAMES.includes(name);
  }

  async function addTable(e){e.preventDefault();const n=Number(newTable);if(!Number.isInteger(n)||n<1)return alert('Informe um número de mesa válido.');
    const{error}=await supabase.from('restaurant_tables').insert({number:n,label:`Mesa ${n}`,status:'free',active:true});if(error)return alert(error.message);setNewTable('');ok(`Mesa ${n} adicionada.`);reload();}
  async function toggleTable(t){
    const openOrder=orders.find(o=>o.table_id===t.id);if(openOrder&&items.some(i=>i.order_id===openOrder.id))return alert('Não é possível excluir/desativar uma mesa que está em uso. Encerre a comanda primeiro.');
    const{error}=await supabase.from('restaurant_tables').update({active:!t.active,status:!t.active?'free':'disabled'}).eq('id',t.id);if(error)return alert(error.message);ok(t.active?`Mesa ${t.number} removida da operação.`:`Mesa ${t.number} reativada.`);reload();
  }
  async function addCategory(e){e.preventDefault();const name=newCat.trim();if(!name)return;const{error}=await supabase.from('categories').insert({name,active:true,sort_order:categories.length+1});if(error)return alert(error.message);setNewCat('');ok('Categoria adicionada.');loadAdmin();}
  async function toggleCategory(c){const{error}=await supabase.from('categories').update({active:!c.active}).eq('id',c.id);if(error)return alert(error.message);loadAdmin();}
  async function addProduct(e){
    e.preventDefault();
    const name=newProduct.name.trim();
    const mode=newProductPriceMode();
    const usesStock=newProductUsesStock();
    if(!name||!newProduct.category_id)return alert('Preencha nome e categoria.');
    let stockQuantity=0;
    if(usesStock){
      const rawStock=String(newProduct.stock_quantity??'').trim();
      if(rawStock==='')return alert('Informe a quantidade inicial em estoque.');
      stockQuantity=Number(rawStock);
      if(!Number.isInteger(stockQuantity)||stockQuantity<0)return alert('Informe uma quantidade de estoque inteira igual ou maior que zero.');
    }
    let basePrice=null,variants=[];
    if(mode.variant){
      const raw1=String(newProduct.price||'').trim(),raw2=String(newProduct.price2||'').trim();
      if(!raw1&&!raw2)return alert(`Informe pelo menos um valor: ${mode.first} ou ${mode.second}.`);
      if(raw1){const v=Number(raw1.replace(',','.'));if(Number.isNaN(v)||v<0)return alert(`Valor inválido em ${mode.first}.`);variants.push({name:mode.first,price:v});}
      if(raw2){const v=Number(raw2.replace(',','.'));if(Number.isNaN(v)||v<0)return alert(`Valor inválido em ${mode.second}.`);variants.push({name:mode.second,price:v});}
    }else{
      const v=Number(String(newProduct.price).replace(',','.'));
      if(Number.isNaN(v)||v<0)return alert('Informe um valor válido.');
      basePrice=v;
    }
    setBusy(true);
    const{data:productId,error}=await supabase.rpc('create_product_admin',{p_name:name,p_category_id:newProduct.category_id,p_base_price:basePrice,p_variants:variants,p_stock_enabled:usesStock});
    if(error){setBusy(false);return alert(error.message);}
    if(usesStock){
      const{error:stockError}=await supabase.rpc('set_product_stock',{p_product_id:productId,p_quantity:stockQuantity});
      if(stockError){setBusy(false);return alert(`Produto criado, mas não foi possível definir o estoque inicial: ${stockError.message}`);}
    }
    setBusy(false);
    setNewProduct(x=>({...x,name:'',price:'',price2:'',stock_quantity:''}));
    ok(usesStock?`Produto adicionado com estoque inicial de ${stockQuantity}.`:'Produto adicionado ao cardápio.');
    loadAdmin();
  }
  function openProductEdit(p){
    setProductEdit(p);
    setEditProductActive(Boolean(p.active));
    setEditProductPrice(p.base_price!=null?String(p.base_price).replace('.',','):'');
    setEditVariantRows(variantsAdmin.filter(v=>v.product_id===p.id).map(v=>({...v,price_input:String(v.price).replace('.',','),active_input:Boolean(v.active)})));
  }
  async function saveProductEdit(e){
    e.preventDefault();
    if(!productEdit)return;
    const updates={active:editProductActive};
    if(productEdit.base_price!=null){
      const price=Number(String(editProductPrice).replace(',','.'));
      if(Number.isNaN(price)||price<0)return alert('Informe um valor válido.');
      updates.base_price=price;
    }
    setBusy(true);
    const{error}=await supabase.from('products').update(updates).eq('id',productEdit.id);
    if(error){setBusy(false);return alert(error.message);}
    for(const row of editVariantRows){
      const price=Number(String(row.price_input).replace(',','.'));
      if(Number.isNaN(price)||price<0){setBusy(false);return alert(`Valor inválido em ${row.name}.`);}
      const{error:ve}=await supabase.from('product_variants').update({price,active:row.active_input}).eq('id',row.id);
      if(ve){setBusy(false);return alert(ve.message);}
    }
    setBusy(false);setProductEdit(null);ok('Produto atualizado.');loadAdmin();
  }
  async function deleteProduct(){
    if(!productEdit)return;
    if(!confirm(`Excluir ${productEdit.name}?\n\nO item sairá do cardápio e da administração, mas continuará preservado nas comandas antigas.`))return;
    setBusy(true);
    const deletedAt=new Date().toISOString();
    const{error}=await supabase.from('products').update({active:false,deleted_at:deletedAt}).eq('id',productEdit.id);
    if(!error)await supabase.from('product_variants').update({active:false}).eq('product_id',productEdit.id);
    setBusy(false);
    if(error)return alert(error.message);
    setProductEdit(null);ok('Produto excluído do cardápio.');loadAdmin();
  }
  const stockCategories=categories.filter(c=>STOCK_CATEGORY_NAMES.includes(c.name));
  const selectedStockCategory=stockCategory||stockCategories[0]?.id||'';
  const stockProducts=products.filter(p=>p.category_id===selectedStockCategory&&p.active);
  async function saveStock(product){
    const raw=stockInputs[product.id];
    const value=raw===undefined?Number(product.stock_quantity||0):Number(raw);
    if(!Number.isInteger(value)||value<0)return alert('Informe uma quantidade inteira igual ou maior que zero.');
    setBusy(true);
    const{error}=await supabase.rpc('set_product_stock',{p_product_id:product.id,p_quantity:value});
    setBusy(false);
    if(error)return alert(error.message);
    setStockInputs(x=>{const next={...x};delete next[product.id];return next});
    ok(`Estoque de ${product.name} atualizado para ${value}.`);
    await loadAdmin();
  }

  async function ensurePrinterConnected(){
    let current=getPrinterState();
    if(current.connected)return current;
    try{return await connectPreviousPrinter();}
    catch{return await connectBluetoothPrinter();}
  }
  async function reconnectPreviousPrinterAdmin(){
    setBusy(true);
    try{setPrinter(await connectPreviousPrinter());ok('Última impressora reconectada.');}
    catch(e){alert(e.message);setPrinter(getPrinterState());}
    finally{setBusy(false);}
  }
  async function reprintFinalized(f){
    setBusy(true);
    try{
      const{data,error}=await supabase.rpc('get_finalized_order_receipt',{p_order_id:f.order_id});
      if(error)throw error;
      const status=await localApi.print.status();
      if(!status.active)throw new Error('O servidor de impressão não está ativo no notebook. Abra Painel Admin > Impressora no notebook e ative o servidor de impressão.');
      await localApi.print.queue({tableNumber:data.table_number,orderNumber:data.order_number,items:data.items||[],subtotal:data.subtotal,discount:data.discount,total:data.total,closedBy:data.closed_by_name,closedAt:data.closed_at,reprint:true},'receipt');
      ok(`Comanda #${data.order_number} enviada ao servidor de impressão.`);
    }catch(e){alert(e.message||'Não foi possível reimprimir a comanda.');}
    finally{setBusy(false);}
  }

  async function connectPrinterAdmin(){
    setBusy(true);
    try{setPrinter(await connectBluetoothPrinter());ok('Impressora Bluetooth conectada.');}
    catch(e){alert(e.message);setPrinter(getPrinterState());}
    finally{setBusy(false);}
  }
  async function testPrinter(){
    try{await printTestReceipt();ok('Teste enviado para a impressora.');}
    catch(e){alert(e.message);}
  }
  function disconnectPrinterAdmin(){if(stopPrintAgent){stopPrintAgent();setStopPrintAgent(null);setPrintServerActive(false)}disconnectPrinter();setPrinter(getPrinterState());ok('Impressora desconectada.');}
  async function activatePrintServer(){
    try{let pstate=getPrinterState();if(!pstate.connected)pstate=await connectBluetoothPrinter();setPrinter({...pstate});const stop=localApi.print.registerAgent(async job=>{try{if(job?.type==='receipt')await printOrderReceipt(job.payload);else if(job?.type==='report')await printDailyMovementReport(job.payload)}catch(e){console.error('Falha no trabalho de impressão:',e)}},status=>{if(status?.ok)setPrintServerActive(true);else if(status?.error)alert(status.error)});setStopPrintAgent(()=>stop);setPrintServerActive(true);ok('Servidor de impressão ativado neste notebook.');}catch(e){alert(e.message)}
  }
  function deactivatePrintServer(){if(stopPrintAgent)stopPrintAgent();setStopPrintAgent(null);setPrintServerActive(false);}
  async function loadBackupSettings(){try{const r=await localApi.backup.getSettings();if(r.data)setBackupCfg(x=>({...x,...r.data}))}catch(e){setMsg(e.message)}}
  async function saveBackupSettings(e){e?.preventDefault?.();setBusy(true);try{const r=await localApi.backup.saveSettings(backupCfg);setBackupCfg(x=>({...x,...r.data}));ok('Configuração de backup salva.')}catch(e){alert(e.message)}finally{setBusy(false)}}
  async function chooseBackupFolder(){setBusy(true);try{const r=await localApi.backup.selectFolder();if(r.path)setBackupCfg(x=>({...x,destination_path:r.path}))}catch(e){alert(e.message)}finally{setBusy(false)}}
  async function testBackupFolder(){setBusy(true);try{await localApi.backup.testPath(backupCfg.destination_path);ok('Pasta de backup disponível para gravação.')}catch(e){alert(e.message)}finally{setBusy(false)}}
  async function backupNow(){if(!confirm('Criar um backup completo do banco agora?'))return;setBusy(true);try{await localApi.backup.saveSettings(backupCfg);await localApi.backup.runNow();await loadBackupSettings();ok('Backup concluído com sucesso.')}catch(e){alert(e.message)}finally{setBusy(false)}}


  async function invokeAdminUsers(body){
    let {data:{session},error:sessionError}=await supabase.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session?.access_token){
      const refreshed=await supabase.auth.refreshSession();
      if(refreshed.error)throw refreshed.error;
      session=refreshed.data.session;
    }
    if(!session?.access_token)throw new Error('Sua sessão expirou. Entre novamente para continuar.');
    const {data,error}=await supabase.functions.invoke('admin-users',{
      body,
      headers:{Authorization:`Bearer ${session.access_token}`}
    });
    if(error){
      let message=error.message||'Não foi possível concluir a operação.';
      try{
        const response=error.context;
        if(response&&typeof response.clone==='function'){
          const detail=await response.clone().json();
          if(detail?.error)message=detail.error;
        }
      }catch{}
      throw new Error(message);
    }
    if(data?.error)throw new Error(data.error);
    return data;
  }

  async function createUser(e){
    e.preventDefault();
    if(!newUser.full_name.trim()||!newUser.role)return alert('Preencha nome, perfil e senha.');
    if(!/^\d{6,12}$/.test(newUser.password))return alert('A senha deve ter entre 6 e 12 números.');
    setBusy(true);
    try{
      await invokeAdminUsers({action:'create',...newUser});
      setNewUser({full_name:'',role:'',password:''});
      ok('Usuário criado.');
      await loadAdmin();
    }catch(e){alert(e.message);}finally{setBusy(false);}
  }
  async function resetPassword(e){
    e.preventDefault();
    if(!/^\d{6,12}$/.test(newPass))return alert('A senha deve ter entre 6 e 12 números.');
    setBusy(true);
    try{
      await invokeAdminUsers({action:'reset_password',user_id:selected.id,password:newPass});
      setSelected(null);setMode(null);setNewPass('');ok('Senha alterada.');await loadAdmin();
    }catch(e){alert(e.message);}finally{setBusy(false);}
  }
  async function saveUser(e){
    e.preventDefault();
    if(!editName.trim())return alert('Informe o nome do usuário.');
    setBusy(true);
    try{
      await invokeAdminUsers({action:'update_profile',user_id:selected.id,full_name:editName.trim(),role:editRole,active:editActive});
      setSelected(null);setMode(null);ok('Usuário atualizado.');await loadAdmin();
    }catch(e){alert(e.message);}finally{setBusy(false);}
  }
  async function deleteUser(u){
    if(!confirm(`Excluir o cadastro de ${u.full_name}?\n\nEsse usuário não poderá mais entrar no sistema. O histórico das comandas e ações antigas será preservado.`))return;
    setBusy(true);
    try{
      await invokeAdminUsers({action:'delete_user',user_id:u.id});
      setSelected(null);setMode(null);ok('Cadastro excluído.');await loadAdmin();
    }catch(e){alert(e.message);}finally{setBusy(false);}
  }

  const orderHasItems=orderId=>items.some(i=>i.order_id===orderId);
  const occupiedOrderFor=tableId=>orders.find(o=>o.table_id===tableId&&orderHasItems(o.id));
  const occupied=tables.filter(t=>Boolean(occupiedOrderFor(t.id)));
  return <Shell><div className="title"><div><h2>Painel Admin</h2><span>Controle total do estabelecimento</span></div></div>
    <div className="admin-tabs"><button className={tab==='dashboard'?'active':''} onClick={()=>setTab('dashboard')}>Mesas em uso</button><button className={tab==='finalized'?'active gold-tab':''} onClick={()=>setTab('finalized')}>Mesas Finalizadas</button><button className={tab==='history'?'active gold-tab':''} onClick={()=>{setMovementReport(null);loadMovementDays();setTab('history')}}>Histórico</button><button className={tab==='tables'?'active':''} onClick={()=>setTab('tables')}>Mesas</button><button className={tab==='menu'?'active':''} onClick={()=>setTab('menu')}>Cardápio</button><button className={tab==='stock'?'active':''} onClick={()=>setTab('stock')}>Estoque</button><button className={tab==='users'?'active':''} onClick={()=>{setNewUser({full_name:'',role:'',password:''});setTab('users')}}>Usuários</button><button className={tab==='printer'?'active':''} onClick={()=>setTab('printer')}>Impressora</button><button className={tab==='backup'?'active':''} onClick={()=>{loadBackupSettings();setTab('backup')}}>Backup</button></div>
    {msg&&<div className="notice">{msg}</div>}

    {tab==='dashboard'&&<section className="panel"><h3>Mesas em uso — tempo real</h3>{!occupied.length?<p className="muted">Nenhuma mesa em uso neste momento.</p>:<div className="occupied-list">{occupied.map(t=>{const o=occupiedOrderFor(t.id);return <Link to={`/comanda/${o.id}`} className="occupied-row" key={t.id}><span><b>Mesa {t.number}</b><small>Comanda #{o.order_number}</small></span><strong>{money(totalFor(o.id))}</strong></Link>})}</div>}</section>}

    {tab==='finalized'&&<section className="panel finalized-panel"><div className="finalized-heading"><div><h3>Mesas Finalizadas</h3><p>Histórico de comandas encerradas • atualização em tempo real</p></div><strong>{finalized.length} encerrada(s)</strong></div>{!finalized.length?<p className="muted">Nenhuma mesa finalizada ainda.</p>:<div className="finalized-list">{finalized.map(f=><div className="finalized-row" key={f.order_id}><div><b>Mesa {f.table_number}</b><small>Comanda #{f.order_number}</small></div><div><span>Encerrada por</span><b>{f.closed_by_name}</b></div><div><span>Horário</span><b>{new Date(f.closed_at).toLocaleString('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</b></div><div className="finalized-total">{Number(f.discount||0)>0&&<small className="finalized-discount">Desconto: − {money(f.discount)}</small>}<span>Valor final</span><strong>{money(f.total)}</strong></div><div className="finalized-actions"><button className="secondary reprint-btn" onClick={()=>reprintFinalized(f)} disabled={busy}>Reimprimir</button></div></div>)}</div>}</section>}


    {tab==='history'&&<section className="panel movement-panel">
      <div className="movement-heading">
        <div><h3>Histórico de movimento</h3><p>Somente os dias em que houve comandas finalizadas aparecem aqui.</p></div>
        {movementReport&&<button className="secondary" onClick={()=>setMovementReport(null)}>← Voltar aos dias</button>}
      </div>
      {!movementReport?<>
        {!movementDays.length?<p className="muted">Ainda não há dias com movimento registrado.</p>:
        <div className="movement-days">{movementDays.map(d=>{
          const dt=new Date(`${d.movement_date}T12:00:00`);
          return <button type="button" className="movement-day-card" key={d.movement_date} onClick={()=>openMovementDay(d.movement_date)}>
            <span><b>{dt.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'})}</b><small>{d.orders_count} comanda(s) finalizada(s)</small></span>
            <span className="movement-day-values">{Number(d.discount_total||0)>0&&<small>Descontos: − {money(d.discount_total)}</small>}<strong>{money(d.net_total)}</strong></span>
          </button>
        })}</div>}
      </>:<>
        <div className="movement-report-top">
          <div><small>Relatório do dia</small><h3>{new Date(`${movementReport.date}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}</h3></div>
          <button className="primary" onClick={printMovementDay} disabled={busy}>{busy?'Processando...':'Imprimir relatório detalhado'}</button>
        </div>
        <div className="movement-summary-grid">
          <div><small>Comandas</small><b>{movementReport.orders_count||0}</b></div>
          <div><small>Subtotal bruto</small><b>{money(movementReport.subtotal_total)}</b></div>
          <div><small>Descontos</small><b>− {money(movementReport.discount_total)}</b></div>
          <div><small>Total do dia</small><b>{money(movementReport.net_total)}</b></div>
        </div>
        <div className="payment-day-summary">
          <h4>Formas de pagamento</h4>
          <div><span>Dinheiro</span><b>{money(movementReport.payments_by_method?.cash||0)}</b></div>
          <div><span>Pix</span><b>{money(movementReport.payments_by_method?.pix||0)}</b></div>
          <div><span>Crédito</span><b>{money(movementReport.payments_by_method?.credit||0)}</b></div>
          <div><span>Débito</span><b>{money(movementReport.payments_by_method?.debit||0)}</b></div>
        </div>
        <div className="movement-orders">
          {(movementReport.orders||[]).map(o=><div className="movement-order-card" key={o.order_id}>
            <div className="movement-order-head">
              <span><b>Mesa {o.table_number}</b><small>Comanda #{o.order_number} • {new Date(o.closed_at).toLocaleTimeString('pt-BR',{timeZone:'America/Recife',hour:'2-digit',minute:'2-digit'})}</small></span>
              <strong>{money(o.total)}</strong>
            </div>
            <div className="movement-items">{(o.items||[]).map((i,idx)=><div key={idx}><span>{i.quantity}× {i.name}{i.variant?` • ${i.variant}`:''}</span><b>{money(i.total)}</b>{i.notes&&<small>Obs.: {i.notes}</small>}</div>)}</div>
            <div className="movement-order-finance"><span>Subtotal <b>{money(o.subtotal)}</b></span>{Number(o.discount||0)>0&&<span>Desconto <b>− {money(o.discount)}</b></span>}<span>Total <b>{money(o.total)}</b></span></div>
            {(o.payments||[]).length>0&&<div className="movement-order-payments"><small>Pagamento:</small>{o.payments.map((p,idx)=><span key={idx}>{({cash:'Dinheiro',pix:'Pix',credit:'Crédito',debit:'Débito'}[p.method]||p.method)} <b>{money(p.amount)}</b></span>)}</div>}
          </div>)}
        </div>
        <div className="movement-grand-total">
          <span>Total de descontos do dia <b>− {money(movementReport.discount_total)}</b></span>
          <span>TOTAL DO DIA <strong>{money(movementReport.net_total)}</strong></span>
        </div>
      </>}
    </section>}

    {tab==='tables'&&<div className="admin-two"><section className="panel"><h3 className="admin-section-title">Adicionar mesa</h3><form className="admin-form" onSubmit={addTable}><label>Número da mesa</label><input type="number" min="1" value={newTable} onChange={e=>setNewTable(e.target.value)} placeholder="Ex.: 21" className="admin-white-input" required/><button className="primary">Adicionar mesa</button></form></section>
      <section className="panel"><h3>Mesas cadastradas</h3><div className="management-list">{tables.map(t=><div className="manage-row" key={t.id}><span><b>Mesa {t.number}</b><small>{occupiedOrderFor(t.id)?'Em uso':t.active?'Livre':'Desativada'}</small></span><button className={t.active?'danger-outline':'secondary'} onClick={()=>toggleTable(t)}>{t.active?'Excluir / desativar':'Reativar'}</button></div>)}</div></section></div>}

    {tab==='menu'&&<div className="menu-admin-grid"><section className="panel"><h3 className="admin-section-title">Nova categoria</h3><form className="admin-form" onSubmit={addCategory}><label>Nome</label><input value={newCat} onChange={e=>setNewCat(e.target.value)} placeholder="Ex.: Sobremesas" className="admin-white-input" required/><button className="primary">Adicionar categoria</button></form><div className="compact-list">{categories.map(c=><div key={c.id}><span>{c.name}</span><button onClick={()=>toggleCategory(c)}>{c.active?'Ocultar':'Ativar'}</button></div>)}</div></section>
      <section className="panel"><h3 className="admin-section-title">Novo produto</h3><form className="admin-form" onSubmit={addProduct}><label>Nome</label><input value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})} placeholder="Ex.: Feijoada especial" required/><label>Categoria</label><select value={newProduct.category_id} onChange={e=>setNewProduct({...newProduct,category_id:e.target.value,price:'',price2:'',stock_quantity:''})}>{categories.filter(c=>c.active).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>{newProductPriceMode().variant?<div className="variant-price-fields"><div><label>{newProductPriceMode().first}</label><input inputMode="decimal" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})} placeholder="Opcional"/></div><div><label>{newProductPriceMode().second}</label><input inputMode="decimal" value={newProduct.price2} onChange={e=>setNewProduct({...newProduct,price2:e.target.value})} placeholder="Opcional"/></div><small>Preencha uma opção ou as duas.</small></div>:<><label>Valor</label><input inputMode="decimal" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})} placeholder="10,00" required/></>}{newProductUsesStock()&&<><label>Quantidade em estoque</label><input type="number" min="0" step="1" inputMode="numeric" value={newProduct.stock_quantity} onChange={e=>setNewProduct({...newProduct,stock_quantity:e.target.value.replace(/\D/g,'')})} placeholder="Ex.: 20" required/><small className="stock-new-product-note">O produto já será cadastrado com essa quantidade disponível.</small></>}<button className="primary" disabled={busy}>{busy?'Salvando...':'Adicionar produto'}</button></form></section>
      <section className="panel span-2"><h3>Produtos cadastrados</h3><div className="management-list products-admin">{products.map(p=><div className="manage-row" key={p.id}><span><b>{p.name}</b><small>{p.categories?.name} • {p.base_price!=null?money(p.base_price):'Preço por variação'} • {p.active?'Ativo':'Desativado'}</small></span><div className="row-actions"><button className="primary-soft" onClick={()=>openProductEdit(p)}>Editar item</button></div></div>)}</div></section></div>}

    {tab==='stock'&&<section className="panel stock-panel"><h3>Controle de estoque</h3><p className="muted">Produtos configurados para controle de estoque • atualização em tempo real</p><label>Categoria</label><select value={selectedStockCategory} onChange={e=>setStockCategory(e.target.value)}>{stockCategories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><div className="stock-list">{stockProducts.map(p=>{const current=Number(p.stock_quantity||0);const input=stockInputs[p.id]??String(current);return <div className={'stock-row '+(current<=0?'stock-row-zero':'')} key={p.id}><span><b>{p.name}</b><small className={current<=0?'stock-zero':'stock-current'}>{current<=0?'Estoque zerado':`Estoque atual: ${current}`}</small></span><div className="stock-editor"><input type="number" min="0" step="1" inputMode="numeric" value={input} onChange={e=>setStockInputs(x=>({...x,[p.id]:e.target.value.replace(/\D/g,'')}))}/><button className="primary" type="button" disabled={busy} onClick={()=>saveStock(p)}>Salvar</button></div></div>})}</div></section>}

    {tab==='printer'&&<section className="panel printer-panel"><div className="printer-head"><div><h3>Impressora da comanda</h3><p className="muted">No notebook servidor, conecte a RP80-PLUS uma vez e ative o servidor de impressão.</p></div><div className={'printer-status '+(printer.connected?'connected':'disconnected')}><span className="status-dot"/>{printer.connected?'Conectada':'Não conectada'}</div></div><div className="printer-card"><div><b>{printer.connected?(printer.name||'Impressora Bluetooth'):'Nenhuma impressora conectada'}</b><small>{printServerActive?'Servidor de impressão ATIVO — celulares podem enviar comandas ao notebook.':printer.connected?'Impressora pronta. Ative o servidor de impressão abaixo.':'Conecte a impressora pelo notebook.'}</small></div><div className="row-actions">{!printer.connected?<button className="secondary" onClick={connectPrinterAdmin} disabled={busy}>{busy?'Conectando...':'Escolher impressora'}</button>:<><button className="secondary" onClick={testPrinter}>Imprimir teste</button>{!printServerActive?<button className="primary" onClick={activatePrintServer}>Ativar servidor de impressão</button>:<button className="danger-outline" onClick={deactivatePrintServer}>Desativar servidor</button>}<button className="danger-outline" onClick={disconnectPrinterAdmin}>Desconectar</button></>}</div></div><div className="printer-note"><b>Como funciona</b><p>O administrador pode encerrar a comanda pelo celular e tocar em “Imprimir comanda”. O pedido é enviado pela rede local ao notebook, e o navegador do notebook imprime automaticamente na RP80-PLUS conectada. O notebook precisa permanecer ligado, com esta aplicação aberta e o servidor de impressão ativo.</p></div></section>}

    {tab==='backup'&&<section className="panel backup-panel"><div className="backup-head"><div><h3>Backup do sistema</h3><p className="muted">Configure backups completos do PostgreSQL no notebook, HD externo ou pendrive.</p></div><button type="button" className="primary backup-now-btn" onClick={backupNow} disabled={busy}>{busy?'Processando...':'Fazer Backup agora'}</button></div><form className="backup-form" onSubmit={saveBackupSettings}><label className="check-row"><input type="checkbox" checked={!!backupCfg.enabled} onChange={e=>setBackupCfg(x=>({...x,enabled:e.target.checked}))}/> Backup automático ativado</label><div className="backup-grid"><label>Frequência<select value={backupCfg.frequency} onChange={e=>setBackupCfg(x=>({...x,frequency:e.target.value}))}><option value="daily">Diariamente</option><option value="weekly">Semanal / dias selecionados</option><option value="monthly">Mensal</option></select></label><label>Horário<input type="time" value={backupCfg.backup_time||'03:00'} onChange={e=>setBackupCfg(x=>({...x,backup_time:e.target.value}))}/></label><label>Manter últimos backups<input type="number" min="1" max="365" value={backupCfg.keep_count||14} onChange={e=>setBackupCfg(x=>({...x,keep_count:Number(e.target.value)}))}/></label>{backupCfg.frequency==='monthly'&&<label>Dia do mês<input type="number" min="1" max="28" value={backupCfg.monthly_day||1} onChange={e=>setBackupCfg(x=>({...x,monthly_day:Number(e.target.value)}))}/></label>}</div>{backupCfg.frequency==='weekly'&&<div className="backup-weekdays">{[['Dom',0],['Seg',1],['Ter',2],['Qua',3],['Qui',4],['Sex',5],['Sáb',6]].map(([name,n])=><label key={n} className={backupCfg.weekdays?.includes(n)?'selected':''}><input type="checkbox" checked={backupCfg.weekdays?.includes(n)||false} onChange={e=>setBackupCfg(x=>({...x,weekdays:e.target.checked?[...(x.weekdays||[]),n]:(x.weekdays||[]).filter(v=>v!==n)}))}/>{name}</label>)}</div>}<label>Pasta ou dispositivo de destino<div className="backup-path-row"><input className="admin-white-input" value={backupCfg.destination_path||''} onChange={e=>setBackupCfg(x=>({...x,destination_path:e.target.value}))} placeholder="Ex.: D:\\Backup Comanda"/><button type="button" className="secondary" onClick={chooseBackupFolder} disabled={busy}>Selecionar pasta/dispositivo</button><button type="button" className="secondary" onClick={testBackupFolder} disabled={busy}>Testar pasta</button></div></label><div className="backup-actions"><button className="primary" disabled={busy}>Salvar configuração</button></div></form><div className={'backup-status '+(backupCfg.last_status||'none')}><b>Último backup</b>{backupCfg.last_backup_at?<><span>{new Date(backupCfg.last_backup_at).toLocaleString('pt-BR',{timeZone:'America/Recife'})} • {backupCfg.last_status==='success'?'Concluído':'Falhou'}</span><small>{backupCfg.last_message}</small>{backupCfg.last_file&&<small>Arquivo: {backupCfg.last_file}</small>}</>:<span>Nenhum backup executado ainda.</span>}</div><div className="printer-note"><b>Importante</b><p>Se o HD externo ou pendrive não estiver conectado no horário programado, o sistema registra a falha e mantém a indicação do último backup válido. O banco não é alterado quando um backup falha.</p></div></section>}

    {tab==='users'&&<div className="admin-two"><section className="panel"><h3 className="admin-section-title">Novo usuário</h3><form className="admin-form" onSubmit={createUser}><label>Nome</label><input value={newUser.full_name} onChange={e=>setNewUser({...newUser,full_name:e.target.value})} placeholder="" required/><label>Perfil</label><select value={newUser.role} onChange={e=>setNewUser({...newUser,role:e.target.value})} required><option value="" disabled>Selecione o perfil</option><option value="waiter">Garçom</option><option value="admin">Administrador</option></select><label>Senha numérica</label><input type="password" inputMode="numeric" value={newUser.password} onChange={e=>setNewUser({...newUser,password:e.target.value.replace(/\D/g,'').slice(0,12)})} required/><button className="primary" disabled={busy}>Cadastrar usuário</button></form></section>
      <section className="panel"><h3>Usuários cadastrados</h3><div className="management-list">{users.map(u=><div className="manage-row" key={u.id}><span><b>{u.full_name}</b><small>{roleLabel[u.role]} • {u.active?'Ativo':'Inativo'}</small></span><div className="row-actions"><button onClick={()=>{setSelected(u);setMode('edit');setEditName(u.full_name);setEditRole(u.role);setEditActive(u.active)}}>Editar</button><button onClick={()=>{setSelected(u);setMode('password');setNewPass('')}}>Trocar senha</button><button className="danger-outline" onClick={()=>deleteUser(u)} disabled={busy}>Excluir cadastro</button></div></div>)}</div></section></div>}

    {productEdit&&<div className="modal-backdrop" onClick={()=>setProductEdit(null)}><form className="modal product-edit-modal" onClick={e=>e.stopPropagation()} onSubmit={saveProductEdit}><h3>Editar item</h3><p><b>{productEdit.name}</b></p>{productEdit.base_price!=null&&<><label>Valor do produto</label><input inputMode="decimal" value={editProductPrice} onChange={e=>setEditProductPrice(e.target.value)} placeholder="0,00" required/></>}<label className="check-row"><input type="checkbox" checked={editProductActive} onChange={e=>setEditProductActive(e.target.checked)}/> Produto ativo no cardápio</label>{editVariantRows.length>0&&<div className="variant-editor"><h4>Variações</h4>{editVariantRows.map((v,idx)=><div className="variant-edit-row" key={v.id}><div><b>{v.name}</b><label className="check-row small-check"><input type="checkbox" checked={v.active_input} onChange={e=>setEditVariantRows(rows=>rows.map((r,i)=>i===idx?{...r,active_input:e.target.checked}:r))}/> Ativa</label></div><input inputMode="decimal" value={v.price_input} onChange={e=>setEditVariantRows(rows=>rows.map((r,i)=>i===idx?{...r,price_input:e.target.value}:r))}/></div>)}</div>}<div className="delete-zone"><button type="button" className="danger" onClick={deleteProduct} disabled={busy}>Excluir item</button><small>O histórico de comandas antigas será preservado.</small></div><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setProductEdit(null)}>Cancelar</button><button className="primary" disabled={busy}>Salvar alterações</button></div></form></div>}

    {selected&&mode==='password'&&<div className="modal-backdrop" onClick={()=>setSelected(null)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={resetPassword}><h3>Trocar senha</h3><p>{selected.full_name}</p><label>Nova senha numérica</label><input autoFocus type="password" inputMode="numeric" value={newPass} onChange={e=>setNewPass(e.target.value.replace(/\D/g,'').slice(0,12))} required/><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setSelected(null)}>Cancelar</button><button className="primary" disabled={busy}>Salvar</button></div></form></div>}
    {selected&&mode==='edit'&&<div className="modal-backdrop" onClick={()=>setSelected(null)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={saveUser}><h3>Editar usuário</h3><label>Nome</label><input value={editName} onChange={e=>setEditName(e.target.value)} required/><label>Perfil</label><select value={editRole} onChange={e=>setEditRole(e.target.value)}><option value="waiter">Garçom</option><option value="admin">Administrador</option></select><label className="check-row"><input type="checkbox" checked={editActive} onChange={e=>setEditActive(e.target.checked)}/> Usuário ativo</label><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setSelected(null)}>Cancelar</button><button className="primary" disabled={busy}>Salvar alterações</button></div></form></div>}
  </Shell>;
}

export default function App(){return <Routes>
  <Route path="/login" element={<Login/>}/><Route path="/cardapio" element={<DigitalMenu/>}/><Route path="/mesas" element={<Protected><Mesas/></Protected>}/><Route path="/comanda/:id" element={<Protected><Comanda/></Protected>}/><Route path="/admin" element={<Protected><AdminOnly><Admin/></AdminOnly></Protected>}/><Route path="*" element={<Navigate to="/mesas"/>}/>
</Routes>}
