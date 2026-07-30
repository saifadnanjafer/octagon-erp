// database/migrations/081_iraq_localization_and_tax.mjs — Iraq Localization & Tax Foundation Migration.

export const migration = {
  id: '081_iraq_localization_and_tax',
  description: 'Migration 081: Iraq Localization & Tax Foundation (Tax Rules, Governorates, Tax Filings, CBI FX Rates, Bilingual Templates)',

  async up(db) {
    // 1. Iraq Tax Rules
    db.prepare(`
      CREATE TABLE IF NOT EXISTS iq_tax_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        rule_number TEXT NOT NULL,
        tax_type TEXT NOT NULL, -- sales_tax, withholding_tax, payroll_tax, stamp_duty, corporate_tax
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        rate_pct REAL NOT NULL DEFAULT 0.0,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_iq_tax_rules_type
      ON iq_tax_rules(company_id, tax_type)
    `).run();

    // 2. Iraq Governorates & Regions
    db.prepare(`
      CREATE TABLE IF NOT EXISTS iq_governorates (
        id TEXT PRIMARY KEY,
        governorate_code TEXT NOT NULL UNIQUE, -- BGD, BSR, EBL, NIN, KAN, SUL, KBR, etc.
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'central', -- central, south, north, kurdistan
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `).run();

    // Seed major governorates
    const govs = [
      ['gov-bgd', 'BGD', 'بغداد', 'Baghdad', 'central'],
      ['gov-bsr', 'BSR', 'البصرة', 'Basra', 'south'],
      ['gov-ebl', 'EBL', 'أربيل', 'Erbil', 'kurdistan'],
      ['gov-nin', 'NIN', 'نينوى', 'Ninawa', 'north'],
      ['gov-sul', 'SUL', 'السليمانية', 'Sulaymaniyah', 'kurdistan'],
      ['gov-naj', 'NAJ', 'النجف', 'Najaf', 'south'],
      ['gov-kar', 'KAR', 'كربلاء', 'Karbala', 'central']
    ];
    for (const [id, code, ar, en, reg] of govs) {
      db.prepare(`
        INSERT OR IGNORE INTO iq_governorates (id, governorate_code, name_ar, name_en, region)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, code, ar, en, reg);
    }

    // 3. Iraq Tax Filings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS iq_tax_filings (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        filing_number TEXT NOT NULL,
        tax_year INTEGER NOT NULL,
        tax_quarter INTEGER, -- 1, 2, 3, 4 or NULL for annual
        tax_type TEXT NOT NULL, -- sales_tax, withholding_tax, corporate_tax
        gross_taxable_amount_iqd REAL NOT NULL DEFAULT 0.0,
        calculated_tax_due_iqd REAL NOT NULL DEFAULT 0.0,
        paid_amount_iqd REAL NOT NULL DEFAULT 0.0,
        filing_status TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, paid
        submitted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_iq_tax_filings_year
      ON iq_tax_filings(company_id, tax_year, tax_quarter)
    `).run();

    // 4. Central Bank of Iraq (CBI) Exchange Rates
    db.prepare(`
      CREATE TABLE IF NOT EXISTS iq_currency_conversions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        conversion_date TEXT NOT NULL,
        cbi_official_rate_iqd REAL NOT NULL DEFAULT 1310.0, -- CBI official USD/IQD rate
        parallel_market_rate_iqd REAL, -- Market FX rate
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_iq_fx_date
      ON iq_currency_conversions(company_id, conversion_date)
    `).run();

    // 5. Bilingual Document Templates
    db.prepare(`
      CREATE TABLE IF NOT EXISTS iq_bilingual_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        template_key TEXT NOT NULL, -- invoice_tax, purchase_receipt, payroll_slip
        title_ar TEXT NOT NULL,
        title_en TEXT NOT NULL,
        header_ar TEXT,
        header_en TEXT,
        footer_ar TEXT,
        footer_en TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'iq_bilingual_templates',
      'iq_currency_conversions',
      'iq_tax_filings',
      'iq_governorates',
      'iq_tax_rules'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
