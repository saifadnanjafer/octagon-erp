import crypto from 'node:crypto';

function makeId(prefix = 'cntr') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createContract(db, contractData) {
  const {
    company_id = '*',
    name,
    partner_id,
    sale_order_id = null,
    start_date = new Date().toISOString().split('T')[0],
    end_date = null,
    recurring_amount = 0.0, branch_id = null, idempotency_key = null,
  } = contractData;

  if (!name || !partner_id) throw new Error('Contract name and partner_id are required');
  const replay = idempotency_key && db.prepare('SELECT * FROM sale_contracts WHERE company_id = ? AND idempotency_key = ?').get(company_id, idempotency_key);
  if (replay) return { contract: replay, replay: true };
  const id = makeId('cntr');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sale_contracts (id, company_id, branch_id, name, partner_id, sale_order_id, state, start_date, end_date, recurring_amount, idempotency_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, branch_id, name, partner_id, sale_order_id, start_date, end_date, Number(recurring_amount), idempotency_key || id, now, now);

  return { contract: db.prepare(`SELECT * FROM sale_contracts WHERE id = ?`).get(id), replay: false };
}

export function activateContract(db, { contract_id, company_id }) { return transition(db, contract_id, company_id, 'active', 'activated_at', ['draft', 'suspended']); }
export function suspendContract(db, { contract_id, company_id }) { return transition(db, contract_id, company_id, 'suspended', 'suspended_at', ['active']); }
export function terminateContract(db, { contract_id, company_id }) { return transition(db, contract_id, company_id, 'terminated', 'terminated_at', ['active', 'suspended']); }
function transition(db, id, companyId, next, timestampColumn, allowed) {
  const row = db.prepare('SELECT * FROM sale_contracts WHERE id = ? AND company_id = ?').get(id, companyId);
  if (!row) throw new Error('Contract not found');
  if (!allowed.includes(row.state)) throw new Error(`Contract state ${row.state} cannot transition to ${next}`);
  const now = new Date().toISOString();
  db.prepare(`UPDATE sale_contracts SET state = ?, ${timestampColumn} = ?, updated_at = ? WHERE id = ?`).run(next, now, now, id);
  return { contract: db.prepare('SELECT * FROM sale_contracts WHERE id = ?').get(id), replay: false };
}

export function createCommissionEvent(db, { company_id = '*', salesperson_id, sale_order_id, amount }) {
  if (!salesperson_id || !sale_order_id) throw new Error('Salesperson ID and sale_order_id are required');
  const id = makeId('comm');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sales_commission_events (id, company_id, salesperson_id, sale_order_id, amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, company_id, salesperson_id, sale_order_id, Number(amount), now);

  return db.prepare(`SELECT * FROM sales_commission_events WHERE id = ?`).get(id);
}
