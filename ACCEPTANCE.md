# SmartSpend 2.0 — acceptance criteria report

Every criterion below was checked against the running application. Nothing in this document is
"planned" or "should work" — each row states how it was verified and what the actual output was.

**Verification environment**

| Item | Value |
|---|---|
| Node.js | v20.20.2 |
| npm | 10.8.2 |
| OS | Linux (sandbox) |
| Server | `npm start` → `http://localhost:3000` |
| Database | SQLite file `expense-tracker.db` (`better-sqlite3`) |
| Automated suites | `npm test` → **240 checks, 0 failures** |
| Browser suite | headless Chromium (Playwright) → **74 checks, 0 failures** |
| Manual script | `docs/TEST_STEPS.md` (30 steps in mode A/B + 7 curl checks) |

```
  79 passed, 0 failed, 79 total checks        test/api.test.js
  Business / acceptance: 138 passed, 0 failed test/business.test.js
  Migration: 23 passed, 0 failed              test/migration.test.js
  UI: 74/74 checks passed                     headless Chromium
```

---

## Summary

| # | Criterion | Result | Verified by |
|---|---|---|---|
| 1 | Existing Individual mode still works | ✅ Pass | `test/api.test.js` 79/79 + UI checks |
| 2 | Existing transactions are intact | ✅ Pass | `test/migration.test.js` (23) + live DB diff |
| 3 | Mode switching works and is clearly indicated | ✅ Pass | 74-check browser pass + manual steps B1–B3 |
| 4 | Profit arithmetic is correct | ✅ Pass | `test/business.test.js` |
| 5 | No cross-mode data leakage | ✅ Pass | `test/business.test.js` + UI + CSV checks |
| 6 | Customer/vendor CRUD is safe | ✅ Pass | `test/business.test.js` + UI |
| 7 | Invoice totals are calculated server-side | ✅ Pass | `test/business.test.js` + UI |
| 8 | Partial payments update the outstanding amount | ✅ Pass | `test/business.test.js` + UI |
| 9 | Overdue detection from due date + remaining | ✅ Pass | `test/business.test.js` |
| 10 | Bill payments update the outstanding amount | ✅ Pass | `test/business.test.js` + UI |
| 11 | Cash flow excludes unpaid invoices and bills | ✅ Pass | `test/business.test.js` + UI |
| 12 | CSV exports contain the correct filtered records | ✅ Pass | `test/business.test.js` + UI downloads |
| 13 | Migrations are non-destructive | ✅ Pass | `test/migration.test.js` (23) |
| 14 | Invalid amounts, dates and ids are rejected | ✅ Pass | `test/business.test.js` + curl checks |
| 15 | The documented startup actually works | ✅ Pass | fresh `npm install` + `npm start` + HTTP checks |

---

## 1. Existing Individual mode still works

**Requirement:** extending the app must not break the original personal features.

**How it was verified**

- The original suite `test/api.test.js` was **not modified** and still passes **79/79**: create,
  edit, PATCH, delete, persistence across a real server restart, 8 validation failures, 404s,
  budget maths (₹1,000 budget + ₹150 expense = 15% used, ₹850 remaining), overspend, per-month
  budgets, search/filter/pagination, category analytics, monthly series, insights, SQL-injection
  resistance, malformed JSON and API 404s.
- In the browser every Individual screen was opened and checked in the 74-check pass: the nav
  renders, the stat cards fill, the transaction list has rows, filters and CSV export work, and the
  run finishes with **no uncaught console errors**.
- Adding, editing and deleting a personal transaction through the UI still updates the cards and
  charts.

**Evidence:** `79 passed, 0 failed` · UI checks `individual nav active`, `individual stat cards
rendered`, `individual transaction list has rows`, `no uncaught console errors` · manual steps A1–A20.

---

## 2. Existing transactions are intact

**Requirement:** the upgrade must preserve the personal data that already existed.

**How it was verified**

- `test/migration.test.js` builds a 1.0-shaped database, runs the real migration code, then compares
  it with the original: **every row, every field, quoted notes, and paise-exact amounts**.
  `SUM(amount) = 9077` ↔ `SUM(amount_minor) = 907700`; `₹1200.75 → 120075`; `0.1 + 0.2 → 30`.
- The **live** database was migrated and then diffed against a pre-migration snapshot
  (`/tmp/mig/v1-backup.db`): **22 rows, 0 differences** on every 1.0 column.
- The live database today still holds its **22 personal transactions** and its three budgets
  (`2026-08` ₹2,500, `2026-09` ₹3,500, `2026-10` ₹3,000). No demo rows were added to it.

**Evidence:** `Migration: 23 passed, 0 failed` · live diff `differences: 0` · budgets unchanged.

---

## 3. Mode switching works and is clearly indicated

**Requirement:** a visible Individual/Business switch that swaps navigation, dashboard,
transactions and reports — without pretending to be authentication.

**How it was verified**

- The switcher sits at the top of the sidebar as a two-button segmented control with
  `aria-pressed`; the caption under it reads *"Personal book · Personal"* or
  *"Business book · My Business"*.
- Switching hides the other mode's navigation completely and opens that mode's default screen
  (`Dashboard` ↔ `Business Dashboard`).
- The choice is remembered across reloads; a URL hash such as `#invoices` opens the correct mode.
- Settings states plainly that this is a **local demonstration**, not secure multi-user
  authentication, and the README repeats it.

**Evidence (UI):** `mode switcher visible`, `individual nav active`, `business nav hidden`,
`business nav visible after switch`, `individual nav hidden after switch`,
`business dashboard is default`, `mode caption updated`, `mode remembered after reload`,
`deep link to #invoices opens business mode`.

---

## 4. Profit arithmetic is correct

**Requirement:** net profit = revenue − expenses, with revenue and expenses from recorded
transactions only.

**How it was verified**

- With revenue ₹20,000 and expenses ₹6,000 the dashboard reported
  **revenue ₹20,000, expenses ₹6,000, net profit ₹14,000**, and the profit margin was computed from
  the same numbers (70%).
- The dashboard respects a date range (`?from=`/`?to=`): a one-day range returned only that day's
  figures (`Dashboard respects the date range`).
- Unpaid invoices and unpaid bills are reported in **separate** `receivable`/`payable` objects and
  are never added to revenue or profit.

**Evidence (test):** `Revenue = ₹20,000`, `Expenses = ₹6,000`,
`Net profit = ₹14,000 (revenue - expenses)`, `Dashboard respects the date range`.
**Evidence (UI):** on the demo dataset the dashboard's revenue and profit cards both render, and
32,500 − 6,000 = 26,500 matches the server response.

---

## 5. No cross-mode data leakage

**Requirement:** business transactions must not appear in Individual reports, and vice versa.

**How it was verified**

- API: personal totals stay identical after business rows are created, and business totals ignore
  personal rows. Personal category allow-lists and business category allow-lists are enforced
  separately (a business-only category is rejected on the personal endpoint and the reverse).
- UI: the personal transaction list contained only `Groceries for hostel`, `Practice set for DSA`,
  `Movie ticket`, … and **none** of the business rows (`Counter sales`, `Shop rent`); the business
  list showed only `[DEMO]` business rows.
- CSV: the personal transactions export contained no business rows, and the invoice export
  contained no personal rows.
- Structural: every table carries `workspace_id`, every query filters on it, and a request naming a
  workspace of the wrong type is rejected with **400** instead of reading the other book.

**Evidence (test):** `Criterion 5 — business rows do NOT change personal totals`,
`Criterion 5 — personal rows do NOT appear in business totals`,
`Business invoice not readable through a personal workspace`,
`Personal workspace cannot use business customer API`.
**Evidence (UI):** `business list shows business entries`, `business list hides personal entries`,
`individual CSV excludes business rows`, `CSV excludes personal data`.

---

## 6. Customer/vendor CRUD is safe

**Requirement:** no silent cascading delete of financial records.

**How it was verified**

- Create, read, update, list (search + archived filter) and delete all work.
- Deleting a customer with invoices returns **409** with an explanation; deleting a vendor with
  bills does the same. The message names how many records block it:
  *"Sharma Traders cannot be deleted because it is linked to 1 invoice and 1 transaction.
  Archive it instead to keep your financial records intact."*
- Archiving hides the party from the default list but keeps every invoice; restore puts it back.
- The database also declares `invoices.customer_id … ON DELETE RESTRICT` as a second guard.
- Duplicate names and invalid input are rejected (409 / 400).
- In the browser the refusal appeared as an error toast and the customer remained in the table.

**Evidence (test):** `Deleting a customer with invoices is refused (409)`, `The refusal explains why`,
`Customer can be archived instead`, `Archived customer hidden from the default list`,
`Customer can be restored`, `Deleting a vendor with bills is refused (409)`,
`An unreferenced customer can be deleted`.
**Evidence (UI):** `delete of a customer with invoices is refused`, `customer still present after refused delete`.

---

## 7. Invoice totals are calculated server-side

**Requirement:** never trust client totals.

**How it was verified**

- The test sent an invoice with two lines (2 × ₹5,000 at 18% and 1 × ₹2,000 at 0%) **plus a
  client-supplied `total` of ₹1**. The stored result was subtotal **₹12,000**, tax **₹1,800**,
  total **₹13,800** — the ₹1 was ignored.
- Each line's `line_total_minor` and `tax_minor` are stored per item.
- An invoice with no items, a zero-priced invoice, a negative quantity, a tax rate outside 0–100, a
  due date before the invoice date, or an unknown/archived customer is rejected with **400**.
- In the UI, the editor preview (₹4,040 for 3 × ₹1,000 at 18% + 1 × ₹500) matched the stored total,
  and the viewer displayed the server's numbers.

**Evidence (test):** `Subtotal = ₹12,000 (ignores client value)`, `Tax = ₹1,800 (18% on the first line)`,
`Total = ₹13,800 (not the ₹1 sent by the client)`, `Line totals stored per item`,
`Rejects zero amount invoice (400)`, `Invoice with no line items rejected`.
**Evidence (UI):** `editor preview total = 3×1000 + 18% + 500 = 4,040`,
`viewer shows server total 4,040`.

---

## 8. Partial payments update the outstanding amount

**How it was verified**

- After a ₹5,000 payment against a ₹13,800 invoice: paid **₹5,000**, balance **₹8,800**, status
  **partially_paid**, and the dashboard receivable showed **₹8,800 — not the full ₹13,800**.
- A second payment of ₹8,800 closed it: balance ₹0, status **paid**.
- Over-payment (**400**), duplicate payment (**409**), negative amount (**400**) and an invalid date
  (**400**) were all refused.
- Removing a payment **reopens** the invoice (balance returns, status recomputed).
- Paying a fully paid invoice is refused with **409**.
- In the browser: the payment field was pre-filled with the outstanding balance, a partial payment
  turned the badge into **Partially paid** and reduced the balance to **₹3,040**, and an
  over-payment was refused with a message stating the maximum.

**Evidence (test):** `Paid = ₹5,000`, `Balance = ₹8,800`, `Status becomes partially_paid`,
`Dashboard receivable = ₹8,800 (not the full invoice)`, `Final payment accepted`, `Status becomes paid`,
`Payment larger than the balance rejected (400)`, `Duplicate payment rejected (409)`,
`Removing a payment reopens the invoice`.
**Evidence (UI):** `payment amount pre-filled with balance`, `partial payment → status Partially
paid`, `partial payment reduces balance to ₹3,040`,
`over-payment rejected with a clear message`.

---

## 9. Overdue detection from due date + remaining balance

**How it was verified**

- Status is **not a column**; it is computed on read as
  `cancelled → draft → paid → overdue → partially_paid → unpaid`.
- A back-dated unpaid invoice was found by `?status=overdue`, while the **same invoice, once fully
  paid, stopped being overdue** — proving both halves of the rule (due date *and* remaining > 0).
- Reading the invoice repeatedly (simulating view/print) never changed its status.
- The dashboard exposes overdue invoices/bills in a *Needs Attention* panel; the UI test saw
  `Invoice DEMO-0002 — [DEMO] Gupta & Sons · Due 20 Oct 2026 · balance ₹9,440`.

**Evidence (test):** `Overdue filter finds the unpaid past-due invoice`,
`Overdue status derived, not stored`, `A fully paid past-due invoice is no longer overdue`,
`Reading/printing an invoice does not change its status`.
**Evidence (UI):** `outstanding receivable shown separately`, `overdue attention list populated`,
`opening an invoice does NOT mark it paid`.

---

## 10. Bill payments update the outstanding amount

**How it was verified**

- A bill of ₹4,000 + tax was created; total and balance were correct, status `unpaid`.
- A partial vendor payment moved the status to `partially_paid` with the balance reduced.
- Payments above the balance were refused (**400**) and a duplicate payment was refused (**409**).
- The dashboard payable showed the remaining amount, not the original total.
- In the browser, paying part of a bill reduced the outstanding amount on the cards (`bill payment
  reduces outstanding`, `bill outstanding total on the cards`).

**Evidence (test):** `Bill total includes tax (₹4,480)`, `Bill balance = ₹4,480`,
`Bill balance after partial payment = ₹3,000`, `Bill status is partially_paid`,
`Vendor payment above the balance rejected`, `Duplicate vendor payment rejected (409)`,
`Dashboard payable = ₹3,000`.
**Evidence (UI):** `bill payment reduces outstanding`, `bill outstanding total on the cards`.

---

## 11. Cash flow excludes unpaid invoices and unpaid bills

**How it was verified**

- `moneyIn` = recorded invoice payments + income transactions.
- `moneyOut` = recorded vendor bill payments + expense transactions.
- Outstanding documents are returned **separately** as `notYetReceived` / `notYetPaid`, and the UI
  labels them *"Unpaid invoices — this is not cash"*.
- The test created an extra unpaid ₹7,777 invoice and an unpaid ₹5,555 bill and confirmed that
  **neither changed cash in or cash out**.
- The movement list carries a direction (`in`/`out`) and the document type
  (`invoice_payment`, `bill_payment`, `income`, `expense`).

**Evidence (test):** `Cash in = recorded invoice payments + income transactions`,
`Cash out = recorded bill payments + expense transactions`,
`Unpaid receivables are reported separately, not as cash`,
`The ₹7,777 unpaid invoice adds nothing to cash in`,
`The ₹5,555 unpaid bill adds nothing to cash out`.
**Evidence (UI):** `cash flow money received shown`, `cash flow money paid shown`,
`unpaid invoices reported separately from cash`.

---

## 12. CSV exports contain the correct filtered records

**How it was verified**

- Content type is `text/csv`, the response is an attachment with a filename, a UTF-8 BOM is present,
  and the header row is followed by exactly the filtered rows.
- A filtered export (`from=…&to=…`) returned the one matching business row and nothing else.
- Amounts are plain numbers (`20000.00`) so spreadsheets can sum them; the invoice CSV includes the
  **computed** status column.
- Exports never cross workspaces: the personal CSV contained no business rows and the invoice CSV
  contained no personal rows.
- In the browser the four business exports and the personal export each downloaded a real file.
- Cells beginning with `=`, `+`, `-` or `@` are prefixed with `'` to block spreadsheet formula
  injection.

**Evidence (test):** `Transaction CSV returns CSV content type`, `CSV is a download`,
`CSV has a header row + the 1 matching row`, `CSV contains the filtered business row`,
`CSV excludes other workspace data`, `CSV amounts are plain numbers`,
`Invoice CSV includes computed status column`, `Personal CSV export contains only personal rows`.
**Evidence (UI):** `invoice CSV downloads`, `CSV contains a header and invoice rows`,
`CSV excludes personal data`, `individual CSV downloads`, `individual CSV excludes business rows`.

---

## 13. Migrations are non-destructive

**How it was verified**

- Migrations are append-only, versioned files applied by `src/migrations/index.js`, one
  transaction each, recorded in `schema_migrations`, with `PRAGMA foreign_key_check` afterwards.
- On a 1.0 database: all rows and fields preserved, quoted notes preserved, paise exact, two
  workspaces created (1 = Personal, 2 = My Business) with pre-existing rows assigned to Personal.
- **15 tables** created; `amount` kept as a generated `VIRTUAL` column so 1.0 code still reads it;
  no table was dropped.
- Re-running applies nothing (`Second run applies nothing`, data still intact).
- A fresh database starts clean with the two workspaces and zero transactions.
- On the live file the migration was verified against a snapshot with **0 differences**.

**Evidence:** `Migration: 23 passed, 0 failed` · `Re-running migrations is safe (idempotent)` ·
`New databases start correctly`.

---

## 14. Invalid amounts, dates and ids are rejected

**How it was verified** — every one of these returned the stated status, with a JSON error body and
no stack trace:

| Input | Result |
|---|---|
| `amount: -5` on a transaction | 400 |
| `amount: 0` | 400 |
| `transaction_date: "2026-02-31"` (not a real date) | 400 |
| Invoice with no line items | 400 |
| Invoice with quantity 0 / negative | 400 |
| Invoice with an unknown customer | 400 |
| Invoice with a computed total of 0 | 400 |
| Invoice due date before invoice date | 400 |
| Payment of `-100` | 400 |
| Payment above the outstanding balance | 400 |
| Bill amount invalid / bill date invalid | 400 |
| `/api/business/invoices/abc` (non-numeric id) | 400 |
| `/api/business/invoices/999999` (unknown id) | 404 |
| `/api/business/customers/999999` | 404 |
| `X-Workspace-Id: abc` | 400 |
| `X-Workspace-Id: 999` | 404 |
| Business invoice read with a personal workspace header | 400 |
| Duplicate invoice number / bill number / payment | 409 |
| Delete a customer that has invoices / a vendor that has bills | 409 |

**Evidence (test):** the `Rejects …` and `… -> 400/404/409` checks listed above.

---

## 15. The documented startup works

**How it was verified**

```bash
cd smartspend-expense-tracker
npm install
npm start
```

Actual banner:

```
  SmartSpend — Your money, clearly organised.
  ------------------------------------------------
  Database : .../smartspend-expense-tracker/expense-tracker.db
  Server   : http://localhost:3000
  Stop     : press Ctrl + C in this terminal
```

HTTP checks against that server:

```
GET /               -> 200
GET /api/health     -> 200  {"status":"ok","time":"…","version":"2.0.0"}
GET /app.js         -> 200
GET /js/invoices.js -> 200
GET /style.css      -> 200
```

The three npm scripts documented in the README all work: `npm start`, `npm test` (all three suites),
and `npm run seed` / `npm run seed:reset` / `npm run seed:business`.
The database file is created automatically on first run and is excluded from git.

---

## Not verified / out of scope (stated honestly)

| Item | Why |
|---|---|
| Secure multi-user authentication | There is none. The mode switcher is a local profile selection, and both the UI and this report say so. |
| Real tax correctness | Tax handling is a record-keeping estimate based on user-entered rates. Not advice, not filing. |
| Double-entry accounting / audit trail | Out of scope for this project; the UI calls the business numbers "basic bookkeeping estimates". |
| Old browsers without `<dialog>` | Falls back to a non-modal dialog; not tested on IE-class browsers. |
| Very large datasets | Verified at demo scale (tens/hundreds of rows), not millions. |
| Receipt images, bank import, multi-currency, password reset | Not implemented and not claimed anywhere. |
