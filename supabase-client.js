/**
 * public/js/supabase-client.js
 * ---------------------------------------------------------------------------
 * A small, dependency-free Supabase client for SmartSpend.
 *
 * Why not `npm install @supabase/supabase-js`?
 *   The whole project is vanilla JS with no build step, and the library is a
 *   large download for the four things we need. Supabase is "just" two REST
 *   APIs, so we call them directly and every line stays readable:
 *
 *     POST /auth/v1/signup                  create an account
 *     POST /auth/v1/token?grant_type=…      sign in / refresh a session
 *     GET  /auth/v1/user                    who is this token?
 *     POST /auth/v1/logout                  revoke the session
 *     GET  /rest/v1/<table>                 read rows (PostgREST)
 *     POST /rest/v1/<table>                 insert rows
 *
 * The session (access token + refresh token + expiry) is kept under
 * `smartspend:supabase-session` through `window.SmartSpendStore`
 * (js/safe-storage.js), which falls back to memory when the browser refuses
 * localStorage — in a sandboxed preview frame, for example.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const config = window.SMARTSPEND_SUPABASE || {};
  const SESSION_KEY = 'smartspend:supabase-session';
  const LOCAL_MODE_KEY = 'smartspend:local-mode';

  /**
   * Storage goes through safe-storage.js so a blocked localStorage degrades to
   * an in-memory map instead of throwing mid-click. The fallback keeps the
   * three functions below identical to the plain localStorage calls.
   */
  const store =
    window.SmartSpendStore ||
    {
      get: (key) => {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* ignore */
        }
      },
      remove: (key) => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      },
      isPersistent: () => true,
    };

  if (!config.url || !config.publishableKey) {
    // Nothing else in this file can work without them, so fail loudly but
    // without breaking the page (the app can still be used in local mode).
    console.error('[SmartSpend] Supabase config missing — see public/js/supabase-config.js');
  }

  /* =====================================================================
     1. LOW-LEVEL FETCH
     ===================================================================== */

  /**
   * One place that knows how to talk to Supabase.
   * Returns { ok, status, data } — it never throws for an HTTP error, because
   * the login screen needs to show the message Supabase sent back.
   */
  async function request(path, { method = 'GET', body = null, token = null, headers = {} } = {}) {
    const url = `${config.url}${path}`;
    const auth = token || config.publishableKey;

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${auth}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      return {
        ok: false,
        status: 0,
        data: { message: 'Cannot reach Supabase. Check your internet connection.' },
      };
    }

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    return { ok: response.ok, status: response.status, data };
  }

  /* =====================================================================
     2. SESSION STORAGE
     ===================================================================== */

  /** Supabase answers with an auth payload; keep only what we need. */
  function normaliseSession(payload) {
    if (!payload || !payload.access_token) return null;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      // `expires_at` is an absolute unix time in seconds.
      expiresAt: payload.expires_at || Math.floor(Date.now() / 1000) + (payload.expires_in || 3600),
      user: payload.user
        ? {
            id: payload.user.id,
            email: payload.user.email,
            displayName:
              (payload.user.user_metadata && (payload.user.user_metadata.display_name || payload.user.user_metadata.full_name)) ||
              null,
            emailConfirmed: Boolean(payload.user.email_confirmed_at || payload.user.confirmed_at),
          }
        : null,
    };
  }

  function saveSession(payload) {
    const session = normaliseSession(payload);
    if (!session) return null;
    store.set(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function loadSession() {
    try {
      const raw = store.get(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      clearSession(); // a corrupted value must not lock the user out
      return null;
    }
  }

  function clearSession() {
    store.remove(SESSION_KEY);
  }

  /**
   * Takes the tokens that Supabase appends to the URL fragment after a
   * confirmation / recovery link (`#access_token=…&refresh_token=…`) and
   * stores them as a normal session. The user details arrive from getUser().
   */
  function adoptSession({ accessToken, refreshToken, expiresAt, user = null }) {
    if (!accessToken) return null;
    const session = {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: Number(expiresAt) || Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    store.set(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /** True when the access token is missing or within 60 seconds of expiring. */
  function isExpired(session) {
    if (!session || !session.expiresAt) return true;
    return session.expiresAt - 60 <= Math.floor(Date.now() / 1000);
  }

  /* =====================================================================
     3. AUTH (GoTrue)
     ===================================================================== */

  /**
   * Creates an account.
   * The project currently requires email confirmation, so this usually returns
   * `{ needsConfirmation: true }` instead of a session. Both cases are handled.
   */
  async function signUp({ email, password, displayName }) {
    const result = await request('/auth/v1/signup', {
      method: 'POST',
      body: {
        email,
        password,
        data: displayName ? { display_name: displayName } : {},
      },
    });

    if (!result.ok) return { ok: false, error: explain(result) };

    // A session comes back only when confirmation is switched off.
    if (result.data && result.data.access_token) {
      return { ok: true, session: saveSession(result.data), needsConfirmation: false };
    }
    return { ok: true, session: null, needsConfirmation: true };
  }

  async function signIn({ email, password }) {
    const result = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password },
    });
    if (!result.ok) return { ok: false, error: explain(result) };
    return { ok: true, session: saveSession(result.data) };
  }

  /** Exchanges the refresh token for a new access token. */
  async function refreshSession() {
    const session = loadSession();
    if (!session || !session.refreshToken) return null;

    const result = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refreshToken },
    });
    if (!result.ok) {
      clearSession();
      return null;
    }
    return saveSession(result.data);
  }

  /** Returns a session with a token that is valid for at least the next minute. */
  async function getSession() {
    const session = loadSession();
    if (!session) return null;
    if (!isExpired(session)) return session;
    return refreshSession();
  }

  /** Asks Supabase who the token belongs to (this also validates it). */
  async function getUser() {
    const session = await getSession();
    if (!session) return null;

    const result = await request('/auth/v1/user', { token: session.accessToken });
    if (!result.ok) {
      // 401 means the token was revoked or the user was deleted.
      if (result.status === 401) clearSession();
      return null;
    }
    return result.data;
  }

  async function signOut() {
    const session = loadSession();
    if (session) {
      // Best effort: revoke server-side, but never block the UI on it.
      await request('/auth/v1/logout', { method: 'POST', token: session.accessToken });
    }
    clearSession();
  }

  /**
   * Turns a Supabase error into a sentence a student can act on.
   * The raw messages are accurate but cryptic ("Invalid login credentials").
   */
  function explain(result) {
    const data = result.data || {};
    const code = data.error_code || data.code || '';
    const message = data.msg || data.message || 'Something went wrong.';

    if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
      return 'That email and password do not match an account. Check for typos, or create an account first.';
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
      return 'Your email is not confirmed yet. Open the confirmation link Supabase emailed you, then sign in.';
    }
    if (code === 'user_already_exists' || /already registered/i.test(message)) {
      return 'An account with this email already exists. Use “Sign in” instead.';
    }
    if (code === 'weak_password' || /password should be/i.test(message)) {
      return data.msg || 'That password is too weak. Use at least 6 characters.';
    }
    if (code === 'over_email_send_rate_limit' || result.status === 429) {
      return 'Too many emails were requested. Wait a minute and try again.';
    }
    if (result.status === 0) return message;
    if (result.status >= 500) return 'Supabase is having trouble right now. Please try again in a moment.';
    return message;
  }

  /* =====================================================================
     4. DATABASE (PostgREST)
     ===================================================================== */

  /**
   * Reads rows from a table.
   *   restSelect('profiles', { select: '*', eq: { user_id: '…' }, single: true })
   * `filters` are plain objects so callers never build SQL or URL strings by
   * hand. RLS still decides what actually comes back.
   */
  async function restSelect(table, { select = '*', eq = {}, order = null, limit = null, single = false } = {}) {
    const session = await getSession();
    if (!session) return { ok: false, status: 401, data: { message: 'Not signed in.' } };

    const params = new URLSearchParams({ select });
    for (const [column, value] of Object.entries(eq)) {
      params.append(column, `eq.${value}`);
    }
    if (order) params.append('order', order);
    if (limit) params.append('limit', String(limit));

    return request(`/rest/v1/${table}?${params.toString()}`, {
      token: session.accessToken,
      headers: single ? { Accept: 'application/vnd.pgrst.object+json' } : {},
    });
  }

  /** Inserts one row and asks PostgREST to return it. */
  async function restInsert(table, row) {
    const session = await getSession();
    if (!session) return { ok: false, status: 401, data: { message: 'Not signed in.' } };

    return request(`/rest/v1/${table}`, {
      method: 'POST',
      token: session.accessToken,
      body: row,
      headers: { Prefer: 'return=representation' },
    });
  }

  /** Updates the rows that match `eq`. */
  async function restUpdate(table, eq, patch) {
    const session = await getSession();
    if (!session) return { ok: false, status: 401, data: { message: 'Not signed in.' } };

    const params = new URLSearchParams();
    for (const [column, value] of Object.entries(eq)) params.append(column, `eq.${value}`);

    return request(`/rest/v1/${table}?${params.toString()}`, {
      method: 'PATCH',
      token: session.accessToken,
      body: patch,
      headers: { Prefer: 'return=representation' },
    });
  }

  /* =====================================================================
     5. LOCAL MODE
     ===================================================================== */

  /**
   * "Continue without an account" keeps the app usable offline with the local
   * SQLite database. It is a per-browser flag, nothing more.
   */
  function enableLocalMode() {
    store.set(LOCAL_MODE_KEY, '1');
  }

  function disableLocalMode() {
    store.remove(LOCAL_MODE_KEY);
  }

  function isLocalMode() {
    return store.get(LOCAL_MODE_KEY) === '1';
  }

  window.SmartSpendSupabase = {
    // auth
    signUp,
    signIn,
    signOut,
    getUser,
    getSession,
    refreshSession,
    loadSession,
    adoptSession,
    clearSession,
    // data
    restSelect,
    restInsert,
    restUpdate,
    // local mode
    enableLocalMode,
    disableLocalMode,
    isLocalMode,
    // helpers used by the login screen
    explain,
  };
})();
