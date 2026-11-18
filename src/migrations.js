export function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) throw new Error('Database schema is newer than this version of brackets.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tournaments(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, capacity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'registration', champion INTEGER,
        created TEXT DEFAULT CURRENT_TIMESTAMP,
        format TEXT NOT NULL DEFAULT 'single_elimination'
      );
      CREATE TABLE IF NOT EXISTS entrants(
        id INTEGER PRIMARY KEY, tournament INTEGER NOT NULL REFERENCES tournaments(id),
        name TEXT COLLATE NOCASE NOT NULL, seed INTEGER NOT NULL,
        UNIQUE(tournament,name), UNIQUE(tournament,seed)
      );
      CREATE TABLE IF NOT EXISTS matches(
        id INTEGER PRIMARY KEY, tournament INTEGER NOT NULL REFERENCES tournaments(id),
        round INTEGER NOT NULL, position INTEGER NOT NULL,
        a INTEGER REFERENCES entrants(id), b INTEGER REFERENCES entrants(id),
        winner INTEGER REFERENCES entrants(id), status TEXT NOT NULL DEFAULT 'waiting',
        score_a INTEGER, score_b INTEGER, revision INTEGER NOT NULL DEFAULT 0, UNIQUE(tournament,round,position)
      );
    `);
    const columns = db.prepare('PRAGMA table_info(tournaments)').all();
    if (!columns.some(column => column.name === 'format')) {
      db.exec("ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'single_elimination'");
    }
    if (!db.prepare('PRAGMA table_info(matches)').all().some(column => column.name === 'revision')) {
      db.exec('ALTER TABLE matches ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS result_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tournament INTEGER NOT NULL REFERENCES tournaments(id),
        match INTEGER NOT NULL REFERENCES matches(id),
        event TEXT NOT NULL CHECK(event IN ('recorded','corrected','invalidated')),
        a INTEGER REFERENCES entrants(id), b INTEGER REFERENCES entrants(id),
        before_score_a INTEGER, before_score_b INTEGER, before_winner INTEGER REFERENCES entrants(id),
        score_a INTEGER, score_b INTEGER, winner INTEGER REFERENCES entrants(id),
        reason TEXT, source_match INTEGER NOT NULL REFERENCES matches(id),
        created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS tournament_result_events ON result_events(tournament,id);
    `);
    db.exec('PRAGMA user_version=2; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
