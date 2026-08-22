/**
 * Which pages actually talk to the server?
 *
 * The runtime inspector only records FAILED requests, so its observedEndpoints
 * field is always empty and cannot answer this. This navigates to every primary
 * page and records the successful /api/ calls each one makes, so "connected to
 * the backend" is measured rather than assumed.
 *
 * A page that makes no call is not automatically wrong — plenty of pages are
 * legitimately pure UI over data already loaded once at boot. The point is to
 * know which is which.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = process.env.PORT || '8091';
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'Octagon123!';
const LIMIT = Number(process.env.PROBE_LIMIT || 0);

const ledger = JSON.parse(fs.readFileSync('docs/product/PAGE_FUNCTIONAL_LEDGER.json', 'utf8'));
let pages = ledger.rows.map((r) => ({ id: r.pageId, pri: r.reviewPriority, domain: r.domain }));
const ONLY = (process.env.PROBE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (ONLY.length) pages = pages.filter((p) => ONLY.includes(p.id));
if (LIMIT) pages = pages.slice(0, LIMIT);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();

const calls = [];
page.on('response', (res) => {
  try {
    const u = new URL(res.url());
    if (u.pathname.startsWith('/api/')) calls.push({ path: u.pathname, status: res.status() });
  } catch (_) { /* ignore */ }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(async (password) => {
  const login = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'review.sysadmin', password }),
  });
  const body = await login.json().catch(() => ({}));
  await fetch('/api/auth/context', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: 'c_alwarsha_demo', branchId: 'b_alwarsha_demo_main' }),
  });
  localStorage.setItem('octagon_user_id', body.user?.id || 'usr_review_sysadmin');
  localStorage.setItem('pentagon_user_id', body.user?.id || 'usr_review_sysadmin');
}, PASSWORD);

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, Number(process.env.PROBE_WARMUP || 5000)));

const results = [];
for (const entry of pages) {
  const before = calls.length;
  try {
    await page.evaluate((id) => window.switchPage(id), entry.id);
  } catch (_) { /* page may not be navigable */ }
  await new Promise((r) => setTimeout(r, 1600));
  const made = calls.slice(before);
  const api = made.filter((c) => !/^\/api\/(auth|db|health)\b/.test(c.path));
  const uniq = [...new Set(api.map((c) => c.path))];
  results.push({
    id: entry.id,
    pri: entry.pri,
    domain: entry.domain,
    apiCalls: api.length,
    endpoints: uniq.slice(0, 6),
    governed: uniq.some((p) => p.startsWith('/api/v1/')),
    legacyDbWrite: made.some((c) => c.path === '/api/db'),
  });
  process.stdout.write(`\r${results.length}/${pages.length}`);
}
process.stdout.write('\n');

const summary = {
  total: results.length,
  calledServer: results.filter((r) => r.apiCalls > 0).length,
  governed: results.filter((r) => r.governed).length,
  noCall: results.filter((r) => r.apiCalls === 0).length,
  byPriorityNoCall: results.filter((r) => r.apiCalls === 0)
    .reduce((acc, r) => { acc[r.pri] = (acc[r.pri] || 0) + 1; return acc; }, {}),
};

fs.writeFileSync('docs/product/PAGE_BACKEND_WIRING.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
