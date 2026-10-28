/* ==========================================================================
   SmartSpend — js/invoices.js
   --------------------------------------------------------------------------
   The Invoices screen in Business mode: list, create/edit dialog, viewer with
   print-to-PDF, and payment recording.

   THE THREE RULES THIS SCREEN CANNOT BREAK
   1. The browser never decides an invoice total or status. The preview in the
      editor is a PREVIEW — the server recalculates from the line items and
      ignores anything the browser sends. Status is derived from recorded
      payments plus the due date.
   2. Opening or printing an invoice never marks it paid. Only "Record payment"
      does, and the amount can never exceed the outstanding balance.
   3. A payment is a real row in invoice_payments. Two identical payments are
      rejected by the server, so double-clicking cannot double-charge anyone.
   ========================================================================== */

'use strict';

(() => {
  const SS = window.SS;
  const {
    $, el, icon, api, money, formatDate, todayISO, toast, askConfirmation,
    openForm, queryString, withBusy, loadingRow, errorRow, statusBadge, chip,
  } = SS;

  const local = {
    rows: [],
    summary: null,
    filters: { search: '', status: 'all', customer_id: '', from: '', to: '' },
    editingId: null,
    current: null, // the invoice open in the viewer
    customers: [],
  };

  /* =====================================================================
     1. LIST
     ===================================================================== */

  function renderSummary(summary) {
    $('#invStatCount').textContent = String(summary.count);
    $('#invStatTotal').textContent = money(summary.total);
    $('#invStatPaid').textContent = money(summary.paid);
    $('#invStatOutstanding').textContent = money(summary.outstanding);
    $('#invStatOverdue').textContent =
      summary.overdueCount > 0 ? `${summary.overdueCount} overdue · ${money(summary.overdueAmount)}` : 'Nothing overdue';
  }

  function invoiceRow(invoice) {
    const actions = el(
      'div',
      { class: 'row-actions' },
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `View invoice ${invoice.invoice_number}`,
        'aria-label': `View invoice ${invoice.invoice_number}`,
        onClick: () => openInvoiceViewer(invoice.id),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-eye') })),
      el('button', {
        class: 'row-btn',
        type: 'button',
        title: `Edit invoice ${invoice.invoice_number}`,
        'aria-label': `Edit invoice ${invoice.invoice_number}`,
        onClick: () => openInvoiceEditor(invoice.id),
      }, Object.assign(document.createElement('span'), { innerHTML: icon('i-edit') })),
      el('button', {
        class: 'row-btn danger',
        type: 'button',
        title: `Delete invoice ${invoice.invoice_number}`,
        'aria-label': `Delete invoice ${invoice.invoice_number}`,
        onClick: () => deleteInvoice(invoice),
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
          el('strong', { text: invoice.invoice_number }),
          invoice.is_draft ? el('small', { text: 'Draft — not issued yet' }) : null
        )
      ),
      el('td', { text: invoice.customer_name }),
      el('td', { text: formatDate(invoice.invoice_date) }),
      el('td', { text: formatDate(invoice.due_date) }),
      el('td', {}, statusBadge(invoice.status)),
      el('td', { class: 'num', text: money(invoice.total) }),
      el('td', {
        class: `num ${Number(invoice.balance) > 0 ? 'amount-expense' : 'amount-income'}`,
        text: money(invoice.balance),
      }),
      el('td', { class: 'actions-col' }, actions)
    );
  }

  async function renderInvoiceList() {
    const body = $('#invoiceBody');
    body.textContent = '';
    body.append(loadingRow('Loading invoices…', 8));

    try {
      const { data } = await api(`/api/business/invoices${queryString(local.filters)}`);
      local.rows = data.rows;
      local.summary = data.summary;

      body.textContent = '';
      renderSummary(data.summary);

      const hasFilters = Boolean(
        local.filters.search ||
          (local.filters.status && local.filters.status !== 'all') ||
          local.filters.customer_id ||
          local.filters.from ||
          local.filters.to
      );

      if (data.rows.length === 0) {
        $('#invoicesEmpty').hidden = false;
        $('#invoicesEmptyTitle').textContent = hasFilters ? 'No invoices match this filter' : 'No invoices yet';
        $('#invoicesEmptyText').textContent = hasFilters
          ? 'Try a different status, customer or date range.'
          : 'Create your first invoice to start tracking what customers owe you.';
        body.append(el('tr', {}, el('td', { colspan: '8' }, el('div', { class: 'muted', text: 'Nothing to show.' }))));
        return;
      }

      $('#invoicesEmpty').hidden = true;
      for (const invoice of data.rows) body.append(invoiceRow(invoice));
    } catch (error) {
      body.textContent = '';
      body.append(errorRow(error.message, () => renderInvoiceList(), 8));
    }
  }

  /* =====================================================================
     2. EDITOR
     ===================================================================== */

  const invoiceDialog = () => $('#invoiceDialog');

  function newLineRow(line = {}) {
    const tr = el('tr', {});

    const description = el('input', { type: 'text', maxlength: '200', placeholder: 'What are you charging for?', 'aria-label': 'Line description' });
    description.value = line.description || '';
    const quantity = el('input', { type: 'number', min: '0.01', step: '0.01', class: 'num', 'aria-label': 'Quantity' });
    quantity.value = line.quantity ?? '1';
    const unitPrice = el('input', { type: 'number', min: '0', step: '0.01', class: 'num', 'aria-label': 'Unit price in rupees' });
    unitPrice.value = line.unit ?? '';
    const taxRate = el('input', { type: 'number', min: '0', max: '100', step: '0.01', class: 'num', 'aria-label': 'Tax rate percent' });
    taxRate.value = line.tax_rate ?? '0';
    const lineTotal = el('td', { class: 'num line-amount', text: money(0) });

    const remove = el(
      'button',
      {
        class: 'row-btn danger',
        type: 'button',
        'aria-label': 'Remove this line item',
        title: 'Remove line',
        onClick: () => {
          if ($('#invoiceItemsBody').children.length === 1) {
            toast('info', 'An invoice needs at least one line item.');
            return;
          }
          tr.remove();
          updatePreview();
        },
      },
      Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') })
    );

    tr.append(
      el('td', {}, description),
      el('td', {}, quantity),
      el('td', {}, unitPrice),
      el('td', {}, taxRate),
      lineTotal,
      el('td', {}, remove)
    );

    const recalc = () => {
      const qty = Number(quantity.value);
      const unit = Number(unitPrice.value);
      const amount = Number.isFinite(qty) && Number.isFinite(unit) ? Math.round(qty * unit * 100) / 100 : 0;
      lineTotal.textContent = money(amount);
      updatePreview();
    };
    [quantity, unitPrice].forEach((input) => input.addEventListener('input', recalc));
    taxRate.addEventListener('input', updatePreview);
    recalc();

    tr.readLine = () => ({
      description: description.value.trim(),
      quantity: Number(quantity.value),
      unit_price: Number(unitPrice.value),
      tax_rate: taxRate.value === '' ? 0 : Number(taxRate.value),
    });

    return tr;
  }

  /**
   * Client-side preview ONLY. It exists so the user sees what they are typing;
   * the server recalculates everything and stores its own numbers.
   */
  function updatePreview() {
    let subtotal = 0;
    let tax = 0;
    for (const row of Array.from($('#invoiceItemsBody').children)) {
      const line = row.readLine ? row.readLine() : null;
      if (!line) continue;
      const lineTotal = Number.isFinite(line.quantity) && Number.isFinite(line.unit_price)
        ? Math.round(line.quantity * line.unit_price * 100) / 100
        : 0;
      subtotal += lineTotal;
      tax += Math.round(lineTotal * (Number(line.tax_rate) || 0)) / 100;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    tax = Math.round(tax * 100) / 100;
    $('#previewSubtotal').textContent = money(subtotal);
    $('#previewTax').textContent = money(tax);
    $('#previewTotal').textContent = money(subtotal + tax);
  }

  function clearInvoiceErrors() {
    ['invNumberError', 'invCustomerError', 'invDateError', 'invDueError', 'invoiceItemsError'].forEach((id) => {
      const node = $(`#${id}`);
      if (!node) return;
      node.textContent = '';
      node.classList.remove('is-visible');
      node.style.display = node.id === 'invoiceItemsError' ? 'none' : '';
      const wrap = node.closest('.field');
      if (wrap) wrap.classList.remove('has-error');
    });
    const banner = $('#invoiceFormError');
    banner.hidden = true;
    banner.textContent = '';
  }

  function showInvoiceErrors(fields = {}) {
    const map = {
      invoice_number: 'invNumberError',
      customer_id: 'invCustomerError',
      invoice_date: 'invDateError',
      due_date: 'invDueError',
      items: 'invoiceItemsError',
    };
    let firstInvalid = null;
    for (const [field, message] of Object.entries(fields)) {
      const id = map[field];
      if (!id) {
        const banner = $('#invoiceFormError');
        banner.hidden = false;
        banner.textContent = message;
        continue;
      }
      const node = $(`#${id}`);
      if (!node) continue;
      node.textContent = message;
      node.classList.add('is-visible');
      if (id === 'invoiceItemsError') node.style.display = 'block';
      const wrap = node.closest('.field');
      if (wrap) wrap.classList.add('has-error');
      if (!firstInvalid) firstInvalid = node.closest('.field')?.querySelector('input, select') || null;
    }
    if (firstInvalid) firstInvalid.focus();
  }

  async function openInvoiceEditor(invoiceId = null) {
    clearInvoiceErrors();
    local.editingId = invoiceId || null;

    const form = $('#invoiceForm');
    form.reset();
    $('#invoiceItemsBody').textContent = '';

    // Customers are required for an invoice.
    try {
      const { data } = await api('/api/business/customers');
      local.customers = data;
    } catch (error) {
      toast('error', error.message);
      return;
    }
    if (local.customers.length === 0) {
      toast('error', 'Add a customer first — an invoice must belong to one.');
      SS.switchView('customers');
      return;
    }
    SS.fillSelect($('#invCustomerSelect'), 'Select a customer', local.customers.map((c) => ({ value: c.id, label: c.name })));

    if (invoiceId) {
      let invoice;
      try {
        invoice = (await api(`/api/business/invoices/${invoiceId}`)).data;
      } catch (error) {
        toast('error', error.message);
        return;
      }
      $('#invoiceDialogTitle').textContent = `Edit Invoice ${invoice.invoice_number}`;
      $('#invoiceDialogSub').textContent = 'Changing line items recalculates the totals on the server.';
      $('#invoiceSubmitBtn').textContent = 'Save Changes';
      $('#invNumber').value = invoice.invoice_number;
      $('#invCustomerSelect').value = String(invoice.customer_id);
      $('#invDate').value = invoice.invoice_date;
      $('#invDueDate').value = invoice.due_date;
      $('#invNotes').value = invoice.notes || '';
      $('#invIsDraft').checked = Boolean(invoice.is_draft);
      for (const item of invoice.items) {
        $('#invoiceItemsBody').append(
          newLineRow({ description: item.description, quantity: item.quantity, unit: item.unit_price, tax_rate: item.tax_rate })
        );
      }
    } else {
      $('#invoiceDialogTitle').textContent = 'New Invoice';
      $('#invoiceDialogSub').textContent = 'Totals are calculated on the server from these line items.';
      $('#invoiceSubmitBtn').textContent = 'Save Invoice';
      $('#invDate').value = todayISO();
      $('#invDueDate').value = todayISO();
      $('#invIsDraft').checked = false;

      // Suggest the next number; the user can change it, the server checks
      // uniqueness per workspace either way.
      try {
        const { data } = await api('/api/business/invoices/next-number');
        $('#invNumber').value = data.invoice_number;
      } catch {
        $('#invNumber').value = '';
      }
      $('#invoiceItemsBody').append(newLineRow());
    }

    updatePreview();
    const dialog = invoiceDialog();
    dialog.showModal();
    setTimeout(() => $('#invNumber').focus(), 40);
  }

  function closeInvoiceEditor() {
    if (invoiceDialog().open) invoiceDialog().close();
    local.editingId = null;
    $('#invoiceSubmitBtn').disabled = false;
  }

  /** Reads the editor. Returns null when a line is invalid. */
  function collectInvoice() {
    const items = Array.from($('#invoiceItemsBody').children).map((row) => row.readLine());
    return {
      invoice_number: $('#invNumber').value.trim(),
      customer_id: Number($('#invCustomerSelect').value) || null,
      invoice_date: $('#invDate').value,
      due_date: $('#invDueDate').value,
      notes: $('#invNotes').value.trim() || null,
      is_draft: $('#invIsDraft').checked,
      items: items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
      })),
    };
  }

  function validateInvoice() {
    const errors = {};
    const value = collectInvoice();

    if (!value.invoice_number) errors.invoice_number = 'An invoice number is required.';
    else if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(value.invoice_number)) {
      errors.invoice_number = 'Use letters, numbers and / _ . - only.';
    }
    if (!value.customer_id) errors.customer_id = 'Choose a customer.';
    if (!value.invoice_date) errors.invoice_date = 'Pick an invoice date.';
    if (!value.due_date) errors.due_date = 'Pick a due date.';
    if (value.invoice_date && value.due_date && value.due_date < value.invoice_date) {
      errors.due_date = 'Due date cannot be before the invoice date.';
    }

    value.items.forEach((item, index) => {
      if (!item.description) errors.items = `Line ${index + 1}: a description is required.`;
      else if (!Number.isFinite(item.quantity) || item.quantity <= 0) errors.items = `Line ${index + 1}: quantity must be greater than 0.`;
      else if (!Number.isFinite(item.unit_price) || item.unit_price < 0) errors.items = `Line ${index + 1}: unit price must be 0 or more.`;
      else if (Number(item.tax_rate) < 0 || Number(item.tax_rate) > 100) errors.items = `Line ${index + 1}: tax rate must be between 0 and 100.`;
    });
    if (!errors.items && value.items.length === 0) errors.items = 'Add at least one line item.';

    return { errors, value };
  }

  async function submitInvoice(event) {
    event.preventDefault();
    clearInvoiceErrors();

    const { errors, value } = validateInvoice();
    if (Object.keys(errors).length > 0) {
      showInvoiceErrors(errors);
      return;
    }

    const button = $('#invoiceSubmitBtn');
    try {
      await withBusy(button, 'Saving…', async () => {
        if (local.editingId) {
          await api(`/api/business/invoices/${local.editingId}`, { method: 'PUT', body: value });
          toast('success', 'Invoice updated. Totals were recalculated on the server.');
        } else {
          const { data } = await api('/api/business/invoices', { method: 'POST', body: value });
          toast('success', `Invoice ${data.invoice_number} created.`);
        }
      });
      closeInvoiceEditor();
      await renderInvoiceList();
    } catch (error) {
      if (error.fields) showInvoiceErrors(error.fields);
      else {
        const banner = $('#invoiceFormError');
        banner.hidden = false;
        banner.textContent = error.message;
      }
      toast('error', error.message);
    }
  }

  /* =====================================================================
     3. VIEWER + PRINT
     ===================================================================== */

  function printSection(invoice) {
    const wrap = el('div', { class: 'invoice-print' });

    // Header: number, status, dates
    wrap.append(
      el(
        'div',
        { class: 'invoice-print-head' },
        el(
          'div',
          {},
          el('h3', { text: 'INVOICE' }),
          el('p', { class: 'muted', text: invoice.invoice_number }),
          el('p', { class: 'muted', text: `Issued ${formatDate(invoice.invoice_date)} · Due ${formatDate(invoice.due_date)}` })
        ),
        el(
          'div',
          { class: 'invoice-print-meta' },
          el('strong', { text: `Total ${money(invoice.total)}` }),
          statusBadge(invoice.status),
          el('p', { class: 'muted', text: `Balance ${money(invoice.balance)}` })
        )
      )
    );

    // Parties
    wrap.append(
      el(
        'div',
        { class: 'invoice-print-parties' },
        el(
          'div',
          {},
          el('h4', { text: 'Billed to' }),
          el('strong', { text: invoice.customer_name }),
          invoice.customer_email ? el('p', { class: 'muted', text: invoice.customer_email }) : null,
          invoice.customer_phone ? el('p', { class: 'muted', text: invoice.customer_phone }) : null,
          invoice.customer_address ? el('p', { class: 'muted', text: invoice.customer_address }) : null
        ),
        el(
          'div',
          {},
          el('h4', { text: 'Issued by' }),
          el('strong', { text: SS.state.workspace?.name || 'My Business' }),
          el('p', { class: 'muted', text: 'SmartSpend business book' })
        )
      )
    );

    // Line items
    const table = el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Description' }),
          el('th', { class: 'num', text: 'Qty' }),
          el('th', { class: 'num', text: 'Unit price' }),
          el('th', { class: 'num', text: 'Tax %' }),
          el('th', { class: 'num', text: 'Amount' })
        )
      ),
      el('tbody', {})
    );
    for (const item of invoice.items) {
      table.querySelector('tbody').append(
        el(
          'tr',
          {},
          el('td', { text: item.description }),
          el('td', { class: 'num', text: String(item.quantity) }),
          el('td', { class: 'num', text: money(item.unit_price) }),
          el('td', { class: 'num', text: `${item.tax_rate}%` }),
          el('td', { class: 'num', text: money(item.line_total) })
        )
      );
    }
    wrap.append(table);

    // Totals
    const totals = el('div', { class: 'invoice-print-totals' });
    const addTotal = (label, value, grand = false) => {
      totals.append(el('div', { class: grand ? 'grand' : '' }, el('span', { text: label }), el('strong', { text: value })));
    };
    addTotal('Subtotal', money(invoice.subtotal));
    addTotal('Tax', money(invoice.tax));
    addTotal('Total', money(invoice.total), true);
    if (Number(invoice.paid) > 0) {
      addTotal('Paid', `− ${money(invoice.paid)}`);
      addTotal('Balance due', money(invoice.balance), true);
    }
    wrap.append(totals);

    if (invoice.notes) wrap.append(el('p', { class: 'muted', text: invoice.notes }));

    // Payments
    if (invoice.payments && invoice.payments.length > 0) {
      wrap.append(el('h4', { class: 'sub-heading', text: 'Payments received' }));
      const payTable = el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'Date' }),
            el('th', { text: 'Method' }),
            el('th', { text: 'Reference' }),
            el('th', { class: 'num', text: 'Amount' }),
            el('th', { class: 'no-print', text: '' })
          )
        ),
        el('tbody', {})
      );
      for (const payment of invoice.payments) {
        payTable.querySelector('tbody').append(
          el(
            'tr',
            {},
            el('td', { text: formatDate(payment.paid_on) }),
            el('td', { text: SS.METHOD_LABELS[payment.method] || payment.method }),
            el('td', { text: payment.reference || '—' }),
            el('td', { class: 'num', text: money(payment.amount) }),
            el(
              'td',
              { class: 'no-print' },
              el(
                'button',
                {
                  class: 'row-btn danger',
                  type: 'button',
                  'aria-label': `Remove payment of ${money(payment.amount)}`,
                  title: 'Remove this payment',
                  onClick: async () => {
                    const ok = await askConfirmation({
                      title: 'Remove this payment?',
                      text: 'The invoice will reopen with a higher balance. Only do this if the payment was recorded by mistake.',
                      confirmLabel: 'Remove payment',
                    });
                    if (!ok) return;
                    try {
                      await api(`/api/business/invoices/${invoice.id}/payments/${payment.id}`, { method: 'DELETE' });
                      toast('success', 'Payment removed. The invoice balance went up again.');
                      await openInvoiceViewer(invoice.id);
                      await renderInvoiceList();
                    } catch (error) {
                      toast('error', error.message);
                    }
                  },
                },
                Object.assign(document.createElement('span'), { innerHTML: icon('i-trash') })
              )
            )
          )
        );
      }
      wrap.append(payTable);
    }

    wrap.append(
      el('p', {
        class: 'invoice-print-foot',
        text: 'This invoice was produced by SmartSpend. Amounts are basic bookkeeping records, not audited statements.',
      })
    );

    return wrap;
  }

  async function openInvoiceViewer(invoiceId) {
    try {
      const { data } = await api(`/api/business/invoices/${invoiceId}`);
      local.current = data;

      $('#invoiceViewTitle').textContent = `Invoice ${data.invoice_number}`;
      $('#invoiceViewSub').textContent = `${data.customer_name} · ${SS.STATUS_LABELS[data.status] || data.status}`;

      const area = $('#invoicePrintArea');
      area.textContent = '';
      area.append(printSection(data));

      // NOTE: viewing never changes the status. Print only calls window.print().
      $('#invoicePrintBtn').onclick = () => window.print();
      const payBtn = $('#invoicePayBtn');
      payBtn.disabled = Number(data.balance) <= 0 || data.is_draft || data.is_cancelled;
      payBtn.textContent =
        Number(data.balance) <= 0
          ? 'Fully paid'
          : data.is_draft
            ? 'Publish to record payments'
            : 'Record payment';
      payBtn.onclick = () => {
        if (data.is_draft) {
          toast('info', 'Publish the invoice before recording payments.');
          return;
        }
        openPaymentDialog(data);
      };

      const dialog = $('#invoiceViewDialog');
      dialog.showModal();
    } catch (error) {
      toast('error', error.message);
    }
  }

  /* =====================================================================
     4. PAYMENTS
     ===================================================================== */

  function openPaymentDialog(invoice) {
    const balance = Number(invoice.balance);
    if (balance <= 0) {
      toast('info', 'This invoice is already fully paid.');
      return;
    }

    openForm({
      title: `Record payment — ${invoice.invoice_number}`,
      subtitle: `${invoice.customer_name} · outstanding ${money(balance)}`,
      submitLabel: 'Save payment',
      note:
        'Part payments are allowed. The amount cannot be more than the outstanding balance, ' +
        'and the invoice only becomes Paid when the payments add up to the total.',
      values: { amount: balance.toFixed(2), paid_on: todayISO(), method: 'upi' },
      fields: [
        { name: 'amount', label: 'Amount received (₹)', type: 'number', required: true, min: 0.01, step: '0.01', max: balance },
        { name: 'paid_on', label: 'Payment date', type: 'date', required: true, group: 'p' },
        {
          name: 'method',
          label: 'Method',
          type: 'select',
          required: true,
          group: 'p',
          options: Object.entries(SS.METHOD_LABELS).map(([value, label]) => ({ value, label })),
        },
        { name: 'reference', label: 'Reference', type: 'text', maxlength: 80, placeholder: 'UPI / cheque / NEFT reference' },
      ],
      onSubmit: async (payload) => {
        const amount = Number(payload.amount);
        if (amount > balance + 0.001) {
          const error = new Error('The payment cannot be more than the outstanding balance.');
          error.fields = { amount: `Maximum is ${money(balance)}.` };
          throw error;
        }
        await api(`/api/business/invoices/${invoice.id}/payments`, {
          method: 'POST',
          body: {
            amount,
            paid_on: payload.paid_on,
            method: payload.method,
            reference: payload.reference || null,
          },
        });
        toast('success', 'Payment recorded. Outstanding balance updated.');

        const viewer = $('#invoiceViewDialog');
        if (viewer.open) viewer.close();
        await openInvoiceViewer(invoice.id);
        await renderInvoiceList();
      },
    });
  }

  /* =====================================================================
     5. DELETE
     ===================================================================== */

  async function deleteInvoice(invoice) {
    const confirmed = await askConfirmation({
      title: `Delete invoice ${invoice.invoice_number}?`,
      text:
        Number(invoice.paid) > 0
          ? 'This invoice already has payments recorded. Deleting removes the invoice and those payments from your books. Cancel it instead if you want to keep the paper trail.'
          : 'The invoice and its line items will be permanently removed.',
      confirmLabel: 'Delete invoice',
    });
    if (!confirmed) return;
    try {
      await api(`/api/business/invoices/${invoice.id}`, { method: 'DELETE' });
      toast('success', 'Invoice deleted.');
      await renderInvoiceList();
    } catch (error) {
      toast('error', error.message);
    }
  }

  /* =====================================================================
     6. FILTERS + WIRING
     ===================================================================== */

  async function fillCustomerFilter() {
    try {
      const { data } = await api('/api/business/customers');
      local.customers = data;
      SS.fillSelect($('#invCustomer'), 'All customers', data.map((c) => ({ value: c.id, label: c.name })));
    } catch (error) {
      toast('error', error.message);
    }
  }

  function initInvoiceFilters() {
    const apply = () => {
      local.filters = {
        search: $('#invSearch').value.trim(),
        status: $('#invStatus').value,
        customer_id: $('#invCustomer').value,
        from: $('#invFrom').value,
        to: $('#invTo').value,
      };
      renderInvoiceList();
    };

    $('#invoiceFilterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      apply();
    });

    let timer = null;
    $('#invSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 260);
    });
    ['invStatus', 'invCustomer', 'invFrom', 'invTo'].forEach((id) => $(`#${id}`).addEventListener('change', apply));

    $('#newInvoiceBtn').addEventListener('click', () => openInvoiceEditor());
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-action="new-invoice"]');
      if (trigger) openInvoiceEditor();
    });

    $('#invoiceForm').addEventListener('submit', submitInvoice);
    $('#addLineBtn').addEventListener('click', () => {
      $('#invoiceItemsBody').append(newLineRow());
      updatePreview();
    });
    $('#invoiceDialogClose').addEventListener('click', closeInvoiceEditor);
    $('#invoiceDialogCancel').addEventListener('click', closeInvoiceEditor);
    invoiceDialog().addEventListener('cancel', (event) => {
      event.preventDefault();
      closeInvoiceEditor();
    });

    $('#invoiceViewClose').addEventListener('click', () => $('#invoiceViewDialog').close());
    $('#invoiceViewDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      $('#invoiceViewDialog').close();
    });
  }

  async function renderInvoicesScreen() {
    await fillCustomerFilter();
    await renderInvoiceList();
  }

  SS.registerView('invoices', renderInvoicesScreen);
  SS.invoices = { openInvoiceViewer, openInvoiceEditor, renderInvoiceList, local };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initInvoiceFilters);
  else initInvoiceFilters();
})();
