import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore,seedOrder } from '../src/store.js';
import { createApp } from '../src/app.js';
test('standard seed placement and invalid bracket sizes',()=>{assert.deepEqual(seedOrder(8),[1,8,4,5,2,7,3,6]);assert.throws(()=>seedOrder(3));});
test('all entrant counts 2–33 and 128 produce exactly one champion and n-1 played matches',()=>{
 for(const n of [...Array.from({length:32},(_,i)=>i+2),128]){
 const s=openStore();try{const t=s.create(`cup ${n}`,128);for(let i=1;i<=n;i++)s.register(t.id,`p${i}`,i);let current=s.start(t.id),guard=0;
 while(current.status==='running'){
  assert.ok(guard++<n);const ready=current.matches.filter(m=>m.status==='ready');assert.ok(ready.length);
  for(const m of ready){const a=current.entrants.find(e=>e.id===m.a),b=current.entrants.find(e=>e.id===m.b);current=s.result(t.id,m.id,a.seed<b.seed?1:0,a.seed<b.seed?0:1);}
 }
 assert.equal(current.status,'completed');assert.equal(current.champion,current.entrants[0].id);assert.equal(current.matches.filter(m=>m.status==='completed').length,n-1);
 }finally{s.close();}}
});
test('registration limits, duplicate names, seeding and withdrawals',()=>{const s=openStore();try{const t=s.create('cup',2),a=s.register(t.id,'A');assert.throws(()=>s.register(t.id,'a'));const b=s.register(t.id,'B');assert.throws(()=>s.register(t.id,'C'));assert.throws(()=>s.reseed(t.id,a.id,b.seed));s.withdraw(t.id,b.id);s.reseed(t.id,a.id,2);assert.equal(s.detail(t.id).entrants[0].seed,2);assert.throws(()=>s.start(t.id));}finally{s.close();}});
test('ties, premature and duplicate results are rejected without partial progression',()=>{
 const s=openStore();try{const t=s.create('cup');for(let i=0;i<4;i++)s.register(t.id,`p${i}`);const current=s.start(t.id),m=current.matches[0],final=current.matches.at(-1);
 assert.throws(()=>s.result(t.id,final.id,1,0));assert.throws(()=>s.result(t.id,m.id,1,1));assert.throws(()=>s.result(t.id,m.id,-1,0));assert.equal(s.detail(t.id).matches[0].status,'ready');s.result(t.id,m.id,1,0);assert.throws(()=>s.result(t.id,m.id,0,1));assert.throws(()=>s.register(t.id,'late'));s.cancel(t.id);assert.throws(()=>s.result(t.id,current.matches[1].id,1,0));
 }finally{s.close();}
});
test('matches are scoped to tournaments and saved across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'brackets-'));try{const file=join(dir,'db.sqlite');let s=openStore(file);const t=s.create('one'),other=s.create('two');s.register(t.id,'A');s.register(t.id,'B');const m=s.start(t.id).matches[0];assert.throws(()=>s.result(other.id,m.id,1,0));s.close();s=openStore(file);assert.equal(s.detail(t.id).matches[0].status,'ready');assert.equal(s.result(t.id,m.id,1,0).status,'completed');s.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('authenticated HTTP flow from registration to champion',async()=>{
 const s=openStore(),token='test-token-'.repeat(4),app=createApp(s,token);await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const call=(path,body,auth=true)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
 assert.equal((await call('/api/tournaments',null,false)).status,401);
 assert.equal((await call('/api/tournaments',{name:'bad',capacity:1})).status,400);
 const t=await(await call('/api/tournaments',{name:'Cup',capacity:8})).json();
 await call(`/api/tournaments/${t.id}/register`,{name:'Alpha'});await call(`/api/tournaments/${t.id}/register`,{name:'Beta'});
 const started=await(await call(`/api/tournaments/${t.id}/start`,{})).json();const m=started.matches[0];
 const finished=await(await call(`/api/tournaments/${t.id}/result`,{matchId:m.id,scoreA:2,scoreB:0})).json();assert.equal(finished.status,'completed');assert.equal(finished.champion,m.a);
 assert.equal((await call(`/api/tournaments/${t.id}/result`,{matchId:m.id,scoreA:0,scoreB:2})).status,409);
 assert.match(await(await call('/',null,false)).text(),/Bracket room/);
 const invalid=await fetch(base+'/api/tournaments',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{broken'});assert.equal(invalid.status,400);
 }finally{await new Promise(r=>app.close(r));s.close();}
});
