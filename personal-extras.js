/* ==========================================================================
   SmartSpend — js/personal-extras.js
   --------------------------------------------------------------------------
   The Individual-mode screens that were added in 2.0:

       Savings Goals     record money you put aside for something
       Recurring         rules for regular payments + upcoming expectations
       Reports           monthly summary, category breakdown, CSV export
       Settings          workspace details, schema version, mode comparison

   HOW THIS FILE FITS IN
   app.js runs first and exposes a global `SS` object (state, api(), el(),
   money(), openForm(), toast() ...). This file extends SmartSpend by
   registering renderers with SS.registerView(), so app.js never has to know
   these screens exist. Everything is plain vanilla JS.

   NOTE ON SAFETY: no value from the database is ever interpolated into
   HTML. The el() helper always uses textContent, which is what keeps titles
   like "<script>" harmless.
   ========================================================================== */

'use strict';

(() => {
  const SS = window.SS;
  const { $, $$, el, icon, api, money, monthLabel, formatDate, todayISO, currentMonth, plural, toast, askConfirmation, openForm, queryString, downloadCsv, withBusy, loadingRow, errorRow } = SS;

  /** Cached data for this screen, kept out of app.js state on purpose. */
  const local = {
    goals: [],
    rules: [],
    upcoming: null,
    reports: { monthly: [], categories: [], from: '', to: '' },
    loaded: { goals: false, recurring: false, reports: false, settings: false },
  };

  const rangeLabel = (from, to) => {
    if (!from && !to) return 'All dates';
    if (from && to) return `${formatDate(from)} → ${formatDate(to)}`;
    return from ? `From ${formatDate(from)}` : `Until ${formatDate(to)}`;
  };

  const progressBar = (percent) => {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    return el(
      'div',
      { class: 'progress', role: 'progressbar', 'aria-valuenow': String(Math.round(safe)), 'aria-valuemin': '0', 'aria-valuemax': '100' },
      el('span', { class: 'progress-bar', style: `width:${safe}%` })
    );
  };

  /* =====================================================================
     SAVINGS GOALS
     ===================================================================== */

  async function loadGoals() {
    const { data } = await api('/api/savings-goals?includeArchived=true');
    local.goals = data;
    local.loaded.goals = true;
    return data;
  }

  function goalCard(goal) {
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onClick: () => openContributionDialog(goal),
        text: 'Add money',
      }),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `Edit ${goal.name}`,
        'aria-label': `Edit ${goal.name}`,
        onClick: () => openGoalDialog(goal),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: goal.is_archived ? `Restore ${goal.name}` : `Archive ${goal.name}`,
        'aria-label': goal.is_archived ? `Restore ${goal.name}` : `Archive ${goal.name}`,
        onClick: () => toggleGoalArchive(goal),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-archive') })),
      el('button', {
        class: 'row-btn danger',
        type: 'button',
        title: `Delete ${goal.name}`,
        'aria-label': `Delete ${goal.name}`,
        onClick: () => deleteGoal(goal),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') }))
    );

    return el(
      'div',
      { class: `goal-item${goal.isComplete ? ' goal-complete' : ''}` },
      el(
        'header',
        {},
        el(
          'div',
          {},
          el(
            'h3',
            {},
            goal.name,
            goal.is_archived ? el('span', { class: 'chip', text: 'Archived', style: 'margin-left:8px' }) : null,
            goal.isComplete ? el('span', { class: 'badge badge-paid', text: 'Reached', style: 'margin-left:8px' }) : null
          ),
          el('p', {
            class: 'goal-target',
            text: goal.target_date ? `Target ${formatDate(goal.target_date)}` : 'No target date',
          })
        ),
        actions
      ),
      progressBar(goal.percent),
      el(
        'div',
        { class: 'goal-figures' },
        el('span', {}, 'Saved ', el('strong', { text: money(goal.saved) }), ` of ${money(goal.target)}`),
        el('span', {}, `${goal.percent}% · `, el('strong', { text: money(goal.remaining) }), ' to go')
      )
    );
  }

  function renderGoals() {
    const list = $('#goalList');
    const empty = $('#goalsEmpty');
    if (!list) return;

    list.textContent = '';
    const active = local.goals.filter((g) => !g.is_archived);
    const archived = local.goals.filter((g) => g.is_archived);

    if (local.goals.length === 0) {
      list.hidden = true;
      empty.hidden = false;
    } else {
      list.hidden = false;
      empty.hidden = true;
      const wrap = el('div', { class: 'goal-list' });
      for (const goal of [...active, ...archived]) wrap.append(goalCard(goal));
      list.append(wrap);
    }

    // Side panel totals (active goals only — archived ones are historical).
    const target = active.reduce((sum, g) => sum + Number(g.target), 0);
    const saved = active.reduce((sum, g) => sum + Number(g.saved), 0);
    const remaining = active.reduce((sum, g) => sum + Number(g.remaining), 0);
    $('#goalTotalSaved').textContent = money(saved);
    $('#goalTotalTarget').textContent = money(target);
    $('#goalTotalRemaining').textContent = money(remaining);
    $('#goalTotalComplete').textContent = String(active.filter((g) => g.isComplete).length);
  }

  function openGoalDialog(goal = null) {
    openForm({
      title: goal ? 'Edit Savings Goal' : 'New Savings Goal',
      subtitle: 'Progress is calculated from the money you actually put in.',
      submitLabel: goal ? 'Save changes' : 'Create goal',
      values: goal
        ? { name: goal.name, target: goal.target, target_date: goal.target_date || '', notes: goal.notes || '' }
        : {},
      fields: [
        { name: 'name', label: 'Goal name', type: 'text', required: true, maxlength: 100, placeholder: 'New laptop' },
        { name: 'target', label: 'Target amount (₹)', type: 'number', required: true, min: 1, step: '0.01' },
        { name: 'target_date', label: 'Target date', type: 'date', group: 'dates' },
        { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500, rows: 2 },
      ],
      onSubmit: async (payload) => {
        const body = {
          name: payload.name,
          target: Number(payload.target),
          target_date: payload.target_date || null,
          notes: payload.notes || null,
        };
        if (goal) await api(`/api/savings-goals/${goal.id}`, { method: 'PUT', body });
        else await api('/api/savings-goals', { method: 'POST', body });
        toast('success', goal ? 'Goal updated.' : 'Goal created.');
        await loadGoals();
        renderGoals();
      },
    });
  }

  function openContributionDialog(goal) {
    const remainingToTarget = Math.max(Number(goal.target) - Number(goal.saved), 0);
    openForm({
      title: `Add money — ${goal.name}`,
      subtitle: `${money(goal.saved)} saved of ${money(goal.target)} · ${money(remainingToTarget)} to go`,
      submitLabel: 'Save contribution',
      note: 'Use a negative amount to withdraw money you already saved. A goal can never go below zero.',
      values: { contributed_on: todayISO() },
      fields: [
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, step: '0.01', placeholder: '5000', hint: 'Negative values withdraw from the goal.' },
        { name: 'contributed_on', label: 'Date', type: 'date', required: true, group: 'd' },
        { name: 'notes', label: 'Note', type: 'text', maxlength: 500 },
      ],
      onSubmit: async (payload) => {
        await api(`/api/savings-goals/${goal.id}/contributions`, {
          method: 'POST',
          body: { amount: Number(payload.amount), contributed_on: payload.contributed_on, notes: payload.notes || null },
        });
        toast('success', 'Savings updated.');
        await loadGoals();
        renderGoals();
      },
    });
  }

  async function toggleGoalArchive(goal) {
    try {
      await api(`/api/savings-goals/${goal.id}/archive`, {
        method: 'POST',
        body: { archived: !goal.is_archived },
      });
      toast('success', goal.is_archived ? 'Goal restored.' : 'Goal archived.');
      await loadGoals();
      renderGoals();
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function deleteGoal(goal) {
    const confirmed = await askConfirmation({
      title: 'Delete this savings goal?',
      text: `"${goal.name}" and its ${plural(goal.contribution_count, 'contribution')} will be permanently removed. Archive it instead if you want to keep the history.`,
      confirmLabel: 'Delete goal',
    });
    if (!confirmed) return;
    try {
      await api(`/api/savings-goals/${goal.id}`, { method: 'DELETE' });
      toast('success', 'Goal deleted.');
      await loadGoals();
      renderGoals();
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function renderGoalsScreen() {
    if (!local.loaded.goals) {
      $('#goalList').innerHTML = '';
      $('#goalList').append(loadingRow('Loading goals…', 1));
    }
    try {
      await loadGoals();
      renderGoals();
    } catch (error) {
      $('#goalList').textContent = '';
      $('#goalList').append(el('div', { class: 'loading-row is-error' }, el('span', { text: error.message })));
      throw error;
    }
  }

  /* =====================================================================
     RECURRING EXPENSES
     ===================================================================== */

  async function loadRules() {
    const [rules, upcoming] = await Promise.all([api('/api/recurring'), api('/api/recurring/upcoming?days=45')]);
    local.rules = rules.data;
    local.upcoming = upcoming.data;
    local.loaded.recurring = true;
  }

  const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

  function ruleRow(rule) {
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `Edit ${rule.title}`,
        'aria-label': `Edit ${rule.title}`,
        onClick: () => openRuleDialog(rule),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })),
      el('button', {
        class: 'row-btn danger',
        type: 'button',
        title: `Delete ${rule.title}`,
        'aria-label': `Delete ${rule.title}`,
        onClick: () => deleteRule(rule),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') }))
    );

    return el(
      'tr',
      {},
      el(
        'td',
        {},
        el(
          'div',
          { class: 'cell-title' },
          el('strong', { text: rule.title }),
          rule.is_active ? null : el('small', { text: 'Paused' })
        )
      ),
      el('td', {}, el('span', { class: 'chip', text: rule.category })),
      el('td', { text: FREQUENCY_LABELS[rule.frequency] || rule.frequency }),
      el('td', { text: formatDate(rule.next_due_date) }),
      el('td', { class: 'num', text: money(rule.amount) }),
      el('td', { class: 'num', text: String(rule.generatedCount) }),
      el('td', { class: 'actions-col' }, actions)
    );
  }

  function renderRecurring() {
    const body = $('#ruleBody');
    const empty = $('#rulesEmpty');
    body.textContent = '';

    if (local.rules.length === 0) {
      body.append(el('tr', {}, el('td', { colspan: '7' }, el('div', { class: 'muted', text: 'No rules yet.' }))));
      empty.hidden = false;
    } else {
      empty.hidden = true;
      for (const rule of local.rules) body.append(ruleRow(rule));
    }

    // Upcoming list
    const list = $('#upcomingList');
    list.textContent = '';
    const upcoming = local.upcoming;
    $('#upcomingSub').textContent = `Next ${upcoming?.horizonDays || 45} days · nothing is created automatically`;

    if (!upcoming || upcoming.items.length === 0) {
      list.append(el('li', { class: 'muted', text: 'Nothing expected in the next few weeks.' }));
    } else {
      for (const item of upcoming.items.slice(0, 12)) {
        list.append(
          el(
            'li',
            { class: item.isOverdue ? 'is-overdue' : '' },
            el('span', { class: 'timeline-date', text: formatDate(item.dueDate) }),
            el(
              'span',
              { class: 'timeline-title' },
              el('strong', { text: item.title }),
              el('br'),
              el('span', { class: 'muted', text: `${item.category} · ${FREQUENCY_LABELS[item.frequency] || item.frequency}` })
            ),
            el('span', { class: 'timeline-amount', text: money(item.amount) })
          )
        );
      }
      if (upcoming.items.length > 12) {
        list.append(el('li', { class: 'muted', text: `…and ${upcoming.items.length - 12} more expected payment(s).` }));
      }
    }
  }

  function openRuleDialog(rule = null) {
    const categories = SS.state.meta.categories || [];
    openForm({
      title: rule ? 'Edit Recurring Rule' : 'New Recurring Rule',
      subtitle: 'A rule describes a payment; it does not create transactions by itself.',
      submitLabel: rule ? 'Save changes' : 'Create rule',
      values: rule
        ? {
            title: rule.title,
            type: rule.type,
            category: rule.category,
            amount: rule.amount,
            frequency: rule.frequency,
            start_date: rule.start_date,
            notes: rule.notes || '',
            is_active: rule.is_active,
          }
        : { type: 'expense', frequency: 'monthly', start_date: todayISO(), is_active: true },
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true, maxlength: 100, placeholder: 'House rent' },
        { name: 'type', label: 'Type', type: 'select', required: true, options: [
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ], group: 'a' },
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0.01, step: '0.01', group: 'a' },
        { name: 'category', label: 'Category', type: 'select', required: true, options: categories.map((c) => ({ value: c, label: c })) },
        { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label })), group: 'b' },
        { name: 'start_date', label: 'First due date', type: 'date', required: true, group: 'b' },
        { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500, rows: 2 },
        { name: 'is_active', label: 'Active (included in upcoming payments)', type: 'checkbox' },
      ],
      onSubmit: async (payload) => {
        const body = {
          title: payload.title,
          type: payload.type,
          category: payload.category,
          amount: Number(payload.amount),
          frequency: payload.frequency,
          start_date: payload.start_date,
          notes: payload.notes || null,
          is_active: Boolean(payload.is_active),
        };
        if (rule) await api(`/api/recurring/${rule.id}`, { method: 'PUT', body });
        else await api('/api/recurring', { method: 'POST', body });
        toast('success', rule ? 'Rule updated.' : 'Rule created.');
        await loadRules();
        renderRecurring();
      },
    });
  }

  async function deleteRule(rule) {
    const confirmed = await askConfirmation({
      title: 'Delete this recurring rule?',
      text: `"${rule.title}" will stop producing entries. Transactions it already created are kept.`,
      confirmLabel: 'Delete rule',
    });
    if (!confirmed) return;
    try {
      await api(`/api/recurring/${rule.id}`, { method: 'DELETE' });
      toast('success', 'Rule deleted.');
      await loadRules();
      renderRecurring();
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function runRecurring(button) {
    const result = $('#recurringRunResult');
    try {
      const response = await withBusy(button, 'Generating…', () => api('/api/recurring/run', { method: 'POST' }));
      const created = response.data.createdCount ?? 0;
      const total = (response.data.created || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      result.textContent =
        created === 0
          ? 'No new entries were due — running it again created nothing, which is exactly what should happen.'
          : `${created} ${plural(created, 'entry', 'entries')} created (${money(total)}). Pressing the button again will not duplicate them.`;
      toast('success', response.message || 'Recurring entries processed.');
      await loadRules();
      renderRecurring();
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function renderRecurringScreen() {
    try {
      await loadRules();
      renderRecurring();
    } catch (error) {
      $('#ruleBody').textContent = '';
      $('#ruleBody').append(errorRow(error.message, () => renderRecurringScreen(), 7));
      throw error;
    }
  }

  /* =====================================================================
     REPORTS (individual)
     ===================================================================== */

  async function loadReports() {
    const { from, to } = local.reports;
    const [monthly, categories] = await Promise.all([
      api(`/api/reports/monthly-summary${queryString({ from, to })}`),
      api(`/api/analytics/categories${queryString({ month: '' })}`).catch(() => ({ data: [] })),
    ]);
    local.reports.monthly = monthly.data;
    local.loaded.reports = true;

    // Category breakdown for the range comes from the transactions endpoint so
    // it honours the same from/to filters as the export.
    const tx = await api(`/api/transactions${queryString({ from, to, type: 'expense', limit: 500 })}`);
    const totals = new Map();
    for (const row of tx.data) {
      const entry = totals.get(row.category) || { category: row.category, count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Number(row.amount);
      totals.set(row.category, entry);
    }
    local.reports.categories = [...totals.values()].sort((a, b) => b.amount - a.amount);
  }

  function renderReports() {
    const monthlyBody = $('#reportMonthlyBody');
    const categoryBody = $('#reportCategoryBody');
    monthlyBody.textContent = '';
    categoryBody.textContent = '';

    const monthly = local.reports.monthly;
    const categories = local.reports.categories;

    if (monthly.length === 0) {
      monthlyBody.append(el('tr', {}, el('td', { colspan: '5' }, el('div', { class: 'muted', text: 'No months in this range.' }))));
      $('#reportMonthlyEmpty').hidden = false;
    } else {
      $('#reportMonthlyEmpty').hidden = true;
      for (const row of monthly) {
        monthlyBody.append(
          el(
            'tr',
            {},
            el('td', { text: monthLabel(row.month) }),
            el('td', { class: 'num amount-income', text: money(row.income) }),
            el('td', { class: 'num amount-expense', text: money(row.expense) }),
            el('td', { class: `num ${Number(row.net) < 0 ? 'amount-expense' : ''}`, text: money(row.net) }),
            el('td', { class: 'num', text: `${row.savingsRate}%` })
          )
        );
      }
    }

    if (categories.length === 0) {
      categoryBody.append(el('tr', {}, el('td', { colspan: '4' }, el('div', { class: 'muted', text: 'No expenses in this range.' }))));
      $('#reportCategoryEmpty').hidden = false;
    } else {
      $('#reportCategoryEmpty').hidden = true;
      const total = categories.reduce((sum, c) => sum + c.amount, 0);
      for (const entry of categories) {
        const share = total > 0 ? Math.round((entry.amount / total) * 1000) / 10 : 0;
        categoryBody.append(
          el(
            'tr',
            {},
            el('td', {}, el('span', { class: 'chip', text: entry.category })),
            el('td', { class: 'num', text: String(entry.count) }),
            el('td', { class: 'num', text: money(entry.amount) }),
            // Reuses the 1.0 share-bar component (flex track + <i> fill).
            el(
              'td',
              { class: 'share-cell' },
              el(
                'div',
                { class: 'share-track' },
                el('div', { class: 'share-bar' }, el('i', { style: `width:${Math.max(share, 2)}%` })),
                el('span', { class: 'share-pct', text: `${share}%` })
              )
            )
          )
        );
      }
    }

    $('#reportCategorySub').textContent = `Expenses · ${rangeLabel(local.reports.from, local.reports.to)}`;

    // Keep the export links in step with the visible range.
    $('#exportTxBtn').href = `/api/export/transactions.csv${queryString({ from: local.reports.from, to: local.reports.to })}`;
    $('#exportSummaryBtn').href = `/api/export/monthly-summary.csv${queryString({ from: local.reports.from, to: local.reports.to })}`;
  }

  function initReportFilters() {
    const form = $('#reportFilterForm');
    const fromInput = $('#reportFrom');
    const toInput = $('#reportTo');
    const monthSelect = $('#reportMonth');

    // Quick-pick list: the last 12 months.
    monthSelect.textContent = '';
    monthSelect.append(el('option', { value: '', text: 'Custom range' }));
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthSelect.append(el('option', { value, text: monthLabel(value) }));
    }

    const apply = async () => {
      local.reports.from = fromInput.value;
      local.reports.to = toInput.value;
      try {
        await loadReports();
        renderReports();
      } catch (error) {
        toast('error', error.message);
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      apply();
    });
    fromInput.addEventListener('change', apply);
    toInput.addEventListener('change', apply);

    monthSelect.addEventListener('change', () => {
      const month = monthSelect.value;
      if (!month) return;
      const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      fromInput.value = `${month}-01`;
      toInput.value = `${month}-${String(lastDay).padStart(2, '0')}`;
      apply();
    });
  }

  async function renderReportsScreen() {
    if (!local.reports.from && !local.reports.to) {
      // Default to the current month.
      const month = currentMonth();
      const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      local.reports.from = `${month}-01`;
      local.reports.to = `${month}-${String(lastDay).padStart(2, '0')}`;
      $('#reportFrom').value = local.reports.from;
      $('#reportTo').value = local.reports.to;
    }
    await loadReports();
    renderReports();
  }

  /* =====================================================================
     SETTINGS
     ===================================================================== */

  async function renderSettings() {
    const workspace = SS.state.workspace;
    $('#workspaceName').value = workspace?.name || '';
    $('#workspaceType').value = workspace?.type === 'business' ? 'Business book' : 'Individual book';
    $('#workspaceForm').onsubmit = async (event) => {
      event.preventDefault();
      const name = $('#workspaceName').value.trim();
      if (!name) {
        toast('error', 'Workspace name cannot be empty.');
        return;
      }
      try {
        const { data } = await api(`/api/workspaces/${SS.state.workspaceId}`, { method: 'PATCH', body: { name } });
        SS.state.workspace = data;
        toast('success', 'Workspace name saved.');
        $$('.mode-btn').forEach((btn) => {
          if (btn.dataset.mode === SS.state.mode) btn.classList.add('is-active');
        });
        // Refresh the caption under the mode switcher.
        const caption = $('#modeCaption');
        if (caption) {
          caption.textContent =
            SS.state.mode === 'business' ? `Business book · ${name}` : `Personal book · ${name}`;
        }
      } catch (error) {
        toast('error', error.message);
      }
    };

    try {
      const { data, counts } = await api('/api/system/migrations');
      const list = $('#migrationList');
      list.textContent = '';
      for (const migration of data) {
        // The API returns { applied: true, appliedAt: '2026-10-28 15:11:47' }.
        // (An earlier version of this screen read `applied_at` only, which made
        // every migration look "not applied" even when it had run. Accept both
        // spellings so the screen cannot lie about the schema again.)
        const when = migration.appliedAt || migration.applied_at || (migration.applied ? 'yes' : '');
        const isApplied = Boolean(migration.applied) || Boolean(when);
        list.append(
          el(
            'li',
            {},
            el('code', { text: migration.id || migration.version }),
            el('span', {
              class: 'muted',
              text: isApplied ? (when && when !== 'yes' ? `applied ${when}` : 'applied') : 'not applied',
            }),
            el('span', { class: `dot ${isApplied ? 'dot-safe' : 'dot-warn'}`, title: isApplied ? 'Applied' : 'Pending' })
          )
        );
      }
      $('#dbCounts').textContent = `Rows in this database file: ${counts.transactions} transactions · ${counts.budgets} monthly budgets · ${counts.invoices} invoices · ${counts.customers} customers · ${counts.vendors} vendors.`;
    } catch (error) {
      $('#migrationList').textContent = '';
      $('#migrationList').append(el('li', { class: 'muted', text: `Could not read the schema version: ${error.message}` }));
    }

    // The Supabase "Account & Cloud" card lives in js/cloud.js; ask it to
    // refresh now that this screen is visible.
    if (window.SmartSpendCloud && typeof window.SmartSpendCloud.refresh === 'function') {
      window.SmartSpendCloud.refresh();
    }
  }

  /* =====================================================================
     EVENT WIRING + REGISTRATION
     ===================================================================== */

  function init() {
    // "Change my purpose" re-opens the first-run chooser from Settings.
    $('#changePurposeBtn')?.addEventListener('click', () => {
      SS.openPurposeScreen({ preselect: SS.state.mode });
    });

    // Goals
    $('#addGoalBtn')?.addEventListener('click', () => openGoalDialog());
    // Recurring
    $('#addRuleBtn')?.addEventListener('click', () => openRuleDialog());
    $('#runRecurringBtn')?.addEventListener('click', (event) => runRecurring(event.currentTarget));
    initReportFilters();
  }

  SS.registerView('goals', renderGoalsScreen);
  SS.registerView('recurring', renderRecurringScreen);
  SS.registerView('reports', renderReportsScreen);
  SS.registerView('settings', renderSettings);

  // Also expose a couple of helpers for the other script files.
  SS.personalExtras = { progressBar, rangeLabel, loadRules, renderRecurring };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
