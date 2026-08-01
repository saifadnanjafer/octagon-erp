import crypto from 'node:crypto';
const id = () => `wty_${crypto.randomBytes(8).toString('hex')}`;
function get(db, warrantyId, companyId) { const row = db.prepare('SELECT * FROM commercial_warranty_cases WHERE id = ? AND company_id = ?').get(warrantyId, companyId); if (!row) throw new Error('Warranty case not found'); return row; }
export function createWarrantyCase(db, input) {
  const { company_id, branch_id = null, sale_order_id, product_id = null, issue, actor = 'system', idempotency_key } = input;
  if (!sale_order_id || !String(issue || '').trim()) throw new Error('sale_order_id and issue are required');
  const existing = idempotency_key && db.prepare('SELECT * FROM commercial_warranty_cases WHERE company_id = ? AND idempotency_key = ?').get(company_id, idempotency_key);
  if (existing) return { warranty: existing, replay: true };
  const now = new Date().toISOString(); const warrantyId = id();
  db.prepare('INSERT INTO commercial_warranty_cases (id,company_id,branch_id,sale_order_id,product_id,state,issue,resolution,idempotency_key,actor,created_at,updated_at) VALUES (?,?,?,?,?,\'draft\',?,?,?, ?,?,?)').run(warrantyId, company_id, branch_id, sale_order_id, product_id, String(issue).trim(), '', idempotency_key || warrantyId, actor, now, now);
  return { warranty: get(db, warrantyId, company_id), replay: false };
}
function transition(db, input, next, allowed, resolution = null) { const row = get(db, input.warranty_id, input.company_id); if (!allowed.includes(row.state)) throw new Error(`Warranty state ${row.state} cannot transition to ${next}`); const now = new Date().toISOString(); db.prepare('UPDATE commercial_warranty_cases SET state = ?, resolution = COALESCE(?, resolution), updated_at = ? WHERE id = ?').run(next, resolution, now, row.id); return { warranty: get(db, row.id, input.company_id) }; }
export const submitWarrantyCase = (db, input) => transition(db, input, 'submitted', ['draft']);
export const approveWarrantyCase = (db, input) => transition(db, input, 'approved', ['submitted']);
export const closeWarrantyCase = (db, input) => transition(db, input, 'closed', ['approved'], input.resolution || 'resolved');
