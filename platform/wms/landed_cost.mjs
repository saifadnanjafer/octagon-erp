import crypto from 'node:crypto';

function makeId(prefix = 'lc') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createLandedCost(db, { company_id = '*', name, vendor_bill_id = null, split_method = 'by_quantity', cost_lines = [] }) {
  if (!name) throw new Error('Landed cost name is required');
  const id = makeId('lc');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO landed_costs (id, company_id, name, vendor_bill_id, split_method, state, created_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?)
  `).run(id, company_id, name, vendor_bill_id, split_method, now);

  const insertLine = db.prepare(`
    INSERT INTO landed_cost_lines (id, landed_cost_id, cost_type, amount, account_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const line of cost_lines) {
    insertLine.run(makeId('lcline'), id, line.cost_type || 'freight', Number(line.amount || 0), line.account_id || '', now);
  }

  return getLandedCost(db, id);
}

export function getLandedCost(db, id) {
  const lc = db.prepare(`SELECT * FROM landed_costs WHERE id = ?`).get(id);
  if (!lc) return null;
  const lines = db.prepare(`SELECT * FROM landed_cost_lines WHERE landed_cost_id = ?`).all(id);
  return { ...lc, cost_lines: lines };
}

export function postLandedCost(db, { landed_cost_id, product_ids = [] }) {
  const lc = getLandedCost(db, landed_cost_id);
  if (!lc) throw new Error(`Landed cost not found: ${landed_cost_id}`);
  if (lc.state === 'posted') throw new Error('Landed cost is already posted');

  const totalCost = lc.cost_lines.reduce((sum, l) => sum + l.amount, 0);
  if (totalCost <= 0 || product_ids.length === 0) {
    db.prepare(`UPDATE landed_costs SET state = 'posted' WHERE id = ?`).run(landed_cost_id);
    return getLandedCost(db, landed_cost_id);
  }

  // Allocate cost evenly or by quantity across products
  const costPerProduct = totalCost / product_ids.length;

  for (const prodId of product_ids) {
    const layer = db.prepare(`
      SELECT * FROM stock_valuation_layers
      WHERE product_id = ? AND remaining_qty > 0
      ORDER BY created_at DESC LIMIT 1
    `).get(prodId);

    if (layer) {
      const addedUnitCost = layer.remaining_qty > 0 ? costPerProduct / layer.remaining_qty : 0;
      db.prepare(`
        UPDATE stock_valuation_layers
        SET unit_cost = unit_cost + ?, value = value + ?, remaining_value = remaining_value + ?
        WHERE id = ?
      `).run(addedUnitCost, costPerProduct, costPerProduct, layer.id);

      // Update variant standard price
      db.prepare(`
        UPDATE product_variants SET standard_price = standard_price + ? WHERE id = ?
      `).run(addedUnitCost, prodId);
    }
  }

  db.prepare(`UPDATE landed_costs SET state = 'posted' WHERE id = ?`).run(landed_cost_id);
  return getLandedCost(db, landed_cost_id);
}
