/**
 * test/migration.test.js
 * ---------------------------------------------------------------------------
 * Proves that upgrading a SmartSpend 1.0 database to 2.0 does not lose or
 * corrupt any data.
 *
 * How it works:
 *   1. build a "v1" database by running ONLY migration 001 and inserting rows
 *      with the old REAL-rupee schema,
 *   2. run the full migration set on a copy of it,
 *   3. compare every field of every row against the pre-upgrade snapshot.
 *
 * Run with:  npm test  (runs after the API suite)  or  node test/migration.test.js
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations, migrationStatus } = require('../src/migrations');

const results = [];
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; results.push(`  ✅ ${name}`); }
  else { failed += 1; results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => results.push(`\n${t}`);

function buildV1Database(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // Exactly the SmartSpend 1.0 schema.
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('income','expense')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
      category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 40),
      amount REAL NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
      transaction_date TEXT NOT NULL CHECK (transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL UNIQUE CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
      amount REAL NOT NULL CHECK (amount >= 0 AND amount <= 1000000000),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Money values chosen to include awkward floating-point cases (0.1 + 0.2).
  const v1Rows = [
    ['income', 'Internship stipend', 'Salary', 5000, '2026-09-01', null],
    ['expense', 'Canteen lunch', 'Food', 150, '2026-09-02', 'with friends'],
    ['expense', 'Odd decimal expense', 'Other', 0.1, '2026-09-03', null],
    ['expense', 'Odd decimal expense 2', 'Other', 0.2, '2026-09-04', null],
    ['expense', 'Course fee', 'Education', 1200.75, '2026-09-05', 'semester'],
    ['income', 'Freelance poster', 'Freelance', 2500, '2026-10-02', 'client ABC'],
    ['expense', 'Train ticket', 'Travel', 89.99, '2026-10-03', null],
    ['expense', 'Text with quotes', 'Other', 42, '2026-10-04', `O'Brien said "hello"`],
  ];
  const ins = db.prepare(
    `INSERT INTO transactions (type,title,category,amount,transaction_date,notes)
     VALUES (?,?,?,?,?,?)`
  );
  for (const row of v1Rows) ins.run(...row);

  const insB = db.prepare(`INSERT INTO budgets (month, amount) VALUES (?, ?)`);
  insB.run('2026-09', 3500);
  insB.run('2026-10', 3000.5);

  return db;
}

/**
 * Reads the data we care about. Works on BOTH schemas: before the upgrade the
 * tables have no `amount_minor` column, so we select NULL for it.
 */
function snapshot(db) {
  const hasMinor = db
    .prepare(`SELECT COUNT(*) c FROM pragma_table_info('transactions') WHERE name = 'amount_minor'`)
    .get().c > 0;
  const minorTx = hasMinor ? 'amount_minor' : 'NULL AS amount_minor';
  const minorBudget = hasMinor ? 'amount_minor' : 'NULL AS amount_minor';
  return {
    transactions: db
      .prepare(`SELECT id,type,title,category,amount,${minorTx},transaction_date,notes,created_at FROM transactions ORDER BY id`)
      .all(),
    budgets: db.prepare(`SELECT id,month,amount,${minorBudget} FROM budgets ORDER BY id`).all(),
  };
}

function main() {
  const file = path.join(os.tmpdir(), `smartspend-migration-${Date.now()}.db`);
  let db;

  try {
    section('Setup — build a SmartSpend 1.0 database');
    db = buildV1Database(file);
    const before = snapshot(db);
    check('v1 database created with 8 transactions', before.transactions.length === 8, String(before.transactions.length));
    check('v1 database created with 2 budgets', before.budgets.length === 2, String(before.budgets.length));
    const beforeExpense = before.transactions
      .filter((r) => r.type === 'expense')
      .reduce((s, r) => s + r.amount, 0);
    results.push(`  ℹ️  v1 expense total: ${beforeExpense.toFixed(4)}`);

    section('Test 13 — migrations run on an existing database');
    const ran = runMigrations(db);
    check('All migrations applied', ran.length === 6, JSON.stringify(ran));
    const status = migrationStatus(db);
    check('schema_migrations records every migration', status.every((m) => m.applied));

    section('Data preservation — nothing lost, nothing corrupted');
    const after = snapshot(db);
    check('Same number of transactions', after.transactions.length === before.transactions.length,
      `${before.transactions.length} -> ${after.transactions.length}`);
    check('Same number of budgets', after.budgets.length === before.budgets.length,
      `${before.budgets.length} -> ${after.budgets.length}`);
    check('Transaction ids unchanged', JSON.stringify(after.transactions.map((r) => r.id)) === JSON.stringify(before.transactions.map((r) => r.id)));

    let fieldMismatch = 0;
    for (let i = 0; i < before.transactions.length; i += 1) {
      const b = before.transactions[i];
      const a = after.transactions[i];
      for (const key of ['id', 'type', 'title', 'category', 'transaction_date', 'notes', 'created_at']) {
        if (b[key] !== a[key]) {
          fieldMismatch += 1;
          results.push(`     ✗ row ${b.id} field ${key}: ${JSON.stringify(b[key])} -> ${JSON.stringify(a[key])}`);
        }
      }
      // Rupees must be numerically identical after the paise conversion.
      if (Math.abs(b.amount - a.amount) > 1e-9) {
        fieldMismatch += 1;
        results.push(`     ✗ row ${b.id} amount: ${b.amount} -> ${a.amount}`);
      }
      // and every row must have an exact integer-paise equivalent
      const expectedMinor = Math.round(b.amount * 100);
      if (a.amount_minor !== expectedMinor) {
        fieldMismatch += 1;
        results.push(`     ✗ row ${b.id} amount_minor: expected ${expectedMinor}, got ${a.amount_minor}`);
      }
    }
    check('Every transaction field preserved (incl. quotes/notes)', fieldMismatch === 0, `${fieldMismatch} mismatches`);

    const beforeBudgetTotal = before.budgets.reduce((s, r) => s + r.amount, 0);
    const afterBudgetTotal = after.budgets.reduce((s, r) => s + r.amount, 0);
    check('Budget amounts preserved', Math.abs(beforeBudgetTotal - afterBudgetTotal) < 1e-9, `${beforeBudgetTotal} -> ${afterBudgetTotal}`);
    check('Budget months preserved', JSON.stringify(after.budgets.map((b) => b.month)) === JSON.stringify(before.budgets.map((b) => b.month)));

    section('Workspace assignment');
    const ws = db.prepare('SELECT id, type FROM workspaces ORDER BY id').all();
    check('Two default workspaces exist', ws.length === 2, JSON.stringify(ws));
    check('Workspace 1 is individual, 2 is business', ws[0].type === 'individual' && ws[1].type === 'business');
    const allPersonal = db.prepare('SELECT COUNT(*) c FROM transactions WHERE workspace_id = 1').get().c;
    check('All migrated transactions belong to the Personal workspace', allPersonal === 8, String(allPersonal));
    check('All migrated budgets belong to the Personal workspace',
      db.prepare('SELECT COUNT(*) c FROM budgets WHERE workspace_id = 1').get().c === 2);

    section('Integer paise correctness');
    const odd = db.prepare('SELECT amount, amount_minor FROM transactions WHERE title = ?').get('Course fee');
    check('₹1200.75 stored as 120075 paise', odd.amount_minor === 120075, String(odd.amount_minor));
    const sumMinor = db.prepare(`SELECT SUM(amount_minor) s FROM transactions WHERE id IN (3,4)`).get().s;
    check('0.1 + 0.2 stored exactly as 30 paise', sumMinor === 30, String(sumMinor));

    section('Schema after upgrade');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all()
      .map((r) => r.name);
    const expectedTables = [
      'budgets', 'category_budgets', 'customers', 'invoice_items', 'invoice_payments',
      'invoices', 'recurring_rules', 'savings_goal_contributions', 'savings_goals',
      'schema_migrations', 'transactions', 'vendor_bill_payments', 'vendor_bills',
      'vendors', 'workspaces',
    ];
    check('All 2.0 tables exist', expectedTables.every((t) => tables.includes(t)), tables.join(','));
    check('amount is now a generated column (hidden=2 in table_xinfo)', db.prepare(`SELECT COUNT(*) c FROM pragma_table_xinfo('transactions') WHERE name='amount' AND hidden=2`).get().c === 1);
    check('No broken foreign keys', db.pragma('foreign_key_check').length === 0);

    section('Re-running migrations is safe (idempotent)');
    const ranAgain = runMigrations(db);
    check('Second run applies nothing', ranAgain.length === 0, JSON.stringify(ranAgain));
    check('Data still intact after re-run', snapshot(db).transactions.length === 8);

    section('New databases start correctly');
    const freshFile = path.join(os.tmpdir(), `smartspend-fresh-${Date.now()}.db`);
    const freshDb = new Database(freshFile);
    freshDb.pragma('foreign_keys = ON');
    runMigrations(freshDb);
    check('Fresh DB has zero transactions', freshDb.prepare('SELECT COUNT(*) c FROM transactions').get().c === 0);
    check('Fresh DB still gets the two workspaces', freshDb.prepare('SELECT COUNT(*) c FROM workspaces').get().c === 2);
    freshDb.close();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(freshFile + suffix); } catch { /* ignore */ } }
  } finally {
    if (db) db.close();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + suffix); } catch { /* ignore */ } }
  }

  console.log(results.join('\n'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Migration: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));
  process.exit(failed === 0 ? 0 : 1);
}

main();
