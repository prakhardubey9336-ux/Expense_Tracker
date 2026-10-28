/**
 * public/js/safe-storage.js
 * ---------------------------------------------------------------------------
 * A tiny wrapper around `localStorage` that never throws.
 *
 * WHY THIS EXISTS
 * ---------------
 * `localStorage` is not always available. It throws `SecurityError` when:
 *   • the page is shown inside `<iframe sandbox="allow-scripts">` (an opaque
 *     origin — this is how some preview panes and online editors embed a page),
 *   • the browser is in a strict private mode,
 *   • the user blocked "cookies and site data".
 *
 * Browsers raise this error on *property access*, so even `typeof` is unsafe in
 * the worst case. Before this file the login buttons silently did nothing in
 * those environments: `localStorage.setItem` threw, the flag was never saved,
 * and the guard sent the visitor straight back to the login page. Now:
 *
 *   • values are kept in memory as a fallback, so a click always *does* something;
 *   • `SmartSpendStore.isPersistent()` tells the UI the truth, so the page can
 *     say "this frame blocks storage — the session cannot be remembered"
 *     instead of pretending everything is fine.
 *
 * Keys are plain strings; values are always stored as strings (JSON when needed)
 * so the API is a drop-in replacement for `localStorage.getItem/setItem`.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const memory = new Map();

  /** Detect once, at load, whether real persistence works. */
  let persistent = false;
  try {
    const probe = '__smartspend_probe__';
    window.localStorage.setItem(probe, '1');
    const readBack = window.localStorage.getItem(probe);
    window.localStorage.removeItem(probe);
    persistent = readBack === '1';
  } catch {
    persistent = false;
  }

  function get(key) {
    if (persistent) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        persistent = false; // storage became unavailable mid-session
      }
    }
    return memory.has(key) ? memory.get(key) : null;
  }

  function set(key, value) {
    const text = String(value);
    memory.set(key, text);
    if (persistent) {
      try {
        window.localStorage.setItem(key, text);
      } catch {
        persistent = false;
      }
    }
  }

  function remove(key) {
    memory.delete(key);
    if (persistent) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        persistent = false;
      }
    }
  }

  /** JSON helpers, because every value we store is an object or a flag. */
  function getJSON(key) {
    const raw = get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null; // a hand-edited or truncated value must not crash the page
    }
  }

  function setJSON(key, value) {
    set(key, JSON.stringify(value));
    return value;
  }

  window.SmartSpendStore = {
    get,
    set,
    remove,
    getJSON,
    setJSON,
    /** false → values live only until the page is reloaded. */
    isPersistent: () => persistent,
    /** Human sentence used by the login page and the in-app banner. */
    why() {
      return persistent
        ? ''
        : 'This page is running in a sandboxed frame (or private mode) that blocks browser storage.';
    },
  };
})();
