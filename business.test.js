/**
 * test/business.test.js — SmartSpend 2.0 acceptance tests
 * ---------------------------------------------------------------------------
 * Runs the REAL Express server against a throw-away database and checks the
 * requirements from the 2.0 brief: mode separation, business maths, customers,
 * vendors, invoices, partial payments, overdue detection, vendor bills,
 * cash-flow correctness, CSV exports and validation.
 *
 * Run with:  npm test      (runs api -> business -> migration suites)
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `smartspend-biz-${Date.now()}.db`);
process.env.SMARTSPEND_DB = TEST_DB;
process.env.SMARTSPEND_SILENT = '1';

const { start } = require('../server');
const { db } = require('../database');

const results = [];
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) { passed += 1; results.push(`  ✅ ${name}`); }
  else { failed += 1; results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => results.push(`\n${t}`);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const PERSONAL = 1;
const BUSINESS = 2;

async function main() {
  const server = start(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function api(method, url, body, workspaceId = null) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (workspaceId) headers['X-Workspace-Id'] = String(workspaceId);
    const res = await fetch(base + url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  // =========================================================================
  section('Criterion 1 & 3 — Individual mode still works; modes are separate');
  let r = await api('GET', '/workspaces');
  check('GET /workspaces lists both workspaces', r.status === 200 && r.body.data.length === 2, JSON.stringify(r.body.data?.map((w) => w.type)));

  r = await api('POST', '/transactions', {
    type: 'income', title: 'Personal salary', category: 'Salary', amount: 5000, transaction_date: '2026-10-05',
  }, PERSONAL);
  check('Personal transaction created (workspace 1)', r.status === 201 && r.body.data.workspace_id === PERSONAL, `status ${r.status}`);

  r = await api('POST', '/transactions', {
    type: 'expense', title: 'Personal lunch', category: 'Food', amount: 150, transaction_date: '2026-10-06',
  }, PERSONAL);
  check('Personal expense created', r.status === 201);

  let personalSummary = (await api('GET', '/summary', null, PERSONAL)).body.data;
  check('Personal income = ₹5,000', near(personalSummary.totalIncome, 5000), String(personalSummary.totalIncome));
  check('Personal expenses = ₹150', near(personalSummary.totalExpenses, 150), String(personalSummary.totalExpenses));
  check('Personal balance = ₹4,850', near(personalSummary.balance, 4850), String(personalSummary.balance));

  // Business data must not appear in the personal numbers.
  await api('POST', '/transactions', {
    type: 'income', title: 'Website project for Acme', category: 'Sales', amount: 20000, transaction_date: '2026-10-07', payment_method: 'upi',
  }, BUSINESS);
  await api('POST', '/transactions', {
    type: 'expense', title: 'Office rent', category: 'Rent & Utilities', amount: 6000, transaction_date: '2026-10-08', payment_method: 'bank_transfer',
  }, BUSINESS);

  personalSummary = (await api('GET', '/summary', null, PERSONAL)).body.data;
  check('Criterion 5 — business rows do NOT change personal totals',
    near(personalSummary.totalIncome, 5000) && near(personalSummary.totalExpenses, 150),
    `income ${personalSummary.totalIncome}, expense ${personalSummary.totalExpenses}`);

  let bizSummary = (await api('GET', '/summary', null, BUSINESS)).body.data;
  check('Criterion 5 — personal rows do NOT appear in business totals',
    near(bizSummary.totalIncome, 20000) && near(bizSummary.totalExpenses, 6000),
    `income ${bizSummary.totalIncome}, expense ${bizSummary.totalExpenses}`);

  const personalList = (await api('GET', '/transactions', null, PERSONAL)).body.data;
  check('Personal list contains only personal rows', personalList.length === 2 && personalList.every((t) => t.workspace_id === PERSONAL), `${personalList.length} rows`);

  // A personal category must be rejected in the business workspace and vice versa.
  r = await api('POST', '/transactions', {
    type: 'expense', title: 'Wrong category', category: 'Food', amount: 10, transaction_date: '2026-10-08',
  }, BUSINESS);
  check('Business workspace rejects personal-only categories', r.status === 400, `status ${r.status}`);
  r = await api('POST', '/transactions', {
    type: 'expense', title: 'Wrong category', category: 'Salaries & Wages', amount: 10, transaction_date: '2026-10-08',
  }, PERSONAL);
  check('Personal workspace rejects business-only categories', r.status === 400, `status ${r.status}`);

  // =========================================================================
  section('Criterion 4 — business dashboard profit calculation');
  r = await api('GET', '/business/dashboard', null, BUSINESS);
  check('GET /business/dashboard returns 200', r.status === 200, `status ${r.status}`);
  let dash = r.body.data;
  check('Revenue = ₹20,000', near(dash.revenue, 20000), String(dash.revenue));
  check('Expenses = ₹6,000', near(dash.expenses, 6000), String(dash.expenses));
  check('Net profit = ₹14,000 (revenue - expenses)', near(dash.netProfit, 14000), String(dash.netProfit));
  check('Expense breakdown by category present', dash.expenseByCategory.length === 1 && dash.expenseByCategory[0].category === 'Rent & Utilities');
  check('Monthly profit trend returned', Array.isArray(dash.monthlyTrend) && dash.monthlyTrend.length === 6);

  // date filtering
  const inRange = (await api('GET', '/business/dashboard?from=2026-10-08&to=2026-10-08', null, BUSINESS)).body.data;
  check('Dashboard respects the date range', near(inRange.revenue, 0) && near(inRange.expenses, 6000), `rev ${inRange.revenue}`);

  // =========================================================================
  section('Criterion 6 — customers & vendors, safe deletion');
  r = await api('POST', '/business/customers', { name: 'Acme Traders', contact_person: 'Ravi', email: 'ravi@acme.test', phone: '+91 98765 43210' }, BUSINESS);
  check('Customer created', r.status === 201, `status ${r.status}`);
  const customerId = r.body.data.id;

  r = await api('POST', '/business/customers', { name: 'Acme Traders' }, BUSINESS);
  check('Duplicate customer name rejected (409)', r.status === 409, `status ${r.status}`);

  r = await api('POST', '/business/customers', { name: '', email: 'not-an-email' }, BUSINESS);
  check('Invalid customer rejected (400)', r.status === 400, `status ${r.status}`);

  r = await api('POST', '/business/vendors', { name: 'Paper Supply Co', phone: '022-1234567' }, BUSINESS);
  check('Vendor created', r.status === 201, `status ${r.status}`);
  const vendorId = r.body.data.id;

  r = await api('PUT', `/business/customers/${customerId}`, { name: 'Acme Traders Pvt Ltd', email: 'accounts@acme.test' }, BUSINESS);
  check('Customer updated', r.status === 200 && r.body.data.name === 'Acme Traders Pvt Ltd');

  // Customers/vendors are business-only records: the personal workspace has none.
  const personalCustomers = (await api('GET', '/business/customers', null, PERSONAL));
  check('Personal workspace cannot use business customer API', personalCustomers.status === 400, `status ${personalCustomers.status}`);

  // =========================================================================
  section('Criterion 7 — invoice totals are computed on the server');
  r = await api('GET', '/business/invoices/next-number', null, BUSINESS);
  check('Invoice number suggestion returned', r.status === 200 && /^INV-/.test(r.body.data.invoice_number), r.body.data?.invoice_number);
  const suggestedNumber = r.body.data.invoice_number;

  r = await api('POST', '/business/invoices', {
    invoice_number: suggestedNumber,
    customer_id: customerId,
    invoice_date: '2026-10-01',
    due_date: '2027-12-31', // far future: keeps the status deterministic
    notes: 'Website design work',
    // deliberately WRONG totals - the server must ignore these
    subtotal: 1,
    total: 1,
    items: [
      { description: 'Homepage design', quantity: 2, unit_price: 5000, tax_rate: 18 },
      { description: 'Hosting setup', quantity: 1, unit_price: 2000, tax_rate: 0 },
    ],
  }, BUSINESS);
  check('Invoice created (201)', r.status === 201, `status ${r.status} ${JSON.stringify(r.body.error || {})}`);
  const invoice = r.body.data;
  const invoiceId = invoice.id;
  // 2 x 5000 = 10000 + 18% (1800) ; 1 x 2000 = 2000 -> subtotal 12000, tax 1800, total 13800
  check('Subtotal = ₹12,000 (ignores client value)', near(invoice.subtotal, 12000), String(invoice.subtotal));
  check('Tax = ₹1,800 (18% on the first line)', near(invoice.tax, 1800), String(invoice.tax));
  check('Total = ₹13,800 (not the ₹1 sent by the client)', near(invoice.total, 13800), String(invoice.total));
  check('Line totals stored per item', invoice.items.length === 2 && near(invoice.items[0].line_total, 10000), JSON.stringify(invoice.items.map((i) => i.line_total)));
  check('New invoice status is unpaid', invoice.status === 'unpaid', invoice.status);
  check('Balance equals total before payments', near(invoice.balance, 13800), String(invoice.balance));

  r = await api('POST', '/business/invoices', {
    invoice_number: suggestedNumber, customer_id: customerId,
    invoice_date: '2026-10-01', due_date: '2027-12-31',
    items: [{ description: 'Duplicate number test', quantity: 1, unit_price: 100 }],
  }, BUSINESS);
  check('Duplicate invoice number rejected (409)', r.status === 409, `status ${r.status}`);

  r = await api('POST', '/business/invoices', {
    invoice_number: 'INV-BAD-1', customer_id: customerId,
    invoice_date: '2026-10-10', due_date: '2026-10-01',
    items: [{ description: 'Bad dates', quantity: 1, unit_price: 100 }],
  }, BUSINESS);
  check('Due date before invoice date rejected', r.status === 400, `status ${r.status}`);

  r = await api('POST', '/business/invoices', {
    invoice_number: 'INV-BAD-2', customer_id: customerId,
    invoice_date: '2026-10-10', due_date: '2026-10-20', items: [],
  }, BUSINESS);
  check('Invoice with no line items rejected', r.status === 400, `status ${r.status}`);

  // =========================================================================
  section('Criterion 8 — partial payments update the outstanding balance');
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, {
    amount: 5000, paid_on: '2026-10-05', method: 'upi', reference: 'UPI-1',
  }, BUSINESS);
  check('Payment recorded (201)', r.status === 201, `status ${r.status} ${JSON.stringify(r.body.error || {})}`);
  let inv = r.body.data;
  check('Paid = ₹5,000', near(inv.paid, 5000), String(inv.paid));
  check('Balance = ₹8,800', near(inv.balance, 8800), String(inv.balance));
  check('Status becomes partially_paid', inv.status === 'partially_paid', inv.status);

  // duplicate payment rejected
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, {
    amount: 5000, paid_on: '2026-10-05', method: 'upi', reference: 'UPI-1',
  }, BUSINESS);
  check('Duplicate payment rejected (409)', r.status === 409, `status ${r.status}`);

  // overpayment rejected
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, {
    amount: 99999, paid_on: '2026-10-06',
  }, BUSINESS);
  check('Payment larger than the balance rejected (400)', r.status === 400, `status ${r.status}`);

  // invalid payment values
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, { amount: -5, paid_on: '2026-10-06' }, BUSINESS);
  check('Negative payment rejected', r.status === 400, `status ${r.status}`);
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, { amount: 100, paid_on: '2026-13-45' }, BUSINESS);
  check('Invalid payment date rejected', r.status === 400, `status ${r.status}`);

  // outstanding receivable must reflect the partial payment
  dash = (await api('GET', '/business/dashboard', null, BUSINESS)).body.data;
  check('Dashboard receivable = ₹8,800 (not the full invoice)', near(dash.receivable.amount, 8800), String(dash.receivable.amount));
  check('Dashboard counts 1 unpaid invoice', dash.receivable.invoiceCount === 1, String(dash.receivable.invoiceCount));

  // final payment -> paid
  r = await api('POST', `/business/invoices/${invoiceId}/payments`, {
    amount: 8800, paid_on: '2026-10-09', method: 'bank_transfer', reference: 'NEFT-77',
  }, BUSINESS);
  check('Final payment accepted', r.status === 201, `status ${r.status}`);
  inv = r.body.data;
  check('Balance now ₹0', near(inv.balance, 0), String(inv.balance));
  check('Status becomes paid', inv.status === 'paid', inv.status);

  r = await api('POST', `/business/invoices/${invoiceId}/payments`, { amount: 10, paid_on: '2026-10-10' }, BUSINESS);
  check('Cannot pay a fully paid invoice (409)', r.status === 409, `status ${r.status}`);

  // deleting a payment must reopen the invoice (status is derived, not stored)
  const payments = (await api('GET', `/business/invoices/${invoiceId}/payments`, null, BUSINESS)).body.data;
  r = await api('DELETE', `/business/invoices/${invoiceId}/payments/${payments[0].id}`, null, BUSINESS);
  check('Payment can be removed', r.status === 200, `status ${r.status}`);
  check('Removing a payment reopens the invoice', r.body.data.status !== 'paid', r.body.data.status);

  // =========================================================================
  section('Criterion 9 — overdue invoices are identified from due date + balance');
  r = await api('POST', '/business/invoices', {
    invoice_number: 'INV-OVERDUE-1', customer_id: customerId,
    invoice_date: '2020-01-01', due_date: '2020-01-31',
    items: [{ description: 'Old unpaid work', quantity: 1, unit_price: 3000 }],
  }, BUSINESS);
  const overdueId = r.body.data.id;
  check('Back-dated invoice created', r.status === 201, `status ${r.status}`);

  const overdueList = (await api('GET', '/business/invoices?status=overdue', null, BUSINESS)).body.data;
  check('Overdue filter finds the unpaid past-due invoice', overdueList.rows.some((row) => row.id === overdueId), `found ${overdueList.rows.length}`);

  const overdueInv = (await api('GET', `/business/invoices/${overdueId}`, null, BUSINESS)).body.data;
  check('Overdue status derived, not stored', overdueInv.status === 'overdue', overdueInv.status);

  // Paying it in full must clear "overdue" even though the due date is in the past.
  await api('POST', `/business/invoices/${overdueId}/payments`, { amount: 3000, paid_on: '2026-10-10' }, BUSINESS);
  const afterPay = (await api('GET', `/business/invoices/${overdueId}`, null, BUSINESS)).body.data;
  check('A fully paid past-due invoice is no longer overdue', afterPay.status === 'paid', afterPay.status);

  // printing/reading an invoice must never mark it paid
  for (let i = 0; i < 3; i += 1) await api('GET', `/business/invoices/${overdueId}`, null, BUSINESS);
  check('Reading/printing an invoice does not change its status',
    (await api('GET', `/business/invoices/${overdueId}`, null, BUSINESS)).body.data.status === 'paid'
    && true);

  // =========================================================================
  section('Criterion 10 — vendor bills and payments');
  r = await api('POST', '/business/bills', {
    vendor_id: vendorId, bill_number: 'PS-1001', bill_date: '2026-10-02', due_date: '2027-12-31',
    description: 'Printer paper', amount: 4000, tax_rate: 12,
  }, BUSINESS);
  check('Vendor bill created (201)', r.status === 201, `status ${r.status} ${JSON.stringify(r.body.error || {})}`);
  const bill = r.body.data;
  const billId = bill.id;
  check('Bill total includes tax (₹4,480)', near(bill.total, 4480), String(bill.total));
  check('Bill starts unpaid', bill.status === 'unpaid', bill.status);
  check('Bill balance = ₹4,480', near(bill.balance, 4480), String(bill.balance));

  r = await api('POST', '/business/bills', {
    vendor_id: vendorId, bill_number: 'PS-1001', bill_date: '2026-10-02', due_date: '2026-10-20', amount: 100,
  }, BUSINESS);
  check('Duplicate vendor bill number rejected (409)', r.status === 409, `status ${r.status}`);

  r = await api('POST', `/business/bills/${billId}/payments`, { amount: 1480, paid_on: '2026-10-06', method: 'cash' }, BUSINESS);
  check('Vendor payment recorded', r.status === 201, `status ${r.status}`);
  check('Bill balance after partial payment = ₹3,000', near(r.body.data.balance, 3000), String(r.body.data.balance));
  check('Bill status is partially_paid', r.body.data.status === 'partially_paid', r.body.data.status);

  r = await api('POST', `/business/bills/${billId}/payments`, { amount: 99999, paid_on: '2026-10-07' }, BUSINESS);
  check('Vendor payment above the balance rejected', r.status === 400, `status ${r.status}`);
  r = await api('POST', `/business/bills/${billId}/payments`, { amount: 1480, paid_on: '2026-10-06', method: 'cash' }, BUSINESS);
  check('Duplicate vendor payment rejected (409)', r.status === 409, `status ${r.status}`);

  dash = (await api('GET', '/business/dashboard', null, BUSINESS)).body.data;
  check('Dashboard payable = ₹3,000', near(dash.payable.amount, 3000), String(dash.payable.amount));

  // =========================================================================
  section('Criterion 11 — cash flow counts only real money movements');
  // Unpaid invoice (never paid) must not appear as money received.
  await api('POST', '/business/invoices', {
    invoice_number: 'INV-UNPAID-99', customer_id: customerId,
    invoice_date: '2026-10-11', due_date: '2026-12-31',
    items: [{ description: 'Not paid yet', quantity: 1, unit_price: 7777 }],
  }, BUSINESS);

  // Unpaid bill must not appear as money paid.
  await api('POST', '/business/bills', {
    vendor_id: vendorId, bill_number: 'PS-UNPAID-1', bill_date: '2026-10-11', due_date: '2026-12-31', amount: 5555,
  }, BUSINESS);

  const cash = (await api('GET', '/business/cash-flow?from=2026-10-01&to=2026-10-31', null, BUSINESS)).body.data;

  // Derive the expected figures straight from the database so this test keeps
  // working no matter what the earlier steps did.
  const sumIn = (sql) => db.prepare(sql).get().s;
  const expectedInvoiceCash = sumIn(`SELECT IFNULL(SUM(p.amount_minor),0) s FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE i.workspace_id = 2 AND p.paid_on BETWEEN '2026-10-01' AND '2026-10-31'`);
  const expectedIncomeCash = sumIn(`SELECT IFNULL(SUM(amount_minor),0) s FROM transactions
      WHERE workspace_id = 2 AND type = 'income' AND transaction_date BETWEEN '2026-10-01' AND '2026-10-31'`);
  const expectedBillCash = sumIn(`SELECT IFNULL(SUM(p.amount_minor),0) s FROM vendor_bill_payments p
       JOIN vendor_bills b ON b.id = p.vendor_bill_id
      WHERE b.workspace_id = 2 AND p.paid_on BETWEEN '2026-10-01' AND '2026-10-31'`);
  const expectedExpenseCash = sumIn(`SELECT IFNULL(SUM(amount_minor),0) s FROM transactions
      WHERE workspace_id = 2 AND type = 'expense' AND transaction_date BETWEEN '2026-10-01' AND '2026-10-31'`);

  check('Cash in = recorded invoice payments + income transactions',
    near(cash.moneyIn, (expectedInvoiceCash + expectedIncomeCash) / 100),
    `api ${cash.moneyIn} vs db ${(expectedInvoiceCash + expectedIncomeCash) / 100}`);
  check('Cash out = recorded bill payments + expense transactions',
    near(cash.moneyOut, (expectedBillCash + expectedExpenseCash) / 100),
    `api ${cash.moneyOut} vs db ${(expectedBillCash + expectedExpenseCash) / 100}`);
  check('Net cash flow = cash in - cash out',
    near(cash.net, cash.moneyIn - cash.moneyOut), `${cash.moneyIn} - ${cash.moneyOut} = ${cash.net}`);

  // The important property: UNPAID documents contribute ZERO to cash.
  const unpaidInvoiceBalance = sumIn(`SELECT IFNULL(SUM(i.total_minor - IFNULL(p.paid,0)),0) s
       FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(amount_minor) paid FROM invoice_payments GROUP BY invoice_id) p
         ON p.invoice_id = i.id
      WHERE i.workspace_id = 2 AND i.is_draft = 0 AND i.is_cancelled = 0 AND (i.total_minor - IFNULL(p.paid,0)) > 0`);
  const unpaidBillBalance = sumIn(`SELECT IFNULL(SUM((b.amount_minor + b.tax_minor) - IFNULL(p.paid,0)),0) s
       FROM vendor_bills b LEFT JOIN (SELECT vendor_bill_id, SUM(amount_minor) paid FROM vendor_bill_payments GROUP BY vendor_bill_id) p
         ON p.vendor_bill_id = b.id
      WHERE b.workspace_id = 2 AND b.is_cancelled = 0 AND ((b.amount_minor + b.tax_minor) - IFNULL(p.paid,0)) > 0`);
  check('Unpaid receivables are reported separately, not as cash',
    near(cash.notYetReceived, unpaidInvoiceBalance / 100), `${cash.notYetReceived} vs ${unpaidInvoiceBalance / 100}`);
  check('Unpaid payables are reported separately, not as cash',
    near(cash.notYetPaid, unpaidBillBalance / 100), `${cash.notYetPaid} vs ${unpaidBillBalance / 100}`);
  check('The ₹7,777 unpaid invoice adds nothing to cash in',
    near(cash.moneyIn, (expectedInvoiceCash + expectedIncomeCash) / 100) && unpaidInvoiceBalance > 0);
  check('The ₹5,555 unpaid bill adds nothing to cash out',
    near(cash.moneyOut, (expectedBillCash + expectedExpenseCash) / 100) && unpaidBillBalance > 0);
  check('Cash flow lists individual movements', cash.entries.length >= 5, `${cash.entries.length} entries`);
  check('Movements carry a direction (in/out)', cash.entries.every((e) => e.direction === 'in' || e.direction === 'out'));

  // =========================================================================
  section('Criterion 12 — CSV exports contain the filtered records');
  r = await api('GET', '/business/export/transactions.csv?from=2026-10-07&to=2026-10-07', null, BUSINESS);
  check('Transaction CSV returns CSV content type', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')), r.headers.get('content-type'));
  check('CSV is a download', /attachment; filename=/.test(r.headers.get('content-disposition') || ''));
  const csvLines = r.text.trim().split('\r\n');
  check('CSV has a header row + the 1 matching row', csvLines.length === 2, `${csvLines.length} lines`);
  check('CSV contains the filtered business row', r.text.includes('Website project for Acme'));
  check('CSV excludes other workspace data', !r.text.includes('Personal salary'));
  check('CSV amounts are plain numbers', r.text.includes('20000.00'), csvLines[1]);

  r = await api('GET', '/business/export/invoices.csv', null, BUSINESS);
  check('Invoice CSV exported', r.status === 200 && r.text.includes('INV-OVERDUE-1'));
  check('Invoice CSV includes computed status column', /Status/.test(r.text.split('\r\n')[0]) && r.text.includes('paid'));

  r = await api('GET', '/business/export/bills.csv', null, BUSINESS);
  check('Vendor bill CSV exported', r.status === 200 && r.text.includes('PS-1001'));

  r = await api('GET', '/export/transactions.csv', null, PERSONAL);
  check('Personal CSV export contains only personal rows', r.text.includes('Personal salary') && !r.text.includes('Website project'));

  r = await api('GET', '/business/reports/tax?from=2026-10-01&to=2026-10-31', null, BUSINESS);
  check('Tax report groups expenses by category', r.status === 200 && r.body.data.categories.length >= 1);
  check('Tax report carries the not-tax-advice disclaimer', /not tax or legal advice/i.test(r.body.data.disclaimer));

  // =========================================================================
  section('Criterion 14 — invalid amounts, dates and IDs are rejected');
  const bad = [
    ['zero amount invoice', () => api('POST', '/business/invoices', {
      invoice_number: 'INV-X1', customer_id: customerId, invoice_date: '2026-10-01', due_date: '2026-10-05',
      items: [{ description: 'x', quantity: 1, unit_price: 0 }],
    }, BUSINESS)],
    ['negative quantity', () => api('POST', '/business/invoices', {
      invoice_number: 'INV-X2', customer_id: customerId, invoice_date: '2026-10-01', due_date: '2026-10-05',
      items: [{ description: 'x', quantity: -2, unit_price: 100 }],
    }, BUSINESS)],
    ['unknown customer', () => api('POST', '/business/invoices', {
      invoice_number: 'INV-X3', customer_id: 999999, invoice_date: '2026-10-01', due_date: '2026-10-05',
      items: [{ description: 'x', quantity: 1, unit_price: 100 }],
    }, BUSINESS)],
    ['invalid bill amount', () => api('POST', '/business/bills', {
      vendor_id: vendorId, bill_number: 'BAD-1', bill_date: '2026-10-01', due_date: '2026-10-05', amount: 0,
    }, BUSINESS)],
    ['invalid bill date', () => api('POST', '/business/bills', {
      vendor_id: vendorId, bill_number: 'BAD-2', bill_date: '2026-02-30', due_date: '2026-03-05', amount: 10,
    }, BUSINESS)],
  ];
  for (const [label, fn] of bad) {
    const res = await fn();
    check(`Rejects ${label} (400)`, res.status === 400, `status ${res.status}`);
  }

  check('Non-numeric invoice id -> 400', (await api('GET', '/business/invoices/abc', null, BUSINESS)).status === 400);
  check('Unknown invoice id -> 404', (await api('GET', '/business/invoices/999999', null, BUSINESS)).status === 404);
  check('Unknown customer id -> 404', (await api('GET', '/business/customers/999999', null, BUSINESS)).status === 404);
  check('Invalid workspaceId -> 400', (await api('GET', '/summary', null, 'abc')).status === 400);
  check('Unknown workspaceId -> 404', (await api('GET', '/summary', null, 999999)).status === 404);

  // =========================================================================
  section('Workspace isolation & safe deletion');
  // The invoice created in the business workspace must not be readable as "personal".
  const crossRead = await api('GET', `/business/invoices/${invoiceId}`, null, PERSONAL);
  check('Business invoice not readable through a personal workspace', crossRead.status === 400 || crossRead.status === 404, `status ${crossRead.status}`);

  // A customer with invoices cannot be deleted, only archived.
  r = await api('DELETE', `/business/customers/${customerId}`, null, BUSINESS);
  check('Deleting a customer with invoices is refused (409)', r.status === 409, `status ${r.status}`);
  check('The refusal explains why', /linked to .*invoice/i.test(r.body.error?.message || ''), r.body.error?.message);

  r = await api('POST', `/business/customers/${customerId}/archive`, { archived: true }, BUSINESS);
  check('Customer can be archived instead', r.status === 200 && r.body.data.is_archived === true);
  const activeCustomers = (await api('GET', '/business/customers', null, BUSINESS)).body.data;
  check('Archived customer hidden from the default list', !activeCustomers.some((c) => c.id === customerId));
  const allCustomers = (await api('GET', '/business/customers?includeArchived=true', null, BUSINESS)).body.data;
  check('Archived customer still visible on request', allCustomers.some((c) => c.id === customerId));
  r = await api('POST', `/business/customers/${customerId}/archive`, { archived: false }, BUSINESS);
  check('Customer can be restored', r.body.data.is_archived === false);

  // A vendor with bills cannot be deleted either.
  r = await api('DELETE', `/business/vendors/${vendorId}`, null, BUSINESS);
  check('Deleting a vendor with bills is refused (409)', r.status === 409, `status ${r.status}`);

  // An unused customer CAN be deleted.
  r = await api('POST', '/business/customers', { name: 'Temp Customer' }, BUSINESS);
  const tempId = r.body.data.id;
  r = await api('DELETE', `/business/customers/${tempId}`, null, BUSINESS);
  check('An unreferenced customer can be deleted', r.status === 200, `status ${r.status}`);

  // Invoice with payments cannot be deleted, but a clean one can.
  r = await api('DELETE', `/business/invoices/${invoiceId}`, null, BUSINESS);
  check('Deleting an invoice with payments is refused (409)', r.status === 409, `status ${r.status}`);
  r = await api('POST', '/business/invoices', {
    invoice_number: 'INV-DELETEME', customer_id: customerId,
    invoice_date: '2026-10-12', due_date: '2026-10-20',
    items: [{ description: 'Draft test', quantity: 1, unit_price: 500 }],
  }, BUSINESS);
  const deletableId = r.body.data.id;
  r = await api('DELETE', `/business/invoices/${deletableId}`, null, BUSINESS);
  check('An invoice with no payments can be deleted', r.status === 200, `status ${r.status}`);
  check('Its line items were removed too', db.prepare('SELECT COUNT(*) c FROM invoice_items WHERE invoice_id = ?').get(deletableId).c === 0);

  // =========================================================================
  section('Individual-mode extras: savings goals and recurring expenses');
  r = await api('POST', '/savings-goals', { name: 'New laptop', target: 40000, target_date: '2027-03-31' }, PERSONAL);
  check('Savings goal created', r.status === 201, `status ${r.status}`);
  const goalId = r.body.data.id;
  check('Goal starts at 0%', r.body.data.saved === 0 && r.body.data.percent === 0);

  r = await api('POST', `/savings-goals/${goalId}/contributions`, { amount: 15000, contributed_on: '2026-10-10' }, PERSONAL);
  check('Contribution recorded', r.status === 201 && near(r.body.data.saved, 15000), String(r.body.data.saved));
  check('Goal progress = 37.5%', near(r.body.data.percent, 37.5), String(r.body.data.percent));
  check('Goal remaining = ₹25,000', near(r.body.data.remaining, 25000), String(r.body.data.remaining));

  r = await api('POST', `/savings-goals/${goalId}/contributions`, { amount: -999999, contributed_on: '2026-10-11' }, PERSONAL);
  check('Withdrawing more than saved is rejected', r.status === 409, `status ${r.status}`);

  r = await api('POST', '/recurring', {
    title: 'Hostel rent', category: 'Rent', amount: 3000, frequency: 'monthly', start_date: '2026-08-05',
  }, PERSONAL);
  check('Recurring rule created', r.status === 201, `status ${r.status}`);
  const ruleId = r.body.data.id;

  r = await api('GET', '/recurring/upcoming?days=60', null, PERSONAL);
  check('Upcoming expected payments listed', r.status === 200 && r.body.data.items.length > 0, `${r.body.data.items.length} items`);
  check('Upcoming list creates nothing',
    db.prepare('SELECT COUNT(*) c FROM transactions WHERE recurring_rule_id = ?').get(ruleId).c === 0);

  const run1 = (await api('POST', '/recurring/run', null, PERSONAL)).body.data;
  check('Recurring generation creates the due entries', run1.createdCount > 0, `created ${run1.createdCount}`);
  const countAfter1 = db.prepare('SELECT COUNT(*) c FROM transactions WHERE recurring_rule_id = ?').get(ruleId).c;
  check('Generated transaction is linked to its rule', countAfter1 === run1.createdCount, `${countAfter1}`);

  // THE KEY IDEMPOTENCY TEST
  const run2 = (await api('POST', '/recurring/run', null, PERSONAL)).body.data;
  const countAfter2 = db.prepare('SELECT COUNT(*) c FROM transactions WHERE recurring_rule_id = ?').get(ruleId).c;
  check('Second generation run creates NOTHING (idempotent)', run2.createdCount === 0 && countAfter2 === countAfter1, `run2 ${run2.createdCount}`);
  const run3 = (await api('POST', '/recurring/run', null, PERSONAL)).body.data;
  check('Third run also creates nothing', run3.createdCount === 0);
  check('One transaction per due date (unique index)', db.prepare(
    'SELECT COUNT(*) c FROM (SELECT transaction_date, COUNT(*) n FROM transactions WHERE recurring_rule_id = ? GROUP BY transaction_date HAVING n > 1)'
  ).get(ruleId).c === 0);

  // =========================================================================
  // =========================================================================
  // 2.1 additions: comparison chips, receivables aging, top customers
  // =========================================================================
  section('2.1 dashboard insights');

  const ranged = (await api('GET', '/summary?month=2026-10', null, PERSONAL)).body.data;
  check('Summary exposes a previous-month block', Boolean(ranged.previous), JSON.stringify(ranged.previous || null));
  if (ranged.previous) {
    check('Previous month is internally consistent',
      near(ranged.previous.totalIncome - ranged.previous.totalExpenses, ranged.previous.balance),
      `${ranged.previous.totalIncome} - ${ranged.previous.totalExpenses} = ${ranged.previous.balance}`);
    // A null change means "no baseline in the previous month" — the app says
    // nothing rather than inventing a 100% jump. Anything else must be a number.
    const changeValues = Object.values(ranged.change || {});
    check('Every change value is a number or an explicit null baseline',
      changeValues.length > 0 && changeValues.every((value) => value === null || Number.isFinite(value)),
      JSON.stringify(ranged.change));
  }
  const allTimeSummary = (await api('GET', '/summary', null, PERSONAL)).body.data;
  check('All-time summary carries no comparison', allTimeSummary.previous === undefined);

  const dash21 = (await api('GET', '/business/dashboard', null, BUSINESS)).body.data;
  const aging = dash21.aging;
  check('Dashboard returns receivables aging', Boolean(aging) && aging.buckets.length === 4);
  const agedTotal = aging.buckets.reduce((sum, b) => sum + b.amountMinor, 0);
  check('Aging buckets add up to the outstanding total', agedTotal === aging.totalMinor, `${agedTotal} vs ${aging.totalMinor}`);
  check('Late money equals the three past-due buckets',
    aging.lateMinor === aging.buckets[1].amountMinor + aging.buckets[2].amountMinor + aging.buckets[3].amountMinor,
    `late ${aging.late} of ${aging.total}`);
  check('Late money can never exceed the outstanding total', aging.lateMinor <= aging.totalMinor);

  const top = dash21.topCustomers;
  check('Dashboard returns top customers', Array.isArray(top) && top.length > 0, `${top && top.length} customers`);
  check('Top customers are sorted by invoiced value',
    top.length < 2 || top[0].invoicedMinor >= top[1].invoicedMinor,
    top.map((row) => `${row.name}:${row.invoiced}`).join(', '));

  section('Criterion 2 — existing personal data is untouched by 2.0 features');
  const finalPersonal = (await api('GET', '/summary', null, PERSONAL)).body.data;
  const dbPersonalIncome = db.prepare(`SELECT IFNULL(SUM(amount_minor),0) s FROM transactions WHERE workspace_id = 1 AND type = 'income'`).get().s;
  const dbPersonalExpense = db.prepare(`SELECT IFNULL(SUM(amount_minor),0) s FROM transactions WHERE workspace_id = 1 AND type = 'expense'`).get().s;
  check('Personal summary reconciles with the database',
    near(finalPersonal.totalIncome, dbPersonalIncome / 100) && near(finalPersonal.totalExpenses, dbPersonalExpense / 100),
    `api ${finalPersonal.totalIncome}/${finalPersonal.totalExpenses} vs db ${dbPersonalIncome / 100}/${dbPersonalExpense / 100}`);
  check('The original ₹5,000 income is still intact', dbPersonalIncome >= 500000);
  check('Personal workspace has no customers', db.prepare('SELECT COUNT(*) c FROM customers WHERE workspace_id = 1').get().c === 0);
  check('Business workspace has no budgets', db.prepare('SELECT COUNT(*) c FROM budgets WHERE workspace_id = 2').get().c === 0);

  // =========================================================================
  await new Promise((resolve) => server.close(resolve));

  console.log(results.join('\n'));
  console.log(`\n${'='.repeat(64)}`);
  console.log(`  Business / acceptance: ${passed} passed, ${failed} failed, ${passed + failed} checks`);
  console.log('='.repeat(64));

  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(results.join('\n'));
  console.error('\nTest run crashed:', err);
  process.exit(1);
});
