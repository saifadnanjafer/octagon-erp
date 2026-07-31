// platform/domains/returns/rma.mjs — Canonical Returns & RMA orchestration authority.
//
// This module owns ONLY the RMA lifecycle, lines, and timeline (schema:
// database/migrations/084_returns_rma_consolidation.mjs). It does not own
// stock balances, posted stock movements, GL entries, credit notes, payments,
// Service Tickets, Assets, serial masters, or Quality NCR/CAPA facts — every
// disposition effect below calls the real canonical authority for that fact
// instead of re-implementing or faking it. A canonical call that fails
// propagates a real error; it is never replaced with a fabricated reference
// id, because a fabricated id would make the RMA claim a side effect that
// never happened.

'use strict';

import crypto from 'node:crypto';
import { createReceiptDraft, validateReturn } from '../../inventory/wms_workflows.mjs';
import { createNCR } from '../../quality/ncr-capa.mjs';
import { createWorkItemLifecycle } from '../../work_items/lifecycle.mjs';
import { createCreditNote, getDocument } from '../../finance/engine.mjs';
import { createPurchaseReturn } from '../../procurement/lifecycle.mjs';

export class ReturnsError extends Error {
  constructor(message, code = 'RETURNS_ERROR', details = {}) {
    super(message);
    this.name = 'ReturnsError';
    this.code = code;
    this.details = details;
  }
}

const VALID_DISPOSITIONS = ['repair', 'replace', 'refund', 'return_to_supplier', 'refurbish', 'scrap'];
const RECEIPT_ALLOWED_STATES = ['approved', 'awaiting_receipt', 'submitted'];

function nowISO() {
  return new Date().toISOString();
}

function makeId(prefix = 'rma') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function requireContext(ctx) {
  if (!ctx || !ctx.companyId) {
    throw new ReturnsError('server-derived companyId is required', 'MISSING_CONTEXT');
  }
  return {
    companyId: ctx.companyId,
    branchId: ctx.branchId || null,
    userId: ctx.userId || ctx.actorId || 'system',
  };
}

function recordTimeline(db, rmaId, action, actor, details = {}) {
  const id = makeId('rmatl');
  db.prepare(`
    INSERT INTO returns_rma_timeline (id, rma_id, action, actor, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, rmaId, action, actor || 'system', JSON.stringify(details), nowISO());
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function createRMA(db, payload, ctx = {}) {
  const { companyId, branchId, userId } = requireContext(ctx);
  const {
    source_type = 'customer_return',
    customer_id,
    customer_name = '',
    supplier_id = null,
    source_document_id = null,
    source_document_number = '',
    purchase_order_id = null,
    warehouse_id = null,
    lines = [],
    notes = '',
    idempotency_key = null,
  } = payload;

  if (idempotency_key) {
    const existing = db.prepare(
      'SELECT id FROM returns_rma WHERE company_id = ? AND idempotency_key = ?'
    ).get(companyId, idempotency_key);
    if (existing) return getRMA(db, existing.id);
  }

  if (source_type === 'customer_return' && !customer_id) {
    throw new ReturnsError('customer_id is required for a customer return', 'MISSING_CUSTOMER');
  }
  if (source_type === 'supplier_return' && !purchase_order_id) {
    throw new ReturnsError('purchase_order_id is required for a supplier return', 'MISSING_PURCHASE_ORDER');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ReturnsError('at least one return line is required', 'EMPTY_LINES');
  }
  for (const line of lines) {
    if (!line.product_id || !line.product_name) {
      throw new ReturnsError('line product_id and product_name are required', 'INVALID_LINE');
    }
    if (!line.qty_requested || line.qty_requested <= 0) {
      throw new ReturnsError(`invalid quantity ${line.qty_requested} for ${line.product_name}`, 'INVALID_QUANTITY');
    }
  }

  return withTransaction(db, () => {
    const id = makeId('rma');
    const countRow = db.prepare('SELECT COUNT(*) as c FROM returns_rma WHERE company_id = ?').get(companyId);
    const rmaNumber = `RMA-${new Date().getFullYear()}-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
    const now = nowISO();

    db.prepare(`
      INSERT INTO returns_rma (
        id, company_id, branch_id, rma_number, source_type, customer_id, customer_name,
        supplier_id, source_document_id, source_document_number, purchase_order_id,
        warehouse_id, status, created_by, notes, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
    `).run(
      id, companyId, branchId, rmaNumber, source_type, customer_id || null, customer_name,
      supplier_id, source_document_id, source_document_number, purchase_order_id,
      warehouse_id, userId, notes, idempotency_key, now, now,
    );

    const lineStmt = db.prepare(`
      INSERT INTO returns_rma_lines (
        id, rma_id, product_id, product_name, qty_requested, unit_price, reason,
        serial_number, purchase_order_line_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of lines) {
      lineStmt.run(
        makeId('rmaln'), id, line.product_id, line.product_name, line.qty_requested,
        line.unit_price || 0, line.reason || '', line.serial_number || '',
        line.purchase_order_line_id || null, now,
      );
    }

    recordTimeline(db, id, 'create', userId, { rma_number: rmaNumber, lines_count: lines.length, source_type });
    return getRMA(db, id);
  });
}

export function getRMA(db, id) {
  const rma = db.prepare('SELECT * FROM returns_rma WHERE id = ? AND is_active = 1').get(id);
  if (!rma) return null;
  const lines = db.prepare('SELECT * FROM returns_rma_lines WHERE rma_id = ?').all(id);
  const timeline = db.prepare('SELECT * FROM returns_rma_timeline WHERE rma_id = ? ORDER BY created_at ASC').all(id);
  return { ...rma, lines, timeline };
}

export function listRMAs(db, filters = {}) {
  let sql = 'SELECT * FROM returns_rma WHERE is_active = 1';
  const params = [];
  if (filters.company_id) { sql += ' AND company_id = ?'; params.push(filters.company_id); }
  if (filters.customer_id) { sql += ' AND customer_id = ?'; params.push(filters.customer_id); }
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

function requireRMA(db, id) {
  const rma = getRMA(db, id);
  if (!rma) throw new ReturnsError(`RMA ${id} not found`, 'RMA_NOT_FOUND');
  return rma;
}

function requireCompanyMatch(rma, ctx) {
  const { companyId } = requireContext(ctx);
  if (rma.company_id !== companyId) {
    throw new ReturnsError('RMA belongs to a different company', 'CROSS_COMPANY_DENIED');
  }
}

export function submitRMA(db, { id, actor }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (rma.status !== 'draft') {
    throw new ReturnsError(`cannot submit RMA in status ${rma.status}`, 'INVALID_STATE');
  }
  const userId = actor || ctx.userId || 'system';
  db.prepare("UPDATE returns_rma SET status = 'submitted', updated_at = ? WHERE id = ?").run(nowISO(), id);
  recordTimeline(db, id, 'submit', userId, { previous_status: 'draft', new_status: 'submitted' });
  return getRMA(db, id);
}

export function approveRMA(db, { id, actor, notes = '' }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (!['submitted', 'under_review'].includes(rma.status)) {
    throw new ReturnsError(`cannot approve RMA in status ${rma.status}`, 'INVALID_STATE');
  }
  const userId = actor || ctx.userId || 'system';
  const now = nowISO();
  db.prepare("UPDATE returns_rma SET status = 'awaiting_receipt', notes = ?, updated_at = ? WHERE id = ?")
    .run(notes || rma.notes, now, id);
  recordTimeline(db, id, 'approve', userId, { previous_status: rma.status, new_status: 'awaiting_receipt' });
  return getRMA(db, id);
}

export function rejectRMA(db, { id, actor, reason = '' }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (['closed', 'resolved', 'rejected'].includes(rma.status)) {
    throw new ReturnsError(`cannot reject RMA in status ${rma.status}`, 'INVALID_STATE');
  }
  const userId = actor || ctx.userId || 'system';
  db.prepare("UPDATE returns_rma SET status = 'rejected', notes = ?, updated_at = ? WHERE id = ?")
    .run(reason || rma.notes, nowISO(), id);
  recordTimeline(db, id, 'reject', userId, { reason });
  return getRMA(db, id);
}

export function recordReceipt(db, { id, location_id, location_dest_id, items, actor }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (!RECEIPT_ALLOWED_STATES.includes(rma.status)) {
    throw new ReturnsError(`cannot record receipt for RMA in status ${rma.status}`, 'INVALID_STATE');
  }
  const userId = actor || ctx.userId || 'system';

  return withTransaction(db, () => {
    let receiptPickingId = null;
    if (location_id && location_dest_id) {
      const lines = (items || rma.lines).map((l) => ({
        product_id: l.product_id,
        product_qty: l.qty_received || l.qty_requested,
        unit_price: l.unit_price || 0,
      }));
      // A failed canonical receipt is a real failure, not something to hide
      // behind a fabricated reference id — it propagates and the RMA stays
      // in its current status so the caller can retry or investigate.
      const receiptDraft = createReceiptDraft(db, {
        company_id: rma.company_id,
        location_id,
        location_dest_id,
        partner_id: rma.customer_id,
        origin: rma.rma_number,
        lines,
      });
      receiptPickingId = receiptDraft.id;
      validateReturn(db, { picking_id: receiptPickingId, actor: userId, company_id: rma.company_id });
    }

    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.line_id) {
          db.prepare('UPDATE returns_rma_lines SET qty_received = ? WHERE id = ?')
            .run(item.qty_received || item.qty_requested || 0, item.line_id);
        }
      }
    } else {
      for (const line of rma.lines) {
        db.prepare('UPDATE returns_rma_lines SET qty_received = qty_requested WHERE id = ?').run(line.id);
      }
    }

    db.prepare("UPDATE returns_rma SET status = 'under_inspection', receipt_picking_id = ?, updated_at = ? WHERE id = ?")
      .run(receiptPickingId, nowISO(), id);
    recordTimeline(db, id, 'record_receipt', userId, { receipt_picking_id: receiptPickingId });
    return getRMA(db, id);
  });
}

export function recordInspection(db, { id, condition = 'defective', passes = false, notes = '', ncr_title = '', actor }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  const userId = actor || ctx.userId || 'system';

  return withTransaction(db, () => {
    let ncrId = null;
    if (!passes || ncr_title) {
      const inspId = `insp_rma_${rma.id}`;
      const inspExists = db.prepare('SELECT id FROM quality_inspections WHERE id = ?').get(inspId);
      if (!inspExists) {
        const firstLine = rma.lines[0] || {};
        const now = nowISO();
        const countRow = db.prepare('SELECT COUNT(*) AS c FROM quality_inspections WHERE company_id = ?').get(rma.company_id);
        const inspectionNumber = `QINS-RMA-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
        db.prepare(`
          INSERT INTO quality_inspections (
            id, company_id, inspection_number, inspection_type, source_type, source_id,
            product_id, sample_size, inspected_quantity, passed_quantity, failed_quantity,
            state, inspector_id, inspected_at, notes, created_at, updated_at
          ) VALUES (?, ?, ?, 'return', 'customer_return', ?, ?, 1, 1, 0, 1, 'fail', ?, ?, ?, ?, ?)
        `).run(
          inspId, rma.company_id, inspectionNumber, rma.id,
          firstLine.product_id || 'unknown', userId, now, notes || `Condition: ${condition}`, now, now,
        );
      }
      // A failed NCR creation is a real failure — it propagates rather than
      // being replaced with a fabricated ncr_id that would claim a
      // nonconformance record exists when it does not.
      const ncrRes = createNCR(db, {
        company_id: rma.company_id,
        inspection_id: inspId,
        title: ncr_title || `RMA Inspection Failure: ${rma.rma_number}`,
        severity: 'major',
        disposition: 'hold',
        root_cause: notes || `Condition: ${condition}`,
        actor: userId,
      });
      ncrId = ncrRes.id;
    }

    db.prepare(`
      UPDATE returns_rma
      SET status = 'disposition_pending', inspection_condition = ?, inspection_notes = ?, ncr_id = ?, updated_at = ?
      WHERE id = ?
    `).run(condition, notes, ncrId, nowISO(), id);

    recordTimeline(db, id, 'record_inspection', userId, { condition, passes, ncr_id: ncrId });
    return getRMA(db, id);
  });
}

export function recordDisposition(db, { id, disposition, notes = '', actor }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (!VALID_DISPOSITIONS.includes(disposition)) {
    throw new ReturnsError(`invalid disposition ${disposition}`, 'INVALID_DISPOSITION');
  }
  const userId = actor || ctx.userId || 'system';
  const canonicalCtx = { companyId: rma.company_id, branchId: rma.branch_id, userId };

  return withTransaction(db, () => {
    let workItemId = rma.work_item_id;
    let creditNoteDocumentId = rma.credit_note_document_id;
    let supplierReturnId = rma.supplier_return_id;

    if (disposition === 'repair' && !workItemId) {
      // Real canonical Work Item — not a raw insert into work_items.
      const wi = createWorkItemLifecycle(db, {
        company_id: rma.company_id,
        title: `RMA Repair: ${rma.rma_number}`,
        type: 'service_task',
        priority: 'high',
        description: `Customer: ${rma.customer_name}. Notes: ${notes}`,
        quality_ref: rma.ncr_id || null,
        actor: userId,
      });
      workItemId = wi.id;
    } else if (disposition === 'refund' && !creditNoteDocumentId) {
      if (!rma.source_document_id) {
        throw new ReturnsError(
          'a refund disposition requires the RMA to reference a posted source finance document (source_document_id)',
          'SOURCE_DOCUMENT_REQUIRED_FOR_REFUND',
        );
      }
      // Real canonical credit-note request against Finance — never a
      // fabricated reference. A credit note reverses the original document's
      // own posted GL lines (debit/credit swapped); it cannot be derived from
      // RMA product lines, which carry no account_id.
      const original = getDocument(db, rma.company_id, rma.source_document_id);
      if (!original) {
        throw new ReturnsError('the RMA source finance document no longer exists', 'SOURCE_DOCUMENT_NOT_FOUND');
      }
      const creditNote = createCreditNote(db, canonicalCtx, {
        original_document_id: rma.source_document_id,
        lines: original.lines.map((l) => ({
          account_id: l.account_id,
          debit: l.credit,
          credit: l.debit,
          partner_id: l.partner_id,
          description: `RMA ${rma.rma_number}: ${l.description || ''}`,
        })),
      });
      creditNoteDocumentId = creditNote.id;
    } else if (disposition === 'return_to_supplier' && !supplierReturnId) {
      if (!rma.purchase_order_id || !rma.warehouse_id) {
        throw new ReturnsError(
          'a return_to_supplier disposition requires purchase_order_id and warehouse_id on the RMA',
          'PURCHASE_ORDER_REQUIRED_FOR_SUPPLIER_RETURN',
        );
      }
      // Real canonical supplier return — stock issue + supplier claim via
      // Procurement, never a fabricated reference.
      const supplierReturn = createPurchaseReturn(db, {
        purchase_order_id: rma.purchase_order_id,
        warehouse_id: rma.warehouse_id,
        company_id: rma.company_id,
        branch_id: rma.branch_id,
        actor: userId,
        reason: notes || `RMA ${rma.rma_number}`,
        lines: rma.lines.map((l) => ({
          purchase_order_line_id: l.purchase_order_line_id,
          quantity: l.qty_received || l.qty_requested,
        })),
      });
      supplierReturnId = supplierReturn.id;
    }
    // replace / refurbish / scrap: the disposition decision is recorded
    // honestly below with no side-effect reference, since canonical
    // execution for those three is not wired in this slice (see
    // docs/evidence/commercial-operations-closure/returns-rma/deferred-hardening.md).
    // No fabricated id is stored for an effect that did not happen.

    db.prepare(`
      UPDATE returns_rma
      SET status = 'resolved', disposition = ?, work_item_id = ?, credit_note_document_id = ?, supplier_return_id = ?, updated_at = ?
      WHERE id = ?
    `).run(disposition, workItemId, creditNoteDocumentId, supplierReturnId, nowISO(), id);

    recordTimeline(db, id, 'record_disposition', userId, {
      disposition, work_item_id: workItemId, credit_note_document_id: creditNoteDocumentId, supplier_return_id: supplierReturnId,
    });
    return getRMA(db, id);
  });
}

export function closeRMA(db, { id, actor }, ctx = {}) {
  const rma = requireRMA(db, id);
  if (ctx.companyId) requireCompanyMatch(rma, ctx);
  if (rma.status !== 'resolved') {
    throw new ReturnsError(`cannot close RMA in status ${rma.status}`, 'INVALID_STATE');
  }
  const userId = actor || ctx.userId || 'system';
  db.prepare("UPDATE returns_rma SET status = 'closed', updated_at = ? WHERE id = ?").run(nowISO(), id);
  recordTimeline(db, id, 'close', userId, { previous_status: 'resolved', new_status: 'closed' });
  return getRMA(db, id);
}
