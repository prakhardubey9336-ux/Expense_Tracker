# Supabase setup — accounts, profiles and receipts

> **Read this first.** SmartSpend 2.2 adds a **real login page** backed by Supabase Auth.
> Your *money data* (transactions, budgets, invoices…) still lives in the local SQLite file
> on your computer. Supabase currently stores **accounts** and, once you run the SQL below,
> **profile rows** and **receipt files**. Section 7 explains exactly what is and is not
> protected — please do not skip it before you write about "security" in your report.

---

## 1. What you need

| Item | Value for this project |
|---|---|
| Project URL | `https://taeldzvrcnywehuztsxf.supabase.co` |
| Publishable key | `sb_publishable_…` (in `public/js/supabase-config.js`) |
| Secret / service_role key | **not used anywhere — never put it in the frontend** |
| File it lives in | `public/js/supabase-config.js` |

### About the `NEXT_PUBLIC_…` names you were given

The dashboard shows the variables as:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Those `NEXT_PUBLIC_` prefixes are a **Next.js convention** — Next.js copies any variable with that
prefix into the browser bundle. SmartSpend is plain HTML + vanilla JS + Express, so there is no
build step to do that copy. The two values are therefore kept in
`public/js/supabase-config.js` as `url` and `publishableKey`.

If you prefer to keep the original names, create a `.env` file in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://taeldzvrcnywehuztsxf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

and change `public/js/supabase-config.js` to read them through a tiny Express route if you want
server-side injection. For a mini project the config file is simpler and does the same job: the
publishable key is *meant* to be visible in the browser.

---

## 2. Step 1 — run the SQL (this is the step people forget)

Supabase starts with an **empty database**. A publishable key **cannot create tables** — if you
try, the REST API answers `401 Secret API key required`. So the schema must be pasted once, by you,
in the dashboard:

1. Open <https://supabase.com/dashboard> → your project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this repo, copy **all** of it, paste it in.
4. Press **Run** (or Ctrl+Enter). You should see `Success. No rows returned`.

The script is **idempotent**: running it twice is safe (`create table if not exists`,
`drop policy if exists` before each `create policy`).

What it creates:

| Object | Purpose |
|---|---|
| `public.profiles` | one row per user: `id` (= `auth.users.id`), `email`, `display_name`, `default_mode`, `created_at`, `updated_at` |
| trigger `on_auth_user_created` | inserts the profile row automatically when someone signs up |
| trigger `profiles_touch_updated_at` | keeps `updated_at` honest |
| 4 RLS policies on `profiles` | select / insert / update / delete **only your own row** |
| storage bucket `receipts` (private) | receipt images/PDFs, one folder per user |
| 3 storage policies | a user can only touch files under `<their-uid>/…` |

### How to check it worked

```sql
select table_name from information_schema.tables where table_schema = 'public';
select * from storage.buckets where id = 'receipts';
```

You should see `profiles` and one bucket. In the app:
**Settings → Account & cloud** should change from
*"schema not installed"* to *"connected"*.

The card is honest on purpose — it shows the real answer from Supabase, not a green tick that
means nothing:

| Card says | Meaning |
|---|---|
| `connected` | your profile row was found |
| `schema not installed` | `schema.sql` has not been run yet (Supabase error `PGRST205`) |
| `offline` | the request to Supabase failed (no internet, or project paused) |

---

## 3. Step 2 — authentication settings

**Authentication → Providers → Email**

| Setting | Recommended for a demo/viva | Why |
|---|---|---|
| Enable email provider | ON | sign-in/sign-up by email |
| **Confirm email** | **OFF while testing, ON for the final submission** | see below |
| Minimum password length | 6 | matches the client-side hint |
| Secure email change | ON (default) | fine |

**Why confirmation matters:** with *Confirm email* **ON**, `POST /auth/v1/signup` returns a user but
**no session**. The person must click the link in their inbox first. On a college demo machine with
no access to the student mailbox, that looks like "signup is broken". Two honest options:

* **Turn confirmation OFF** for the demo → signup signs you straight in. Mention in your viva that
  you did this for the demo and would turn it back on for production.
* **Keep it ON** and use a real address you can open, then click the link. The app already shows
  *"Check your inbox… confirm your email"* instead of pretending you are logged in.

This project's live check reports `mailer_autoconfirm: false`, i.e. confirmation is currently **ON**.

**Authentication → URL Configuration**

| Field | Value |
|---|---|
| Site URL | `http://localhost:3000` |
| Redirect URLs (add all you use) | `http://localhost:3000/*`<br>`http://localhost:3100/*` (the test server)<br>`http://localhost:3000/login.html` |

Without the redirect URLs, the "confirm your email" and "reset password" links land on a
`localhost` page Supabase refuses to redirect to.

---

## 4. Step 3 — use it

1. `npm start` → open <http://localhost:3000>
2. You are redirected to `/login.html`.
3. **Create account** → email + password (6+ characters) → *Create account*.
   * Confirmation OFF → straight into the dashboard.
   * Confirmation ON → "Check your inbox" message; click the link, then sign in.
4. **Sign in** on any later visit. The session is kept in
   `localStorage['smartspend:supabase-session']` and re-validated with Supabase on every page load.
5. **Continue without an account** → local mode, exactly the 1.0/2.0 experience. Nothing is sent
   anywhere. Use this if the internet is down during your viva.

Session shape (so you can debug it in DevTools → Application → Local Storage):

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "expiresAt": 1793212072,
  "user": { "id": "uuid", "email": "…", "displayName": "…", "emailConfirmed": true }
}
```

Expired or hand-edited tokens do not get you in: `auth-guard.js` calls `GET /auth/v1/user` in the
background, and a rejected token is deleted and you land on `/login.html?expired=1`.

---

## 5. Error messages and what they mean

The client translates Supabase's JSON errors into sentences a human can act on
(`explain()` in `public/js/supabase-client.js`):

| Supabase answer | What the user sees |
|---|---|
| `400 invalid_credentials` | "That email and password do not match an account. Check for typos, or create an account first." |
| `422 … already registered` | "An account with this email already exists — try signing in instead." |
| `422 … password should be at least 6` | "Use at least 6 characters for the password." |
| `email_not_confirmed` | "Please confirm your email address first — check your inbox." |
| `over_email_send_rate_limit` | "Too many emails were sent. Please wait a minute and try again." |
| `PGRST205` | "Run `supabase/schema.sql` in the SQL editor." |
| network failure | "Supabase could not be reached. Check your internet connection." |

---

## 6. Where files go (storage)

The `receipts` bucket is **private**. Path convention enforced by the storage policy:

```
receipts/<user-uuid>/<anything>
```

A user can only read/write under their own uuid folder, because the policy compares
`auth.uid()::text` with the first folder segment. A public URL will not work on a private bucket —
the app must request a signed URL, which is the intended behaviour.

> **Status in 2.2:** the bucket and policies exist and are ready. Uploading receipts from the
> Transactions screen is **not wired up yet** — see section 8.

---

## 7. What this login does and does not protect (important for the report)

**Protected by Supabase (real security):**

* account creation, sign-in, sessions, password reset
* `public.profiles` — RLS means user A cannot read user B's row, even with the publishable key
* `storage.receipts` — same rule for files

**NOT protected (still a local demo):**

* **`/api/*` on the Express server has no Supabase verification.** The server does not check the
  token on requests. The login gate lives in the **browser** (`auth-guard.js`), so anyone who
  bypasses the page — `curl http://localhost:3000/api/transactions` — reaches the local data.
  This is acceptable for a single-user mini project running only on `localhost`, and it is stated
  here instead of being hidden.
* **Finance tables are still SQLite.** Transactions, budgets, goals, invoices, customers, bills and
  their reports live in `expense-tracker.db`. Two different browsers signing into the same account
  see **different** transaction lists, because each browser uses its own local database file.
  Only `profiles` and receipts use Supabase.
* **Mode switching is still not a permission.** Individual vs Business is a workspace id, not a
  role. Anyone in local mode can open either book.

If a future phase moves the finance tables to Supabase, the honest fix is:

1. add `user_id uuid default auth.uid()` to each table plus RLS policies (the same pattern as
   `profiles`), and
2. make `auth-guard.js` attach `Authorization: Bearer <accessToken>` and have Express verify it
   with `GET /auth/v1/user` before answering `/api/*`.

Neither is done in 2.2, and no part of the app claims otherwise.

---

## 8. Known limitations (do not claim these work)

| Feature | Status |
|---|---|
| Sign in / sign up / sign out / password reset email | **implemented and tested** |
| Profile row read + `display_name` save | **implemented and tested** |
| Receipt upload to the `receipts` bucket | bucket + policies ready, **no upload UI yet** |
| Finance data in Supabase | **not started** — still SQLite |
| Server-side token verification on `/api/*` | **not started** |
| Refresh-token auto-renewal | tokens refresh on page load via `refreshToken`; no background timer |
| OAuth (Google/GitHub) | not offered |

---

## 9. Tests that cover this

| Suite | What it proves |
|---|---|
| `npm test` (240 checks) | backend untouched by the auth work: 79 API + 138 business + 23 migration |
| `/tmp/uicheck/authtest.js` — 21 checks | anonymous redirect, tabs, validation, **real wrong-password error from Supabase**, local mode entry, reload persistence, local sign-out, forged-token rejection, mobile layout |
| `/tmp/uicheck/authtest2.js` — 14 checks | signed-in sidebar, Settings card in *missing-schema* and *connected* states, `display_name` save, cloud sign-out, login page skipping itself when already signed in |
| `ui2.js` (74) + `features.js` (22) | all 2.0/2.1 behaviour still works in local mode |
| `previewtest.js` — 9 checks | the page inside `<iframe sandbox="allow-scripts">`: storage-blocked notice, local mode really opens the app, honest sign-in message, no redirect loop |

The signed-in checks use a mocked Supabase (Playwright route interception) so **no throwaway
accounts are created in your project**. Only the wrong-password check talks to the real project,
and it cannot create anything.

---

## 10. Embedded / sandboxed frames (preview panes, online editors)

Some tools show a web page inside `<iframe sandbox="allow-scripts">`. That container is harsher
than a normal browser tab, and two of its rules hit a login page hard:

| What the frame blocks | What used to happen | What happens now |
|---|---|---|
| `localStorage` (opaque origin → `SecurityError`) | "Continue without an account" did **nothing**: the flag was never saved, the guard sent you back | `safe-storage.js` keeps values in memory, and the page says *"this frame blocks browser storage"* |
| Native form submission (`allow-forms` missing) | the `submit` event never fired, so **Sign in / Create account looked dead** | `wireForm()` also listens for click / Enter and runs the same code when the native submit did not happen |
| Cross-origin `fetch` without CORS headers | the dashboard showed *"Cannot reach the SmartSpend server"* although it was running | `server.js` sends `Access-Control-Allow-Origin: *` and answers `OPTIONS` (see §7 — no cookies are used, so this grants nothing new) |

The honest consequences inside such a frame:

* a **sign-in cannot be remembered**, so the app does not pretend — the login page says so instead
  of bouncing you back in a loop;
* **local mode** still opens the whole app (`/?local=1`, a URL flag the guard understands), but a
  reload returns to the login page;
* in a real tab everything works normally: `npm start`, then <http://localhost:3000>.

> None of this is needed for the viva. It exists because a page that *looks* fine but has dead
> buttons is worse than one that explains its limits.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Redirected to `/login.html` in a loop | `localStorage` blocked (private mode with cookies off) — use local mode |
| `401 Secret API key required` in the SQL editor | you pasted a `select` into the REST endpoint, not the SQL editor |
| Settings says `schema not installed` | `supabase/schema.sql` has not been run |
| Signup succeeds but you stay on the login page | email confirmation is ON — confirm via the inbox, or turn it off |
| `Email rate limit exceeded` | Supabase's free-tier mail cap; wait a minute or turn confirmation off |
| Everything works but data looks empty | expected: finance tables are per-browser SQLite (section 7) |
| Buttons do nothing inside a preview pane | that frame blocks form submission and storage — see §10, or open `http://localhost:3000` in a normal tab |
| "Cannot reach the SmartSpend server" in a preview | the frame sends `Origin: null`; the CORS headers in `server.js` handle it (2.2 and newer) |
| Login page shows `offline` | no internet, or the project is paused (free projects pause after inactivity) |
