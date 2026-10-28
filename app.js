/* ==========================================================================
   SmartSpend — app.js
   --------------------------------------------------------------------------
   This is the only JavaScript file the browser runs. It is plain vanilla JS
   (no frameworks) and is organised into clear sections:

     1. Small helpers (DOM building, formatting)
     2. Application state (+ mode / workspace)
     3. API wrapper (all fetch() calls live here)
     4. Theme handling
     5. Navigation between views (lazy: a view renders when opened)
     6. Dashboard: summary cards, charts, budget, recent transactions
     7. Transactions: list, filters, pagination, add/edit/delete
     8. Monthly budget
     9. Analytics
    10. Insights
    11. Toasts, dialogs, shared UI helpers and boot sequence

   SMARTSPEND 2.0 adds two modes. This file owns everything shared by both:

     - the Individual/Business mode switcher and the workspace id sent with
       every request (header X-Workspace-Id)
     - generic helpers the other two files reuse: openForm(), statusBadge(),
       downloadCsv(), refreshAfterMutation()

   The extra screens live in separate files that extend this one through the
   global `SS` object, so nothing here has to be duplicated:

     js/business.js         business dashboard, customers, vendors, bills,
                            cash flow, tax reports
     js/invoices.js         invoices: list, editor, viewer/print, payments
     js/personal-extras.js  savings goals, recurring expenses, reports, settings

   SECURITY NOTE: every value that comes from the database is inserted into
   the page with textContent (via the el() helper below) — never with
   innerHTML. That is what stops a transaction title containing HTML from
   being executed as markup (XSS).
   ========================================================================== */

'use strict';

(() => {
  /* =====================================================================
     1. HELPERS
     ===================================================================== */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /**
   * el('div', { class: 'card', text: 'hi' }, childNode)
   * A tiny, safe element factory. `text` always uses textContent.
   */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'html') node.innerHTML = value; // only used with static icon markup
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Static SVG markup helper — safe because the input is a hard-coded id. */
  const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"></use></svg>`;

  const moneyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });

  /** ₹4,850 — with paise only when needed. */
  function money(value) {
    const n = Number(value) || 0;
    const hasPaise = Math.abs(n % 1) > 0.004;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: hasPaise ? 2 : 0,
    }).format(n);
  }

  /** Short version for chart axis labels: ₹12k, ₹1.2L */
  function moneyShort(value) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `₹${Math.round(n / 1000)}k`;
    return `₹${Math.round(n)}`;
  }

  function percent(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0%';
    const rounded = Number(n.toFixed(digits));
    return `${rounded}%`;
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /** '2026-03' -> 'March 2026' */
  function monthLabel(month) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return '—';
    const [y, m] = month.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }

  /** '2026-03' -> 'Mar' */
  function monthShort(month) {
    const m = Number(month.split('-')[1]);
    return SHORT_MONTHS[m - 1];
  }

  /** '2026-03-05' -> '05 Mar 2026' (parsed as UTC so time zones can't shift the day) */
  function formatDate(isoDate) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return isoDate;
    return `${String(d).padStart(2, '0')} ${SHORT_MONTHS[m - 1]} ${y}`;
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm || `${singular}s`}`;
  }

  function debounce(fn, wait = 280) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // Chart colours follow the indigo/violet brand. Two slots per hue family keep
  // neighbouring categories distinguishable without introducing a second theme.
  const CATEGORY_COLORS = {
    // personal
    Food: '#4f46e5',
    Transport: '#0ea5e9',
    Shopping: '#8b5cf6',
    Rent: '#6366f1',
    Education: '#2563eb',
    Healthcare: '#e11d48',
    Entertainment: '#14b8a6',
    Other: '#94a3b8',
    // kept for 1.0 data
    Travel: '#0ea5e9',
    Bills: '#f59e0b',
    Health: '#e11d48',
    Salary: '#4338ca',
    Freelance: '#7c3aed',
    // business
    Sales: '#4f46e5',
    'Other Income': '#818cf8',
    Purchases: '#2563eb',
    'Rent & Utilities': '#f59e0b',
    'Salaries & Wages': '#8b5cf6',
    Marketing: '#ec4899',
    'Software & Subscriptions': '#06b6d4',
    'Travel & Transportation': '#0ea5e9',
    'Equipment & Maintenance': '#64748b',
    'Other Operating Expenses': '#94a3b8',
  };
  const FALLBACK_PALETTE = [
    '#4f46e5', '#0ea5e9', '#8b5cf6', '#f59e0b', '#2563eb',
    '#14b8a6', '#ec4899', '#94a3b8', '#7c3aed', '#06b6d4',
  ];
  const colourFor = (category, index = 0) =>
    CATEGORY_COLORS[category] || FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];

  /* =====================================================================
     2. APPLICATION STATE
     ===================================================================== */

  const state = {
    view: 'dashboard',
    // ---- 2.0 mode handling -------------------------------------------
    // `mode` decides the navigation, the category list and which API the
    // screens call. `workspaceId` is the database scope for every request.
    mode: 'individual',
    workspaceId: 1,
    workspace: null,
    workspaces: [],
    month: currentMonth(), // month used by dashboard / analytics / budget / insights
    meta: { categories: [], types: [] },
    summary: null, // all-time totals
    monthSummary: null, // totals for state.month
    categoryBreakdown: null,
    monthlySeries: [],
    insights: [],
    budget: null,
    editingId: null,
    tx: { rows: [], total: 0, offset: 0, limit: 20, loading: false },
    filters: { search: '', category: '', type: '', month: '', from: '', to: '' },
    charts: { monthly: null, category: null, analyticsDoughnut: null, analyticsBar: null },
    busy: false,
  };

  /**
   * Every view the app knows about.
   *   mode   — which mode owns it ('both' = shared screen, scoped by workspace)
   *   render — key in the `renderers` registry (see section 5)
   *
   * Adding a screen therefore only means: add an entry here, add a <section>
   * with data-view="<key>" in index.html, and register a renderer.
   */
  const VIEW_META = {
    // ---------------- Individual ----------------
    dashboard: { mode: 'individual', title: 'Dashboard', subtitle: 'An overview of your money in one place.', render: 'dashboard' },
    budget: { mode: 'individual', title: 'Budgets', subtitle: 'Set a spending limit for each month and track it live.', render: 'budget' },
    goals: { mode: 'individual', title: 'Savings Goals', subtitle: 'Save towards something specific and watch the progress.', render: 'goals' },
    recurring: { mode: 'individual', title: 'Recurring Expenses', subtitle: 'Regular payments and what is coming up next.', render: 'recurring' },
    analytics: { mode: 'individual', title: 'Expense Analytics', subtitle: 'Where your money goes, broken down by month and category.', render: 'analytics' },
    insights: { mode: 'individual', title: 'Spending Insights', subtitle: 'Simple observations calculated from your own records.', render: 'insights' },
    reports: { mode: 'individual', title: 'Reports', subtitle: 'Monthly summaries, category breakdown and CSV export.', render: 'reports' },

    // ---------------- Business ----------------
    'business-dashboard': { mode: 'business', title: 'Business Dashboard', subtitle: 'Revenue, expenses, profit and what is still owed.', render: 'business-dashboard' },
    customers: { mode: 'business', title: 'Customers', subtitle: 'People and businesses you invoice.', render: 'customers' },
    vendors: { mode: 'business', title: 'Vendors', subtitle: 'Suppliers you receive bills from.', render: 'vendors' },
    invoices: { mode: 'business', title: 'Invoices', subtitle: 'Create invoices, record payments and track what is due.', render: 'invoices' },
    bills: { mode: 'business', title: 'Bills & Payables', subtitle: 'What you owe vendors and when it is due.', render: 'bills' },
    cashflow: { mode: 'business', title: 'Cash Flow', subtitle: 'Money that actually moved in and out.', render: 'cashflow' },
    'business-reports': { mode: 'business', title: 'Reports', subtitle: 'Tax estimates, payment methods and CSV exports.', render: 'business-reports' },

    // ---------------- Shared ----------------
    transactions: { mode: 'both', title: 'Transactions', subtitle: 'Add, search, edit and delete every income and expense.', render: 'transactions' },
    settings: { mode: 'both', title: 'Settings', subtitle: 'Workspace details, database version and how the modes differ.', render: 'settings' },
  };

  /** Which views each mode can open, in sidebar order. */
  const MODE_VIEWS = {
    individual: ['dashboard', 'transactions', 'budget', 'goals', 'recurring', 'analytics', 'insights', 'reports', 'settings'],
    business: ['business-dashboard', 'transactions', 'customers', 'vendors', 'invoices', 'bills', 'cashflow', 'business-reports', 'settings'],
  };

  const MODE_KEY = 'smartspend:mode';
  const ONBOARDED_KEY = 'smartspend:onboarded';
  const defaultViewFor = (mode) => (mode === 'business' ? 'business-dashboard' : 'dashboard');

  /**
   * Renderer registry. A view is rendered only when it is opened, which keeps
   * start-up fast and means a broken screen cannot block the other screens.
   * app.js registers the individual screens; the two extra files register theirs.
   */
  const renderers = {};

  const registerView = (key, fn) => {
    renderers[key] = fn;
  };

  /* =====================================================================
     3. API WRAPPER
     ===================================================================== */

  async function api(path, { method = 'GET', body } = {}) {
    // The workspace id is what keeps Individual and Business data apart:
    // the server scopes every query with it and rejects a mismatch.
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (state.workspaceId) headers['X-Workspace-Id'] = String(state.workspaceId);

    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      const err = new Error('Cannot reach the SmartSpend server. Is it still running?');
      err.isNetwork = true;
      throw err;
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const err = new Error(payload?.error?.message || `Request failed (${response.status}).`);
      err.status = response.status;
      err.fields = payload?.error?.fields || null;
      throw err;
    }
    return payload;
  }

  /* =====================================================================
     4. THEME
     ===================================================================== */

  const THEME_KEY = 'smartspend:theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const isDark = theme === 'dark';
    const toggle = $('#themeToggle');
    toggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    toggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#0b0d1a' : '#312e81');
    // Charts read their colours from CSS variables, so redraw them.
    redrawChartsForTheme();
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      saved = null;
    }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));

    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* private mode — theme simply won't persist */
      }
      applyTheme(next);
    });
  }

  /* =====================================================================
     5. NAVIGATION
     ===================================================================== */

  function closeSidebar() {
    $('#sidebar').classList.remove('is-open');
    $('#scrim').hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    $('#sidebar').classList.add('is-open');
    $('#scrim').hidden = false;
    $('#menuBtn').setAttribute('aria-expanded', 'true');
  }

  /**
   * Shows one view and renders it lazily.
   * Anything not available in the current mode falls back to that mode's
   * default screen, so a stale bookmark can never show the wrong mode's data.
   */
  async function switchView(view, { updateHash = true, force = false } = {}) {
    const allowed = MODE_VIEWS[state.mode];
    if (!allowed.includes(view)) view = defaultViewFor(state.mode);

    const changed = state.view !== view;
    state.view = view;

    $$('.view').forEach((section) => section.classList.toggle('is-active', section.dataset.view === view));
    $$('.nav-link').forEach((link) => {
      const active = link.dataset.view === view;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const meta = VIEW_META[view];
    $('#pageTitle').textContent = meta.title;
    $('#pageSubtitle').textContent = meta.subtitle;
    document.title = `${meta.title} · SmartSpend${state.mode === 'business' ? ' (Business)' : ''}`;

    if (updateHash && window.location.hash !== `#${view}`) {
      history.replaceState(null, '', `#${view}`);
    }

    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    await renderCurrentView({ force: force || changed });

    // Chart.js measures the canvas when it is created. If that happened while
    // this section was hidden (theme toggle or a mode switch), the chart would
    // be drawn at 0x0 and stay blank. One resize after the section is visible
    // fixes it and is cheap when nothing changed.
    if (typeof Chart !== 'undefined') {
      requestAnimationFrame(() => {
        Object.values(state.charts).forEach((chart) => {
          if (chart && typeof chart.resize === 'function') chart.resize();
        });
      });
    }
  }

  /** Runs the renderer registered for the current view. */
  async function renderCurrentView({ force = true } = {}) {
    const renderer = renderers[state.view];
    if (!renderer) return;
    if (!force) return;
    try {
      await renderer();
    } catch (error) {
      // A failed screen must not break the rest of the app.
      toast('error', error.message || 'Could not load this screen.');
      const section = $(`.view[data-view="${state.view}"]`);
      if (section) section.dataset.failed = 'true';
    }
  }

  /** Re-renders the current screen after a write (used by every form). */
  function refreshAfterMutation() {
    return renderCurrentView({ force: true });
  }

  function initNavigation() {
    $$('.nav-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        switchView(link.dataset.view);
      });
    });

    // "View all" / "Manage" links inside cards
    document.addEventListener('click', (event) => {
      const link = event.target.closest('[data-goto]');
      if (!link) return;
      event.preventDefault();
      switchView(link.dataset.goto);
    });

    // Browser back/forward or a hash typed in the address bar.
    window.addEventListener('hashchange', () => {
      const target = (window.location.hash || '').replace('#', '');
      if (!target || !VIEW_META[target]) return;
      if (target === state.view) return;
      const owner = VIEW_META[target].mode;
      if (owner !== 'both' && owner !== state.mode) {
        setMode(owner, { updateHash: false });
        return;
      }
      switchView(target, { updateHash: false });
    });

    $('#menuBtn').addEventListener('click', openSidebar);
    $('#sidebarClose').addEventListener('click', closeSidebar);
    $('#scrim').addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSidebar();
    });

    // Deep links: a hash that belongs to one mode opens that mode.
    const initial = (window.location.hash || '').replace('#', '');
    if (initial && VIEW_META[initial]) {
      const owner = VIEW_META[initial].mode;
      if (owner !== 'both') state.initialMode = owner;
      switchView(initial, { updateHash: false });
    } else {
      switchView(defaultViewFor(state.mode), { updateHash: false });
    }
  }

  /* =====================================================================
     5b. MODE SWITCHER (Individual <-> Business)
     ---------------------------------------------------------------------
     IMPORTANT: there is no login in SmartSpend. A "workspace" is a local
     profile kept in the same SQLite file; switching mode only decides which
     workspace id is sent with each request. It is NOT authentication and it
     does not protect one mode from someone with access to the machine.
     The value it does provide is real: the queries, categories and reports
     never mix personal and business records.
     ===================================================================== */

  async function loadWorkspaces() {
    const { data } = await api('/api/workspaces');
    state.workspaces = data;
    return data;
  }

  /** Applies all the visual/state changes that belong to a mode. */
  function applyModeChrome() {
    const isBusiness = state.mode === 'business';
    document.body.dataset.mode = state.mode;

    $$('[data-mode-nav]').forEach((nav) => {
      nav.hidden = nav.dataset.modeNav !== state.mode;
    });
    $$('.mode-btn').forEach((btn) => {
      const on = btn.dataset.mode === state.mode;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });

    const caption = $('#modeCaption');
    if (caption) {
      caption.textContent = isBusiness
        ? `Business book · ${state.workspace?.name || 'My Business'}`
        : `Personal book · ${state.workspace?.name || 'Personal'}`;
    }

    // Business-only inputs inside the shared transaction dialog.
    $$('.biz-only').forEach((node) => {
      node.hidden = !isBusiness;
    });

    // Categories come from the workspace type, never from the browser.
    state.meta.categories = isBusiness
      ? state.meta.businessCategories || []
      : state.meta.personalCategories || state.meta.categories;
    populateCategoryOptions();
    populatePaymentMethods();
  }

  /**
   * Switches mode: sets the workspace id, resets every filter/cache that
   * belonged to the other mode, then opens the mode's home screen.
   */
  async function setMode(mode, { updateHash = true, openView = true } = {}) {
    const next = mode === 'business' ? 'business' : 'individual';
    const workspace = state.workspaces.find((w) => w.type === next);
    if (!workspace) {
      toast('error', `No ${next} workspace found in the database.`);
      return;
    }

    state.mode = next;
    state.workspace = workspace;
    state.workspaceId = workspace.id;

    // Filters and pagination belong to a workspace — never carry them over.
    state.filters = { search: '', category: '', type: '', month: '', from: '', to: '' };
    state.tx = { rows: [], total: 0, offset: 0, limit: 20, loading: false };
    // Every cached personal figure is dropped on a mode change, so a screen
    // opened right after switching can never paint last-mode numbers.
    state.summary = null;
    state.monthSummary = null;
    state.budget = null;
    state.recent = null;
    state.monthlySeries = [];
    state.categoryBreakdown = null;
    state.insights = [];
    const filterForm = $('#filterForm');
    if (filterForm) filterForm.reset();

    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private browsing — the mode simply will not be remembered */
    }

    applyModeChrome();
    await loadBusinessParties();

    if (openView) await switchView(defaultViewFor(next), { updateHash });
  }

  // ---------------------------------------------------------------------
  // First-run purpose chooser
  // ---------------------------------------------------------------------
  // Asked once, before the app is used for the first time: "what will you use
  // this for?" It is a shortcut, not a gate — both books already exist, the
  // sidebar switcher still works, and Settings can re-open this screen.
  function purposeScreen() {
    return $('#purposeScreen');
  }

  function hasChosenPurpose() {
    try {
      return localStorage.getItem(ONBOARDED_KEY) === 'yes';
    } catch {
      return false;
    }
  }

  function rememberPurpose() {
    try {
      localStorage.setItem(ONBOARDED_KEY, 'yes');
    } catch {
      /* private browsing — the chooser simply shows again next time */
    }
  }

  function paintPurposeChoice(choice) {
    state.purposeChoice = choice;
    $$('.purpose-option').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.purpose === choice));
    });
    const next = $('#purposeContinue');
    if (next) next.disabled = !choice;
  }

  /** Opens the chooser. `preselect` defaults to the current mode. */
  function openPurposeScreen({ preselect = null } = {}) {
    const screen = purposeScreen();
    if (!screen) return;
    screen.hidden = false;
    document.body.classList.add('purpose-open');
    paintPurposeChoice(preselect || state.mode);
    const first = screen.querySelector('.purpose-option');
    if (first) first.focus();
  }

  function closePurposeScreen() {
    const screen = purposeScreen();
    if (screen) screen.hidden = true;
    document.body.classList.remove('purpose-open');
  }

  function initPurposeScreen() {
    const screen = purposeScreen();
    if (!screen) return;

    screen.addEventListener('click', (event) => {
      const option = event.target.closest('.purpose-option');
      if (option) {
        paintPurposeChoice(option.dataset.purpose);
        return;
      }
      if (event.target.closest('#purposeContinue')) {
        const choice = state.purposeChoice;
        if (!choice) return;
        rememberPurpose();
        closePurposeScreen();
        if (choice !== state.mode) setMode(choice);
        else switchView(defaultViewFor(choice), { force: true });
      }
    });

    // Arrow keys move between the two options, like a radio group.
    screen.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const options = $$('.purpose-option');
      const index = options.findIndex((btn) => btn.dataset.purpose === state.purposeChoice);
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = options[(index + step + options.length) % options.length];
      if (!next) return;
      event.preventDefault();
      paintPurposeChoice(next.dataset.purpose);
      next.focus();
    });

    // Only show it when this browser has not answered yet.
    if (!hasChosenPurpose()) {
      openPurposeScreen({ preselect: null });
      paintPurposeChoice(null); // force an explicit answer on the first run
    } else {
      closePurposeScreen();
    }
  }

  function initModeSwitcher() {
    $$('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === state.mode) return;
        setMode(btn.dataset.mode);
      });
    });
  }

  /* =====================================================================
     6. DATA LOADING
     ===================================================================== */

  // Fallback list, only used if /api/meta cannot be reached. The server is
  // always the source of truth — this just keeps the form usable offline.
  const FALLBACK_CATEGORIES = ['Food', 'Travel', 'Shopping', 'Bills', 'Education', 'Health', 'Entertainment', 'Salary', 'Freelance', 'Other'];

  async function loadMeta() {
    let meta = { categories: FALLBACK_CATEGORIES, types: ['income', 'expense'], currentMonth: currentMonth() };
    try {
      // NOTE: /api/meta returns the object directly (no { data: ... } wrapper).
      meta = await api('/api/meta');
    } catch (error) {
      toast('error', `Could not load app settings: ${error.message}`);
    }
    const personal = Array.isArray(meta.personalCategories) && meta.personalCategories.length
      ? meta.personalCategories
      : Array.isArray(meta.categories) && meta.categories.length
        ? meta.categories
        : FALLBACK_CATEGORIES;

    state.meta = {
      categories: personal,
      personalCategories: personal,
      personalIncomeCategories: meta.personalIncomeCategories || ['Salary', 'Freelance', 'Other'],
      businessCategories: meta.businessCategories || personal,
      businessIncomeCategories: meta.businessIncomeCategories || ['Sales', 'Other Income'],
      paymentMethods: meta.paymentMethods || ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other'],
      frequencies: meta.recurrenceFrequencies || ['daily', 'weekly', 'monthly', 'yearly'],
      types: meta.types || ['income', 'expense'],
    };
    state.month = meta.currentMonth || currentMonth();

    populateCategoryOptions();
    populatePaymentMethods();

    $('#globalMonth').value = state.month;
    $('#budgetMonth').value = state.month;
    $('#globalMonth').max = currentMonth();
    $('#budgetMonth').max = currentMonth();
  }

  /** Category dropdowns always mirror the current mode's allow-list. */
  function populateCategoryOptions() {
    const categories = state.meta.categories || [];
    const txCategory = $('#txCategory');
    const fCategory = $('#fCategory');
    if (!txCategory || !fCategory) return;

    const previousTx = txCategory.value;
    const previousFilter = fCategory.value;

    txCategory.textContent = '';
    fCategory.textContent = '';
    txCategory.append(el('option', { value: '', text: 'Select a category' }));
    fCategory.append(el('option', { value: '', text: 'All categories' }));
    for (const category of categories) {
      txCategory.append(el('option', { value: category, text: category }));
      fCategory.append(el('option', { value: category, text: category }));
    }

    // Keep the user's choice if it still exists in this mode.
    if (categories.includes(previousTx)) txCategory.value = previousTx;
    if (categories.includes(previousFilter)) fCategory.value = previousFilter;
  }

  const METHOD_LABELS = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    bank_transfer: 'Bank transfer',
    cheque: 'Cheque',
    other: 'Other',
  };

  /** Payment method dropdowns (transaction dialog + payment dialog). */
  function populatePaymentMethods() {
    const methods = state.meta.paymentMethods || Object.keys(METHOD_LABELS);
    for (const id of ['txPaymentMethod', 'paymentMethod']) {
      const select = $(`#${id}`);
      if (!select) continue;
      const previous = select.value;
      const placeholder = id === 'txPaymentMethod' ? 'Not specified' : null;
      select.textContent = '';
      if (placeholder) select.append(el('option', { value: '', text: placeholder }));
      for (const method of methods) {
        select.append(el('option', { value: method, text: METHOD_LABELS[method] || method }));
      }
      if (previous) select.value = previous;
    }
  }

  function fillSelect(select, placeholder, items) {
    if (!select) return;
    const previous = select.value;
    select.textContent = '';
    if (placeholder) select.append(el('option', { value: '', text: placeholder }));
    for (const item of items) {
      select.append(el('option', { value: String(item.value), text: item.label }));
    }
    if (previous && Array.from(select.options).some((o) => o.value === previous)) select.value = previous;
  }

  /**
   * Loads customers and vendors for the business transaction form.
   * In Individual mode the pickers are emptied — a personal transaction can
   * never be linked to a business customer.
   */
  async function loadBusinessParties() {
    const customerSelect = $('#txCustomer');
    const vendorSelect = $('#txVendor');
    if (!customerSelect || !vendorSelect) return;

    if (state.mode !== 'business') {
      state.parties = { customers: [], vendors: [] };
      fillSelect(customerSelect, 'No customer', []);
      fillSelect(vendorSelect, 'No vendor', []);
      return;
    }

    try {
      const [customerRes, vendorRes] = await Promise.all([
        api('/api/business/customers'),
        api('/api/business/vendors'),
      ]);
      state.parties = { customers: customerRes.data || [], vendors: vendorRes.data || [] };
      fillSelect(customerSelect, 'No customer', state.parties.customers.map((c) => ({ value: c.id, label: c.name })));
      fillSelect(vendorSelect, 'No vendor', state.parties.vendors.map((v) => ({ value: v.id, label: v.name })));
    } catch (error) {
      // Not fatal: the rest of the form still works without a party.
      state.parties = { customers: [], vendors: [] };
      console.warn('Could not load customers/vendors:', error.message);
    }
  }

  async function loadSummary() {
    const [all, month] = await Promise.all([
      api('/api/summary'),
      api(`/api/summary?month=${state.month}`),
    ]);
    state.summary = all.data;
    state.monthSummary = month.data;
  }

  async function loadCategoryBreakdown() {
    const { data } = await api(`/api/analytics/categories?month=${state.month}`);
    state.categoryBreakdown = data;
  }

  async function loadMonthlySeries() {
    const { data } = await api('/api/analytics/monthly?months=6');
    state.monthlySeries = data;
  }

  async function loadInsights() {
    const { data } = await api(`/api/analytics/insights?month=${state.month}`);
    state.insights = data.insights;
  }

  async function loadBudget() {
    const { data } = await api(`/api/budgets?month=${state.month}`);
    state.budget = data;
  }

  /* =====================================================================
     7. DASHBOARD RENDERING
     ===================================================================== */

  function clearSkeleton(node) {
    if (node) node.classList.remove('skeleton');
  }

  function renderSummaryCards() {
    const all = state.summary;
    const month = state.monthSummary;
    if (!all || !month) return;

    const setCard = (id, value, note, className) => {
      const valueNode = $(`#${id}`);
      clearSkeleton(valueNode);
      valueNode.textContent = value;
      valueNode.className = `stat-value ${className || ''}`.trim();
      if (note !== undefined && note !== null) {
        const noteNode = $(`#${id}Note`);
        noteNode.textContent = note;
      }
    };

    const { totalIncome, totalExpenses, balance, savingsRate } = all;
    const { highestCategory } = month;

    setCard(
      'statIncome',
      money(totalIncome),
      totalIncome > 0 ? `From ${plural(all.incomeCount, 'income entry', 'income entries')} in total` : 'No income recorded yet',
      'is-income'
    );
    setCard(
      'statExpense',
      money(totalExpenses),
      totalExpenses > 0
        ? `${plural(all.expenseCount, 'expense entry', 'expense entries')} in total`
        : 'No expenses recorded yet',
      'is-expense'
    );
    setCard(
      'statBalance',
      money(balance),
      balance < 0 ? 'You have spent more than you earned' : balance > 0 ? 'Money left after expenses' : 'Income and expenses are equal',
      balance < 0 ? 'is-negative' : ''
    );
    setCard(
      'statSavings',
      percent(savingsRate),
      totalIncome > 0
        ? savingsRate >= 0
          ? `You keep ${money((totalIncome - totalExpenses) > 0 ? (totalIncome - totalExpenses) : 0)} of ${money(totalIncome)} earned`
          : 'Expenses are higher than income'
        : 'Add income to calculate a savings rate',
      savingsRate < 0 ? 'is-negative' : ''
    );

    renderSummaryDeltas(month);

    $('#glanceTopCategory').textContent = highestCategory ? highestCategory.category : 'No expenses this month';
    $('#glanceTopAmount').textContent = highestCategory
      ? `${money(highestCategory.total)} across ${plural(highestCategory.count, 'transaction')}`
      : '—';
    $('#glanceSub').textContent = monthLabel(state.month);
  }

  /**
   * Adds a small "vs last month" chip to each summary card.
   *
   * Rising income is good (green), rising expenses is not (red) — so the same
   * number is coloured according to what it means, not by its sign.
   */
  function renderSummaryDeltas(monthSummary) {
    const change = monthSummary && monthSummary.change;
    const previous = monthSummary && monthSummary.previous;

    const cards = [
      { id: 'statIncomeNote', value: change && change.income, goodWhen: 'up' },
      { id: 'statExpenseNote', value: change && change.expenses, goodWhen: 'down' },
      { id: 'statBalanceNote', value: change && change.balance, goodWhen: 'up' },
    ];

    for (const card of cards) {
      const note = $(`#${card.id}`);
      if (!note) continue;
      // Remove any chip from a previous render before deciding again.
      note.querySelectorAll('.stat-delta').forEach((node) => node.remove());

      const value = card.value;
      if (value === null || value === undefined || !previous) continue;

      const rising = value > 0;
      const flat = value === 0;
      const good = card.goodWhen === 'up' ? rising : !rising;

      const chip = el('span', {
        class: `stat-delta ${flat ? '' : good ? 'is-up' : 'is-down'}`.trim(),
        text: `${flat ? '±' : rising ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`,
      });
      chip.title = flat
        ? `About the same as ${monthLabel(previous.month)}`
        : `${rising ? 'Up' : 'Down'} ${Math.abs(value).toFixed(1)}% compared with ${monthLabel(previous.month)}`;
      note.append(' ', chip);
    }

    // The savings-rate card compares percentage points, not a percentage.
    const savingsNote = $('#statSavingsNote');
    if (savingsNote) {
      savingsNote.querySelectorAll('.stat-delta').forEach((node) => node.remove());
      const diff = change && change.savingsRate;
      if (previous && typeof diff === 'number') {
        const chip = el('span', {
          class: `stat-delta ${diff === 0 ? '' : diff > 0 ? 'is-up' : 'is-down'}`.trim(),
          text: `${diff === 0 ? '±' : diff > 0 ? '↑' : '↓'} ${Math.abs(diff).toFixed(1)} pp`,
        });
        chip.title = `Savings rate ${diff >= 0 ? 'up' : 'down'} ${Math.abs(diff).toFixed(1)} percentage points vs ${monthLabel(previous.month)}`;
        savingsNote.append(' ', chip);
      }
    }
  }

  function renderRecentTransactions() {
    const body = $('#recentBody');
    const empty = $('#recentEmpty');
    const rows = state.recent || [];
    body.textContent = '';

    if (rows.length === 0) {
      empty.hidden = false;
      body.append(el('tr', {}, el('td', { colspan: '5' }, el('span', { class: 'muted', text: 'Nothing to show yet.' }))));
      return;
    }
    empty.hidden = true;

    for (const tx of rows) {
      body.append(
        el(
          'tr',
          {},
          el(
            'td',
            { dataset: { label: 'Title' } },
            el(
              'div',
              { class: 'cell-title' },
              el('strong', { text: tx.title }),
              tx.notes ? el('small', { text: tx.notes }) : null
            )
          ),
          el('td', { dataset: { label: 'Category' }, text: tx.category }),
          el('td', { dataset: { label: 'Date' }, text: formatDate(tx.transaction_date) }),
          el(
            'td',
            { dataset: { label: 'Type' } },
            el('span', { class: `pill ${tx.type === 'income' ? 'pill-income' : 'pill-expense'}`, text: tx.type === 'income' ? 'Income' : 'Expense' })
          ),
          el('td', {
            class: `num ${tx.type === 'income' ? 'amount-income' : 'amount-expense'}`,
            dataset: { label: 'Amount' },
            text: `${tx.type === 'income' ? '+' : '−'}${money(tx.amount)}`,
          })
        )
      );
    }
  }

  function renderBudgetCard() {
    const budget = state.budget;
    const wrap = $('#dashBudget');
    const empty = $('#dashBudgetEmpty');
    if (!budget) return;

    $('#dashBudgetSub').textContent = monthLabel(state.month);

    if (!budget.isSet) {
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    const pct = budget.percentUsed ?? 0;
    const barWrap = $('#dashBudgetBarWrap');
    const bar = $('#dashBudgetBar');
    const caption = $('#dashBudgetLabel');

    $('#dashBudgetAmount').textContent = money(budget.amount);
    $('#dashBudgetSpent').textContent = money(budget.spent);
    $('#dashBudgetRemaining').textContent = money(budget.remaining);

    bar.className = `progress-bar state-${progressState(pct)}`;
    bar.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
    barWrap.setAttribute('aria-valuenow', String(Math.min(Math.round(pct), 100)));

    caption.className = 'progress-caption';
    if (budget.exceeded) {
      caption.classList.add('is-over');
      caption.textContent = `${percent(pct)} used — over budget by ${money(Math.abs(budget.remaining))}.`;
    } else if (pct >= 75) {
      caption.classList.add('is-warn');
      caption.textContent = `${percent(pct)} used — ${money(budget.remaining)} left for ${monthLabel(state.month)}.`;
    } else {
      caption.textContent = `${percent(pct)} used — ${money(budget.remaining)} left for ${monthLabel(state.month)}.`;
    }

    renderBudgetDaily(budget);
  }

  /**
   * "About ₹94 a day for the 3 days left" — turns the remaining budget into a
   * number a person can act on. Uses the selected month, so browsing an old
   * month shows that month's days rather than today's.
   */
  function renderBudgetDaily(budget) {
    const node = $('#dashBudgetDaily');
    if (!node) return;
    node.textContent = '';

    const month = state.month;
    if (!month || !budget.isSet) return;

    const [year, monthNo] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
    const today = todayISO();
    const isCurrentMonth = today.slice(0, 7) === month;
    const todayDay = Number(today.slice(8, 10));
    const daysLeft = isCurrentMonth ? Math.max(daysInMonth - todayDay + 1, 0) : daysInMonth;

    if (budget.exceeded) {
      node.textContent = `You are ${money(Math.abs(budget.remaining))} over — no daily allowance left this month.`;
      node.classList.add('is-over');
      return;
    }
    node.classList.remove('is-over');

    if (daysLeft <= 0) {
      node.textContent = 'This month is over.';
      return;
    }

    const perDay = budget.remaining / daysLeft;
    node.textContent = isCurrentMonth
      ? `That is about ${money(perDay)} a day for the ${plural(daysLeft, 'day')} left in ${monthLabel(month)}.`
      : `That is about ${money(perDay)} a day across ${plural(daysInMonth, 'day')} of ${monthLabel(month)}.`;
  }

  function progressState(pct) {
    if (!Number.isFinite(pct)) return 'safe';
    if (pct > 100) return 'over';
    if (pct >= 75) return 'warn';
    return 'safe';
  }

  function renderDashboardInsights() {
    const list = $('#dashInsights');
    list.textContent = '';
    const chosen = state.insights.slice(0, 3);
    if (chosen.length === 0) {
      list.append(el('li', { class: 'is-empty', text: 'Add a few transactions to see your spending insights.' }));
      return;
    }
    for (const insight of chosen) {
      list.append(el('li', { text: insight.text }));
    }
  }

  function renderDashboard() {
    renderSummaryCards();
    renderRecentTransactions();
    renderBudgetCard();
    renderDashboardInsights();
    renderCharts();
  }

  /* =====================================================================
     8. CHARTS (Chart.js)
     ===================================================================== */

  function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    const read = (name) => css.getPropertyValue(name).trim();
    return {
      text: read('--text-secondary') || '#454a63',
      muted: read('--muted') || '#6d7288',
      grid: read('--border') || '#e2e5f1',
      surface: read('--surface') || '#ffffff',
      income: read('--income') || '#0f9d6e',
      expense: read('--expense') || '#d13d33',
      brand: read('--brand') || '#4f46e5',
    };
  }

  function baseChartOptions(theme) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 550 },
      plugins: {
        legend: {
          labels: {
            color: theme.text,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            padding: 14,
            font: { size: 11, family: getComputedStyle(document.body).fontFamily },
          },
        },
        tooltip: {
          backgroundColor: theme.surface,
          titleColor: theme.muted,
          bodyColor: theme.text,
          borderColor: theme.grid,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          callbacks: {
            label(ctx) {
              const label = ctx.dataset.label ? `${ctx.dataset.label}: ` : `${ctx.label}: `;
              return `${label}${money(ctx.parsed.y ?? ctx.parsed)}`;
            },
          },
        },
      },
    };
  }

  function toggleChartEmpty(canvasId, emptyId, hasData) {
    const canvas = $(`#${canvasId}`);
    const empty = $(`#${emptyId}`);
    if (canvas) canvas.style.display = hasData ? '' : 'none';
    if (empty) empty.hidden = hasData;
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') {
      // Chart.js could not be loaded (offline + missing local file).
      // Show a readable message instead of a blank box.
      ['monthlyChartEmpty', 'categoryChartEmpty', 'analyticsBarEmpty', 'analyticsDoughnutEmpty'].forEach((id) => {
        const node = $(`#${id}`);
        if (!node) return;
        node.hidden = false;
        const title = node.querySelector('strong');
        if (title) title.textContent = 'Charts unavailable';
        const text = node.querySelectorAll('p');
        if (text[1]) text[1].textContent = 'The Chart.js library could not be loaded. All tables and totals above still work.';
      });
      return;
    }
    renderMonthlyBarChart('monthlyChart', 'monthlyChartEmpty', state.monthlySeries, 'monthly');
    renderCategoryDoughnut('categoryChart', 'categoryChartEmpty', state.categoryBreakdown, 'category');
    if (state.view === 'analytics') {
      renderMonthlyBarChart('analyticsBar', 'analyticsBarEmpty', state.monthlySeries, 'analyticsBar');
      renderCategoryDoughnut('analyticsDoughnut', 'analyticsDoughnutEmpty', state.categoryBreakdown, 'analyticsDoughnut');
    }
    $('#monthlyChartSub').textContent = state.monthlySeries.length
      ? `${monthLabel(state.monthlySeries[0].month)} – ${monthLabel(state.monthlySeries[state.monthlySeries.length - 1].month)}`
      : 'Last 6 months';
    $('#categoryChartSub').textContent = `${monthLabel(state.month)} · total ${money(state.categoryBreakdown?.total || 0)}`;
  }

  function renderMonthlyBarChart(canvasId, emptyId, series, key) {
    const canvas = $(`#${canvasId}`);
    if (!canvas || typeof Chart === 'undefined') return;

    const hasData = series.some((row) => row.income > 0 || row.expense > 0);
    toggleChartEmpty(canvasId, emptyId, hasData);
    if (!hasData) {
      destroyChart(key);
      return;
    }

    const theme = chartTheme();
    const labels = series.map((row) => monthShort(row.month));
    const income = series.map((row) => row.income);
    const expense = series.map((row) => row.expense);

    if (state.charts[key]) {
      const chart = state.charts[key];
      chart.data.labels = labels;
      chart.data.datasets[0].data = income;
      chart.data.datasets[1].data = expense;
      chart.options = buildBarOptions(theme);
      chart.update();
      return;
    }

    state.charts[key] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Income',
            data: income,
            backgroundColor: theme.income,
            hoverBackgroundColor: theme.income,
            borderRadius: 5,
            maxBarThickness: 26,
          },
          {
            label: 'Expenses',
            data: expense,
            backgroundColor: theme.expense,
            hoverBackgroundColor: theme.expense,
            borderRadius: 5,
            maxBarThickness: 26,
          },
        ],
      },
      options: buildBarOptions(theme),
    });
  }

  function buildBarOptions(theme) {
    const options = baseChartOptions(theme);
    return {
      ...options,
      scales: {
        x: {
          grid: { display: false },
          border: { color: theme.grid },
          ticks: { color: theme.muted, font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: theme.grid, drawTicks: false },
          ticks: {
            color: theme.muted,
            font: { size: 10 },
            padding: 6,
            callback: (value) => moneyShort(value),
          },
        },
      },
      plugins: { ...options.plugins, legend: { ...options.plugins.legend, position: 'top', align: 'end' } },
      interaction: { mode: 'index', intersect: false },
    };
  }

  function renderCategoryDoughnut(canvasId, emptyId, breakdown, key) {
    const canvas = $(`#${canvasId}`);
    if (!canvas || typeof Chart === 'undefined') return;

    const categories = breakdown?.categories || [];
    const hasData = categories.length > 0;
    toggleChartEmpty(canvasId, emptyId, hasData);
    if (!hasData) {
      destroyChart(key);
      if (key === 'category') renderCategoryLegend([]);
      return;
    }

    const theme = chartTheme();
    const labels = categories.map((row) => row.category);
    const values = categories.map((row) => row.total);
    const colours = categories.map((row, index) => colourFor(row.category, index));

    if (state.charts[key]) {
      const chart = state.charts[key];
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].backgroundColor = colours;
      chart.options = buildDoughnutOptions(theme);
      chart.update();
    } else {
      state.charts[key] = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            {
              data: values,
              backgroundColor: colours,
              borderColor: theme.surface,
              borderWidth: 2,
              hoverOffset: 5,
            },
          ],
        },
        options: buildDoughnutOptions(theme),
      });
    }

    if (key === 'category') renderCategoryLegend(categories);
  }

  function buildDoughnutOptions(theme) {
    const options = baseChartOptions(theme);
    return {
      ...options,
      cutout: '62%',
      plugins: {
        ...options.plugins,
        legend: { display: false },
        tooltip: {
          ...options.plugins.tooltip,
          callbacks: {
            label(ctx) {
              const total = ctx.dataset.data.reduce((sum, value) => sum + value, 0);
              const share = total > 0 ? Math.round((ctx.parsed / total) * 1000) / 10 : 0;
              return `${ctx.label}: ${money(ctx.parsed)} (${share}%)`;
            },
          },
        },
      },
    };
  }

  function renderCategoryLegend(categories) {
    const legend = $('#categoryLegend');
    legend.textContent = '';
    if (!categories.length) return;

    for (const [index, row] of categories.slice(0, 6).entries()) {
      legend.append(
        el(
          'li',
          {},
          el('span', { class: 'swatch', style: `background:${colourFor(row.category, index)}` }),
          el('span', { class: 'legend-name', text: row.category }),
          el('span', { class: 'legend-value', text: money(row.total) }),
          el('span', { class: 'legend-pct', text: `${row.percent}%` })
        )
      );
    }
  }

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  }

  function redrawChartsForTheme() {
    if (typeof Chart === 'undefined') return;
    Object.keys(state.charts).forEach(destroyChart);
    if (state.summary) renderCharts();
  }

  /* =====================================================================
     9. TRANSACTIONS LIST + FILTERS
     ===================================================================== */

  function transactionRow(tx) {
    const isIncome = tx.type === 'income';

    const actions = el(
      'div',
      { class: 'row-actions' },
      el(
        'button',
        {
          class: 'row-btn',
          type: 'button',
          title: `Edit "${tx.title}"`,
          'aria-label': `Edit ${tx.title}`,
          dataset: { action: 'edit', id: tx.id },
        },
        // static icon markup only
        Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })
      ),
      el(
        'button',
        {
          class: 'row-btn danger',
          type: 'button',
          title: `Delete "${tx.title}"`,
          'aria-label': `Delete ${tx.title}`,
          dataset: { action: 'delete', id: tx.id },
        },
        Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') })
      )
    );

    return el(
      'tr',
      {},
      el(
        'td',
        { dataset: { label: 'Title' } },
        el(
          'div',
          { class: 'cell-title' },
          el('strong', { text: tx.title }),
          tx.notes ? el('small', { text: tx.notes }) : null
        )
      ),
      el('td', { dataset: { label: 'Category' }, text: tx.category }),
      el('td', { dataset: { label: 'Date' }, text: formatDate(tx.transaction_date) }),
      el(
        'td',
        { dataset: { label: 'Type' } },
        el('span', { class: `pill ${isIncome ? 'pill-income' : 'pill-expense'}`, text: isIncome ? 'Income' : 'Expense' })
      ),
      // Business-only column: who the entry relates to, plus how it was paid.
      el(
        'td',
        { class: 'biz-col', dataset: { label: 'Customer / vendor' } },
        tx.customer_name || tx.vendor_name
          ? el(
              'div',
              { class: 'cell-title' },
              el('strong', { text: tx.customer_name || tx.vendor_name }),
              el('small', {
                text: [tx.payment_method ? METHOD_LABELS[tx.payment_method] || tx.payment_method : '', tx.invoice_reference]
                  .filter(Boolean)
                  .join(' · '),
              })
            )
          : el('span', { class: 'muted', text: tx.payment_method ? METHOD_LABELS[tx.payment_method] || tx.payment_method : '—' })
      ),
      el('td', {
        class: `num ${isIncome ? 'amount-income' : 'amount-expense'}`,
        dataset: { label: 'Amount' },
        text: `${isIncome ? '+' : '−'}${money(tx.amount)}`,
      }),
      el('td', { dataset: { label: 'Actions' }, class: 'actions-col' }, actions)
    );
  }

  function renderTransactionList() {
    const body = $('#txBody');
    const empty = $('#txEmpty');
    const footer = $('#txFooter');
    const rows = state.tx.rows;

    body.textContent = '';

    if (state.tx.loading && rows.length === 0) {
      body.append(
        el('tr', {}, el('td', { colspan: '7' }, el('div', { class: 'loading-row' }, el('span', { class: 'spinner' }), 'Loading transactions…')))
      );
      return;
    }

    if (rows.length === 0) {
      const filtered = hasActiveFilters();
      empty.hidden = false;
      footer.hidden = true;
      $('#txEmptyTitle').textContent = filtered ? 'No matching transactions' : 'No transactions yet';
      $('#txEmptyText').textContent = filtered
        ? 'Try a different search term, or clear the filters to see everything.'
        : 'Start by adding your first income or expense.';
      return;
    }

    empty.hidden = true;
    for (const tx of rows) body.append(transactionRow(tx));

    footer.hidden = false;
    $('#txShown').textContent = `Showing ${rows.length} of ${state.tx.total} transaction${state.tx.total === 1 ? '' : 's'}`;
    $('#loadMoreBtn').hidden = rows.length >= state.tx.total;
    $('#txCountLabel').textContent = `${state.tx.total} record${state.tx.total === 1 ? '' : 's'} found`;
  }

  function hasActiveFilters() {
    const f = state.filters;
    return Boolean(f.search || f.category || f.type || f.month || f.from || f.to);
  }

  function buildTransactionQuery() {
    const params = new URLSearchParams();
    const f = state.filters;
    if (f.search) params.set('search', f.search);
    if (f.category) params.set('category', f.category);
    if (f.type) params.set('type', f.type);
    if (f.month) params.set('month', f.month);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    params.set('limit', String(state.tx.limit));
    params.set('offset', String(state.tx.offset));
    return params.toString();
  }

  async function loadTransactions({ reset = false } = {}) {
    if (reset) {
      state.tx.offset = 0;
      state.tx.rows = [];
    }
    state.tx.loading = true;
    renderTransactionList();

    try {
      const { data, pagination, totals } = await api(`/api/transactions?${buildTransactionQuery()}`);
      state.tx.rows = reset ? data : state.tx.rows.concat(data);
      state.tx.total = pagination.total;
      state.tx.loading = false;
      renderTransactionList();
      updateFilterSummary(pagination, totals);
    } catch (error) {
      state.tx.loading = false;
      renderTransactionList();
      toast('error', error.message);
    }
  }

  function updateFilterSummary(pagination, totals) {
    const summary = $('#filterSummary');
    summary.textContent = '';

    if (!hasActiveFilters()) {
      summary.append(el('span', { text: `Showing all ${plural(pagination.total, 'transaction')}, newest first.` }));
      return;
    }

    const chips = [];
    if (state.filters.search) chips.push(`search “${state.filters.search}”`);
    if (state.filters.category) chips.push(`category ${state.filters.category}`);
    if (state.filters.type) chips.push(`type ${state.filters.type}`);
    if (state.filters.month) chips.push(`month ${monthLabel(state.filters.month)}`);
    if (state.filters.from) chips.push(`from ${formatDate(state.filters.from)}`);
    if (state.filters.to) chips.push(`to ${formatDate(state.filters.to)}`);

    summary.append(
      el('span', {}, 'Filtered by ', el('strong', { text: chips.join(' · ') }), '. '),
      el('span', {
        text: `${plural(pagination.total, 'result')} · income ${money(totals.income)} · expenses ${money(totals.expense)}`,
      })
    );
  }

  function readFiltersFromForm() {
    state.filters = {
      search: $('#fSearch').value.trim(),
      category: $('#fCategory').value,
      type: $('#fType').value,
      month: $('#fMonth').value,
      from: $('#fFrom').value,
      to: $('#fTo').value,
    };
  }

  function clearFilterForm() {
    $('#filterForm').reset();
    state.filters = { search: '', category: '', type: '', month: '', from: '', to: '' };
    markActivePreset('all');
    loadTransactions({ reset: true });
  }

  /**
   * Fills the From/To inputs for a quick range. Dates are plain ISO strings so
   * the server receives exactly what the calendar showed.
   */
  function applyDatePreset(preset) {
    const today = todayISO();
    const [year, month] = today.slice(0, 7).split('-');
    const from = $('#fFrom');
    const to = $('#fTo');
    const monthField = $('#fMonth');
    if (!from || !to) return;

    const shiftMonth = (delta) => {
      const y = Number(year);
      const m = Number(month) - 1 + delta;
      const date = new Date(Date.UTC(y, m, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const lastDayOf = (monthKey) => {
      const [y, m] = monthKey.split('-').map(Number);
      return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    };

    switch (preset) {
      case 'this-month':
        from.value = `${today.slice(0, 7)}-01`;
        to.value = lastDayOf(today.slice(0, 7));
        break;
      case 'last-month': {
        const previous = shiftMonth(-1);
        from.value = `${previous}-01`;
        to.value = lastDayOf(previous);
        break;
      }
      case 'last-30': {
        const start = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000);
        from.value = start.toISOString().slice(0, 10);
        to.value = today;
        break;
      }
      case 'this-year':
        from.value = `${year}-01-01`;
        to.value = `${year}-12-31`;
        break;
      default:
        from.value = '';
        to.value = '';
    }
    // A month prefix and a date range conflict; the range wins, so clear it.
    if (monthField && (from.value || to.value)) monthField.value = '';
  }

  /** Highlights the chip that matches the current range, if any. */
  function markActivePreset(preset) {
    $$('.preset-chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.preset === preset));
    });
  }

  function initFilters() {
    const applyFilters = debounce(() => {
      readFiltersFromForm();
      loadTransactions({ reset: true });
    }, 260);

    $('#fSearch').addEventListener('input', applyFilters);
    ['fCategory', 'fType', 'fMonth', 'fFrom', 'fTo'].forEach((id) => {
      $(`#${id}`).addEventListener('change', () => {
        // Editing a date by hand means no preset describes the filter any more.
        if (id === 'fFrom' || id === 'fTo' || id === 'fMonth') markActivePreset(null);
        readFiltersFromForm();
        loadTransactions({ reset: true });
      });
    });
    $('#filterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      readFiltersFromForm();
      loadTransactions({ reset: true });
    });
    $('#clearFilters').addEventListener('click', clearFilterForm);

    // Quick date ranges. They only fill the two date inputs and re-run the
    // same server-side filter — no separate code path, so exported CSVs and
    // the visible rows can never disagree.
    $$('.preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        applyDatePreset(chip.dataset.preset);
        markActivePreset(chip.dataset.preset);
        readFiltersFromForm();
        loadTransactions({ reset: true });
      });
    });

    // CSV export uses the same filters as the table (server-side filtering).
    $('#exportTxListBtn').addEventListener('click', () => {
      const base = state.mode === 'business' ? '/api/business/export/transactions.csv' : '/api/export/transactions.csv';
      const f = state.filters;
      downloadCsv(
        base +
          queryString({
            search: f.search,
            category: f.category,
            type: f.type,
            month: f.month,
            from: f.from,
            to: f.to,
          })
      );
      toast('info', 'CSV download started with the current filters.');
    });
    $('#loadMoreBtn').addEventListener('click', async () => {
      state.tx.offset += state.tx.limit;
      await loadTransactions();
    });
  }

  /* =====================================================================
     10. ADD / EDIT / DELETE TRANSACTION
     ===================================================================== */

  const txDialog = () => $('#txDialog');
  const confirmDialog = () => $('#confirmDialog');

  function clearFieldErrors() {
    $$('#txForm .field').forEach((field) => field.classList.remove('has-error'));
    $$('#txForm .field-error').forEach((node) => {
      node.textContent = '';
      node.classList.remove('is-visible');
    });
    const banner = $('#txFormError');
    banner.hidden = true;
    banner.textContent = '';
  }

  function showFieldErrors(fields = {}) {
    const map = {
      title: 'txTitleError',
      amount: 'txAmountError',
      category: 'txCategoryError',
      transaction_date: 'txDateError',
      notes: 'txNotesError',
      type: 'txFormError',
      payment_method: 'txFormError',
      tax_rate: 'txFormError',
      customer_id: 'txFormError',
      vendor_id: 'txFormError',
    };
    let firstInvalid = null;

    for (const [field, message] of Object.entries(fields)) {
      const errorId = map[field];
      if (!errorId) continue;
      const node = $(`#${errorId}`);
      if (!node) continue;
      if (errorId === 'txFormError') {
        node.hidden = false;
        node.textContent = message;
        continue;
      }
      node.textContent = message;
      node.classList.add('is-visible');
      const fieldWrap = node.closest('.field');
      if (fieldWrap) fieldWrap.classList.add('has-error');
      if (!firstInvalid) firstInvalid = fieldWrap;
    }
    if (firstInvalid) {
      const input = firstInvalid.querySelector('input, select, textarea');
      if (input) input.focus();
    }
  }

  function openTransactionDialog(tx = null) {
    state.editingId = tx ? tx.id : null;
    clearFieldErrors();
    const form = $('#txForm');
    form.reset();

    $('#txDialogTitle').textContent = tx ? 'Edit Transaction' : 'Add Transaction';
    $('#txDialogSub').textContent = tx
      ? `Updating entry #${tx.id}. Changes are saved to the database.`
      : 'Record an income or an expense.';
    $('#txSubmitBtn').textContent = tx ? 'Save Changes' : 'Save Transaction';

    if (tx) {
      const radio = $(`#txForm input[name="type"][value="${tx.type}"]`);
      if (radio) radio.checked = true;
      $('#txTitle').value = tx.title;
      $('#txAmount').value = tx.amount;
      $('#txCategory').value = tx.category;
      $('#txDate').value = tx.transaction_date;
      $('#txNotes').value = tx.notes || '';
      if (state.mode === 'business') {
        $('#txPaymentMethod').value = tx.payment_method || '';
        $('#txTaxRate').value = tx.tax_rate === null || tx.tax_rate === undefined ? '' : tx.tax_rate;
        const customerSelect = $('#txCustomer');
        const vendorSelect = $('#txVendor');
        if (tx.customer_id && customerSelect) customerSelect.value = String(tx.customer_id);
        if (tx.vendor_id && vendorSelect) vendorSelect.value = String(tx.vendor_id);
      }
    } else {
      $('#txForm input[name="type"][value="expense"]').checked = true;
      $('#txDate').value = todayISO();
      $('#txCategory').value = '';
    }
    updateNotesCount();

    // Business mode: refresh the customer/vendor pickers before showing the form.
    if (state.mode === 'business') {
      loadBusinessParties().then(() => {
        if (tx && state.editingId === tx.id) {
          if (tx.customer_id) $('#txCustomer').value = String(tx.customer_id);
          if (tx.vendor_id) $('#txVendor').value = String(tx.vendor_id);
        }
      });
    }

    const dialog = txDialog();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => $('#txTitle').focus(), 40);
  }

  function closeTransactionDialog() {
    const dialog = txDialog();
    if (dialog.open) dialog.close();
    state.editingId = null;
    $('#txSubmitBtn').disabled = false;
  }

  function updateNotesCount() {
    const value = $('#txNotes').value;
    $('#notesCount').textContent = `${value.length} / 500`;
  }

  /** Client-side validation. The server repeats these checks — never trust the browser. */
  function validateTransactionForm() {
    const errors = {};
    const title = $('#txTitle').value.trim();
    const amountRaw = $('#txAmount').value.trim();
    const category = $('#txCategory').value;
    const date = $('#txDate').value;
    const notes = $('#txNotes').value.trim();

    if (!title) errors.title = 'Please enter a title.';
    else if (title.length > 100) errors.title = 'Title cannot be longer than 100 characters.';

    if (!amountRaw) errors.amount = 'Please enter an amount.';
    else {
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) errors.amount = 'Amount must be a number.';
      else if (amount <= 0) errors.amount = 'Amount must be greater than 0.';
      else if (amount > 1000000000) errors.amount = 'That amount is too large.';
    }

    if (!category) errors.category = 'Please choose a category.';
    else if (!state.meta.categories.includes(category)) errors.category = 'Please choose a category from the list.';

    if (!date) errors.transaction_date = 'Please pick a date.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.transaction_date = 'Use the date picker to choose a valid date.';
    else {
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        errors.transaction_date = 'That is not a valid calendar date.';
      }
    }

    if (notes.length > 500) errors.notes = 'Notes cannot be longer than 500 characters.';

    return { errors, values: { title, amount: amountRaw, category, date, notes } };
  }

  async function submitTransaction(event) {
    event.preventDefault();
    if (state.busy) return; // stops double submissions

    clearFieldErrors();
    const { errors, values } = validateTransactionForm();
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors);
      return;
    }

    const payload = {
      type: $('#txForm input[name="type"]:checked').value,
      title: values.title,
      amount: Number(values.amount),
      category: values.category,
      transaction_date: values.date,
      notes: values.notes || null,
    };

    // Business-only extras. These are simply absent in Individual mode, and the
    // server decides what belongs to a workspace — the browser cannot switch
    // workspaces by sending an id.
    if (state.mode === 'business') {
      const method = $('#txPaymentMethod').value;
      const taxRate = $('#txTaxRate').value.trim();
      const customerId = $('#txCustomer').value;
      const vendorId = $('#txVendor').value;
      payload.payment_method = method || null;
      payload.tax_rate = taxRate === '' ? null : Number(taxRate);
      payload.customer_id = customerId ? Number(customerId) : null;
      payload.vendor_id = vendorId ? Number(vendorId) : null;
    }

    const submitBtn = $('#txSubmitBtn');
    const originalLabel = submitBtn.textContent;
    state.busy = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      if (state.editingId) {
        await api(`/api/transactions/${state.editingId}`, { method: 'PUT', body: payload });
        toast('success', 'Transaction updated. Totals and charts refreshed.');
      } else {
        await api('/api/transactions', { method: 'POST', body: payload });
        toast('success', 'Transaction saved successfully.');
      }
      closeTransactionDialog();
      await refreshAll({ transactions: true });
    } catch (error) {
      if (error.fields) showFieldErrors(error.fields);
      else {
        const banner = $('#txFormError');
        banner.hidden = false;
        banner.textContent = error.message;
      }
      toast('error', error.message);
    } finally {
      state.busy = false;
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }

  function askConfirmation({ title, text, confirmLabel = 'Delete' }) {
    return new Promise((resolve) => {
      const dialog = confirmDialog();
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      $('#confirmOk').textContent = confirmLabel;

      const cleanup = (result) => {
        $('#confirmOk').removeEventListener('click', onOk);
        $('#confirmCancel').removeEventListener('click', onCancel);
        $('#confirmClose').removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        if (dialog.open) dialog.close();
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = (event) => {
        if (event && event.type === 'cancel') event.preventDefault();
        cleanup(false);
      };

      $('#confirmOk').addEventListener('click', onOk);
      $('#confirmCancel').addEventListener('click', onCancel);
      $('#confirmClose').addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel);

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  async function deleteTransaction(id, title) {
    const confirmed = await askConfirmation({
      title: 'Delete this transaction?',
      text: `“${title}” will be permanently removed from the database. This cannot be undone.`,
      confirmLabel: 'Delete transaction',
    });
    if (!confirmed) return;

    try {
      await api(`/api/transactions/${id}`, { method: 'DELETE' });
      toast('success', 'Transaction deleted.');
      await refreshAll({ transactions: true });
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function startEdit(id) {
    try {
      const { data } = await api(`/api/transactions/${id}`);
      openTransactionDialog(data);
    } catch (error) {
      toast('error', error.message);
    }
  }

  function initTransactionEvents() {
    $('#openAddBtn').addEventListener('click', () => openTransactionDialog());
    $$('[data-action="add"]').forEach((btn) => btn.addEventListener('click', () => openTransactionDialog()));

    $('#txForm').addEventListener('submit', submitTransaction);
    $('#dialogClose').addEventListener('click', closeTransactionDialog);
    $('#dialogCancel').addEventListener('click', closeTransactionDialog);
    $('#txNotes').addEventListener('input', updateNotesCount);

    // Clear a field's error as soon as the user edits it.
    ['txTitle', 'txAmount', 'txCategory', 'txDate', 'txNotes'].forEach((id) => {
      const node = $(`#${id}`);
      node.addEventListener('input', () => {
        const wrap = node.closest('.field');
        if (wrap) wrap.classList.remove('has-error');
        const err = wrap?.querySelector('.field-error');
        if (err) {
          err.textContent = '';
          err.classList.remove('is-visible');
        }
      });
    });

    // Event delegation for the edit/delete buttons in the table.
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const id = Number(button.dataset.id);
      if (action === 'edit' && id) startEdit(id);
      if (action === 'delete' && id) {
        const row = button.closest('tr');
        const title = row?.querySelector('.cell-title strong')?.textContent || 'this transaction';
        deleteTransaction(id, title);
      }
    });
  }

  /* =====================================================================
     11. BUDGET VIEW
     ===================================================================== */

  function renderBudgetView() {
    const budget = state.budget;
    if (!budget) return;

    $('#budgetProgressSub').textContent = `${monthLabel(state.month)} · live from your transactions`;
    $('#budgetMonth').value = state.month;
    if (document.activeElement !== $('#budgetAmount')) {
      $('#budgetAmount').value = budget.isSet ? budget.amount : '';
    }

    const pct = budget.percentUsed ?? 0;
    const bar = $('#budgetBar');
    const wrap = $('#budgetBarWrap');
    const caption = $('#budgetProgressLabel');

    $('#budgetAmountOut').textContent = money(budget.amount);
    $('#budgetSpentOut').textContent = money(budget.spent);
    $('#budgetRemainingOut').textContent = money(budget.remaining);
    $('#budgetCountOut').textContent = String(budget.expenseCount);
    $('#budgetPercent').textContent = budget.isSet ? percent(pct) : '—';
    $('#budgetRing').style.setProperty('--pct', String(Math.min(Math.max(pct, 0), 100)));
    $('#budgetRing').style.setProperty(
      '--ring-colour',
      progressState(pct) === 'over' ? 'var(--expense)' : progressState(pct) === 'warn' ? 'var(--warning)' : 'var(--income)'
    );

    bar.className = `progress-bar state-${progressState(pct)}`;
    bar.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
    wrap.setAttribute('aria-valuenow', String(Math.min(Math.round(pct), 100)));

    caption.className = 'progress-caption';
    if (!budget.isSet) {
      caption.textContent = 'No budget set for this month. Enter an amount on the left to start tracking.';
    } else if (budget.exceeded) {
      caption.classList.add('is-over');
      caption.textContent = `Over budget by ${money(Math.abs(budget.remaining))} — ${percent(pct)} of your ${money(budget.amount)} budget is used.`;
    } else {
      if (pct >= 75) caption.classList.add('is-warn');
      caption.textContent = `${percent(pct)} used — ${money(budget.remaining)} of your ${money(budget.amount)} budget remains.`;
    }

    $('#budgetRemoveBtn').hidden = !budget.isSet;
  }

  async function renderBudgetHistory() {
    const list = $('#budgetHistory');
    try {
      const { data } = await api('/api/budgets?limit=8');
      list.textContent = '';
      if (!data.length) {
        list.append(el('li', { class: 'muted', text: 'No budgets saved yet. Save one above to see it here.' }));
        return;
      }
      for (const item of data) {
        const pct = item.percentUsed ?? 0;
        list.append(
          el(
            'li',
            {},
            el(
              'div',
              {},
              el('div', { class: 'bh-month', text: monthLabel(item.month) }),
              el('div', {
                class: 'bh-meta',
                text: `${money(item.amount)} budget · ${money(item.spent)} spent`,
              })
            ),
            el('div', { class: 'bh-bar' }, el('i', { class: `state-${progressState(pct)}`, style: `width:${Math.min(Math.max(pct, 0), 100)}%` })),
            el('span', { class: 'bh-meta', text: percent(pct) })
          )
        );
      }
    } catch (error) {
      list.textContent = '';
      list.append(el('li', { class: 'muted', text: error.message }));
    }
  }

  async function saveBudget(event) {
    event.preventDefault();
    $('#budgetMonthError').textContent = '';
    $('#budgetAmountError').textContent = '';
    $('#budgetMonthError').classList.remove('is-visible');
    $('#budgetAmountError').classList.remove('is-visible');

    const month = $('#budgetMonth').value;
    const amountRaw = $('#budgetAmount').value;

    let hasError = false;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      $('#budgetMonthError').textContent = 'Please choose a month.';
      $('#budgetMonthError').classList.add('is-visible');
      hasError = true;
    }
    if (amountRaw === '' || Number.isNaN(Number(amountRaw))) {
      $('#budgetAmountError').textContent = 'Please enter a budget amount (0 or more).';
      $('#budgetAmountError').classList.add('is-visible');
      hasError = true;
    } else if (Number(amountRaw) < 0) {
      $('#budgetAmountError').textContent = 'Budget cannot be negative.';
      $('#budgetAmountError').classList.add('is-visible');
      hasError = true;
    }
    if (hasError) return;

    const button = $('#budgetSaveBtn');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      await api('/api/budgets', { method: 'PUT', body: { month, amount: Number(amountRaw) } });
      state.month = month;
      $('#globalMonth').value = month;
      toast('success', `Budget saved for ${monthLabel(month)}.`);
      await refreshAll({ transactions: false });
      await renderBudgetHistory();
    } catch (error) {
      if (error.fields?.amount) {
        $('#budgetAmountError').textContent = error.fields.amount;
        $('#budgetAmountError').classList.add('is-visible');
      }
      if (error.fields?.month) {
        $('#budgetMonthError').textContent = error.fields.month;
        $('#budgetMonthError').classList.add('is-visible');
      }
      toast('error', error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Save Budget';
    }
  }

  function initBudgetEvents() {
    $('#budgetForm').addEventListener('submit', saveBudget);

    $('#budgetMonth').addEventListener('change', async () => {
      const month = $('#budgetMonth').value;
      if (!month) return;
      state.month = month;
      $('#globalMonth').value = month;
      await refreshAll({ transactions: false });
      await renderBudgetHistory();
    });

    $('#budgetRemoveBtn').addEventListener('click', async () => {
      const confirmed = await askConfirmation({
        title: 'Remove this budget?',
        text: `The budget for ${monthLabel(state.month)} will be deleted. Your transactions stay untouched.`,
        confirmLabel: 'Remove budget',
      });
      if (!confirmed) return;
      try {
        await api(`/api/budgets?month=${state.month}`, { method: 'DELETE' });
        toast('success', 'Budget removed.');
        await refreshAll({ transactions: false });
        await renderBudgetHistory();
      } catch (error) {
        toast('error', error.message);
      }
    });
  }

  /* =====================================================================
     12. ANALYTICS VIEW
     ===================================================================== */

  function renderAnalyticsView() {
    const breakdown = state.categoryBreakdown;
    if (!breakdown) return;

    $('#analyticsMonthSub').textContent = `${monthLabel(state.month)} · ${plural(breakdown.categories.length, 'category', 'categories')}`;
    $('#analyticsBarSub').textContent = 'Last 6 months of recorded data';
    $('#analyticsTableSub').textContent = monthLabel(state.month);
    $('#analyticsTotalPill').textContent = `Total ${money(breakdown.total)}`;

    const body = $('#categoryTableBody');
    const empty = $('#categoryTableEmpty');
    body.textContent = '';

    if (breakdown.categories.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    for (const [index, row] of breakdown.categories.entries()) {
      body.append(
        el(
          'tr',
          {},
          el(
            'td',
            {},
            el('span', { class: 'swatch', style: `display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:8px;background:${colourFor(row.category, index)}` }),
            row.category
          ),
          el('td', { class: 'num', text: String(row.count) }),
          el('td', { class: 'num', text: money(row.total) }),
          el(
            'td',
            { class: 'share-cell' },
            el(
              'div',
              { class: 'share-track' },
              el('div', { class: 'share-bar' }, el('i', { style: `width:${Math.max(row.percent, 2)}%` })),
              el('span', { class: 'share-pct', text: `${row.percent}%` })
            )
          )
        )
      );
    }

    renderCharts();
  }

  /* =====================================================================
     13. INSIGHTS VIEW
     ===================================================================== */

  const INSIGHT_ICONS = {
    success: 'i-check',
    warning: 'i-warning',
    danger: 'i-warning',
    info: 'i-info',
  };

  function renderInsightsView() {
    const list = $('#insightList');
    list.textContent = '';
    $('#insightsSub').textContent = `Based on ${monthLabel(state.month)} and all-time records.`;

    if (state.insights.length === 0) {
      list.append(el('li', { class: 'loading-row' }, el('span', { class: 'spinner' }), 'Analysing your data…'));
      return;
    }

    for (const insight of state.insights) {
      list.append(
        el(
          'li',
          { class: `insight-card tone-${insight.tone}` },
          el('span', { class: 'insight-icon', html: icon(INSIGHT_ICONS[insight.tone] || 'i-info') }),
          el('div', {}, el('h3', { text: insight.title }), el('p', { text: insight.text }))
        )
      );
    }

    const month = state.monthSummary;
    if (!month) return;
    $('#snapshotSub').textContent = monthLabel(state.month);
    $('#snapIncome').textContent = money(month.totalIncome);
    $('#snapExpense').textContent = money(month.totalExpenses);
    $('#snapBalance').textContent = money(month.balance);
    $('#snapSavings').textContent = percent(month.savingsRate);
    $('#snapCount').textContent = String(month.transactionCount);
    $('#snapTop').textContent = month.highestCategory
      ? `${month.highestCategory.category} (${money(month.highestCategory.total)})`
      : '—';
  }

  /* =====================================================================
     13b. SHARED UI HELPERS (used by js/business.js and js/personal-extras.js)
     ---------------------------------------------------------------------
     These are deliberately generic: one dialog builds every simple form in
     the app (customer, vendor, bill, goal, recurring rule), so behaviour and
     accessibility are identical everywhere.
     ===================================================================== */

  const STATUS_LABELS = {
    paid: 'Paid',
    unpaid: 'Unpaid',
    partially_paid: 'Partially paid',
    overdue: 'Overdue',
    draft: 'Draft',
    cancelled: 'Cancelled',
    archived: 'Archived',
  };

  /** A coloured pill for a derived document status. */
  function statusBadge(status) {
    const key = status || 'unpaid';
    return el('span', {
      class: `badge badge-${key}`,
      text: STATUS_LABELS[key] || key,
      title: `Status: ${STATUS_LABELS[key] || key}`,
    });
  }

  /** Small pill used for categories / methods / types. */
  function chip(text, extraClass = '') {
    return el('span', { class: `chip ${extraClass}`.trim(), text });
  }

  /**
   * Triggers a file download without navigating away.
   * The URL points at a server endpoint that sets Content-Disposition.
   */
  function downloadCsv(url) {
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  }

  /** Builds `?a=1&b=2` from an object, skipping empty values. */
  function queryString(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  /** Rows of a table that failed to load, with a retry button. */
  function errorRow(message, onRetry, colspan = 6) {
    return el(
      'tr',
      {},
      el(
        'td',
        { colspan: String(colspan) },
        el(
          'div',
          { class: 'loading-row is-error' },
          el('span', { text: message }),
          onRetry ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: onRetry }, 'Try again') : null
        )
      )
    );
  }

  function loadingRow(message, colspan = 6) {
    return el(
      'tr',
      {},
      el('td', { colspan: String(colspan) }, el('div', { class: 'loading-row' }, el('span', { class: 'spinner' }), message))
    );
  }

  /** Sets a button into a temporary "working…" state. */
  async function withBusy(button, label, task) {
    if (!button) return task();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  // ------------------------------------------------------------------
  // Generic form dialog
  // ------------------------------------------------------------------

  /**
   * Opens the shared form dialog.
   *
   * @param {object} options
   *   title, subtitle, submitLabel, note
   *   fields: [{ name, label, type, required, options, hint, group, ... }]
   *   values: current values (edit mode)
   *   onSubmit(payload): async — throw to keep the dialog open.
   */
  function openForm({ title, subtitle = '', submitLabel = 'Save', fields = [], values = {}, note = '', onSubmit }) {
    const dialog = $('#formDialog');
    const body = $('#formDialogBody');
    const form = $('#genericForm');
    const submitBtn = $('#formDialogSubmit');

    $('#formDialogTitle').textContent = title;
    $('#formDialogSub').textContent = subtitle;
    submitBtn.textContent = submitLabel;
    body.textContent = '';

    if (note) body.append(el('p', { class: 'helper-note', text: note }));

    const clearErrors = () => {
      $$('.field', body).forEach((field) => field.classList.remove('has-error'));
      $$('.field-error', body).forEach((node) => {
        node.textContent = '';
        node.classList.remove('is-visible');
      });
      const banner = $('#formDialogError');
      if (banner) banner.remove();
    };

    const setFieldError = (name, message) => {
      const node = body.querySelector(`[data-error-for="${name}"]`);
      if (!node) return false;
      node.textContent = message;
      node.classList.add('is-visible');
      const wrap = node.closest('.field');
      if (wrap) wrap.classList.add('has-error');
      return true;
    };

    let groupName = null;
    let groupRow = null;

    for (const spec of fields) {
      const id = `ff-${spec.name}`;
      const wrap = el('div', { class: 'field' });
      const value = values[spec.name];

      if (spec.type === 'checkbox') {
        const input = el('input', { type: 'checkbox', id, name: spec.name });
        input.checked = Boolean(value);
        wrap.append(el('label', { class: 'switch-label', for: id }, input, el('span', { text: spec.label })));
      } else {
        const label = el('label', { for: id }, spec.label);
        if (spec.required) label.append(el('span', { class: 'req', text: ' *' }));
        else if (spec.optional !== false) label.append(el('span', { class: 'optional', text: ' (optional)' }));
        wrap.append(label);

        let input;
        if (spec.type === 'select') {
          input = el('select', { id, name: spec.name });
          for (const option of spec.options || []) {
            input.append(el('option', { value: String(option.value), text: option.label }));
          }
          const chosen = value !== undefined && value !== null ? String(value) : '';
          input.value = chosen;
          if (input.value !== chosen && spec.options?.length) input.value = String(spec.options[0].value);
        } else if (spec.type === 'textarea') {
          input = el('textarea', { id, name: spec.name, rows: String(spec.rows || 3) });
          input.value = value ?? '';
        } else {
          input = el('input', { type: spec.type || 'text', id, name: spec.name });
          if (spec.step) input.setAttribute('step', String(spec.step));
          if (spec.min !== undefined) input.setAttribute('min', String(spec.min));
          if (spec.max !== undefined) input.setAttribute('max', String(spec.max));
          if (spec.maxlength) input.setAttribute('maxlength', String(spec.maxlength));
          if (spec.placeholder) input.setAttribute('placeholder', spec.placeholder);
          input.value = value ?? '';
        }
        if (spec.required) input.setAttribute('required', '');
        if (spec.maxlength && spec.type === 'textarea') input.setAttribute('maxlength', String(spec.maxlength));
        wrap.append(input);
      }

      if (spec.hint) wrap.append(el('p', { class: 'field-hint', text: spec.hint }));
      wrap.append(el('p', { class: 'field-error', role: 'alert', dataset: { errorFor: spec.name } }));

      if (spec.group) {
        if (groupName !== spec.group) {
          groupName = spec.group;
          groupRow = el('div', { class: 'field-row' });
          body.append(groupRow);
        }
        groupRow.append(wrap);
      } else {
        groupName = null;
        groupRow = null;
        body.append(wrap);
      }
    }

    const readValues = () => {
      const payload = {};
      for (const spec of fields) {
        const node = body.querySelector(`[name="${spec.name}"]`);
        if (!node) continue;
        if (spec.type === 'checkbox') payload[spec.name] = node.checked;
        else payload[spec.name] = node.value.trim();
      }
      return payload;
    };

    const closeDialog = () => {
      form.onsubmit = null;
      if (dialog.open) dialog.close();
      submitBtn.disabled = false;
    };

    // Replacing the handler (instead of adding one) means the dialog can be
    // opened many times without stacking duplicate submissions.
    form.onsubmit = async (event) => {
      event.preventDefault();
      clearErrors();

      const payload = readValues();
      const missing = fields.filter((spec) => spec.required && !payload[spec.name]);
      if (missing.length > 0) {
        for (const spec of missing) setFieldError(spec.name, `${spec.label} is required.`);
        const first = body.querySelector(`[name="${missing[0].name}"]`);
        if (first) first.focus();
        return;
      }

      submitBtn.disabled = true;
      const original = submitBtn.textContent;
      submitBtn.textContent = 'Saving…';
      try {
        await onSubmit(payload);
        closeDialog();
      } catch (error) {
        let mapped = false;
        if (error.fields) {
          for (const [field, message] of Object.entries(error.fields)) {
            if (setFieldError(field, message)) mapped = true;
          }
        }
        if (!mapped) {
          body.append(el('p', { class: 'form-error-banner', id: 'formDialogError', role: 'alert', text: error.message }));
        }
        toast('error', error.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
      }
    };

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => {
      const first = body.querySelector('input, select, textarea');
      if (first) first.focus();
    }, 40);
  }

  function initFormDialog() {
    const dialog = $('#formDialog');
    const close = () => {
      $('#genericForm').onsubmit = null;
      if (dialog.open) dialog.close();
    };
    $('#formDialogClose').addEventListener('click', close);
    $('#formDialogCancel').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
  }

  /* =====================================================================
     14. REFRESH + TOASTS + BOOT
     ===================================================================== */

  async function refreshAll({ transactions = true } = {}) {
    // In Business mode the individual dashboards have nothing to say, so a
    // write simply re-renders the business screen that is currently open.
    if (state.mode === 'business') {
      await refreshAfterMutation();
      return;
    }

    try {
      await Promise.all([
        loadSummary(),
        loadCategoryBreakdown(),
        loadMonthlySeries(),
        loadInsights(),
        loadBudget(),
      ]);

      if (transactions) {
        await loadTransactions({ reset: true });
        const { data } = await api('/api/transactions?limit=5');
        state.recent = data;
      } else if (!state.recent) {
        const { data } = await api('/api/transactions?limit=5');
        state.recent = data;
      }

      renderDashboard();
      renderBudgetView();
      renderAnalyticsView();
      renderInsightsView();
    } catch (error) {
      toast('error', error.message);
    }
  }

  function toast(type, message) {
    const stack = $('#toastStack');
    const iconName = type === 'success' ? 'i-check' : type === 'error' ? 'i-warning' : 'i-info';
    const node = el(
      'div',
      { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
      el('span', { html: icon(iconName) }),
      el('span', { text: message })
    );
    stack.append(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 200);
    }, type === 'error' ? 6000 : 3800);
  }

  function initGlobalMonth() {
    $('#globalMonth').addEventListener('change', async (event) => {
      const month = event.target.value;
      if (!month) return;
      state.month = month;
      $('#budgetMonth').value = month;
      await refreshAll({ transactions: false });
      if (state.view === 'transactions') await loadTransactions({ reset: true });
    });
  }

  /* =====================================================================
     15. VIEW RENDERERS + MODE WIRING
     ===================================================================== */

  // Individual screens live here; the two extra files register the rest.
  registerView('dashboard', async () => {
    // First load calls this from boot(); after a mode switch the caches are
    // deliberately empty, so reload whatever the dashboard needs.
    if (!state.summary || !state.monthlySeries.length || !state.categoryBreakdown) {
      await refreshAll({ transactions: false });
    }
    renderDashboard();
  });
  registerView('transactions', async () => {
    await loadTransactions({ reset: true });
  });
  registerView('budget', async () => {
    if (!state.budget) await loadBudget();
    renderBudgetView();
    await renderBudgetHistory();
  });
  registerView('analytics', async () => {
    if (!state.monthlySeries.length) await loadMonthlySeries();
    if (!state.categoryBreakdown) await loadCategoryBreakdown();
    renderAnalyticsView();
  });
  registerView('insights', async () => {
    if (!state.insights.length) await loadInsights();
    renderInsightsView();
  });

  /**
   * The global bridge. The extra script files extend SmartSpend through this
   * object instead of duplicating helpers — one implementation, one behaviour.
   */
  window.SS = {
    // state
    state,
    VIEW_META,
    MODE_VIEWS,
    // dom helpers
    $,
    $$,
    el,
    icon,
    chip,
    statusBadge,
    STATUS_LABELS,
    // formatting
    money,
    moneyShort,
    percent,
    monthLabel,
    monthShort,
    formatDate,
    todayISO,
    currentMonth,
    plural,
    colourFor,
    METHOD_LABELS,
    // chart helpers (so business charts look identical to 1.0 charts)
    chartTheme,
    baseChartOptions,
    toggleChartEmpty,
    // api + navigation
    api,
    queryString,
    switchView,
    registerView,
    renderCurrentView,
    refreshAfterMutation,
    setMode,
    openPurposeScreen,
    closePurposeScreen,
    hasChosenPurpose,
    loadBusinessParties,
    fillSelect,
    populateCategoryOptions,
    // ui helpers
    toast,
    askConfirmation,
    openForm,
    downloadCsv,
    withBusy,
    loadingRow,
    errorRow,
  };

  async function boot() {
    initTheme();

    await loadMeta(); // handles its own errors and always leaves usable defaults

    // Workspaces come from the database: 1 = Personal, 2 = My Business.
    // A mode is therefore just a workspace selection, never a login.
    try {
      await loadWorkspaces();
    } catch (error) {
      toast('error', `Could not load workspaces: ${error.message}`);
      state.workspaces = [
        { id: 1, name: 'Personal', type: 'individual' },
        { id: 2, name: 'My Business', type: 'business' },
      ];
    }

    let savedMode = null;
    try {
      savedMode = localStorage.getItem(MODE_KEY);
    } catch {
      savedMode = null;
    }

    // A deep link to a screen that belongs to one mode decides that mode
    // (e.g. #invoices can only mean Business). Otherwise the last used mode
    // is restored, and Individual is the default.
    const hashView = (window.location.hash || '').replace('#', '');
    if (hashView && VIEW_META[hashView] && VIEW_META[hashView].mode !== 'both') {
      state.initialMode = VIEW_META[hashView].mode;
    }

    const wanted = state.initialMode || savedMode || 'individual';
    await setMode(wanted, { openView: false, updateHash: false });

    initNavigation();
    initModeSwitcher();
    initPurposeScreen();
    initFilters();
    initTransactionEvents();
    initBudgetEvents();
    initGlobalMonth();
    initFormDialog();

    // Individual data powers the shared dashboard; business screens fetch
    // their own data when they are opened.
    if (state.mode === 'individual') {
      await refreshAll({ transactions: true });
      await renderBudgetHistory();
    }
    await renderCurrentView({ force: true });

    // If the transaction list happens to open first, make sure it is rendered.
    if (state.view === 'transactions') renderTransactionList();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
