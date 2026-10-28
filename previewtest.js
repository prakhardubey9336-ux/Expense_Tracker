/* The login page and app inside <iframe sandbox="allow-scripts"> — the way a
   preview pane embeds a page: no localStorage, opaque origin. */
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = path.join(__dirname, 'out', 'preview');
fs.mkdirSync(OUT, { recursive: true });

// A one-file web server whose only job is to host the <iframe sandbox="allow-scripts">
// wrapper, so this test needs nothing but node + playwright.
const hostHtml = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%}iframe{width:100%;height:100vh;border:0}</style>
<iframe sandbox="allow-scripts" src="${BASE}/login.html"></iframe>`;

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));

  const hostServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(hostHtml);
  });
  await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  const hostUrl = `http://127.0.0.1:${hostServer.address().port}/`;
  await p.goto(hostUrl);
  await p.waitForTimeout(2500);
  let f = p.frames()[1];

  if (!f) {
    console.log('FAIL  no iframe found — is the server running at ' + BASE + '?');
    process.exit(1);
  }
  check('login page still renders in a sandboxed frame',
    (await f.locator('h1').innerText()).includes('Two books'));

  const notice = f.locator('#storageNotice');
  check('storage-blocked notice is visible', await notice.isVisible());
  check('notice explains the limitation', /blocks browser storage/.test(await notice.innerText()),
    (await notice.innerText()).slice(0, 60) + '…');

  // ---- local mode must actually open the app (previously: silent no-op) ----
  await f.locator('#localModeBtn').click();
  await p.waitForTimeout(3000);
  f = p.frames()[1];
  check('local mode leaves the login page', !f.url().includes('/login.html'), f.url());
  check('app dashboard loaded in the frame', await f.locator('#statIncome').isVisible().catch(() => false));
  check('dashboard shows real data', /₹/.test(await f.locator('#statIncome').innerText().catch(() => '')));
  const appBar = f.locator('#storageNotice');
  check('app explains that the session is not remembered', await appBar.isVisible().catch(() => false));
  await p.screenshot({ path: path.join(OUT, 'preview-app.png') });

  // ---- sign-in with storage blocked: honest message, no bounce loop -------
  await p.goto(hostUrl);
  await p.waitForTimeout(2000);
  f = p.frames()[1];
  await p.route('**/auth/v1/token**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'mock', refresh_token: 'mock', expires_in: 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'demo@student.example',
        email_confirmed_at: '2026-10-28T10:00:00Z', user_metadata: { display_name: 'Aarav' } } }),
  }));
  await f.locator('#signInEmail').fill('demo@student.example');
  await f.locator('#signInPassword').fill('smart1234');
  await f.locator('#signInSubmit').click();
  await p.waitForTimeout(2500);
  check('sign-in does not bounce into a loop', f.url().includes('/login.html'), f.url());
  const alertText = await f.locator('#authAlert').innerText();
  check('sign-in says the session cannot be kept', /cannot keep the session/i.test(alertText), alertText.slice(0, 70) + '…');
  await p.screenshot({ path: path.join(OUT, 'preview-signin.png') });

  console.log(`\n===== ${results.filter((r) => r.ok).length}/${results.length} sandboxed-preview checks passed =====`);
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  hostServer.close();
  await b.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
