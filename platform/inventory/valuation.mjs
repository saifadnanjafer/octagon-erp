import crypto from 'node:crypto';

function makeId(prefix = 'svl') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function recordValuationLayer(db, { moveId, company_id, product_id, quantity, unitCost, location_id, location_dest_id }) {
  const variant = db.prepare(`
    SELECT v.*, t.category_id FROM product_variants v
    JOIN product_templates t ON v.template_id = t.id
    WHERE v.id = ?
  `).get(product_id);

  if (!variant) return;

  const category = db.prepare(`SELECT * FROM product_categories WHERE id = ?`).get(variant.category_id);
  const costingMethod = category ? category.costing_method : 'avco';
  const now = new Date().toISOString();

  // Check location usage to determine if incoming (supplier -> internal) or outgoing (internal -> customer)
  const locFrom = db.prepare(`SELECT usage FROM stock_locations WHERE id = ?`).get(location_id);
  const locTo = db.prepare(`SELECT usage FROM stock_locations WHERE id = ?`).get(location_dest_id);

  const isIncoming = locFrom && locFrom.usage === 'supplier';
  const isOutgoing = locTo && locTo.usage === 'customer';

  if (costingMethod === 'avco') {
    const existingVal = db.prepare(`
      SELECT SUM(remaining_qty) as total_qty, SUM(remaining_value) as total_val
      FROM stock_valuation_layers
      WHERE product_id = ? AND (company_id = ? OR company_id = '*' OR ? = '*')
    `).get(product_id, company_id, company_id);

    // Clear previous running totals for AVCO so SUM(remaining_qty) reflects current net balance
    db.prepare(`
      UPDATE stock_valuation_layers SET remaining_qty = 0, remaining_value = 0
      WHERE product_id = ? AND costing_method = 'avco' AND (company_id = ? OR company_id = '*' OR ? = '*')
    `).run(product_id, company_id, company_id);

    const prevQty = existingVal && existingVal.total_qty ? existingVal.total_qty : 0.0;
    const prevVal = existingVal && existingVal.total_val ? existingVal.total_val : 0.0;

    let newQty = prevQty;
    let newVal = prevVal;
    let actualUnitCost = unitCost;

    if (isIncoming) {
      newQty = prevQty + quantity;
      newVal = prevVal + (quantity * unitCost);
      actualUnitCost = newQty > 0 ? newVal / newQty : unitCost;
      // Update variant standard price with AVCO
      db.prepare(`UPDATE product_variants SET standard_price = ? WHERE id = ?`).run(actualUnitCost, product_id);
    } else if (isOutgoing) {
      actualUnitCost = prevQty > 0 ? prevVal / prevQty : (variant.standard_price || unitCost);
      newQty = prevQty - quantity;
      newVal = prevVal - (quantity * actualUnitCost);
    }

    const svlId = makeId('svl');
    const layerValue = isOutgoing ? -(quantity * actualUnitCost) : (quantity * unitCost);

    db.prepare(`
      INSERT INTO stock_valuation_layers (
        id, company_id, product_id, stock_move_id, quantity, unit_cost, value,
        remaining_qty, remaining_value, costing_method, account_move_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'avco', NULL, ?)
    `).run(svlId, company_id, product_id, moveId, isOutgoing ? -quantity : quantity, actualUnitCost, layerValue, newQty, newVal, now);

  } else if (costingMethod === 'fifo') {
    // First-In First-Out calculation
    if (isIncoming) {
      const svlId = makeId('svl');
      const layerValue = quantity * unitCost;
      db.prepare(`
        INSERT INTO stock_valuation_layers (
          id, company_id, product_id, stock_move_id, quantity, unit_cost, value,
          remaining_qty, remaining_value, costing_method, account_move_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fifo', NULL, ?)
      `).run(svlId, company_id, product_id, moveId, quantity, unitCost, layerValue, quantity, layerValue, now);
    } else if (isOutgoing) {
      // Deplete oldest open FIFO layers
      let qtyToConsume = quantity;
      const openLayers = db.prepare(`
        SELECT * FROM stock_valuation_layers
        WHERE product_id = ? AND remaining_qty > 0 AND (company_id = ? OR company_id = '*' OR ? = '*')
        ORDER BY created_at ASC
      `).all(product_id, company_id, company_id);

      let totalOutValue = 0;
      for (const layer of openLayers) {
        if (qtyToConsume <= 0) break;
        const takeQty = Math.min(qtyToConsume, layer.remaining_qty);
        const takeVal = takeQty * layer.unit_cost;

        db.prepare(`
          UPDATE stock_valuation_layers
          SET remaining_qty = remaining_qty - ?, remaining_value = remaining_value - ?
          WHERE id = ?
        `).run(takeQty, takeVal, layer.id);

        qtyToConsume -= takeQty;
        totalOutValue += takeVal;
      }

      const svlId = makeId('svl');
      const unitOutCost = quantity > 0 ? totalOutValue / quantity : 0;

      db.prepare(`
        INSERT INTO stock_valuation_layers (
          id, company_id, product_id, stock_move_id, quantity, unit_cost, value,
          remaining_qty, remaining_value, costing_method, account_move_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'fifo', NULL, ?)
      `).run(svlId, company_id, product_id, moveId, -quantity, unitOutCost, -totalOutValue, now);
    }
  }
}

export function getProductValuation(db, { company_id = '*', product_id }) {
  const res = db.prepare(`
    SELECT SUM(remaining_qty) as inventory_qty, SUM(remaining_value) as inventory_value
    FROM stock_valuation_layers
    WHERE product_id = ? AND (company_id = ? OR company_id = '*' OR ? = '*')
  `).get(product_id, company_id, company_id);

  const qty = res && res.inventory_qty ? res.inventory_qty : 0.0;
  const val = res && res.inventory_value ? res.inventory_value : 0.0;

  return {
    product_id,
    inventory_qty: qty,
    inventory_value: val,
    unit_cost: qty > 0 ? val / qty : 0.0,
  };
}
