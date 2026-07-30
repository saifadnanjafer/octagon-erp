// platform/domains/wms/service.mjs — Advanced Warehouse Management (WMS) Domain Services.

export function generateWaveNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `WAVE-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM wms_wave_pickings WHERE company_id = ? AND wave_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateTransferNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `WTRF-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM wms_stock_transfers WHERE company_id = ? AND transfer_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function generateCycleCountNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `CC-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM wms_cycle_counts WHERE company_id = ? AND count_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createWarehouse(db, { company_id, code, name, address = null, total_capacity_sqm = 1000.0 }) {
  const id = `wh-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_warehouses (id, company_id, code, name, address, total_capacity_sqm, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, code, name, address, total_capacity_sqm, now, now);

  return db.prepare('SELECT * FROM wms_warehouses WHERE id = ?').get(id);
}

export function createZone(db, { company_id, warehouse_id, code, name, type = 'storage', temp_min_celsius = null, temp_max_celsius = null }) {
  const id = `zone-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_zones (id, company_id, warehouse_id, code, name, type, temp_min_celsius, temp_max_celsius, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, warehouse_id, code, name, type, temp_min_celsius, temp_max_celsius, now);

  return db.prepare('SELECT * FROM wms_zones WHERE id = ?').get(id);
}

export function createBin(db, { company_id, zone_id, bin_code, max_weight_kg = 500.0, max_volume_cum = 2.0 }) {
  const id = `bin-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_bins (id, company_id, zone_id, bin_code, max_weight_kg, max_volume_cum, is_locked, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, company_id, zone_id, bin_code, max_weight_kg, max_volume_cum, now, now);

  return db.prepare('SELECT * FROM wms_bins WHERE id = ?').get(id);
}

export function receiveInventoryToBin(db, { company_id, bin_id, product_id, quantity }) {
  const existing = db.prepare('SELECT * FROM wms_bin_inventories WHERE company_id = ? AND bin_id = ? AND product_id = ?').get(company_id, bin_id, product_id);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE wms_bin_inventories SET on_hand_qty = on_hand_qty + ?, updated_at = ? WHERE id = ?
    `).run(quantity, now, existing.id);
    return db.prepare('SELECT * FROM wms_bin_inventories WHERE id = ?').get(existing.id);
  }

  const id = `bininv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO wms_bin_inventories (id, company_id, bin_id, product_id, on_hand_qty, reserved_qty, updated_at)
    VALUES (?, ?, ?, ?, ?, 0.0, ?)
  `).run(id, company_id, bin_id, product_id, quantity, now);

  return db.prepare('SELECT * FROM wms_bin_inventories WHERE id = ?').get(id);
}

export function createWavePicking(db, { company_id, warehouse_id, picking_strategy = 'batch' }) {
  const id = `wave-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const waveNum = generateWaveNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_wave_pickings (id, company_id, wave_number, warehouse_id, picking_strategy, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'planned', ?, ?)
  `).run(id, company_id, waveNum, warehouse_id, picking_strategy, now, now);

  return db.prepare('SELECT * FROM wms_wave_pickings WHERE id = ?').get(id);
}

export function addPickTask(db, { company_id, wave_id, bin_id, product_id, qty_to_pick, picker_id = null }) {
  const wave = db.prepare('SELECT * FROM wms_wave_pickings WHERE id = ? AND company_id = ?').get(wave_id, company_id);
  if (!wave) throw new Error(`Wave picking ${wave_id} not found`);

  const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_pick_tasks (id, company_id, wave_id, bin_id, product_id, qty_to_pick, qty_picked, picker_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0.0, ?, 'pending', ?)
  `).run(id, company_id, wave_id, bin_id, product_id, qty_to_pick, picker_id, now);

  return db.prepare('SELECT * FROM wms_pick_tasks WHERE id = ?').get(id);
}

export function executeBinTransfer(db, { company_id, from_bin_id, to_bin_id, product_id, quantity, transferred_by }) {
  const sourceInv = db.prepare('SELECT * FROM wms_bin_inventories WHERE company_id = ? AND bin_id = ? AND product_id = ?').get(company_id, from_bin_id, product_id);

  if (!sourceInv || (sourceInv.on_hand_qty - sourceInv.reserved_qty) < quantity) {
    const available = sourceInv ? (sourceInv.on_hand_qty - sourceInv.reserved_qty) : 0;
    throw new Error(`Insufficient available stock in bin ${from_bin_id}. Available: ${available}, Requested: ${quantity}`);
  }

  const id = `wtrf-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const trfNum = generateTransferNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_stock_transfers (id, company_id, transfer_number, from_bin_id, to_bin_id, product_id, quantity, status, transferred_by, transferred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
  `).run(id, company_id, trfNum, from_bin_id, to_bin_id, product_id, quantity, transferred_by, now, now);

  // Decrement source bin, increment destination bin
  db.prepare(`UPDATE wms_bin_inventories SET on_hand_qty = on_hand_qty - ?, updated_at = ? WHERE id = ?`).run(quantity, now, sourceInv.id);
  receiveInventoryToBin(db, { company_id, bin_id: to_bin_id, product_id, quantity });

  return db.prepare('SELECT * FROM wms_stock_transfers WHERE id = ?').get(id);
}

export function createCycleCount(db, { company_id, warehouse_id, zone_id = null, count_date, counter_id }) {
  const id = `cc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const ccNum = generateCycleCountNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO wms_cycle_counts (id, company_id, count_number, warehouse_id, zone_id, count_date, status, counter_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(id, company_id, ccNum, warehouse_id, zone_id, count_date, counter_id, now, now);

  return db.prepare('SELECT * FROM wms_cycle_counts WHERE id = ?').get(id);
}
