import crypto from 'node:crypto';
import { createSalesReturn, getSaleOrder } from './lifecycle.mjs';

function fail(message, code) { const error = new Error(message); error.code = code; throw error; }
function id(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function scopedCase(db, rmaId, companyId) {
  const row = db.prepare('SELECT * FROM commercial_rma_cases WHERE id = ? AND company_id = ?').get(rmaId, companyId);
  if (!row) fail('RMA case not found', 'RMA_NOT_FOUND');
  return row;
}

export function createRmaCase(db, input) {
  const { order_id, lines = [], reason = '', company_id, branch_id = null, actor, idempotency_key } = input;
  const order = getSaleOrder(db, order_id, company_id);
  if (!order || order.state !== 'sale') fail('RMA requires a confirmed sales order', 'RMA_ORDER_NOT_CONFIRMED');
  if (!Array.isArray(lines) || lines.length === 0) fail('RMA lines are required', 'RMA_LINES_REQUIRED');
  const existing = db.prepare('SELECT * FROM commercial_rma_cases WHERE company_id = ? AND idempotency_key = ?').get(company_id, idempotency_key);
  if (existing) return { rma: existing, replay: true };
  const now = new Date().toISOString();
  const rmaId = id('rma');
  db.prepare('INSERT INTO commercial_rma_cases (id,company_id,branch_id,sale_order_id,state,reason,actor,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(rmaId, company_id, branch_id, order_id, 'draft', String(reason), actor, idempotency_key, now, now);
  const lineInsert = db.prepare('INSERT INTO commercial_rma_lines (id,rma_id,sale_order_line_id,quantity,reason) VALUES (?,?,?,?,?)');
  for (const line of lines) {
    if (!order.lines.some((candidate) => candidate.id === line.sale_order_line_id)) fail('RMA line is outside the sales order', 'RMA_LINE_NOT_FOUND');
    if (!(Number(line.quantity) > 0)) fail('RMA quantity must be positive', 'RMA_INVALID_QUANTITY');
    lineInsert.run(id('rmal'), rmaId, line.sale_order_line_id, Number(line.quantity), String(line.reason || reason));
  }
  return { rma: scopedCase(db, rmaId, company_id), lines: db.prepare('SELECT * FROM commercial_rma_lines WHERE rma_id = ?').all(rmaId) };
}
export function submitRmaCase(db, input) { const row = scopedCase(db, input.rma_id, input.company_id); if (row.state !== 'draft') fail('Only draft RMA cases can be submitted', 'RMA_STATE_INVALID'); db.prepare("UPDATE commercial_rma_cases SET state='submitted', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id); return scopedCase(db, row.id, input.company_id); }
export function approveRmaCase(db, input) { const row = scopedCase(db, input.rma_id, input.company_id); if (row.state !== 'submitted') fail('Only submitted RMA cases can be approved', 'RMA_STATE_INVALID'); db.prepare("UPDATE commercial_rma_cases SET state='approved', updated_at=? WHERE id=?").run(new Date().toISOString(), row.id); return scopedCase(db, row.id, input.company_id); }
export function postRmaReturn(db, input) {
  const row = scopedCase(db, input.rma_id, input.company_id);
  if (row.state !== 'approved') fail('Only approved RMA cases can post a return', 'RMA_STATE_INVALID');
  const lines = db.prepare('SELECT sale_order_line_id, quantity, reason FROM commercial_rma_lines WHERE rma_id = ?').all(row.id);
  const result = createSalesReturn(db, { order_id: row.sale_order_id, warehouse_id: input.warehouse_id, lines, reason: row.reason, company_id: input.company_id, branch_id: input.branch_id, actor: input.actor, idempotency_key: input.idempotency_key });
  db.prepare("UPDATE commercial_rma_cases SET state='returned', posted_sale_return_id=?, updated_at=? WHERE id=?").run(result.sale_return.id, new Date().toISOString(), row.id);
  return { rma: scopedCase(db, row.id, input.company_id), sale_return: result };
}
