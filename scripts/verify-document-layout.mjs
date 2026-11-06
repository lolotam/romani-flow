// Run with Playwright installed separately: PLAYWRIGHT_MODULE_PATH may point to its index.mjs.
// Uses only a loopback fixture and intercepted synthetic API responses; no backend is started.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const server = await createServer({ configFile: false, envFile: false,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': resolve('src') } },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'synthetic-document-layout', configureServer(s) {
    s.middlewares.use('/fixture', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body><div id="root"></div><script type="module" src="/scripts/fixtures/document-layout.tsx"></script></body></html>');
    });
  } }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  for (const language of ['ar', 'en']) for (const width of [360, 430, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => console.error(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.on('requestfailed', request => console.error(request.url(), request.failure()));
    await page.addInitScript(lang => { if (location.protocol === 'http:') localStorage.setItem('language', lang); document.addEventListener('DOMContentLoaded', () => { document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }); }, language);
    await page.route(/\/api\//, route => {
      const url = route.request().url();
      if (!new URL(url).pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(), 'GET', 'layout checks must not mutate data');
      const data = url.includes('/auth/me') ? { user: { id: 'synthetic', role: 'admin' } }
        : url.includes('/document-drafts/') ? { revision: 'none', values: null } : {};
      return route.fulfill({ json: { data, error: null } });
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`);
    await page.getByRole('button').click();
    await page.locator('input[type=file]').setInputFiles({ name: `synthetic-${'document'.repeat(15)}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    const form = page.locator('[role=dialog]').filter({ has: page.locator('form') });
    await form.waitFor();
    await page.waitForFunction(() => document.querySelector('iframe')?.src.startsWith('blob:'));
    await page.waitForTimeout(300); // Let the dialog's 200ms entry transform finish.
    const geometry = await form.evaluate(el => {
      const r = el.getBoundingClientRect();
      const outside = [...el.querySelectorAll('form, fieldset, button, input, iframe, section')].filter(node => {
        const b = node.getBoundingClientRect(); return b.width && (b.left < r.left - 1 || b.right > r.right + 1);
      }).map(node => node.tagName);
      return { x: r.x, width: r.width, right: r.right, scroll: el.scrollWidth, client: el.clientWidth, outside };
    });
    console.log(language, width, geometry);
    assert.ok(geometry.x >= 0 && geometry.right <= width + 1, 'dialog fits viewport');
    assert.ok(geometry.scroll <= geometry.client + 1, 'dialog has no horizontal overflow');
    assert.deepEqual(geometry.outside, [], 'form, preview and actions fit dialog');
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
