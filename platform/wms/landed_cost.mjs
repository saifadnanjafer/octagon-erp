import crypto from 'node:crypto';
import { appendLandedCostAdjustment, getProductValuation } from '../inventory/valuation.mjs';

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

export function postLandedCost(db, {
  landed_cost_id,
  receipt_move_ids = [],
  product_ids = [],
  allocation_basis = {},
  currency = 'IQD',
}) {
  const lc = getLandedCost(db, landed_cost_id);
  if (!lc) throw new Error(`Landed cost not found: ${landed_cost_id}`);
  if (lc.state === 'posted') throw new Error('Landed cost is already posted');

  const totalCost = lc.cost_lines.reduce((sum, l) => sum + l.amount, 0);
  if (!(totalCost > 0)) throw new Error('Landed cost requires a positive cost total');

  let receipts = [];
  if (receipt_move_ids.length) {
    const getReceipt = db.prepare(`
      SELECT sm.* FROM stock_moves sm
      JOIN stock_locations src ON src.id = sm.location_id
      JOIN stock_locations dst ON dst.id = sm.location_dest_id
      WHERE sm.id = ? AND sm.company_id = ?
        AND src.usage != 'internal' AND dst.usage = 'internal'
        AND sm.state = 'done'
    `);
    receipts = receipt_move_ids.map((id) => getReceipt.get(id, lc.company_id));
  } else {
    const latestReceipt = db.prepare(`
      SELECT sm.* FROM stock_moves sm
      JOIN stock_locations src ON src.id = sm.location_id
      JOIN stock_locations dst ON dst.id = sm.location_dest_id
      WHERE sm.company_id = ? AND sm.product_id = ?
        AND src.usage != 'internal' AND dst.usage = 'internal'
        AND sm.state = 'done'
      ORDER BY sm.move_date DESC, sm.created_at DESC LIMIT 1
    `);
    receipts = product_ids.map((productId) => latestReceipt.get(lc.company_id, productId));
  }
  if (receipts.some((row) => !row) || !receipts.length) {
    throw new Error('Landed cost must link to executed receipt moves');
  }

  const split = lc.split_method || 'by_quantity';
  const candidates = receipts.map((receipt) => {
    const valuation = getProductValuation(db, { company_id: lc.company_id, product_id: receipt.product_id });
    let basis;
    if (split === 'equal') basis = 1;
    else if (split === 'by_quantity') basis = Number(receipt.product_qty);
    else if (split === 'by_current_value') basis = Number(valuation.inventory_value);
    else if (['by_weight', 'by_volume', 'approved_custom'].includes(split)) {
      basis = Number(allocation_basis[receipt.id] ?? allocation_basis[receipt.product_id]);
    } else {
      throw new Error(`Unsupported landed cost split method: ${split}`);
    }
    if (!(basis > 0)) throw new Error(`Missing positive ${split} basis for receipt ${receipt.id}`);
    return { receipt, basis };
  });
  const totalBasis = candidates.reduce((sum, row) => sum + row.basis, 0);
  const now = new Date().toISOString();
  let allocated = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const { receipt, basis } = candidates[index];
    const value = index === candidates.length - 1
      ? totalCost - allocated
      : (totalCost * basis) / totalBasis;
    allocated += value;
    const fact = appendLandedCostAdjustment(db, {
      company_id: lc.company_id,
      product_id: receipt.product_id,
      stock_move_id: receipt.id,
      value,
      currency,
      effective_at: now,
    });
    db.prepare(`
      INSERT INTO landed_cost_allocations (
        id, landed_cost_id, company_id, receipt_move_id, product_id,
        basis_type, basis_value, allocated_value, valuation_fact_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId('lca'),
      landed_cost_id,
      lc.company_id,
      receipt.id,
      receipt.product_id,
      split,
      basis,
      value,
      fact.id,
      now,
    );
  }

  db.prepare("UPDATE landed_costs SET state = 'posted' WHERE id = ?").run(landed_cost_id);
  return {
    ...getLandedCost(db, landed_cost_id),
    allocations: db.prepare('SELECT * FROM landed_cost_allocations WHERE landed_cost_id = ? ORDER BY id').all(landed_cost_id),
  };
}
