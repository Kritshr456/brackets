import { HttpError, positiveId } from './http.js';

export function roundRobinSchedule(ids) {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 32)
    throw new HttpError(400, 'Round robin requires 2–32 entrants.');
  const rotation = ids.map(positiveId);
  if (new Set(rotation).size !== rotation.length)
    throw new HttpError(400, 'Entrant IDs must be unique.');
  if (rotation.length % 2) rotation.push(null);
  const schedule = [];
  for (let round = 0; round < rotation.length - 1; round++) {
    let position = 0;
    for (let index = 0; index < rotation.length / 2; index++) {
      let a = rotation[index], b = rotation[rotation.length - 1 - index];
      if (a === null || b === null) continue;
      if ((index === 0 && round % 2) || index % 2) [a, b] = [b, a];
      schedule.push({ round: round + 1, position: position++, a, b });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  return schedule;
}

export function roundRobinStandings(entrants, matches) {
  const rows = new Map(entrants.map(e => [e.id, {
    entrant_id: e.id, name: e.name, seed: e.seed,
    played: 0, wins: 0, draws: 0, losses: 0,
    score_for: 0, score_against: 0, score_difference: 0, points: 0,
  }]));
  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const a = rows.get(match.a), b = rows.get(match.b);
    a.played++; b.played++;
    a.score_for += match.score_a; a.score_against += match.score_b;
    b.score_for += match.score_b; b.score_against += match.score_a;
    if (match.score_a === match.score_b) {
      a.draws++; b.draws++; a.points++; b.points++;
    } else {
      const [winner, loser] = match.score_a > match.score_b ? [a, b] : [b, a];
      winner.wins++; winner.points += 3; loser.losses++;
    }
  }
  const sorted = [...rows.values()];
  for (const row of sorted) row.score_difference = row.score_for - row.score_against;
  sorted.sort((a, b) => b.points - a.points || b.score_difference - a.score_difference ||
    b.score_for - a.score_for || a.seed - b.seed || a.entrant_id - b.entrant_id);
  for (let index = 0; index < sorted.length; index++) {
    const previous = sorted[index - 1], row = sorted[index];
    const tied = previous && previous.points === row.points &&
      previous.score_difference === row.score_difference && previous.score_for === row.score_for;
    row.rank = tied ? previous.rank : index + 1;
  }
  return sorted;
}
