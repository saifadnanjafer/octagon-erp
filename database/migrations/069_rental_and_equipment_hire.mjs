// 069_rental_and_equipment_hire.mjs — Wave 2, W2-M3 (Rental and Equipment Hire).
//
// Governed Rental schema over canonical Product, Asset, Inventory, Sales, Maintenance, and Finance.

const MIGRATION_ID = '069_rental_and_equipment_hire';
const MODULE_ID = 'rental';

export const migration = {
  id: MIGRATION_ID,
  owner: 'octagon.rental',
  version: '2.1.0',
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Wave 2 W2-M3 Rental and Equipment Hire',

  up(db, { dialect }) {
    db.exec(`
      -- Rental Product Configurations
      CREATE TABLE IF NOT EXISTS rental_product_configs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        product_id TEXT NOT NULL, -- canonical product_variant / template reference
        asset_id TEXT REFERENCES assets(id), -- optional serialized asset link
        daily_rate REAL NOT NULL DEFAULT 0.0,
        weekly_rate REAL NOT NULL DEFAULT 0.0,
        monthly_rate REAL NOT NULL DEFAULT 0.0,
        deposit_amount REAL NOT NULL DEFAULT 0.0,
        is_serialized INTEGER NOT NULL DEFAULT 0,
        maintenance_buffer_hours INTEGER NOT NULL DEFAULT 24,
        is_available_for_rent INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rental_product ON rental_product_configs(company_id, product_id);

      -- Rental Rate Rules
      CREATE TABLE IF NOT EXISTS rental_rate_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        product_id TEXT,
        season_name TEXT NOT NULL,
        multiplier REAL NOT NULL DEFAULT 1.0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      -- Rental Agreements
      CREATE TABLE IF NOT EXISTS rental_agreements (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        agreement_number TEXT NOT NULL,
        party_id TEXT NOT NULL REFERENCES parties(id),
        project_id TEXT,
        status TEXT NOT NULL DEFAULT 'quotation', -- quotation, reserved, prepared, handed_over, active, return_due, returned, inspected, closed, extended, overdue, damaged, cancelled, maintenance_hold
        planned_start TEXT NOT NULL,
        planned_end TEXT NOT NULL,
        actual_start TEXT,
        actual_end TEXT,
        currency TEXT NOT NULL DEFAULT 'IQD',
        total_rent_amount REAL NOT NULL DEFAULT 0.0,
        deposit_amount REAL NOT NULL DEFAULT 0.0,
        sale_order_id TEXT, -- canonical Sales linkage
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_number ON rental_agreements(company_id, agreement_number);
      CREATE INDEX IF NOT EXISTS idx_rental_party ON rental_agreements(company_id, party_id);
      CREATE INDEX IF NOT EXISTS idx_rental_status ON rental_agreements(company_id, status);

      -- Rental Lines
      CREATE TABLE IF NOT EXISTS rental_lines (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        quantity REAL NOT NULL DEFAULT 1.0,
        unit_daily_rate REAL NOT NULL DEFAULT 0.0,
        rental_days INTEGER NOT NULL DEFAULT 1,
        total_amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'reserved',
        created_at TEXT NOT NULL
      );

      -- Rental Reservations & Availability Windows
      CREATE TABLE IF NOT EXISTS rental_reservations (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        reserved_from TEXT NOT NULL,
        reserved_to TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1.0,
        status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled, released
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rental_res_window ON rental_reservations(product_id, reserved_from, reserved_to);

      -- Availability Windows
      CREATE TABLE IF NOT EXISTS rental_availability_windows (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        window_type TEXT NOT NULL DEFAULT 'maintenance_hold', -- maintenance_hold, reserved, blocked
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Handover Records
      CREATE TABLE IF NOT EXISTS rental_handovers (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        handover_date TEXT NOT NULL,
        handover_by_user_id TEXT NOT NULL,
        received_by_person TEXT NOT NULL,
        meter_reading_out REAL DEFAULT 0.0,
        fuel_level_out REAL DEFAULT 100.0,
        checklist_verified INTEGER NOT NULL DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Return Records
      CREATE TABLE IF NOT EXISTS rental_returns (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        return_date TEXT NOT NULL,
        received_by_user_id TEXT NOT NULL,
        meter_reading_in REAL DEFAULT 0.0,
        fuel_level_in REAL DEFAULT 100.0,
        is_damaged INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Inspection Records
      CREATE TABLE IF NOT EXISTS rental_inspections (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        inspector_user_id TEXT NOT NULL,
        inspection_date TEXT NOT NULL,
        condition_passed INTEGER NOT NULL DEFAULT 1,
        findings TEXT DEFAULT '',
        recommended_action TEXT DEFAULT 'none', -- none, repair, maintenance_hold, charge_damage
        created_at TEXT NOT NULL
      );

      -- Damage Records
      CREATE TABLE IF NOT EXISTS rental_damage_records (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        description TEXT NOT NULL,
        estimated_repair_cost REAL NOT NULL DEFAULT 0.0,
        charge_to_customer REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'assessed', -- assessed, billed, waived, repaired
        created_at TEXT NOT NULL
      );

      -- Deposits Management
      CREATE TABLE IF NOT EXISTS rental_deposits (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'held', -- held, refunded, forfeited, partially_refunded
        refunded_amount REAL DEFAULT 0.0,
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Extensions
      CREATE TABLE IF NOT EXISTS rental_extensions (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        extension_days INTEGER NOT NULL,
        previous_end TEXT NOT NULL,
        new_end TEXT NOT NULL,
        additional_amount REAL NOT NULL DEFAULT 0.0,
        approved_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Late Fee Requests
      CREATE TABLE IF NOT EXISTS rental_late_fees (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES rental_agreements(id) ON DELETE CASCADE,
        overdue_days INTEGER NOT NULL,
        late_fee_amount REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'pending', -- pending, billed, waived
        created_at TEXT NOT NULL
      );

      -- Maintenance Holds
      CREATE TABLE IF NOT EXISTS rental_maintenance_holds (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        asset_id TEXT REFERENCES assets(id),
        maintenance_order_id TEXT, -- canonical Maintenance order link
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Seed module
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, created_at, updated_at
      ) VALUES (
        'rental', 'Rental & Equipment Hire', '2.1.0', 'available', 'standard', 'octagon.rental', '${now}', '${now}'
      ) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
    `).run();
  },

  down(db, { dialect }) {
    db.exec(`
      DROP TABLE IF EXISTS rental_maintenance_holds;
      DROP TABLE IF EXISTS rental_late_fees;
      DROP TABLE IF EXISTS rental_extensions;
      DROP TABLE IF EXISTS rental_deposits;
      DROP TABLE IF EXISTS rental_damage_records;
      DROP TABLE IF EXISTS rental_inspections;
      DROP TABLE IF EXISTS rental_returns;
      DROP TABLE IF EXISTS rental_handovers;
      DROP TABLE IF EXISTS rental_availability_windows;
      DROP TABLE IF EXISTS rental_reservations;
      DROP TABLE IF EXISTS rental_lines;
      DROP TABLE IF EXISTS rental_agreements;
      DROP TABLE IF EXISTS rental_rate_rules;
      DROP TABLE IF EXISTS rental_product_configs;
    `);
  }
};
