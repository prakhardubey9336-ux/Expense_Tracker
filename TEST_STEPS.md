# SmartSpend 2.0 — manual test script

Everything below is written so you can run it by hand and see the expected result. It takes about
20 minutes. Nothing here changes your personal data except the records you deliberately create
(Part B creates business records only, in the separate business book).

---

## Before you start

```bash
cd smartspend-expense-tracker
npm install
npm start
```

Open <http://localhost:3000>.

> **Tip:** if you want a clean, repeatable run, back up first:
> `cp expense-tracker.db expense-tracker.db.backup`
> and afterwards restore it with `cp expense-tracker.db.backup expense-tracker.db`
> (stop the server before copying).

---

## Part A — Individual mode (the 1.0 features must still work)

| # | What to do | What you should see |
|---|---|---|
| A0 | Open the app in a **fresh browser profile** (or delete `smartspend:onboarded` in DevTools → Application → Local Storage and reload) | A full-screen card asks *"What will you use SmartSpend for?"* with **Individual** and **Business**. **Continue** is disabled until you pick one; it opens the book you chose; reloading does not ask again. Settings → **Change my purpose** reopens it. |
| A1 | Look at the dashboard | Four cards (Total Income, Total Expenses, Available Balance, Savings Rate), two charts, the budget bar and the recent transactions list all show real numbers |
| A2 | Sidebar | **Individual** is highlighted; the caption reads *"Personal book · Personal"*; the business screens are not in the menu |
| A3 | Transactions → type part of a title in **Search** | The table narrows; the summary line says what is filtered |
| A4 | Add Transaction → Expense, "Test coffee", ₹40, Food, today | Success toast; the new row is at the top; Total Expenses went up by ₹40 |
| A5 | Click the ✏️ on that row → change ₹40 to ₹50 → Save Changes | The amount updates; the totals and charts update too |
| A6 | Click 🗑️ on that row → confirm | Row disappears; totals go back |
| A7 | Add Transaction → clear the title and press Save | Inline red message "Please enter a title."; nothing is saved |
| A8 | Budgets → pick this month → amount 3000 → Save | Ring/bar update; usage and remaining recalculate |
| A9 | Analytics, Insights | Charts and insight cards match the data you just created |
| A10 | Savings Goals → **New goal** "Test goal", ₹10,000 → Save | Round goal card shows 0% saved, ₹10,000 to go |
| A11 | On that goal press **Add money** → ₹2,500 | Bar fills to **25%**, card reads `Saved ₹2,500 of ₹10,000`, side panel "Still to save ₹7,500" |
| A12 | Add money again with **−₹9,000** | Rejected: *"A goal cannot go below zero"* (409) — nothing changes |
| A13 | Recurring → **New rule** "Test rent", Rent, ₹1,000, monthly, first due date last month → Save | Rule appears; *Upcoming Expected Payments* lists it; "Generated" shows 0 |
| A14 | Press **Generate due entries** | Toast "1 recurring entry created" and the Generated count becomes 1 |
| A15 | Press **Generate due entries** again | *"No new entries were due — running it again created nothing"*; the count stays 1. **This is the idempotency test.** |
| A16 | Reload the page and press it a third time | Still nothing new — reloading never duplicates anything |
| A17 | Reports → check the default range is this month → change **Quick pick** to last month | Both tables refresh; the CSV links follow the visible range |
| A18 | Reports → **Transactions CSV** | A `.csv` file downloads, opening in Excel with one row per transaction in the range |
| A19 | Settings | Workspace name, the six applied migrations and the note about there being no login |
| A20 | Delete the "Test goal" and the "Test rent" rule | Both removed without touching any other data |
| A21 | Dashboard → look at the small chips next to each card's caption | `↑ 23.5%` style chips comparing the selected month with the previous one. Hover one: the tooltip names the month. Falling expenses are shown in teal, rising expenses in red. Pick a month whose previous month has no records → **no chip at all** (not "100%"). |
| A22 | Dashboard → Monthly Budget card | Under the usage line there is a **daily allowance**: *"That is about ₹70.25 a day for the 4 days left in October 2026."* For an over-budget month it says *"You are ₹… over"* instead. |
| A23 | Transactions → press **This month** in *Quick range* | From = the 1st of this month, To = the last day; the table narrows and the chip is highlighted. **All time** clears both dates. Typing a date by hand removes the highlight. |
| A24 | With a quick range applied, press the CSV export | The file contains exactly the filtered rows — the same filter feeds the table and the file. |

---

## Part B — Business mode

Switch with the **Business** button at the top of the sidebar.

| # | What to do | What you should see |
|---|---|---|
| B1 | Switch to Business | Caption becomes *"Business book · My Business"*; the menu changes to Dashboard / Transactions / Customers / Vendors / Invoices / Bills & Payables / Cash Flow / Reports / Settings; the month picker in the top bar disappears; a banner says *"Basic bookkeeping estimates — not audited financial statements."* |
| B2 | Note the six cards | Revenue, Business Expenses, Net Profit, Outstanding (customers), Outstanding (vendors), Net Cash Flow. Empty on a fresh business book (`₹0`) — that is correct, not a bug |
| B3 | **Cross-mode check** | Switch to Individual → Transactions: none of the business rows appear. Switch back: none of the personal rows appear. Totals in both modes are unaffected by the other |
| B4 | Customers → **Add customer** "Test Customer", phone, email | Row appears with `0` invoices and `₹0` outstanding |
| B5 | Vendors → **Add vendor** "Test Vendor" | Same |
| B6 | Transactions → Add Transaction → Income "Test sale", ₹10,000, Sales, payment method UPI → Save | Business dashboard Revenue = ₹10,000, Net Profit = ₹10,000; the row shows the party column and method |
| B7 | Transactions → Add Transaction → Expense "Test cost", ₹2,000, Purchases, method cash | Revenue ₹10,000, Expenses ₹2,000, **Net Profit ₹8,000** |
| B8 | Invoices → **New invoice** | Customer picker lists only business customers; the number is pre-filled like `INV-2026-0001` |
| B9 | Fill: customer "Test Customer", today's date, due date +30 days, line 1 = "Work" × 3 @ ₹1,000 tax 18%, line 2 = "Setup" × 1 @ ₹500 tax 0% | The preview under the lines reads Subtotal ₹3,500, Tax ₹540, Total **₹4,040** |
| B10 | Save the invoice | It appears with status **Unpaid**, balance ₹4,040, and the cards above update (Invoiced ₹4,040, Outstanding ₹4,040) |
| B11 | Click 👁️ (view) on it, scroll, close | The invoice renders like a document. **The status is still Unpaid** — viewing never pays it |
| B12 | With the viewer open press **Print / Save as PDF** | The browser print preview shows only the invoice (no sidebar, no buttons). Cancel it. Status is still Unpaid |
| B13 | Press **Record payment** → amount 1,040 → Save | Status becomes **Partially paid**, balance **₹3,000**, dashboard "Outstanding (customers)" drops to ₹3,000 |
| B14 | Record payment again with 5,000 | Refused: *"Maximum is ₹3,000"* — nothing is saved (**over-payment guard**) |
| B15 | Record payment 1,040 again (same date/method) | Refused with a duplicate-payment message (**409**) |
| B16 | Pay the remaining 3,000 | Status becomes **Paid**, balance ₹0, the "Record payment" button becomes "Fully paid" |
| B17 | Create a second invoice with a **due date in the past** | Status is **Overdue** immediately, and it appears under *Needs Attention* on the dashboard |
| B18 | Invoices → try creating another invoice with the **same number** as the first | Refused with 409 and a clear message; the editor stays open |
| B19 | Bills & Payables → **Record bill** "TEST/1", vendor Test Vendor, ₹4,000, tax 5%, due +30 days | Status Unpaid; total ₹4,200; Outstanding (vendors) = ₹4,200 |
| B20 | Press **Pay** → 200 | Status becomes **Partially paid**, balance ₹4,000, and the payable card drops |
| B21 | Cash Flow → look at the three cards | *Money received* counts only recorded payments + income entries; *Money paid* counts only vendor payments + expense entries. The **unpaid** part of the overdue invoice is shown separately under **"Not yet received"** — it is **not** in money received |
| B22 | Cash Flow → set a from/to range that excludes everything → Apply | All zeros, and the movement list says no money moved in this range |
| B23 | Reports → read the top banner | *"Estimates for your records — not tax or legal advice."* |
| B24 | Reports → check the tax table | It lists only categories where you entered data, with net / tax / total. **No tax is invented**: if you never entered a rate, tax is ₹0 |
| B25 | Reports → **Invoices** CSV | Downloads a file whose Status column contains the computed statuses (unpaid / partially paid / paid / overdue) |
| B26 | Customers → try **Delete** on "Test Customer" (who has invoices) | Refused: *"…cannot be deleted because it is linked to 1 invoice…"*. The customer stays. (**No silent cascade**) |
| B27 | Customers → press the archive button instead | The customer is hidden from the list; tick **Show archived** to see it again. All its invoices still exist |
| B28 | Switch to Individual and open Reports | Nothing from Business appears anywhere |
| B29 | Open `http://localhost:3000/#invoices` in a new tab | The app opens **in Business mode**, on Invoices |
| B30 | Toggle the theme (sun/moon) in Business mode | Dark mode works on every business screen, and the charts redraw with the new colours |
| B31 | Business Dashboard → scroll to **Receivables Aging** | Four labelled buckets (Not due yet / 1–30 days / 31–60 / 60+) drawn as bars, plus *"₹9,440 of ₹21,280 is already past its due date."* With nothing outstanding it says every invoice is settled. |
| B32 | Business Dashboard → **Top Customers** | Customers ranked by invoiced value with a rupee figure each; hovering shows their invoice count and outstanding amount. **All customers** opens the Customers screen. |
| B33 | Pay an overdue invoice in full, then return to the dashboard | That money leaves the aging chart and the *"past its due date"* sentence drops by the same amount — the buckets come from live payments, not from a stored snapshot. |

---

## Part C — Server-side checks (optional, but this is what the markers like)

These prove the guards are in the **server**, not just hidden in the browser.

```bash
# 1. Server-side invoice totals: send a fake total, the server must ignore it
curl -s -X POST http://localhost:3000/api/business/invoices \
  -H 'Content-Type: application/json' -H 'X-Workspace-Id: 2' \
  -d '{"invoice_number":"CURL-1","customer_id":1,"invoice_date":"2026-10-01","due_date":"2026-12-01",
       "items":[{"description":"x","quantity":1,"unit_price":100,"tax_rate":0}],"total":999999}' \
  | python3 -m json.tool | grep -E '"(total|subtotal)"'
# → "total": 100  (the 999999 was ignored)

# 2. Over-payment is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/business/invoices/1/payments \
  -H 'Content-Type: application/json' -H 'X-Workspace-Id: 2' \
  -d '{"amount":99999999,"paid_on":"2026-10-28","method":"cash"}'
# → 400

# 3. Invalid amount is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/transactions \
  -H 'Content-Type: application/json' -H 'X-Workspace-Id: 1' \
  -d '{"type":"expense","title":"bad","amount":-5,"category":"Food","transaction_date":"2026-10-28"}'
# → 400

# 4. Invalid date is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/transactions \
  -H 'Content-Type: application/json' -H 'X-Workspace-Id: 1' \
  -d '{"type":"expense","title":"bad","amount":5,"category":"Food","transaction_date":"2026-02-31"}'
# → 400

# 5. A personal workspace cannot be used for business records
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/business/dashboard -H 'X-Workspace-Id: 1'
# → 400

# 6. Unknown id
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/business/invoices/999999 -H 'X-Workspace-Id: 2'
# → 404

# 7. Non-numeric id
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/business/invoices/abc -H 'X-Workspace-Id: 2'
# → 400
```

Clean up the `CURL-1` invoice in the UI afterwards.

---

## Part D — Automated suites

```bash
npm test
```

Expected (this is the current, verified output):

```
  79 passed, 0 failed, 79 total checks        npm run test:api
  Business / acceptance: 138 passed, 0 failed npm run test:business
  Migration: 23 passed, 0 failed              npm run test:migration
```

The suites use their own temporary database (`SMARTSPEND_DB`), so your real
`expense-tracker.db` is never touched.

---

## If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Every card empty, red toast "Cannot reach the SmartSpend server" | The Node process stopped | `npm start` again |
| A business card shows ₹0 everywhere | The business book really is empty | Add a transaction, or `npm run seed:business` |
| "Charts unavailable" boxes | `public/assets/vendor/chart.umd.min.js` missing | Restore it, or accept the tables (they still work) |
| `EADDRINUSE` | Port 3000 already in use | `PORT=4000 npm start` |
| Invoice payment says "already paid" | The balance really is 0 | Check the balance column |
