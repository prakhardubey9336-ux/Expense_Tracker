/**
 * test/api.test.js — automated end-to-end checks for the SmartSpend API
 * ---------------------------------------------------------------------------
 * Runs against a throw-away database file, starts the real Express server on a
 * random free port, and exercises the same workflows as the manual checklist:
 * add income, add expense, edit, delete, persistence, validation, budgets,
 * filters and analytics.
 *
 * Run with:  npm test
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

// Use a temporary database so the real expense-tracker.db is never touched.
const TEST_DB = path.join(os.tmpdir(), `smartspend-test-${Date.now()}.db`);
process.env.SMARTSPEND_DB = TEST_DB;

const { start } = require('../server');

const results = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    results.push(`  ✅ ${name}`);
  } else {
    failed += 1;
    results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  results.push(`\n${title}`);
}

const MONTH = '2026-03';
const DATE_A = '2026-03-05';
const DATE_B = '2026-03-06';

async function main() {
  // -- tiny helper: boot / shut down the real server on a random free port ---
  let server = null;
  let base = null;

  async function bootServer() {
    server = start(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  }

  async function stopServer() {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  await bootServer();

  async function api(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, body: json };
  }

  // -------------------------------------------------------------------------
  section('Test 1 — Add income of ₹5,000');
  let r = await api('POST', '/transactions', {
    type: 'income',
    title: 'Monthly pocket money',
    category: 'Salary',
    amount: 5000,
    transaction_date: DATE_A,
    notes: 'March allowance',
  });
  check('POST /transactions returns 201', r.status === 201, `got ${r.status}`);
  check('Income amount stored as 5000', r.body?.data?.amount === 5000);
  const incomeId = r.body?.data?.id;

  let summary = (await api('GET', '/summary')).body.data;
  check('Total income = 5000', summary.totalIncome === 5000, `got ${summary.totalIncome}`);
  check('Total expenses = 0', summary.totalExpenses === 0);
  check('Balance = 5000', summary.balance === 5000, `got ${summary.balance}`);
  check('Savings rate = 100', summary.savingsRate === 100, `got ${summary.savingsRate}`);

  // -------------------------------------------------------------------------
  section('Test 2 — Add expense of ₹150');
  r = await api('POST', '/transactions', {
    type: 'expense',
    title: 'Lunch at canteen',
    category: 'Food',
    amount: 150,
    transaction_date: DATE_B,
  });
  check('POST expense returns 201', r.status === 201, `got ${r.status}`);
  const expenseId = r.body?.data?.id;

  summary = (await api('GET', '/summary')).body.data;
  check('Total expenses = 150', summary.totalExpenses === 150, `got ${summary.totalExpenses}`);
  check('Balance = 4850', summary.balance === 4850, `got ${summary.balance}`);
  check('Savings rate = 97', summary.savingsRate === 97, `got ${summary.savingsRate}`);

  // -------------------------------------------------------------------------
  section('Test 3 — Edit the expense from ₹150 to ₹200');
  r = await api('PUT', `/transactions/${expenseId}`, {
    type: 'expense',
    title: 'Lunch at canteen',
    category: 'Food',
    amount: 200,
    transaction_date: DATE_B,
    notes: 'Had an extra coffee',
  });
  check('PUT returns 200', r.status === 200, `got ${r.status}`);
  check('Amount updated to 200', r.body?.data?.amount === 200);
  check('Notes updated', r.body?.data?.notes === 'Had an extra coffee');

  summary = (await api('GET', '/summary')).body.data;
  check('Total expenses = 200', summary.totalExpenses === 200, `got ${summary.totalExpenses}`);
  check('Balance = 4800', summary.balance === 4800, `got ${summary.balance}`);

  // -------------------------------------------------------------------------
  section('Test 4 — Delete the expense');
  r = await api('DELETE', `/transactions/${expenseId}`);
  check('DELETE returns 200', r.status === 200, `got ${r.status}`);

  summary = (await api('GET', '/summary')).body.data;
  check('Total expenses back to 0', summary.totalExpenses === 0, `got ${summary.totalExpenses}`);
  check('Balance back to 5000', summary.balance === 5000, `got ${summary.balance}`);
  r = await api('GET', `/transactions/${expenseId}`);
  check('Deleted transaction now 404', r.status === 404, `got ${r.status}`);

  // -------------------------------------------------------------------------
  section('Test 5 — Persistence (data survives a server restart)');
  const beforeRestart = (await api('GET', '/transactions')).body.pagination.total;
  check('One transaction present before restart', beforeRestart === 1, `got ${beforeRestart}`);

  // Shut the server down, then read the same file from a *separate* process.
  await stopServer();
  const probe = execFileSync(
    process.execPath,
    [
      '-e',
      `const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});` +
        `const t=d.prepare('SELECT COUNT(*) c, SUM(amount) s FROM transactions').get();` +
        `const b=d.prepare('SELECT COUNT(*) c FROM budgets').get();` +
        `console.log(JSON.stringify({t,b}));`,
      TEST_DB,
    ],
    { encoding: 'utf8' }
  );
  const fileState = JSON.parse(probe.trim());
  check('SQLite file still holds the transaction', fileState.t.c === 1, JSON.stringify(fileState.t));
  check('SQLite file still holds the income amount', fileState.t.s === 5000, JSON.stringify(fileState.t));

  // Start the server again, exactly like stopping with Ctrl+C and running
  // `npm start` a second time.
  await bootServer();
  const afterRestart = (await api('GET', '/transactions')).body;
  check('Restarted server still returns the transaction', afterRestart.pagination.total === 1, `got ${afterRestart.pagination.total}`);
  check('Restarted server totals still correct', (await api('GET', '/summary')).body.data.balance === 5000);

  // -------------------------------------------------------------------------
  section('Test 6 — Validation rejects bad input');
  const badPayloads = [
    ['empty title', { type: 'expense', title: '   ', category: 'Food', amount: 10, transaction_date: DATE_A }, 'title'],
    ['zero amount', { type: 'expense', title: 'Zero', category: 'Food', amount: 0, transaction_date: DATE_A }, 'amount'],
    ['negative amount', { type: 'expense', title: 'Negative', category: 'Food', amount: -50, transaction_date: DATE_A }, 'amount'],
    ['invalid date', { type: 'expense', title: 'Bad date', category: 'Food', amount: 10, transaction_date: '2026-02-31' }, 'transaction_date'],
    ['bad date format', { type: 'expense', title: 'Bad format', category: 'Food', amount: 10, transaction_date: '06/03/2026' }, 'transaction_date'],
    ['invalid category', { type: 'expense', title: 'Bad cat', category: 'Crypto', amount: 10, transaction_date: DATE_A }, 'category'],
    ['invalid type', { type: 'transfer', title: 'Bad type', category: 'Food', amount: 10, transaction_date: DATE_A }, 'type'],
    ['amount not a number', { type: 'expense', title: 'Text amount', category: 'Food', amount: 'abc', transaction_date: DATE_A }, 'amount'],
  ];
  for (const [label, payload, field] of badPayloads) {
    const res = await api('POST', '/transactions', payload);
    check(
      `Rejects ${label} with 400 + field message`,
      res.status === 400 && Boolean(res.body?.error?.fields?.[field]),
      `status ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  r = await api('GET', '/transactions/abc');
  check('Non-numeric id returns 400', r.status === 400, `got ${r.status}`);
  r = await api('GET', '/transactions/999999');
  check('Unknown id returns 404', r.status === 404, `got ${r.status}`);
  r = await api('POST', '/transactions', { type: 'expense', title: 'X'.repeat(150), category: 'Food', amount: 5, transaction_date: DATE_A });
  check('Rejects over-long title', r.status === 400, `got ${r.status}`);
  r = await api('GET', '/budgets?month=2026-13');
  check('Rejects invalid month', r.status === 400, `got ${r.status}`);
  r = await api('PUT', '/budgets', { month: MONTH, amount: -10 });
  check('Rejects negative budget', r.status === 400, `got ${r.status}`);

  // -------------------------------------------------------------------------
  section('Test 7 — Monthly budget of ₹1,000 with a ₹150 expense');
  r = await api('PUT', '/budgets', { month: MONTH, amount: 1000 });
  check('Budget saved', r.status === 200 && r.body?.data?.amount === 1000, `got ${r.status}`);

  await api('POST', '/transactions', {
    type: 'expense',
    title: 'Bus fare',
    category: 'Travel',
    amount: 150,
    transaction_date: DATE_A,
  });

  let budget = (await api('GET', `/budgets?month=${MONTH}`)).body.data;
  check('Spent for month = 150', budget.spent === 150, `got ${budget.spent}`);
  check('Percent used = 15', budget.percentUsed === 15, `got ${budget.percentUsed}`);
  check('Remaining = 850', budget.remaining === 850, `got ${budget.remaining}`);
  check('Not marked exceeded', budget.exceeded === false);

  // A second month must keep its own separate budget.
  await api('PUT', '/budgets', { month: '2026-04', amount: 3000 });
  const april = (await api('GET', '/budgets?month=2026-04')).body.data;
  check('April budget stored separately (3000)', april.amount === 3000, `got ${april.amount}`);
  check('April spent = 0', april.spent === 0);

  // Overspend detection
  await api('POST', '/transactions', {
    type: 'expense',
    title: 'Book',
    category: 'Education',
    amount: 900,
    transaction_date: DATE_B,
  });
  budget = (await api('GET', `/budgets?month=${MONTH}`)).body.data;
  check('Budget now exceeded', budget.exceeded === true, `spent ${budget.spent}`);
  check('Remaining is negative when exceeded', budget.remaining === -50, `got ${budget.remaining}`);

  // -------------------------------------------------------------------------
  section('Test 8 — Filters, analytics and insights');
  // Extra data in another month + a different category for filter tests.
  await api('POST', '/transactions', {
    type: 'expense',
    title: 'Movie night',
    category: 'Entertainment',
    amount: 400,
    transaction_date: '2026-04-02',
  });
  await api('POST', '/transactions', {
    type: 'income',
    title: 'Freelance logo project',
    category: 'Freelance',
    amount: 2500,
    transaction_date: '2026-04-10',
    notes: 'Client: ABC Studio',
  });

  let list = (await api('GET', '/transactions')).body.data;
  check('Newest-first ordering', list[0].transaction_date >= list[list.length - 1].transaction_date);

  const searchNotes = (await api('GET', '/transactions?search=ABC%20Studio')).body;
  check('Search matches notes', searchNotes.pagination.total === 1 && searchNotes.data[0].category === 'Freelance');

  const searchTitle = (await api('GET', '/transactions?search=bus')).body;
  check('Search matches title (case-insensitive)', searchTitle.pagination.total === 1, `got ${searchTitle.pagination.total}`);

  const catFilter = (await api('GET', '/transactions?category=Travel')).body;
  check('Category filter returns only Travel', catFilter.data.every((t) => t.category === 'Travel') && catFilter.pagination.total === 1);

  const monthFilter = (await api('GET', `/transactions?month=${MONTH}`)).body;
  check('Month filter returns March records', monthFilter.data.every((t) => t.transaction_date.startsWith(MONTH)) && monthFilter.pagination.total === 3, `got ${monthFilter.pagination.total}`);

  const typeFilter = (await api('GET', '/transactions?type=income')).body;
  check('Type filter returns only income', typeFilter.data.every((t) => t.type === 'income') && typeFilter.pagination.total === 2);

  const dateRange = (await api('GET', '/transactions?from=2026-04-01&to=2026-04-30')).body;
  check('Date-range filter works', dateRange.pagination.total === 2, `got ${dateRange.pagination.total}`);

  const paginated = (await api('GET', '/transactions?limit=2&offset=0')).body;
  check('Pagination limit works', paginated.data.length === 2 && paginated.pagination.total === 5);

  const cats = (await api('GET', `/analytics/categories?month=${MONTH}`)).body.data;
  check('Category analytics total = 1050', cats.total === 1050, `got ${cats.total}`);
  check('Education is top March category', cats.categories[0].category === 'Education', JSON.stringify(cats.categories[0]));
  check('Category percentages present', cats.categories[0].percent === Math.round((900 / 1050) * 1000) / 10, JSON.stringify(cats.categories[0]));

  const monthly = (await api('GET', '/analytics/monthly?months=6')).body.data;
  check('Monthly series returns 6 buckets', monthly.length === 6, `got ${monthly.length}`);
  const march = monthly.find((m) => m.month === MONTH);
  check('March income = 5000', march.income === 5000, JSON.stringify(march));
  check('March expense = 1050', march.expense === 1050, JSON.stringify(march));
  const apr = monthly.find((m) => m.month === '2026-04');
  check('April income = 2500', apr.income === 2500, JSON.stringify(apr));
  check('April expense = 400', apr.expense === 400, JSON.stringify(apr));

  const marchInsights = (await api('GET', `/analytics/insights?month=${MONTH}`)).body.data.insights;
  const ids = marchInsights.map((i) => i.id);
  check('Insight: highest category is Education', ids.includes('top-category') && marchInsights.find((i) => i.id === 'top-category').title.includes('Education'), ids.join(','));
  check('Insight: budget usage 105%', ids.includes('budget-exceeded'), ids.join(','));
  check('Insight: expenses exceed income not shown (income > expense)', !ids.includes('expenses-exceed-income'));
  check('Insight: income exceeds expenses shown', ids.includes('income-exceeds-expenses'), ids.join(','));

  const emptyInsights = (await api('GET', '/analytics/insights?month=2020-01')).body.data.insights;
  check('Insight: empty month says no entries', emptyInsights.some((i) => i.id === 'no-transactions'), emptyInsights.map((i) => i.id).join(','));

  const emptyCats = (await api('GET', '/analytics/categories?month=2020-01')).body.data;
  check('Empty month categories total = 0', emptyCats.total === 0 && emptyCats.categories.length === 0);

  // -------------------------------------------------------------------------
  section('Security / robustness checks');
  const evil = `Robert'); DROP TABLE transactions;--`;
  r = await api('POST', '/transactions', {
    type: 'expense',
    title: evil,
    category: 'Other',
    amount: 10,
    transaction_date: DATE_A,
  });
  check('SQL-injection style title is stored as plain text', r.status === 201 && r.body.data.title === evil);
  const stillThere = (await api('GET', '/transactions')).body.pagination.total;
  check('transactions table still exists', stillThere === 6, `got ${stillThere}`);

  r = await api('GET', '/nope');
  check('Unknown API route returns JSON 404', r.status === 404 && Boolean(r.body?.error?.message));
  const badJson = await fetch(base + '/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  const badJsonBody = await badJson.json();
  check('Malformed JSON returns 400 with clean message', badJson.status === 400 && !/at Object|node:internal/.test(JSON.stringify(badJsonBody)));

  const budgetList = (await api('GET', '/budgets')).body.data;
  check('Budget history endpoint returns saved months', budgetList.length === 2, `got ${budgetList.length}`);

  // PATCH (partial update) keeps the other fields intact.
  const patchTarget = (await api('GET', '/transactions?limit=1')).body.data[0];
  r = await api('PATCH', `/transactions/${patchTarget.id}`, { notes: 'patched through PATCH' });
  check('PATCH updates only the sent field', r.status === 200 && r.body.data.notes === 'patched through PATCH' && r.body.data.title === patchTarget.title, JSON.stringify(r.body?.data));
  r = await api('PATCH', `/transactions/${patchTarget.id}`, { amount: -5 });
  check('PATCH still validates', r.status === 400, `got ${r.status}`);

  // Budget removal
  r = await api('PUT', '/budgets', { month: '2026-05', amount: 500 });
  check('Temporary budget created for delete test', r.status === 200);
  r = await api('DELETE', '/budgets?month=2026-05');
  check('DELETE /budgets removes the month', r.status === 200 && r.body.data.isSet === false);
  r = await api('DELETE', '/budgets?month=2026-05');
  check('Deleting a missing budget returns 404', r.status === 404, `got ${r.status}`);
  check('Budget history back to 2 months', (await api('GET', '/budgets')).body.data.length === 2);

  // Cleanup: remove the injected row so the persistence numbers stay readable.
  await api('DELETE', `/transactions/${r.body?.data?.id ?? 0}`).catch(() => {});

  // -------------------------------------------------------------------------
  await stopServer();

  console.log(results.join('\n'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total checks`);
  console.log('='.repeat(60));

  // Remove the temporary database files.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(results.join('\n'));
  console.error('\nTest run crashed:', err);
  process.exit(1);
});
