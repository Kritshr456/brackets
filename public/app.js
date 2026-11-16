const $=id=>document.getElementById(id);let selected;
async function api(path,body){const response=await fetch(`/api/tournaments${path}`,{headers:{Authorization:`Bearer ${$('token').value}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
function node(tag,text,className){const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
function render(t){
 $('selected').textContent=`#${t.id} ${t.name} • ${t.status}${t.champion?` • Champion: ${t.entrants.find(e=>e.id===t.champion)?.name}`:''}`;
 $('entrants').replaceChildren(...t.entrants.map(e=>node('li',`Seed ${e.seed}: ${e.name} (ID ${e.id})`)));
 const names=new Map(t.entrants.map(e=>[e.id,e.name]));const rounds=new Map();
 for(const m of t.matches){if(!rounds.has(m.round)){const column=node('div','','round');column.append(node('h3',`Round ${m.round}`));rounds.set(m.round,column);}
 const card=node('div','',`match ${m.status}`);card.append(node('small',`Match #${m.id} • ${m.status}`));
 card.append(node('p',`${names.get(m.a)||'—'}${m.score_a!==null?` (${m.score_a})`:''}`,m.winner===m.a?'winner':''));
 card.append(node('p',`${names.get(m.b)||'—'}${m.score_b!==null?` (${m.score_b})`:''}`,m.winner===m.b?'winner':''));rounds.get(m.round).append(card);}
 $('bracket').replaceChildren(...rounds.values());
 if(!t.matches.length)$('bracket').textContent='The bracket appears when registration ends.';
}
async function refresh(){const list=await api('');$('tournaments').replaceChildren(...list.map(t=>{const li=node('li','');const b=node('button',`#${t.id} ${t.name} — ${t.status}`);b.onclick=()=>run(async()=>{selected=t.id;render(await api(`/${selected}`));});li.append(b);return li;}));if(selected)render(await api(`/${selected}`));}
async function run(fn){try{await fn();$('status').textContent='Saved / refreshed.';}catch(error){$('status').textContent=error.message;}}
async function action(name,body={}){if(!selected)throw Error('Select a tournament first.');await api(`/${selected}/${name}`,body);await refresh();}
$('connect').onclick=()=>run(refresh);
$('create').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);run(async()=>{selected=(await api('',{name:f.get('name'),capacity:Number(f.get('capacity'))})).id;e.target.reset();await refresh();});};
$('register').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);run(async()=>{await action('register',{name:f.get('name'),seed:f.get('seed')?Number(f.get('seed')):null});e.target.reset();});};
$('manage').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);run(()=>action(e.submitter.value,{entrantId:Number(f.get('entrantId')),seed:Number(f.get('seed'))}));};
$('start').onclick=()=>run(()=>action('start'));
$('cancel').onclick=()=>{if(confirm('Cancel this tournament? This cannot be undone.'))run(()=>action('cancel'));};
$('result').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);run(()=>action('result',{matchId:Number(f.get('matchId')),scoreA:Number(f.get('scoreA')),scoreB:Number(f.get('scoreB'))}));};
