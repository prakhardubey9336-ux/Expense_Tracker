/**
 * public/js/auth-guard.js
 * ---------------------------------------------------------------------------
 * Runs BEFORE app.js on the dashboard page.
 *
 * What it does
 *   1. Looks for a Supabase session (or the local-mode flag) in storage.
 *      If neither exists it sends the visitor to /login.html — synchronously,
 *      with no network call, so the dashboard never flashes behind the login.
 *   2. If a session exists, revalidates it in the background. A revoked or
 *      expired token logs the user out and returns them to the login page.
 *   3. Injects a small "who is signed in" panel at the bottom of the sidebar,
 *      with a Sign out button, and shows a LOCAL MODE badge when applicable.
 *
 * IMPORTANT, AND SAID PLAINLY IN THE UI AND THE README:
 * this is *client-side* gating. The Express server that serves /api/* has no
 * knowledge of Supabase tokens, so anyone who can reach the local server can
 * still call the API directly. Your Supabase rows are the part that is
 * genuinely protected, because Row Level Security enforces ownership in the
 * database itself. See docs/SUPABASE.md.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const auth = window.SmartSpendSupabase;
  const SESSION_KEY = 'smartspend:supabase-session';
  const store =
    window.SmartSpendStore ||
    { get: () => null, set: () => {}, remove: () => {}, isPersistent: () => true };

  /**
   * `/?local=1` — used by the login page when the browser refuses localStorage
   * (a sandboxed preview frame, for example). In that situation the local-mode
   * flag cannot survive the navigation, so the decision travels in the URL
   * instead of silently failing and bouncing the visitor back to the login page.
   */
  const urlLocal = new URLSearchParams(window.location.search).get('local') === '1';
  if (urlLocal && auth && auth.enableLocalMode) auth.enableLocalMode();

  /* ---------------------------------------------------------------------
     1. The synchronous gate (no flash, no network)
     --------------------------------------------------------------------- */

  let hasSession = false;
  try {
    hasSession = Boolean(store.get(SESSION_KEY));
  } catch {
    hasSession = false;
  }

  const localMode = auth && auth.isLocalMode ? auth.isLocalMode() : false;

  if (!hasSession && !localMode) {
    // `replace` keeps the login page out of the back-button history.
    // `?nostorage=1` only adds an explanation on the login page when this
    // browser cannot remember a sign-in at all.
    const suffix = store.isPersistent && store.isPersistent() ? '' : '?nostorage=1';
    window.location.replace(`/login.html${suffix}`);
    return;
  }

  /* ---------------------------------------------------------------------
     1b. Say so, loudly, when storage is blocked
     --------------------------------------------------------------------- */
  // Better an honest note at the top of the page than buttons that appear to
  // work and quietly forget everything.
  function showStorageNotice() {
    if (store.isPersistent && store.isPersistent()) return;
    const bar = document.createElement('div');
    bar.className = 'storage-notice';
    bar.id = 'storageNotice';
    bar.setAttribute('role', 'status');
    bar.textContent =
      'Preview mode: this frame blocks browser storage, so this session is not remembered. ' +
      'Reloading returns to the login page. Everything else works normally.';
    // Straight onto <body>: .app-header is not on every layout, and prepending
    // into a hidden wrapper made the notice invisible.
    document.body.prepend(bar);
  }

  showStorageNotice();

  /* ---------------------------------------------------------------------
     2. Sidebar account panel
     --------------------------------------------------------------------- */

  function buildAccountPanel() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer) return null;

    const panel = document.createElement('div');
    panel.className = 'account-panel';
    panel.id = 'accountPanel';
    panel.innerHTML = '';

    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    panel.append(avatar);

    const meta = document.createElement('div');
    meta.className = 'account-meta';
    const name = document.createElement('strong');
    name.id = 'accountName';
    name.textContent = localMode ? 'Local mode' : 'Signed in';
    const email = document.createElement('span');
    email.id = 'accountEmail';
    email.textContent = localMode ? 'data stays on this computer' : 'checking…';
    meta.append(name, email);
    panel.append(meta);

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'btn btn-ghost btn-sm account-signout';
    out.id = 'accountSignOut';
    out.textContent = localMode ? 'Sign in' : 'Sign out';
    panel.append(out);

    footer.prepend(panel);
    return panel;
  }

  const panel = buildAccountPanel();

  function paintAccount(user) {
    if (!panel) return;
    const name = panel.querySelector('#accountName');
    const email = panel.querySelector('#accountEmail');
    const avatar = panel.querySelector('.account-avatar');

    if (!user) {
      name.textContent = 'Local mode';
      email.textContent = 'data stays on this computer';
      avatar.textContent = 'L';
      avatar.dataset.mode = 'local';
      panel.dataset.mode = 'local';
      return;
    }

    const label = (user.displayName || user.email || 'You').trim();
    name.textContent = user.displayName || 'Signed in';
    email.textContent = user.email || '';
    avatar.textContent = label.slice(0, 1).toUpperCase();
    avatar.dataset.mode = 'cloud';
    panel.dataset.mode = 'cloud';
    panel.title = `Signed in with Supabase as ${user.email}`;
  }

  /* ---------------------------------------------------------------------
     3. Sign out / go to login
     --------------------------------------------------------------------- */

  async function signOut() {
    const button = panel && panel.querySelector('#accountSignOut');
    if (button) {
      button.disabled = true;
      button.textContent = 'Signing out…';
    }
    try {
      await auth.signOut();
    } finally {
      auth.disableLocalMode();
      window.location.replace('/login.html');
    }
  }

  if (panel) {
    panel.querySelector('#accountSignOut').addEventListener('click', () => {
      const isLocal = panel.dataset.mode === 'local';
      if (isLocal) {
        // "Sign in" from local mode just opens the login page.
        auth.disableLocalMode();
        window.location.replace('/login.html');
        return;
      }
      const confirmed = window.confirm('Sign out of SmartSpend on this browser?');
      if (confirmed) signOut();
    });
  }

  /* ---------------------------------------------------------------------
     4. Validate the session in the background
     --------------------------------------------------------------------- */

  (async function validate() {
    if (!auth) return;

    if (localMode && !hasSession) {
      paintAccount(null);
      return;
    }

    const user = await auth.getUser();
    if (!user) {
      // Token revoked, expired beyond refresh, or Supabase unreachable/denied.
      if (!localMode) {
        auth.clearSession();
        window.location.replace('/login.html?expired=1');
        return;
      }
      paintAccount(null);
      return;
    }

    paintAccount({
      email: user.email,
      displayName: (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.full_name)) || null,
      emailConfirmed: Boolean(user.email_confirmed_at),
    });

    // A confirmed account may now leave local mode behind.
    if (localMode) auth.disableLocalMode();
  })();

  /* ---------------------------------------------------------------------
     5. Expose one helper for the rest of the app
     --------------------------------------------------------------------- */

  window.SmartSpendAuth = {
    signOut,
    getUser: () => auth.getUser(),
    isLocalMode: () => (auth.isLocalMode ? auth.isLocalMode() : false),
  };
})();
