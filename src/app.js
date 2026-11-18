import { createServer,positiveId } from './http.js';
export function createApp(store,token){return createServer({token,publicDir:new URL('../public/',import.meta.url),route(method,path,body,query){
 if(path==='/api/tournaments'){
   if(method==='GET')return store.list();if(method==='POST')return store.create(body.name,body.capacity,body.format);
 }
 const historyPath=path.match(/^\/api\/tournaments\/(\d+)\/result-history$/);
 if(method==='GET'&&historyPath)return store.resultHistory(positiveId(historyPath[1]),positiveId(query.get('page')||'1'));
 const standingsPath=path.match(/^\/api\/tournaments\/(\d+)\/standings$/);
 if(method==='GET'&&standingsPath)return store.detail(positiveId(standingsPath[1])).standings;
 let m=path.match(/^\/api\/tournaments\/(\d+)$/);
 if(method==='GET'&&m)return store.detail(positiveId(m[1]));
 m=path.match(/^\/api\/tournaments\/(\d+)\/(register|start|cancel|seed|withdraw|result|correct-result)$/);
 if(method==='POST'&&m){const id=positiveId(m[1]);switch(m[2]){
   case 'register':return store.register(id,body.name,body.seed);
   case 'start':return store.start(id);
   case 'cancel':return store.cancel(id);
   case 'seed':return store.reseed(id,body.entrantId,body.seed);
   case 'withdraw':return store.withdraw(id,body.entrantId);
   case 'correct-result':return store.correctResult(id,body);
   case 'result':return store.result(id,body.matchId,body.scoreA,body.scoreB,body.expectedRevision);
 }}
 }});}
