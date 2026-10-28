/**
 * public/js/cloud.js
 * ---------------------------------------------------------------------------
 * The Settings → "Account & Cloud" card.
 *
 * It is deliberately small and honest: it proves the Supabase connection by
 * reading and writing the signed-in user's row in `public.profiles`. If the
 * table does not exist yet (schema.sql not run), it says so instead of
 * pretending everything is fine.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const SS = window.SS;
  if (!SS) return;

  const supa = window.SmartSpendSupabase;
  const $ = (selector) => document.querySelector(selector);

  function setStatus(text, state) {
    const node = $('#cloudStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
  }

  /**
   * Loads the profile row for the signed-in user.
   * Returns { row } on success, { missingTable: true } when schema.sql has not
   * been run, or { error } for anything else.
   */
  async function loadProfile() {
    const result = await supa.restSelect('profiles', {
      select: 'id,email,display_name,default_mode,created_at',
      limit: 1,
    });

    if (result.ok) return { row: Array.isArray(result.data) ? result.data[0] || null : result.data };

    const data = result.data || {};
    // PGRST205 = "Could not find the table … in the schema cache".
    if (data.code === 'PGRST205' || /could not find the table/i.test(data.message || '')) {
      return { missingTable: true };
    }
    return { error: data.message || 'Could not read the profile row.' };
  }

  async function saveProfile(displayName) {
    const user = await window.SmartSpendAuth.getUser();
    if (!user) return { error: 'Your session expired. Sign in again.' };

    // The trigger in schema.sql normally creates the row at signup; upserting
    // here means an older account (or a failed trigger) still works.
    const existing = await loadProfile();
    if (existing.missingTable) return existing;

    if (existing.row) {
      const result = await supa.restUpdate('profiles', { id: user.id }, { display_name: displayName });
      return result.ok ? { ok: true } : { error: (result.data && result.data.message) || 'Update failed.' };
    }

    const result = await supa.restInsert('profiles', {
      id: user.id,
      email: user.email,
      display_name: displayName,
    });
    return result.ok ? { ok: true } : { error: (result.data && result.data.message) || 'Insert failed.' };
  }

  async function renderCloudCard() {
    if (!$('#cloudCard')) return;
    const isLocal = window.SmartSpendAuth.isLocalMode();
    const card = $('#cloudCard');
    const saveBtn = $('#cloudSaveBtn');
    const reloadBtn = $('#cloudReloadBtn');
    const nameInput = $('#cloudDisplayName');

    if (isLocal) {
      // Local mode has no Supabase session, so the whole card is pointless.
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const user = await window.SmartSpendAuth.getUser();
    if (!user) {
      setStatus('not signed in', 'warn');
      $('#cloudEmail').textContent = '—';
      $('#cloudConfirmed').textContent = '—';
      $('#cloudProfileState').textContent = '—';
      if (saveBtn) saveBtn.disabled = true;
      if (reloadBtn) reloadBtn.disabled = true;
      return;
    }

    $('#cloudEmail').textContent = user.email || '—';
    $('#cloudConfirmed').textContent = user.email_confirmed_at
      ? `Yes · ${new Date(user.email_confirmed_at).toLocaleDateString()}`
      : 'Not yet — check your inbox';

    const profile = await loadProfile();

    if (profile.missingTable) {
      setStatus('schema not installed', 'error');
      $('#cloudProfileState').textContent = 'Run supabase/schema.sql';
      $('#cloudHint').textContent =
        'The profiles table does not exist yet. Open Supabase → SQL Editor, paste supabase/schema.sql, press Run, then reload this card.';
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    if (profile.error) {
      setStatus('connection problem', 'error');
      $('#cloudProfileState').textContent = profile.error;
      if (saveBtn) saveBtn.disabled = true;
      return;
    }

    setStatus('connected', 'ok');
    $('#cloudProfileState').textContent = profile.row ? 'Found' : 'Not created yet (will be created on save)';
    $('#cloudHint').textContent = 'Stored in the profiles table, readable only by your account.';
    if (nameInput) {
      nameInput.value =
        (profile.row && profile.row.display_name) ||
        (user.user_metadata && user.user_metadata.display_name) ||
        '';
    }
    if (saveBtn) saveBtn.disabled = false;
  }

  function init() {
    if (!$('#cloudCard')) return;

    $('#cloudSaveBtn')?.addEventListener('click', async () => {
      const value = ($('#cloudDisplayName')?.value || '').trim();
      if (value.length > 60) {
        SS.toast('error', 'Display name must be 60 characters or fewer.');
        return;
      }
      const button = $('#cloudSaveBtn');
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const result = await saveProfile(value || null);
        if (result.missingTable) {
          SS.toast('error', 'The profiles table does not exist. Run supabase/schema.sql first.');
        } else if (result.error) {
          SS.toast('error', result.error);
        } else {
          SS.toast('success', 'Profile saved to Supabase.');
        }
      } finally {
        button.disabled = false;
        button.textContent = 'Save profile';
        renderCloudCard();
      }
    });

    $('#cloudReloadBtn')?.addEventListener('click', async () => {
      setStatus('checking…', 'idle');
      await renderCloudCard();
    });

    // Refresh whenever the Settings screen is opened. The Settings renderer
    // lives in personal-extras.js, so we expose a hook instead of registering
    // a second 'settings' renderer and silently replacing it.
    window.SmartSpendCloud = { refresh: renderCloudCard };
    renderCloudCard();
  }

  init();
})();
