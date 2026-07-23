import crypto from 'node:crypto';

function makeId(prefix = 'uom') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createUomCategory(db, { name }) {
  if (!name) throw new Error('UOM category name is required');
  const id = makeId('uomcat');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO uom_categories (id, name, created_at) VALUES (?, ?, ?)`).run(id, name, now);
  return { id, name, created_at: now };
}

export function createUom(db, { category_id, name, symbol = '', uom_type = 'reference', factor = 1.0, rounding = 0.001 }) {
  if (!category_id || !name) throw new Error('Category ID and UOM name are required');
  const id = makeId('uom');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO uoms (id, category_id, name, symbol, uom_type, factor, rounding, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, category_id, name, symbol, uom_type, Number(factor), Number(rounding), now);
  return { id, category_id, name, symbol, uom_type, factor, rounding, is_active: 1, created_at: now };
}

export function getUoms(db) {
  return db.prepare(`
    SELECT u.*, c.name as category_name FROM uoms u
    JOIN uom_categories c ON u.category_id = c.id
    WHERE u.is_active = 1
    ORDER BY c.name, u.name
  `).all();
}

export function convertUomQuantity(db, { from_uom_id, to_uom_id, qty }) {
  if (from_uom_id === to_uom_id) return Number(qty);

  const fromUom = db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(from_uom_id);
  const toUom = db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(to_uom_id);

  if (!fromUom || !toUom) throw new Error('Invalid UOM ID');
  if (fromUom.category_id !== toUom.category_id) {
    throw new Error(`Cannot convert between different UOM categories: ${fromUom.name} and ${toUom.name}`);
  }

  // Convert from source UOM to reference unit, then from reference unit to target UOM
  let qtyInReference = 0;
  if (fromUom.uom_type === 'bigger') {
    qtyInReference = qty * fromUom.factor;
  } else if (fromUom.uom_type === 'smaller') {
    qtyInReference = qty / fromUom.factor;
  } else {
    qtyInReference = qty;
  }

  let finalQty = 0;
  if (toUom.uom_type === 'bigger') {
    finalQty = qtyInReference / toUom.factor;
  } else if (toUom.uom_type === 'smaller') {
    finalQty = qtyInReference * toUom.factor;
  } else {
    finalQty = qtyInReference;
  }

  // Round according to target UOM rounding precision
  const precision = toUom.rounding || 0.001;
  return Math.round(finalQty / precision) * precision;
}
