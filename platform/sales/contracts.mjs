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
    recurring_amount = 0.0,
  } = contractData;

  if (!name || !partner_id) throw new Error('Contract name and partner_id are required');
  const id = makeId('cntr');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sale_contracts (id, company_id, name, partner_id, sale_order_id, state, start_date, end_date, recurring_amount, created_at)
    VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?)
  `).run(id, company_id, name, partner_id, sale_order_id, start_date, end_date, Number(recurring_amount), now);

  return db.prepare(`SELECT * FROM sale_contracts WHERE id = ?`).get(id);
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
