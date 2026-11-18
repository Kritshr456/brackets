import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.js';
import { createApp } from '../src/app.js';

function tournament(store, count = 4, format = 'single_elimination') {
  const t = store.create('Correction test', count, format);
  for (let i = 1; i <= count; i++) store.register(t.id, `Player ${i}`);
  return store.start(t.id);
}
function finish(store, t) {
  while (t.status === 'running') {
    for (const m of t.matches.filter(m => m.status === 'ready')) t = store.result(t.id, m.id, 2, 0);
  }
  return t;
}
function correction(m, scoreA, scoreB, reason = 'Corrected a score entry') {
  return { matchId: m.id, expectedScoreA: m.score_a, expectedScoreB: m.score_b, expectedRevision: m.revision, scoreA, scoreB, reason };
}

test('changing a semifinal winner reopens a completed cup and retains the unaffected match', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s)), [first, other, final] = cup.matches;
  const updated = s.correctResult(cup.id, correction(first, 0, 3));
  assert.equal(updated.status, 'running');
  assert.equal(updated.champion, null);
  assert.deepEqual(updated.invalidatedMatches, [final.id]);
  assert.deepEqual(updated.matches[1], other);
  const ready = updated.matches.at(-1);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.a, first.b);
  assert.equal(ready.b, other.winner);
  assert.equal(ready.score_a, null);
  assert.equal(ready.score_b, null);
  const history = s.resultHistory(cup.id);
  assert.equal(history.total, 5);
  assert.deepEqual(history.rows.slice(0, 2).map(e => e.event), ['invalidated', 'corrected']);
  assert.equal(history.rows[0].before_winner, final.winner);
  assert.equal(history.rows[0].before_score_a, 2);
  assert.equal(history.rows[0].source_match, first.id);
  assert.equal(history.rows[1].before_score_a, 2);
  assert.equal(history.rows[1].score_b, 3);
  const finished = s.result(cup.id, ready.id, 4, 1);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.champion, first.b);
});

test('early winner changes clear the full dependent path and preserve the other half', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s, 8)), first = cup.matches[0];
  const affected = cup.matches.filter(m => (m.round === 2 && m.position === 0) || m.round === 3);
  const updated = s.correctResult(cup.id, correction(first, 0, 1));
  assert.deepEqual(updated.invalidatedMatches, affected.map(m => m.id));
  for (const m of cup.matches.filter(m => m.id !== first.id && !affected.some(a => a.id === m.id)))
    assert.deepEqual(updated.matches.find(row => row.id === m.id), m);
  assert.equal(updated.matches.find(m => m.round === 2 && m.position === 0).status, 'ready');
  const final = updated.matches.at(-1);
  assert.equal(final.status, 'waiting');
  assert.equal(final.winner, null);
  assert.equal(final.a, null);
  assert.equal(final.b, null);
  assert.equal(finish(s, updated).status, 'completed');
});

test('a score-only correction preserves later results and the champion', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s));
  const updated = s.correctResult(cup.id, correction(cup.matches[0], 5, 1));
  assert.equal(updated.status, 'completed');
  assert.equal(updated.champion, cup.champion);
  assert.deepEqual(updated.invalidatedMatches, []);
  assert.deepEqual(updated.matches.slice(1), cup.matches.slice(1));
  assert.equal(updated.resultHistory.rows[0].event, 'corrected');
});

test('correcting a final changes the champion without clearing another match', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s, 3)), final = cup.matches.at(-1);
  const updated = s.correctResult(cup.id, correction(final, 0, 2));
  assert.equal(updated.champion, final.b);
  assert.equal(updated.status, 'completed');
  assert.deepEqual(updated.invalidatedMatches, []);
  assert.deepEqual(updated.matches.slice(0, -1), cup.matches.slice(0, -1));
});

test('completed round-robin corrections recompute tied leaders and all standings', t => {
  const s = openStore(); t.after(() => s.close());
  let league = tournament(s, 3, 'round_robin');
  for (const m of league.matches) league = s.result(league.id, m.id, 0, 0);
  const m = league.matches[0];
  const updated = s.correctResult(league.id, correction(m, 2, 0));
  assert.equal(updated.status, 'completed');
  assert.equal(updated.champion, m.a);
  assert.deepEqual(updated.leaders, [m.a]);
  assert.deepEqual(updated.invalidatedMatches, []);
  assert.ok(updated.standings.every(row => row.played === 2));
  assert.equal(updated.standings.find(row => row.entrant_id === m.a).points, 4);
  const tied = s.correctResult(league.id, correction(updated.matches[0], 0, 0));
  assert.equal(tied.champion, null);
  assert.equal(tied.leaders.length, 3);
  assert.equal(tied.resultHistory.total, 5);
});

test('invalid, stale, repeated, cross-tournament and cancelled corrections cannot mutate data', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s)), m = cup.matches[0], valid = correction(m, 0, 2);
  for (const bad of [
    { scoreA: -1 }, { scoreB: 1.5 }, { scoreA: '2' }, { scoreA: 100001 },
    { scoreA: 2, scoreB: 2 }, { reason: '' }, { reason: 'x'.repeat(401) },
    { expectedRevision: null }, { expectedRevision: -1 }, { expectedScoreA: null }, { expectedScoreB: '0' }, { expectedScoreA: 3 },
    { scoreA: 2, scoreB: 0 }, { matchId: true },
  ]) {
    const before = s.detail(cup.id);
    assert.throws(() => s.correctResult(cup.id, { ...valid, ...bad }));
    assert.deepEqual(s.detail(cup.id), before);
  }
  const other = tournament(s, 2);
  assert.throws(() => s.correctResult(other.id, valid), error => error.status === 404);
  const updated = s.correctResult(cup.id, valid);
  assert.throws(() => s.correctResult(cup.id, valid), error => error.status === 409);
  assert.deepEqual(s.detail(cup.id).matches, updated.matches);
  assert.throws(() => s.correctResult(cup.id, correction(updated.matches.at(-1), 1, 0)),
    error => error.status === 409);
  s.cancel(cup.id);
  const cancelled = s.detail(cup.id);
  assert.throws(() => s.correctResult(cup.id, correction(updated.matches[0], 2, 0)),
    error => error.status === 409);
  assert.deepEqual(s.detail(cup.id), cancelled);
});

test('correction history is paginated, tournament-scoped and survives restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'brackets-corrections-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  let s = openStore(path);
  let cup = finish(s, tournament(s, 2));
  for (let i = 0; i < 25; i++) cup = s.correctResult(cup.id, correction(cup.matches[0], i + 3, 0));
  const other = tournament(s, 2);
  const first = s.resultHistory(cup.id), second = s.resultHistory(cup.id, 2);
  assert.equal(first.total, 26);
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 6);
  assert.ok(first.rows.at(-1).id > second.rows[0].id);
  assert.equal(s.resultHistory(other.id).total, 0);
  for (const page of [0, -1, 1.5, '1', 100001]) assert.throws(() => s.resultHistory(cup.id, page));
  const snapshot = s.detail(cup.id);
  s.close();
  s = openStore(path);
  try { assert.deepEqual(s.detail(cup.id), snapshot); } finally { s.close(); }
});

test('failed dependent audit writes roll back corrections, progression and all audit rows', t => {
  const directory = mkdtempSync(join(tmpdir(), 'brackets-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite'), s = openStore(path);
  t.after(() => s.close());
  const cup = finish(s, tournament(s)), before = s.detail(cup.id);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TRIGGER reject_invalidation BEFORE INSERT ON result_events
    WHEN NEW.event='invalidated' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`);
  db.close();
  assert.throws(() => s.correctResult(cup.id, correction(cup.matches[0], 0, 3)), /audit unavailable/);
  assert.deepEqual(s.detail(cup.id), before);
});

test('version-one scores migrate intact without fabricated result history', t => {
  const directory = mkdtempSync(join(tmpdir(), 'brackets-v1-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'app.sqlite');
  let s = openStore(path);
  const cup = finish(s, tournament(s, 2));
  s.close();
  const db = new DatabaseSync(path);
  db.exec('DROP TABLE result_events; ALTER TABLE matches DROP COLUMN revision; PRAGMA user_version=1');
  db.close();
  s = openStore(path);
  try {
    const migrated = s.detail(cup.id);
    assert.deepEqual(migrated.matches.map(({ revision, ...m }) => m),
      cup.matches.map(({ revision, ...m }) => m));
    assert.equal(migrated.matches[0].revision, 0);
    assert.equal(s.resultHistory(cup.id).total, 0);
    const updated = s.correctResult(cup.id, correction(migrated.matches[0], 0, 1));
    assert.equal(updated.resultHistory.total, 1);
    assert.equal(updated.resultHistory.rows[0].event, 'corrected');
    assert.equal(updated.champion, cup.matches[0].b);
  } finally { s.close(); }
});

test('correction and result-history HTTP endpoints enforce auth, validation and stale checks', async t => {
  const s = openStore(), token = 'correction-test-only-token-'.repeat(3), app = createApp(s, token);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); s.close(); });
  const cup = finish(s, tournament(s, 2)), m = cup.matches[0];
  const base = `http://127.0.0.1:${app.address().port}/api/tournaments/${cup.id}`;
  const call = (path, body, auth = true) => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? {'Content-Type':'application/json'} : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await call('/result-history', null, false)).status, 401);
  assert.equal((await call('/correct-result', correction(m, 0, 1), false)).status, 401);
  assert.equal((await call('/correct-result', { ...correction(m, 0, 1), reason: '' })).status, 400);
  assert.equal((await call('/result-history?page=0')).status, 400);
  assert.equal((await call('/result-history?page=1e1')).status, 400);
  assert.equal((await call('/correct-result', correction(m, 0, 1))).status, 200);
  assert.equal((await call('/correct-result', correction(m, 0, 1))).status, 409);
  const response = await call('/result-history?page=1');
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.total, 2);
  assert.equal(history.rows[0].event, 'corrected');
});

test('revision checks reject an old form even when newer corrections restore its displayed scores', t => {
  const s = openStore(); t.after(() => s.close());
  const cup = finish(s, tournament(s, 2)), old = cup.matches[0];
  const first = s.correctResult(cup.id, correction(old, 3, 0));
  const restored = s.correctResult(cup.id, correction(first.matches[0], old.score_a, old.score_b));
  assert.equal(restored.matches[0].revision, old.revision + 2);
  assert.throws(() => s.correctResult(cup.id, correction(old, 4, 0)), error => error.status === 409);
  assert.deepEqual(s.detail(cup.id).matches, restored.matches);
});

test('correction and replay preserve valid feeders across seeded cups with byes', t => {
  const s = openStore(); t.after(() => s.close());
  for (const count of [...Array.from({ length: 32 }, (_, i) => i + 2), 128]) {
    const cup = finish(s, tournament(s, count)), m = cup.matches.find(match => match.status === 'completed');
    const corrected = s.correctResult(cup.id, correction(m, 0, 1));
    const replayed = finish(s, corrected);
    assert.equal(replayed.status, 'completed');
    assert.equal(replayed.champion, replayed.matches.at(-1).winner);
    assert.equal(replayed.matches.filter(match => match.status === 'completed').length, count - 1);
    for (const match of replayed.matches.filter(match => match.round > 1)) {
      const left = replayed.matches.find(child => child.round === match.round - 1 && child.position === match.position * 2);
      const right = replayed.matches.find(child => child.round === match.round - 1 && child.position === match.position * 2 + 1);
      assert.equal(match.a, left.winner);
      assert.equal(match.b, right.winner);
    }
  }
});
