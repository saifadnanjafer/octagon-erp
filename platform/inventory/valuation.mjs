import crypto from 'node:crypto';

function makeId(prefix = 'svf') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function productPolicy(db, productId) {
  const row = db.prepare(`
    SELECT v.id, v.standard_price, t.category_id, c.costing_method
    FROM product_variants v
    JOIN product_templates t ON t.id = v.template_id
    LEFT JOIN product_categories c ON c.id = t.category_id
    WHERE v.id = ?
  `).get(productId);
  if (!row) throw new Error(`Product variant not found: ${productId}`);
  return { ...row, costing_method: row.costing_method === 'fifo' ? 'fifo' : 'avco' };
}

function locationUsage(db, locationId) {
  return db.prepare('SELECT usage FROM stock_locations WHERE id = ?').get(locationId)?.usage || null;
}

function isInternal(usage) {
  return usage === 'internal' || usage === 'transit';
}

function currentProjection(db, companyId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity,
           COALESCE(SUM(value), 0) AS value
    FROM stock_valuation_facts
    WHERE company_id = ? AND product_id = ?
  `).get(companyId, productId);
  return { quantity: Number(row.quantity || 0), value: Number(row.value || 0) };
}

function appendFact(db, fact) {
  const id = fact.id || makeId();
  db.prepare(`
    INSERT INTO stock_valuation_facts (
      id, company_id, product_id, stock_move_id, fact_type, quantity,
      unit_cost, value, costing_method, currency, reversal_of_fact_id,
      effective_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    fact.company_id,
    fact.product_id,
    fact.stock_move_id || null,
    fact.fact_type,
    Number(fact.quantity),
    Number(fact.unit_cost),
    Number(fact.value),
    fact.costing_method,
    fact.currency || 'IQD',
    fact.reversal_of_fact_id || null,
    fact.effective_at,
    fact.created_at,
  );

  // Read-only compatibility row for historical reports. It is never updated;
  // the authoritative balance is the sum of stock_valuation_facts.
  if (fact.stock_move_id) {
    db.prepare(`
      INSERT INTO stock_valuation_layers (
        id, company_id, product_id, stock_move_id, quantity, unit_cost, value,
        remaining_qty, remaining_value, costing_method, account_move_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      `compat_${id}`,
      fact.company_id,
      fact.product_id,
      fact.stock_move_id,
      Number(fact.quantity),
      Number(fact.unit_cost),
      Number(fact.value),
      Number(fact.quantity),
      Number(fact.value),
      fact.costing_method,
      fact.created_at,
    );
  }
  return { id, ...fact };
}

function fifoReceiptAvailability(db, companyId, productId) {
  return db.prepare(`
    SELECT
      receipt.id,
      receipt.unit_cost,
      receipt.effective_at,
      receipt.created_at,
      receipt.quantity - COALESCE(SUM(consumption.quantity), 0) AS available_quantity
    FROM stock_valuation_facts receipt
    LEFT JOIN stock_fifo_consumptions consumption
      ON consumption.receipt_fact_id = receipt.id
    WHERE receipt.company_id = ?
      AND receipt.product_id = ?
      AND receipt.costing_method = 'fifo'
      AND receipt.fact_type IN ('receipt','return','adjustment')
      AND receipt.quantity > 0
    GROUP BY receipt.id
    HAVING available_quantity > 0
    ORDER BY receipt.effective_at, receipt.created_at, receipt.id
  `).all(companyId, productId);
}

function appendFifoIssue(db, base, quantity) {
  const layers = fifoReceiptAvailability(db, base.company_id, base.product_id);
  let remaining = quantity;
  const allocations = [];
  for (const layer of layers) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(layer.available_quantity));
    allocations.push({
      receipt_fact_id: layer.id,
      quantity: take,
      unit_cost: Number(layer.unit_cost),
      value: take * Number(layer.unit_cost),
    });
    remaining -= take;
  }
  if (remaining > 0.0000001) {
    throw new Error(`FIFO layers insufficient by ${remaining}`);
  }

  const totalValue = allocations.reduce((sum, row) => sum + row.value, 0);
  const issue = appendFact(db, {
    ...base,
    fact_type: 'issue',
    quantity: -quantity,
    unit_cost: totalValue / quantity,
    value: -totalValue,
    costing_method: 'fifo',
  });
  const insert = db.prepare(`
    INSERT INTO stock_fifo_consumptions (
      id, company_id, issue_fact_id, receipt_fact_id, quantity,
      unit_cost, value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of allocations) {
    insert.run(
      makeId('fifo'),
      base.company_id,
      issue.id,
      row.receipt_fact_id,
      row.quantity,
      row.unit_cost,
      row.value,
      base.created_at,
    );
  }
  return issue;
}

export function recordValuationLayer(db, {
  moveId,
  company_id,
  product_id,
  quantity,
  unitCost,
  location_id,
  location_dest_id,
  currency = 'IQD',
  move_date = null,
  reversal_of_fact_id = null,
}) {
  const policy = productPolicy(db, product_id);
  const fromUsage = locationUsage(db, location_id);
  const toUsage = locationUsage(db, location_dest_id);
  const entering = !isInternal(fromUsage) && isInternal(toUsage);
  const leaving = isInternal(fromUsage) && !isInternal(toUsage);
  if (!entering && !leaving) return null;

  const qty = Number(quantity);
  const now = new Date().toISOString();
  const base = {
    company_id,
    product_id,
    stock_move_id: moveId,
    currency,
    effective_at: move_date || now,
    created_at: now,
    reversal_of_fact_id,
  };

  if (entering) {
    const cost = Number(unitCost);
    if (!(cost >= 0)) throw new Error('Incoming stock requires a valid unit cost');
    return appendFact(db, {
      ...base,
      fact_type: reversal_of_fact_id ? 'return' : 'receipt',
      quantity: qty,
      unit_cost: cost,
      value: qty * cost,
      costing_method: policy.costing_method,
    });
  }

  if (policy.costing_method === 'fifo') {
    return appendFifoIssue(db, base, qty);
  }

  const projection = currentProjection(db, company_id, product_id);
  if (projection.quantity + 0.0000001 < qty) {
    throw new Error(`AVCO valuation quantity insufficient by ${qty - projection.quantity}`);
  }
  const averageCost = projection.quantity > 0
    ? projection.value / projection.quantity
    : Number(policy.standard_price || unitCost || 0);
  return appendFact(db, {
    ...base,
    fact_type: 'issue',
    quantity: -qty,
    unit_cost: averageCost,
    value: -(qty * averageCost),
    costing_method: 'avco',
  });
}

export function appendLandedCostAdjustment(db, {
  company_id,
  product_id,
  stock_move_id = null,
  value,
  currency = 'IQD',
  effective_at = null,
}) {
  const policy = productPolicy(db, product_id);
  const projection = currentProjection(db, company_id, product_id);
  if (!(projection.quantity > 0)) throw new Error('Landed cost requires positive on-hand valuation quantity');
  const amount = Number(value);
  if (!(amount > 0)) throw new Error('Landed cost adjustment must be positive');
  const now = new Date().toISOString();
  return appendFact(db, {
    company_id,
    product_id,
    stock_move_id,
    fact_type: 'landed_cost',
    quantity: 0,
    unit_cost: amount / projection.quantity,
    value: amount,
    costing_method: policy.costing_method,
    currency,
    effective_at: effective_at || now,
    created_at: now,
  });
}

export function getProductValuation(db, { company_id = '*', product_id }) {
  const projection = currentProjection(db, company_id, product_id);
  return {
    product_id,
    inventory_qty: projection.quantity,
    inventory_value: projection.value,
    on_hand_qty: projection.quantity,
    total_valuation: projection.value,
    unit_cost: projection.quantity > 0 ? projection.value / projection.quantity : 0,
  };
}
