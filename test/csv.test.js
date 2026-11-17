import test from 'node:test';
import assert from 'node:assert/strict';
import { standingsCsv } from '../public/format.js';
const row = { rank: 1, entrant_id: 7, name: 'Team', played: 2, wins: 1, draws: 0, losses: 1, score_for: 1, score_against: 3, score_difference: -2, points: 3 };

test('CSV includes readable headers and all standing statistics', () => {
  const csv = standingsCsv([row]);
  assert.ok(csv.startsWith('"Rank","Entrant ID","Name"'));
  assert.ok(csv.includes('"1","7","Team","2","1","0","1","1","3","-2","3"\r\n'));
  assert.equal(standingsCsv([]).split('\r\n').length, 2);
});
test('CSV quotes delimiters, newlines and embedded quotes', () => {
  assert.ok(standingsCsv([{ ...row, name: 'Team, "quoted"\nname' }]).includes('"Team, ""quoted""\nname"'));
});
test('untrusted display names cannot become spreadsheet formulas', () => {
  for (const name of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(A1:A2)', '  =1+1', '\t=1+1']) {
    const csv = standingsCsv([{ ...row, name }]);
    assert.ok(csv.includes(`"'${name}"`));
  }
  assert.ok(standingsCsv([{ ...row, name: 'Normal team' }]).includes('"Normal team"'));
});
