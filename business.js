/* ==========================================================================
   SmartSpend — js/business.js
   --------------------------------------------------------------------------
   The Business-mode screens (except invoices, which live in invoices.js):

       Business Dashboard   revenue, expenses, profit, outstanding, cash flow
       Customers            CRUD, archive instead of destructive delete
       Vendors              CRUD, same safety rules
       Bills & Payables     what you owe, with payment recording
       Cash Flow            money that actually moved
       Reports              tax estimates + payment methods + CSV exports

   THE TWO FINANCIAL RULES THIS FILE FOLLOWS
   1. An unpaid invoice is NOT revenue received and an unpaid bill is NOT cash
      paid. Outstanding amounts are always shown separately from cash.
   2. Every number on screen comes from the server. The browser never adds up
      money and never decides a status.
   ========================================================================== */

'use strict';

(() => {
  const SS = window.SS;
  const {
    $, el, icon, api, money, moneyShort, formatDate, todayISO, currentMonth,
    toast, askConfirmation, openForm, queryString, downloadCsv, withBusy,
    loadingRow, errorRow, statusBadge, chip, chartTheme, baseChartOptions,
    toggleChartEmpty, monthLabel, monthShort, plural,
  } = SS;

  /** Screen-local caches (deliberately separate from app.js state). */
  const local = {
    dashboard: null,
    trendMode: 'bar', // 'bar' = revenue vs expenses, 'profit' = profit trend
    charts: { trend: null, doughnut: null },
    customers: [],
    vendors: [],
    bills: [],
    billSummary: null,
    filters: { search: '', status: 'all', vendor_id: '', from: '', to: '' },
    range: { from: '', to: '' },
    reportRange: { from: '', to: '' },
  };

  const rangeText = (from, to) => (!from && !to ? 'All time' : `${from ? formatDate(from) : 'Start'} → ${to ? formatDate(to) : 'Today'}`);

  /* =====================================================================
     1. BUSINESS DASHBOARD
     ===================================================================== */

  function renderStatCards(data) {
    const set = (id, value, note, tone) => {
      const node = $(`#${id}`);
      if (!node) return;
      node.classList.remove('skeleton');
      node.textContent = value;
      node.className = `stat-value ${tone || ''}`.trim();
      const noteNode = $(`#${id}Note`);
      if (noteNode && note !== undefined) noteNode.textContent = note;
    };

    set('bizRevenue', money(data.revenue), `${plural(data.incomeCount, 'income entry', 'income entries')} · ${rangeText(data.from, data.to)}`, 'is-income');
    set('bizExpenses', money(data.expenses), `${plural(data.expenseCount, 'expense entry', 'expense entries')} recorded`, 'is-expense');
    set(
      'bizProfit',
      money(data.netProfit),
      data.profitMargin === null ? 'Revenue − expenses' : `Revenue − expenses · ${data.profitMargin}% margin`,
      Number(data.netProfit) < 0 ? 'is-negative' : ''
    );
    set(
      'bizReceivable',
      money(data.receivable.amount),
      data.receivable.overdueCount > 0
        ? `${plural(data.receivable.invoiceCount, 'open invoice')} · ${money(data.receivable.overdueAmount)} overdue`
        : `${plural(data.receivable.invoiceCount, 'open invoice')}`,
      ''
    );
    set('bizPayable', money(data.payable.amount), `${plural(data.payable.billCount, 'open bill')}`, '');
    set(
      'bizCash',
      money(data.cashFlow.net),
      `In ${money(data.cashFlow.moneyIn)} · out ${money(data.cashFlow.moneyOut)}`,
      Number(data.cashFlow.net) < 0 ? 'is-negative' : ''
    );
  }

  function renderTrendChart(data) {
    const canvas = $('#bizTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const theme = chartTheme();
    const trend = data.monthlyTrend || [];
    const hasData = trend.some((row) => Number(row.income) > 0 || Number(row.expense) > 0);
    toggleChartEmpty('bizTrendChart', 'bizTrendEmpty', hasData);
    if (!hasData) {
      if (local.charts.trend) { local.charts.trend.destroy(); local.charts.trend = null; }
      return;
    }

    const labels = trend.map((row) => monthShort(row.month));
    const options = baseChartOptions(theme);
    options.scales = {
      x: { grid: { display: false }, ticks: { color: theme.muted, font: { size: 10.5 } }, border: { color: theme.grid } },
      y: {
        beginAtZero: true,
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: theme.muted, font: { size: 10.5 }, callback: (value) => moneyShort(value) },
      },
    };
    options.plugins.legend.display = local.trendMode === 'bar';

    const isProfit = local.trendMode === 'profit';
    const config = {
      type: isProfit ? 'line' : 'bar',
      data: {
        labels,
        datasets: isProfit
          ? [
              {
                label: 'Net profit',
                data: trend.map((row) => Number(row.netProfit)),
                borderColor: theme.brand,
                backgroundColor: 'transparent',
                borderWidth: 2.4,
                tension: 0.32,
                pointRadius: 3,
                pointBackgroundColor: theme.brand,
                fill: false,
              },
            ]
          : [
              {
                label: 'Revenue',
                data: trend.map((row) => Number(row.income)),
                backgroundColor: theme.income,
                borderRadius: 5,
                maxBarThickness: 26,
              },
              {
                label: 'Expenses',
                data: trend.map((row) => Number(row.expense)),
                backgroundColor: theme.expense,
                borderRadius: 5,
                maxBarThickness: 26,
              },
            ],
      },
      options,
    };

    if (local.charts.trend) {
      local.charts.trend.data = config.data;
      local.charts.trend.options = options;
      local.charts.trend.config.type = config.type;
      local.charts.trend.update();
    } else {
      local.charts.trend = new Chart(canvas, config);
    }
  }

  function renderBreakdownChart(data) {
    const canvas = $('#bizDoughnut');
    const legend = $('#bizLegend');
    if (legend) legend.textContent = '';
    const rows = data.expenseByCategory || [];
    const hasData = rows.length > 0 && rows.some((row) => Number(row.totalMinor) > 0);
    toggleChartEmpty('bizDoughnut', 'bizDoughnutEmpty', hasData);
    if (!hasData) {
      if (local.charts.doughnut) { local.charts.doughnut.destroy(); local.charts.doughnut = null; }
      return;
    }
    if (typeof Chart === 'undefined') return;

    const theme = chartTheme();
    const colours = rows.map((row, index) => SS.colourFor(row.category, index));
    const options = baseChartOptions(theme);
    options.plugins.legend.display = false;
    options.cutout = '62%';
    options.plugins.tooltip.callbacks.label = (ctx) => {
      const row = rows[ctx.dataIndex];
      return `${row.category}: ${money(row.total)} (${row.percent}%)`;
    };

    const config = {
      type: 'doughnut',
      data: {
        labels: rows.map((row) => row.category),
        datasets: [{ data: rows.map((row) => Number(row.total)), backgroundColor: colours, borderWidth: 0, hoverOffset: 4 }],
      },
      options,
    };

    if (local.charts.doughnut) {
      local.charts.doughnut.data = config.data;
      local.charts.doughnut.update();
    } else {
      local.charts.doughnut = new Chart(canvas, config);
    }

    if (legend) {
      for (const [index, row] of rows.entries()) {
        legend.append(
          el(
            'li',
            {},
            el('span', { class: 'swatch', style: `background:${colours[index]}` }),
            el('span', { class: 'legend-name', text: row.category }),
            el('span', { class: 'legend-value', text: money(row.total) }),
            el('span', { class: 'legend-pct', text: `${row.percent}%` })
          )
        );
      }
    }
  }

  function renderRecentLists(data) {
    const salesBody = $('#bizRecentSales');
    const expenseBody = $('#bizRecentExpenses');
    salesBody.textContent = '';
    expenseBody.textContent = '';

    const sales = data.recentSales || [];
    const expenses = data.recentExpenses || [];

    $('#bizRecentSalesEmpty').hidden = sales.length > 0;
    $('#bizRecentExpensesEmpty').hidden = expenses.length > 0;

    for (const row of sales) {
      salesBody.append(
        el(
          'tr',
          {},
          el('td', { text: row.title }),
          el('td', { text: formatDate(row.transaction_date) }),
          el('td', { class: 'num amount-income', text: money(row.amount) })
        )
      );
    }
    for (const row of expenses) {
      expenseBody.append(
        el(
          'tr',
          {},
          el('td', { text: row.title }),
          el('td', {}, chip(row.category)),
          el('td', { class: 'num amount-expense', text: money(row.amount) })
        )
      );
    }
  }

  async function renderAttention(data) {
    const box = $('#bizAttention');
    box.textContent = '';
    const items = [...(data.overdueInvoices || []), ...(data.overdueBills || [])];

    if (items.length === 0) {
      box.append(el('p', { class: 'muted', text: 'Nothing is overdue. Everything outstanding is still inside its due date.' }));
      return;
    }

    const list = el('ul', { class: 'timeline' });
    for (const item of items) {
      list.append(
        el(
          'li',
          { class: 'is-overdue' },
          el('span', { class: 'timeline-date', text: formatDate(item.due_date) }),
          el(
            'span',
            { class: 'timeline-title' },
            el('strong', { text: `${item.kind === 'invoice' ? 'Invoice' : 'Bill'} ${item.number} — ${item.party}` }),
            el('br'),
            el('span', { class: 'muted', text: `Due ${formatDate(item.due_date)} · balance ${money(item.balance)}` })
          ),
          el('a', {
            class: 'btn btn-ghost btn-sm',
            href: item.kind === 'invoice' ? '#invoices' : '#bills',
            'data-goto': item.kind === 'invoice' ? 'invoices' : 'bills',
            text: 'Open',
          })
        )
      );
    }
    box.append(list);
  }

  async function loadDashboard() {
    const { from, to } = local.range;
    const { data } = await api(`/api/business/dashboard${queryString({ from, to, months: 6 })}`);
    local.dashboard = data;
    return data;
  }

  async function renderBusinessDashboard() {
    try {
      const data = await loadDashboard();
      renderStatCards(data);
      renderTrendChart(data);
      renderBreakdownChart(data);
      renderRecentLists(data);
      renderAging(data.aging);
      renderTopCustomers(data.topCustomers);
      await renderAttention(data);
      $('#bizTrendSub').textContent = `Last 6 months · ${rangeText(data.from, data.to)}`;
      $('#bizBreakdownSub').textContent = `By category · ${rangeText(data.from, data.to)}`;
    } catch (error) {
      toast('error', error.message);
      throw error;
    }
  }

  /**
   * Receivables aging. The buckets are calculated on the server (from the due
   * date), so a laptop in another timezone cannot disagree with the database.
   */
  function renderAging(aging) {
    const list = $('#bizAgingList');
    const note = $('#bizAgingNote');
    if (!list) return;
    list.textContent = '';

    const buckets = (aging && aging.buckets) || [];
    const total = (aging && aging.totalMinor) || 0;

    if (!total) {
      note.textContent = 'Nothing outstanding right now — every invoice is settled.';
      return;
    }

    for (const bucket of buckets) {
      if (!bucket.amountMinor) continue;
      const late = bucket.key !== 'current';
      list.append(
        el(
          'div',
          { class: `aging-row${late ? ' is-late' : ''}` },
          el('span', { class: 'aging-label', text: bucket.label }),
          el(
            'span',
            { class: 'aging-track' },
            el('i', { class: 'aging-fill', style: `width:${Math.max(bucket.percent, 1.5)}%` })
          ),
          el('span', { class: 'aging-amount', text: SS.money(bucket.amount) })
        )
      );
    }

    note.textContent = aging.late > 0
      ? `${SS.money(aging.late)} of ${SS.money(aging.total)} is already past its due date.`
      : `All ${SS.money(aging.total)} is still within its due date.`;
  }

  /** Customers ranked by invoiced value — a quick "who keeps me busy" list. */
  function renderTopCustomers(customers) {
    const list = $('#bizTopCustomers');
    const empty = $('#bizTopCustomersEmpty');
    if (!list) return;
    list.textContent = '';

    const rows = customers || [];
    if (empty) empty.hidden = rows.length > 0;
    if (!rows.length) return;

    rows.forEach((customer, index) => {
      list.append(
        el(
          'div',
          { class: 'rank-row' },
          el('span', { class: 'rank-no', text: `${index + 1}.` }),
          el('span', { class: 'rank-name', text: customer.name, title: customer.name }),
          el('span', {
            class: 'rank-value',
            text: SS.money(customer.invoiced),
            title: `${SS.plural(customer.invoiceCount, 'invoice')} · ${SS.money(customer.outstanding)} outstanding`,
          })
        )
      );
    });
  }

  function initBusinessRange() {
    const form = $('#bizRangeForm');
    const quick = $('#bizQuickMonth');

    quick.textContent = '';
    quick.append(el('option', { value: '', text: 'All time' }));
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      quick.append(el('option', { value, text: monthLabel(value) }));
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      local.range.from = $('#bizFrom').value;
      local.range.to = $('#bizTo').value;
      await SS.renderCurrentView({ force: true });
    });

    quick.addEventListener('change', async () => {
      const month = quick.value;
      if (!month) {
        local.range = { from: '', to: '' };
        $('#bizFrom').value = '';
        $('#bizTo').value = '';
      } else {
        const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
        local.range = { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
        $('#bizFrom').value = local.range.from;
        $('#bizTo').value = local.range.to;
      }
      await SS.renderCurrentView({ force: true });
    });

    $('#bizClearRange').addEventListener('click', async () => {
      local.range = { from: '', to: '' };
      $('#bizFrom').value = '';
      $('#bizTo').value = '';
      quick.value = '';
      await SS.renderCurrentView({ force: true });
    });

    // Chart type toggle
    document.querySelectorAll('[data-biz-chart]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-biz-chart]').forEach((other) => other.classList.toggle('is-active', other === btn));
        local.trendMode = btn.dataset.bizChart === 'profit' ? 'profit' : 'bar';
        if (local.dashboard) renderTrendChart(local.dashboard);
      });
    });
  }

  /* =====================================================================
     2. CUSTOMERS AND VENDORS
     ===================================================================== */

  const partyConfig = {
    customer: {
      endpoint: '/api/business/customers',
      tbody: 'customerBody',
      empty: 'customersEmpty',
      search: 'customerSearch',
      archivedToggle: 'showArchivedCustomers',
      addButton: 'addCustomerBtn',
      label: 'customer',
      labelPlural: 'customers',
      countKey: 'invoice_count',
      countLabel: 'Invoices',
      cacheKey: 'customers',
    },
    vendor: {
      endpoint: '/api/business/vendors',
      tbody: 'vendorBody',
      empty: 'vendorsEmpty',
      search: 'vendorSearch',
      archivedToggle: 'showArchivedVendors',
      addButton: 'addVendorBtn',
      label: 'vendor',
      labelPlural: 'vendors',
      countKey: 'bill_count',
      countLabel: 'Bills',
      cacheKey: 'vendors',
    },
  };

  async function loadParties(kind) {
    const config = partyConfig[kind];
    const includeArchived = $(`#${config.archivedToggle}`)?.checked ? 'true' : 'false';
    const search = $(`#${config.search}`)?.value.trim() || '';
    const { data } = await api(`${config.endpoint}${queryString({ search, include_archived: includeArchived })}`);
    local[config.cacheKey] = data;
    return data;
  }

  function partyRow(kind, party) {
    const config = partyConfig[kind];
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `Edit ${party.name}`,
        'aria-label': `Edit ${party.name}`,
        onClick: () => openPartyDialog(kind, party),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: party.is_archived ? `Restore ${party.name}` : `Archive ${party.name}`,
        'aria-label': party.is_archived ? `Restore ${party.name}` : `Archive ${party.name}`,
        onClick: () => togglePartyArchive(kind, party),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-archive') })),
      el('button', {
        class: 'row-btn danger',
        type: 'button',
        title: `Delete ${party.name}`,
        'aria-label': `Delete ${party.name}`,
        onClick: () => deleteParty(kind, party),
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
          el('strong', { text: party.name }),
          party.contact_person ? el('small', { text: party.contact_person }) : null
        ),
        party.is_archived ? el('span', { class: 'badge badge-archived', text: 'Archived', style: 'margin-left:6px' }) : null
      ),
      el('td', { text: party.email || '—' }),
      el('td', { text: party.phone || '—' }),
      el('td', { class: 'num', text: String(party[config.countKey] || 0) }),
      el('td', {
        class: `num ${Number(party.outstanding_minor) > 0 ? 'amount-expense' : ''}`,
        text: money(party.outstanding_minor / 100),
      }),
      el('td', { class: 'actions-col' }, actions)
    );
  }

  async function renderPartyList(kind) {
    const config = partyConfig[kind];
    const body = $(`#${config.tbody}`);
    const empty = $(`#${config.empty}`);
    body.textContent = '';
    body.append(loadingRow(`Loading ${config.labelPlural}…`, 6));

    try {
      const rows = await loadParties(kind);
      body.textContent = '';
      if (rows.length === 0) {
        empty.hidden = false;
        body.append(
          el('tr', {}, el('td', { colspan: '6' }, el('div', { class: 'muted', text: `No ${config.labelPlural} to show.` })))
        );
        return;
      }
      empty.hidden = true;
      for (const party of rows) body.append(partyRow(kind, party));

      const outstanding = rows.reduce((sum, p) => sum + Number(p.outstanding_minor || 0) / 100, 0);
      $(`#${config.search === 'customerSearch' ? 'customersSub' : 'vendorsSub'}`).textContent =
        `${plural(rows.length, config.label)} · ${money(outstanding)} outstanding`;
    } catch (error) {
      body.textContent = '';
      body.append(errorRow(error.message, () => renderPartyList(kind), 6));
    }
  }

  function openPartyDialog(kind, party = null) {
    const config = partyConfig[kind];
    const Label = kind === 'customer' ? 'Customer' : 'Vendor';
    openForm({
      title: party ? `Edit ${Label}` : `Add ${Label}`,
      subtitle:
        kind === 'customer'
          ? 'Customers are who you invoice. Deleting one with invoices is blocked.'
          : 'Vendors are who you receive bills from.',
      submitLabel: party ? 'Save changes' : `Add ${config.label}`,
      values: party
        ? {
            name: party.name,
            contact_person: party.contact_person || '',
            email: party.email || '',
            phone: party.phone || '',
            address: party.address || '',
            notes: party.notes || '',
          }
        : {},
      fields: [
        { name: 'name', label: `${Label} name`, type: 'text', required: true, maxlength: 120 },
        { name: 'contact_person', label: 'Contact person', type: 'text', maxlength: 120 },
        { name: 'email', label: 'Email', type: 'email', maxlength: 160, group: 'c' },
        { name: 'phone', label: 'Phone', type: 'tel', maxlength: 30, group: 'c' },
        { name: 'address', label: 'Address', type: 'textarea', maxlength: 300, rows: 2 },
        { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500, rows: 2 },
      ],
      onSubmit: async (payload) => {
        if (party) await api(`${config.endpoint}/${party.id}`, { method: 'PUT', body: payload });
        else await api(config.endpoint, { method: 'POST', body: payload });
        toast('success', party ? `${Label} updated.` : `${Label} added.`);
        await renderPartyList(kind);
        await SS.loadBusinessParties(); // refresh pickers elsewhere
      },
    });
  }

  async function togglePartyArchive(kind, party) {
    const config = partyConfig[kind];
    try {
      await api(`${config.endpoint}/${party.id}/archive`, { method: 'POST', body: { archived: !party.is_archived } });
      toast('success', party.is_archived ? 'Restored.' : 'Archived. Historical records are untouched.');
      await renderPartyList(kind);
      await SS.loadBusinessParties();
    } catch (error) {
      toast('error', error.message);
    }
  }

  async function deleteParty(kind, party) {
    const config = partyConfig[kind];
    const confirmed = await askConfirmation({
      title: `Delete this ${config.label}?`,
      text: `"${party.name}" will be removed. If any financial record refers to it, SmartSpend refuses the delete and you can archive it instead.`,
      confirmLabel: `Delete ${config.label}`,
    });
    if (!confirmed) return;
    try {
      await api(`${config.endpoint}/${party.id}`, { method: 'DELETE' });
      toast('success', `${config.label[0].toUpperCase()}${config.label.slice(1)} deleted.`);
      await renderPartyList(kind);
      await SS.loadBusinessParties();
    } catch (error) {
      toast('error', error.message);
    }
  }

  /* =====================================================================
     3. BILLS AND PAYABLES
     ===================================================================== */

  function renderBillSummary(summary) {
    $('#billStatCount').textContent = String(summary.count);
    $('#billStatTotal').textContent = money(summary.total);
    $('#billStatPaid').textContent = money(summary.paid);
    $('#billStatOutstanding').textContent = money(summary.outstanding);
    $('#billStatOverdue').textContent =
      summary.overdueCount > 0 ? `${summary.overdueCount} overdue · ${money(summary.overdueAmount)}` : 'Nothing overdue';
  }

  function billRow(bill) {
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onClick: () => openBillPaymentDialog(bill),
        text: 'Pay',
        title: `Record a payment for bill ${bill.bill_number}`,
      }),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `View bill ${bill.bill_number}`,
        'aria-label': `View bill ${bill.bill_number}`,
        onClick: () => openBillDetail(bill),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-eye') })),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `Edit bill ${bill.bill_number}`,
        'aria-label': `Edit bill ${bill.bill_number}`,
        onClick: () => openBillDialog(bill),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })),
      el('button', {
        class: 'row-btn danger',
        type: 'button',
        title: `Delete bill ${bill.bill_number}`,
        'aria-label': `Delete bill ${bill.bill_number}`,
        onClick: () => deleteBill(bill),
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
          el('strong', { text: bill.bill_number }),
          bill.description ? el('small', { text: bill.description }) : null
        )
      ),
      el('td', { text: bill.vendor_name }),
      el('td', { text: formatDate(bill.bill_date) }),
      el('td', { text: formatDate(bill.due_date) }),
      el('td', {}, statusBadge(bill.status)),
      el('td', { class: 'num', text: money(bill.total) }),
      el('td', {
        class: `num ${Number(bill.balance) > 0 ? 'amount-expense' : 'amount-income'}`,
        text: money(bill.balance),
      }),
      el('td', { class: 'actions-col' }, actions)
    );
  }

  async function renderBillList() {
    const body = $('#billBody');
    body.textContent = '';
    body.append(loadingRow('Loading bills…', 8));

    try {
      const f = local.filters;
      const { data } = await api(`/api/business/bills${queryString(f)}`);
      local.bills = data.rows;
      local.billSummary = data.summary;

      body.textContent = '';
      renderBillSummary(data.summary);

      if (data.rows.length === 0) {
        $('#billsEmpty').hidden = false;
        body.append(el('tr', {}, el('td', { colspan: '8' }, el('div', { class: 'muted', text: 'No bills match this filter.' }))));
        return;
      }
      $('#billsEmpty').hidden = true;
      for (const bill of data.rows) body.append(billRow(bill));
    } catch (error) {
      body.textContent = '';
      body.append(errorRow(error.message, () => renderBillList(), 8));
    }
  }

  function openBillDialog(bill = null) {
    const vendors = local.vendors.length ? local.vendors : [];
    if (vendors.length === 0) {
      toast('error', 'Add a vendor first — a bill must belong to one.');
      SS.switchView('vendors');
      return;
    }

    openForm({
      title: bill ? 'Edit Vendor Bill' : 'Record Vendor Bill',
      subtitle: 'A bill is money you owe. It only becomes cash out when you record a payment.',
      submitLabel: bill ? 'Save changes' : 'Record bill',
      values: bill
        ? {
            vendor_id: String(bill.vendor_id),
            bill_number: bill.bill_number,
            bill_date: bill.bill_date,
            due_date: bill.due_date,
            amount: bill.amount,
            tax_rate: bill.tax_rate || '',
            description: bill.description || '',
            notes: bill.notes || '',
          }
        : { bill_date: todayISO(), due_date: todayISO() },
      fields: [
        { name: 'vendor_id', label: 'Vendor', type: 'select', required: true, options: vendors.map((v) => ({ value: v.id, label: v.name })) },
        { name: 'bill_number', label: 'Bill number', type: 'text', required: true, maxlength: 60, placeholder: 'As printed on the bill' },
        { name: 'bill_date', label: 'Bill date', type: 'date', required: true, group: 'd1' },
        { name: 'due_date', label: 'Due date', type: 'date', required: true, group: 'd1' },
        { name: 'amount', label: 'Amount before tax (₹)', type: 'number', required: true, min: 0.01, step: '0.01', group: 'd2' },
        { name: 'tax_rate', label: 'Tax rate (%)', type: 'number', min: 0, max: 100, step: '0.01', group: 'd2', hint: 'Optional, only if the bill shows it.' },
        { name: 'description', label: 'Description', type: 'text', maxlength: 500 },
        { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500, rows: 2 },
      ],
      onSubmit: async (payload) => {
        const body = {
          vendor_id: Number(payload.vendor_id),
          bill_number: payload.bill_number,
          bill_date: payload.bill_date,
          due_date: payload.due_date,
          amount: Number(payload.amount),
          tax_rate: payload.tax_rate === '' ? null : Number(payload.tax_rate),
          description: payload.description || null,
          notes: payload.notes || null,
        };
        if (bill) await api(`/api/business/bills/${bill.id}`, { method: 'PUT', body });
        else await api('/api/business/bills', { method: 'POST', body });
        toast('success', bill ? 'Bill updated.' : 'Bill recorded.');
        await renderBillList();
      },
    });
  }

  async function openBillDetail(bill) {
    try {
      const { data } = await api(`/api/business/bills/${bill.id}`);
      const body = $('#invoicePrintArea'); // reuse the wide dialog
      $('#invoiceViewTitle').textContent = `Bill ${data.bill_number}`;
      $('#invoiceViewSub').textContent = `${data.vendor_name} · ${statusLabelText(data.status)}`;
      body.textContent = '';

      const rows = [
        ['Bill date', formatDate(data.bill_date)],
        ['Due date', formatDate(data.due_date)],
        ['Amount before tax', money(data.amount)],
        ['Tax', money(data.tax)],
        ['Total', money(data.total)],
        ['Paid', money(data.paid)],
        ['Balance', money(data.balance)],
      ];

      const wrapper = el('div', { class: 'invoice-print' });
      wrapper.append(
        el(
          'div',
          { class: 'invoice-print-head' },
          el('div', {}, el('h3', { text: 'Vendor Bill' }), el('p', { class: 'muted', text: data.vendor_name }), data.description ? el('p', { class: 'muted', text: data.description }) : null),
          el('div', { class: 'invoice-print-meta' }, el('strong', { text: data.bill_number }), statusBadge(data.status))
        )
      );

      const table = el('table', {}, el('tbody', {}));
      for (const [label, value] of rows) {
        table.querySelector('tbody').append(el('tr', {}, el('th', { text: label }), el('td', { class: 'num', text: value })));
      }
      wrapper.append(table);

      if (data.payments && data.payments.length > 0) {
        wrapper.append(el('h4', { class: 'sub-heading', text: 'Payments made' }));
        const payTable = el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Method' }), el('th', { class: 'num', text: 'Amount' }), el('th', {}, ''))), el('tbody', {}));
        for (const payment of data.payments) {
          payTable.querySelector('tbody').append(
            el(
              'tr',
              {},
              el('td', { text: formatDate(payment.paid_on) }),
              el('td', { text: SS.METHOD_LABELS[payment.method] || payment.method }),
              el('td', { class: 'num', text: money(payment.amount) }),
              el(
                'td',
                {},
                el('button', {
                  class: 'row-btn danger no-print',
                  type: 'button',
                  'aria-label': `Remove payment of ${money(payment.amount)}`,
                  onClick: async () => {
                    const ok = await askConfirmation({
                      title: 'Remove this payment?',
                      text: 'The bill will be reopened with a higher balance. The payment record is deleted.',
                      confirmLabel: 'Remove payment',
                    });
                    if (!ok) return;
                    try {
                      await api(`/api/business/bills/${data.id}/payments/${payment.id}`, { method: 'DELETE' });
                      toast('success', 'Payment removed.');
                      $('#invoiceViewDialog').close();
                      await renderBillList();
                    } catch (error) {
                      toast('error', error.message);
                    }
                  },
                }, Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') }))
              )
            )
          );
        }
        wrapper.append(payTable);
      }

      body.append(wrapper);
      const dialog = $('#invoiceViewDialog');
      $('#invoicePrintBtn').onclick = () => window.print();
      $('#invoicePayBtn').onclick = () => {
        dialog.close();
        openBillPaymentDialog(data);
      };
      dialog.showModal();
    } catch (error) {
      toast('error', error.message);
    }
  }

  function statusLabelText(status) {
    return SS.STATUS_LABELS[status] || status;
  }

  async function openBillPaymentDialog(bill) {
    const balance = Number(bill.balance);
    if (balance <= 0) {
      toast('info', 'This bill is already fully paid.');
      return;
    }
    openForm({
      title: `Pay bill ${bill.bill_number}`,
      subtitle: `${bill.vendor_name} · outstanding ${money(balance)}`,
      submitLabel: 'Record payment',
      note: 'A payment cannot be more than the outstanding balance, and the same payment cannot be recorded twice.',
      values: { amount: balance.toFixed(2), paid_on: todayISO(), method: 'bank_transfer' },
      fields: [
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0.01, step: '0.01', max: balance },
        { name: 'paid_on', label: 'Payment date', type: 'date', required: true, group: 'p' },
        { name: 'method', label: 'Method', type: 'select', required: true, group: 'p', options: Object.entries(SS.METHOD_LABELS).map(([value, label]) => ({ value, label })) },
        { name: 'reference', label: 'Reference', type: 'text', maxlength: 80, placeholder: 'UTR / cheque number' },
      ],
      onSubmit: async (payload) => {
        await api(`/api/business/bills/${bill.id}/payments`, {
          method: 'POST',
          body: {
            amount: Number(payload.amount),
            paid_on: payload.paid_on,
            method: payload.method,
            reference: payload.reference || null,
          },
        });
        toast('success', 'Payment recorded. Outstanding balance updated.');
        await renderBillList();
      },
    });
  }

  async function deleteBill(bill) {
    const confirmed = await askConfirmation({
      title: `Delete bill ${bill.bill_number}?`,
      text: 'The bill and any payments recorded against it will be removed. This cannot be undone.',
      confirmLabel: 'Delete bill',
    });
    if (!confirmed) return;
    try {
      await api(`/api/business/bills/${bill.id}`, { method: 'DELETE' });
      toast('success', 'Bill deleted.');
      await renderBillList();
    } catch (error) {
      toast('error', error.message);
    }
  }

  function initBillFilters() {
    const form = $('#billFilterForm');
    const apply = () => {
      local.filters = {
        search: $('#billSearch').value.trim(),
        status: $('#billStatus').value,
        vendor_id: $('#billVendor').value,
        from: $('#billFrom').value,
        to: $('#billTo').value,
      };
      renderBillList();
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      apply();
    });
    let timer = null;
    $('#billSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 260);
    });
    ['billStatus', 'billVendor', 'billFrom', 'billTo'].forEach((id) => $(`#${id}`).addEventListener('change', apply));
    $('#newBillBtn').addEventListener('click', () => openBillDialog());
  }

  async function fillVendorFilter() {
    try {
      const { data } = await api('/api/business/vendors');
      local.vendors = data;
      SS.fillSelect($('#billVendor'), 'All vendors', data.map((v) => ({ value: v.id, label: v.name })));
      return data;
    } catch (error) {
      toast('error', error.message);
      return [];
    }
  }

  async function renderBillsScreen() {
    await fillVendorFilter();
    await renderBillList();
  }

  /* =====================================================================
     4. CASH FLOW
     ===================================================================== */

  async function renderCashFlow() {
    const { from, to } = local.range;
    try {
      const { data } = await api(`/api/business/cash-flow${queryString({ from, to })}`);

      $('#cfIn').textContent = money(data.moneyIn);
      $('#cfOut').textContent = money(data.moneyOut);
      $('#cfNet').textContent = money(data.net);
      $('#cfNet').className = `stat-value ${Number(data.net) < 0 ? 'is-negative' : ''}`.trim();
      $('#cfNetNote').textContent = `${rangeText(data.from, data.to)} · only recorded payments and entries`;
      $('#cfNotReceived').textContent = money(data.notYetReceived);
      $('#cfNotPaid').textContent = money(data.notYetPaid);

      const body = $('#cfEntriesBody');
      body.textContent = '';
      if (data.entries.length === 0) {
        body.append(el('tr', {}, el('td', { colspan: '4' }, el('div', { class: 'muted', text: 'No money moved in this range.' }))));
      } else {
        const labels = {
          invoice_payment: 'Customer payment',
          bill_payment: 'Vendor payment',
          income: 'Income entry',
          expense: 'Expense entry',
        };
        for (const entry of data.entries) {
          body.append(
            el(
              'tr',
              {},
              el('td', { text: formatDate(entry.entry_date) }),
              el('td', { text: entry.label }),
              el('td', {}, chip(labels[entry.kind] || entry.kind)),
              el('td', {
                class: `num ${entry.direction === 'in' ? 'amount-income' : 'amount-expense'}`,
                text: `${entry.direction === 'in' ? '+' : '−'}${money(Math.abs(Number(entry.amount)))}`,
              })
            )
          );
        }
      }

      $('#cfEntriesSub').textContent = `${plural(data.entries.length, 'movement')} · ${rangeText(data.from, data.to)}`;
      $('#cfFrom').value = data.from || '';
      $('#cfTo').value = data.to || '';
      $('#exportCashBtn').href = `/api/business/export/transactions.csv${queryString({ from: data.from, to: data.to })}`;
    } catch (error) {
      toast('error', error.message);
      throw error;
    }
  }

  function initCashFlowFilters() {
    $('#cashflowFilterForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      local.range = { from: $('#cfFrom').value, to: $('#cfTo').value };
      await SS.renderCurrentView({ force: true });
    });
  }

  /* =====================================================================
     5. BUSINESS REPORTS (tax + payment methods)
     ===================================================================== */

  async function renderBusinessReports() {
    const { from, to } = local.reportRange;
    try {
      const [tax, methods] = await Promise.all([
        api(`/api/business/reports/tax${queryString({ from, to })}`),
        api(`/api/business/reports/payment-methods${queryString({ from, to })}`),
      ]);

      const taxBody = $('#taxBody');
      taxBody.textContent = '';
      const rows = tax.data.categories;
      if (rows.length === 0) {
        taxBody.append(el('tr', {}, el('td', { colspan: '5' }, el('div', { class: 'muted', text: 'No business expenses in this range.' }))));
      } else {
        for (const row of rows) {
          taxBody.append(
            el(
              'tr',
              {},
              el('td', {}, chip(row.category)),
              el('td', { class: 'num', text: String(row.count) }),
              el('td', { class: 'num', text: money(row.net) }),
              el('td', { class: 'num', text: money(row.tax) }),
              el('td', { class: 'num', text: money(row.total) })
            )
          );
        }
      }
      $('#taxTotalsLine').textContent =
        `Totals — net ${money(tax.data.totals.net)} · tax ${money(tax.data.totals.tax)} · total ${money(tax.data.totals.total)}. ` +
        `Tax entered on invoices in this range: ${money(tax.data.invoiceTax.collectedOnInvoices)}.`;
      $('#taxRangeSub').textContent = `${rangeText(tax.data.from, tax.data.to)} · estimates only`;
      $('#taxDisclaimer').textContent = tax.data.disclaimer;

      const methodBody = $('#paymentMethodBody');
      methodBody.textContent = '';
      if (methods.data.length === 0) {
        methodBody.append(el('tr', {}, el('td', { colspan: '4' }, el('div', { class: 'muted', text: 'No entries in this range.' }))));
      } else {
        for (const row of methods.data) {
          methodBody.append(
            el(
              'tr',
              {},
              el('td', { text: SS.METHOD_LABELS[row.method] || row.method }),
              el('td', {}, el('span', { class: `pill ${row.type === 'income' ? 'pill-income' : 'pill-expense'}`, text: row.type === 'income' ? 'Money in' : 'Money out' })),
              el('td', { class: 'num', text: money(row.total) }),
              el('td', { class: 'num', text: String(row.count) })
            )
          );
        }
      }

      // Exports follow the selected range.
      const q = queryString({ from, to });
      $('#exportBizTxBtn').href = `/api/business/export/transactions.csv${q}`;
      $('#exportBizInvBtn').href = `/api/business/export/invoices.csv${q}`;
      $('#exportBizBillBtn').href = `/api/business/export/bills.csv${q}`;
      $('#exportBizTaxBtn').href = `/api/business/export/tax-report.csv${q}`;
      $('#bizReportFrom').value = from || '';
      $('#bizReportTo').value = to || '';
    } catch (error) {
      toast('error', error.message);
      throw error;
    }
  }

  function initReportFilters2() {
    $('#bizReportFilterForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      local.reportRange = { from: $('#bizReportFrom').value, to: $('#bizReportTo').value };
      await SS.renderCurrentView({ force: true });
    });
  }

  /* =====================================================================
     6. WIRING + REGISTRATION
     ===================================================================== */

  function init() {
    initBusinessRange();
    initBillFilters();
    initCashFlowFilters();
    initReportFilters2();

    $('#addCustomerBtn')?.addEventListener('click', () => openPartyDialog('customer'));
    $('#addVendorBtn')?.addEventListener('click', () => openPartyDialog('vendor'));

    for (const kind of ['customer', 'vendor']) {
      const config = partyConfig[kind];
      const search = $(`#${config.search}`);
      let timer = null;
      search?.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => renderPartyList(kind), 260);
      });
      $(`#${config.archivedToggle}`)?.addEventListener('change', () => renderPartyList(kind));
    }

    // Charts must be redrawn when the theme changes (they read CSS variables).
    new MutationObserver(() => {
      if (local.dashboard && SS.state.view === 'business-dashboard') {
        renderTrendChart(local.dashboard);
        renderBreakdownChart(local.dashboard);
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  SS.registerView('business-dashboard', renderBusinessDashboard);
  SS.registerView('customers', () => renderPartyList('customer'));
  SS.registerView('vendors', () => renderPartyList('vendor'));
  SS.registerView('bills', renderBillsScreen);
  SS.registerView('cashflow', renderCashFlow);
  SS.registerView('business-reports', renderBusinessReports);

  SS.business = { renderBillList, fillVendorFilter, openBillDialog, partyConfig, local };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
