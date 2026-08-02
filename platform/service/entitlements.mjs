'use strict';

import crypto from 'node:crypto';

export class EntitlementError extends Error { constructor(message, code) { super(message); this.code = code; } }
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const keyOf = (input = {}) => input.idempotencyKey || input.idempotency_key || null;

/** Company-scoped authority for service contracts, coverage decisions and usage. */
export class ServiceEntitlementService {
  constructor(dialect) { this.dialect = dialect; }
  contract(contractId, companyId = null) {
    const row = this.dialect.prepare('SELECT * FROM service_contracts WHERE id = ?').get(contractId) || null;
    if (row && companyId && row.company_id !== companyId) throw new EntitlementError('contract is outside active company', 'COMPANY_SCOPE_DENIED');
    return row;
  }
  listContracts(ctx = {}) { return this.dialect.prepare('SELECT * FROM service_contracts WHERE company_id = ? ORDER BY created_at DESC').all(ctx.companyId); }
  createContract(input, ctx = {}) {
    const companyId = ctx.companyId || input.companyId;
    if (!companyId || !input.customerId || !input.contractNumber || !input.startDate || !input.endDate || input.endDate < input.startDate) throw new EntitlementError('company, customer, number and valid dates are required', 'INVALID_CONTRACT');
    const idem = keyOf(input); const existing = idem && this.dialect.prepare('SELECT * FROM service_contracts WHERE idempotency_key = ?').get(idem);
    if (existing) { if (existing.company_id !== companyId) throw new EntitlementError('idempotency key belongs to another company', 'COMPANY_SCOPE_DENIED'); return existing; }
    const stamp = now(), contractId = id('svc');
    this.dialect.prepare(`INSERT INTO service_contracts(id,company_id,customer_id,contract_number,status,start_date,end_date,response_sla_hours,resolution_sla_hours,created_by,idempotency_key,created_at,updated_at) VALUES(?,?,?,?, 'draft',?,?,?,?,?,?,?,?)`).run(contractId, companyId, input.customerId, input.contractNumber, input.startDate, input.endDate, input.responseSlaHours || null, input.resolutionSlaHours || null, ctx.userId || 'system', idem, stamp, stamp);
    this.history(contractId, null, 'draft', ctx); return this.contract(contractId, companyId);
  }
  history(contractId, from, to, ctx) { this.dialect.prepare('INSERT INTO service_contract_history(id,contract_id,from_status,to_status,actor_id,created_at) VALUES(?,?,?,?,?,?)').run(id('svch'), contractId, from, to, ctx.userId || 'system', now()); }
  transition(contractId, to, ctx = {}) {
    const c = this.contract(contractId, ctx.companyId); if (!c) throw new EntitlementError('contract not found', 'CONTRACT_NOT_FOUND');
    const flow = { draft: ['validated'], validated: ['submitted'], submitted: ['approved', 'rejected'], approved: ['active'], active: ['suspended', 'cancelled', 'closed', 'renewed'], suspended: ['active', 'cancelled'], renewed: ['closed'] };
    if (!(flow[c.status] || []).includes(to)) throw new EntitlementError('invalid lifecycle transition', 'INVALID_CONTRACT_STATE');
    this.dialect.prepare("UPDATE service_contracts SET status=?, approved_by=CASE WHEN ?='approved' THEN ? ELSE approved_by END, updated_at=? WHERE id=?").run(to, to, ctx.userId || 'system', now(), contractId);
    this.history(contractId, c.status, to, ctx); return this.contract(contractId, c.company_id);
  }
  addCoverage(contractId, { productId, assetId, siteId } = {}, ctx = {}) {
    const c = this.contract(contractId, ctx.companyId); if (!c) throw new EntitlementError('contract not found', 'CONTRACT_NOT_FOUND');
    if (productId) this.dialect.prepare('INSERT OR IGNORE INTO service_contract_products VALUES(?,?)').run(contractId, productId);
    if (assetId) this.dialect.prepare('INSERT OR IGNORE INTO service_contract_assets VALUES(?,?)').run(contractId, assetId);
    if (siteId) this.dialect.prepare('INSERT OR IGNORE INTO service_contract_sites VALUES(?,?)').run(contractId, siteId);
    return c;
  }
  createPolicy(input, ctx = {}) {
    const c = this.contract(input.contractId || input.contract_id, ctx.companyId); if (!c) throw new EntitlementError('contract not found', 'CONTRACT_NOT_FOUND');
    const stamp = now(), policyId = id('pol');
    this.dialect.prepare(`INSERT INTO entitlement_policies(id,company_id,contract_id,name,priority,status,visit_limit,excluded_cause,response_sla_hours,resolution_sla_hours,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?,?,?,?,?)`).run(policyId, c.company_id, c.id, input.name, input.priority || 100, Math.max(0, Number(input.visitLimit ?? input.visit_limit ?? 0)), input.excludedCause || input.excluded_cause || null, input.responseSlaHours || null, input.resolutionSlaHours || null, ctx.userId || 'system', stamp, stamp);
    return this.policy(policyId, c.company_id);
  }
  policy(policyId, companyId = null) { const row = this.dialect.prepare('SELECT * FROM entitlement_policies WHERE id=?').get(policyId) || null; if (row && companyId && row.company_id !== companyId) throw new EntitlementError('policy is outside active company', 'COMPANY_SCOPE_DENIED'); return row; }
  publishPolicy(policyId, ctx = {}) { const p = this.policy(policyId, ctx.companyId); if (!p) throw new EntitlementError('policy not found', 'POLICY_NOT_FOUND'); this.dialect.prepare("UPDATE entitlement_policies SET status='published',approved_by=?,updated_at=? WHERE id=?").run(ctx.userId || 'system', now(), policyId); return this.policy(policyId, p.company_id); }
  evaluate(input, ctx = {}) {
    const companyId = ctx.companyId || input.companyId; if (!companyId || !input.customerId || !input.serviceDate) throw new EntitlementError('company, customer and service date are required', 'INVALID_EVALUATION');
    const c = this.dialect.prepare("SELECT * FROM service_contracts WHERE company_id=? AND customer_id=? AND status='active' AND start_date<=? AND end_date>=? ORDER BY created_at LIMIT 1").get(companyId, input.customerId, input.serviceDate, input.serviceDate);
    let status = 'denied', reason = 'NO_ACTIVE_CONTRACT', policy = null;
    if (c) { policy = this.dialect.prepare("SELECT * FROM entitlement_policies WHERE contract_id=? AND company_id=? AND status='published' ORDER BY priority,id LIMIT 1").get(c.id, companyId); if (!policy) reason = 'NO_PUBLISHED_POLICY'; else if (policy.excluded_cause && policy.excluded_cause === input.failureType) reason = 'EXCLUDED_CAUSE'; else if (policy.visit_limit > 0 && policy.visits_used >= policy.visit_limit) reason = 'ALLOWANCE_EXHAUSTED'; else { status = 'covered'; reason = null; } }
    const decisionId = id('dec'); this.dialect.prepare('INSERT INTO entitlement_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(decisionId, companyId, c?.id || null, policy?.id || null, status, reason, status === 'covered' ? Number(input.requestedLabor || 0) : 0, status === 'covered' ? Number(input.requestedParts || 0) : 0, policy?.response_sla_hours || c?.response_sla_hours || null, policy?.resolution_sla_hours || c?.resolution_sla_hours || null, input.sourceType || input.source_type || null, input.sourceId || input.source_id || null, now());
    return { id: decisionId, companyId, status, reason, policyId: policy?.id || null, contractId: c?.id || null };
  }
  consume(input, ctx = {}) {
    const idem = keyOf(input); if (!idem) throw new EntitlementError('idempotency key is required', 'IDEMPOTENCY_KEY_REQUIRED');
    const existing = this.dialect.prepare('SELECT * FROM entitlement_usage_ledger WHERE idempotency_key=?').get(idem); if (existing) { if (ctx.companyId && existing.company_id !== ctx.companyId) throw new EntitlementError('usage is outside active company', 'COMPANY_SCOPE_DENIED'); return existing; }
    const decisionId = input.decisionId || input.decision_id; const d = this.dialect.prepare('SELECT * FROM entitlement_decisions WHERE id=?').get(decisionId); if (!d || d.status !== 'covered' || (ctx.companyId && d.company_id !== ctx.companyId)) throw new EntitlementError('coverage not consumable', 'NOT_COVERED');
    const quantity = Math.max(0, Number(input.quantity || 1)); if (!quantity) throw new EntitlementError('quantity must be positive', 'INVALID_QUANTITY'); const stamp = now(), usageId = id('use');
    this.dialect.prepare('INSERT INTO entitlement_usage_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(usageId, d.company_id, d.policy_id, d.id, input.sourceType || input.source_type || d.source_type, input.sourceId || input.source_id || d.source_id, idem, quantity, null, ctx.userId || 'system', stamp);
    this.dialect.prepare('UPDATE entitlement_policies SET visits_used=visits_used+?,updated_at=? WHERE id=? AND company_id=?').run(quantity, stamp, d.policy_id, d.company_id); return this.dialect.prepare('SELECT * FROM entitlement_usage_ledger WHERE id=?').get(usageId);
  }
  reverse(input, ctx = {}) { const original = this.dialect.prepare('SELECT * FROM entitlement_usage_ledger WHERE id=?').get(input.usageId || input.usage_id); if (!original || (ctx.companyId && original.company_id !== ctx.companyId)) throw new EntitlementError('usage not found', 'USAGE_NOT_FOUND'); if (this.dialect.prepare('SELECT 1 FROM entitlement_usage_ledger WHERE reversal_of=?').get(original.id)) throw new EntitlementError('usage already reversed', 'USAGE_ALREADY_REVERSED'); const quantity = Math.abs(Number(original.quantity)); const row = { id: id('use'), stamp: now() }; this.dialect.prepare('INSERT INTO entitlement_usage_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id, original.company_id, original.policy_id, original.decision_id, original.source_type, original.source_id, keyOf(input), -quantity, original.id, ctx.userId || 'system', row.stamp); this.dialect.prepare('UPDATE entitlement_policies SET visits_used=MAX(0,visits_used-?),updated_at=? WHERE id=? AND company_id=?').run(quantity, row.stamp, original.policy_id, original.company_id); return this.dialect.prepare('SELECT * FROM entitlement_usage_ledger WHERE id=?').get(row.id); }
}
export const createServiceEntitlementService = (dialect) => new ServiceEntitlementService(dialect);
