import {io} from 'socket.io-client';

const API='/api';
const SESSION_KEY='periclesdev_comanda_local_session';
const authListeners=new Set();
let socket=null;

function readSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
}
function writeSession(session){
  try{if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY)}catch{}
  for(const fn of authListeners)fn(session?'SIGNED_IN':'SIGNED_OUT',session);
}
async function request(path,{method='GET',body,auth=true}={}){
  const session=readSession();
  const headers={'Content-Type':'application/json'};
  if(auth&&session?.access_token)headers.Authorization=`Bearer ${session.access_token}`;
  const res=await fetch(`${API}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let payload={};try{payload=await res.json()}catch{}
  if(!res.ok)throw new Error(payload?.error||`Erro HTTP ${res.status}`);
  return payload;
}

class QueryBuilder{
  constructor(table){this.table=table;this.action='select';this.columns='*';this.filters=[];this.orders=[];this.values=null;this.wantSingle=false;}
  select(columns='*'){this.action='select';this.columns=columns;return this;}
  insert(values){this.action='insert';this.values=values;return this;}
  update(values){this.action='update';this.values=values;return this;}
  eq(column,value){this.filters.push({op:'eq',column,value});return this;}
  in(column,values){this.filters.push({op:'in',column,values});return this;}
  is(column,value){this.filters.push({op:'is',column,value});return this;}
  order(column,opts={}){String(column).split(',').map(x=>x.trim()).filter(Boolean).forEach(c=>this.orders.push({column:c,ascending:opts.ascending!==false}));return this;}
  single(){this.wantSingle=true;return this;}
  async execute(){
    try{
      const out=await request('/query',{method:'POST',body:{table:this.table,action:this.action,columns:this.columns,filters:this.filters,orders:this.orders,values:this.values,single:this.wantSingle}});
      return {data:out.data,error:null};
    }catch(error){return {data:null,error}}
  }
  then(resolve,reject){return this.execute().then(resolve,reject)}
}

function ensureSocket(){
  if(!socket)socket=io({transports:['websocket','polling']});
  return socket;
}
class Channel{
  constructor(name){this.name=name;this.handlers=[];this.bound=null;}
  on(_kind,filter,callback){this.handlers.push({filter,callback});return this;}
  subscribe(callback){
    const s=ensureSocket();
    this.bound=payload=>{
      for(const h of this.handlers){
        const f=h.filter||{};
        if(f.table&&payload.table!==f.table)continue;
        if(f.event&&f.event!=='*'&&payload.event!==f.event)continue;
        if(f.filter){
          const m=String(f.filter).match(/^([^=]+)=eq\.(.+)$/);
          if(m&&String(payload.row?.[m[1]])!==m[2])continue;
        }
        h.callback(payload);
      }
    };
    s.on('db-change',this.bound);
    if(callback)s.connected?callback('SUBSCRIBED'):s.once('connect',()=>callback('SUBSCRIBED'));
    return this;
  }
  unsubscribe(){if(this.bound&&socket)socket.off('db-change',this.bound);this.bound=null;}
}

export const localApi={
  backup:{
    async getSettings(){return request('/backup/settings')},
    async saveSettings(body){return request('/backup/settings',{method:'POST',body})},
    async selectFolder(){return request('/backup/select-folder',{method:'POST'})},
    async runNow(){return request('/backup/run',{method:'POST'})},
    async testPath(destination_path){return request('/backup/test-path',{method:'POST',body:{destination_path}})}
  },
  print:{
    async status(){return request('/print/status')},
    async queue(payload,type='receipt'){return request('/print/job',{method:'POST',body:{type,payload}})},
    registerAgent(onJob,onStatus){const s=ensureSocket();const session=readSession();const job=(data)=>onJob?.(data);const status=(data)=>onStatus?.(data);s.on('print-job',job);s.on('print-agent-status',status);s.emit('print-agent-register',{token:session?.access_token});return ()=>{s.emit('print-agent-unregister');s.off('print-job',job);s.off('print-agent-status',status)}}
  }
};

export const supabase={
  auth:{
    async getSession(){return {data:{session:readSession()},error:null}},
    async getUser(){return {data:{user:readSession()?.user||null},error:null}},
    onAuthStateChange(fn){authListeners.add(fn);return {data:{subscription:{unsubscribe:()=>authListeners.delete(fn)}}}},
    async signInWithPassword({email,password}){
      try{const data=await request('/auth/login',{method:'POST',body:{email,password},auth:false});writeSession(data.session);return {data,error:null};}
      catch(error){return {data:null,error}}
    },
    async signOut(){try{await request('/auth/logout',{method:'POST'})}catch{}writeSession(null);return {error:null}},
    async refreshSession(){const session=readSession();return {data:{session},error:session?null:new Error('Sessão expirada.')}}
  },
  from(table){return new QueryBuilder(table)},
  async rpc(name,args={}){try{const out=await request(`/rpc/${encodeURIComponent(name)}`,{method:'POST',body:args,auth:name!=='get_public_menu'});return {data:out.data,error:null}}catch(error){return {data:null,error}}},
  channel(name){return new Channel(name)},
  removeChannel(ch){ch?.unsubscribe?.();return Promise.resolve('ok')},
  functions:{async invoke(name,{body}={}){try{if(name!=='admin-users')throw new Error('Função local não suportada.');const data=await request('/admin-users',{method:'POST',body});return {data,error:null}}catch(error){return {data:null,error}}}}
};
