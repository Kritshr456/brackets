function cell(value) {
  const raw = String(value);
  // Quoting alone does not stop spreadsheet formulas in untrusted display names.
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function standingsCsv(rows) {
  const headers = ['Rank', 'Entrant ID', 'Name', 'Played', 'Wins', 'Draws', 'Losses', 'Score for', 'Score against', 'Difference', 'Points'];
  const values = rows.map(r => [r.rank, r.entrant_id, r.name, r.played, r.wins, r.draws, r.losses,
    r.score_for, r.score_against, r.score_difference, r.points]);
  return [headers, ...values].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
