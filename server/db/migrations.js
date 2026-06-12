/**
 * Database migrations — create tables if not exist
 */
const MIGRATIONS = [
    {
        name: '001_create_users',
        sql: `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `,
    },
    {
        name: '002_create_favorites',
        sql: `
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                source_id TEXT NOT NULL,
                source_name TEXT,
                source_url TEXT,
                category TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(user_id, source_id)
            );
        `,
    },
    {
        name: '003_create_history',
        sql: `
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                source_id TEXT NOT NULL,
                book_name TEXT,
                book_url TEXT,
                chapter_name TEXT,
                chapter_url TEXT,
                read_at TEXT DEFAULT (datetime('now'))
            );
        `,
    },
    {
        name: '004_create_history_index',
        sql: `
            CREATE INDEX IF NOT EXISTS idx_history_user
            ON history(user_id, read_at DESC);
        `,
    },
    {
        name: '005_create_cache',
        sql: `
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                expires_at TEXT
            );
        `,
    },
];

function run(db) {
    // Track which migrations have been run
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            run_at TEXT DEFAULT (datetime('now'))
        );
    `);

    const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );

    for (const migration of MIGRATIONS) {
        if (!applied.has(migration.name)) {
            console.log(`[DB] Running migration: ${migration.name}`);
            db.exec(migration.sql);
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
        }
    }
}

module.exports = { run, MIGRATIONS };
