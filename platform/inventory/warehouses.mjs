import crypto from 'node:crypto';

function makeId(prefix = 'wh') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createWarehouse(db, { company_id = '*', name, code }) {
  if (!name || !code) throw new Error('Warehouse name and code are required');
  const now = new Date().toISOString();
  const whId = makeId('wh');

  // Create standard Odoo-style stock location hierarchy
  const viewLocId = makeId('loc_view');
  const stockLocId = makeId('loc_stock');
  const inputLocId = makeId('loc_in');
  const outputLocId = makeId('loc_out');

  // Insert warehouse row first so foreign key constraints on stock_locations succeed
  db.prepare(`
    INSERT INTO warehouses (
      id, company_id, name, code, view_location_id, lot_stock_id, input_location_id, output_location_id, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(whId, company_id, name, code, viewLocId, stockLocId, inputLocId, outputLocId, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at)
    VALUES (?, ?, ?, NULL, ?, ?, 'view', 0, ?)
  `).run(viewLocId, company_id, whId, code, `${code}`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at)
    VALUES (?, ?, ?, ?, 'Stock', ?, 'internal', 0, ?)
  `).run(stockLocId, company_id, whId, viewLocId, `${code}/Stock`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at)
    VALUES (?, ?, ?, ?, 'Input', ?, 'internal', 0, ?)
  `).run(inputLocId, company_id, whId, viewLocId, `${code}/Input`, now);

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at)
    VALUES (?, ?, ?, ?, 'Output', ?, 'internal', 0, ?)
  `).run(outputLocId, company_id, whId, viewLocId, `${code}/Output`, now);

  return db.prepare(`SELECT * FROM warehouses WHERE id = ?`).get(whId);
}

export function createStockLocation(db, { company_id = '*', warehouse_id = null, parent_id = null, name, usage = 'internal', is_scrap = 0 }) {
  if (!name) throw new Error('Location name is required');
  const locId = makeId('loc');
  const now = new Date().toISOString();

  let completeName = name;
  if (parent_id) {
    const parent = db.prepare(`SELECT complete_name FROM stock_locations WHERE id = ?`).get(parent_id);
    if (parent) completeName = `${parent.complete_name}/${name}`;
  }

  db.prepare(`
    INSERT INTO stock_locations (id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(locId, company_id, warehouse_id, parent_id, name, completeName, usage, is_scrap ? 1 : 0, now);

  return db.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(locId);
}

export function getWarehouses(db, { company_id = '*' } = {}) {
  return db.prepare(`
    SELECT * FROM warehouses WHERE (company_id = ? OR company_id = '*' OR ? = '*') AND is_active = 1
  `).all(company_id, company_id);
}

export function getLocations(db, { company_id = '*', warehouse_id = null } = {}) {
  let sql = `SELECT * FROM stock_locations WHERE (company_id = ? OR company_id = '*' OR ? = '*')`;
  const params = [company_id, company_id];
  if (warehouse_id) {
    sql += ` AND warehouse_id = ?`;
    params.push(warehouse_id);
  }
  sql += ` ORDER BY complete_name ASC`;
  return db.prepare(sql).all(...params);
}
