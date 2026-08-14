import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.resolve(ROOT, '..', '..');
const CATALOG_BASELINE = '10152af1772bf9efba43cc42bb4226b73b63abca';
const ENGINEERING_REFERENCE = '25c24df753962bbf3c13301eed71624bc0ee39b6';
const DATE = '2026-08-14';

const groups = {
  finance: {
    domain: 'platform/finance/engine.mjs; platform/finance/index.mjs; platform/api/finance.mjs',
    api: 'GET /api/v1/finance/*; POST /api/v1/action/finance:*',
    tables: ['finance_documents', 'finance_document_lines', 'finance_journal_entries', 'finance_journal_lines', 'finance_periods', 'finance_locks', 'finance_payments'],
    authority: 'Finance engine is the canonical accounting authority and sole GL writer.',
    upstream: ['posted source facts', 'company/branch/period scope'],
    downstream: ['AR/AP', 'treasury', 'reports', 'tax/compliance'],
    states: 'LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, POSTED, REVERSED',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN',
    gaps: [['P1', 'CREDIBILITY_GAP', 'The navigation destination exists, but page-specific API/action wiring is not established by the selected evidence.', 'Recover the renderer-to-domain contract and attach a direct lifecycle with company, period, and role isolation.']],
    tests: ['tests/phase03/finance-http-api.test.mjs', 'tests/phase03/finance-closure-audit.test.mjs'],
  },
  legacyFinance: {
    domain: 'platform/finance/engine.mjs; app.js legacy finance helpers',
    api: 'No page-specific /api/v1 route verified; local finance state and FinanceService candidates',
    tables: ['finance.transactions local object', 'account_moves canonical candidate', 'finance_documents canonical candidate'],
    authority: 'Finance engine should own posted facts; current legacy page surface is not a safe independent writer.',
    upstream: ['local finance object', 'manual entry or imported source'], downstream: ['cashbox', 'income/expense reporting', 'Finance candidate'],
    states: 'LOCAL_DRAFT, LOCAL_SAVED, POSTED_NOT_VERIFIED, DENIED_NOT_VERIFIED',
    status: 'PARTIALLY_CONNECTED', usability: 'THIN', disposition: 'RETIRE_OR_MIGRATE',
    gaps: [['P0', 'AUTHORITY_CONFLICT', 'The legacy page can use local finance helpers while Finance engine owns documents, journals, and hash-chain posting.', 'Freeze or migrate the writer through an idempotent Finance source-fact contract.'], ['P1', 'ISOLATION_GAP', 'Company, branch, period, actor, and audit scope are not proven for the local page surface.', 'Add scoped browser/API evidence before allowing operational use.']],
    tests: ['tests/phase03/finance-browser-evidence.test.mjs', 'tests/phase03/finance-final-cutover.test.mjs'],
  },
  consolidation: {
    domain: 'platform/consolidation/index.mjs; platform/finance/engine.mjs',
    api: 'GET /api/v1/finance/*; consolidation page-specific route NOT VERIFIED',
    tables: ['finance_consolidation_groups', 'finance_consolidation_runs', 'finance_elimination_entries', 'finance_lineage_links', 'finance_documents'],
    authority: 'Consolidation domain should own group, run, elimination, and lineage state; Finance owns source journals.',
    upstream: ['company/group hierarchy', 'posted company ledgers', 'account mapping'], downstream: ['consolidated reports', 'audit lineage', 'management decisions'],
    states: 'DRAFT, READY, RUNNING, COMPLETED, FAILED, REVERSED, DENIED, NOT_VERIFIED',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN',
    gaps: [['P1', 'CREDIBILITY_GAP', 'The consolidation domain and tests exist, but the individual primary pages do not show a verified renderer/action/API contract.', 'Map each page to one read or mutation boundary and prove run idempotency and source lineage.'], ['P2', 'PURPOSE_UNCLEAR', 'Groups, runs, reports, lineage, and eliminations are adjacent pages with incomplete user-goal separation.', 'Publish a bounded page hierarchy and keep one canonical write home per capability.']],
    tests: ['tests/build-08/consolidation-domain.test.mjs', 'tests/build-08/group-finance-browser-chromium.test.mjs', 'tests/page-consolidation/consolidation-contract.test.mjs'],
  },
  treasury: {
    domain: 'platform/finance/planning-treasury-intercompany.mjs; platform/treasury/liquidity.mjs',
    api: 'GET /api/v1/finance/*; treasury page-specific route NOT VERIFIED',
    tables: ['finance_cash_positions', 'finance_liquidity_forecasts', 'finance_treasury_alerts', 'finance_funding_proposals', 'finance_facilities'],
    authority: 'Treasury planning domain owns forecasts, funding proposals, facilities, alerts, and cash position views; Finance owns posted cash facts.',
    upstream: ['posted finance cash facts', 'open AR/AP', 'bank feeds/manual cash data'], downstream: ['payment funding', 'cash management', 'management reporting'],
    states: 'DRAFT, FORECAST, PROPOSED, APPROVED, EXECUTED, EXPIRED, ALERT, NOT_VERIFIED',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN',
    gaps: [['P1', 'WORKFLOW_DISCONNECT', 'Treasury domain sources exist, but the page-level link from forecast/proposal to an authorized payment or Finance result is not verified.', 'Define proposal approval, execution, and source-fact references.'], ['P2', 'CREDIBILITY_GAP', 'Freshness, currency, company scope, and missing-data behavior are not established for the individual page.', 'Add explicit as-of, currency, stale-data, and empty states.']],
    tests: ['tests/build-08/treasury-liquidity-domain.test.mjs', 'tests/build-08/planning-finance-lifecycle.test.mjs'],
  },
  intercompany: {
    domain: 'platform/intercompany/operations.mjs; platform/finance/planning-treasury-intercompany.mjs',
    api: 'GET /api/v1/finance/*; intercompany page-specific route NOT VERIFIED',
    tables: ['intercompany_transactions', 'intercompany_mismatches', 'intercompany_reconciliations', 'finance_documents', 'finance_lineage_links'],
    authority: 'Intercompany operations owns agreement, mismatch, and reconciliation workflow; Finance owns each company ledger posting.',
    upstream: ['company pair/group configuration', 'source company entries'], downstream: ['consolidation runs', 'eliminations', 'finance corrections'],
    states: 'DRAFT, SENT, RECEIVED, MATCHED, MISMATCH, RECONCILED, REJECTED, NOT_VERIFIED',
    status: 'THIN', usability: 'THIN', disposition: 'STRENGTHEN',
    gaps: [['P1', 'WORKFLOW_DISCONNECT', 'The intercompany domain and tests exist, but page-level transaction-to-mismatch-to-reconciliation evidence is not attributed.', 'Prove the complete pair-scoped lifecycle and its Finance posting/lineage references.'], ['P2', 'ISOLATION_GAP', 'Company-pair access and cross-company authorization are not proven by navigation evidence.', 'Add role and company-pair isolation tests.']],
    tests: ['tests/build-08/intercompany-operations-domain.test.mjs', 'tests/build-08/consolidation-domain.test.mjs'],
  },
  workflow: {
    domain: 'platform/workflow/index.mjs; app.js workflow canvas helpers',
    api: 'POST /api/v1/action/workflow:* candidate; local canvas compatibility path',
    tables: ['workflow_definitions', 'workflow_versions', 'workflow_instances', 'workflow_steps', 'workflow_timers', 'workflow_audit_log', 'localStorage workflow_viewport_v1'],
    authority: 'Durable WorkflowRegistry/WorkflowRuntime should own definitions and instances; the legacy canvas is a compatibility adapter only.',
    upstream: ['registered actions', 'permissions', 'workflow canvas definition'], downstream: ['approved target actions', 'outbox/external effects', 'audit'],
    states: 'DRAFT, ACTIVE, WAITING, RUNNING, COMPLETED, FAILED, CANCELLED, RETIRED, DENIED, VALIDATION_ERROR',
    status: 'PARTIALLY_CONNECTED', usability: 'USABLE', disposition: 'CONSOLIDATE_WITH_CANONICAL_RUNTIME',
    gaps: [['P0', 'AUTHORITY_CONFLICT', 'The page exposes a local canvas and localStorage compatibility surface beside a durable workflow registry/runtime with versioning and leases.', 'Make the canvas an explicit adapter and prove definition/version/instance persistence through the durable runtime.'], ['P1', 'WORKFLOW_DISCONNECT', 'Workflow execution can reference registered actions, but page-level publication-to-run evidence and frozen-entity enforcement are not proven together.', 'Attach validation, activation, run, retry, timeout, and frozen-zone browser/API evidence.']],
    tests: ['tests/phase02/workflow-approvals.test.mjs'],
  },
  tax: {
    domain: 'platform/finance/engine.mjs; platform/finance/index.mjs; modules/tax-compliance.js',
    api: 'GET /api/v1/finance/*; POST /api/v1/action/finance:*',
    tables: ['finance_documents', 'finance_document_lines', 'finance_tax_rates', 'finance_tax_reports', 'finance_periods'],
    authority: 'Finance tax computation and posting own tax facts; the tax page presents compliance workflow and reports.',
    upstream: ['posted invoices/bills', 'tax configuration', 'period state'], downstream: ['tax reports', 'filings/export', 'Finance reversals/corrections'],
    states: 'DRAFT, CALCULATED, REVIEW, SUBMITTED, ACCEPTED, REJECTED, AMENDED, DENIED',
    status: 'PARTIALLY_CONNECTED', usability: 'USABLE', disposition: 'KEEP_PRIMARY',
    gaps: [['P1', 'CREDIBILITY_GAP', 'The tax renderer and Finance authority are present, but direct tax-period/report submission persistence is not fully attributed.', 'Prove tax calculation, review, submit, amend, and source-document lineage.']],
    tests: ['tests/phase03/finance-http-api.test.mjs', 'tests/phase03/finance-ui-parity.test.mjs'],
  },
  service: {
    domain: 'platform/kiosk/index.mjs; platform/kiosk/kiosk-registry.mjs; platform/kiosk/operational-boards.mjs; platform/service/index.mjs',
    api: 'GET /api/v1/service/* and kiosk resources; exact page route NOT VERIFIED',
    tables: ['kiosk_device_registries', 'offline_clients', 'service_entitlements', 'service_signatures', 'operational_board_events'],
    authority: 'Kiosk registry and service entitlement/signature domains own device/session/access facts; operational boards consume them.',
    upstream: ['device registration', 'identity/entitlement', 'offline sync state'], downstream: ['shop-floor/warehouse/service actions', 'audit', 'offline export'],
    states: 'UNREGISTERED, REGISTERED, ONLINE, OFFLINE, READY, BLOCKED, EXPIRED, DENIED, NOT_VERIFIED',
    status: 'CONNECTED', usability: 'STRONG', disposition: 'KEEP_PRIMARY',
    gaps: [['P1', 'WORKFLOW_DISCONNECT', 'Kiosk domain/tests prove operational lifecycle components, but the selected page-level service route and downstream work completion are not attributed as one flow.', 'Prove register/entitle/offline/restore and one service action handoff.']],
    tests: ['tests/build-07/service-browser-chromium.test.mjs', 'tests/build-07/service-entitlement-signature-lifecycle.test.mjs', 'tests/build-10/kiosk-operational-boards.test.mjs', 'tests/build-10/iot-offline-kiosk-export-contract.test.mjs'],
  },
};

const pageDefs = {
  account_mapping: { group: 'consolidation', goal: 'A finance administrator opens Account Mapping to define or review how source-company accounts map into group reporting accounts before consolidation.', view: 'views/account_mapping.html', tables: ['finance_account_mappings', 'finance_accounts'], actions: ['Create/update mapping -> page action/API NOT VERIFIED', 'Validate mapping -> consolidation readiness NOT VERIFIED'] },
  banking: { group: 'finance', goal: 'A finance user opens Banking to review bank accounts, imported or entered bank activity, and reconciliation context without creating a second cash authority.', view: 'views/banking.html', tables: ['finance_bank_accounts', 'finance_bank_transactions', 'finance_reconciliations'], actions: ['View/import/reconcile -> exact page action/API NOT VERIFIED'] },
  budgeting: { group: 'finance', goal: 'A manager opens Budgeting to create, submit, approve, revise, and monitor budget lines and variance against governed Finance or Project dimensions.', module: 'modules/budgeting.js', view: 'views/budgeting.html', tables: ['finance_budgets', 'finance_budget_lines', 'finance_budget_variances'], actions: ['Create/submit/approve/reject/revise -> finance:budget:*', 'View variance -> finance budget query'] },
  cashbox: { group: 'legacyFinance', goal: 'A cashier opens Cashbox to inspect daily cash movement, receipts, payments, and the current balance with a clear distinction between legacy rows and the canonical ledger.', view: 'views/cashbox.html', tables: ['finance.transactions local object', 'account_moves', 'finance_documents'], actions: ['Create/edit cash transaction -> local addFinanceTransaction', 'View balance -> app.js getCashBalance/account_moves candidate'] },
  consolidated_reports: { group: 'consolidation', goal: 'A group finance user opens Consolidated Reports to view group-level financial results with period, company, currency, and lineage context.', view: 'views/consolidated_reports.html', actions: ['Run/view/export report -> page API/persistence NOT VERIFIED'] },
  consolidation_groups: { group: 'consolidation', goal: 'A group administrator opens Consolidation Groups to define company membership, reporting currency, and consolidation scope.', view: 'views/consolidation_groups.html', actions: ['Create/update group -> page API/persistence NOT VERIFIED'] },
  consolidation_lineage: { group: 'consolidation', goal: 'An auditor opens Consolidation Lineage to trace a group result back to source-company journal and elimination facts.', view: 'views/consolidation_lineage.html', actions: ['Trace source -> lineage query NOT VERIFIED', 'Open source document -> route/API NOT VERIFIED'] },
  consolidation_runs: { group: 'consolidation', goal: 'A group accountant opens Consolidation Runs to prepare, execute, inspect, and rerun a governed consolidation close.', view: 'views/consolidation_runs.html', kind: 'TRANSACTION', actions: ['Create/run/reverse consolidation -> page action/API NOT VERIFIED'] },
  content_approvals: { group: 'workflow', goal: 'A content owner opens Content Approvals to submit and review content decisions with a durable approval record rather than an informal local status.', view: 'views/approvals.html', tables: ['approval_requests', 'approval_steps', 'approval_events'], actions: ['Submit/approve/reject content -> approval action target NOT VERIFIED'], status: 'THIN', usability: 'THIN', disposition: 'OWNER_DECISION_REQUIRED' },
  eliminations: { group: 'consolidation', goal: 'A group accountant opens Eliminations to review and govern intercompany elimination entries before consolidated reporting.', view: 'views/eliminations.html', actions: ['Create/review/post elimination -> page API/persistence NOT VERIFIED'] },
  expenses: { group: 'legacyFinance', goal: 'An employee or manager opens Expenses to submit, review, approve, and account for an expense claim through the canonical Finance source-fact boundary.', view: 'views/expenses.html', tables: ['finance.transactions local object', 'expense_claims candidate', 'finance_documents'], actions: ['Create/edit/approve expense -> local or Finance action NOT VERIFIED'] },
  financing_facilities: { group: 'treasury', goal: 'A treasury user opens Financing Facilities to maintain approved credit or funding facilities, limits, terms, and utilization.', view: 'views/financing_facilities.html', actions: ['Create/approve/draw/close facility -> page action/API NOT VERIFIED'] },
  income: { group: 'legacyFinance', goal: 'A finance user opens Income to review income receipts and categories while preserving Finance document/source ownership.', view: 'views/income.html', tables: ['finance.transactions local object', 'finance_documents', 'finance_document_lines'], actions: ['Create/edit income -> local addFinanceTransaction', 'View totals -> local summary and Finance candidate'] },
  intercompany_reconciliation: { group: 'intercompany', goal: 'An intercompany accountant opens Reconciliation to resolve matched, mismatched, and accepted cross-company transactions with audit evidence.', view: 'views/intercompany_reconciliation.html', actions: ['Match/accept/reject/reconcile -> page action/API NOT VERIFIED'] },
  intercompany_transactions: { group: 'intercompany', goal: 'An intercompany accountant opens Transactions to create or review cross-company charges, reciprocal entries, and source references.', view: 'views/intercompany_transactions.html', actions: ['Create/send/accept transaction -> page action/API NOT VERIFIED'] },
  liquidity_forecast: { group: 'treasury', goal: 'A treasury manager opens Liquidity Forecast to inspect projected cash availability from open items, commitments, and funding assumptions.', view: 'views/liquidity_forecast.html', kind: 'ANALYTICS', actions: ['Build/refresh/export forecast -> page API/persistence NOT VERIFIED'] },
  mismatch_queue: { group: 'intercompany', goal: 'An intercompany accountant opens Mismatch Queue to prioritize unresolved cross-company differences and route them to reconciliation.', view: 'views/mismatch_queue.html', kind: 'QUEUE', actions: ['Filter/assign/resolve mismatch -> page action/API NOT VERIFIED'] },
  payment_funding_proposals: { group: 'treasury', goal: 'A treasury manager opens Payment Funding Proposals to review proposed funding sources for due payments and approve an executable funding decision.', view: 'views/payment_funding_proposals.html', kind: 'TRANSACTION', actions: ['Create/review/approve proposal -> page action/API NOT VERIFIED'] },
  service_kiosk: { group: 'service', goal: 'A service operator opens Service Kiosk to use a governed device/session for service work while enforcing entitlement, offline, and audit boundaries.', view: 'views/kiosk.html', actions: ['Register/activate/offline-sync -> kiosk/service action boundary; exact page route NOT VERIFIED'] },
  employee_kiosk: { group: 'service', goal: 'An employee opens Employee Kiosk to authenticate a governed kiosk session and complete the permitted attendance or work interaction without bypassing identity and audit controls.', view: 'views/kiosk.html', kind: 'KIOSK', actions: ['Start/close employee session -> kiosk identity/action boundary; exact page route NOT VERIFIED'] },
  warehouse_kiosk: { group: 'service', goal: 'A warehouse operator opens Warehouse Kiosk to use a registered warehouse device for scoped operational work and offline recovery.', view: 'views/kiosk.html', kind: 'KIOSK', actions: ['Start warehouse session/offline sync -> kiosk operational-board boundary; exact page route NOT VERIFIED'] },
  kiosk_device_registry: { group: 'service', goal: 'An administrator opens Kiosk Device Registry to register, revoke, and inspect device identity, entitlement, and offline-client status.', view: 'views/kiosk.html', kind: 'SETUP', actions: ['Register/revoke/rotate device -> kiosk-registry action boundary; exact page route NOT VERIFIED'] },
  tax_compliance: { group: 'tax', goal: 'A tax user opens Tax Compliance to review tax configuration, calculate/report obligations, submit a filing package, and preserve source-document lineage.', module: 'modules/tax-compliance.js', view: 'views/tax_compliance.html', actions: ['Calculate/review/submit/amend -> finance tax action boundary'] },
  treasury_alerts: { group: 'treasury', goal: 'A treasury manager opens Treasury Alerts to review cash, liquidity, funding, and stale-data exceptions with actionable severity and ownership.', view: 'views/treasury_alerts.html', actions: ['Acknowledge/assign/resolve alert -> page action/API NOT VERIFIED'] },
  treasury_cash_position: { group: 'treasury', goal: 'A treasury manager opens Cash Position to view current cash by account/company/currency and reconcile the figure to posted Finance facts.', view: 'views/treasury_cash_position.html', kind: 'DASHBOARD', actions: ['Refresh/filter/export cash position -> page API/persistence NOT VERIFIED'] },
  workflow: { group: 'workflow', goal: 'An operations administrator opens Workflow to define, validate, publish, monitor, and safely execute governed workflows through the durable runtime.', module: 'app.js', view: 'views/workflow.html', actions: ['Create/edit/validate/publish/run -> workflow canvas compatibility and durable runtime boundaries'] },
};

const q = (v) => JSON.stringify(v);
const safe = (v) => String(v).replace(/\\/g, '/');
const exactSource = (s) => /^(app\.js|modules|views|platform|tests)\/?.*\.(?:js|mjs|html|json)$/.test(s);
const sourceExists = (source) => { try { execFileSync('git', ['cat-file', '-e', `${ENGINEERING_REFERENCE}:${source}`], { cwd: CATALOG, stdio: 'ignore' }); return true; } catch { return false; } };
const readFm = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const body = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const out = {};
  for (const line of body.split('\n')) { const m = line.match(/^([a-z_]+):\s*(.*)$/); if (!m) continue; try { out[m[1]] = JSON.parse(m[2]); } catch { out[m[1]] = m[2].replace(/^"|"$/g, ''); } }
  return out;
};
const replaceSection = (file, marker, content) => {
  const target = path.join(ROOT, file);
  const old = fs.readFileSync(target, 'utf8');
  const start = old.indexOf(marker);
  const prefix = start >= 0 ? old.slice(0, start).trimEnd() : old.trimEnd();
  fs.writeFileSync(target, `${prefix}\n\n${content.trim()}\n`);
};

const specs = fs.readdirSync(ROOT, { recursive: true }).filter((f) => f.endsWith('.md') && !/^(README|INDEX|COVERAGE|CROSS_PAGE_CONTRADICTIONS|ENGINEERING_HANDOFF|STALE_SPEC_RECONCILIATION|BUSINESS_FLOW_MAP|CANONICAL_AUTHORITY_MAP)\.md$/.test(path.basename(f)));
const byId = new Map(specs.map((file) => [readFm(path.join(ROOT, file)).page_id, { file, fm: readFm(path.join(ROOT, file)) }]));

for (const [id, def] of Object.entries(pageDefs)) {
  const prior = byId.get(id); if (!prior) throw new Error(`Missing catalog page ${id}`);
  const base = groups[def.group];
  const e = { ...base, ...def, tables: [...(base.tables || []), ...(def.tables || [])], actions: def.actions || base.actions || ['Page action/API NOT VERIFIED'], gaps: [...(base.gaps || []), ...(def.gaps || [])], tests: [...new Set([...(base.tests || []), ...(def.tests || [])])] };
  const sourcePaths = [e.module || 'app.js', e.view, ...e.domain.split(';').map((x) => x.trim()), ...e.tests];
  const verified = [...new Set(sourcePaths.filter((s) => exactSource(s) && sourceExists(s)))];
  const actionLines = e.actions.map((a) => `- ${a} — permission: server authorization required; persistence: ${e.authority}`).join('\n');
  const gapLines = e.gaps.map(([sev, type, finding, next], n) => `- **${id}-W4-${String(n + 1).padStart(2, '0')}** (${sev}, ${type}) — ${finding} **Required next step:** ${next}`).join('\n');
  const sourceLines = verified.map((s) => `- \`${s}\``).join('\n');
  const title = prior.fm.title_en || id;
  const text = `---
page_id: ${q(id)}
title_en: ${q(title)}
title_ar: ${q(prior.fm.title_ar || '')}
domain: ${q(prior.fm.domain || 'unknown')}
navigation_group: ${q(prior.fm.navigation_group || 'unknown')}
kind: ${q(e.kind || prior.fm.kind || 'PAGE')}
canonical_status: ${q(prior.fm.canonical_status || 'PRIMARY')}
canonical_home: ${q(prior.fm.canonical_home || id)}
parent_page: ${q(prior.fm.parent_page ?? null)}
aliases: ${q(prior.fm.aliases || [])}
roles: ${q(prior.fm.roles || ['manager'])}
permission: ${q(prior.fm.permission || 'server authorization required')}
entitlement: ${q(prior.fm.entitlement || 'none/global')}
renderer_type: "page-specific-or-generic-shell"
renderer_sources: ${q([e.module || 'app.js'])}
view_sources: ${q([e.view])}
api_sources: ${q([e.api])}
domain_sources: ${q(e.domain.split(';').map((x) => x.trim()))}
tables_or_entities: ${q(e.tables)}
test_sources: ${q(e.tests)}
catalog_baseline_sha: ${q(CATALOG_BASELINE)}
last_verified_sha: ${q(ENGINEERING_REFERENCE)}
engineering_reference_sha: ${q(ENGINEERING_REFERENCE)}
deep_review_wave: 4
evidence_confidence: ${q(e.status === 'CONNECTED' ? 'HIGH' : 'MEDIUM')}
implementation_status: "IMPLEMENTED_OR_PRESENT_AT_ENGINEERING_REFERENCE"
functional_status: ${q(e.status)}
usability_status: ${q(e.usability)}
review_status: "REQUIRES_PRODUCT_RECOVERY"
---

# 1. Identity

- Page ID: \`${id}\`; English: ${title}; domain: \`${prior.fm.domain || 'unknown'}\`; navigation group: \`${prior.fm.navigation_group || 'unknown'}\`.
- Route: \`switchPage('${id}')\`; view: \`${e.view}\`; renderer evidence: \`${e.module || 'app.js'}\`.
- Canonical status: ${prior.fm.canonical_status || 'PRIMARY'}; this page is a primary navigation destination, not an embedded tab.

# 2. Business Purpose

${e.goal}

# 3. Primary Users

- Declared client gate: ${prior.fm.permission || 'server authorization required'}.
- Operational roles: owner/operator/reviewer/approver/manager split is ${e.status === 'CONNECTED' ? 'partly evidenced by domain tests but still requires direct role-isolation proof.' : 'NOT VERIFIED from page-specific evidence.'}

# 4. Primary User Goal

USER OPENS THIS PAGE TO: ${e.goal}

# 5. AS-IS Runtime Surface

- View: \`${e.view}\`; renderer: \`${e.module || 'app.js generic/legacy surface'}\`.
- API/query boundary: ${e.api}.
- AS-IS classification: **${e.status}**; usability: **${e.usability}**.
- Primary actions:
${actionLines}
- Navigation activation is not persistence, isolation, lifecycle, or release proof.

# 6. Data Sources

- UI to API/query: \`${e.api}\`.
- Domain authority: \`${e.domain}\`.
- Tables/entities where evidence permits: ${e.tables.map((x) => `\`${x}\``).join(', ')}.
- Scope requirements: company, branch, period, currency, actor, and role scope must be server-derived where applicable; local-only rows are not canonical posted facts.

# 7. Actions

${actionLines}

# 8. Inputs

- Business inputs vary by page: company/group/period, account mapping, amount/date/source document, bank or facility reference, reconciliation decision, workflow definition, tax period, or device/session context.
- Raw IDs must not bypass tenant, company, period, actor, maker-checker, lifecycle, or entitlement validation.
- For local or NOT_VERIFIED surfaces, inputs must be treated as provisional until a canonical API/domain persistence proof exists.

# 9. Outputs

${e.goal} Expected output: scoped records, decision state, durable source reference, report, alert, or device/session state as appropriate. Exact persisted result is ${e.status === 'THIN' ? 'NOT VERIFIED for the page-specific surface.' : 'partly evidenced by the cited domain.'}

# 10. Workflow Position

- Upstream: ${e.upstream.join('; ')}.
- Downstream: ${e.downstream.join('; ')}.
- Cross-page edge status: ${e.status === 'CONNECTED' ? 'CONNECTED domain evidence with page-level gaps documented below.' : 'PARTIAL/NOT_VERIFIED; no unproven handoff is treated as complete.'}

# 11. States

- ${e.states}.
- LOADING, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS/HANDOFF must remain distinct where supported.
- Lifecycle authority: ${e.authority}

# 12. Permissions & Scope

- Client gate: ${prior.fm.permission || 'server authorization required'}.
- Server authorization and scope: action/resource permission plus company/branch/period/actor/entitlement rules as applicable; direct page isolation is ${e.status === 'CONNECTED' ? 'partly evidenced' : 'NOT VERIFIED'}.
- Approval roles must remain separate from requestor roles; local UI controls are not authorization proof.

# 13. Arabic / English

- English: ${title}; Arabic: ${prior.fm.title_ar || 'NOT VERIFIED'}.
- Every primary action, state, error, and report period needs a visible bilingual label; mojibake or missing state text is a usability defect.

# 14. Responsive Requirements

- Desktop: preserve period/company scope, record identity, status, decision, totals, and primary action.
- Mobile/kiosk: where applicable, prove the smallest safe action, offline/entitlement state, retry, and audit result; direct responsive proof is NOT VERIFIED unless cited in tests.

# 15. AS-IS Functional Assessment

**${e.status} / ${e.usability}** — ${e.status === 'THIN' ? 'The destination and domain candidate exist, but page-specific functional wiring or persistence is incomplete.' : 'The page has a meaningful renderer/domain boundary, but remaining gaps prevent release closure.'}

# 16. Target Business Contract

${e.goal} The target contract is a scoped, page-specific workflow that loads authoritative data, exposes lifecycle-valid actions, persists through **${e.authority}**, produces a durable result/reference, and makes missing, denied, stale, validation, and server-error states explicit.

# 17. Identified Gaps

${gapLines}

# 18. Consolidation Analysis

- Recommended disposition: **${e.disposition}**.
- Keep separate only when the user goal and lifecycle authority are distinct. Shared Finance tables or adjacent page titles do not prove duplication.
- Current authority decision: ${e.authority}

# 19. Acceptance Criteria

- A permitted user opens the page and sees a non-error surface with explicit scope and freshness.
- Each primary action validates required inputs, authorization, lifecycle, idempotency, and maker-checker rules, then displays the durable resulting state.
- A direct browser/API/domain test proves the highest-risk transition and persistence; navigation-only proof is insufficient.
- For this page: ${e.goal}

# 20. Test Evidence

- Evidence class: ${e.tests.length ? 'STATIC/DOMAIN/CONTRACT references listed below; direct page lifecycle is bounded.' : 'STATIC/NAVIGATION only; no page-specific test was attributed.'}
${e.tests.map((t) => `- \`${t}\``).join('\n') || '- Direct page-specific lifecycle test: NOT VERIFIED'}
- Source files verified at engineering reference:
${sourceLines}

# 21. Known Limitations

- Catalog starting SHA: \`${CATALOG_BASELINE}\`; engineering reference: \`${ENGINEERING_REFERENCE}\`.
- Wave 4 is documentation-only; no engineering source, product test, migration, runtime data, or navigation file was changed.
- A domain test does not automatically prove that this navigation page is wired to that domain.

# 22. Source Evidence

${sourceLines}

# 23. Change History

- ${DATE} — Wave 4 deep review from engineering reference \`${ENGINEERING_REFERENCE}\`; Waves 2-3 were preserved and not redone.

## CAPABILITIES OWNED

- ${e.authority}

## CAPABILITIES CONSUMED

- ${e.upstream.concat(e.downstream).join('; ')}
`;
  fs.writeFileSync(path.join(ROOT, prior.file), text);
}

const allSpecs = fs.readdirSync(ROOT, { recursive: true }).filter((f) => f.endsWith('.md') && !/^(README|INDEX|COVERAGE|CROSS_PAGE_CONTRADICTIONS|ENGINEERING_HANDOFF|STALE_SPEC_RECONCILIATION|BUSINESS_FLOW_MAP|CANONICAL_AUTHORITY_MAP)\.md$/.test(path.basename(f)));
const parsePage = (file) => {
  const fm = readFm(path.join(ROOT, file));
  const id = fm.page_id;
  const wave = pageDefs[id] ? 4 : (fm.deep_review_wave || (fm.catalog_baseline_sha === 'aa730dd23462aab3e90b70ad2db1bf6cc945ca99' ? 2 : null));
  return { pageId: id, title: fm.title_en || id, domain: fm.domain || 'unknown', kind: fm.kind || 'PAGE', canonicalStatus: fm.canonical_status || 'PRIMARY', parent: fm.parent_page ?? null, specPath: `./${safe(file)}`, functionalStatus: fm.functional_status || 'NOT_VERIFIED', usabilityStatus: fm.usability_status || 'THIN', recommendedDisposition: pageDefs[id] ? (pageDefs[id].disposition || groups[pageDefs[id].group].disposition) : 'Retain and reconcile', upstream: pageDefs[id] ? groups[pageDefs[id].group].upstream : [], downstream: pageDefs[id] ? groups[pageDefs[id].group].downstream : [], aliases: fm.aliases || [], capabilitiesOwned: pageDefs[id] ? [groups[pageDefs[id].group].authority] : [`${id}:workspace`], capabilitiesConsumed: pageDefs[id] ? groups[pageDefs[id].group].upstream.concat(groups[pageDefs[id].group].downstream) : ['Existing catalog evidence'], sourceFiles: pageDefs[id] ? [pageDefs[id].module || 'app.js', pageDefs[id].view] : [], catalogBaselineSha: fm.catalog_baseline_sha || CATALOG_BASELINE, lastVerifiedSha: fm.last_verified_sha || ENGINEERING_REFERENCE, engineeringReferenceSha: fm.engineering_reference_sha || ENGINEERING_REFERENCE, deepReviewWave: wave, deepReviewStatus: wave ? 'DEEP_REVIEWED' : 'SHALLOW' };
};
const manifestPages = allSpecs.map(parsePage).filter((x) => x.pageId).sort((a, b) => a.pageId.localeCompare(b.pageId));
fs.writeFileSync(path.join(ROOT, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 4, catalogBaselineSha: CATALOG_BASELINE, lastVerifiedSha: ENGINEERING_REFERENCE, engineeringReferenceSha: ENGINEERING_REFERENCE, generatedAt: new Date().toISOString(), primaryWorkspaceCount: manifestPages.length, embeddedTabs: ['calculator', 'kanban', 'locations', 'workshop_tv'], compatibilityAliases: ['pos_deepening'], pages: manifestPages }, null, 2)}\n`);

const wave4Count = Object.keys(pageDefs).length;
const deep = manifestPages.filter((x) => x.deepReviewStatus === 'DEEP_REVIEWED').length;
const waves = manifestPages.reduce((o, x) => { if (x.deepReviewWave) o[x.deepReviewWave] = (o[x.deepReviewWave] || 0) + 1; return o; }, {});
const domains = Object.entries(manifestPages.reduce((o, x) => { const d = o[x.domain] ||= { p: 0, d: 0 }; d.p++; if (x.deepReviewStatus === 'DEEP_REVIEWED') d.d++; return o; }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([d, x]) => `| \`${d}\` | ${x.p} | ${x.d} | ${x.p - x.d} |`).join('\n');
const rows = manifestPages.map((x) => `| \`${x.pageId}\` | ${x.title} | ${x.domain} | ${x.kind} | SPEC_EXISTS | ${x.deepReviewStatus === 'DEEP_REVIEWED' ? `DEEP_REVIEWED_WAVE_${x.deepReviewWave}` : 'SHALLOW'} | ${x.functionalStatus} | ${x.usabilityStatus} | ${x.recommendedDisposition} | [spec](${x.specPath}) |`).join('\n');
const historicalRows = (wave) => manifestPages.filter((x) => x.deepReviewWave === wave).map((x) => `| \`${x.pageId}\` | ${x.title} | ${x.domain} | ${x.functionalStatus} | ${x.usabilityStatus} | [spec](${x.specPath}) |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'INDEX.md'), `# Octagon Page Specification Catalog\n\nCatalog baseline: \`${CATALOG_BASELINE}\`\nEngineering reference: \`${ENGINEERING_REFERENCE}\`\nPrimary workspaces: **${manifestPages.length}**\nSpec presence: **${manifestPages.length}/${manifestPages.length}**\nDeep review: **${deep}/${manifestPages.length}** (${Object.entries(waves).map(([k, v]) => `Wave ${k}: ${v}`).join(', ')})\n\n## Coverage interpretation\n\nEvery primary destination has a spec. \`SPEC_EXISTS\` means an artifact exists; \`DEEP_REVIEWED_WAVE_N\` means forensic source review was performed at that wave; \`SHALLOW\` remains inventory-level. Functional/usability labels are evidence classifications, not release acceptance.\n\n## Primary pages\n\n| Page ID | Title | Domain | Kind | Spec presence | Deep review | Functional | Usability | Disposition | Spec |\n|---|---|---|---|---|---|---|---|---|---|\n${rows}\n`);

const w4Rows = Object.entries(pageDefs).map(([id, d]) => `| \`${id}\` | ${d.group} | ${groups[d.group].status} | ${groups[d.group].disposition} | ${d.view} | ${groups[d.group].domain} | [spec](./${safe(byId.get(id).file)}) |`).join('\n');
fs.writeFileSync(path.join(ROOT, 'COVERAGE.md'), `# Coverage and Forensic Deep Review — Wave 4\n\n## Evidence boundary\n\n- Wave 4 starting catalog SHA: \`${CATALOG_BASELINE}\`.\n- Moving engineering reference SHA: \`${ENGINEERING_REFERENCE}\`.\n- Primary specs present: **${manifestPages.length}/${manifestPages.length}**.\n- Prior deep reviews preserved: Wave 2 **${waves[2] || 0}**, Wave 3 **${waves[3] || 0}**.\n- Wave 4 deep review: **${wave4Count}** pages.\n- Total deep review: **${deep}/${manifestPages.length}**; shallow remaining: **${manifestPages.length - deep}**.\n\n## Wave 4 pages\n\n| Page | Evidence group | AS-IS classification | Disposition | View | Domain authority | Spec |\n|---|---|---|---|---|---|---|\n${w4Rows}\n\n## Coverage by domain\n\n| Domain | Specs present | Deep reviewed | Shallow remaining |\n|---|---:|---:|---:|\n${domains}\n\n## Wave 2 and Wave 3 history\n\nWave 2 deepened 32 BUILD-09 pages and Wave 3 deepened 26 workshop, commercial, procurement, project, service, and finance-handoff pages. Their specs, maps, contradictions, and handoff history remain preserved. Wave 4 did not redo those pages.\n\n## Interpretation\n\nWave 4 intentionally selected all remaining shallow pages in the finance, treasury, intercompany/consolidation, workflow, tax, approval, and service-kiosk boundary set. A domain source or test is not attributed to a page as functional proof unless the page renderer/API wiring is also evidenced.\n`);

const contradictions = `## Wave 4 findings\n\n| ID | Boundary | Evidence | Required reconciliation | Severity |\n|---|---|---|---|---|\n| C-020 | Legacy cashbox/expense/income writers versus Finance | \`app.js\` maintains local \`finance.transactions\` and \`addFinanceTransaction\` helpers while Finance engine owns canonical documents/journals. | Freeze or migrate local financial writers through Finance source facts; distinguish legacy reconciliation from posted truth. | P0 |\n| C-021 | Finance page family versus canonical API | Finance API/domain and extensive finance tests exist, but many primary finance pages have no page-specific API/module evidence. | Map each page to a canonical query/action or classify it as a report/view/retirement candidate. | P1 |\n| C-022 | Consolidation pages versus consolidation domain | \`platform/consolidation/index.mjs\` and Build-08 tests exist, but group/run/report/lineage/elimination pages are not individually wired in evidence. | Establish one canonical group/run write home and read-only report/lineage children. | P1 |\n| C-023 | Treasury pages versus planning domain | Treasury/liquidity domain exists, but forecast, alert, cash-position, facility, and funding-proposal page lifecycles are not directly proven. | Define forecast freshness, approval, execution, and Finance source-reference contracts. | P1 |\n| C-024 | Intercompany pages versus reconciliation/consolidation | Intercompany operations and tests exist, but page-level transaction-to-mismatch-to-reconciliation edges are not verified. | Prove company-pair isolation, matching, reconciliation, and ledger/consolidation lineage. | P1 |\n| C-025 | Workflow canvas versus durable runtime | \`app.js\` local canvas helpers/localStorage coexist with durable WorkflowRegistry/WorkflowRuntime definitions, versions, leases, and instances. | Make the canvas an adapter and prove publish-to-run persistence, frozen-zone enforcement, and idempotency. | P0 |\n| C-026 | Service Kiosk versus service/kiosk authorities | Kiosk and service domain/tests cover registry, entitlement, signatures, and offline boards, while page-level route wiring is not fully identified. | Prove device/session/entitlement to service-action handoff and offline recovery. | P1 |\n| C-027 | Tax Compliance versus Finance posting | Tax module and Finance authority coexist, but tax-period calculation/submission/source lineage is not fully attributed to the page. | Prove tax report lifecycle, amendments, and Finance source-document links. | P1 |\n| C-028 | Content Approvals versus generic Approvals | Content Approvals is a separate primary page while approval domain ownership and content target records are not identified. | Make it a target-specific child/view or document a distinct content approval authority. | P2 |\n| C-029 | Purpose overlap in consolidation pages | Groups, runs, reports, lineage, and eliminations are separately navigable but their user-goal hierarchy is unclear. | Publish a bounded consolidation hierarchy and avoid parallel writes. | P2 |\n\n## Consolidation candidates\n\n- Local Cashbox, Expenses, and Income should be migrated into Finance or explicitly retained as non-posting legacy views.\n- Workflow should retain its page only as the durable runtime’s governed definition/monitoring home; local canvas storage must not remain a parallel authority.\n- Consolidated Reports and Consolidation Lineage are likely read-only children; Consolidation Groups and Runs are the candidate canonical writes.\n- Content Approvals may be a filtered child of Approvals unless owner evidence proves a separate content lifecycle.\n`;
replaceSection('CROSS_PAGE_CONTRADICTIONS.md', '## Wave 4 findings', contradictions);

const handoff = `# Wave 4 — Engineering Handoff\n\n## Reference and scope\n\n- Catalog starting SHA: \`${CATALOG_BASELINE}\`.\n- Engineering reference SHA: \`${ENGINEERING_REFERENCE}\`.\n- Deep-reviewed pages: **${wave4Count}**; Waves 2-3 preserved.\n- Documentation-only scope: \`docs/page-specs/**\` in the isolated catalog worktree.\n\n## Highest-value findings\n\n1. **P0 Finance authority:** local Cashbox/Expenses/Income helpers remain visible beside canonical Finance documents and journal posting. Treat local rows as legacy/provisional until migrated or retired.\n2. **P0 Workflow authority:** durable WorkflowRegistry/WorkflowRuntime is a strong canonical runtime, but the legacy canvas/localStorage surface must become an adapter with publication/run proof.\n3. **P1 Finance page wiring:** domain APIs and tests exist, but many finance navigation pages lack page-specific API evidence; do not infer functionality from shared backend existence.\n4. **P1 Consolidation/Treasury/Intercompany:** domain boundaries are present and tested, but page-level lifecycle and isolation edges remain incomplete.\n5. **P1 Service Kiosk and Tax:** domain/test evidence exists; direct page-to-domain handoffs and source lineage still need bounded proof.\n\n## Recommended next implementation order\n\n- Resolve P0 Finance and Workflow authority conflicts before adding more local actions.\n- Select canonical consolidation group/run/report hierarchy and treasury proposal execution contract.\n- Prove intercompany pair isolation and Procurement-to-AP closure from the prior wave.\n- Attach direct page browser/API evidence to the pages currently classified THIN or PARTIALLY_CONNECTED.\n`;
replaceSection('ENGINEERING_HANDOFF.md', '# Wave 4 — Engineering Handoff', handoff);

replaceSection('BUSINESS_FLOW_MAP.md', '# Business Flow Map — Wave 4', `# Business Flow Map — Wave 4\n\nEngineering reference: \`${ENGINEERING_REFERENCE}\`\n\n| Flow | Source | Target | Status | Evidence / next proof |\n|---|---|---|---|---|\n| Legacy cashbox/expense/income row → Finance posted fact | app.js local helpers | Finance engine | MISSING | Local writer and canonical Finance exist, but no verified source-fact handoff for these pages. Freeze/migrate and prove idempotency. |\n| Finance posted facts → cash position/liquidity forecast | Finance engine | Treasury/liquidity | PARTIAL | Treasury domain consumes planning inputs; page freshness, currency, and source references are not page-proven. |\n| Treasury funding proposal → payment execution | Treasury planning | Finance payment/source fact | NOT_VERIFIED | Proposal domain exists; page-level approval/execution edge and resulting Finance reference are not verified. |\n| Intercompany transaction → mismatch → reconciliation | Intercompany operations | Reconciliation/consolidation | PARTIAL | Domain and tests exist; page-level company-pair lifecycle is not proven. |\n| Consolidation group → run → report/lineage | Consolidation domain | Consolidated Reports/Lineage | PARTIAL | Domain/test sources exist; individual page authority and read-only child boundaries remain unclear. |\n| Tax calculation → report/submission → Finance lineage | Tax module | Finance tax/report authority | PARTIAL | Tax renderer and Finance domain coexist; submission/amendment/source lineage needs direct proof. |\n| Workflow canvas → durable definition/version | app.js canvas | WorkflowRegistry | PARTIAL | Durable registry supports immutable versions; local canvas compatibility path must be proven as adapter-only. |\n| Workflow definition → runtime instance → registered action | WorkflowRegistry/Runtime | action executor/outbox | VERIFIED | Runtime source enforces registered actions, leases, versions, idempotency, and frozen-zone checks; page lifecycle proof remains needed. |\n| Kiosk registration/entitlement → service action | Kiosk/service domains | Service Kiosk | PARTIAL | Domain/tests cover registry, entitlement, signatures, and offline behavior; page route handoff not fully verified. |\n`);

replaceSection('CANONICAL_AUTHORITY_MAP.md', '# Canonical Authority Map — Wave 4', `# Canonical Authority Map — Wave 4\n\nEngineering reference: \`${ENGINEERING_REFERENCE}\`\n\n| Object/capability | Canonical authority | Page(s) | Confidence | Conflict/unknown |\n|---|---|---|---|---|\n| Posted accounting document/journal | \`platform/finance/engine.mjs\` | Finance, AR/AP, tax | HIGH | Legacy local writers must not post independently. |\n| Cashbox/expense/income legacy rows | Finance intended; current app.js local helpers | Cashbox, Expenses, Income | HIGH conflict | Migration/source-fact mapping is unresolved. |\n| Budget/variance | Finance budget actions plus Projects budget | Budgeting, Projects | MEDIUM | Page-specific Budgeting action wiring not fully verified. |\n| Consolidation group/run | \`platform/consolidation/index.mjs\` | Consolidation Groups, Runs | MEDIUM | Page hierarchy and direct API wiring unresolved. |\n| Consolidated report/lineage | Consolidation read/query authority candidate | Reports, Lineage | LOW | Must remain read-only until source lineage is proven. |\n| Treasury forecast/funding/facility | \`platform/treasury/liquidity.mjs\` and planning domain | Liquidity, Funding, Facilities, Alerts | MEDIUM | Approval/execution and Finance source references unresolved. |\n| Intercompany transaction/reconciliation | \`platform/intercompany/operations.mjs\` | Transactions, Mismatch, Reconciliation | MEDIUM | Page company-pair isolation and ledger links need proof. |\n| Workflow definition/version/instance | \`platform/workflow/index.mjs\` | Workflow | HIGH intended | app.js canvas/localStorage remains a compatibility conflict. |\n| Tax calculation/report | Finance engine plus tax module | Tax Compliance | MEDIUM | Submission/amendment lineage needs direct proof. |\n| Kiosk registry/entitlement/signature | \`platform/kiosk/*\` and \`platform/service/*\` | Service Kiosk | HIGH domain | Page route/action handoff remains partial. |\n| Content approval | Generic approval domain candidate | Content Approvals | LOW | Target entity and distinct authority unresolved. |\n`);

const missing = [];
for (const [id, def] of Object.entries(pageDefs)) {
  const e = { ...groups[def.group], ...def };
  for (const source of [e.module || 'app.js', e.view, ...e.domain.split(';').map((x) => x.trim()), ...e.tests]) if (exactSource(source) && !sourceExists(source)) missing.push(`${id}: ${source}`);
}
if (missing.length) throw new Error(`Missing source evidence:\n${missing.join('\n')}`);
console.log(JSON.stringify({ wave: 4, catalogBaseline: CATALOG_BASELINE, engineeringReference: ENGINEERING_REFERENCE, wave4Pages: wave4Count, manifestPages: manifestPages.length, deepReviewTotal: deep, waves, missing }, null, 2));
const coverageFile = path.join(ROOT, 'COVERAGE.md');
const coverageText = fs.readFileSync(coverageFile, 'utf8');
const historyMarker = '## Wave 2 and Wave 3 history';
const historyStart = coverageText.indexOf(historyMarker);
if (historyStart >= 0) {
  const history = `## Wave 2 historical record\n\nWave 2 deepened 32 BUILD-09 pages; those pages were not redone.\n\n| Page | Title | Domain | Functional | Usability | Spec |\n|---|---|---|---|---|---|\n${historicalRows(2)}\n\n## Wave 3 historical record\n\nWave 3 deepened 26 workshop, commercial, procurement, project, service, and finance-handoff pages; those pages were not redone.\n\n| Page | Title | Domain | Functional | Usability | Spec |\n|---|---|---|---|---|---|\n${historicalRows(3)}\n\n## Interpretation\n\nWave 4 intentionally selected the remaining shallow pages in the finance, treasury, intercompany/consolidation, workflow, tax, approval, and service-kiosk boundary set. A domain source or test is not attributed to a page as functional proof unless the page renderer/API wiring is also evidenced.\n`;
  fs.writeFileSync(coverageFile, `${coverageText.slice(0, historyStart).trimEnd()}\n\n${history}`);
}
