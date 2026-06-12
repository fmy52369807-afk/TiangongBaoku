/**
 * SQLite database initialization and connection
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const migrations = require('./migrations');

let db = null;

function getDb() {
    if (db) return db;

    // Ensure data directory exists
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run migrations
    migrations.run(db);

    console.log(`[DB] Connected to ${config.dbPath}`);
    return db;
}

function close() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, close };
