import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, text, positiveId } from './http.js';
import { migrate } from './migrations.js';
import { roundRobinSchedule, roundRobinStandings } from './round-robin.js';

export function seedOrder(size) {
  if (!Number.isInteger(size) || size < 2 || size > 128 || (size & (size - 1)))
    throw new HttpError(400, 'Bracket size must be a power of two between 2 and 128.');
  let order = [1, 2];
  for (let n = 4; n <= size; n *= 2) order = order.flatMap(seed => [seed, n + 1 - seed]);
  return order;
}

export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const tournament = id => {
    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(positiveId(id));
    if (!t) throw new HttpError(404, 'Tournament not found.');
    return t;
  };
  const entrants = id => db.prepare('SELECT * FROM entrants WHERE tournament=? ORDER BY seed,id').all(id);
  const matches = id => db.prepare('SELECT * FROM matches WHERE tournament=? ORDER BY round,position').all(id);
  function registration(id) {
    const t = tournament(id);
    if (t.status !== 'registration') throw new HttpError(409, 'Registration has ended.');
    return t;
  }
  function seed(value, capacity) {
    if (!Number.isInteger(value) || value < 1 || value > capacity)
      throw new HttpError(400, `Seed must be between 1 and ${capacity}.`);
  }
  function settleKnockout(id) {
    const rows = matches(id), lookup = new Map(rows.map(m => [`${m.round}:${m.position}`, m]));
    for (const m of rows) {
      if (['completed', 'bye'].includes(m.status)) continue;
      if (m.round > 1) {
        const left = lookup.get(`${m.round - 1}:${m.position * 2}`);
        const right = lookup.get(`${m.round - 1}:${m.position * 2 + 1}`);
        if (![left, right].every(child => ['completed', 'bye'].includes(child.status))) continue;
        m.a = left.winner; m.b = right.winner;
      }
      m.status = m.a && m.b ? 'ready' : 'bye';
      m.winner = m.status === 'bye' ? (m.a || m.b || null) : null;
      db.prepare('UPDATE matches SET a=?,b=?,winner=?,status=? WHERE id=?').run(m.a, m.b, m.winner, m.status, m.id);
    }
    const final = rows.at(-1);
    if (final && ['completed', 'bye'].includes(final.status))
      db.prepare("UPDATE tournaments SET status='completed',champion=? WHERE id=?").run(final.winner, id);
  }
  function settleRoundRobin(id) {
    const rows = matches(id);
    if (!rows.length || rows.some(m => m.status !== 'completed')) return;
    const standings = roundRobinStandings(entrants(id), rows);
    const leaders = standings.filter(row => row.rank === 1);
    const champion = leaders.length === 1 ? leaders[0].entrant_id : null;
    db.prepare("UPDATE tournaments SET status='completed',champion=? WHERE id=?").run(champion, id);
  }
  function resultWinner(t, m, scoreA, scoreB) {
    if (![scoreA, scoreB].every(n => Number.isInteger(n) && n >= 0 && n <= 100000))
      throw new HttpError(400, 'Scores must be integers from 0 to 100000.');
    if (scoreA === scoreB && t.format !== 'round_robin')
      throw new HttpError(400, 'Single-elimination matches cannot end in a draw.');
    return scoreA === scoreB ? null : scoreA > scoreB ? m.a : m.b;
  }
  function recordEvent(tournamentId, m, event, scoreA, scoreB, winner, reason = null, source = m.id) {
    db.prepare(`INSERT INTO result_events(tournament,match,event,a,b,before_score_a,before_score_b,
      before_winner,score_a,score_b,winner,reason,source_match) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tournamentId, m.id, event, m.a, m.b, m.score_a, m.score_b, m.winner,
        scoreA, scoreB, winner, reason, source);
  }
  function invalidateDependents(tournamentId, m, reason) {
    const invalidated = [];
    let round = m.round + 1, position = Math.floor(m.position / 2);
    const next = db.prepare('SELECT * FROM matches WHERE tournament=? AND round=? AND position=?');
    let dependent = next.get(tournamentId, round, position);
    while (dependent) {
      if (dependent.status === 'completed') {
        recordEvent(tournamentId, dependent, 'invalidated', null, null, null, reason, m.id);
        invalidated.push(dependent.id);
      }
      db.prepare(`UPDATE matches SET a=NULL,b=NULL,winner=NULL,status='waiting',
        score_a=NULL,score_b=NULL,revision=revision+1 WHERE id=?`).run(dependent.id);
      round += 1;
      position = Math.floor(position / 2);
      dependent = next.get(tournamentId, round, position);
    }
    return invalidated;
  }
  function resultHistory(id, page = 1) {
    const t = tournament(id);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new HttpError(400, 'Invalid result history page.');
    const total = db.prepare('SELECT COUNT(*) AS total FROM result_events WHERE tournament=?').get(t.id).total;
    const rows = db.prepare('SELECT * FROM result_events WHERE tournament=? ORDER BY id DESC LIMIT 20 OFFSET ?')
      .all(t.id, (page - 1) * 20);
    return { page, total, rows };
  }
  return {
    close: () => db.close(), tournament,
    detail(id) {
      const t = tournament(id), players = entrants(t.id), fixtures = matches(t.id);
      const standings = t.format === 'round_robin' ? roundRobinStandings(players, fixtures) : [];
      const leaders = standings.filter(row => row.rank === 1).map(row => row.entrant_id);
      return { ...t, entrants: players, matches: fixtures, standings, leaders, resultHistory: resultHistory(t.id) };
    },
    resultHistory,
    list: () => db.prepare('SELECT * FROM tournaments ORDER BY id DESC LIMIT 100').all(),
    create(name, capacity = 32, format = 'single_elimination') {
      name = text(name, 64);
      if (!['single_elimination', 'round_robin'].includes(format))
        throw new HttpError(400, 'Format must be single_elimination or round_robin.');
      const maximum = format === 'round_robin' ? 32 : 128;
      if (!Number.isInteger(capacity) || capacity < 2 || capacity > maximum)
        throw new HttpError(400, `Capacity must be 2–${maximum} for this format.`);
      return tournament(Number(db.prepare('INSERT INTO tournaments(name,capacity,format) VALUES(?,?,?)')
        .run(name, capacity, format).lastInsertRowid));
    },
    register(id, name, requestedSeed) {
      return tx(() => {
        const t = registration(id), all = entrants(t.id); name = text(name, 40);
        if (all.length >= t.capacity) throw new HttpError(409, 'Tournament is full.');
        if (all.some(e => e.name.toLowerCase() === name.toLowerCase()))
          throw new HttpError(409, 'Entrant name is already registered.');
        const used = new Set(all.map(e => e.seed)); let value = requestedSeed;
        if (value === undefined || value === null) { value = 1; while (used.has(value)) value++; }
        seed(value, t.capacity);
        if (used.has(value)) throw new HttpError(409, 'Seed is already assigned.');
        const entrantId = Number(db.prepare('INSERT INTO entrants(tournament,name,seed) VALUES(?,?,?)')
          .run(t.id, name, value).lastInsertRowid);
        return db.prepare('SELECT * FROM entrants WHERE id=?').get(entrantId);
      });
    },
    reseed(id, entrantId, value) {
      return tx(() => {
        const t = registration(id); seed(value, t.capacity); entrantId = positiveId(entrantId);
        if (!db.prepare('SELECT 1 FROM entrants WHERE tournament=? AND id=?').get(t.id, entrantId))
          throw new HttpError(404, 'Entrant not found.');
        if (db.prepare('SELECT 1 FROM entrants WHERE tournament=? AND seed=? AND id!=?').get(t.id, value, entrantId))
          throw new HttpError(409, 'Seed is already assigned.');
        db.prepare('UPDATE entrants SET seed=? WHERE tournament=? AND id=?').run(value, t.id, entrantId);
        return this.detail(t.id);
      });
    },
    withdraw(id, entrantId) {
      const t = registration(id);
      const changes = db.prepare('DELETE FROM entrants WHERE tournament=? AND id=?').run(t.id, positiveId(entrantId)).changes;
      if (!changes) throw new HttpError(404, 'Entrant not found.');
      return this.detail(t.id);
    },
    start(id) {
      return tx(() => {
        const t = registration(id), all = entrants(t.id);
        if (all.length < 2) throw new HttpError(409, 'At least two entrants are required.');
        const insert = db.prepare('INSERT INTO matches(tournament,round,position,a,b,status) VALUES(?,?,?,?,?,?)');
        if (t.format === 'round_robin') {
          for (const m of roundRobinSchedule(all.map(e => e.id)))
            insert.run(t.id, m.round, m.position, m.a, m.b, 'ready');
        } else {
          const size = 2 ** Math.ceil(Math.log2(all.length)), order = seedOrder(size), rounds = Math.log2(size);
          for (let round = 1; round <= rounds; round++) {
            for (let pos = 0; pos < size / (2 ** round); pos++)
              insert.run(t.id, round, pos, round === 1 ? all[order[pos * 2] - 1]?.id ?? null : null,
                round === 1 ? all[order[pos * 2 + 1] - 1]?.id ?? null : null, 'waiting');
          }
        }
        db.prepare("UPDATE tournaments SET status='running' WHERE id=?").run(t.id);
        if (t.format === 'single_elimination') settleKnockout(t.id);
        return this.detail(t.id);
      });
    },
    result(id, matchId, scoreA, scoreB) {
      return tx(() => {
        const t = tournament(id);
        if (t.status !== 'running') throw new HttpError(409, 'Tournament is not running.');
        const m = db.prepare('SELECT * FROM matches WHERE tournament=? AND id=?').get(t.id, positiveId(matchId));
        if (!m) throw new HttpError(404, 'Match not found.');
        if (m.status !== 'ready') throw new HttpError(409, 'Only ready matches can receive a result.');
        const winner = resultWinner(t, m, scoreA, scoreB);
        recordEvent(t.id, m, 'recorded', scoreA, scoreB, winner);
        db.prepare("UPDATE matches SET winner=?,score_a=?,score_b=?,status='completed',revision=revision+1 WHERE id=?")
          .run(winner, scoreA, scoreB, m.id);
        if (t.format === 'round_robin') settleRoundRobin(t.id); else settleKnockout(t.id);
        return this.detail(t.id);
      });
    },
    correctResult(id, { matchId, scoreA, scoreB, expectedScoreA, expectedScoreB, expectedRevision, reason }) {
      return tx(() => {
        const t = tournament(id);
        if (!['running', 'completed'].includes(t.status))
          throw new HttpError(409, 'Only running or completed tournaments can have results corrected.');
        const m = db.prepare('SELECT * FROM matches WHERE tournament=? AND id=?').get(t.id, positiveId(matchId));
        if (!m) throw new HttpError(404, 'Match not found.');
        if (m.status !== 'completed') throw new HttpError(409, 'Only completed matches can be corrected.');
        const winner = resultWinner(t, m, scoreA, scoreB);
        if (![expectedScoreA, expectedScoreB].every(n => Number.isInteger(n) && n >= 0 && n <= 100000))
          throw new HttpError(400, 'Supply the previously displayed scores as expectedScoreA and expectedScoreB.');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
          throw new HttpError(400, 'Supply the previously displayed expectedRevision.');
        if (m.revision !== expectedRevision || m.score_a !== expectedScoreA || m.score_b !== expectedScoreB)
          throw new HttpError(409, 'The saved result changed. Refresh before correcting it.');
        reason = text(reason, 400);
        if (m.score_a === scoreA && m.score_b === scoreB)
          throw new HttpError(409, 'The saved scores already match.');
        recordEvent(t.id, m, 'corrected', scoreA, scoreB, winner, reason);
        db.prepare('UPDATE matches SET score_a=?,score_b=?,winner=?,revision=revision+1 WHERE id=?').run(scoreA, scoreB, winner, m.id);
        const invalidatedMatches = t.format === 'single_elimination' && winner !== m.winner ?
          invalidateDependents(t.id, m, reason) : [];
        db.prepare("UPDATE tournaments SET status='running',champion=NULL WHERE id=?").run(t.id);
        if (t.format === 'round_robin') settleRoundRobin(t.id); else settleKnockout(t.id);
        return { ...this.detail(t.id), invalidatedMatches };
      });
    },
    cancel(id) {
      const t = tournament(id);
      if (!['registration', 'running'].includes(t.status)) throw new HttpError(409, 'Tournament has already ended.');
      db.prepare("UPDATE tournaments SET status='cancelled' WHERE id=?").run(t.id);
      return this.detail(t.id);
    },
  };
}
