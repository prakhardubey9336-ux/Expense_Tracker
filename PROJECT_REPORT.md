# SmartSpend — Smart Personal & Business Expense Tracker
## Project Report (outline with ready-to-use content)

**Submitted by:** _Your Name_, B.Tech CSE, 2nd Year
**Roll number:** _XXXXXXX_ · **Section:** _X_
**Guide:** _Faculty name_
**Session:** 2026–27

> How to use this document: paste each section into your report template. The paragraph under
> every heading is already written in report language — edit names, dates and page counts, then
> add your college logo on the cover page. Sections marked **[FIGURE]** are places to insert a
> screenshot (take them from the running app).

---

## 1. Abstract

Managing personal money is a daily problem for students, yet most people rely on memory or
scattered notes and only notice overspending after it has happened. **SmartSpend** is a web-based
personal expense tracker that turns day-to-day money entries into a clear financial picture. The
application lets a user record income and expenses under fixed categories, search and filter the
history, set a spending budget for each calendar month, and view automatically generated charts
and insights. It is implemented as a three-layer web application: an HTML5/CSS3/Vanilla
JavaScript frontend, an Express.js REST API written in Node.js, and a persistent SQLite database
accessed through the `better-sqlite3` driver with prepared statements. All figures displayed by
the dashboard — total income, total expenses, available balance, savings rate, budget usage,
category breakdown and monthly comparison — are computed directly from the stored records, so
the application reflects real data rather than static sample values. The system runs entirely on
a local machine with no separate database server, making it simple to install, demonstrate and
extend, while still following professional practices such as layered architecture, server-side
validation, parameterised SQL queries and centralised error handling.

**Version 2.0 (Individual and Business Finance Modes)** extends the same application rather than
replacing it. A mode switcher at the top of the sidebar moves between two finance books stored in
the same database file: an **Individual** book for personal money (now with savings goals, recurring
expenses and CSV reports on top of the original features) and a **Business** book for a small shop
or freelance practice (customers, vendors, invoices with line items and part payments, vendor bills
and payables, cash-flow reporting and an estimated tax report). The two books are separated by a
`workspace_id` foreign key on every table, and every query is filtered by it, so a personal report
can never contain a business sale. Financial correctness is enforced on the server: invoice totals
are recalculated from line items (any total sent by the browser is ignored), document status is
derived from recorded payments and the due date rather than stored, payments cannot exceed the
outstanding balance or be recorded twice, and unpaid invoices and bills are deliberately excluded
from cash flow. Money is stored as integer paise to eliminate floating-point error, and the schema
is upgraded through six append-only, data-preserving migrations.

---

## 2. Problem statement

Manual expense tracking with notebooks or spreadsheets has four practical problems:

1. **No instant overview** — a notebook cannot tell you the current balance at a glance.
2. **Category insight is missing** — people rarely total their spending per category, so they do
   not know where the money actually goes.
3. **No budget feedback** — there is no automatic warning when monthly spending crosses a limit,
   which is exactly when the user needs one.
4. **Data is easy to lose or duplicate** — loose notes get misplaced, and copying rows in a
   spreadsheet quickly leads to inconsistent totals.

Existing mobile apps solve this but require internet access, accounts and often share data with
third parties. A student needs something **local, private, free and simple** that still looks and
behaves like a professional finance dashboard.

**Problem statement:** *Design and implement a local, single-user web application that stores
personal income and expense records in a persistent database, and presents them as a live
financial dashboard with category analysis, monthly budget tracking and rule-based insights.*

**2.0 problem statement (the second half of the brief):** *A small shop or freelance practice has a
different question. It does not ask "where did my money go?" but "who still owes me, whom do I still
owe, and did I actually make a profit this month?" Answering that needs customers and vendors,
invoices with line items and part payments, purchase bills, and a cash-flow statement that refuses
to treat an unpaid invoice as money in hand. The extension must answer those questions inside the
same application, without a rewrite, without a second tool, and without letting business figures
contaminate the personal book.*

---

## 3. Objectives

### 3.1 Version 1.0 — personal expense tracking

1. Provide complete CRUD (Create, Read, Update, Delete) for income and expense transactions.
2. Store all records permanently in a local SQLite database that is created automatically.
3. Present four key financial indicators — total income, total expenses, available balance and
   savings rate — calculated from the database, handling zero-income without division by zero.
4. Allow search and multi-criteria filtering (title, category, type, month, date range) executed
   as parameterised SQL, not as client-side hiding.
5. Support a separate spending budget for every calendar month with live progress, remaining
   amount and visual over-budget warning.
6. Visualise expenses by category and compare monthly income against expenses using Chart.js.
7. Generate plain-language spending insights that are always supported by real records.
8. Follow good engineering practice: validation on both client and server, prepared statements
   against SQL injection, safe DOM updates against XSS, RESTful API design, consistent HTTP status
   codes and a centralised error handler.
9. Deliver a responsive, accessible interface with light/dark themes that is easy to demonstrate in
   a viva.
10. Document the system so that a beginner can install, run, test and explain it.

### 3.2 Version 2.0 — Individual and Business finance modes

11. **Add a second kind of user** (a small shop or freelance practice) to the same application,
    without duplicating the codebase, without a rewrite, and without breaking anything that already
    works in Individual mode.
12. **Keep the two books provably separate** at the database level (a `workspace_id` on every row
    and in every query), not merely through different screens.
13. **Model real business paperwork** — customers, vendors, invoices with line items, part payments
    and vendor bills — with totals and statuses that a browser cannot fake.
14. **Report cash flow honestly**, by excluding money that has been promised but not yet received or
    paid, and by showing it separately instead of hiding it.
15. **Extend the Individual side** with savings goals, recurring expenses, category budgets and CSV
    reports — kept simple, with no business concepts leaking in.
16. **Upgrade the schema safely**: versioned, append-only migrations that preserve the user's
    existing transactions and budgets, with integer-paise storage to remove floating-point drift.
17. **Stay inside the original stack** — HTML/CSS/vanilla JS, Chart.js, Node/Express, SQLite — and
    document every endpoint, test step and known limitation.

---

## 4. Technology stack (with justification)

| Layer | Technology | Why this choice |
|---|---|---|
| Structure | **HTML5** | Semantic, accessible markup (`<main>`, `<table>`, `<dialog>`, labels for inputs) |
| Styling | **CSS3** | CSS custom properties (design tokens), grid/flex layout, media queries, `prefers-color-scheme`, no preprocessor needed |
| Interactivity | **Vanilla JavaScript (ES2020+)** | Required by the brief; `fetch()` + DOM APIs are enough for this scale and keep the code readable for a beginner |
| Charts | **Chart.js 4.4.6** | Small, well-documented, canvas-based; bundled locally so charts work offline |
| Server | **Node.js LTS** | Same language on both ends; non-blocking I/O |
| Framework | **Express 4** | Minimal routing, middleware and a centralised error handler |
| Data format | **JSON** | Simple to inspect in DevTools and to document |
| Database | **SQLite via `better-sqlite3`** | Serverless single file; no MySQL/XAMPP; synchronous API is easy to reason about; prepared statements are first-class |
| Tooling | **VS Code, npm, Git** | Standard course tooling; `npm start` / `npm test` / `npm run dev` |

**Explicitly not used:** React/Angular/Vue/Next.js, TypeScript, Tailwind, jQuery, MongoDB or any
ORM. These would add concepts that do not help the project's learning objectives.

**2.0 added no dependencies.** The business layer reuses `better-sqlite3` prepared statements, the
same Express router, the same validation module and the same CSS design tokens. Two small helpers
were added instead of a library: `src/money.js` (rupee ↔ paise conversion, INR formatting, line and
document totals) and `src/csv.js` (a CSV serialiser with a UTF-8 BOM, correct quoting and a
spreadsheet formula-injection guard). Migrations are plain JavaScript modules applied by a 60-line
runner, not a framework. This matters in the viva: every mechanism in the project can be explained
line by line.

---

## 5. System architecture

Classic **three-tier client–server architecture** on one machine, extended in 2.0 with a
workspace-scoped data model and a set of focused frontend modules:

```
+---------------------------------------------------------------------------+
|  PRESENTATION LAYER  —  Browser (http://localhost:3000)                   |
|  index.html ......... shell, sidebar, all view containers, dialogs        |
|  style.css .......... design tokens, dark theme, responsive breakpoints   |
|  app.js ............. core: fetch(), router, charts, personal dashboard   |
|  js/personal-extras.js  savings goals, recurring expenses, personal       |
|                         reports, settings, mode switcher wiring           |
|  js/business.js ..... business dashboard, customers, vendors, bills,      |
|                         cash flow, business reports, CSV exports          |
|  js/invoices.js ..... invoice editor, viewer, print, payment recording    |
+----------------------------------+----------------------------------------+
                                   |  HTTP + JSON (REST), X-Workspace-Id
+----------------------------------v----------------------------------------+
|  APPLICATION LAYER  —  Node.js + Express                                  |
|  server.js ............... app setup, static files, central error handler |
|  src/routes/api.js ....... personal REST endpoints + mounts /business     |
|  src/routes/business.js .. business REST endpoints                        |
|  src/validation.js ....... allowed values, input rules, ApiError          |
|  src/money.js ............ rupees <-> paise helpers, INR formatting       |
|  src/csv.js .............. CSV serialiser (BOM, quoting, injection guard) |
|  src/repositories/*.js ... all SQL: transactions, budgets, analytics,     |
|                            workspaces, parties, invoices, vendor bills,   |
|                            recurring rules, goals, reports                |
|  src/migrations/*.js ..... 6 append-only, versioned schema upgrades       |
+----------------------------------+----------------------------------------+
                                   |  better-sqlite3 prepared statements
+----------------------------------v----------------------------------------+
|  DATA LAYER  —  SQLite file  expense-tracker.db                           |
|  15 tables: workspaces, transactions, budgets, savings_goals,             |
|  recurring_rules, customers, vendors, invoices, invoice_items,            |
|  invoice_payments, vendor_bills, vendor_bill_payments,                    |
|  schema_migrations, plus the generated amount column                      |
|  Every row that belongs to a book carries workspace_id (FK, indexed).     |
+---------------------------------------------------------------------------+
```

**Request lifecycle for "add a transaction" (unchanged from 1.0):**

1. User submits the form -> `app.js` validates the fields in the browser.
2. `POST /api/transactions` with a JSON body and an `X-Workspace-Id` header.
3. `validation.js` re-validates, `resolveWorkspace()` proves the workspace exists and is the right
   *type* for the endpoint. Invalid -> `400` with per-field messages.
4. `repositories/transactions.js` runs a **prepared** `INSERT` on `amount_minor`.
5. Express replies `201` with the created row.
6. `app.js` shows a toast and re-fetches summary, categories, monthly series, insights and budget,
   then redraws the cards and charts. No page reload.

**Request lifecycle for "record a payment" (new in 2.0) — the interesting one:**

1. The user types an amount in the invoice viewer; the browser sends only
   `{ amount, paid_on, method, reference }`.
2. The route rejects a non-numeric id (`400`), an unknown id (`404`), an amount that is not a
   positive number (`400`), and — critically — any amount greater than the balance the **server**
   computes (`400`, message includes the maximum allowed).
3. A duplicate payment (same invoice, amount, date) is rejected with `409`.
4. Inside a **single SQLite transaction** the payment row is inserted and the invoice is re-read;
   totals, balance and status are recomputed from the stored rows, never accepted from the client.
5. Express replies `201` with the recomputed document.

**Why this layering matters:** the routes never contain SQL and the repositories never contain HTTP
logic. Validation lives in exactly one place, and the two things a dishonest browser could try to
do — invent a total or invent a paid status — have nowhere to land.

**[FIGURE]** Layered architecture diagram (draw the three boxes above) and the folder tree from
`README.md`.

---

## 6. Database design

### 6.1 Migration history (append-only, non-destructive)

| # | File | What it does |
|---|---|---|
| 001 | `001_init.js` | The original 1.0 tables `transactions`, `budgets` + their indexes |
| 002 | `002_workspaces_parties.js` | `workspaces` table, `customers`, `vendors`; adds `workspace_id` to `transactions` and `budgets`; creates Personal (1) and My Business (2) and assigns every pre-existing row to Personal |
| 003 | `003_minor_units.js` | Rebuilds `transactions` and `budgets` with integer `amount_minor` (backfilled `ROUND(amount*100)`), keeps `amount` as a generated column, adds the business fields on `transactions` |
| 004 | `004_invoices_bills.js` | `invoices`, `invoice_items`, `invoice_payments`, `vendor_bills`, `vendor_bill_payments` |
| 005 | `005_recurring_goals.js` | `recurring_rules`, `savings_goals`, `savings_goal_contributions`, `category_budgets` |
| 006 | `006_bill_notes.js` | Adds an optional `notes` column to `vendor_bills` |

`schema_migrations(id TEXT PRIMARY KEY, applied_at)` records what has run. Each migration runs
inside one SQLite transaction and is followed by `PRAGMA foreign_key_check`; if anything throws, the
whole migration rolls back and the server refuses to start. Re-running applies nothing. A fresh
database is built by running all six in order, so a new install and an upgraded install converge to
the same schema — this is the same code path, not two scripts.

Result: **15 tables** (`workspaces`, `transactions`, `budgets`, `category_budgets`,
`savings_goals`, `savings_goal_contributions`, `recurring_rules`, `customers`, `vendors`,
`invoices`, `invoice_items`, `invoice_payments`, `vendor_bills`, `vendor_bill_payments`,
`schema_migrations`) and 29 indexes.

### 6.2 Tables

**`workspaces`** — one row per finance book: `name`, `type` (`individual` | `business`),
`currency`, `notes`, timestamps. Two rows exist out of the box: `1 = Personal (individual)`,
`2 = My Business (business)`.

**`transactions`** — one row per money movement, personal *and* business.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | INTEGER | FK -> `workspaces(id)`, indexed; which book the row belongs to |
| `type` | TEXT | `income` / `expense` (CHECK) |
| `title` | TEXT | short description, 1–100 chars (CHECK) |
| `category` | TEXT | personal and business category lists are different and validated separately |
| `amount_minor` | INTEGER | **canonical** money, paise, CHECK > 0 |
| `amount` | REAL | `GENERATED ALWAYS AS (amount_minor / 100.0) VIRTUAL` — read-only, kept so 1.0 code still works |
| `transaction_date` | TEXT | `YYYY-MM-DD`, GLOB-checked |
| `notes` | TEXT | optional, ≤ 500 |
| `payment_method`, `customer_id`, `vendor_id`, `invoice_id`, `tax_rate`, `tax_minor`, `recurring_rule_id` | | business-only, NULL/0 on personal rows |
| `created_at` | TEXT | `datetime('now')` |

Indexes: `(workspace_id, transaction_date)`, `(workspace_id, category)`, `(workspace_id, type)`,
`(customer_id)`, `(vendor_id)`, `(invoice_id)`, plus the partial unique index described below.

**`budgets`** — `workspace_id`, `month` (`YYYY-MM`), `amount_minor`; `UNIQUE(workspace_id, month)`.
The 1.0 global `UNIQUE(month)` had to be replaced: two books may each budget October 2026.
**`category_budgets`** — the same month key plus `category` and
`UNIQUE(workspace_id, month, category)`.

**`savings_goals`** — `workspace_id`, `name`, `target_minor`, `target_date`, `notes`,
`is_archived`. **`savings_goal_contributions`** — `goal_id` (FK), `amount_minor`,
`contributed_on`, `notes`. Progress is `SUM(contributions) / target`, always derived — there is no
"current amount" column that could drift.

**`recurring_rules`** — `workspace_id`, `title`, `type`, `category`, `amount_minor`, `frequency`
(`daily`/`weekly`/`monthly`/`yearly`), `start_date`, `next_due_date`, `is_active`.
**Idempotency:** `idx_transactions_recurring_once` is a *partial* unique index on
`(recurring_rule_id, transaction_date)`, and the generator uses `INSERT OR IGNORE`. Pressing
*Generate* five times, or reloading the page, cannot create a duplicate entry for the same due date
— the database refuses it, not the JavaScript.

**`customers` / `vendors`** — `workspace_id`, `name` (`UNIQUE(workspace_id, name)`), `contact_person`,
`email`, `phone`, `address`, `notes`, `is_archived`, timestamps.

**`invoices`** — `workspace_id`, `invoice_number` (`UNIQUE(workspace_id, invoice_number)`),
`customer_id` (FK, `ON DELETE RESTRICT`), `invoice_date`, `due_date`, `is_draft`, `is_cancelled`,
`notes`, and **`subtotal_minor` / `tax_minor` / `total_minor`**, which the server writes from the
line items at create/update time. There is deliberately **no `status` column** — see 6.3.

**`invoice_items`** — `invoice_id` (FK, cascade on invoice delete), `description`, `quantity`,
`unit_price_minor`, `tax_rate`, `line_total_minor`, `position`.

**`invoice_payments`** — `invoice_id` (FK), `amount_minor`, `paid_on`, `method`, `reference`,
`notes`.

**`vendor_bills` / `vendor_bill_payments`** — the mirror image for money the business owes:
`bill_number` (unique per workspace), `vendor_id` (FK RESTRICT), `description`, `amount_minor`,
`tax_rate`, `tax_minor`, `bill_date`, `due_date`, `notes`, `is_cancelled`, then payments with the
same guards as invoice payments.

### 6.3 Derived values — the heart of the business logic

Totals are computed **on the server from the line items** and written once:

```
line_total_minor = ROUND(quantity * unit_price_minor)
line_tax_minor   = ROUND(line_total_minor * tax_rate / 100)     -- tax applies to that line only
subtotal_minor   = SUM(line_total_minor)
tax_minor        = SUM(line_tax_minor)
total_minor      = subtotal_minor + tax_minor
```

Money that has been received is always summed from the payments table, never guessed:

```
paid_minor    = IFNULL((SELECT SUM(amount_minor) FROM invoice_payments
                        WHERE invoice_id = i.id), 0)
balance_minor = total_minor - paid_minor
```

Status is a `CASE` expression evaluated on every read (from `src/repositories/invoices.js`):

```sql
CASE
  WHEN i.is_cancelled = 1            THEN 'cancelled'
  WHEN i.is_draft = 1                THEN 'draft'
  WHEN paid_minor >= i.total_minor   THEN 'paid'
  WHEN i.due_date < @today           THEN 'overdue'
  WHEN paid_minor > 0                THEN 'partially_paid'
  ELSE 'unpaid'
END
```

Vendor bills use the same order with `total = amount_minor + tax_minor` (bills store an amount and a
tax rate rather than line items — a purchase bill is normally one figure).

Consequences worth stating in a viva:

- **Printing or viewing cannot mark an invoice paid**, because there is no status field to write.
  Only a row in `invoice_payments` can change the status.
- **A part-paid old invoice is `overdue`, not `partially_paid`** — the money is still late, and the
  precedence above says so explicitly. Moving the `partially_paid` branch one line up would silently
  hide overdue debt.
- **Cash flow cannot include unpaid documents**: `moneyIn` is summed from `invoice_payments`, not
  from `invoices`, so an unpaid invoice contributes zero by construction. The same holds for bills.
- **The `total` a browser sends is never read.** `createInvoice()` calls
  `computeDocumentTotals(data.items)`; `data.total` is not referenced anywhere in the repository.

### 6.4 Other design decisions

- **Integer paise, not floats.** `0.1 + 0.2` is `0.30000000000000004` in binary floating point; a
  shop adding hundreds of invoices would eventually see a one-paise drift. `amount_minor` is an
  INTEGER and every sum is exact. Conversion happens once at the API edge (`src/money.js`), and the
  generated `amount` column keeps the original 1.0 queries and test suite working untouched.
- **Dates are `TEXT` `YYYY-MM-DD`.** Lexicographic order equals chronological order, so
  `ORDER BY transaction_date DESC` and `substr(date,1,7)` grouping need no date functions, and a
  time zone can never shift a day.
- **Nothing is dropped and nothing is mixed.** 2.0 only adds; `PRAGMA foreign_keys = ON`; every
  repository function takes the workspace id from the validated request, so a personal report can
  never read a business row even if the browser asks for it.
- **`db.transaction()` wraps every multi-write** — invoice + items, payment + recompute, bill +
  payment, and the demo seeds. A failure leaves no half-written document.
- **`CHECK` constraints duplicate the API rules on purpose** (defence in depth): even a manual
  `INSERT` cannot create a negative amount, an invalid type or a malformed date.
- **Party deletion is `RESTRICT`.** `invoices.customer_id` and `vendor_bills.vendor_id` reference
  the party table with `ON DELETE RESTRICT`, so SQLite itself refuses to orphan a financial record;
  the API turns that into a `409` with a human explanation and offers archiving instead.

### 6.5 Representative queries

```sql
-- dashboard summary, scoped to one book
SELECT IFNULL(SUM(CASE WHEN type='income'  THEN amount_minor ELSE 0 END),0) AS income_minor,
       IFNULL(SUM(CASE WHEN type='expense' THEN amount_minor ELSE 0 END),0) AS expense_minor
FROM transactions WHERE workspace_id = ? AND transaction_date BETWEEN ? AND ?;

-- cash in = money actually RECEIVED (invoice payments, never invoices)
SELECT IFNULL(SUM(p.amount_minor),0) AS cash_in_minor
FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
WHERE i.workspace_id = ? AND p.paid_on BETWEEN ? AND ?;

-- monthly profit trend for the business dashboard
SELECT substr(transaction_date,1,7) AS month,
       SUM(CASE WHEN type='income'  THEN amount_minor ELSE 0 END) -
       SUM(CASE WHEN type='expense' THEN amount_minor ELSE 0 END) AS profit_minor
FROM transactions WHERE workspace_id = ? GROUP BY month ORDER BY month LIMIT ?;
```

**[FIGURE]** ER diagram of the 15 tables (`workspaces` at the centre, everything else pointing at
it; `invoices` -> `invoice_items` / `invoice_payments` / `customers` is enough for a report page),
plus a screenshot of the database opened in the *SQLite Viewer* extension.

---

## 7. Features (with implementation notes)

The table below is the 1.0 personal feature set, still present and still tested. Section 7.1 adds
the 2.0 features.


| # | Feature | How it works |
|---|---|---|
| 1 | **Dashboard summary cards** | `GET /api/summary` → totals, balance, savings rate with a zero-income guard |
| 2 | **Add transaction** | Modal `<dialog>` form; client validation → `POST` → toast → full refresh |
| 3 | **View transactions** | `GET /api/transactions` sorted `transaction_date DESC, id DESC`, paginated |
| 4 | **Edit transaction** | Row ✏️ → `GET /api/transactions/:id` prefills the same form → `PUT` |
| 5 | **Delete transaction** | Row 🗑️ → confirmation dialog → `DELETE` → refresh |
| 6 | **Search** | One `LIKE` clause across title, category and notes (wildcards escaped) |
| 7 | **Filters** | Category / type / month / date range, combined into one parameterised `WHERE` |
| 8 | **Clear filters** | Resets the form and reloads the unfiltered list |
| 9 | **Monthly budget** | `PUT /api/budgets` upsert; shows used %, remaining, ring and coloured bar |
| 10 | **Budget warning states** | Green < 75%, amber ≥ 75%, red > 100% (`exceeded`) |
| 11 | **Doughnut chart** | Chart.js, expenses by category for the selected month |
| 12 | **Bar chart** | Chart.js, income vs expenses for the last 6 months |
| 13 | **Insights** | Rule engine in `repositories/analytics.js`; only data-supported statements |
| 14 | **Empty states** | Friendly panels when there is no data (never a broken chart) |
| 15 | **Dark / light theme** | Indigo token set swapped by `data-theme` on `<html>`; remembered in `localStorage`; charts read their colours back from the CSS variables |
| 15b | **Button system** | One `.btn` base (40px tall, 12px radius, hover lift, visible focus ring) with `btn-primary` (indigo gradient), `btn-ghost` and `btn-danger`; `btn-sm` for table rows; icon buttons share the same shape language |
| 16 | **Responsive layout** | Sidebar → drawer at ≤960px; table → stacked cards at ≤720px |
| 17 | **Notifications** | Toast stack for success / error, with `aria-live` |
| 18 | **Accessibility** | Labels on every field, visible focus rings, Esc closes dialogs, skip link, ARIA progressbars |
| 19 | **Global month selector** | One control drives dashboard, analytics, budget and insights |
| 20 | **Robust errors** | Central Express handler; friendly message if the server is stopped |

### 7.0 Visual design and theming

The interface uses an **indigo / violet** brand palette (`#4338ca` light, `#6366f1` dark) on cool
grey-lavender surfaces, with a teal accent for money coming in and a red one for money going out, so
positive and negative figures stay distinguishable without competing with the brand colour.

Every colour is a CSS custom property defined twice — once in `:root` and once in
`html[data-theme='dark']` — at the top of `public/style.css`. Components only ever reference the
tokens, so switching the entire application's palette (which is exactly what was done when the
original green theme was replaced) took one edit to those two blocks and no changes to markup,
layout or logic. Chart.js is the one exception, because it needs literal colour strings: the
category palette lives in `CATEGORY_COLORS` in `public/app.js`, and the income / expense / grid
colours are read back from the same CSS variables at draw time. A small `resize()` after each view
switch keeps charts correct when they were created while their section was hidden.

---

### 7.1 Version 2.0 features (Individual and Business modes)

**Shell and mode switching**

| # | Feature | How it works |
|---|---|---|
| 21 | **Mode switcher** | Two-button segmented control at the top of the sidebar (`aria-pressed`), swapped nav, per-mode default view, remembered in `localStorage`; labelled a local demonstration, not authentication |
| 22 | **Workspace scoping** | Every API call sends `X-Workspace-Id`; the server resolves and *validates* it (400 for a bad id, 404 for an unknown one, 400 when the workspace type is wrong for that endpoint) |
| 23 | **Per-mode navigation** | Individual: Dashboard, Transactions, Budgets, Savings Goals, Recurring, Analytics, Insights, Reports, Settings. Business: Business Dashboard, Transactions, Customers, Vendors, Invoices, Bills & Payables, Cash Flow, Reports, Settings |
| 24 | **Deep links** | `hashchange` router: `#invoices` opens business mode and the invoice list, with no reload hack |
| 25 | **Honest Settings page** | Says plainly that profiles are stored locally and that there is no login |

**Individual mode additions**

| # | Feature | How it works |
|---|---|---|
| 26 | **Savings goals** | Goal + contributions; progress bar, amount to go, target date; contributions are separate rows so the total can never be edited away |
| 27 | **Recurring expenses** | Frequency + next due date; *Generate* inserts only due entries, `INSERT OR IGNORE` + partial unique index make it idempotent (second run reports "No new entries were due") |
| 28 | **Category budgets** | Per-category monthly limits alongside the overall monthly budget |
| 29 | **Reports** | Monthly summary table, category breakdown with share bars, monthly + category CSV export, date-range driven charts |
| 30 | **CSV export (personal)** | Real download from the server, BOM for Excel, formula-injection guard |

**Business mode**

| # | Feature | How it works |
|---|---|---|
| 31 | **Business dashboard** | Revenue, expenses, **net profit = revenue − expenses**, outstanding customer payments, outstanding vendor payments, cash position; revenue-vs-expense chart, expense breakdown, monthly profit trend; labelled "basic bookkeeping estimates, not audited statements" |
| 32 | **Business transactions** | Type, description, amount, date, category, payment method, optional customer/vendor, invoice reference, notes; search + date range + category filters; CSV export |
| 33 | **Customers CRUD** | Search, create, edit, archive/restore; deleting one that has invoices returns `409` with an explanation instead of destroying history |
| 34 | **Vendors CRUD** | Same behaviour for vendors and their bills |
| 35 | **Invoices** | Unique number per workspace (`INV-YYYY-NNNN`, duplicate → `409`), customer, invoice/due dates, line items (qty × unit price, per-line tax), server-computed totals, derived statuses Draft / Unpaid / Partially Paid / Paid / Overdue, payment recording, viewer + print / Save-as-PDF |
| 36 | **Payments** | Server checks the balance before accepting; over-payment `400` with the maximum, duplicate `409`, payments on draft/cancelled invoices refused; deleting a payment reopens the invoice |
| 37 | **Bills & payables** | Vendor bills with number, dates, amount, tax, amount paid, remaining, status; total outstanding; same payment guards as invoices |
| 38 | **Cash flow** | Money received / money paid / net for a date range, built from *payments*, with unpaid invoices and bills shown separately and labelled "this is not cash" |
| 39 | **Tax & expense reports** | Per-line tax rates the user types (never assumed), date filters, totals, CSV; explicit "estimate for record-keeping, not tax advice" disclaimer |
| 40 | **Four business CSV exports** | Transactions, invoices, bills, tax report — each respects the filters and the workspace |
| 41 | **First-run purpose chooser** | Full-screen card asking "What will you use SmartSpend for?" — remembered per browser, keyboard navigable, re-openable from Settings, and explicitly labelled as *not* authentication |
| 42 | **Month-over-month chips** | `GET /api/summary?month=` also returns the previous month and the percent change; the UI colours a rise in expenses red and a fall teal |
| 43 | **Daily budget allowance** | Remaining budget ÷ days left in the month, computed from the selected month (not just today) |
| 44 | **Quick date ranges** | This month / Last month / Last 30 days / This year / All time — they fill the same From/To inputs the manual filters use, so table and CSV always agree |
| 45 | **Receivables aging** | Server-side buckets (not due / 1–30 / 31–60 / 60+ days) with the late total stated in words |
| 46 | **Top customers** | Ranked by invoiced value, excluding drafts and cancelled invoices |

### 7.2 Insight rules (all evaluated against real data)

1. No transactions this month → "No entries for <month> yet".
2. Expenses exist → "<Category> is your highest spending category" (+ amount and share).
3. Zero expenses but income exists → "No expenses recorded in <month>".
4. Budget set → "You have used N% of your monthly budget" or, when `spent > budget`,
   "You have exceeded your <month> budget" with the exact overshoot.
5. No budget set → "No budget set for <month>".
6. Expense > income this month → "Your expenses exceed your income this month".
7. Income > expense → "Your recorded income exceeds your expenses" (+ surplus).
8. Income exists overall → "Your overall savings rate is N%".

---

## 8. Testing

### 8.1 Strategy

Three layers, all executed against the real code:

| Layer | Command | Checks | Result |
|---|---|---|---|
| Personal API (1.0 suite, unmodified) | `npm run test:api` | 79 | **79 passed, 0 failed** |
| Business + acceptance | `npm run test:business` | 138 | **138 passed, 0 failed** |
| Migration safety | `npm run test:migration` | 23 | **23 passed, 0 failed** |
| Browser UI (headless Chromium, local script) | — | 74 | **74 passed, 0 page/console errors** |

`npm test` runs the three Node suites in order → **240 checks, 0 failures**.
The browser script is not committed because Playwright is not a project dependency; the manual
script in `docs/TEST_STEPS.md` covers the same ground by hand.

Each suite starts its own server on a random port against a temporary database file and stops it
afterwards, so the developer's own `expense-tracker.db` is never touched by a test run.

### 8.2 Key test cases and observed results (Individual)

| ID | Test | Expected | Actual |
|---|---|---|---|
| T1 | Add income ₹5,000 | Income 5000, Balance 5000, Savings 100% | ✅ Passed |
| T2 | Add expense ₹150 | Expenses 150, Balance **4,850** | ✅ Passed |
| T3 | Edit expense ₹150 → ₹200 | Expenses 200, Balance **4,800** | ✅ Passed |
| T4 | Delete that expense | Expenses 0, Balance **5,000** | ✅ Passed |
| T5 | Persistence | Rows survive browser refresh **and** server restart | ✅ Passed |
| T6 | Validation | Empty title, 0, -50, `2026-02-31`, `06/03/2026`, bad category, bad type, text amount → all `400` | ✅ Passed (8 cases) |
| T7 | Budget ₹1,000 + ₹150 expense | 15% used, ₹850 remaining, not exceeded | ✅ Passed |
| T7b | Overspend | ₹1,050 on ₹1,000 → `exceeded`, remaining −₹50 | ✅ Passed |
| T8 | Search / filters / analytics / insights | Correct subsets and insight text from real data | ✅ Passed |
| T9 | Security | `Robert'); DROP TABLE transactions;--` stored as text, table intact | ✅ Passed |
| T10 | Error handling | 404 for unknown id, 400 for non-numeric id / malformed JSON | ✅ Passed |

### 8.3 Business-mode tests and their observed results

| # | Criterion | Evidence from `test/business.test.js` |
|---|---|---|
| 1–2 | Individual mode intact, existing data preserved | `test/api.test.js` 79/79 unchanged; migration suite diff of every 1.0 field |
| 3 | Mode switching | UI checks: nav swap, default view, caption, remembered after reload, `#invoices` deep link |
| 4 | Profit maths | revenue ₹20,000 − expenses ₹6,000 → net profit **₹14,000**; date range respected |
| 5 | No cross-mode leakage | business rows do not change personal totals and vice versa; wrong-type workspace header → `400`; CSVs contain only their own book |
| 6 | Customer/vendor CRUD safe | delete-with-invoices → `409` naming the count, archive/restore works, unreferenced delete works |
| 7 | Server-side invoice totals | client sent `total: 1` for 2×₹5,000@18% + 1×₹2,000 → stored **₹12,000 + ₹1,800 = ₹13,800** |
| 8 | Partial payments | ₹5,000 of ₹13,800 → paid 5,000, balance **₹8,800**, `partially_paid`; receivable shows 8,800 |
| 9 | Overdue detection | back-dated unpaid invoice found by `?status=overdue`; the same invoice stops being overdue once fully paid; viewing changes nothing |
| 10 | Bill payments | ₹4,480 bill, ₹1,480 paid → balance **₹3,000**, `partially_paid`, dashboard payable 3,000 |
| 11 | Cash flow excludes unpaid | an extra ₹7,777 unpaid invoice and ₹5,555 unpaid bill change neither cash in nor cash out |
| 12 | CSV correctness | filtered export has exactly the matching row, amounts are plain numbers, invoice CSV carries the computed status, no cross-workspace rows |
| 13 | Migrations non-destructive | 1.0 data preserved, quoted notes preserved, paise exact, 15 tables, re-run applies nothing, fresh DB clean |
| 14 | Invalid input rejected | amounts ≤ 0, `2026-02-31`, unknown ids, over-payment, duplicate payment/number, wrong workspace type → 400/404/409 with no stack traces |
| 15 | Documented startup | `npm install && npm start` → 200 for `/`, `/app.js`, `/js/invoices.js`, `/style.css`, `/api/health` |

The full evidence table, with the exact check names, is in `docs/ACCEPTANCE.md`.

### 8.4 Bugs found and fixed during 2.0 development (shows the process)

1. The 1.0 frontend read `/api/meta` as `{data:…}` although the endpoint returns the object directly;
   the boot sequence aborted. Fixed by matching the contract.
2. Chart containers had no height → empty space on narrow screens; fixed with explicit
   `.chart-wrap` heights.
3. **Generated columns are invisible to `PRAGMA table_info`** — the migration check used
   `table_xinfo` instead. Without this, the "amount column still exists" test would have failed
   falsely.
4. **`UNIQUE` treats NULLs as distinct**, so a nullable `invoice_ref` let duplicate rows through.
   Fixed by storing `''` instead of `NULL` for the uniqueness key.
5. `computeLine()` read snake_case while the route passed camelCase, producing `NaN` totals. Now it
   accepts both and throws on non-numeric input instead of storing a silent zero.
6. A module-level `db.prepare()` executed at import time, so one bad SQL string crashed `require()`.
   Moved inside the function.
7. CSV export buttons navigate the page, so the browser test waited for a `download` event rather
   than an HTTP response.
8. Replacing the SQLite file underneath a running server leaves it on the old inode — the test
   harness now stops the server, resets the file and restarts.
9. The progress bar was an inline `<span>` and ignored width; fixed in CSS with
   `.progress > .progress-bar { display:block }` rather than by changing the markup.
10. The personal Reports view used CSS classes that never existed (`share-fill`); corrected to the
    real `.share-track > .share-bar > i` pattern.
11. Worked examples in the README drifted from the server's per-line tax rule (18% applies only to
    the taxable line). 3×₹1,000 @18% + 1×₹500 @0% = ₹3,500 + ₹540 = **₹4,040**; the docs and the
    UI now agree with the server.

---

## 9. Future scope

1. **Real authentication and per-user workspaces** — hashed passwords (bcrypt), sessions, and the
   workspace id taken from the session instead of a request header. The schema is already shaped for
   this (`workspace_id` everywhere); what is missing is identity, not data.
2. **Audit trail** — who changed or deleted what, when. Needed before this could be used for
   anything a tax officer would look at.
3. **PDF invoices generated on the server** — the current print path is the browser's print dialog
   (Save as PDF).
4. **GST-aware invoicing** — HSN codes, CGST/SGST/IGST splits, tax summaries per rate. Today the tax
   rate is a single user-entered estimate per line and the app says so.
5. **Recurring schedules for invoices and bills**, and emailing a payment reminder.
6. **Import from CSV / bank statement**, with a preview screen before anything is written.
7. **Receipt image attachments** in a local uploads folder.
8. **Predictive analytics** — forecast month-end spending from the current daily average.
9. **Progressive Web App** — service worker + manifest so it installs on a phone and works offline.
10. **The browser suite committed to the repo** with Playwright as a dev dependency and GitHub
    Actions running `npm test` on every push.
11. **Multi-currency** — the `workspaces.currency` column exists; nothing else does yet.

---

## 10. Conclusion

SmartSpend 1.0 met its objective: a beginner-readable, fully functional personal finance dashboard
with persistent storage, complete CRUD, server-side validation, live analytics and an accessible
interface, with every number on screen derived from SQLite and every layer holding one clear
responsibility.

Version 2.0 shows that the same architecture can carry a genuinely harder problem. Adding a second
set of books — for a shop rather than a student — required no new framework: a `workspace_id` on
every table, a mode switcher in the existing sidebar, six append-only migrations, and a set of
repositories that compute invoice totals, derived statuses and cash flow from stored rows. The
personal features kept working throughout; the original 79 assertions still pass untouched, and the
upgrade was proven non-destructive by diffing the database before and after migration.

The most valuable part of the exercise is not the feature count but the discipline the business
rules forced: never trust a total, never trust a status, never count a promise as cash, never delete
a record that a payment points at. Those decisions are enforced in three places at once — the
`CHECK`/`FOREIGN KEY` constraints, the repository layer, and the visible behaviour of the UI — which
is what makes the project easy to defend in a viva and, more importantly, honest about what it
actually calculates: **basic bookkeeping estimates, not audited statements and not tax advice.**

**Totals for the record:** 15 tables, 6 migrations, 3 test suites (**240 checks, 0 failures**), a
74-check browser pass, 40+ documented features across two modes, and a startup that is still two
commands: `npm install && npm start`.

**Word-count hint:** the narrative is roughly 5,000 words plus code samples. Most colleges expect 15–25 pages
including screenshots; add a cover page, certificate, acknowledgement, index and the figures marked
**[FIGURE]** — the ready-made screenshots in `docs/screenshots/` cover most of them.
