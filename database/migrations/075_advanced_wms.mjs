// database/migrations/075_advanced_wms.mjs — Advanced Warehouse Management (WMS) Module Migration.

export const migration = {
  id: '075_advanced_wms',
  description: 'Migration 075: Advanced Warehouse Management (Warehouses, Bins, Putaway Rules, Wave Picking, Bin Transfers, Cycle Counting)',

  async up(db) {
    // 1. WMS Warehouses
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_warehouses (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        total_capacity_sqm REAL NOT NULL DEFAULT 1000.0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_wms_warehouses_company
      ON wms_warehouses(company_id, code)
    `).run();

    // 2. WMS Zones
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_zones (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES wms_warehouses(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'storage', -- receiving, storage, cold_storage, hazardous, packing, shipping
        temp_min_celsius REAL,
        temp_max_celsius REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. WMS Bins (Storage Locations)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_bins (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        zone_id TEXT NOT NULL REFERENCES wms_zones(id) ON DELETE CASCADE,
        bin_code TEXT NOT NULL, -- e.g. Z1-A02-R05-B01
        max_weight_kg REAL NOT NULL DEFAULT 500.0,
        max_volume_cum REAL NOT NULL DEFAULT 2.0,
        is_locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_wms_bins_code
      ON wms_bins(company_id, bin_code)
    `).run();

    // 4. WMS Putaway Rules
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_putaway_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        product_category_id TEXT,
        target_zone_id TEXT NOT NULL REFERENCES wms_zones(id),
        strategy TEXT NOT NULL DEFAULT 'fifo', -- fifo, lifo, closest_empty_bin, max_capacity
        priority INTEGER NOT NULL DEFAULT 10,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. WMS Wave Pickings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_wave_pickings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        wave_number TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES wms_warehouses(id),
        picking_strategy TEXT NOT NULL DEFAULT 'batch', -- batch, zone, wave
        status TEXT NOT NULL DEFAULT 'planned', -- planned, released, in_picking, completed, cancelled
        released_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_wms_wave_pickings_company_status
      ON wms_wave_pickings(company_id, status)
    `).run();

    // 6. WMS Pick Tasks
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_pick_tasks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        wave_id TEXT NOT NULL REFERENCES wms_wave_pickings(id) ON DELETE CASCADE,
        bin_id TEXT NOT NULL REFERENCES wms_bins(id),
        product_id TEXT NOT NULL,
        qty_to_pick REAL NOT NULL DEFAULT 1.0,
        qty_picked REAL NOT NULL DEFAULT 0.0,
        picker_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 7. WMS Bin Stock Transfers
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_stock_transfers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        transfer_number TEXT NOT NULL,
        from_bin_id TEXT NOT NULL REFERENCES wms_bins(id),
        to_bin_id TEXT NOT NULL REFERENCES wms_bins(id),
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'completed', -- requested, in_transit, completed, cancelled
        transferred_by TEXT NOT NULL,
        transferred_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 8. WMS Cycle Counts
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_cycle_counts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        count_number TEXT NOT NULL,
        warehouse_id TEXT NOT NULL REFERENCES wms_warehouses(id),
        zone_id TEXT REFERENCES wms_zones(id),
        count_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', -- open, counting, reconciled
        counter_id TEXT NOT NULL,
        reconciled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 9. WMS Cycle Count Lines
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_cycle_count_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        cycle_count_id TEXT NOT NULL REFERENCES wms_cycle_counts(id) ON DELETE CASCADE,
        bin_id TEXT NOT NULL REFERENCES wms_bins(id),
        product_id TEXT NOT NULL,
        system_qty REAL NOT NULL DEFAULT 0.0,
        counted_qty REAL NOT NULL DEFAULT 0.0,
        variance_qty REAL NOT NULL DEFAULT 0.0,
        notes TEXT
      )
    `).run();

    // 10. WMS Bin Inventory Balances
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wms_bin_inventories (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        bin_id TEXT NOT NULL REFERENCES wms_bins(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        on_hand_qty REAL NOT NULL DEFAULT 0.0,
        reserved_qty REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wms_bin_inventories_unique
      ON wms_bin_inventories(company_id, bin_id, product_id)
    `).run();
  },

  async down(db) {
    const tables = [
      'wms_bin_inventories',
      'wms_cycle_count_lines',
      'wms_cycle_counts',
      'wms_stock_transfers',
      'wms_pick_tasks',
      'wms_wave_pickings',
      'wms_putaway_rules',
      'wms_bins',
      'wms_zones',
      'wms_warehouses'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
