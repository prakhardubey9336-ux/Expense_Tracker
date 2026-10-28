# SmartSpend API reference (v2.0)

Base URL: `http://localhost:3000/api`

All request and response bodies are JSON (except the CSV exports, which are `text/csv`).

---

## Contents

1. [Conventions](#1-conventions)
2. [Errors](#2-errors)
3. [Meta, health, workspaces, system](#3-meta-health-workspaces-system)
4. [Transactions (both modes)](#4-transactions-both-modes)
5. [Summary, budgets, analytics (individual)](#5-summary-budgets-analytics-individual)
6. [Savings goals (individual)](#6-savings-goals-individual)
7. [Recurring expenses (individual)](#7-recurring-expenses-individual)
8. [Reports and exports (individual)](#8-reports-and-exports-individual)
9. [Business dashboard and reports](#9-business-dashboard-and-reports)
10. [Customers](#10-customers)
11. [Vendors](#11-vendors)
12. [Invoices and payments](#12-invoices-and-payments)
13. [Vendor bills and payments](#13-vendor-bills-and-payments)
14. [Business CSV exports](#14-business-csv-exports)
15. [Status reference](#15-status-reference)

---

## 1. Conventions

### Workspaces

There is **no authentication**. Every record belongs to a *workspace*, and every request may say
which one it means:

```http
X-Workspace-Id: 2
```

Resolution order: `body.workspaceId` → `query.workspaceId` → `X-Workspace-Id` header →
the default workspace for the route's mode.

| Workspace | Type | Used by |
|---|---|---|
| `1` | `individual` | personal screens (`/api/transactions`, `/api/summary`, `/api/savings-goals`, …) |
| `2` | `business` | business screens (`/api/business/*`) |

- If the header is missing, the route's default mode is used (individual for `/api/transactions`,
  business for `/api/business/*`).
- If the header points at a **workspace of the wrong type**, the request fails with **400** rather
  than silently reading a different book.
- If the id does not exist → **404**. If it is not a positive integer → **400**.

Business routes always resolve a business workspace first, so it is impossible to create an invoice
in the personal book.

### Data formats

| Value | Format | Example |
|---|---|---|
| Money **sent** by the client | rupees, as a number | `4850.75` |
| Money **stored** | integer paise (`amount_minor`) | `485075` |
| Money **returned** | rupees, usually also with a `…Minor` sibling | `"total": 4850.75`, `"totalMinor": 485075` |
| Month | `YYYY-MM` | `"2026-10"` |
| Date | `YYYY-MM-DD` | `"2026-10-28"` |

### Response envelope

Single objects and lists are wrapped in `data`:

```json
{ "data": { "id": 12, "title": "Lunch" } }
{ "data": [ { "id": 12 }, { "id": 13 } ] }
```

List endpoints that paginate add their own keys:

```json
{
  "data": [ … ],
  "pagination": { "total": 42, "limit": 20, "offset": 0, "hasMore": true },
  "totals": { "income": 25000, "expense": 9077 }
}
```

Mutations may add a human-readable `message`:

```json
{ "data": { … }, "message": "Invoice INV-2026-0004 created." }
```

---

## 2. Errors

Every error has the same shape:

```json
{
  "error": {
    "message": "Please fix the highlighted fields.",
    "fields": { "amount": "Amount must be greater than 0." }
  }
}
```

`fields` is optional and maps a field name to a message the UI can show inline. Stack traces are
**never** sent to the client.

| Status | When |
|---|---|
| `200` | OK |
| `201` | Created |
| `400` | Validation failed (bad amount, date, id, workspace, over-payment, …) |
| `404` | Unknown id, or a record that belongs to another workspace |
| `409` | Conflict: duplicate invoice/bill number, duplicate payment, delete blocked by linked records |
| `500` | Unexpected server error (generic message only) |

---

## 3. Meta, health, workspaces, system

### `GET /api/meta`

App metadata and the allow-lists the UI builds its dropdowns from.

```json
{
  "app": "SmartSpend",
  "version": "2.0.0",
  "tagline": "Your money, clearly organised.",
  "categories": ["Food", "Travel", "…"],
  "personalCategories": ["Food", "…"],
  "personalIncomeCategories": ["Salary", "Freelance", "Other"],
  "businessCategories": ["Sales", "Purchases", "…"],
  "paymentMethods": ["cash", "upi", "card", "bank_transfer", "cheque", "other"],
  "recurrenceFrequencies": ["daily", "weekly", "monthly", "yearly"],
  "types": ["income", "expense"],
  "currentMonth": "2026-10",
  "modes": [ { "mode": "individual", "label": "Individual", "description": "…" }, … ]
}
```

### `GET /api/health`

```json
{ "status": "ok", "time": "2026-10-28T09:12:44.512Z", "version": "2.0.0" }
```

### `GET /api/workspaces`

The two books plus row counts.

```json
{
  "data": [
    { "id": 2, "name": "My Business", "type": "business", "transaction_count": 3, "invoice_count": 2, "customer_count": 2, "vendor_count": 1 },
    { "id": 1, "name": "Personal", "type": "individual", "transaction_count": 22, "invoice_count": 0, "customer_count": 0, "vendor_count": 0 }
  ]
}
```

### `GET /api/workspaces/:id`

One workspace, or `404`.

### `PATCH /api/workspaces/:id`

Rename a book.

```json
// request
{ "name": "Sharma Traders", "notes": "optional" }
```

### `GET /api/system/migrations`

```json
{
  "data": [ { "id": "001_init", "applied_at": "2026-10-28 15:11:47" }, … ],
  "counts": { "transactions": 22, "budgets": 3, "invoices": 2, "customers": 2, "vendors": 1 }
}
```

---

## 4. Transactions (both modes)

The same endpoint serves both modes; the workspace decides the data and the allowed categories.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/transactions` | List + pagination + filtered totals |
| GET | `/api/transactions/:id` | One transaction |
| POST | `/api/transactions` | Create (201) |
| PUT | `/api/transactions/:id` | Full update |
| PATCH | `/api/transactions/:id` | Partial update |
| DELETE | `/api/transactions/:id` | Delete |

### Query parameters

| Param | Example | Meaning |
|---|---|---|
| `search` | `?search=rent` | Matches title, category, notes |
| `category` | `?category=Food` | Exact category |
| `type` | `?type=expense` | `income` or `expense` |
| `month` | `?month=2026-10` | Whole month |
| `from`, `to` | `?from=2026-10-01&to=2026-10-31` | Date range (inclusive) |
| `customer_id`, `vendor_id` | `?vendor_id=3` | Business filtering |
| `limit`, `offset` | `?limit=20&offset=40` | Pagination (`limit` ≤ 500) |

### Request body

```json
{
  "type": "expense",
  "title": "Shop rent",
  "amount": 6000,
  "category": "Rent & Utilities",
  "transaction_date": "2026-10-05",
  "notes": "October rent",
  "payment_method": "bank_transfer",
  "tax_rate": 0,
  "customer_id": null,
  "vendor_id": null
}
```

`payment_method`, `tax_rate`, `customer_id` and `vendor_id` are **optional and business-only**; the
UI hides them in Individual mode. `tax_rate` is never assumed — omit it and no tax is recorded.

### Response

```json
{
  "data": [
    {
      "id": 28,
      "workspace_id": 2,
      "type": "expense",
      "title": "Shop rent",
      "category": "Rent & Utilities",
      "amount_minor": 600000,
      "amount": 6000,
      "transaction_date": "2026-10-05",
      "notes": "October rent",
      "payment_method": "bank_transfer",
      "tax_rate": 0,
      "customer_id": null,
      "vendor_id": null,
      "customer_name": null,
      "vendor_name": null,
      "invoice_reference": "",
      "created_at": "2026-10-28 09:00:00"
    }
  ],
  "pagination": { "total": 3, "limit": 20, "offset": 0, "hasMore": false },
  "totals": { "income": 32500, "expense": 6000 }
}
```

### Validation rules

- `title` 1–100 characters, required.
- `amount` must be a number greater than 0 and ≤ 1,000,000,000 (also enforced by a `CHECK` in SQL).
- `transaction_date` must be a real calendar date in `YYYY-MM-DD`.
- `category` must be in the allow-list **for that workspace type**.
- `notes` ≤ 500 characters.
- `payment_method` must be one of the six allowed values.
- `tax_rate` between 0 and 100.

---

## 5. Summary, budgets, analytics (individual)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/summary` | All-time totals (`?month=YYYY-MM` adds month totals) |
| GET | `/api/budgets` | Monthly budget (`?month=`), or the list with `?limit=` |
| PUT | `/api/budgets` | Save a month's budget (upsert) |
| DELETE | `/api/budgets` | Remove a month's budget |
| GET | `/api/category-budgets` | Per-category budgets for a month |
| PUT | `/api/category-budgets` | Save a category budget |
| DELETE | `/api/category-budgets` | Remove a category budget |
| GET | `/api/analytics/monthly` | Last N months (`?months=6`) |
| GET | `/api/analytics/categories` | Category totals (`?month=`) |
| GET | `/api/analytics/insights` | Rule-based insights (`?month=`) |

```json
// PUT /api/budgets
{ "month": "2026-10", "amount": 3000 }
```

```json
// GET /api/summary            (optionally ?month=YYYY-MM or ?from=&to=)
{
  "data": {
    "totalIncome": 10500,
    "totalExpenses": 2719,
    "balance": 7781,
    "savingsRate": 74.1,
    "incomeCount": 2,
    "expenseCount": 12,
    "highestCategory": { "category": "Food", "total": 630, "totalMinor": 63000, "count": 2 },

    // Present ONLY when a single ?month= is requested and the previous month
    // has at least one record. This is what the "vs last month" chips read.
    "previous": {
      "month": "2026-09",
      "totalIncome": 8500, "totalExpenses": 4368, "balance": 4132,
      "savingsRate": 48.61, "transactionCount": 8
    },
    "change": {
      "income": 23.5,        // percent change vs the previous month
      "expenses": -37.8,     // negative = spending less, which is good
      "balance": 88.3,
      "savingsRate": 25.5    // percentage POINTS, not percent
    }
  }
}
```

A `null` in `change` means *no baseline* (the previous month had zero income or zero expenses) —
the server says nothing rather than inventing a 100% jump. An all-time or range summary omits
`previous` and `change` entirely.

---

## 6. Savings goals (individual)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/savings-goals` | List (`?includeArchived=true`) |
| GET | `/api/savings-goals/:id` | One goal + its contributions |
| POST | `/api/savings-goals` | Create (201) |
| PUT | `/api/savings-goals/:id` | Update |
| DELETE | `/api/savings-goals/:id` | Delete (contributions cascade) |
| POST | `/api/savings-goals/:id/contributions` | Add (or withdraw) money |
| POST | `/api/savings-goals/:id/archive` | `{ "archived": true }` to archive, `false` to restore |

```json
// POST /api/savings-goals
{ "name": "New laptop", "target": 40000, "target_date": "2027-03-31", "notes": "optional" }
```

```json
// POST /api/savings-goals/1/contributions   (negative amount = withdrawal)
{ "amount": 15000, "contributed_on": "2026-10-05", "notes": "October savings" }
```

```json
// response
{
  "data": {
    "id": 1, "name": "New laptop", "target_minor": 4000000, "target": 40000,
    "saved": 15000, "remaining": 25000, "percent": 37.5,
    "isComplete": false, "contribution_count": 1, "is_archived": false
  }
}
```

Rules: progress is always `SUM(contributions)`; a withdrawal can never take a goal below zero
(**409**); `target` must be > 0.

---

## 7. Recurring expenses (individual)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/recurring` | All rules with `generatedCount` / `lastGeneratedOn` |
| GET | `/api/recurring/upcoming` | Expected payments (`?days=45`, default 45) |
| GET | `/api/recurring/:id` | One rule |
| POST | `/api/recurring` | Create (201) |
| PUT | `/api/recurring/:id` | Update |
| DELETE | `/api/recurring/:id` | Delete (generated transactions are kept) |
| POST | `/api/recurring/run` | Generate every due entry — **idempotent** |

```json
// POST /api/recurring
{
  "title": "House rent",
  "type": "expense",
  "category": "Rent",
  "amount": 8000,
  "frequency": "monthly",
  "start_date": "2026-09-01",
  "notes": "Paid by UPI",
  "is_active": true
}
```

```json
// POST /api/recurring/run  → first call
{ "data": { "createdCount": 2, "created": [ { "ruleId": 1, "title": "House rent", "date": "2026-09-01", "amount": 8000 }, … ] },
  "message": "2 recurring entries created." }

// second call, same day → nothing is duplicated
{ "data": { "createdCount": 0, "created": [] },
  "message": "No new entries were due — nothing was duplicated." }
```

Idempotency comes from the database, not from JavaScript: the partial unique index
`UNIQUE(recurring_rule_id, transaction_date)` plus `INSERT OR IGNORE`.

---

## 8. Reports and exports (individual)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/reports/monthly-summary` | Month-by-month income / expense / net / savings rate |
| GET | `/api/reports/tax` | Category tax estimate (`?from=&to=`) |
| GET | `/api/export/transactions.csv` | Transactions CSV (all filters of section 4 apply) |
| GET | `/api/export/monthly-summary.csv` | Monthly summary CSV (`?from=&to=`) |

```json
// GET /api/reports/monthly-summary?from=2026-08-01&to=2026-10-31
{
  "data": [
    { "month": "2026-10", "income": 10500, "expense": 10918, "net": -418,
      "savingsRate": -3.98, "incomeCount": 2, "expenseCount": 14 }
  ]
}
```

CSV responses set:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="smartspend-personal-transactions-<ts>.csv"
```

A UTF-8 BOM is included so Excel opens ₹-free numeric columns correctly, and any cell starting with
`=`, `+`, `-`, `@`, tab or CR is prefixed with `'` to block formula injection.

---

## 9. Business dashboard and reports

### `GET /api/business/dashboard`

`?month=YYYY-MM` or `?from=&to=` (optional), `?months=6` for the trend length.

```json
{
  "data": {
    "workspace": { "id": 2, "name": "My Business", "type": "business" },
    "from": null, "to": null,
    "revenue": 32500, "expenses": 6000, "netProfit": 26500, "profitMargin": 81.54,
    "revenueMinor": 3250000, "expensesMinor": 600000, "netProfitMinor": 2650000,
    "incomeCount": 2, "expenseCount": 1, "transactionCount": 3,
    "receivable": { "amount": 18240, "amountMinor": 1824000, "invoiceCount": 2,
                    "overdueAmount": 9440, "overdueCount": 1 },
    "payable":    { "amount": 3200, "amountMinor": 320000, "billCount": 1 },
    "cashFlow": {
      "moneyIn": 37500, "moneyOut": 7000, "net": 30500,
      "invoicePayments": 5000, "billPayments": 1000,
      "incomeTransactions": 32500, "expenseTransactions": 6000
    },
    "expenseByCategory": [ { "category": "Rent & Utilities", "total": 6000, "totalMinor": 600000, "count": 1, "percent": 100 } ],
    "monthlyTrend": [ { "month": "2026-10", "income": 32500, "expense": 6000, "balance": 26500, "netProfit": 26500 } ],
    "recentSales": [ { "id": 27, "title": "…", "category": "Sales", "transaction_date": "2026-10-12", "amount": 20000 } ],
    "recentExpenses": [ … ],
    "overdueInvoices": [ { "kind": "invoice", "id": 2, "number": "DEMO-0002", "party": "Gupta & Sons",
                           "due_date": "2026-10-20", "balance": 9440, "balance_minor": 944000 } ],
    "overdueBills": [ … ],

    // 2.1: how long the outstanding money has been waiting, oldest first.
    "aging": {
      "totalMinor": 2128000, "total": 21280,
      "lateMinor": 944000, "late": 9440,
      "buckets": [
        { "key": "current", "label": "Not due yet", "amountMinor": 1184000, "amount": 11840, "count": 2, "percent": 55.6 },
        { "key": "d1_30",   "label": "1–30 days",  "amountMinor": 944000,  "amount": 9440,  "count": 1, "percent": 44.4 },
        { "key": "d31_60",  "label": "31–60 days", "amountMinor": 0,       "amount": 0,     "count": 0, "percent": 0 },
        { "key": "d60_plus","label": "60+ days",   "amountMinor": 0,       "amount": 0,     "count": 0, "percent": 0 }
      ]
    },

    // 2.1: customers ranked by invoiced value (drafts and cancelled invoices excluded).
    "topCustomers": [
      { "customerId": 1, "name": "Sharma Traders", "invoiceCount": 1,
        "invoiced": 13800, "invoicedMinor": 1380000,
        "outstanding": 8800, "outstandingMinor": 880000 }
    ]
  }
}
```

**Definitions**

- Bucket boundaries are computed on the **server** from `due_date` and today's date, so a browser in
  another timezone cannot disagree with the database. A negative age (not due yet) falls in
  `current`; `late` is the sum of the three past-due buckets.

- `revenue` = sum of `income` transactions (recorded money earned).
- `expenses` = sum of `expense` transactions.
- `netProfit` = `revenue − expenses`.
- `receivable` / `payable` are **outstanding documents**, not cash. They are never added to revenue.
- `cashFlow.moneyIn` = recorded invoice payments + income transactions.
  `cashFlow.moneyOut` = recorded vendor payments + expense transactions.

### `GET /api/business/cash-flow`

`?from=&to=` optional.

```json
{
  "data": {
    "from": "2026-10-01", "to": "2026-10-31",
    "moneyIn": 28000, "moneyOut": 7480, "net": 20520,
    "notYetReceived": 16577, "notYetPaid": 8555,
    "entries": [
      { "kind": "invoice_payment", "id": 3, "entry_date": "2026-10-15",
        "label": "Invoice INV-2026-0001 — Sharma Traders", "method": "upi",
        "amount": 5000, "amount_minor": 500000, "direction": "in" },
      { "kind": "expense", "id": 28, "entry_date": "2026-10-05", "label": "Shop rent",
        "method": "bank_transfer", "amount": -6000, "amount_minor": -600000, "direction": "out" }
    ]
  }
}
```

`kind` is one of `invoice_payment`, `bill_payment`, `income`, `expense`.
Unpaid invoices/bills appear **only** in `notYetReceived` / `notYetPaid`.

### `GET /api/business/reports/tax`

```json
{
  "data": {
    "from": null, "to": null,
    "categories": [ { "category": "Rent & Utilities", "count": 1, "net": 6000, "tax": 0, "total": 6000,
                      "netMinor": 600000, "taxMinor": 0 } ],
    "totals": { "count": 1, "net": 6000, "tax": 0, "total": 6000 },
    "invoiceTax": { "collectedOnInvoices": 3780, "invoiceCount": 2 },
    "disclaimer": "Tax figures are estimates for your own records. SmartSpend does not determine which expenses are deductible and applies only the tax rates you enter. This is not tax or legal advice."
  }
}
```

### `GET /api/business/reports/payment-methods`

```json
{ "data": [ { "method": "bank_transfer", "type": "income", "total": 20000, "totalMinor": 2000000, "count": 1 } ] }
```

---

## 10. Customers

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/business/customers` | List (`?search=`, `?include_archived=true`) |
| GET | `/api/business/customers/:id` | One customer |
| POST | `/api/business/customers` | Create (201) |
| PUT | `/api/business/customers/:id` | Update |
| DELETE | `/api/business/customers/:id` | Delete — **409** while referenced |
| POST | `/api/business/customers/:id/archive` | Archive / restore |

```json
// POST
{ "name": "Sharma Traders", "contact_person": "Rekha Sharma",
  "email": "rekha@example.com", "phone": "98100 12345",
  "address": "Karol Bagh, New Delhi", "notes": "optional" }
```

```json
// list row
{ "id": 1, "workspace_id": 2, "name": "Sharma Traders", "contact_person": "Rekha Sharma",
  "email": "rekha@example.com", "phone": "98100 12345", "address": "…",
  "notes": null, "is_archived": false,
  "invoice_count": 1, "outstanding_minor": 880000,
  "created_at": "…", "updated_at": "…" }
```

### Deleting safely

```
DELETE /api/business/customers/1  →  409
{
  "error": {
    "message": "Sharma Traders cannot be deleted because it is linked to 1 invoice and 1 transaction. Archive it instead to keep your financial records intact."
  }
}
```

There is **no silent cascade**. The database also declares
`invoices.customer_id … ON DELETE RESTRICT` as a second guard. Use
`POST /archive { "archived": true }` to hide a party from pickers while keeping history.

---

## 11. Vendors

Identical contract to [Customers](#10-customers), mounted at `/api/business/vendors`.
List rows expose `bill_count` and `outstanding_minor` instead of `invoice_count`.
Deleting a vendor with bills or transactions is blocked with **409** in exactly the same way.

---

## 12. Invoices and payments

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/business/invoices` | List + summary (`?search=`, `?status=`, `?customer_id=`, `?from=`, `?to=`, `?limit=`, `?offset=`) |
| GET | `/api/business/invoices/next-number` | `{ "invoice_number": "INV-2026-0004" }` |
| GET | `/api/business/invoices/:id` | One invoice + `items[]` + `payments[]` |
| POST | `/api/business/invoices` | Create (201) |
| PUT | `/api/business/invoices/:id` | Update (recalculates totals) |
| DELETE | `/api/business/invoices/:id` | Delete (items and payments cascade) |
| POST | `/api/business/invoices/:id/cancel` | `{ "cancelled": true }` to cancel, `false` to restore |
| POST | `/api/business/invoices/:id/publish` | `{ "is_draft": true }` to move back to draft |
| GET | `/api/business/invoices/:id/payments` | Payment list |
| POST | `/api/business/invoices/:id/payments` | Record a payment (201) |
| DELETE | `/api/business/invoices/:id/payments/:paymentId` | Remove a payment |

### Creating an invoice

```json
{
  "invoice_number": "INV-2026-0004",
  "customer_id": 2,
  "invoice_date": "2026-10-25",
  "due_date": "2026-11-24",
  "notes": "Thank you for your business.",
  "is_draft": false,
  "items": [
    { "description": "Design work", "quantity": 3, "unit_price": 1000, "tax_rate": 18 },
    { "description": "Setup fee",   "quantity": 1, "unit_price": 500,  "tax_rate": 0 }
  ]
}
```

**Any `total`, `subtotal`, `tax` or `amount` you send is ignored.** The server computes:

```
line_total = round(quantity × unit_price)
line_tax   = round(line_total × tax_rate / 100)
subtotal   = Σ line_total
tax        = Σ line_tax
total      = subtotal + tax
```

With the body above: subtotal `₹3,500`, tax `₹540`, total `₹4,040`.

Rejected with **400**: no items, quantity ≤ 0, unit price < 0, tax rate outside 0–100, invalid
dates, `due_date` before `invoice_date`, an unknown/archived/foreign customer, a computed total of 0.
Rejected with **409**: an `invoice_number` that already exists in this workspace (uniqueness is
per workspace, so two businesses could both use `2026-001`).

### Invoice response

```json
{
  "data": {
    "id": 4, "workspace_id": 2, "invoice_number": "INV-2026-0001",
    "customer_id": 1, "customer_name": "Sharma Traders", "customer_email": "…",
    "invoice_date": "2026-10-10", "due_date": "2026-11-09",
    "subtotal_minor": 1200000, "tax_minor": 180000, "total_minor": 1380000,
    "subtotal": 12000, "tax": 1800, "total": 13800,
    "paid_minor": 500000, "paid": 5000,
    "balance_minor": 880000, "balance": 8800,
    "status": "partially_paid", "isPaid": false, "isOverdue": false,
    "is_draft": false, "is_cancelled": false, "notes": "…",
    "items": [ { "description": "A4 paper boxes", "quantity": 2, "unit_price": 5000,
                 "unit_price_minor": 500000, "tax_rate": 18, "line_total": 10000,
                 "line_total_minor": 1000000, "tax_minor": 180000, "position": 0 } ],
    "payments": [ { "id": 1, "amount": 5000, "amount_minor": 500000,
                    "paid_on": "2026-10-15", "method": "upi", "reference": "UPI-9931" } ]
  }
}
```

### Recording a payment

```json
// POST /api/business/invoices/1/payments
{ "amount": 5000, "paid_on": "2026-10-15", "method": "upi", "reference": "UPI-9931" }
```

| Situation | Result |
|---|---|
| Payment ≤ outstanding balance | **201**, invoice status recalculated |
| Payment > outstanding balance | **400** `"Payment cannot be more than the outstanding balance (₹8,800)."` |
| Same payment recorded twice | **409** |
| Payment on a draft or cancelled invoice | **400** |
| Invalid/negative amount or bad date | **400** |

Removing a payment (`DELETE …/payments/:paymentId`) **reopens** the invoice: the balance goes back
up and the status is recomputed. Nothing marks an invoice paid except payments adding up to the
total — opening, hovering or printing an invoice never changes anything.

### List response envelope

```json
{
  "data": {
    "rows": [ … ],
    "summary": { "count": 2, "total": 23240, "paid": 5000, "outstanding": 18240,
                 "overdueCount": 1, "overdueAmount": 9440 },
    "limit": 100, "offset": 0
  }
}
```

---

## 13. Vendor bills and payments

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/business/bills` | List + summary (`?search=`, `?status=`, `?vendor_id=`, `?from=`, `?to=`) |
| GET | `/api/business/bills/:id` | One bill + payments |
| POST | `/api/business/bills` | Record a bill (201) |
| PUT | `/api/business/bills/:id` | Update |
| DELETE | `/api/business/bills/:id` | Delete (payments cascade) |
| POST | `/api/business/bills/:id/cancel` | Cancel / restore |
| POST | `/api/business/bills/:id/payments` | Record a payment (201) |
| DELETE | `/api/business/bills/:id/payments/:paymentId` | Remove a payment |

```json
// POST /api/business/bills
{
  "vendor_id": 1,
  "bill_number": "DPM/2026/77",
  "bill_date": "2026-10-06",
  "due_date": "2026-11-05",
  "amount": 4000,
  "tax_rate": 5,
  "description": "Paper stock",
  "notes": "30 day credit"
}
```

A bill's total is `amount_minor + tax_minor` (there is no separate subtotal column).
Rules mirror invoices: unique `bill_number` per vendor/workspace (**409** on duplicates), payments
cannot exceed the outstanding balance (**400**), duplicate payments are refused (**409**), and
status is derived from payments + due date.

---

## 14. Business CSV exports

All honour the same filters as their JSON counterparts and are scoped to the business workspace.

| Endpoint | Columns |
|---|---|
| `GET /api/business/export/transactions.csv` | Date, Type, Title, Category, Amount (INR), Payment method, Customer, Vendor, Invoice ref, Notes |
| `GET /api/business/export/invoices.csv` | Invoice number, Customer, Invoice date, Due date, Status, Subtotal, Tax, Total, Paid, Balance |
| `GET /api/business/export/bills.csv` | Bill number, Vendor, Bill date, Due date, Status, Amount, Tax, Total, Paid, Balance |
| `GET /api/business/export/tax-report.csv` | Category, Entries, Net (INR), Tax (INR), Total (INR) |

Numbers are plain (`20000.00`) so a spreadsheet can sum them, and the status column is the
**computed** status at download time.

---

## 15. Status reference

Invoices and bills share one derived status set.

| Status | When |
|---|---|
| `draft` | `is_draft = 1` — not issued, payments refused |
| `cancelled` | `is_cancelled = 1` |
| `paid` | recorded payments ≥ total |
| `overdue` | balance > 0 **and** `due_date` < today |
| `partially_paid` | 0 < paid < total, due date not passed |
| `unpaid` | paid = 0, due date not passed |

Precedence: `cancelled` → `draft` → `paid` → `overdue` → `partially_paid` → `unpaid`.
Because the status is computed on read, a document becomes `overdue` by itself the next day — no
cron job, no stored flag, no drift.
