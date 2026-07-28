// Phase 03 closure audit — UI/service parity: services/financeService.js.
//
// Proves, with the real browser service module loaded in node against the real
// server.js on a disposable database (never database.db):
//   (a) flag OFF (default): the legacy PentagonDB path is byte-identical in
//       behavior — no canonical HTTP calls are made;
//   (b) flag ON (FF_CANONICAL_FINANCE): createMove/postMove/createPayment/
//       cancelMove and the getMoves/getMove/getTrialBalance readers execute
//       through the governed canonical HTTP API (/api/v1/action/*,
//       /api/v1/finance/*);
//   (c) parity: an equivalent posted entry produces the same trial-balance
//       totals on the legacy path and the canonical path;
//   (d) denial: a principal without the finance grant gets 403 through the
//       proxied path; an unauthenticated call gets 401.
//
// Harness pattern follows tests/phase03/finance-http-api.test.mjs.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from '../phase02/harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { seedChartOfAccounts } from '../../platform/finance/index.mjs';
import { allocatePort } from '../helpers/allocate-port.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
// The real fetch, captured before any shim is installed. Test helpers must
// use this so the service shim's cookie injection never interferes.
const realFetch = globalThis.fetch;

function tmpJsonPath(suite) {
  return path.join(os.tmpdir(), `octagon-p03-${suite}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
}

function startServer({ dbPath, jsonPath, port }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      USE_SQLITE: 'true',
      OCTAGON_SQLITE_DB_FILE: dbPath,
      OCTAGON_DB_FILE: jsonPath,
      PORT: String(port),
      OCTAGON_DEFAULT_PORT: String(port),
      OCTAGON_FALLBACK_PORTS: '',
      NODE_ENV: 'test',
    };
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Server failed to start within timeout. stderr: ${stderr}`));
    }, 20000);
    const checkReady = async () => {
      try {
        const res = await realFetch(`http://127.0.0.1:${port}/api/server/status`);
        if (res.ok) {
          clearTimeout(timeout);
          resolve({ proc, port, stop: () => new Promise(r => { proc.on('close', r); proc.kill(); }) });
          return;
        }
      } catch { /* not ready yet */ }
      if (proc.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited early (code ${proc.exitCode}). stderr: ${stderr}`));
        return;
      }
      setTimeout(checkReady, 200);
    };
    setTimeout(checkReady, 500);
  });
}

async function login(base, userId, password, tenantId) {
  const res = await realFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password, tenantId }),
  });
  const cookies = res.headers.get('set-cookie') || '';
  return { res, cookies };
}

// ---------------------------------------------------------------------------
// Browser-service shims: financeService.js is an IIFE on `window`. We load the
// real module with a minimal window + a fetch wrapper that pins the session
// cookie and resolves relative URLs against the booted server.
// ---------------------------------------------------------------------------
const fetchCalls = [];
function installServiceShims({ base, cookies, fixtureDb, canonicalEnabled }) {
  const windowShim = {
    OCTAGON_FEATURE_FLAGS: { FF_CANONICAL_FINANCE: canonicalEnabled },
    localStorage: { getItem: () => null },
    PermissionService: { require: () => {} },
    AuditService: { createEvent: async () => {} },
    TrackChanges: null,
    TenantService: null,
    PentagonAuth: { getCurrentUser: () => ({ id: 'u_owner' }) },
    getActiveOrgProfile: () => ({ companyId: 'c_alpha_1' }),
    __skipPaymentBackupForTests: true,
    PentagonDB: {
      getCached: () => fixtureDb,
      load: async () => fixtureDb,
      mutate: async (fn) => { await fn(fixtureDb); return fixtureDb; },
    },
  };
  globalThis.window = windowShim;
  globalThis.fetch = async (url, options = {}) => {
    const absolute = String(url).startsWith('http') ? String(url) : `${base}${url}`;
    const headers = { ...(options.headers || {}) };
    if (cookies) headers.Cookie = cookies;
    fetchCalls.push({ url: String(url), method: options.method || 'GET' });
    return realFetch(absolute, { ...options, headers });
  };
  return windowShim;
}

async function loadFinanceService() {
  // ESM caches file: imports (query strings included), so re-imports would not
  // re-run the IIFE against a fresh window shim. Evaluate the real source with
  // vm instead — bare `window` resolves to globalThis.window at run time.
  const src = fs.readFileSync(path.join(ROOT, 'services', 'financeService.js'), 'utf8');
  vm.runInThisContext(src, { filename: 'services/financeService.js' });
  return globalThis.window.PentagonServices.finance;
}

function makeLegacyFixture() {
  return {
    _lock_date: '',
    finance: {
      accounts: [
        { id: 'cash_workshop', code: '101000', name: 'Main Cash', type: 'asset', normal_side: 'debit', is_active: true },
        { id: 'receivables_customers', code: '103000', name: 'Receivables', type: 'asset', normal_side: 'debit', is_active: true },
        { id: 'payables_people', code: '201000', name: 'Payables', type: 'liability', normal_side: 'credit', is_active: true },
        { id: 'income_sales', code: '401000', name: 'Sales Income', type: 'income', normal_side: 'credit', is_active: true },
        { id: 'expense_general', code: '502000', name: 'General Expense', type: 'expense', normal_side: 'debit', is_active: true },
        { id: 'suspense', code: '100000', name: 'Suspense', type: 'asset', normal_side: 'debit', is_active: true },
      ],
      transactions: [],
    },
    journals: [
      { id: 'j_misc', code: 'MISC', name: 'Miscellaneous', type: 'general' },
      { id: 'j_bank', code: 'BANK', name: 'Bank', type: 'bank' },
      { id: 'j_sale', code: 'SALE', name: 'Sales', type: 'sale' },
    ],
    account_moves: [],
    journal_entries: [],
    account_payments: [],
    account_partial_reconciles: [],
  };
}

async function bootFinanceServer(suite) {
  const { dialect, dbPath } = await setup(suite);
  const org = seedOrg(dialect);
  seedChartOfAccounts(dialect, { companyId: 'c_alpha_1', userId: 'u_owner' });
  dialect.close();
  const jsonPath = tmpJsonPath(suite);
  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({ dbPath, jsonPath, port });
  const stop = async () => {
    await server.stop();
    for (const f of [jsonPath, jsonPath + '.prev']) { try { fs.unlinkSync(f); } catch { /* not present */ } }
    await cleanup(openMigrationDatabase(dbPath), dbPath).catch(() => {});
  };
  return { base, org, stop };
}

async function switchCompany(base, cookies, companyId) {
  const res = await realFetch(`${base}/api/auth/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ companyId }),
  });
  assert.strictEqual(res.status, 200, `context switch failed: ${res.status}`);
}

const MOVE_PAYLOAD = {
  journal_id: 'j_misc',
  move_type: 'entry',
  date: '2026-03-15',
  line_ids: [
    { account_id: 'expense_general', debit: 1000, credit: 0, label: 'parity expense' },
    { account_id: 'cash_workshop', debit: 0, credit: 1000, label: 'parity cash' },
  ],
};

async function testFlagOffLegacyPathUnchanged() {
  const fixture = makeLegacyFixture();
  installServiceShims({ base: 'http://127.0.0.1:1', cookies: '', fixtureDb: fixture, canonicalEnabled: false });
  const FinanceService = await loadFinanceService();
  const callsBefore = fetchCalls.length;

  const draft = await FinanceService.createMove({ ...MOVE_PAYLOAD, skip_backup: true });
  assert.strictEqual(draft.state, 'draft');
  const posted = await FinanceService.postMove(draft.id, { skip_backup: true });
  assert.strictEqual(posted.state, 'posted');
  assert.ok(posted.hash, 'legacy hash chain maintained');

  const stored = fixture.account_moves.find(m => m.id === draft.id);
  assert.ok(stored, 'legacy path writes the PentagonDB account_moves store');
  assert.strictEqual(stored.state, 'posted');

  const tb = await FinanceService.getTrialBalance();
  const expense = tb.find(r => r.code === '502000');
  const cash = tb.find(r => r.code === '101000');
  assert.strictEqual(Number(expense.total_debit), 1000);
  assert.strictEqual(Number(cash.total_credit), 1000);

  const financeApiCalls = fetchCalls.slice(callsBefore).filter(c => String(c.url).includes('/api/v1/'));
  assert.strictEqual(financeApiCalls.length, 0, 'flag OFF must not touch the canonical API');
  return { legacyTb: tb };
}

async function testFlagOnCanonicalPathAndParity() {
  const { base, org, stop } = await bootFinanceServer('finance-ui-parity-canonical');
  try {
    const { cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    await switchCompany(base, cookies, org.companyA1);
    const fixture = makeLegacyFixture();
    installServiceShims({ base, cookies, fixtureDb: fixture, canonicalEnabled: true });
    const FinanceService = await loadFinanceService();

    // The fail-closed approval policy is persisted by the bridge; configure the
    // acting user's limit through the governed action before posting.
    const limitRes = await globalThis.fetch('/api/v1/action/finance_authority_limit:set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_or_user: 'u_owner', limit_type: 'post', max_amount: 1000000000, idempotency_key: 'parity-limit-post-' + Date.now() }),
    });
    assert.strictEqual(limitRes.status, 200, `authority limit setup failed: ${limitRes.status} ${await limitRes.text().catch(() => '')}`);

    // (b) canonical create + post through the proxied service.
    const draft = await FinanceService.createMove({ ...MOVE_PAYLOAD, skip_backup: true });
    assert.ok(draft._canonical, 'move was produced by the canonical runtime');
    const posted = await FinanceService.postMove(draft.id, { skip_backup: true });
    assert.strictEqual(posted.state, 'posted');
    assert.strictEqual(fixture.account_moves.length, 0, 'canonical path must not write the legacy store');

    // Canonical readers through the proxied service.
    const fetched = await FinanceService.getMove(draft.id);
    assert.strictEqual(fetched.state, 'posted');
    const moves = await FinanceService.getMoves();
    assert.ok(moves.some(m => m.id === draft.id), 'canonical getMoves lists the posted document');

    const canonicalTb = await FinanceService.getTrialBalance();
    const expense = canonicalTb.find(r => r.code === '502000');
    const cash = canonicalTb.find(r => r.code === '101000');
    assert.strictEqual(Number(expense.total_debit), 1000);
    assert.strictEqual(Number(cash.total_credit), 1000);
    const sum = canonicalTb.reduce((acc, r) => acc + (Number(r.total_debit) - Number(r.total_credit)), 0);
    assert.ok(Math.abs(sum) < 0.0001, 'canonical trial balance balances');

    // (c) parity: the same entry on the legacy path yields identical totals.
    const legacyFixture = makeLegacyFixture();
    installServiceShims({ base: 'http://127.0.0.1:1', cookies: '', fixtureDb: legacyFixture, canonicalEnabled: false });
    const LegacyService = await loadFinanceService();
    const legacyDraft = await LegacyService.createMove({ ...MOVE_PAYLOAD, skip_backup: true });
    await LegacyService.postMove(legacyDraft.id, { skip_backup: true });
    const legacyTb = await LegacyService.getTrialBalance();
    for (const code of ['502000', '101000']) {
      const l = legacyTb.find(r => r.code === code);
      const c = canonicalTb.find(r => r.code === code);
      assert.deepStrictEqual(
        { debit: Number(l.total_debit), credit: Number(l.total_credit) },
        { debit: Number(c.total_debit), credit: Number(c.total_credit) },
        `trial-balance parity mismatch on account ${code}`,
      );
    }

    // Canonical payment through the proxied service (cash receive).
    installServiceShims({ base, cookies, fixtureDb: makeLegacyFixture(), canonicalEnabled: true });
    const PayService = await loadFinanceService();
    const paymentLimit = await globalThis.fetch('/api/v1/action/finance_authority_limit:set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_or_user: 'u_owner', limit_type: 'payment', max_amount: 1000000000, idempotency_key: 'parity-limit-pay-' + Date.now() }),
    });
    assert.strictEqual(paymentLimit.status, 200);
    const { payment, move } = await PayService.createPayment({
      amount: 250, payment_type: 'inbound', partner_type: 'customer', partner_id: 'cust_parity',
      date: '2026-03-16', cash_account_id: 'cash_workshop', destination_account_id: 'receivables_customers',
      memo: 'parity receipt', skip_backup: true,
    });
    assert.strictEqual(payment.state, 'posted');
    assert.strictEqual(move.state, 'posted');
    const tbAfterPayment = await PayService.getTrialBalance();
    const cashAfter = tbAfterPayment.find(r => r.code === '101000');
    // Original move credited cash 1000; the receipt debits cash 250.
    assert.strictEqual(Number(cashAfter.total_debit), 250);
    assert.strictEqual(Number(cashAfter.total_credit), 1000);

    // Canonical reversal through the proxied service.
    const { cancelled, reversal } = await PayService.cancelMove(draft.id, { skip_backup: true, reason: 'parity reversal' });
    assert.strictEqual(cancelled.state, 'cancel');
    assert.strictEqual(reversal.state, 'posted');
    const tbAfterReversal = await PayService.getTrialBalance();
    const expenseAfter = tbAfterReversal.find(r => r.code === '502000');
    assert.strictEqual(Number(expenseAfter.total_debit) - Number(expenseAfter.total_credit), 0, 'reversal nets the original entry to zero');
  } finally {
    await stop();
  }
}

async function testDenialsThroughProxiedPath() {
  const { base, org, stop } = await bootFinanceServer('finance-ui-parity-denial');
  try {
    // Unauthenticated: the proxied path surfaces the server 401.
    installServiceShims({ base, cookies: '', fixtureDb: makeLegacyFixture(), canonicalEnabled: true });
    const AnonService = await loadFinanceService();
    await assert.rejects(
      () => AnonService.createMove({ ...MOVE_PAYLOAD, skip_backup: true }),
      (err) => { assert.strictEqual(err.status, 401, `expected 401, got ${err.status}: ${err.message}`); return true; },
    );

    // Authenticated without the finance grant: 403.
    const { cookies } = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    await switchCompany(base, cookies, org.companyA1);
    installServiceShims({ base, cookies, fixtureDb: makeLegacyFixture(), canonicalEnabled: true });
    const ClerkService = await loadFinanceService();
    await assert.rejects(
      () => ClerkService.createMove({ ...MOVE_PAYLOAD, skip_backup: true }),
      (err) => { assert.strictEqual(err.status, 403, `expected 403, got ${err.status}: ${err.message}`); return true; },
    );
  } finally {
    await stop();
  }
}

await run('Phase 03 / finance UI-service parity', [
  ['flag OFF preserves the legacy path (no canonical API calls)', testFlagOffLegacyPathUnchanged],
  ['flag ON executes through the canonical runtime with trial-balance parity', testFlagOnCanonicalPathAndParity],
  ['proxied path surfaces 401/403 denials', testDenialsThroughProxiedPath],
]);
