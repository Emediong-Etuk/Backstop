// Drives the whole borrower flow in the local preview with a headless browser:
// set up protection, the price falls, a keeper rescues, the borrower withdraws.
// Usage: npm run build -w @backstop/web && node web/scripts/e2e-preview.cjs [screenshot-dir]
// Needs Playwright with Chromium (npx playwright install chromium).
const { chromium, devices } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'out');
const shots = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };
// BASE_PATH serves the site under a folder, as GitHub Pages does (e.g. BASE_PATH=/Backstop).
const basePath = process.env.BASE_PATH ?? '';
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (basePath && !pathname.startsWith(basePath + '/')) { res.writeHead(404); res.end(); return; }
  let file = path.join(root, pathname.slice(basePath.length));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}${basePath}/?preview`;
  const browser = await chromium.launch();
  const failures = [];
  for (const [name, options] of [['desktop', { viewport: { width: 900, height: 1100 } }], ['phone', devices['iPhone 13']]]) {
    const page = await (await browser.newContext(options)).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const step = async (label, fn) => { await fn(); if (shots) await page.screenshot({ path: path.join(shots, `${name}-${label}.png`), fullPage: true }); console.log(`${name}: ${label}`); };
    try {
      await page.goto(url);
      await step('1-your-loan', () => page.getByRole('heading', { name: 'Your loan' }).waitFor({ timeout: 60000 }));
      await step('2-protected', async () => {
        // The judge path: defaults only (the preview's cooldown is one block).
        await page.locator('#reserve').fill('0.3');
        await page.getByRole('button', { name: 'Protect my loan' }).click();
        await page.getByRole('heading', { name: 'Your loan is protected' }).waitFor({ timeout: 60000 });
      });
      await step('2b-attack-refused', async () => {
        for (const name of ['Steal the reserve', 'Overcharge the fee', 'Copy the loan key']) {
          await page.getByRole('button', { name }).click();
          await page.getByText('Refused', { exact: true }).waitFor({ timeout: 60000 });
        }
      });
      await step('3-price-falls', async () => {
        await page.getByRole('button', { name: 'Price to $265' }).click();
        await page.getByRole('heading', { name: 'Your loan is below your rescue level' }).waitFor({ timeout: 60000 });
      });
      await step('4-rescued', async () => {
        await page.getByRole('button', { name: 'Run a keeper' }).click();
        await page.getByText('Rescued:', { exact: true }).waitFor({ timeout: 60000 });
      });
      await step('5-withdrawn', async () => {
        await page.getByRole('button', { name: 'Withdraw everything' }).click();
        await page.getByRole('button', { name: 'Withdraw everything' }).click();
        await page.getByRole('heading', { name: 'Protect it' }).waitFor({ timeout: 60000 });
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) failures.push(`${name}: page scrolls sideways`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  await browser.close();
  server.close();
  console.log(failures.length ? `FAILED\n${failures.join('\n')}` : 'All steps passed on desktop and phone, no page errors.');
  process.exit(failures.length ? 1 : 0);
})();
