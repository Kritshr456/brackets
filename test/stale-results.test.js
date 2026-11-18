import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';
import { createApp } from '../src/app.js';

function scenario() {
  const s=openStore(),cup=s.create('Stale form',4);
  for(let n=1;n<=4;n++)s.register(cup.id,`Player ${n}`);
  let t=s.start(cup.id);
  for(const m of t.matches.filter(m=>m.status==='ready'))t=s.result(cup.id,m.id,2,0);
  const stale=t.matches.at(-1),semi=t.matches[0];
  const updated=s.correctResult(cup.id,{matchId:semi.id,scoreA:0,scoreB:3,expectedScoreA:semi.score_a,expectedScoreB:semi.score_b,expectedRevision:semi.revision,reason:'Winner was entered backwards'});
  return {s,id:cup.id,stale,current:updated.matches.at(-1)};
}

test('a result form from before a feeder correction cannot score the replacement participants',()=>{
 const {s,id,stale,current}=scenario();try{
  assert.notEqual(current.a,stale.a);assert.ok(current.revision>stale.revision);
  const before=s.detail(id);
  assert.throws(()=>s.result(id,stale.id,2,0,stale.revision),error=>error.status===409);
  assert.deepEqual(s.detail(id),before);
  assert.throws(()=>s.result(id,current.id,2,0),error=>error.status===409);
  assert.deepEqual(s.detail(id),before);
  const finished=s.result(id,current.id,2,0,current.revision);
  assert.equal(finished.champion,current.a);
 }finally{s.close();}
});

test('normal result submissions reject stale HTTP revisions without writing audit rows',async()=>{
 const {s,id,stale,current}=scenario(),token='stale-result-test-only-token-'.repeat(2),app=createApp(s,token);
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${app.address().port}/api/tournaments/${id}/result`;
 const call=revision=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({matchId:current.id,scoreA:2,scoreB:0,expectedRevision:revision})});
 try{
  const before=s.detail(id);
  assert.equal((await call(stale.revision)).status,409);assert.equal((await call(undefined)).status,409);
  assert.equal((await call(true)).status,400);assert.deepEqual(s.detail(id),before);
  assert.equal((await call(current.revision)).status,200);assert.equal(s.detail(id).champion,current.a);
 }finally{await new Promise(resolve=>app.close(resolve));s.close();}
});

test('restoring the original participants does not make an old result form valid again',()=>{
 const {s,id,stale}=scenario();try{
  const semi=s.detail(id).matches[0];
  const restored=s.correctResult(id,{matchId:semi.id,scoreA:2,scoreB:0,expectedScoreA:semi.score_a,expectedScoreB:semi.score_b,expectedRevision:semi.revision,reason:'Confirmed original winner'});
  const final=restored.matches.at(-1);assert.equal(final.a,stale.a);assert.equal(final.b,stale.b);
  assert.throws(()=>s.result(id,final.id,2,0,stale.revision),error=>error.status===409);
 }finally{s.close();}
});
