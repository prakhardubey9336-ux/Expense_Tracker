/* Login page + guard + Supabase connectivity checks (real network calls). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out', 'auth');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. guard redirects an anonymous visitor ----------
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('anonymous visitor is redirected to /login.html', page.url().includes('/login.html'), page.url());
  check('login page shows the sign-in form', await page.locator('#panelSignIn').isVisible());
  check('create-account panel starts hidden', !(await page.locator('#panelSignUp').isVisible()));
  check('Supabase status line reports a real result',
    /Supabase (connected|reachable|unreachable)/.test(await page.locator('#supabaseStatus').innerText()),
    await page.locator('#supabaseStatus').innerText());
  await page.screenshot({ path: `${OUT}/01-login.png`, fullPage: true });

  // ---------- 2. tab switch + password toggle ----------
  await page.locator('#tabSignUp').click();
  await page.waitForTimeout(250);
  check('create-account tab shows its panel', await page.locator('#panelSignUp').isVisible());
  await page.locator('#signUpPassword').fill('abc');
  await page.waitForTimeout(150);
  check('password strength hint reacts', /more character/.test(await page.locator('#passwordHint').innerText()),
    await page.locator('#passwordHint').innerText());
  await page.locator('.password-toggle[data-target="signUpPassword"]').click();
  check('password toggle reveals the value', (await page.locator('#signUpPassword').getAttribute('type')) === 'text');
  await page.screenshot({ path: `${OUT}/02-signup.png`, fullPage: true });

  // ---------- 3. client-side validation ----------
  await page.locator('#signUpEmail').fill('not-an-email');
  await page.locator('#signUpPassword').fill('longenough123');
  await page.locator('#signUpSubmit').click();
  await page.waitForTimeout(300);
  check('invalid email is caught before any request', /does not look like an email/.test(await page.locator('#authAlert').innerText()),
    await page.locator('#authAlert').innerText());

  // ---------- 4. real Supabase call: wrong credentials ----------
  await page.locator('#tabSignIn').click();
  await page.locator('#signInEmail').fill('probe-does-not-exist@example.com');
  await page.locator('#signInPassword').fill('definitely-wrong-123');
  await page.locator('#signInSubmit').click();
  await page.waitForTimeout(3500);
  const alertText = await page.locator('#authAlert').innerText();
  check('wrong password shows a human error from Supabase', /do not match an account/i.test(alertText), alertText);
  check('alert is styled as an error', (await page.locator('#authAlert').getAttribute('class')).includes('is-error'));
  await page.screenshot({ path: `${OUT}/03-invalid-credentials.png`, fullPage: true });

  // ---------- 5. local mode enters the app ----------
  await page.locator('#localModeBtn').click();
  await page.waitForTimeout(2500);
  check('local mode opens the dashboard', !page.url().includes('/login.html'), page.url());
  check('account panel says Local mode', /Local mode/.test(await page.locator('#accountName').innerText()),
    await page.locator('#accountName').innerText());
  // A freshly-answered login still gets the first-run purpose chooser.
  if (await page.locator('#purposeScreen').isVisible()) {
    await page.locator('.purpose-option[data-purpose="individual"]').click();
    await page.locator('#purposeContinue').click();
    await page.waitForTimeout(1200);
  }
  check('dashboard rendered real data', (await page.locator('#statIncome').innerText()).includes('₹'),
    await page.locator('#statIncome').innerText());
  check('welcome chooser dismissed after answering', !(await page.locator('#purposeScreen').isVisible()));
  await page.screenshot({ path: `${OUT}/04-local-mode-app.png`, fullPage: true });

  // ---------- 6. session survives a reload ----------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('reload stays in the app (no redirect loop)', !page.url().includes('/login.html'));
  check('local mode flag persists', await page.evaluate(() => localStorage.getItem('smartspend:local-mode')) === '1');

  // ---------- 7. account panel sign-out returns to login ----------
  await page.locator('#accountSignOut').click();
  await page.waitForTimeout(1500);
  check('sign-out from local mode returns to the login page', page.url().includes('/login.html'), page.url());
  check('local flag cleared on sign-out', await page.evaluate(() => localStorage.getItem('smartspend:local-mode')) === null);

  // ---------- 8. a forged/expired session is rejected ----------
  await page.evaluate(() => {
    localStorage.setItem('smartspend:supabase-session', JSON.stringify({
      accessToken: 'not.a.real.token', refreshToken: 'nope',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: 'x', email: 'fake@example.com' },
    }));
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  check('a bogus token is validated and rejected', page.url().includes('/login.html'), page.url());
  check('bogus session cleared from storage',
    (await page.evaluate(() => localStorage.getItem('smartspend:supabase-session'))) === null);

  // ---------- 9. login page redirects an already-signed-in session ----------
  // (simulated with a valid-looking session is not possible without real creds;
  //  we assert the code path by checking it does NOT loop for local mode instead.)

  // ---------- 10. responsive ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-login-mobile.png`, fullPage: true });
  check('login page renders on mobile without horizontal scroll',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} auth checks passed =====`);
  console.log('page errors:', errs.length ? errs : 'none');
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
