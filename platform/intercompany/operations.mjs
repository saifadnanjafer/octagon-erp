// BUILD-08 reciprocal intercompany projection and reconciliation authority.
'use strict';

import crypto from 'node:crypto';

export class IntercompanyError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'IntercompanyError'; this.code = code; this.statusCode = statusCode; }
}
const id = (p) => `${p}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (v) => Number(v || 0);

export class IntercompanyOperationsService {
  constructor(dialect) { this.db = dialect; }

  createRelationship(input, ctx = {}) {
    const companyA = input.companyAId || ctx.companyId;
    const companyB = input.companyBId;
    if (!companyA || !companyB || companyA === companyB || !input.dueToAccountA || !input.dueFromAccountA || !input.dueToAccountB || !input.dueFromAccountB) throw new IntercompanyError('Distinct companies and reciprocal accounts are required', 'INVALID_COMPANY_RELATIONSHIP');
    this.#assertParticipant(companyA, companyB, ctx);
    const relationshipId = id('icr');
    const allowed = input.allowedTypes || ['sale_purchase', 'service_charge', 'allocation', 'loan', 'transfer'];
    this.db.prepare(`INSERT INTO intercompany_relationships_v2(id,company_a_id,company_b_id,relationship_type,allowed_types_json,due_to_account_a,due_from_account_a,due_to_account_b,due_from_account_b,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)`).run(relationshipId, companyA, companyB, input.relationshipType || 'affiliate', JSON.stringify(allowed), input.dueToAccountA, input.dueFromAccountA, input.dueToAccountB, input.dueFromAccountB, ctx.userId || ctx.actorId || 'system', now());
    return this.getRelationship(relationshipId, ctx);
  }

  getRelationship(relationshipId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM intercompany_relationships_v2 WHERE id=?').get(relationshipId);
    if (!row) return null;
    this.#assertParticipant(row.company_a_id, row.company_b_id, ctx);
    return { id: row.id, companyAId: row.company_a_id, companyBId: row.company_b_id, relationshipType: row.relationship_type, allowedTypes: JSON.parse(row.allowed_types_json || '[]'), dueToAccountA: row.due_to_account_a, dueFromAccountA: row.due_from_account_a, dueToAccountB: row.due_to_account_b, dueFromAccountB: row.due_from_account_b, status: row.status };
  }

  createOperation(input, ctx = {}) {
    const relationship = this.getRelationship(input.relationshipId, ctx);
    if (!relationship || relationship.status !== 'active') throw new IntercompanyError('Active relationship required', 'INTERCOMPANY_RELATIONSHIP_REQUIRED', 409);
    const source = input.sourceCompanyId || ctx.companyId;
    const target = input.targetCompanyId;
    this.#assertDirection(relationship, source, target);
    if ((ctx.companyId || ctx.activeCompanyId) !== source) throw new IntercompanyError('Only the source company can originate the operation', 'SOURCE_COMPANY_REQUIRED', 403);
    if (!relationship.allowedTypes.includes(input.transactionType) || n(input.amount) < 0 || !input.sourceDocumentId || !input.reference) throw new IntercompanyError('Transaction type, document, amount and reference are required', 'INVALID_INTERCOMPANY_OPERATION');
    const key = input.idempotencyKey || ctx.idempotencyKey || null;
    if (key) {
      const existing = this.db.prepare('SELECT id FROM intercompany_operations_v2 WHERE idempotency_key=?').get(key);
      if (existing) return this.getOperation(existing.id, ctx);
    }
    const operationId = id('ico');
    const reciprocalDocumentId = input.reciprocalDocumentId || `reciprocal_${crypto.randomUUID()}`;
    this.db.prepare(`INSERT INTO intercompany_operations_v2(id,relationship_id,source_company_id,target_company_id,transaction_type,source_document_type,source_document_id,reciprocal_document_type,reciprocal_document_id,reference,source_amount,reciprocal_amount,currency,service_allocation_json,due_from_amount,due_to_amount,source_status,reciprocal_status,status,created_by,created_at,updated_at,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending','pending','pending_approval',?,?,?,?)`).run(operationId, relationship.id, source, target, input.transactionType, input.sourceDocumentType || 'sales_document', input.sourceDocumentId, input.reciprocalDocumentType || 'purchase_document', reciprocalDocumentId, input.reference, n(input.amount), n(input.reciprocalAmount ?? input.amount), input.currency || 'IQD', JSON.stringify(input.serviceAllocation || {}), n(input.amount), n(input.reciprocalAmount ?? input.amount), ctx.userId || ctx.actorId || 'system', now(), now(), key);
    this.detectMismatches(operationId, ctx);
    return this.getOperation(operationId, ctx);
  }

  getOperation(operationId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM intercompany_operations_v2 WHERE id=?').get(operationId);
    if (!row) return null;
    this.#assertParticipant(row.source_company_id, row.target_company_id, ctx);
    const mismatches = this.db.prepare('SELECT * FROM intercompany_mismatches_v2 WHERE operation_id=? ORDER BY detected_at').all(operationId).map((m) => ({ id: m.id, mismatchType: m.mismatch_type, sourceValue: m.source_value, reciprocalValue: m.reciprocal_value, differenceAmount: n(m.difference_amount), severity: m.severity, status: m.status }));
    return { id: row.id, relationshipId: row.relationship_id, sourceCompanyId: row.source_company_id, targetCompanyId: row.target_company_id, transactionType: row.transaction_type, sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id, reciprocalDocumentType: row.reciprocal_document_type, reciprocalDocumentId: row.reciprocal_document_id, reference: row.reference, sourceAmount: n(row.source_amount), reciprocalAmount: n(row.reciprocal_amount), currency: row.currency, serviceAllocation: JSON.parse(row.service_allocation_json || '{}'), dueFromAmount: n(row.due_from_amount), dueToAmount: n(row.due_to_amount), sourceStatus: row.source_status, reciprocalStatus: row.reciprocal_status, status: row.status, mismatches };
  }

  listOperations({ companyId, status } = {}, ctx = {}) {
    const active = companyId || ctx.companyId;
    let sql = 'SELECT id FROM intercompany_operations_v2 WHERE (source_company_id=? OR target_company_id=?)';
    const params = [active, active];
    if (status) { sql += ' AND status=?'; params.push(status); }
    return this.db.prepare(`${sql} ORDER BY created_at DESC`).all(...params).map((row) => this.getOperation(row.id, { ...ctx, companyId: active }));
  }

  approveOperation(operationId, ctx = {}) {
    const operation = this.getOperation(operationId, ctx);
    if (!operation) throw new IntercompanyError('Operation not found', 'INTERCOMPANY_OPERATION_NOT_FOUND', 404);
    const active = ctx.companyId || ctx.activeCompanyId;
    if (active === operation.sourceCompanyId) this.db.prepare("UPDATE intercompany_operations_v2 SET source_status='approved',updated_at=? WHERE id=?").run(now(), operationId);
    else if (active === operation.targetCompanyId) this.db.prepare("UPDATE intercompany_operations_v2 SET reciprocal_status='approved',updated_at=? WHERE id=?").run(now(), operationId);
    const states = this.db.prepare('SELECT source_status,reciprocal_status FROM intercompany_operations_v2 WHERE id=?').get(operationId);
    if (states.source_status === 'approved' && states.reciprocal_status === 'approved') {
      const openMismatch = this.db.prepare("SELECT 1 FROM intercompany_mismatches_v2 WHERE operation_id=? AND status='open'").get(operationId);
      this.db.prepare('UPDATE intercompany_operations_v2 SET status=?,updated_at=? WHERE id=?').run(openMismatch ? 'mismatched' : 'approved', now(), operationId);
    }
    return this.getOperation(operationId, ctx);
  }

  detectMismatches(operationId, ctx = {}) {
    const operation = this.getOperation(operationId, ctx);
    if (!operation) throw new IntercompanyError('Operation not found', 'INTERCOMPANY_OPERATION_NOT_FOUND', 404);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO intercompany_mismatches_v2(id,operation_id,mismatch_type,source_value,reciprocal_value,difference_amount,severity,status,detected_at) VALUES(?,?,?,?,?,?,?,'open',?)`);
    const difference = Math.abs(operation.sourceAmount - operation.reciprocalAmount);
    if (difference > 0.0001) insert.run(id('icm'), operationId, 'amount', String(operation.sourceAmount), String(operation.reciprocalAmount), difference, difference > Math.max(1, operation.sourceAmount * 0.05) ? 'critical' : 'warning', now());
    if (!operation.reciprocalDocumentId) insert.run(id('icm'), operationId, 'missing_reciprocal', operation.sourceDocumentId, null, operation.sourceAmount, 'critical', now());
    const open = this.db.prepare("SELECT COUNT(*) AS count FROM intercompany_mismatches_v2 WHERE operation_id=? AND status='open'").get(operationId).count;
    if (open) this.db.prepare("UPDATE intercompany_operations_v2 SET status='mismatched',updated_at=? WHERE id=?").run(now(), operationId);
    return this.getOperation(operationId, ctx).mismatches;
  }

  reconcile(input, ctx = {}) {
    const operation = this.getOperation(input.operationId, ctx);
    const mismatch = operation?.mismatches.find((item) => item.id === input.mismatchId && item.status === 'open');
    if (!mismatch || !input.notes) throw new IntercompanyError('Open mismatch and notes are required', 'INVALID_INTERCOMPANY_RECONCILIATION');
    const reconciliationId = id('icrec');
    this.db.prepare(`INSERT INTO intercompany_reconciliations_v2(id,operation_id,mismatch_id,resolution_type,resolution_amount,notes,status,approved_by,approved_at) VALUES(?,?,?,?,?,?,'approved',?,?)`).run(reconciliationId, operation.id, mismatch.id, input.resolutionType || 'reciprocal_correction', n(input.resolutionAmount), input.notes, ctx.userId || ctx.actorId || 'system', now());
    this.db.prepare("UPDATE intercompany_mismatches_v2 SET status='reconciled',resolved_at=? WHERE id=?").run(now(), mismatch.id);
    if (mismatch.mismatchType === 'amount' && input.correctedReciprocalAmount !== undefined) this.db.prepare('UPDATE intercompany_operations_v2 SET reciprocal_amount=?,due_to_amount=? WHERE id=?').run(n(input.correctedReciprocalAmount), n(input.correctedReciprocalAmount), operation.id);
    const remaining = this.db.prepare("SELECT 1 FROM intercompany_mismatches_v2 WHERE operation_id=? AND status='open'").get(operation.id);
    this.db.prepare('UPDATE intercompany_operations_v2 SET status=?,updated_at=? WHERE id=?').run(remaining ? 'mismatched' : 'reconciled', now(), operation.id);
    return { id: reconciliationId, operationId: operation.id, mismatchId: mismatch.id, status: 'approved', operationalLedgerWritten: false };
  }

  proposeSettlement(operationId, input = {}, ctx = {}) {
    const operation = this.getOperation(operationId, ctx);
    if (!operation || !['approved', 'reconciled'].includes(operation.status)) throw new IntercompanyError('Approved or reconciled operation required', 'INTERCOMPANY_NOT_RECONCILED', 409);
    const settlementId = id('icset');
    this.db.prepare(`INSERT INTO intercompany_settlement_proposals(id,operation_id,payer_company_id,payee_company_id,amount,currency,requested_date,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?,?)`).run(settlementId, operation.id, operation.targetCompanyId, operation.sourceCompanyId, n(input.amount || operation.dueToAmount), operation.currency, input.requestedDate || now().slice(0, 10), ctx.userId || ctx.actorId || 'system', now());
    this.db.prepare("UPDATE intercompany_operations_v2 SET status='settlement_proposed',updated_at=? WHERE id=?").run(now(), operation.id);
    return { id: settlementId, operationId: operation.id, payerCompanyId: operation.targetCompanyId, payeeCompanyId: operation.sourceCompanyId, amount: n(input.amount || operation.dueToAmount), currency: operation.currency, status: 'proposed', paymentExecuted: false };
  }

  #assertParticipant(a, b, ctx) {
    const active = ctx.companyId || ctx.activeCompanyId;
    if (!active || ![a, b].includes(active)) throw new IntercompanyError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
  }
  #assertDirection(relationship, source, target) {
    if (!((relationship.companyAId === source && relationship.companyBId === target) || (relationship.companyBId === source && relationship.companyAId === target))) throw new IntercompanyError('Companies are outside the relationship', 'RELATIONSHIP_DIRECTION_DENIED', 403);
  }
}

export function createIntercompanyOperationsService(dialect) { return new IntercompanyOperationsService(dialect); }
