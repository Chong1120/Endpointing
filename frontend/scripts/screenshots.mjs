/**
 * Captures README screenshots of a running SafeCall instance using an
 * installed Chromium-based browser (Microsoft Edge by default — no browser
 * download needed).
 *
 *   SAFECALL_EMAIL=demo@northwind.example SAFECALL_PASSWORD=... node scripts/screenshots.mjs
 *
 * Env: SAFECALL_URL (default http://127.0.0.1:5173), SAFECALL_CALL_ID (optional,
 * otherwise the first archived call is used), BROWSER_CHANNEL (msedge | chrome),
 * OUT_DIR (default ../docs/screenshots).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = (process.env.SAFECALL_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const email = process.env.SAFECALL_EMAIL;
const password = process.env.SAFECALL_PASSWORD;
const outDir = process.env.OUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');
if (!email || !password) {
  console.error('Set SAFECALL_EMAIL and SAFECALL_PASSWORD');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.error('page error:', error.message));

async function shot(name, { fullPage = true } = {}) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(600);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log('saved', file);
}

await page.goto(`${baseUrl}/login`);
await shot('01-login', { fullPage: false });
await page.getByLabel('Work email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: /sign in securely/i }).click();
await page.waitForURL(`${baseUrl}/`);
await page.getByRole('heading', { name: 'Recent calls' }).waitFor();
await shot('02-dashboard');

await page.goto(`${baseUrl}/upload`);
await page.getByText('Drag & drop a call recording').waitFor();
await shot('03-upload');

let callId = process.env.SAFECALL_CALL_ID;
if (!callId) {
  await page.goto(`${baseUrl}/calls?status=COMPLETED`);
  await page.locator('tbody tr').first().click();
  await page.waitForURL(/\/calls\/[0-9a-f-]{36}$/);
  callId = page.url().split('/').pop();
}

const heading = (name) => page.getByRole('heading', { name, exact: true }).first().waitFor();

await page.goto(`${baseUrl}/calls/${callId}/processing`);
await heading('Pipeline');
await shot('04-processing');

await page.goto(`${baseUrl}/calls/${callId}`);
await heading('Redacted transcript');
await heading('Safe recording');
await shot('05-call-detail');

await page.goto(`${baseUrl}/calls?q=card`);
await heading('Calls & search');
await page.waitForTimeout(800);
await shot('06-search');

await page.goto(`${baseUrl}/analytics`);
await heading('Call volume');
await shot('07-analytics');

await page.goto(`${baseUrl}/policies`);
await heading('PII policies');
await shot('08-policies');

await page.goto(`${baseUrl}/audit`);
await heading('Audit trail');
await shot('09-audit');

await browser.close();
