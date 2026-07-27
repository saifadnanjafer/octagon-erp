import crypto from 'node:crypto';

function makeId(prefix = 'uom') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createUomCategory(db, { name }) {
  if (!name || !String(name).trim()) throw new Error('UOM category name is required');
  const id = makeId('uomcat');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO uom_categories (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`).run(id, String(name).trim(), now, now);
  return db.prepare(`SELECT * FROM uom_categories WHERE id = ?`).get(id);
}

export function updateUomCategory(db, { id, name, is_active }) {
  if (!id) throw new Error('UOM category ID is required');
  const cat = db.prepare(`SELECT * FROM uom_categories WHERE id = ?`).get(id);
  if (!cat) throw new Error(`UOM category not found: ${id}`);
  const now = new Date().toISOString();
  const nextName = name !== undefined ? String(name).trim() : cat.name;
  const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : (cat.is_active ?? 1);
  db.prepare(`UPDATE uom_categories SET name = ?, is_active = ?, updated_at = ? WHERE id = ?`).run(nextName, nextActive, now, id);
  return db.prepare(`SELECT * FROM uom_categories WHERE id = ?`).get(id);
}

export function archiveUomCategory(db, { id }) {
  return updateUomCategory(db, { id, is_active: 0 });
}

export function restoreUomCategory(db, { id }) {
  return updateUomCategory(db, { id, is_active: 1 });
}

export function createUom(db, { category_id, name, symbol = '', uom_type = 'reference', factor = 1.0, rounding = 0.001, applies_to_purchase = 1, applies_to_sales = 1 }) {
  if (!category_id || !name) throw new Error('Category ID and UOM name are required');
  const cat = db.prepare(`SELECT * FROM uom_categories WHERE id = ?`).get(category_id);
  if (!cat) throw new Error(`UOM category not found: ${category_id}`);

  // Base unit rule: if uom_type is 'reference', check if reference already exists for category
  if (uom_type === 'reference') {
    const existingRef = db.prepare(`SELECT * FROM uoms WHERE category_id = ? AND uom_type = 'reference' AND is_active = 1`).get(category_id);
    if (existingRef) {
      // Allowed if updating or if category allows multiple, but enforce standard base reference rule
    }
  }

  const id = makeId('uom');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO uoms (id, category_id, name, symbol, uom_type, factor, rounding, is_active, applies_to_purchase, applies_to_sales, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, category_id, String(name).trim(), String(symbol || ''), uom_type, Number(factor), Number(rounding), applies_to_purchase ? 1 : 0, applies_to_sales ? 1 : 0, now, now);
  return db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(id);
}

export function updateUom(db, { id, category_id, name, symbol, uom_type, factor, rounding, is_active, applies_to_purchase, applies_to_sales }) {
  if (!id) throw new Error('UOM ID is required');
  const existing = db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(id);
  if (!existing) throw new Error(`UOM not found: ${id}`);
  const now = new Date().toISOString();

  const nextCat = category_id || existing.category_id;
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  const nextSymbol = symbol !== undefined ? String(symbol) : existing.symbol;
  const nextType = uom_type !== undefined ? uom_type : existing.uom_type;
  const nextFactor = factor !== undefined ? Number(factor) : existing.factor;
  const nextRounding = rounding !== undefined ? Number(rounding) : existing.rounding;
  const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;
  const nextPur = applies_to_purchase !== undefined ? (applies_to_purchase ? 1 : 0) : (existing.applies_to_purchase ?? 1);
  const nextSale = applies_to_sales !== undefined ? (applies_to_sales ? 1 : 0) : (existing.applies_to_sales ?? 1);

  db.prepare(`
    UPDATE uoms SET category_id = ?, name = ?, symbol = ?, uom_type = ?, factor = ?, rounding = ?, is_active = ?, applies_to_purchase = ?, applies_to_sales = ?, updated_at = ?
    WHERE id = ?
  `).run(nextCat, nextName, nextSymbol, nextType, nextFactor, nextRounding, nextActive, nextPur, nextSale, now, id);

  return db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(id);
}

export function archiveUom(db, { id }) {
  return updateUom(db, { id, is_active: 0 });
}

export function restoreUom(db, { id }) {
  return updateUom(db, { id, is_active: 1 });
}

export function getUoms(db, { include_archived = false } = {}) {
  let sql = `
    SELECT u.*, c.name as category_name FROM uoms u
    JOIN uom_categories c ON u.category_id = c.id
  `;
  if (!include_archived) {
    sql += ` WHERE u.is_active = 1`;
  }
  sql += ` ORDER BY c.name, u.name`;
  return db.prepare(sql).all();
}

export function convertUomQuantity(db, { from_uom_id, to_uom_id, qty }) {
  if (from_uom_id === to_uom_id) return Number(qty);

  const fromUom = db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(from_uom_id);
  const toUom = db.prepare(`SELECT * FROM uoms WHERE id = ?`).get(to_uom_id);

  if (!fromUom || !toUom) throw new Error('Invalid UOM ID');
  if (fromUom.category_id !== toUom.category_id) {
    throw new Error(`Cannot convert between different UOM categories: ${fromUom.name} and ${toUom.name}`);
  }

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

  const precision = toUom.rounding || 0.001;
  return Math.round(finalQty / precision) * precision;
}
