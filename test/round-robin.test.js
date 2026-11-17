import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { roundRobinSchedule, roundRobinStandings } from '../src/round-robin.js';
import { openStore } from '../src/store.js';
import { createApp } from '../src/app.js';

function entrants(n) {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Player ${i + 1}`, seed: i + 1 }));
}
function completed(a, b, score_a, score_b) {
  return { a, b, score_a, score_b, status: 'completed' };
}
function cup(store, n) {
  const t = store.create(`League ${n}`, Math.max(2, n), 'round_robin');
  for (const e of entrants(n)) store.register(t.id, e.name, e.seed);
  return store.start(t.id);
}

test('every field size 2–32 schedules each pair once, never twice in a round', () => {
  for (let n = 2; n <= 32; n++) {
    const ids = entrants(n).map(e => e.id * 7), schedule = roundRobinSchedule(ids);
    assert.equal(schedule.length, n * (n - 1) / 2);
    const pairs = new Set(), perRound = new Map(), appearances = new Map(ids.map(id => [id, 0]));
    for (const m of schedule) {
      assert.notEqual(m.a, m.b);
      const key = [m.a, m.b].sort((a, b) => a - b).join(':');
      assert.ok(!pairs.has(key)); pairs.add(key);
      const round = perRound.get(m.round) || new Set();
      for (const id of [m.a, m.b]) {
        assert.ok(ids.includes(id)); assert.ok(!round.has(id)); round.add(id);
        appearances.set(id, appearances.get(id) + 1);
      }
      perRound.set(m.round, round);
    }
    assert.equal(perRound.size, n % 2 ? n : n - 1);
    for (const round of perRound.values()) assert.equal(round.size, n % 2 ? n - 1 : n);
    for (const count of appearances.values()) assert.equal(count, n - 1);
  }
});

test('scheduler rejects invalid fields without mutating input', () => {
  for (const ids of [[], [1], [1, 1], [true, 2], Array.from({ length: 33 }, (_, i) => i + 1), null])
    assert.throws(() => roundRobinSchedule(ids), error => error.status === 400);
  const ids = [9, 2, 7]; roundRobinSchedule(ids); assert.deepEqual(ids, [9, 2, 7]);
});

test('standings count wins, losses, draws and scores from completed matches only', () => {
  const rows = roundRobinStandings(entrants(4), [
    completed(1, 2, 3, 1), completed(3, 4, 0, 0), completed(2, 3, 2, 0), completed(1, 4, 1, 1),
    { a: 1, b: 3, status: 'ready', score_a: null, score_b: null },
  ]);
  assert.deepEqual(rows.map(r => r.entrant_id), [1, 2, 4, 3]);
  assert.deepEqual(rows.map(r => r.points), [4, 3, 2, 1]);
  assert.deepEqual(rows.map(r => r.played), [2, 2, 2, 2]);
  const a = rows[0];
  assert.deepEqual([a.wins, a.draws, a.losses, a.score_for, a.score_against, a.score_difference], [1, 1, 0, 4, 2, 2]);
});

test('ranking uses points, score difference, then score for; seeds only order tied rows', () => {
  const cycle = roundRobinStandings(entrants(3), [completed(1, 2, 2, 0), completed(2, 3, 3, 0), completed(3, 1, 4, 0)]);
  assert.deepEqual(cycle.map(r => r.entrant_id), [3, 2, 1]);
  assert.deepEqual(cycle.map(r => r.rank), [1, 2, 3]);
  const tied = roundRobinStandings(entrants(3).reverse(), [completed(1, 2, 0, 0), completed(2, 3, 0, 0), completed(1, 3, 0, 0)]);
  assert.deepEqual(tied.map(r => r.entrant_id), [1, 2, 3]);
  assert.deepEqual(tied.map(r => r.rank), [1, 1, 1]);
  const split = roundRobinStandings(entrants(3), [completed(1, 2, 0, 0), completed(1, 3, 1, 0), completed(2, 3, 1, 0)]);
  assert.deepEqual(split.map(r => r.rank), [1, 1, 3]);
});

test('round-robin fields 2–12 finish only after all fixtures, even when reported out of order', () => {
  for (let n = 2; n <= 12; n++) {
    const s = openStore();
    try {
      let t = cup(s, n);
      const fixtures = [...t.matches].reverse();
      assert.equal(t.format, 'round_robin');
      assert.equal(t.matches.length, n * (n - 1) / 2);
      assert.ok(t.matches.every(m => m.status === 'ready'));
      for (const [index, m] of fixtures.entries()) {
        t = s.result(t.id, m.id, m.a < m.b ? 2 : 0, m.a < m.b ? 0 : 2);
        assert.equal(t.status, index === fixtures.length - 1 ? 'completed' : 'running');
      }
      assert.equal(t.champion, t.entrants[0].id);
      assert.deepEqual(t.leaders, [t.champion]);
      assert.equal(t.standings[0].points, (n - 1) * 3);
      assert.ok(t.standings.every(row => row.played === n - 1));
    } finally { s.close(); }
  }
});

test('an all-draw league completes with shared leaders, not an arbitrary champion', () => {
  const s = openStore();
  try {
    let t = cup(s, 5);
    for (const m of t.matches) t = s.result(t.id, m.id, 0, 0);
    assert.equal(t.status, 'completed'); assert.equal(t.champion, null);
    assert.deepEqual(t.leaders, t.entrants.map(e => e.id));
    assert.ok(t.standings.every(row => row.draws === 4 && row.points === 4));
    assert.throws(() => s.result(t.id, t.matches[0].id, 1, 0), error => error.status === 409);
  } finally { s.close(); }
});

test('invalid results, duplicate submissions and cancellation leave standings consistent', () => {
  const s = openStore();
  try {
    const t = cup(s, 3), m = t.matches[0];
    for (const scores of [[-1, 0], [0.5, 0], [100001, 0], [null, 0], ['1', 0]])
      assert.throws(() => s.result(t.id, m.id, ...scores), error => error.status === 400);
    assert.deepEqual(s.detail(t.id).standings, t.standings);
    const saved = s.result(t.id, m.id, 1, 1);
    assert.throws(() => s.result(t.id, m.id, 2, 0), error => error.status === 409);
    assert.deepEqual(s.detail(t.id).standings, saved.standings);
    assert.throws(() => s.register(t.id, 'Late entrant'), error => error.status === 409);
    s.cancel(t.id);
    assert.throws(() => s.result(t.id, t.matches[1].id, 2, 0), error => error.status === 409);
    assert.equal(s.detail(t.id).champion, null);
  } finally { s.close(); }
});

test('format and capacity validation retain the legacy default', () => {
  const s = openStore();
  try {
    assert.equal(s.create('Old API').format, 'single_elimination');
    assert.equal(s.create('League', 32, 'round_robin').format, 'round_robin');
    assert.equal(s.create('Large cup', 128).capacity, 128);
    for (const format of ['other', null, [], true])
      assert.throws(() => s.create('Invalid', 8, format), error => error.status === 400);
    assert.throws(() => s.create('Too large', 33, 'round_robin'), error => error.status === 400);
    const t = cup(s, 32); assert.equal(t.matches.length, 496);
  } finally { s.close(); }
});

test('legacy databases migrate without altering entrants, scores or running brackets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brackets-upgrade-')), path = join(dir, 'app.sqlite');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE tournaments(id INTEGER PRIMARY KEY,name TEXT NOT NULL,capacity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'registration',champion INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE entrants(id INTEGER PRIMARY KEY,tournament INTEGER NOT NULL REFERENCES tournaments(id),
        name TEXT COLLATE NOCASE NOT NULL,seed INTEGER NOT NULL,UNIQUE(tournament,name),UNIQUE(tournament,seed));
      CREATE TABLE matches(id INTEGER PRIMARY KEY,tournament INTEGER NOT NULL REFERENCES tournaments(id),
        round INTEGER NOT NULL,position INTEGER NOT NULL,a INTEGER REFERENCES entrants(id),b INTEGER REFERENCES entrants(id),
        winner INTEGER REFERENCES entrants(id),status TEXT NOT NULL DEFAULT 'waiting',score_a INTEGER,score_b INTEGER,
        UNIQUE(tournament,round,position));
      INSERT INTO tournaments(id,name,capacity,status) VALUES(1,'Existing cup',4,'running'),(2,'Registration',8,'registration');
      INSERT INTO entrants VALUES(10,1,'Alpha',1),(20,1,'Beta',2),(30,1,'Gamma',3);
      INSERT INTO matches VALUES(40,1,1,0,10,NULL,10,'bye',NULL,NULL),
        (50,1,1,1,20,30,20,'completed',3,1),(60,1,2,0,10,20,NULL,'ready',NULL,NULL);
    `);
    const beforeEntrants = legacy.prepare('SELECT * FROM entrants ORDER BY id').all();
    const beforeMatches = legacy.prepare('SELECT * FROM matches ORDER BY id').all();
    legacy.close();
    let s = openStore(path);
    const old = s.detail(1);
    assert.equal(old.format, 'single_elimination'); assert.equal(old.status, 'running');
    assert.deepEqual(old.entrants, beforeEntrants); assert.deepEqual(old.matches, beforeMatches);
    assert.equal(s.detail(2).format, 'single_elimination');
    assert.equal(s.result(1, 60, 2, 0).champion, 10);
    const league = cup(s, 3); s.result(league.id, league.matches[0].id, 1, 1);
    const snapshot = s.detail(league.id); s.close();
    s = openStore(path); assert.deepEqual(s.detail(league.id), snapshot); assert.equal(s.detail(1).champion, 10); s.close();
    const inspect = new DatabaseSync(path); assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 1); inspect.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('future schema versions are refused without deleting data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brackets-future-')), path = join(dir, 'app.sqlite');
  try {
    let db = new DatabaseSync(path); db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep'); PRAGMA user_version=2"); db.close();
    assert.throws(() => openStore(path), /newer/);
    db = new DatabaseSync(path); assert.equal(db.prepare('SELECT value FROM sentinel').get().value, 'keep'); db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP creates a round-robin league, records draws and exposes authenticated standings', async () => {
  const s = openStore(), token = 'round-robin-test-only-'.repeat(3), app = createApp(s, token);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, auth = true) => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: {
      ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    assert.equal((await call('/api/tournaments', { name: 'Bad format', format: 'unknown' })).status, 400);
    assert.equal((await call('/api/tournaments', { name: 'Too large', capacity: 33, format: 'round_robin' })).status, 400);
    const response = await call('/api/tournaments', { name: 'League', capacity: 5, format: 'round_robin' });
    assert.equal(response.status, 200); const t = await response.json();
    assert.equal(t.format, 'round_robin');
    for (let i = 1; i <= 3; i++) assert.equal((await call(`/api/tournaments/${t.id}/register`, { name: `P${i}` })).status, 200);
    const start = await (await call(`/api/tournaments/${t.id}/start`, {})).json();
    assert.equal(start.matches.length, 3);
    assert.equal((await call(`/api/tournaments/${t.id}/standings`, undefined, false)).status, 401);
    assert.equal((await call('/api/tournaments/999/standings')).status, 404);
    const [m, ...rest] = start.matches;
    assert.equal((await call(`/api/tournaments/${t.id}/result`, { matchId: m.id, scoreA: 1, scoreB: 1 })).status, 200);
    const partial = await (await call(`/api/tournaments/${t.id}/standings`)).json();
    assert.equal(partial.filter(row => row.points === 1).length, 2);
    for (const fixture of rest) await call(`/api/tournaments/${t.id}/result`, { matchId: fixture.id, scoreA: 0, scoreB: 0 });
    const final = await (await call(`/api/tournaments/${t.id}`)).json();
    assert.equal(final.status, 'completed'); assert.ok(final.standings.every(row => row.played === 2));
  } finally { await new Promise(resolve => app.close(resolve)); s.close(); }
});
