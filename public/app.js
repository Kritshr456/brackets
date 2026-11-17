import { standingsCsv } from './format.js';

const $ = id => document.getElementById(id);
const state = { selected: null, tournament: null, busy: false };
const formatName = format => format === 'round_robin' ? 'Round robin' : 'Single elimination';

async function api(path, body) {
  const response = await fetch(`/api/tournaments${path}`, {
    headers: { Authorization: `Bearer ${$('token').value}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error);
  return data;
}
function node(tag, text = '', className) {
  const e = document.createElement(tag); e.textContent = text;
  if (className) e.className = className;
  return e;
}
function option(value, label) {
  const e = node('option', label); e.value = value; return e;
}
function updateControls() {
  for (const e of document.querySelectorAll('button, input, select')) e.disabled = state.busy;
  const t = state.tournament, registering = t?.status === 'registration';
  for (const id of ['register', 'manage']) for (const e of $(id).elements) e.disabled = state.busy || !registering;
  $('start').disabled = state.busy || !registering || t.entrants.length < 2;
  $('cancel').disabled = state.busy || !['registration', 'running'].includes(t?.status);
  const canReport = t?.status === 'running' && t.matches.some(m => m.status === 'ready');
  for (const e of $('result').elements) e.disabled = state.busy || !canReport;
  $('export').disabled = state.busy || !t?.standings.length;
}
function renderStandings(t) {
  $('standings-section').hidden = t.format !== 'round_robin';
  $('standings').replaceChildren();
  if (t.format !== 'round_robin') return;
  if (!t.standings.length) { $('standings').textContent = 'Register entrants to see the table.'; return; }
  const table = node('table'), head = node('thead'), heading = node('tr');
  const caption = node('caption', `${t.name} — standings`); table.append(caption);
  for (const label of ['Rank', 'Entrant', 'P', 'W', 'D', 'L', 'For', 'Against', 'Diff', 'Pts']) {
    const th = node('th', label); th.scope = 'col'; heading.append(th);
  }
  head.append(heading); table.append(head);
  const body = node('tbody');
  for (const row of t.standings) {
    const tr = node('tr', '', t.status === 'completed' && row.rank === 1 ? 'leader' : '');
    for (const value of [row.rank, `${row.name} (#${row.entrant_id})`, row.played, row.wins, row.draws, row.losses,
      row.score_for, row.score_against, row.score_difference, row.points]) tr.append(node('td', String(value)));
    body.append(tr);
  }
  table.append(body); $('standings').append(table);
}
function renderFixtures() {
  const t = state.tournament;
  if (!t) return;
  const names = new Map(t.entrants.map(e => [e.id, e.name])), rounds = new Map();
  const filtered = t.matches.filter(m => ($('fixture-round').value === 'all' || String(m.round) === $('fixture-round').value) &&
    ($('fixture-status').value === 'all' || m.status === $('fixture-status').value));
  for (const m of filtered) {
    if (!rounds.has(m.round)) {
      const column = node('div', '', 'round'); column.append(node('h3', `Round ${m.round}`)); rounds.set(m.round, column);
    }
    const draw = m.status === 'completed' && m.winner === null;
    const card = node('article', '', `match ${m.status}`);
    card.append(node('small', `Match #${m.id} · ${draw ? 'Draw' : m.status}`));
    card.append(node('p', `${names.get(m.a) || '—'}${m.score_a !== null ? ` (${m.score_a})` : ''}`, m.winner === m.a && m.a ? 'winner' : ''));
    card.append(node('p', `${names.get(m.b) || '—'}${m.score_b !== null ? ` (${m.score_b})` : ''}`, m.winner === m.b && m.b ? 'winner' : ''));
    rounds.get(m.round).append(card);
  }
  $('bracket').replaceChildren(...rounds.values());
  if (!filtered.length) $('bracket').append(node('p', t.matches.length ? 'No matches match these filters.' : 'Matches appear when registration ends.'));
}
function updateScoreLabels() {
  const t = state.tournament, match = t?.matches.find(m => String(m.id) === $('match-choice').value);
  const name = id => t.entrants.find(e => e.id === id)?.name || 'Side';
  $('side-a').textContent = match ? `${name(match.a)} score` : 'Side A score';
  $('side-b').textContent = match ? `${name(match.b)} score` : 'Side B score';
}
function render(t) {
  state.tournament = t;
  const name = id => t.entrants.find(e => e.id === id)?.name || `#${id}`;
  const outcome = t.champion ? ` · Champion: ${name(t.champion)}` :
    t.status === 'completed' && t.leaders.length > 1 ? ` · Shared first: ${t.leaders.map(name).join(', ')}` : '';
  $('selected').textContent = `#${t.id} ${t.name} · ${formatName(t.format)} · ${t.status}${outcome}`;
  $('summary').textContent = `${t.entrants.length}/${t.capacity} entrants · ${t.matches.filter(m => m.status === 'completed').length}/${t.matches.filter(m => m.status !== 'bye').length} played matches completed`;
  $('entrants').replaceChildren(...t.entrants.map(e => node('li', `Seed ${e.seed}: ${e.name} (ID ${e.id})`)));
  for (const form of [$('register'), $('manage')]) form.elements.seed.max = String(t.capacity);
  $('fixtures-title').textContent = t.format === 'round_robin' ? 'Round-robin fixtures' : 'Bracket';
  $('result-help').textContent = t.format === 'round_robin' ? 'Draws are allowed. Fixtures may be reported in any order; standings update after each result.' : 'Knockout matches need a winner. The next match opens after both feeders finish.';
  const previousRound = $('fixture-round').value, roundNumbers = [...new Set(t.matches.map(m => m.round))];
  $('fixture-round').replaceChildren(option('all', 'All rounds'), ...roundNumbers.map(r => option(r, `Round ${r}`)));
  $('fixture-round').value = roundNumbers.some(r => String(r) === previousRound) ? previousRound : 'all';
  $('fixture-filters').hidden = !t.matches.length;
  const previousMatch = $('match-choice').value, ready = t.status === 'running' ? t.matches.filter(m => m.status === 'ready') : [];
  $('match-choice').replaceChildren(...(ready.length ? ready.map(m => option(m.id, `#${m.id} · R${m.round} · ${name(m.a)} vs ${name(m.b)}`)) : [option('', 'No ready matches')]));
  if (ready.some(m => String(m.id) === previousMatch)) $('match-choice').value = previousMatch;
  updateScoreLabels(); renderStandings(t); renderFixtures(); updateControls();
}
async function refresh() {
  const list = await api('');
  $('tournaments').replaceChildren(...list.map(t => {
    const li = node('li'), button = node('button', `#${t.id} ${t.name} · ${formatName(t.format)} · ${t.status}`);
    button.onclick = () => run(async () => {
      const detail = await api(`/${t.id}`); state.selected = t.id;
      $('fixture-round').value = 'all'; $('fixture-status').value = 'all'; render(detail);
    });
    li.append(button); return li;
  }));
  if (state.selected) render(await api(`/${state.selected}`));
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true; updateControls(); $('status').textContent = 'Working…';
  try { const message = await fn(); $('status').textContent = message || 'Saved / refreshed.'; }
  catch (error) { $('status').textContent = error.message; }
  finally { state.busy = false; updateControls(); }
}
async function action(name, body = {}) {
  if (!state.selected) throw Error('Select a tournament first.');
  await api(`/${state.selected}/${name}`, body); await refresh();
}
$('connect').onclick = () => run(refresh);
$('format').onchange = () => {
  const league = $('format').value === 'round_robin';
  $('capacity').max = league ? '32' : '128';
  if (Number($('capacity').value) > Number($('capacity').max)) $('capacity').value = $('capacity').max;
  $('format-help').textContent = league ? 'Everyone plays everyone once. Up to 32 entrants; odd fields have a rest round.' : 'Knockout matches with seeded byes. Up to 128 entrants.';
};
$('create').onsubmit = e => {
  e.preventDefault(); const f = new FormData(e.target);
  run(async () => {
    const created = await api('', { name: f.get('name'), capacity: Number(f.get('capacity')), format: f.get('format') });
    state.selected = created.id; await refresh();
    e.target.reset(); $('format').onchange(); return 'Tournament created. Register entrants below.';
  });
};
$('register').onsubmit = e => {
  e.preventDefault(); const f = new FormData(e.target);
  run(async () => { await action('register', { name: f.get('name'), seed: f.get('seed') ? Number(f.get('seed')) : null }); e.target.reset(); });
};
$('manage').onsubmit = e => {
  e.preventDefault(); const f = new FormData(e.target), actionName = e.submitter.value;
  run(() => action(actionName, { entrantId: Number(f.get('entrantId')), seed: Number(f.get('seed')) }));
};
$('start').onclick = () => run(() => action('start'));
$('cancel').onclick = () => { if (confirm('Cancel this tournament? This cannot be undone.')) run(() => action('cancel')); };
$('result').onsubmit = e => {
  e.preventDefault(); const f = new FormData(e.target);
  run(() => action('result', { matchId: Number(f.get('matchId')), scoreA: Number(f.get('scoreA')), scoreB: Number(f.get('scoreB')) }));
};
$('fixture-round').onchange = renderFixtures; $('fixture-status').onchange = renderFixtures;
$('match-choice').onchange = updateScoreLabels;
$('export').onclick = () => {
  if (!state.tournament?.standings.length) return;
  const blob = new Blob(['\uFEFF', standingsCsv(state.tournament.standings)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = `tournament-${state.selected}-standings.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
updateControls();
