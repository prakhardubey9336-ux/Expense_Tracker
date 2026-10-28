/**
 * public/js/login.js
 * ---------------------------------------------------------------------------
 * Behaviour of the login page (public/login.html).
 *
 * Responsibilities:
 *   1. Switch between the Sign in / Create account panels.
 *   2. Validate the fields before anything is sent.
 *   3. Call Supabase Auth through window.SmartSpendSupabase.
 *   4. Handle the three real outcomes: signed in, needs email confirmation,
 *      and an error the user has to fix.
 *   5. Offer "continue without an account" (local SQLite mode).
 *
 * Nothing here talks to the SmartSpend Express server — the server has no
 * login of its own. See docs/SUPABASE.md for what that means.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const auth = window.SmartSpendSupabase;

  /**
   * Storage that cannot throw. In a sandboxed preview frame `localStorage`
   * throws SecurityError on access, which used to make "Continue without an
   * account" do nothing at all (the flag was never written, so the guard sent
   * the visitor straight back here). See js/safe-storage.js.
   */
  const store =
    window.SmartSpendStore ||
    {
      get: () => null,
      set: () => {},
      remove: () => {},
      isPersistent: () => true,
    };

  /** True when a sign-in cannot be remembered (sandboxed frame, private mode). */
  const storageBlocked = !store.isPersistent();

  const $ = (selector) => document.querySelector(selector);
  const alertBox = $('#authAlert');
  const signInForm = $('#panelSignIn');
  const signUpForm = $('#panelSignUp');

  /* =====================================================================
     1. SMALL UI HELPERS
     ===================================================================== */

  function showAlert(kind, message) {
    alertBox.hidden = false;
    alertBox.className = `auth-alert is-${kind}`;
    alertBox.textContent = message;
  }

  function clearAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
  }

  /** Puts a button into a "working…" state so it cannot be double-clicked. */
  function setBusy(button, busy, busyLabel) {
    const label = button.querySelector('.auth-submit-label');
    if (!label) return;
    if (busy) {
      button.dataset.idleLabel = label.textContent;
      label.textContent = busyLabel;
      button.disabled = true;
      button.classList.add('is-busy');
    } else {
      label.textContent = button.dataset.idleLabel || label.textContent;
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  /**
   * Runs `run()` when the form is submitted — but also when the frame blocks
   * native form submission.
   *
   * A page inside `<iframe sandbox="allow-scripts">` (a preview pane, some
   * editors) is NOT allowed to submit forms: Chrome cancels the submission and
   * the `submit` event never fires, so a handler attached with
   * `addEventListener('submit', …)` is simply never called and the Sign in
   * button looks dead. The click event is still delivered, so we wait one tick
   * for the native path and take over only if it did not happen.
   */
  function wireForm(form, button, run) {
    let nativeHandled = false;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      nativeHandled = true;
      run();
    });

    const fallback = () => {
      nativeHandled = false;
      window.setTimeout(() => {
        if (!nativeHandled) run();
      }, 40);
    };

    button.addEventListener('click', fallback);
    // Enter inside a field normally submits the form; do the same if it cannot.
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') fallback();
    });
  }

  function switchPanel(name) {
    const isSignIn = name === 'signin';
    $('#tabSignIn').classList.toggle('is-active', isSignIn);
    $('#tabSignUp').classList.toggle('is-active', !isSignIn);
    $('#tabSignIn').setAttribute('aria-selected', String(isSignIn));
    $('#tabSignUp').setAttribute('aria-selected', String(!isSignIn));
    signInForm.hidden = !isSignIn;
    signUpForm.hidden = isSignIn;
    clearAlert();
    // Focus the first empty field — friendly for keyboard users.
    const first = (isSignIn ? signInForm : signUpForm).querySelector('input:not([type="hidden"])');
    if (first) first.focus();
  }

  /* =====================================================================
     2. THEME (the login page respects the app's saved choice)
     ===================================================================== */

  function applyTheme() {
    const saved = store.get('smartspend:theme');
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));
  }

  /* =====================================================================
     3. VALIDATION
     ===================================================================== */

  const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

  function validate({ email, password, confirmPassword }) {
    if (!email) return 'Enter your email address.';
    if (!looksLikeEmail(email)) return 'That does not look like an email address.';
    if (!password) return 'Enter your password.';
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return 'The two passwords do not match.';
    }
    if (confirmPassword !== undefined && password.length < 6) {
      // Supabase's own minimum (Authentication → Providers → Email). Keeping
      // the two numbers identical avoids "the form says yes, the server says no".
      return 'Use a password with at least 6 characters.';
    }
    return null;
  }

  /* =====================================================================
     4. SUCCESS → GO TO THE APP
     ===================================================================== */

  function goToApp() {
    auth.disableLocalMode();
    if (!storageBlocked) {
      window.location.replace('/');
      return;
    }
    // The session only exists in memory here, so loading "/" would drop it and
    // the guard would send the visitor straight back — a confusing loop.
    showAlert(
      'info',
      'Signed in, but this frame blocks browser storage, so SmartSpend cannot keep the session. ' +
        'Open the app in a normal browser tab (or use “Continue without an account” here) to stay signed in.'
    );
  }

  /* =====================================================================
     5. SIGN IN
     ===================================================================== */

  async function attemptSignIn() {
    clearAlert();

    const email = $('#signInEmail').value.trim();
    const password = $('#signInPassword').value;
    const problem = validate({ email, password });
    if (problem) {
      showAlert('error', problem);
      return;
    }

    const button = $('#signInSubmit');
    setBusy(button, true, 'Signing in…');
    try {
      const result = await auth.signIn({ email, password });
      if (!result.ok) {
        showAlert('error', result.error);
        return;
      }
      showAlert('success', 'Signed in. Opening your dashboard…');
      goToApp();
    } finally {
      setBusy(button, false);
    }
  }

  wireForm(signInForm, $('#signInSubmit'), attemptSignIn);

  /* =====================================================================
     6. CREATE ACCOUNT
     ===================================================================== */

  async function attemptSignUp() {
    clearAlert();

    const email = $('#signUpEmail').value.trim();
    const password = $('#signUpPassword').value;
    const displayName = $('#signUpName').value.trim();
    const problem = validate({ email, password, confirmPassword: password });
    if (problem) {
      showAlert('error', problem);
      return;
    }

    const button = $('#signUpSubmit');
    setBusy(button, true, 'Creating…');
    try {
      const result = await auth.signUp({ email, password, displayName });
      if (!result.ok) {
        showAlert('error', result.error);
        return;
      }

      if (result.needsConfirmation) {
        // This project has "Confirm email" switched on, so there is no session
        // yet. Say exactly what to do next instead of pretending it worked.
        // (switchPanel() clears the alert box, so the message is set after it.)
        $('#signInEmail').value = email;
        switchPanel('signin');
        showAlert(
          'info',
          `Account created. Check ${email} for the confirmation link, click it, then sign in here. ` +
            'Nothing arrived? Look in spam, or ask the project owner to switch off “Confirm email”.'
        );
        $('#signInPassword').focus();
        return;
      }

      showAlert('success', 'Account created. Opening your dashboard…');
      goToApp();
    } finally {
      setBusy(button, false);
    }
  }

  wireForm(signUpForm, $('#signUpSubmit'), attemptSignUp);

  /* =====================================================================
     7. PASSWORD RESET (sends Supabase's recovery email)
     ===================================================================== */

  $('#forgotPassword').addEventListener('click', async () => {
    const email = $('#signInEmail').value.trim();
    if (!looksLikeEmail(email)) {
      showAlert('error', 'Type your email above first, then press “Forgot your password?” again.');
      $('#signInEmail').focus();
      return;
    }
    clearAlert();
    showAlert('info', 'Sending the reset email…');

    // GoTrue's recovery endpoint. The link inside the email must be allowed in
    // Supabase → Authentication → URL Configuration → Redirect URLs.
    const response = await fetch(`${window.SMARTSPEND_SUPABASE.url}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        apikey: window.SMARTSPEND_SUPABASE.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    }).catch(() => null);

    if (response && response.ok) {
      showAlert('info', `If an account exists for ${email}, a reset link is on its way.`);
    } else {
      showAlert('error', 'Could not send the reset email right now. Try again in a minute.');
    }
  });

  /* =====================================================================
     8. LOCAL MODE
     ===================================================================== */

  $('#localModeBtn').addEventListener('click', () => {
    auth.enableLocalMode();
    auth.clearSession();
    // With storage blocked the flag cannot survive the navigation, so carry the
    // decision in the URL instead (?local=1) — the guard understands both.
    window.location.replace(storageBlocked ? '/?local=1' : '/');
  });

  /* =====================================================================
     9. WIRING
     ===================================================================== */

  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
  });

  // Arrow keys move between the two tabs, like a real tab list.
  $('.auth-tabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = $('#tabSignIn').classList.contains('is-active') ? 'signup' : 'signin';
    switchPanel(next);
    (next === 'signup' ? $('#tabSignUp') : $('#tabSignIn')).focus();
  });

  // Show / hide password.
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Show' : 'Hide';
      button.setAttribute('aria-pressed', String(!showing));
      button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      input.focus();
    });
  });

  // Live password strength hint on the sign-up form.
  $('#signUpPassword').addEventListener('input', (event) => {
    const value = event.target.value;
    const hint = $('#passwordHint');
    if (!value) {
      hint.textContent = 'At least 6 characters. Longer is stronger — try a passphrase.';
      return;
    }
    if (value.length < 6) {
      hint.textContent = `${6 - value.length} more character${6 - value.length === 1 ? '' : 's'} needed.`;
    } else if (value.length < 12) {
      hint.textContent = 'Good. Longer is stronger — 12+ is better.';
    } else {
      hint.textContent = 'Nice and long. Remember to save it in a password manager.';
    }
  });

  /** Report whether Supabase is reachable, so the page never lies about it. */
  async function checkSupabase() {
    const node = $('#supabaseStatus');
    try {
      const response = await fetch(`${window.SMARTSPEND_SUPABASE.url}/auth/v1/settings`, {
        headers: { apikey: window.SMARTSPEND_SUPABASE.publishableKey },
      });
      if (!response.ok) throw new Error('bad status');
      const settings = await response.json();
      const emailOn = settings.external && settings.external.email;
      const confirmOn = settings.mailer_autoconfirm === false;
      node.textContent = emailOn
        ? confirmOn
          ? 'Supabase connected · email confirmation required'
          : 'Supabase connected'
        : 'Supabase reachable, but email sign-in is disabled';
      node.dataset.state = 'ok';
    } catch {
      node.textContent = 'Supabase unreachable — local mode still works';
      node.dataset.state = 'warn';
    }
  }

  /* =====================================================================
     10. BOOT
     ===================================================================== */

  (async function boot() {
    applyTheme();
    switchPanel('signin');

    // 1. Can this browser remember anything at all?
    if (storageBlocked) {
      const notice = $('#storageNotice');
      if (notice) {
        notice.hidden = false;
        notice.textContent =
          'This page is inside a sandboxed frame that blocks browser storage, so a sign-in cannot be remembered. ' +
          'Use “Continue without an account” to look around, or open the app in a normal browser tab (npm start → http://localhost:3000).';
        notice.dataset.tone = 'warn';
      }
    }

    // 2. Why did we land here? Say it instead of showing a bare form.
    const params = new URLSearchParams(window.location.search);
    const expired = params.get('expired') === '1';
    const authError = params.get('error_description') || params.get('error');
    if (expired) {
      showAlert('info', 'Your session expired or was signed out elsewhere. Sign in again, or continue without an account.');
    } else if (authError) {
      showAlert('error', `Supabase sent back: ${decodeURIComponent(authError.replace(/\+/g, ' '))}`);
    }

    // Already signed in? Skip the page entirely.
    const session = await auth.getSession();
    if (session && session.user) {
      window.location.replace('/');
      return;
    }

    // Returning from a confirmation or recovery link: Supabase appends the
    // tokens to the URL fragment, so pick them up instead of asking again.
    const hash = window.location.hash || '';
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken) {
        // Store the session exactly as signIn() would — through the client, so
        // the shape stays normalised and storage failures stay harmless.
        auth.adoptSession({
          accessToken,
          refreshToken: params.get('refresh_token'),
          expiresAt: params.get('expires_at'),
        });
        const user = await auth.getUser();
        if (user) {
          const isRecovery = params.get('type') === 'recovery';
          showAlert(
            'success',
            isRecovery
              ? 'Reset link accepted. Taking you to your dashboard…'
              : 'Email confirmed. Taking you to your dashboard…'
          );
          setTimeout(goToApp, 600);
          return;
        }
      }
    }

    checkSupabase();
  })();
})();
