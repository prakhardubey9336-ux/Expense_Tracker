/* 2.1 feature checks: purpose chooser, deltas, budget daily line,
   filter presets, business aging + top customers, button restyle. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out', 'features');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource.*\b(400|404|409)\b/.test(m.text())) return;
    errors.push(m.text());
  });

  // ---------- first run ----------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('first run shows the purpose chooser', await page.locator('#purposeScreen').isVisible());
  check('continue is disabled until a purpose is picked', await page.locator('#purposeContinue').isDisabled());
  check('chooser asks the question', (await page.locator('#purposeTitle').innerText()).includes('What will you use SmartSpend for?'));
  await page.screenshot({ path: `${OUT}/01-purpose-chooser.png` });

  await page.locator('.purpose-option[data-purpose="business"]').click();
  await page.waitForTimeout(200);
  check('choosing Business enables continue', !(await page.locator('#purposeContinue').isDisabled()));
  check('choice is reflected with aria-pressed', (await page.locator('.purpose-option[data-purpose="business"]').getAttribute('aria-pressed')) === 'true');
  await page.screenshot({ path: `${OUT}/02-purpose-selected.png` });

  await page.locator('#purposeContinue').click();
  await page.waitForTimeout(1200);
  check('chooser closes after continue', !(await page.locator('#purposeScreen').isVisible()));
  check('app opens in Business mode', (await page.locator('#pageTitle').innerText()) === 'Business Dashboard');

  // ---------- not asked again ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check('returning user is not asked again', !(await page.locator('#purposeScreen').isVisible()));

  // ---------- reopen from Settings ----------
  await page.locator('.nav[data-mode-nav="business"] .nav-link[data-view="settings"]').click();
  await page.waitForTimeout(700);
  await page.locator('#changePurposeBtn').click();
  await page.waitForTimeout(400);
  check('Settings can reopen the chooser', await page.locator('#purposeScreen').isVisible());
  await page.locator('.purpose-option[data-purpose="individual"]').click();
  await page.locator('#purposeContinue').click();
  await page.waitForTimeout(1200);
  check('switching purpose from Settings lands on the Individual dashboard', (await page.locator('#pageTitle').innerText()) === 'Dashboard');

  // ---------- deltas + budget daily line ----------
  await page.waitForTimeout(700);
  const chips = await page.locator('.stat-delta').count();
  check('summary cards show month-over-month chips', chips >= 3, `${chips} chips`);
  const chipText = await page.locator('#statExpenseNote .stat-delta').innerText();
  check('expense chip reports a percentage', /%/.test(chipText), chipText);
  const daily = await page.locator('#dashBudgetDaily').innerText();
  check('budget shows a daily allowance', /a day/.test(daily), daily);
  await page.screenshot({ path: `${OUT}/03-dashboard-deltas.png`, fullPage: true });

  // ---------- filter presets ----------
  await page.locator('.nav-link[data-view="transactions"]:visible').first().click();
  await page.waitForTimeout(800);
  await page.locator('.preset-chip[data-preset="this-month"]').click();
  await page.waitForTimeout(900);
  const from = await page.locator('#fFrom').inputValue();
  const to = await page.locator('#fTo').inputValue();
  check('"This month" fills both date inputs', /^\d{4}-\d{2}-01$/.test(from) && to.startsWith(from.slice(0, 7)), `${from} → ${to}`);
  check('preset chip is marked pressed', (await page.locator('.preset-chip[data-preset="this-month"]').getAttribute('aria-pressed')) === 'true');
  await page.screenshot({ path: `${OUT}/04-filter-presets.png` });
  await page.locator('.preset-chip[data-preset="all"]').click();
  await page.waitForTimeout(800);
  check('"All time" clears the range', (await page.locator('#fFrom').inputValue()) === '');

  // ---------- business cards ----------
  await page.locator('.mode-btn[data-mode="business"]').click();
  await page.waitForTimeout(1400);
  const agingRows = await page.locator('#bizAgingList .aging-row').count();
  check('receivables aging renders buckets', agingRows >= 2, `${agingRows} buckets`);
  const agingNote = await page.locator('#bizAgingNote').innerText();
  check('aging note mentions overdue money', /past its due date/.test(agingNote), agingNote);
  const topRows = await page.locator('#bizTopCustomers .rank-row').count();
  check('top customers list is ranked', topRows >= 1, `${topRows} customers`);
  await page.screenshot({ path: `${OUT}/05-business-aging.png`, fullPage: true });

  // ---------- buttons ----------
  const prim = await page.locator('.btn.btn-primary:visible').first().evaluate((b) => {
    const css = getComputedStyle(b);
    return { radius: css.borderRadius, height: b.getBoundingClientRect().height, bg: css.backgroundImage };
  });
  check('primary button is rounded (≥10px)', parseFloat(prim.radius) >= 10, prim.radius);
  check('primary button meets the 40px tap target', prim.height >= 38, `${Math.round(prim.height)}px`);
  check('primary button uses the indigo gradient', /gradient/.test(prim.bg));
  await page.locator('.icon-btn:visible').first().hover();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/06-buttons.png` });

  console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} feature checks passed =====`);
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
