import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError,text,positiveId } from './http.js';
export function seedOrder(size){
 if(!Number.isInteger(size)||size<2||size>128||(size&(size-1)))throw new HttpError(400,'Bracket size must be a power of two between 2 and 128.');
 let order=[1,2];for(let n=4;n<=size;n*=2)order=order.flatMap(seed=>[seed,n+1-seed]);return order;
}
export function openStore(path=':memory:'){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS tournaments(id INTEGER PRIMARY KEY,name TEXT NOT NULL,capacity INTEGER NOT NULL,
   status TEXT NOT NULL DEFAULT 'registration',champion INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS entrants(id INTEGER PRIMARY KEY,tournament INTEGER NOT NULL REFERENCES tournaments(id),
   name TEXT COLLATE NOCASE NOT NULL,seed INTEGER NOT NULL,UNIQUE(tournament,name),UNIQUE(tournament,seed));
 CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY,tournament INTEGER NOT NULL REFERENCES tournaments(id),
   round INTEGER NOT NULL,position INTEGER NOT NULL,a INTEGER REFERENCES entrants(id),b INTEGER REFERENCES entrants(id),
   winner INTEGER REFERENCES entrants(id),status TEXT NOT NULL DEFAULT 'waiting',score_a INTEGER,score_b INTEGER,
   UNIQUE(tournament,round,position));`);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
 const tournament=id=>{const t=db.prepare('SELECT * FROM tournaments WHERE id=?').get(positiveId(id));if(!t)throw new HttpError(404,'Tournament not found.');return t;};
 const entrants=id=>db.prepare('SELECT * FROM entrants WHERE tournament=? ORDER BY seed,id').all(id);
 const matches=id=>db.prepare('SELECT * FROM matches WHERE tournament=? ORDER BY round,position').all(id);
 function registration(id){const t=tournament(id);if(t.status!=='registration')throw new HttpError(409,'Registration has ended.');return t;}
 function seed(value,capacity){if(!Number.isInteger(value)||value<1||value>capacity)throw new HttpError(400,`Seed must be between 1 and ${capacity}.`);return value;}
 function settle(id){
   const rows=matches(id),lookup=new Map(rows.map(m=>[`${m.round}:${m.position}`,m]));
   for(const m of rows){
     if(['completed','bye'].includes(m.status))continue;
     if(m.round>1){
       const left=lookup.get(`${m.round-1}:${m.position*2}`),right=lookup.get(`${m.round-1}:${m.position*2+1}`);
       if(![left,right].every(child=>['completed','bye'].includes(child.status)))continue;
       m.a=left.winner;m.b=right.winner;
     }
     m.status=m.a&&m.b?'ready':'bye';m.winner=m.status==='bye'?(m.a||m.b||null):null;
     db.prepare('UPDATE matches SET a=?,b=?,winner=?,status=? WHERE id=?').run(m.a,m.b,m.winner,m.status,m.id);
   }
   const final=rows.at(-1);
   if(final&&['completed','bye'].includes(final.status))db.prepare("UPDATE tournaments SET status='completed',champion=? WHERE id=?").run(final.winner,id);
 }
 return {
 close:()=>db.close(),tournament,
 detail(id){const t=tournament(id);return {...t,entrants:entrants(t.id),matches:matches(t.id)};},
 list:()=>db.prepare('SELECT * FROM tournaments ORDER BY id DESC LIMIT 100').all(),
 create(name,capacity=32){name=text(name,64);if(!Number.isInteger(capacity)||capacity<2||capacity>128)throw new HttpError(400,'Capacity must be 2–128.');return tournament(Number(db.prepare('INSERT INTO tournaments(name,capacity) VALUES(?,?)').run(name,capacity).lastInsertRowid));},
 register(id,name,requestedSeed){return tx(()=>{
   const t=registration(id),all=entrants(t.id);name=text(name,40);
   if(all.length>=t.capacity)throw new HttpError(409,'Tournament is full.');
   if(all.some(e=>e.name.toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Entrant name is already registered.');
   const used=new Set(all.map(e=>e.seed));let value=requestedSeed;
   if(value===undefined||value===null){value=1;while(used.has(value))value++;}
   seed(value,t.capacity);if(used.has(value))throw new HttpError(409,'Seed is already assigned.');
   const entrantId=Number(db.prepare('INSERT INTO entrants(tournament,name,seed) VALUES(?,?,?)').run(t.id,name,value).lastInsertRowid);
   return db.prepare('SELECT * FROM entrants WHERE id=?').get(entrantId);
 });},
 reseed(id,entrantId,value){return tx(()=>{
   const t=registration(id);seed(value,t.capacity);entrantId=positiveId(entrantId);
   if(!db.prepare('SELECT 1 FROM entrants WHERE tournament=? AND id=?').get(t.id,entrantId))throw new HttpError(404,'Entrant not found.');
   if(db.prepare('SELECT 1 FROM entrants WHERE tournament=? AND seed=? AND id!=?').get(t.id,value,entrantId))throw new HttpError(409,'Seed is already assigned.');
   db.prepare('UPDATE entrants SET seed=? WHERE tournament=? AND id=?').run(value,t.id,entrantId);return this.detail(t.id);
 });},
 withdraw(id,entrantId){const t=registration(id);const changes=db.prepare('DELETE FROM entrants WHERE tournament=? AND id=?').run(t.id,positiveId(entrantId)).changes;if(!changes)throw new HttpError(404,'Entrant not found.');return this.detail(t.id);},
 start(id){return tx(()=>{
   const t=registration(id),all=entrants(t.id);if(all.length<2)throw new HttpError(409,'At least two entrants are required.');
   const size=2**Math.ceil(Math.log2(all.length)),order=seedOrder(size),rounds=Math.log2(size);
   const insert=db.prepare('INSERT INTO matches(tournament,round,position,a,b) VALUES(?,?,?,?,?)');
   for(let round=1;round<=rounds;round++)for(let pos=0;pos<size/(2**round);pos++)insert.run(t.id,round,pos,round===1?all[order[pos*2]-1]?.id??null:null,round===1?all[order[pos*2+1]-1]?.id??null:null);
   db.prepare("UPDATE tournaments SET status='running' WHERE id=?").run(t.id);settle(t.id);return this.detail(t.id);
 });},
 result(id,matchId,scoreA,scoreB){return tx(()=>{
   const t=tournament(id);if(t.status!=='running')throw new HttpError(409,'Tournament is not running.');
   const m=db.prepare('SELECT * FROM matches WHERE tournament=? AND id=?').get(t.id,positiveId(matchId));
   if(!m)throw new HttpError(404,'Match not found.');if(m.status!=='ready')throw new HttpError(409,'Only ready matches can receive a result.');
   if(![scoreA,scoreB].every(n=>Number.isInteger(n)&&n>=0&&n<=100000)||scoreA===scoreB)throw new HttpError(400,'Scores must be unequal integers from 0 to 100000.');
   db.prepare("UPDATE matches SET winner=?,score_a=?,score_b=?,status='completed' WHERE id=?").run(scoreA>scoreB?m.a:m.b,scoreA,scoreB,m.id);
   settle(t.id);return this.detail(t.id);
 });},
 cancel(id){const t=tournament(id);if(!['registration','running'].includes(t.status))throw new HttpError(409,'Tournament has already ended.');db.prepare("UPDATE tournaments SET status='cancelled' WHERE id=?").run(t.id);return this.detail(t.id);},
 };
}
