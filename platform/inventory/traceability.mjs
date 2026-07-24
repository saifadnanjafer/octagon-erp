import crypto from 'node:crypto';

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createLot(db, payload) {
  if (!payload.product_id || !payload.lot_number) throw new Error('product_id and lot_number are required');
  const row = {
    id: payload.id || id('lot'),
    company_id: payload.company_id,
    product_id: payload.product_id,
    lot_number: String(payload.lot_number).trim(),
    manufactured_at: payload.manufactured_at || null,
    expires_at: payload.expires_at || null,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO stock_lots (
      id, company_id, product_id, lot_number, manufactured_at,
      expires_at, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...Object.values(row));
  return row;
}

export function createSerial(db, payload) {
  if (!payload.product_id || !payload.serial_number) throw new Error('product_id and serial_number are required');
  const row = {
    id: payload.id || id('serial'),
    company_id: payload.company_id,
    product_id: payload.product_id,
    serial_number: String(payload.serial_number).trim(),
    lot_id: payload.lot_id || null,
    status: 'available',
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO stock_serials (
      id, company_id, product_id, serial_number, lot_id, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(...Object.values(row));
  return row;
}

export function createPackage(db, payload) {
  if (!payload.name) throw new Error('package name is required');
  const row = {
    id: payload.id || id('package'),
    company_id: payload.company_id,
    name: String(payload.name).trim(),
    package_type: payload.package_type || 'box',
    location_id: payload.location_id || null,
    created_at: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO stock_packages (
      id, company_id, name, package_type, location_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(...Object.values(row));
  return row;
}
