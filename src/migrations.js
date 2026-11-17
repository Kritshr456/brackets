export function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('Database schema is newer than this version of brackets.');
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
        score_a INTEGER, score_b INTEGER, UNIQUE(tournament,round,position)
      );
    `);
    const columns = db.prepare('PRAGMA table_info(tournaments)').all();
    if (!columns.some(column => column.name === 'format')) {
      db.exec("ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'single_elimination'");
    }
    db.exec('PRAGMA user_version=1; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
