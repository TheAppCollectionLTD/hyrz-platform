const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const baseURL = process.env.HYRZ_WEB_URL || 'http://127.0.0.1:5173';
const accounts = [
  { role: 'worker', email: 'test.worker@hyrz.local', password: 'HyrzTestWorker!2026', heading: 'Find shifts' },
  { role: 'employer', email: 'test.employer@hyrz.local', password: 'HyrzTestEmployer!2026', heading: /^Hello,/ },
  { role: 'admin', email: 'test.owner@hyrz.local', password: 'Test-Only-Password-2026!', heading: 'Dashboard' }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const viewport of [{width:1365,height:900,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
      for (const account of accounts) {
        const page = await browser.newPage({ viewport });
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        try {
          await page.goto(baseURL, { waitUntil: 'networkidle' });
          await page.getByRole('button', { name: 'Sign in' }).first().click();
          await page.getByLabel('Email', { exact: true }).fill(account.email);
          await page.getByLabel('Password', { exact: true }).fill(account.password);
          await page.getByRole('button', { name: 'Sign in' }).last().click();
          await page.getByRole('heading', { name: account.heading }).waitFor({ timeout: 15000 });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
          assert.equal(overflow, false, 'Page has horizontal overflow');
          assert.deepEqual(pageErrors, [], 'Uncaught browser errors occurred');
          console.log('PASS ' + viewport.name + ' ' + account.role + ' login and dashboard');
        } catch (error) {
          failures.push(viewport.name + ' ' + account.role + ': ' + error.message);
          console.error('FAIL ' + viewport.name + ' ' + account.role + ': ' + error.message);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('All 6 browser smoke checks passed.');
  }
})().catch(error => { console.error(error); process.exit(1); });
