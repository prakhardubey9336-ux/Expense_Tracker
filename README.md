# tests-ui — the browser tests, shipped

These are the **same scripts that were actually run** to verify the app. They are kept out of
`npm test` on purpose: they need [Playwright](https://playwright.dev) and a *running* server, while
`npm test` must work offline with nothing but `npm install`.

| File | Checks | What it proves |
|---|---|---|
| `ui2.js` | 74 | every screen in both modes: dashboard, transactions CRUD + filters, budgets, goals, recurring, analytics, insights, reports, customers, vendors, invoices (create, publish, partial payment, refused over-payment), bills, cash flow, CSV downloads, deep links, dark mode, mobile drawer, **zero uncaught console errors** |
| `features.js` | 22 | the 2.1 refinements: purpose chooser, month-over-month chips, daily budget line, filter presets, receivables aging, top customers, button styling and tap targets |
| `authtest.js` | 21 | the login page: anonymous redirect, tabs, validation, **a real wrong-password answer from Supabase**, password reveal, strength hint, local-mode entry, reload persistence, sign-out, **a forged token being rejected**, mobile layout |
| `authtest2.js` | 14 | the signed-in app with Supabase **mocked** (no throwaway accounts created): sidebar account panel, Settings → Account & cloud in both the *schema missing* and *connected* states, display-name save, cloud sign-out |
| `previewtest.js` | 9 | the page inside `<iframe sandbox="allow-scripts">`: storage-blocked notice, local mode really opens the app, honest sign-in message, no redirect loop |

## How to run them

```bash
# 1. Playwright (not a project dependency — install it once, anywhere)
cd tests-ui
npm init -y >/dev/null && npm install playwright
npx playwright install chromium

# 2. A throwaway database + demo business records, and a server on it
bash prepare.sh
PORT=3100 SMARTSPEND_DB=/tmp/smartspend-tests/ui.db npm start   # in another terminal

# 3. Run any suite (BASE matters only if you changed the port)
node ui2.js
node features.js
node authtest.js
node authtest2.js
node previewtest.js
```

Screenshots and `ui2-results.json` are written to `tests-ui/out/` (safe to delete).

## Two honest warnings

1. **`ui2.js` and `features.js` change data.** They create a customer, an invoice with two lines, a
   partial payment and a bill payment. Always run them against the copy from `prepare.sh`, never
   against your own `expense-tracker.db`. Several checks assume the **demo numbers**, so re-run
   `prepare.sh` before repeating a suite — a second run against the same file will fail on
   "outstanding receivable" style checks because the amounts have changed.
2. **`authtest2.js` and `previewtest.js` mock Supabase** with request interception, so they create
   no users in your project. `authtest.js` talks to the real project only for a wrong-password
   attempt, which cannot create anything.
