/* Signed-in UI paths, with the Supabase network mocked (no real account used). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out', 'auth');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const SESSION = JSON.stringify({
  accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token',
  expiresAt: FUTURE,
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'demo@student.example', displayName: 'Aarav' },
});

async function signedInPage(browser, { profilesExist }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Seed the session ONCE. Re-seeding on every navigation would resurrect it
  // after "Sign out" and make the sign-out test lie to us.
  await ctx.addInitScript((sess) => {
    if (!localStorage.getItem('smartspend:seeded')) {
      localStorage.setItem('smartspend:supabase-session', sess);
      localStorage.setItem('smartspend:onboarded', 'yes');
      localStorage.setItem('smartspend:seeded', '1');
    }
  }, SESSION);
  const page = await ctx.newPage();

  await page.route('**/auth/v1/user', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'demo@student.example',
      email_confirmed_at: '2026-10-28T10:00:00Z',
      user_metadata: { display_name: 'Aarav' },
    }),
  }));
  await page.route('**/rest/v1/profiles*', (route) => {
    if (!profilesExist) {
      return route.fulfill({
        status: 404, contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" }),
      });
    }
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', email: 'demo@student.example', display_name: 'Aarav' }]),
      });
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([{ display_name: 'Aarav' }]) });
  });
  await page.route('**/auth/v1/logout', (route) => route.fulfill({ status: 204, body: '' }));
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- A. profiles table missing → honest error state ----------
  {
    const { page } = await signedInPage(browser, { profilesExist: false });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    check('signed-in user reaches the app', !page.url().includes('/login.html'), page.url());
    check('sidebar shows the signed-in email', /demo@student\.example/.test(await page.locator('#accountEmail').innerText()),
      await page.locator('#accountEmail').innerText());
    check('avatar uses the display-name initial', (await page.locator('.account-avatar').innerText()) === 'A');

    await page.locator('.nav-link[data-view="settings"]:visible').first().click();
    await page.waitForTimeout(1800);
    check('Settings shows the Account & Cloud card', await page.locator('#cloudCard').isVisible());
    check('missing profiles table is reported, not hidden', (await page.locator('#cloudStatus').innerText()).includes('schema not installed'),
      await page.locator('#cloudStatus').innerText());
    check('card tells you to run schema.sql', /schema\.sql/.test(await page.locator('#cloudProfileState').innerText()),
      await page.locator('#cloudProfileState').innerText());
    check('save is disabled while the table is missing', await page.locator('#cloudSaveBtn').isDisabled());
    await page.screenshot({ path: `${OUT}/06-cloud-missing-schema.png`, fullPage: true });
  }

  // ---------- B. profiles table present → connected ----------
  {
    const { page } = await signedInPage(browser, { profilesExist: true });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.locator('.nav-link[data-view="settings"]:visible').first().click();
    await page.waitForTimeout(1800);
    check('connected state is shown when the table exists', (await page.locator('#cloudStatus').innerText()).includes('connected'),
      await page.locator('#cloudStatus').innerText());
    check('profile row is reported as found', (await page.locator('#cloudProfileState').innerText()).includes('Found'));
    check('display name is loaded into the field', (await page.locator('#cloudDisplayName').inputValue()) === 'Aarav');
    await page.locator('#cloudDisplayName').fill('Aarav Sharma');
    await page.locator('#cloudSaveBtn').click();
    await page.waitForTimeout(1500);
    check('save shows a success toast', await page.locator('.toast, [role="status"]').first().isVisible().catch(() => false));
    await page.screenshot({ path: `${OUT}/07-cloud-connected.png`, fullPage: true });

    // ---------- C. sign out ----------
    page.on('dialog', (d) => d.accept());
    await page.locator('#accountSignOut').click();
    await page.waitForTimeout(2000);
    check('sign out returns to the login page', page.url().includes('/login.html'), page.url());
    check('session cleared on sign out',
      (await page.evaluate(() => localStorage.getItem('smartspend:supabase-session'))) === null);
  }

  // ---------- D. already signed in → login page bounces to the app ----------
  {
    const { page } = await signedInPage(browser, { profilesExist: true });
    await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    check('login page skips itself when a session exists', !page.url().includes('/login.html'), page.url());
  }

  console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} signed-in checks passed =====`);
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
