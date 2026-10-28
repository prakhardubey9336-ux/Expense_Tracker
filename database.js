/**
 * database.js
 * ---------------------------------------------------------------------------
 * Opens (or creates) the SQLite database file and brings its schema up to date.
 *
 * SmartSpend 2.0 changed the schema a lot, so table creation is now handled by
 * a versioned migration runner (src/migrations/). On startup we simply:
 *   1. open the file,
 *   2. run any migrations that have not been applied yet,
 *   3. continue.
 *
 * Existing v1 data is preserved: migrations copy rows forward instead of
 * dropping them (see docs/MIGRATIONS.md).
 * ---------------------------------------------------------------------------
 */

const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./src/migrations');

// You can point the app at a different file by setting the SMARTSPEND_DB
// environment variable. The automated tests use this to get a clean database.
const DB_PATH = process.env.SMARTSPEND_DB
  ? path.resolve(process.env.SMARTSPEND_DB)
  : path.join(__dirname, 'expense-tracker.db');

const db = new Database(DB_PATH);

// WAL mode = better read/write performance and safer writes for a local app.
db.pragma('journal_mode = WAL');
// Enforce the UNIQUE / CHECK / FOREIGN KEY constraints we declare.
db.pragma('foreign_keys = ON');

// Bring the schema up to date (no-op once every migration has been applied).
const appliedNow = runMigrations(db, { log: !process.env.SMARTSPEND_SILENT });

module.exports = { db, DB_PATH, appliedNow };
