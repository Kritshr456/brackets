import { createServer,positiveId } from './http.js';
export function createApp(store,token){return createServer({token,publicDir:new URL('../public/',import.meta.url),route(method,path,body){
 if(path==='/api/tournaments'){
   if(method==='GET')return store.list();if(method==='POST')return store.create(body.name,body.capacity);
 }
 let m=path.match(/^\/api\/tournaments\/(\d+)$/);
 if(method==='GET'&&m)return store.detail(positiveId(m[1]));
 m=path.match(/^\/api\/tournaments\/(\d+)\/(register|start|cancel|seed|withdraw|result)$/);
 if(method==='POST'&&m){const id=positiveId(m[1]);switch(m[2]){
   case 'register':return store.register(id,body.name,body.seed);
   case 'start':return store.start(id);
   case 'cancel':return store.cancel(id);
   case 'seed':return store.reseed(id,body.entrantId,body.seed);
   case 'withdraw':return store.withdraw(id,body.entrantId);
   case 'result':return store.result(id,body.matchId,body.scoreA,body.scoreB);
 }}
 }});}
