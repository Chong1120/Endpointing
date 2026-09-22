/**
 * Captures README screenshots of a running SafeCall instance using an
 * installed Chromium-based browser (Microsoft Edge by default — no browser
 * download needed).
 *
 *   node scripts/screenshots.mjs
 *
 * It signs in through the one-click demo logins, so no credentials are needed,
 * and walks all three roles: the customer's line, the support agent's queue and
 * the admin console.
 *
 * Env: SAFECALL_URL (default http://127.0.0.1:5173), BROWSER_CHANNEL
 * (msedge | chrome), OUT_DIR (default ../docs/screenshots).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = (process.env.SAFECALL_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const outDir = process.env.OUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.error('page error:', error.message));

async function shot(name, { fullPage = true } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(700);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

const heading = (name) => page.getByRole('heading', { name, exact: true }).first().waitFor();

/** Signs out by dropping the stored session, so the next persona starts clean. */
async function enterAs(label) {
  await page.goto(`${baseUrl}/login`);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* private mode */
    }
  });
  await page.goto(`${baseUrl}/login`);
  const button = page.getByRole('button', { name: new RegExp(`Enter as ${label}`, 'i') });
  await button.waitFor();
  await button.click();
  await page.waitForURL(`${baseUrl}/`, { timeout: 30_000 });
}

// 1. The way in: three roles, one click each.
await page.goto(`${baseUrl}/login`);
await page.getByRole('button', { name: /Enter as Customer/i }).waitFor();
await shot('01-login', { fullPage: false });

// 2. The customer: a phone line and their own calls. No console.
await enterAs('Customer');
await heading('Talk to us about your bill');
await shot('02-customer');

// 3. The support agent: the queue the AI hands over to.
await enterAs('Support agent');
await heading('Escalations');
await shot('03-escalations');

// 4-11. The admin console.
await enterAs('Admin');
await heading('Recent calls');
await shot('04-dashboard');

await page.goto(`${baseUrl}/agent`);
await heading('Live agent');
await shot('05-live-agent');

await page.goto(`${baseUrl}/upload`);
await page.getByText('Drag & drop a call recording').waitFor();
await shot('06-upload');

let callId = process.env.SAFECALL_CALL_ID;
if (!callId) {
  await page.goto(`${baseUrl}/calls?status=COMPLETED`);
  await page.locator('tbody tr').first().click();
  await page.waitForURL(/\/calls\/[0-9a-f-]{36}$/);
  callId = page.url().split('/').pop();
}

await page.goto(`${baseUrl}/calls/${callId}`);
await heading('Redacted transcript');
await heading('Safe recording');
await shot('07-call-detail');

await page.goto(`${baseUrl}/calls?q=refund`);
await heading('Calls & search');
await page.waitForTimeout(900);
await shot('08-search');

await page.goto(`${baseUrl}/analytics`);
await heading('Call volume');
await shot('09-analytics');

await page.goto(`${baseUrl}/policies`);
await heading('PII policies');
await shot('10-policies');

await page.goto(`${baseUrl}/audit`);
await heading('Audit trail');
await shot('11-audit');

await page.goto(`${baseUrl}/team`);
await heading('Team');
// The invite code is live for seven days, so it does not belong in a public screenshot.
await page.evaluate(() => {
  const field = document.querySelector('input[readonly]');
  if (field) field.value = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.XXXXX.XXXXXXXXXXXXXXXX';
});
await shot('12-team');

await browser.close();
