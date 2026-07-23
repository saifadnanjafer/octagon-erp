// Phase 03 closure repair — governed finance runtime over HTTP.
//
// Proves, over real HTTP against the real server.js on a disposable database:
//   (a) an authenticated, authorized principal can execute governed finance
//       actions (finance_account:create, finance_document:create/submit/approve/
//       post) and read the results back through the canonical finance query
//       routes (GET /api/v1/finance/accounts|documents|trial-balance);
//   (b) unauthenticated requests are denied (401);
//   (c) authenticated principals without the finance permission are denied by
//       the API itself (403) — a peer holding only platform:db:write /
//       platform:db:read is rejected on finance_account:create, and a principal
//       with no grants is rejected on the finance query routes;
//   (d) cross-company isolation holds through the HTTP path: records created in
//       c_alpha_1 are invisible from c_alpha_2 after a governed context switch.
//
// Harness pattern follows tests/phase02/runtime-integration.test.mjs: every
// test boots the real server on a disposable SQLite database (never
// database.db) and a random port.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, cleanup, run, seedOrg, STRONG_PASSWORD } from '../phase02/harness.mjs';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { seedChartOfAccounts } from '../../platform/finance/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

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
        const res = await fetch(`http://127.0.0.1:${port}/api/server/status`);
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
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password, tenantId }),
  });
  const payload = await res.json().catch(() => ({}));
  const cookies = res.headers.get('set-cookie') || '';
  return { res, payload, cookies };
}

async function withCookie(base, cookies, method, path, body, extraHeaders = {}) {
  const opts = { method, headers: { Cookie: cookies, ...extraHeaders } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const payload = await res.json().catch(() => ({}));
  return { res, payload };
}

let idemCounter = 0;
function postAction(base, cookies, actionId, body) {
  idemCounter += 1;
  return withCookie(base, cookies, 'POST', `/api/v1/action/${actionId}`, body, {
    'x-idempotency-key': `p03-http-${process.pid}-${idemCounter}`,
  });
}

/** Give u_clerk a role holding ONLY platform:db:write + platform:db:read. */
function seedApiWriterRole(dialect) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES ('role_api_writer', 'default', 'api_writer', 'كاتب API', 0, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now, now);
  const grant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, 'role_api_writer', ?, 'allow', 'all', '[]', 0, ?, 'phase03_http_test')
    ON CONFLICT DO NOTHING
  `);
  grant.run('grant_api_writer_db_write', 'platform:db:write', now);
  grant.run('grant_api_writer_db_read', 'platform:db:read', now);
  dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_u_clerk_api_writer', 'u_clerk', 'user', 'role_api_writer', NULL, 'active', ?, 'phase03_http_test')
    ON CONFLICT DO NOTHING
  `).run(now);
}

async function bootFinanceServer(suite, { companies = ['c_alpha_1'], clerkRole = false } = {}) {
  const { dialect, dbPath } = await setup(suite);
  const org = seedOrg(dialect);
  for (const companyId of companies) {
    seedChartOfAccounts(dialect, { companyId, userId: 'u_owner' });
  }
  if (clerkRole) seedApiWriterRole(dialect);
  dialect.close();
  const jsonPath = tmpJsonPath(suite);
  const port = 18380 + Math.floor(Math.random() * 1000);
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
  const switched = await withCookie(base, cookies, 'POST', '/api/auth/context', { companyId });
  assert.strictEqual(switched.res.status, 200, `context switch to ${companyId} failed: ${switched.payload.error || switched.res.status}`);
}

async function createAndPostDocument(base, cookies, { expenseId, cashId }) {
  const created = await postAction(base, cookies, 'finance_document:create', {
    move_type: 'manual_entry',
    doc_date: '2026-03-15',
    lines: [
      { account_id: expenseId, debit: 1000, credit: 0 },
      { account_id: cashId, debit: 0, credit: 1000 },
    ],
  });
  assert.strictEqual(created.res.status, 200, `finance_document:create failed: ${created.payload.error || created.res.status}`);
  const docId = created.payload.data.id;
  // The fail-closed approval policy is persisted by the bridge; configure the
  // acting user's limit through the governed action before posting.
  const limit = await postAction(base, cookies, 'finance_authority_limit:set', {
    role_or_user: 'u_owner', limit_type: 'post', max_amount: 1000000000,
  });
  assert.strictEqual(limit.res.status, 200, `finance_authority_limit:set failed: ${limit.payload.error || limit.res.status}`);
  let posted;
  for (const step of ['submit', 'approve', 'post']) {
    const r = await postAction(base, cookies, `finance_document:${step}`, { document_id: docId });
    assert.strictEqual(r.res.status, 200, `finance_document:${step} failed: ${r.payload.error || r.res.status}`);
    posted = r.payload.data;
  }
  return { docId, posted };
}

async function testAuthorizedFinanceActionsAndQueries() {
  const { base, org, stop } = await bootFinanceServer('finance-http-authorized');
  try {
    const { res, cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(res.status, 200, 'owner login failed');
    await switchCompany(base, cookies, org.companyA1);

    // Governed action over HTTP: create an account through the shared executor.
    const created = await postAction(base, cookies, 'finance_account:create', {
      code: '199000', name: 'HTTP Clearing', type: 'asset',
    });
    assert.strictEqual(created.res.status, 200, `finance_account:create failed: ${created.payload.error || created.res.status}`);
    assert.strictEqual(created.payload.success, true);
    assert.strictEqual(created.payload.data.code, '199000');

    // Canonical query surface: the new account is readable back.
    const accounts = await withCookie(base, cookies, 'GET', '/api/v1/finance/accounts');
    assert.strictEqual(accounts.res.status, 200, `GET finance/accounts failed: ${accounts.payload.error || accounts.res.status}`);
    const codes = accounts.payload.data.map((a) => a.code);
    assert.ok(codes.includes('199000'), 'created account missing from finance/accounts');
    const cash = accounts.payload.data.find((a) => a.code === '101000');
    const expense = accounts.payload.data.find((a) => a.code === '502000');
    assert.ok(cash && expense, 'seeded COA accounts missing from finance/accounts');

    // Full governed document lifecycle over HTTP: create -> submit -> approve -> post.
    const createdDoc = await postAction(base, cookies, 'finance_document:create', {
      move_type: 'manual_entry',
      doc_date: '2026-03-15',
      lines: [
        { account_id: expense.id, debit: 1000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 1000 },
      ],
    });
    assert.strictEqual(createdDoc.res.status, 200, `finance_document:create failed: ${createdDoc.payload.error || createdDoc.res.status}`);
    const docId = createdDoc.payload.data.id;
    assert.strictEqual(createdDoc.payload.data.state, 'draft');

    // Fail-closed approval authority over HTTP: the bridge persists
    // finance.approval_authority.fail_closed=true, so posting without a
    // configured authority limit for the acting user must be denied (4xx with
    // the machine code), not silently allowed and not a masked 500.
    for (const step of ['submit', 'approve']) {
      const r = await postAction(base, cookies, `finance_document:${step}`, { document_id: docId });
      assert.strictEqual(r.res.status, 200, `finance_document:${step} failed: ${r.payload.error || r.res.status}`);
    }
    const deniedPost = await postAction(base, cookies, 'finance_document:post', { document_id: docId });
    assert.strictEqual(deniedPost.res.status, 403, `expected 403 fail-closed denial, got ${deniedPost.res.status}: ${deniedPost.payload.error}`);
    assert.ok(String(deniedPost.payload.error).includes('AUTHORITY_LIMIT_MISSING'), `expected AUTHORITY_LIMIT_MISSING, got: ${deniedPost.payload.error}`);

    // Configure the authority limit through the governed action, then posting succeeds.
    const limit = await postAction(base, cookies, 'finance_authority_limit:set', {
      role_or_user: 'u_owner', limit_type: 'post', max_amount: 1000000000,
    });
    assert.strictEqual(limit.res.status, 200, `finance_authority_limit:set failed: ${limit.payload.error || limit.res.status}`);
    const postedRes = await postAction(base, cookies, 'finance_document:post', { document_id: docId });
    assert.strictEqual(postedRes.res.status, 200, `finance_document:post failed: ${postedRes.payload.error || postedRes.res.status}`);
    assert.strictEqual(postedRes.payload.data.state, 'posted');
    assert.ok(postedRes.payload.data.doc_number, 'posted document has no doc_number');

    // Query the document back through the canonical read routes.
    const documents = await withCookie(base, cookies, 'GET', '/api/v1/finance/documents');
    assert.strictEqual(documents.res.status, 200);
    const listed = documents.payload.data.find((d) => d.id === docId);
    assert.ok(listed, 'posted document missing from finance/documents');
    assert.strictEqual(listed.state, 'posted');

    const detail = await withCookie(base, cookies, 'GET', `/api/v1/finance/documents/${docId}`);
    assert.strictEqual(detail.res.status, 200);
    assert.strictEqual(detail.payload.data.lines.length, 2);

    const trial = await withCookie(base, cookies, 'GET', '/api/v1/finance/trial-balance');
    assert.strictEqual(trial.res.status, 200);
    const expenseRow = trial.payload.data.find((r) => r.account_id === expense.id);
    const cashRow = trial.payload.data.find((r) => r.account_id === cash.id);
    assert.strictEqual(Number(expenseRow.total_debit), 1000);
    assert.strictEqual(Number(cashRow.total_credit), 1000);
  } finally {
    await stop();
  }
}

async function testUnauthenticatedRequestsAreDenied() {
  const { base, stop } = await bootFinanceServer('finance-http-anon');
  try {
    const action = await fetch(`${base}/api/v1/action/finance_account:create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-idempotency-key': `p03-anon-${process.pid}` },
      body: JSON.stringify({ code: '199999', name: 'Anon', type: 'asset' }),
    });
    assert.strictEqual(action.status, 401, `expected 401 for unauthenticated action, got ${action.status}`);

    for (const route of ['/api/v1/finance/accounts', '/api/v1/finance/documents', '/api/v1/finance/trial-balance']) {
      const res = await fetch(`${base}${route}`);
      assert.strictEqual(res.status, 401, `expected 401 for unauthenticated ${route}, got ${res.status}`);
    }
  } finally {
    await stop();
  }
}

async function testPrincipalWithoutFinancePermissionIsDenied() {
  const { base, org, stop } = await bootFinanceServer('finance-http-denied', { clerkRole: true });
  try {
    // u_clerk holds platform:db:write + platform:db:read but NO finance grant.
    const { res, cookies } = await login(base, 'clerk', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(res.status, 200, 'clerk login failed');
    await switchCompany(base, cookies, org.companyA1);

    // Prove the role's grants are live: db:read-gated routes work for clerk.
    const meta = await withCookie(base, cookies, 'GET', '/api/v1/meta/entities');
    assert.strictEqual(meta.res.status, 200, `clerk should hold platform:db:read, got ${meta.res.status}`);

    // The finance action is denied by the API itself: platform:db:write passes,
    // the action's declared required_permission (finance_account:create) fails.
    const denied = await postAction(base, cookies, 'finance_account:create', {
      code: '199888', name: 'Clerk Attempt', type: 'asset',
    });
    assert.strictEqual(denied.res.status, 403, `expected 403 for clerk finance action, got ${denied.res.status}`);
    assert.strictEqual(denied.payload.success, false);

    // A principal with no grants at all is denied on the finance query routes.
    // (Outsider's only membership is c_alpha_2; switch there so a context can
    // be built at all — the denial must come from permission evaluation, not
    // from a missing membership.)
    const outsider = await login(base, 'outsider', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(outsider.res.status, 200, 'outsider login failed');
    await switchCompany(base, outsider.cookies, org.companyA2);
    const query = await withCookie(base, outsider.cookies, 'GET', '/api/v1/finance/accounts');
    assert.strictEqual(query.res.status, 403, `expected 403 for outsider finance query, got ${query.res.status}`);
  } finally {
    await stop();
  }
}

async function testCrossCompanyIsolationOverHttp() {
  const { base, org, stop } = await bootFinanceServer('finance-http-isolation', { companies: ['c_alpha_1', 'c_alpha_2'] });
  try {
    const { res, cookies } = await login(base, 'owner', STRONG_PASSWORD, org.tenantA);
    assert.strictEqual(res.status, 200, 'owner login failed');
    await switchCompany(base, cookies, org.companyA1);

    const created = await postAction(base, cookies, 'finance_account:create', {
      code: '199001', name: 'Isolation Probe', type: 'asset',
    });
    assert.strictEqual(created.res.status, 200, `setup action failed: ${created.payload.error || created.res.status}`);

    const inA1 = await withCookie(base, cookies, 'GET', '/api/v1/finance/accounts');
    assert.ok(inA1.payload.data.some((a) => a.code === '199001'), 'account missing in its own company');

    // Post a document in c_alpha_1 so document-level isolation is exercised too.
    const cashA1 = inA1.payload.data.find((a) => a.code === '101000');
    const expenseA1 = inA1.payload.data.find((a) => a.code === '502000');
    const { docId } = await createAndPostDocument(base, cookies, { expenseId: expenseA1.id, cashId: cashA1.id });

    // Switch to the sibling company: c_alpha_1 records must be invisible.
    await switchCompany(base, cookies, org.companyA2);
    const inA2 = await withCookie(base, cookies, 'GET', '/api/v1/finance/accounts');
    assert.strictEqual(inA2.res.status, 200);
    assert.ok(!inA2.payload.data.some((a) => a.code === '199001'), 'cross-company account leaked through finance/accounts');
    assert.ok(inA2.payload.data.some((a) => a.code === '101000'), 'sibling company COA should still be visible');

    const docsA2 = await withCookie(base, cookies, 'GET', '/api/v1/finance/documents');
    assert.strictEqual(docsA2.res.status, 200);
    assert.ok(!docsA2.payload.data.some((d) => d.id === docId), 'cross-company document leaked through finance/documents');

    const detail = await withCookie(base, cookies, 'GET', `/api/v1/finance/documents/${docId}`);
    assert.strictEqual(detail.res.status, 404, `cross-company document read should 404, got ${detail.res.status}`);

    const trialA2 = await withCookie(base, cookies, 'GET', '/api/v1/finance/trial-balance');
    assert.strictEqual(trialA2.res.status, 200);
    assert.ok(!trialA2.payload.data.some((r) => r.account_id === expenseA1.id), 'cross-company balance leaked through trial-balance');
  } finally {
    await stop();
  }
}

await run('Phase 03 / finance HTTP API', [
  ['authorized principal executes finance actions and queries them back', testAuthorizedFinanceActionsAndQueries],
  ['unauthenticated requests are denied', testUnauthenticatedRequestsAreDenied],
  ['principal without finance permission is denied by the API', testPrincipalWithoutFinancePermissionIsDenied],
  ['cross-company isolation holds over HTTP', testCrossCompanyIsolationOverHttp],
]);
