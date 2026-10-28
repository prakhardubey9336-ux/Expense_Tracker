/* UI smoke + interaction test for SmartSpend 2.0/2.1 (Playwright, headless).
 *
 * Run it against a server that is ALREADY running with the demo data:
 *   1. npm start                       (or PORT=3100 npm start)
 *   2. node tests-ui/ui2.js            (BASE=http://localhost:3100 for another port)
 *
 * It writes screenshots to tests-ui/out/ui2/. It CREATES a customer, an invoice
 * and payments, so point it at a throwaway database (see tests-ui/README.md). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'out', 'ui2');
fs.mkdirSync(OUT, { recursive: true });

const STAMP = Date.now().toString().slice(-6);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  // This browser has no Supabase session: use local mode so the login gate opens the app.
  const _ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await _ctx.addInitScript(() => {
    localStorage.setItem('smartspend:local-mode', '1');
  });
  const page = await _ctx.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // A 4xx from the API is an expected, handled outcome in these tests
    // (e.g. the deliberately blocked delete). Only JS errors matter here.
    if (/Failed to load resource.*\b(400|404|409)\b/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ---------- First run: the purpose chooser ----------
  check('first run shows the purpose chooser', await page.locator('#purposeScreen').isVisible());
  await page.locator('.purpose-option[data-purpose="individual"]').click();
  await page.locator('#purposeContinue').click();
  await page.waitForTimeout(900);
  check('purpose chooser dismissed', !(await page.locator('#purposeScreen').isVisible()));

  // ---------- Individual mode ----------
  check('mode switcher visible', await page.locator('.mode-switcher').isVisible());
  check('individual nav active', (await page.locator('[data-mode-nav="individual"]').isVisible()));
  check('business nav hidden', !(await page.locator('[data-mode-nav="business"]').isVisible()));
  check('individual stat cards rendered', (await page.locator('#statIncome').innerText()).includes('₹'));

  const individualViews = ['dashboard', 'transactions', 'budget', 'goals', 'recurring', 'analytics', 'insights', 'reports', 'settings'];
  for (const view of individualViews) {
    await page.click(`[data-mode-nav="individual"] .nav-link[data-view="${view}"]`);
    await page.waitForTimeout(450);
    const visible = await page.locator(`.view[data-view="${view}"]`).isVisible();
    const title = await page.locator('#pageTitle').innerText();
    check(`individual view "${view}" opens`, visible, title);
    await page.screenshot({ path: `${OUT}/individual-${view}.png`, fullPage: true });
  }

  // Individual reports: monthly table has rows (existing personal data)
  await page.click('[data-mode-nav="individual"] .nav-link[data-view="transactions"]');
  await page.waitForTimeout(600);
  const individualTxCount = await page.locator('#txBody tr').count();
  check('individual transaction list has rows', individualTxCount > 0, `${individualTxCount} rows`);
  const individualTitles = await page.locator('#txBody .cell-title strong').allInnerTexts();
  check(
    'individual list excludes business entries',
    !individualTitles.some((t) => /Counter sales|Bulk order|Shop rent/i.test(t)),
    individualTitles.slice(0, 3).join(' | ')
  );

  // ---------- switch to Business ----------
  await page.click('.mode-btn[data-mode="business"]');
  await page.waitForTimeout(1200);
  check('business nav visible after switch', await page.locator('[data-mode-nav="business"]').isVisible());
  check('individual nav hidden after switch', !(await page.locator('[data-mode-nav="individual"]').isVisible()));
  check('business dashboard is default', (await page.locator('#pageTitle').innerText()).includes('Business Dashboard'));
  check('mode caption updated', (await page.locator('#modeCaption').innerText()).includes('Business'));

  const revenue = await page.locator('#bizRevenue').innerText();
  const profit = await page.locator('#bizProfit').innerText();
  check('business revenue card filled', revenue.includes('₹'), revenue);
  check('business profit card filled', profit.includes('₹'), profit);
  const receivable = await page.locator('#bizReceivable').innerText();
  check('outstanding receivable shown separately', receivable.replace(/[₹,]/g, '') === '18240', receivable);
  check('overdue attention list populated', (await page.locator('#bizAttention').innerText()).includes('DEMO-0002'), (await page.locator('#bizAttention').innerText()).slice(0, 90));
  check('trend chart canvas drawn', await page.locator('#bizTrendChart').isVisible());
  await page.screenshot({ path: `${OUT}/business-dashboard.png`, fullPage: true });

  const businessViews = ['transactions', 'customers', 'vendors', 'invoices', 'bills', 'cashflow', 'business-reports', 'settings'];
  for (const view of businessViews) {
    await page.click(`[data-mode-nav="business"] .nav-link[data-view="${view}"]`);
    await page.waitForTimeout(650);
    check(`business view "${view}" opens`, await page.locator(`.view[data-view="${view}"]`).isVisible(), await page.locator('#pageTitle').innerText());
    await page.screenshot({ path: `${OUT}/business-${view}.png`, fullPage: true });
  }

  // ---------- business transactions include business data + party column ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="transactions"]');
  await page.waitForTimeout(700);
  const bizTitles = await page.locator('#txBody .cell-title strong').allInnerTexts();
  check('business list shows business entries', bizTitles.some((t) => /Counter sales/i.test(t)), bizTitles.join(' | '));
  check('business list hides personal entries', !bizTitles.some((t) => /Groceries|Salary/i.test(t)));
  check('party column visible in business mode', await page.locator('#txBody tr:first-child td.biz-col').isVisible());

  // ---------- customers: create ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="customers"]');
  await page.waitForTimeout(600);
  await page.click('#addCustomerBtn');
  await page.waitForTimeout(300);
  check('customer dialog opens', await page.locator('#formDialog').isVisible());
  const newCustomerName = `UI Test Co ${STAMP}`;
  await page.fill('#ff-name', newCustomerName);
  await page.fill('#ff-email', 'ui@test.example');
  await page.click('#formDialogSubmit');
  await page.waitForTimeout(900);
  await page.waitForFunction((name) => [...document.querySelectorAll('#customerBody .cell-title strong')].some((n) => n.textContent === name), newCustomerName, { timeout: 8000 }).catch(() => {});
  const customerNames = await page.locator('#customerBody .cell-title strong').allInnerTexts();
  check('customer dialog closed after save', !(await page.locator('#formDialog').isVisible()));
  check('customer created in UI', customerNames.includes(newCustomerName), customerNames.join(' | '));

  // ---------- customers: delete blocked for a customer with invoices ----------
  page.once('dialog', () => {});
  const rowWithInvoice = page.locator('#customerBody tr', { hasText: 'Sharma Traders' }).first();
  await rowWithInvoice.locator('[aria-label^="Delete"]').click();
  await page.waitForTimeout(300);
  await page.click('#confirmOk');
  await page.waitForTimeout(700);
  const blocked = await page.locator('.toast-error').allInnerTexts();
  check('delete of a customer with invoices is refused', blocked.some((t) => /archive/i.test(t)), blocked.join(' / '));
  const stillThere = await page.locator('#customerBody .cell-title strong').allInnerTexts();
  check('customer still present after refused delete', stillThere.some((t) => t.includes('Sharma Traders')), stillThere.join(' | '));

  // ---------- invoices: create through the UI ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="invoices"]');
  await page.waitForTimeout(800);
  await page.click('#newInvoiceBtn');
  await page.waitForTimeout(600);
  check('invoice editor opens', await page.locator('#invoiceDialog').isVisible());
  const suggested = await page.inputValue('#invNumber');
  check('invoice number suggested', /^INV-\d{4}-\d{4}$/.test(suggested), suggested);
  await page.selectOption('#invCustomerSelect', { label: '[DEMO] Gupta & Sons' });
  await page.fill('#invDate', '2026-10-25');
  await page.fill('#invDueDate', '2026-11-24');
  const firstLine = page.locator('#invoiceItemsBody tr').first();
  await firstLine.locator('input').nth(0).fill('UI test service');
  await firstLine.locator('input').nth(1).fill('3');
  await firstLine.locator('input').nth(2).fill('1000');
  await firstLine.locator('input').nth(3).fill('18');
  await page.click('#addLineBtn');
  const secondLine = page.locator('#invoiceItemsBody tr').nth(1);
  await secondLine.locator('input').nth(0).fill('Setup fee');
  await secondLine.locator('input').nth(1).fill('1');
  await secondLine.locator('input').nth(2).fill('500');
  await secondLine.locator('input').nth(3).fill('0');
  await page.waitForTimeout(250);
  const previewTotal = await page.locator('#previewTotal').innerText();
  check('editor preview total = 3×1000 + 18% + 500 = 4,040', previewTotal.replace(/[₹,\s]/g, '') === '4040', previewTotal);
  await page.screenshot({ path: `${OUT}/invoice-editor.png` });
  await page.click('#invoiceSubmitBtn');
  await page.waitForTimeout(1100);
  check('invoice dialog closed after save', !(await page.locator('#invoiceDialog').isVisible()));
  const invoiceNumbers = await page.locator('#invoiceBody td strong').allInnerTexts();
  check('new invoice appears in the list', invoiceNumbers.includes('INV-2026-0001') || invoiceNumbers.some((n) => /^INV-/.test(n)), invoiceNumbers.join(' | '));
  const newInvoiceNumber = suggested;

  // ---------- invoice viewer: status must not change by opening ----------
  const uiInvoiceRow = page.locator('#invoiceBody tr', { hasText: suggested });
  await uiInvoiceRow.locator('[aria-label^="View"]').click();
  await page.waitForTimeout(700);
  check('invoice viewer opens', await page.locator('#invoiceViewDialog').isVisible());
  const viewerText = await page.locator('#invoiceViewTitle').innerText();
  check('viewer shows invoice number', /INV-\d{4}-\d{4}/.test(viewerText), viewerText);
  const viewerBody = await page.locator('#invoicePrintArea').innerText();
  check('viewer shows server total 4,040', viewerBody.includes('4,040'), viewerBody.split('\n').slice(0, 6).join(' / '));
  await page.screenshot({ path: `${OUT}/invoice-viewer.png` });
  await page.click('#invoiceViewClose');
  await page.waitForTimeout(500);
  const statusAfterView = await uiInvoiceRow.locator('.badge').innerText();
  check('opening an invoice does NOT mark it paid', statusAfterView.trim() === 'Unpaid', statusAfterView);

  // ---------- record a partial payment ----------
  await uiInvoiceRow.locator('[aria-label^="View"]').click();
  await page.waitForTimeout(700);
  await page.click('#invoicePayBtn');
  await page.waitForTimeout(400);
  const prefilled = await page.inputValue('#ff-amount');
  check('payment amount pre-filled with balance', Number(prefilled) === 4040, prefilled);
  await page.fill('#ff-amount', '1000');
  await page.selectOption('#ff-method', 'upi');
  await page.click('#formDialogSubmit');
  await page.waitForTimeout(1300);
  if (await page.locator('#invoiceViewDialog').isVisible()) await page.click('#invoiceViewClose');
  await page.waitForTimeout(600);
  const partialBadge = await uiInvoiceRow.locator('.badge').innerText();
  check('partial payment → status Partially paid', partialBadge.trim() === 'Partially paid', partialBadge);
  const balanceCell = await uiInvoiceRow.locator('td').nth(6).innerText();
  check('partial payment reduces balance to ₹3,040', balanceCell.replace(/[₹,\s]/g, '') === '3040', balanceCell);

  // ---------- over-payment is refused ----------
  await uiInvoiceRow.locator('[aria-label^="View"]').click();
  await page.waitForTimeout(700);
  await page.click('#invoicePayBtn');
  await page.waitForTimeout(400);
  await page.fill('#ff-amount', '99999');
  await page.click('#formDialogSubmit');
  await page.waitForTimeout(800);
  const overPayError = await page.locator('#formDialog').innerText();
  check('over-payment rejected with a clear message', /outstanding|Maximum/i.test(overPayError), overPayError.split('\n').slice(-2).join(' '));
  await page.click('#formDialogCancel');
  await page.waitForTimeout(300);
  if (await page.locator('#invoiceViewDialog').isVisible()) await page.click('#invoiceViewClose');
  await page.waitForTimeout(500);

  // ---------- bills: record a payment ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="bills"]');
  await page.waitForTimeout(800);
  const billRow = page.locator('#billBody tr').first();
  const billBalanceBefore = await billRow.locator('td').nth(6).innerText();
  await billRow.locator('button', { hasText: 'Pay' }).click();
  await page.waitForTimeout(400);
  await page.fill('#ff-amount', '200');
  await page.click('#formDialogSubmit');
  await page.waitForFunction(() => !document.querySelector('#formDialog')?.open, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const billBalanceAfter = await page.locator('#billBody tr').first().locator('td').nth(6).innerText();
  check('bill payment reduces outstanding', billBalanceBefore !== billBalanceAfter, `${billBalanceBefore} → ${billBalanceAfter}`);
  check('bill outstanding total on the cards', (await page.locator('#billStatOutstanding').innerText()).includes('₹'));

  // ---------- cash flow excludes unpaid documents ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="cashflow"]');
  await page.waitForTimeout(800);
  const cfIn = await page.locator('#cfIn').innerText();
  const cfOut = await page.locator('#cfOut').innerText();
  const notReceived = await page.locator('#cfNotReceived').innerText();
  check('cash flow money received shown', cfIn.includes('₹'), cfIn);
  check('cash flow money paid shown', cfOut.includes('₹'), cfOut);
  check('unpaid invoices reported separately from cash', notReceived.includes('₹'), `not yet received ${notReceived}`);

  // ---------- CSV export ----------
  await page.click('[data-mode-nav="business"] .nav-link[data-view="business-reports"]');
  await page.waitForTimeout(900);
  const bizDownload = page.waitForEvent('download');
  await page.click('#exportBizInvBtn');
  const bizDl = await bizDownload;
  const bizCsvPath = await bizDl.path();
  const csvText = fs.readFileSync(bizCsvPath, 'utf8');
  check('invoice CSV downloads', /invoices.*\.csv$/i.test(bizDl.suggestedFilename()), bizDl.suggestedFilename());
  check('CSV contains a header and invoice rows', csvText.split('\n').length > 2 && /DEMO-0001|INV-2026/.test(csvText), csvText.split('\n')[0].slice(0, 70));
  check('CSV excludes personal data', !/(?<![A-Za-z])Groceries/i.test(csvText) && !/Practice set/i.test(csvText));

  await page.click('.mode-btn[data-mode="individual"]');
  await page.waitForTimeout(1100);
  await page.click('[data-mode-nav="individual"] .nav-link[data-view="transactions"]');
  await page.waitForTimeout(900);
  const nmDownload = page.waitForEvent('download');
  await page.click('#exportTxListBtn');
  const nmDl = await nmDownload;
  const nmText = fs.readFileSync(await nmDl.path(), 'utf8');
  check('individual CSV downloads', /\.csv$/i.test(nmDl.suggestedFilename()), nmDl.suggestedFilename());
  check('individual CSV excludes business rows', !/Counter sales|Bulk order|Shop rent|\[DEMO\]/i.test(nmText), `${nmText.split('\n').length} lines`);

  // ---------- mode persistence + deep link ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check('mode remembered after reload', await page.locator('[data-mode-nav="individual"]').isVisible());
  await page.goto(`${BASE}/#invoices`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('deep link to #invoices opens business mode', await page.locator('[data-mode-nav="business"]').isVisible());
  check('deep link renders the invoices screen', await page.locator('.view[data-view="invoices"]').isVisible());
  check('hash keeps the invoices route', page.url().endsWith('#invoices'), page.url());

  // ---------- theme toggle with charts ----------
  await page.goto(`${BASE}/#business-dashboard`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1300);
  await page.click('#themeToggle');
  await page.waitForTimeout(700);
  check('dark theme applied', (await page.locator('html').getAttribute('data-theme')) === 'dark');
  check('business chart still present in dark theme', await page.locator('#bizTrendChart').isVisible());
  await page.screenshot({ path: `${OUT}/business-dashboard-dark.png`, fullPage: true });
  await page.click('#themeToggle');
  await page.waitForTimeout(400);

  // ---------- mobile layout ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/#invoices`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('#menuBtn');
  await page.waitForTimeout(400);
  check('sidebar opens on mobile', await page.locator('#sidebar').evaluate((n) => n.classList.contains('is-open')));
  await page.screenshot({ path: `${OUT}/mobile-business.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('sidebar closes with Escape', !(await page.locator('#sidebar').evaluate((n) => n.classList.contains('is-open'))));

  check('no uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} UI checks passed =====`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join('; '));
  fs.writeFileSync(path.join(__dirname, 'out', 'ui2-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
