# SmartSpend — Viva Preparation

Short, confident answers to the questions an examiner is most likely to ask.
Each answer is 1–4 sentences — long enough to be correct, short enough to remember.
Code references point to the exact file so you can show it on screen.

**Sections A–G cover the 1.0 personal application. Sections H–L cover version 2.0** (Individual and
Business modes) — workspaces, invoices, derived statuses, cash flow, migrations and money in paise.
If the examiner only has five minutes, memorise **H1, H3, I1, I5, J1 and L1**.

---

## A. Project basics

**1. What is your project?**
SmartSpend is a personal **and** business finance tracker. In Individual mode it records income and
expenses in SQLite and shows them as a live dashboard with cards, charts, a monthly budget, savings
goals, recurring expenses and insights. In Business mode it adds customers, vendors, invoices with
part payments, vendor bills, cash flow and an estimated tax report — with the two books kept
strictly separate.
`README.md` · `public/index.html`

**2. Why did you choose this topic?**
It is a real daily problem for students, and it maps neatly onto the syllabus: full CRUD, REST
API design, database schema design and aggregation queries, plus client-side validation and data
visualisation.

**3. What are the three layers of your architecture?**
Presentation (HTML/CSS/vanilla JS in the browser), application (Node.js + Express REST API) and
data (SQLite file accessed through `better-sqlite3`). The browser never touches the database
directly — it only calls the API.

**4. How does data travel from the form to the database?**
The form is validated in the browser, sent as JSON with `fetch('POST /api/transactions')`,
re-validated on the server in `src/validation.js`, inserted using a prepared statement in
`src/repositories/transactions.js`, and the response is used to refresh the cards and charts.

**5. What are your tech-stack choices and why?**
Node.js + Express because it is one language on both ends; SQLite because it needs no server and
is a single file; Chart.js because it is small and offline-friendly; plain HTML/CSS/JS because
the brief requires it and frameworks would hide the fundamentals.

**6. Which endpoints does your API have?**
Personal: `/api/meta`, `/api/health`, `/api/workspaces`, `/api/system/migrations`,
`/api/transactions` (GET, POST), `/api/transactions/:id` (GET, PUT, PATCH, DELETE), `/api/summary`,
`/api/budgets` (GET, PUT, DELETE), `/api/analytics/monthly`, `/api/analytics/categories`,
`/api/analytics/insights`, `/api/savings-goals`, `/api/recurring`, `/api/category-budgets`,
`/api/reports/monthly-summary`, `/api/reports/tax`, `/api/export/monthly-summary.csv`.
Business, under `/api/business`: `dashboard`, `cash-flow`, `reports/tax`,
`reports/payment-methods`, `customers` (+ `:id/archive`), `vendors` (+ `:id/archive`),
`invoices` (+ `next-number`, `:id/publish`, `:id/cancel`, `:id/payments`),
`bills` (+ `:id/cancel`, `:id/payments`), and four CSV exports.
The full reference with every status code is in `docs/API.md`.

---

## B. Database

**7. Explain your database schema.**
Fifteen tables now. At the centre is `workspaces` (one row per finance book). `transactions` stores
one row per money movement — `workspace_id, type, title, category, amount_minor,
transaction_date, notes` plus business fields (payment method, customer, vendor, invoice, tax rate).
Around it: `budgets` and `category_budgets`, `savings_goals` + `savings_goal_contributions`,
`recurring_rules`, `customers`, `vendors`, `invoices` + `invoice_items` + `invoice_payments`,
`vendor_bills` + `vendor_bill_payments`, and `schema_migrations`.
`database.js` · `src/migrations/*` · `README.md` §8

**8. Why SQLite and not MySQL?**
SQLite is serverless — the whole database is one file inside the project, created automatically
on first run. That means no XAMPP, no user/password, nothing to configure, which is perfect for a
local single-user project. MySQL would add installation and configuration overhead with no
benefit at this scale.

**9. Why does `budgets.month` have a UNIQUE constraint?**
So a month can never have two budgets for the same book. In 2.0 the constraint became
`UNIQUE(workspace_id, month)`, because the personal book and the business book may both budget
October 2026 — the original global `UNIQUE(month)` would have made the second save overwrite the
first, which is exactly the kind of cross-mode leak the brief forbids. Saving still uses an upsert:
`ON CONFLICT(workspace_id, month) DO UPDATE`.

**10. Why is there no foreign key between the tables?**
A budget belongs to a *month*, not to a particular transaction. The relationship is logical: the
month part of `transaction_date` (`substr(transaction_date,1,7)`) links them. So budget spending
is always calculated live from transactions and can never go out of sync.

**11. Why store the date as TEXT instead of a DATE type?**
In `YYYY-MM-DD` form, alphabetical order equals chronological order, so `ORDER BY
transaction_date DESC` sorts correctly with no conversion, and `substr(...,1,7)` gives the month
for grouping. It also avoids time-zone shifting where `2026-10-06` could become October 5th.

**12. What indexes did you create and why?**
`idx_transactions_date` (the list is always sorted by date), plus `idx_transactions_category` and
`idx_transactions_type` (used by filters). Indexes speed up lookups at the cost of a little
storage on insert.

**13. Why do you use `CHECK` constraints when you already validate in the API?**
Defence in depth. API validation protects the application; constraints protect the *data* — even
a manual SQL insert cannot create a negative amount or an invalid type. Each layer should be
safe on its own.

**14. How is the database created and upgraded?**
`database.js` opens `expense-tracker.db` (creating the file if absent), turns on WAL and foreign
keys, then runs the migration runner: it reads `schema_migrations`, applies every migration file
whose id is not recorded yet, in order, each inside its own transaction. A brand-new file simply
runs all six; an existing 1.0 file runs only the ones it is missing. Nothing is ever dropped.

**15. What is `AUTOINCREMENT` doing?**
It guarantees a monotonically increasing, never-reused integer primary key, so a deleted row's id
is not handed out again. Ids are used in URLs (`/api/transactions/:id`).

**16. Where do you use database transactions?**
Wherever one user action writes more than one row: creating an invoice (invoice + its line items),
recording a payment (payment row + recomputed document), recording a bill payment, generating
recurring entries, and the demo seed scripts. `better-sqlite3`'s `db.transaction(fn)` wraps them in
`BEGIN`/`COMMIT` with automatic rollback, so a failure can never leave an invoice without items or
two documents pointing at a payment that does not exist.

---

## C. Security

**17. How do you prevent SQL injection?**
Every query is a prepared statement with bound parameters — `db.prepare('… WHERE id = ?')` or
named parameters like `@title`. User text is passed separately as data and is never concatenated
into the SQL string. `src/repositories/transactions.js`
*Demo trick:* a test inserts the title `Robert'); DROP TABLE transactions;--`; it is stored as
literal text and the table still exists.

**18. What is the difference between the placeholders `?` and `@name`?**
`?` is positional (order matters); `@name` is named (order does not matter and the same value can
be reused). I use named parameters where a query has several optional filters.

**19. How do you prevent XSS?**
No user text is ever put into `innerHTML`. All database values go into the DOM through
`textContent` via the `el()` helper. `innerHTML` is used only for hard-coded SVG icon markup that
never contains user data. `public/app.js` §1

**20. Where is validation performed and what is validated?**
Both sides. Browser: required title, amount > 0, chosen category, valid date, notes length
(`validateTransactionForm`). Server (the real gatekeeper, `src/validation.js`): type in
income/expense, trimmed title 1–100 chars, category from the allow-list, finite amount
0 < amount ≤ 1e9, real calendar date in `YYYY-MM-DD` (rejects `2026-02-31`), notes ≤ 500, month
`YYYY-MM`, positive integer id.

**21. How do you stop stack traces leaking to the browser?**
The central error handler in `server.js` (4 arguments) converts known `ApiError`s into clean JSON
with the right status code, and for anything unexpected logs the details in the terminal but
returns only `{ error: { message: "Something went wrong on the server." } }`.

**22. Why is there no login?**
It is a local, single-user application — the OS account is the boundary. In 2.0 the mode switcher
looks a little like a login, so the UI and the README say plainly that it is a **local profile
selection, not authentication**: both books live in the same unencrypted file and anyone who can
open the app can switch between them. Adding authentication half-way would create a false sense of
security, which is worse than being explicit about the scope. Sessions are the first item on the
future-scope list.

**23. Is this production ready?**
No, and I say so in the README. The database file is unencrypted, there is no authentication,
and money is stored as `REAL`. For real financial data you would need hashed logins, per-user
rows, integer paise storage, HTTPS and backups.

---

## D. Calculations and logic

**24. How is the savings rate calculated?**
`((TotalIncome − TotalExpenses) / TotalIncome) × 100`, computed only when `TotalIncome > 0`;
otherwise it is 0. That conditional is the division-by-zero guard.
`src/repositories/analytics.js` → `getSummary()`

**25. What happens when expenses exceed income?**
Balance becomes negative, the balance card turns red, and the insights engine emits "Your
expenses exceed your income this month" — a message that is only generated when the data
supports it.

**26. How is budget usage calculated, and what if no budget is set?**
`(monthExpenses / budgetAmount) × 100`, and `remaining = budget − monthExpenses`. If no budget
is set, `percentUsed` is returned as `null`, the UI shows an empty state with a "Set a budget"
link instead of dividing by zero.
`src/repositories/budgets.js` → `withUsage()`

**27. When does the progress bar change colour?**
Under 75% → teal; 75% or more → amber; over 100% → red (and the caption says "Over budget by
₹…"). The colours come from CSS classes `state-safe` / `state-warn` / `state-over`.

**28. Are the totals ever hardcoded?**
No. Every figure comes from a `SUM()`/`COUNT()`/`GROUP BY` query over the SQLite tables. There is
no sample data in the shipped database; the optional `scripts/seed-demo.js` exists only for
presentations.

**29. How are the insights generated?**
A rule engine: `getInsights(month)` computes the month summary, the budget row and the all-time
totals, then pushes messages only for conditions that are actually true (highest category,
budget percentage, overspend, income vs expense, empty month, savings rate). Each insight has a
tone (`success` / `warning` / `danger` / `info`) used for colour.

**30. How does the app handle a month with no data?**
Charts show a friendly "No expenses this month" panel instead of an empty canvas, tables show an
empty state with a call to action, and the insight list says there are no entries for that month.

---

## E. Frontend

**31. How does the frontend talk to the backend?**
One small wrapper, `api(path, {method, body})` in `public/app.js`, around `fetch()`. It sets the
`Content-Type: application/json` header, parses the JSON response, and throws an `Error` carrying
`status` and per-field `fields` so the form can highlight the exact inputs the server rejected.

**32. How are the charts updated after an edit?**
After any successful write, `refreshAll()` re-fetches summary, categories, monthly series,
insights and budget, then re-renders. Chart.js instances are stored in `state.charts` and updated
with `chart.data.… = …; chart.update()` instead of being recreated, which avoids flicker and
memory leaks.

**33. Do the charts need internet?**
No. Chart.js 4.4.6 is bundled at `public/assets/vendor/chart.umd.min.js`. There is a CDN fallback
in `index.html` that loads it only if the local file is missing; if neither is available the app
shows "Charts unavailable" while tables and totals keep working.

**34. What is the dark-mode implementation?**
The `data-theme="dark"` attribute on `<html>` switches one set of CSS custom properties
(colours, shadows) in `style.css`. Components never hardcode colours, so nothing else changes.
The choice is saved in `localStorage` and defaults to the OS preference
(`prefers-color-scheme`).

**35. How is the layout responsive?**
CSS Grid for the page shell and card grids, with three breakpoints: ≤1180px stacks the analytics
grids and switches stat cards to 2 columns; ≤960px turns the sidebar into an off-canvas drawer
with a hamburger button and scrim; ≤720px stacks filters/fields and converts the transaction
table into stacked cards using `data-label` pseudo-elements.

**36. How is accessibility handled?**
Every input has a linked `<label>`; required fields are marked; focus rings are always visible
(`:focus-visible`); the add/edit form is a native `<dialog>` (focus trap + Esc); toasts use
`aria-live`; progress bars expose `role="progressbar"` with `aria-valuenow`; there is a skip link
and `prefers-reduced-motion` support.

**37. What is a single-page application here — did you use a router?**
Five `<section>` views are toggled by `switchView()`, and the current view is reflected in the URL
hash (`#transactions`) using `history.replaceState`, so a refresh keeps you where you were. No
routing library is needed for five views.

**38. How do you prevent double form submissions?**
A `state.busy` flag plus disabling the submit button and changing its label to "Saving…" until
the request settles.

---

## F. Testing and debugging

**39. How did you test the project?**
Four ways. `npm test` runs three suites against a real server and a temporary database —
**79** personal API assertions (including a genuine server restart for persistence), **138**
business and acceptance assertions, and **23** migration-safety assertions: **240 checks, 0
failures**. Then an automated headless-Chromium pass over the UI (74 checks, zero console or page
errors), and a hand-runnable script with 30 user steps plus 7 `curl` guard checks in
`docs/TEST_STEPS.md`. `docs/ACCEPTANCE.md` maps every one of the 15 acceptance criteria to the
checks that prove it.

**40. How do you prove persistence?**
The automated test stops the server, reads the same `.db` file from a separate Node process with
`better-sqlite3` (read-only), asserts the row and amount are still there, then restarts the server
and checks the API returns the same data again.

**41. Tell me a bug you fixed.**
`/api/meta` returns its object directly, but the frontend destructured `{ data }` from it, so
`data` was undefined, boot aborted, and the "Add Transaction" button appeared to do nothing. I
fixed the contract mismatch and added a defensive fallback so the form still works if the meta
request fails.

**42. How would you debug an empty dashboard?**
In order: is the Node process running (terminal open)? Look at the terminal request log for the
`/api/*` calls and their status codes; in DevTools → Network check the JSON response; in the
Console look for JS errors; then inspect the SQLite table with the SQLite Viewer extension.

---

## G. Tricky / follow-up questions

**43. Two people open the app at once — what happens?**
SQLite serialises writes; with WAL mode reads continue during a write. For a local single-user
project this is plenty. A multi-user deployment would need a client-server database and
authentication.

**44. What if someone edits the database file directly?**
The API will happily read the new rows. Constraints still prevent invalid amounts or types, but
values that break application rules (for example a category outside the allow-list) would show up
in the UI — which is why category validation also exists in the API for all writes it performs.

**45. Why not use `localStorage` instead of a database?**
`localStorage` is per-browser, size-limited, has no query language, no constraints, no indexes and
no aggregation. I could not run `SUM`, `GROUP BY` or `ORDER BY` on it, and the data would not
survive a browser-profile reset. The brief also explicitly requires persistent SQLite storage.

**46. Why `better-sqlite3` rather than `sqlite3`?**
`better-sqlite3` is synchronous, so queries return values directly (no callbacks or promise
chains), which makes the code much easier to read for a beginner. It is also very fast, and
prepared statements are a first-class API.

**47. How is money rounded and why does it matter?**
In 2.0 this changed for the better: money is stored as an **integer number of paise**
(`amount_minor`), so nothing is "rounded away" — it is exact. `0.1 + 0.2` is
`0.30000000000000004` in floating point; with integers a shop that adds hundreds of invoices can
never drift by a paisa. `src/money.js` converts rupees → paise once, on the server, with
`Math.round(value * 100)`, and formats for display with `Intl.NumberFormat('en-IN')`. The old REAL
`amount` column still exists as a generated virtual column so 1.0 queries keep working.

**48. What would you do with 100,000 transactions?**
The indexes keep filters and sorting fast; the list is paginated (`LIMIT`/`OFFSET` with "Load
more"), so the browser never receives the whole table. The analytics queries use `GROUP BY` on an
indexed date column. Beyond that I would add pre-aggregated monthly summary tables.

**49. Where would you add a new category?**
In one place: the category lists in `src/validation.js`. There are now four —
`PERSONAL_CATEGORIES` (Food, Transport, Shopping, Rent, Education, Healthcare, Entertainment,
Other, plus the 1.0 names Bills/Travel/Health kept for old data), `PERSONAL_INCOME_CATEGORIES`
(Salary, Freelance, Other), and for business `BUSINESS_EXPENSE_CATEGORIES` (Purchases, Rent &
Utilities, Salaries & Wages, Marketing, Software & Subscriptions, Travel & Transportation,
Equipment & Maintenance, Other Operating Expenses, Other) and `BUSINESS_INCOME_CATEGORIES`
(Sales, Other Income). `categoriesFor(workspaceType)` picks the right list. The API validates each endpoint against the right list, and `/api/meta` sends both
to the frontend, which rebuilds the dropdowns when the mode changes. The database `CHECK` on
`category` is a length check, so no migration is needed.

**50. What are you most proud of, and what would you improve next?**
Proud of: the financial honesty of 2.0 — totals and statuses are derived on the server, an unpaid
invoice can never be counted as cash, and 240 automated checks prove it. Improve next: logins with
hashed passwords and per-user data, then CSV
export and recurring transactions.

---

# Part 2 — version 2.0 (Individual and Business modes)

## H. Modes and workspaces

**H1. What did 2.0 actually add?**
A second finance book. A mode switcher at the top of the sidebar moves between **Individual**
(personal money) and **Business** (a shop or freelance practice). Individual gained savings goals,
recurring expenses, category budgets and CSV reports; Business added customers, vendors, invoices
with line items and part payments, vendor bills, cash flow and an estimated tax report. Same
branding, same stack, same database file — the original 79 tests still pass untouched.

**H1b. The app asks what I'll use it for on the first run — is that a login?**
No. It is a one-time purpose chooser: it decides which book opens first, stores the answer in
`localStorage` (`smartspend:onboarded`) and can be reopened from Settings. Nothing is created, and
both books are visible from the sidebar immediately afterwards. I kept the wording explicit —
"stored in this browser only, not security" — precisely because a first-run screen can look like
authentication.
`public/index.html` (#purposeScreen) · `openPurposeScreen()` in `public/app.js`

**H2. How do you guarantee the two modes never mix data?**
At the data layer, not the UI. Every table that belongs to a book has a `workspace_id` foreign key,
and **every** repository function takes the workspace id from the validated request as its first
argument and puts it in the `WHERE` clause. The client sends it in the `X-Workspace-Id` header; the
server does not trust the number — it looks the workspace up, rejects an unknown one with `404`, and
rejects a workspace of the wrong *type* for that endpoint with `400`. So a business request cannot
read a personal row even if it asks politely.
`src/repositories/*` · `resolveWorkspace()` in `src/routes/business.js`

**H3. Is the mode switcher authentication?**
No, and the app says so on the Settings page and in the README. Both books live in the same
unencrypted SQLite file; the switcher is a local profile selection for demonstration. Real
isolation needs a login, sessions, and the workspace id taken from the session rather than a
request header.

**H4. What happens to my old data when I upgrade?**
Nothing is lost. Migration 002 creates the two workspaces and assigns every pre-existing row to
Personal (workspace 1). The migration test builds a 1.0-shaped database, runs the real migration
code, and then compares every row and every field — quoted notes, decimals, the lot — with the
original. Result: no differences. On the live file the same comparison was also run against a
snapshot taken before the upgrade.

**H5. Why two workspaces and not two databases?**
One file keeps the project easy to run (`npm start` and nothing else) and lets both books share the
same schema, the same validation and the same tests. The separation that matters — "never mix
records" — is enforced by `workspace_id`, not by file boundaries. That said, the connection honours
a `SMARTSPEND_DB` environment variable, so a future version could give each workspace its own file
without touching the code that queries it.

---

## I. Business logic and financial correctness

**I1. How is an invoice total calculated?**
On the server, from the line items, always: `line_total = ROUND(quantity × unit_price)`, then
`line_tax = ROUND(line_total × tax_rate / 100)`, then `subtotal = SUM(line_total)`,
`tax = SUM(line_tax)`, `total = subtotal + tax`. Tax is applied per line, so a mixed-rate invoice is
correct. `computeDocumentTotals()` in `src/money.js` is the only place this happens.
`src/repositories/invoices.js` → `createInvoice()`

**I2. What if the browser sends its own total?**
It is ignored. `data.total` is never read anywhere in the repository; the server recomputes from
`data.items`. The test proves it by sending `total: 1` for lines worth ₹12,000 + ₹1,800 and
asserting the stored total is **₹13,800**.

**I3. Why is there no `status` column on invoices?**
Because a status that is stored can go stale or be faked. It is a `CASE` expression evaluated on
every read:

```
cancelled → draft → paid → overdue → partially_paid → unpaid
```

`paid` means recorded payments cover the total; `overdue` means there is still a balance and the due
date has passed; `partially_paid` means some money arrived but not all. The precedence is written
out explicitly in `docs/API.md`, because reordering it would silently change what the app reports.

**I4. Can opening or printing an invoice mark it paid?**
No — there is no status field to write, so a `GET` cannot change anything. Only an
`INSERT INTO invoice_payments` can move an invoice to `paid`. The UI test opens and prints an
unpaid invoice and asserts the badge still says `Unpaid`.

**I5. What stops a payment from being wrong?**
Four server-side checks, all before the insert: the amount must be a positive number, it must be
less than or equal to the balance the *server* calculates (the `400` message states the maximum),
an identical payment (same invoice, amount, date) is refused with `409`, and payments on draft or
cancelled invoices are refused. Deleting a payment recomputes the status and reopens the invoice if
the balance comes back.

**I5b. What does the Receivables Aging card actually compute?**
For every invoice with money still owed, the server works out how many days have passed since its
due date and drops the balance into one bucket: not due yet, 1–30, 31–60, 60+. The buckets are
computed in SQL/JS on the server from `due_date` and today's date, so a browser in another timezone
cannot disagree with the database, and a payment moves money out of a bucket the moment it is
recorded. `getReceivablesAging()` in `src/repositories/analytics.js`

**I5c. And the "↑ 23.5%" chips on the personal dashboard?**
`GET /api/summary?month=2026-10` also returns `previous` (the month before) and `change` (percent
change for income, expenses and balance, plus the savings rate in *percentage points*). A null
means "no baseline" — if the previous month had no income I show nothing rather than a fake 100%.
Colour follows meaning, not sign: expenses falling is green, expenses rising is red.

**I6. How is "outstanding" defined for customers and vendors?**
Outstanding receivable = `SUM(total − paid)` over that workspace's non-cancelled invoices, which is
exactly `SUM(balance_minor)`. Outstanding payables = the same over vendor bills, where a bill's
total is `amount + tax`. Both are **not cash**: they are reported next to revenue on the dashboard
and labelled as outstanding, never added to it.

**I7. What is net profit, and what is it not?**
Revenue − expenses, where both come from recorded transactions in the business workspace. It is not
an audited statement and not a tax computation — the dashboard says "basic bookkeeping estimates,
not audited statements" on the page itself. There is no double-entry ledger and no accrual
accounting.

**I8. Why does cash flow exclude unpaid invoices?**
Because an invoice is a promise. `moneyIn` is summed from `invoice_payments` rows, so an unpaid
invoice contributes nothing by construction — it is not "excluded" by a filter that someone could
forget, it simply is not part of the sum. Unpaid documents are returned separately as
`notYetReceived` / `notYetPaid` and the UI labels that box "this is not cash".

**I9. A customer owes ₹9,440 from last month. Where do they appear?**
In the dashboard's *Needs Attention* panel and in `?status=overdue`, with the due date and the
balance. Their invoice is counted in outstanding receivables and in no cash total.

**I10. How is the invoice number generated and kept unique?**
`INV-YYYY-NNNN` (e.g. `INV-2026-0001`), suggested by the server from the highest existing number in
that workspace and guarded by `UNIQUE(workspace_id, invoice_number)`. A duplicate insert is
rejected with `409` — the database, not the UI, is the final authority. The same applies to bill
numbers.

**I11. Can you delete a customer who has invoices?**
Not by accident. `invoices.customer_id` is `ON DELETE RESTRICT`, and the API returns `409` with a
message naming the count: *"…cannot be deleted because it is linked to 1 invoice and 1 transaction.
Archive it instead to keep your financial records intact."* Archiving hides the party from the
default list and keeps every document.

**I12. What about deleting an invoice that already has payments?**
Refused with `409`. Removing it would destroy the record of money that was actually received and
make the cash-flow report disagree with the bank. Deleting a draft invoice with no payments is
allowed. Cancelling is the supported way to void a real document: it stays visible, counts as zero
outstanding, and remains in the history.

**I13. How does the tax estimate work, and what is the disclaimer?**
Each line (and each bill) can carry a tax rate the user types — nothing is assumed or applied
automatically. The tax report sums those amounts for a date range and exports them to CSV. The page
states, and the README repeats, that these are **estimates for record-keeping, not tax advice**, and
that there is no GST/HSN handling or filing.

**I14. Partial payment of ₹5,000 on a ₹13,800 invoice — what do the numbers do?**
`paid = 5,000`, `balance = 8,800`, status `partially_paid`, and the dashboard receivable drops from
13,800 to **8,800**. Paying the remaining 8,800 sets status `paid` and the receivable to zero.

**I15. How do recurring expenses avoid duplicates?**
There is a partial unique index on `(recurring_rule_id, transaction_date)` and the generator uses
`INSERT OR IGNORE`. Pressing *Generate* twice inserts nothing the second time and the UI reports
"No new entries were due". Reloading the page does not generate anything either — generation only
happens when the user asks for it.

---

## J. Data, migrations and money

**J1. How do migrations work?**
`schema_migrations(id TEXT PRIMARY KEY, applied_at)` plus a runner that reads the folder in order
and applies anything not yet recorded. Each migration is one function inside one SQLite transaction,
followed by `PRAGMA foreign_key_check`. If it throws, it rolls back and the server refuses to start
rather than running on a half-migrated file. There are six migrations; re-running applies nothing.

**J2. Why is money stored as an integer?**
Floating point cannot represent 0.1 exactly, so `0.1 + 0.2 = 0.30000000000000004`. A shop adding
hundreds of invoices would eventually see a one-paisa drift between the cards and the database.
`amount_minor INTEGER` in paise is exact; conversion happens once at the API edge and formatting
happens once in the UI with `Intl.NumberFormat('en-IN')`.

**J3. If `amount` became generated, how does old code still work?**
`amount` is `GENERATED ALWAYS AS (amount_minor / 100.0) VIRTUAL`, so reading `amount` gives rupees
and the original 1.0 queries and tests are unchanged. Writing to it fails — on purpose — because
writes must go to `amount_minor`. This is why the old `PRAGMA table_info` check was changed to
`table_xinfo`: generated columns do not appear in the former.

**J4. What is a generated column, in one line?**
A column computed by SQLite from other columns, not stored separately, and read-only — the database
guarantees it can never disagree with its source.

**J5. How do you know the migration did not corrupt existing data?**
The migration suite compares a 1.0 database before and after: same row count, same field-by-field
values including quotes and notes, and `SUM(amount)` ₹9,077 ↔ `SUM(amount_minor)` 907,700 paise;
₹1,200.75 becomes 120,075 exactly. On the real file the same diff against a pre-upgrade snapshot
reported zero differences.

**J6. Where are foreign keys enforced?**
`PRAGMA foreign_keys = ON` is set on every connection in `database.js`. Without it SQLite parses
foreign keys but never enforces them — a classic exam question, and a real bug source.

**J7. What indexes did 2.0 add?**
Composite `(workspace_id, transaction_date)`, `(workspace_id, category)`, `(workspace_id, type)` for
the scoped list queries and reports; `(invoice_id)` on items and payments; `(due_date)` for the
overdue scans; `(customer_id)`/`(vendor_id)` for the party joins; a partial unique index for
recurring idempotency; and unique constraints on invoice and bill numbers per workspace. 29 indexes
in total.

**J8. Why is `invoice_ref` stored as `''` instead of NULL?**
Because `UNIQUE` treats NULLs as distinct in SQLite, so a nullable column would happily accept
thousands of "duplicates". Storing an empty string makes the uniqueness rule actually work.

---

## K. Frontend 2.0

**K1. How does the frontend know which mode it is in?**
One state field, `state.mode`, saved in `localStorage`. Changing it re-points `state.workspaceId`,
swaps the visible navigation, rebuilds the category dropdowns, toggles the business-only form
fields, and routes to that mode's default view. The `hashchange` handler means a URL like
`#invoices` opens business mode directly — there is exactly one place that infers the mode from a
view name, so they cannot disagree.

**K2. `public/app.js` is an IIFE — how do the new files share code?**
It publishes a small, deliberate bridge: `window.SS` exposes the state, `api()`, the safe `el()`
helper, formatters, the toast, the confirmation dialog and a generic form-dialog builder. The three
new files (`personal-extras.js`, `business.js`, `invoices.js`) are separate scripts that register
their views with `SS.registerView()`; no other globals leak.

**K3. How do you keep user content out of the HTML?**
Everything from the database is inserted with `textContent` (via `el()`), never `innerHTML`.
`innerHTML` is used only for fixed SVG icons and for the invoice print sheet, where every value is
first passed through the same `el()` builder or escaped. CSV cells beginning with `=`, `+`, `-` or
`@` are prefixed with an apostrophe so a spreadsheet cannot execute them.

**K4. Why a generic form builder instead of a dialog per screen?**
Six screens (customer, vendor, goal, contribution, recurring rule, bill, payment) need the same
modal, the same required-field handling and the same server-error mapping. One builder means one
implementation of focus handling, Esc, and field-level errors — and a consistent look.

**K5. How are charts updated when the date range changes?**
Each range control triggers a re-fetch and then updates the existing Chart.js instance
(`chart.data.datasets[0].data = …; chart.update()`) rather than destroying and recreating it, so
there is no flicker and no leaked canvas contexts.

**K6. How is the invoice print / Save-as-PDF implemented?**
A dedicated print sheet is filled with the document's own data and printing is triggered; CSS
`@media print` hides the app shell. No server-side PDF library, and — importantly — nothing in the
print path touches the database, so printing cannot change a status.

**K7. What happens on a small screen?**
The sidebar becomes a drawer with a scrim (closed with Esc), tables become stacked cards with
`data-label` headings, and the invoice viewer becomes a single column. The mode switcher stays
visible at the top of the drawer, which the mobile screenshot in `docs/screenshots/` shows.

---

## L. Testing 2.0

**L1. How do you know the business logic is correct?**
`npm test` runs 240 assertions against a real server and a temporary database: 79 personal API
checks (unchanged from 1.0), 138 business checks and 23 migration checks — all passing. The business
suite covers the 15 acceptance criteria directly: cross-mode isolation, server-side totals,
part-payments, over-payment and duplicate-payment refusal, derived overdue status, cash flow
excluding unpaid documents, CSV contents, delete-blocking and the guard rail that viewing cannot
mark an invoice paid. `docs/ACCEPTANCE.md` maps each criterion to the check names.

**L2. That sounds like a lot of claims — how would you spot a lie in your own report?**
By running it. Every claim in the README and in `docs/ACCEPTANCE.md` names a specific check, a
specific endpoint or a specific number you can reproduce with `npm test`, `docs/TEST_STEPS.md` or
`curl`. If a number in a document disagreed with the app, the document would be wrong — that is how
two worked examples in the README were found and corrected (₹4,040 total, ₹1,040 payment).

**L3. What is still not tested or not built?**
Stated plainly in README §17: no authentication, no double-entry accounting, no GST filing, no
server-side PDF generation, no bank import, no multi-currency, and the browser suite is not
committed (Playwright is not a project dependency) — hence the manual script. The app never claims
to be production-ready.

**L4. If I opened DevTools and changed the total before saving an invoice?**
Nothing happens. The browser is not trusted with money: the totals are recomputed from the line
items, the workspace comes from the validated header, and the payment status is derived from payment
rows. The most a tampered request can do is fail validation.

**L5. What was the hardest bug in 2.0?**
Line totals occasionally came out as `NaN`. `computeLine()` read `item.unit_price_minor` while the
route passed `unitPriceMinor`; with one `undefined`, `Math.round(qty * undefined)` is `NaN`, and
`NaN` silently becomes 0 through the money helpers — an invoice that "worked" but was wrong. Fixed
by accepting both key styles and throwing on non-numeric input instead of storing a silent zero.
A close second: `PRAGMA table_info` hides generated columns, which made a migration assertion fail
falsely until the check used `table_xinfo`.

---

## Quick-fire card (last five minutes before the viva)

| Question | One-line answer |
|---|---|
| What are the two modes? | Individual (personal) and Business (shop/freelance), switched from the sidebar; local demonstration, not authentication |
| Where is the separation enforced? | `workspace_id` on every table, in every query, from a validated `X-Workspace-Id` |
| Who calculates invoice totals? | The server, from line items; client totals are ignored |
| Where is invoice status stored? | Nowhere — it is derived from payments + due date, in a fixed precedence |
| Can printing mark an invoice paid? | No; only an `invoice_payments` row can |
| Is an unpaid invoice cash? | No; cash flow sums payments only, and shows unpaid documents separately |
| How is money stored? | Integer paise (`amount_minor`), exact; rupees only at the edges |
| How are upgrades done? | Six append-only migrations in `schema_migrations`, one transaction each, verified non-destructive |
| How many tests? | 240 automated (79 + 138 + 23) + 74 browser checks, 0 failures |
| What is missing? | Auth, double-entry/GST, server PDF, imports, multi-currency — all listed in README §17 |
