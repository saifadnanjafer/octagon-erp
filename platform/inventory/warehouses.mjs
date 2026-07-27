import crypto from 'node:crypto';

function makeId(prefix = 'wh') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createWarehouse(db, { company_id = '*', branch_id = null, name, code, warehouse_type = 'physical', is_default = 0 }) {
  if (!name || !code) throw new Error('Warehouse name and code are required');
  const now = new Date().toISOString();
  const whId = makeId('wh');

  const viewLocId = makeId('loc_view');
  const stockLocId = makeId('loc_stock');
  const inputLocId = makeId('loc_in');
  const outputLocId = makeId('loc_out');

  db.prepare(`
    INSERT INTO warehouses (
      id, company_id, name, code, view_location_id, lot_stock_id, input_location_id, output_location_id, warehouse_type, is_default, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(whId, company_id, String(name).trim(), String(code).trim().toUpperCase(), viewLocId, stockLocId, inputLocId, outputLocId, warehouse_type || 'physical', is_default ? 1 : 0, now, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, is_active, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, 'view', 0, 1, ?)
  `).run(viewLocId, company_id, whId, code, `${code}`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, is_active, created_at)
    VALUES (?, ?, ?, ?, 'Stock', ?, 'internal', 0, 1, ?)
  `).run(stockLocId, company_id, whId, viewLocId, `${code}/Stock`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, is_active, created_at)
    VALUES (?, ?, ?, ?, 'Input', ?, 'internal', 0, 1, ?)
  `).run(inputLocId, company_id, whId, viewLocId, `${code}/Input`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, is_active, created_at)
    VALUES (?, ?, ?, ?, 'Output', ?, 'internal', 0, 1, ?)
  `).run(outputLocId, company_id, whId, viewLocId, `${code}/Output`, now);

  if (branch_id) {
    db.prepare(`
      INSERT INTO warehouse_branch_scopes (
        warehouse_id, company_id, branch_id, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(whId, company_id, branch_id, now);
  }

  return db.prepare(`SELECT * FROM warehouses WHERE id = ?`).get(whId);
}

export function updateWarehouse(db, warehouseData) {
  const { id } = warehouseData;
  if (!id) throw new Error('Warehouse ID is required');
  const existing = db.prepare(`SELECT * FROM warehouses WHERE id = ?`).get(id);
  if (!existing) throw new Error(`Warehouse not found: ${id}`);
  const now = new Date().toISOString();

  const name = warehouseData.name !== undefined ? String(warehouseData.name).trim() : existing.name;
  const code = warehouseData.code !== undefined ? String(warehouseData.code).trim().toUpperCase() : existing.code;
  const warehouse_type = warehouseData.warehouse_type !== undefined ? warehouseData.warehouse_type : existing.warehouse_type;
  const is_default = warehouseData.is_default !== undefined ? (warehouseData.is_default ? 1 : 0) : existing.is_default;
  const is_active = warehouseData.is_active !== undefined ? (warehouseData.is_active ? 1 : 0) : existing.is_active;

  db.prepare(`
    UPDATE warehouses SET name = ?, code = ?, warehouse_type = ?, is_default = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(name, code, warehouse_type, is_default, is_active, now, id);

  return db.prepare(`SELECT * FROM warehouses WHERE id = ?`).get(id);
}

export function archiveWarehouse(db, { id }) {
  return updateWarehouse(db, { id, is_active: 0 });
}

export function restoreWarehouse(db, { id }) {
  return updateWarehouse(db, { id, is_active: 1 });
}

export function createStockLocation(db, { company_id = '*', warehouse_id = null, parent_id = null, name, usage = 'internal', capacity = '', is_scrap = 0 }) {
  if (!name) throw new Error('Location name is required');
  const locId = makeId('loc');
  const now = new Date().toISOString();

  let completeName = String(name).trim();
  if (parent_id) {
    const parent = db.prepare(`SELECT complete_name FROM stock_locations WHERE id = ?`).get(parent_id);
    if (parent) completeName = `${parent.complete_name}/${name}`;
  }

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, capacity, is_scrap, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(locId, company_id, warehouse_id || null, parent_id || null, String(name).trim(), completeName, usage, capacity || '', is_scrap ? 1 : 0, now, now);

  return db.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(locId);
}

export function updateStockLocation(db, locationData) {
  const { id } = locationData;
  if (!id) throw new Error('Location ID is required');
  const existing = db.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(id);
  if (!existing) throw new Error(`Stock location not found: ${id}`);
  const now = new Date().toISOString();

  const name = locationData.name !== undefined ? String(locationData.name).trim() : existing.name;
  const parent_id = locationData.parent_id !== undefined ? locationData.parent_id : existing.parent_id;
  const usage = locationData.usage !== undefined ? locationData.usage : existing.usage;
  const capacity = locationData.capacity !== undefined ? locationData.capacity : existing.capacity;
  const is_active = locationData.is_active !== undefined ? (locationData.is_active ? 1 : 0) : existing.is_active;

  let completeName = name;
  if (parent_id) {
    const parent = db.prepare(`SELECT complete_name FROM stock_locations WHERE id = ?`).get(parent_id);
    if (parent) completeName = `${parent.complete_name}/${name}`;
  }

  db.prepare(`
    UPDATE stock_locations SET name = ?, parent_id = ?, complete_name = ?, usage = ?, capacity = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(name, parent_id || null, completeName, usage, capacity, is_active, now, id);

  return db.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(id);
}

export function moveStockLocation(db, { id, parent_id }) {
  return updateStockLocation(db, { id, parent_id });
}

export function archiveStockLocation(db, { id }) {
  return updateStockLocation(db, { id, is_active: 0 });
}

export function restoreStockLocation(db, { id }) {
  return updateStockLocation(db, { id, is_active: 1 });
}

export function getWarehouses(db, { company_id = '*', branch_id = null, include_archived = false } = {}) {
  let sql = "SELECT * FROM warehouses WHERE (company_id = ? OR company_id = '*')";
  const params = [company_id];
  if (!include_archived) {
    sql += ' AND is_active = 1';
  }
  sql += ' ORDER BY code ASC';
  return db.prepare(sql).all(...params);
}

export function getLocations(db, { company_id = '*', warehouse_id = null, include_archived = false } = {}) {
  let sql = "SELECT * FROM stock_locations WHERE (company_id = ? OR company_id = '*')";
  const params = [company_id];
  if (!include_archived) {
    sql += ' AND is_active = 1';
  }
  if (warehouse_id) {
    sql += ` AND warehouse_id = ?`;
    params.push(warehouse_id);
  }
  sql += ` ORDER BY complete_name ASC`;
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({ ...r, complete_path: r.complete_name || r.name }));
}
