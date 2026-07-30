// database/migrations/079_business_intelligence.mjs — Business Intelligence & Executive Cockpit Module Migration.

export const migration = {
  id: '079_business_intelligence',
  description: 'Migration 079: Business Intelligence & Executive Cockpit (Dashboards, Widgets, KPI Definitions, KPI Snapshots, Scheduled Reports)',

  async up(db) {
    // 1. Executive Cockpit Dashboards
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bi_dashboards (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        dashboard_number TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'executive', -- executive, financial, sales, operations, HR
        description TEXT,
        layout_config TEXT, -- JSON grid layout
        is_default INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bi_dashboards_company
      ON bi_dashboards(company_id, category)
    `).run();

    // 2. Dashboard Widgets
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bi_widgets (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        dashboard_id TEXT NOT NULL REFERENCES bi_dashboards(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        widget_type TEXT NOT NULL DEFAULT 'kpi_card', -- kpi_card, line_chart, bar_chart, pie_chart, table
        query_code TEXT NOT NULL, -- Configured query key or metric ID
        refresh_interval_sec INTEGER NOT NULL DEFAULT 300,
        pos_x INTEGER NOT NULL DEFAULT 0,
        pos_y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 4,
        height INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 3. KPI Definitions
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bi_kpi_definitions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        kpi_code TEXT NOT NULL,
        name TEXT NOT NULL,
        domain_module TEXT NOT NULL, -- finance, sales, inventory, HR
        unit TEXT NOT NULL DEFAULT 'USD', -- USD, IQD, pct, qty
        target_value REAL NOT NULL DEFAULT 0.0,
        warning_threshold REAL,
        critical_threshold REAL,
        calculation_formula TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_bi_kpis_company_code
      ON bi_kpi_definitions(company_id, kpi_code)
    `).run();

    // 4. KPI Snapshots
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bi_kpi_snapshots (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        kpi_id TEXT NOT NULL REFERENCES bi_kpi_definitions(id) ON DELETE CASCADE,
        snapshot_date TEXT NOT NULL,
        actual_value REAL NOT NULL DEFAULT 0.0,
        target_value REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'green', -- green, yellow, red
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Scheduled Reports
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bi_scheduled_reports (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        report_number TEXT NOT NULL,
        title TEXT NOT NULL,
        dashboard_id TEXT REFERENCES bi_dashboards(id) ON DELETE CASCADE,
        cron_expression TEXT NOT NULL DEFAULT '0 8 * * 1', -- Weekly Monday 8AM
        recipient_emails TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'PDF', -- PDF, CSV, XLSX
        is_active INTEGER NOT NULL DEFAULT 1,
        last_dispatched_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'bi_scheduled_reports',
      'bi_kpi_snapshots',
      'bi_kpi_definitions',
      'bi_widgets',
      'bi_dashboards'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
