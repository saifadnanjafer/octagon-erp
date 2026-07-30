// tests/module-wave-2/iraq_localization/iraq_localization.test.mjs — Integration tests for W2-M15 Iraq Localization & Tax.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m081 } from '../../../database/migrations/081_iraq_localization_and_tax.mjs';
import * as iqService from '../../../platform/domains/iraq_localization/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-iq-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 081: Up, rerun, and schema verification', async () => {
  const env = await setup('m081-schema');
  try {
    await m081.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('iq_tax_rules', 'iq_governorates', 'iq_tax_filings', 'iq_currency_conversions', 'iq_bilingual_templates')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m081.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Iraq Governorates Catalog Seeding Verification', async () => {
  const env = await setup('gov-test');
  try {
    await m081.up(env.db);

    const govs = iqService.getGovernorates(env.db);
    assert.ok(govs.length >= 7);

    const baghdad = govs.find(g => g.governorate_code === 'BGD');
    assert.equal(baghdad.name_ar, 'بغداد');
    assert.equal(baghdad.name_en, 'Baghdad');

    const erbil = govs.find(g => g.governorate_code === 'EBL');
    assert.equal(erbil.region, 'kurdistan');
  } finally {
    cleanup(env);
  }
});

test('3. Iraq Tax Rule Creation & Tax Declaration Filing', async () => {
  const env = await setup('tax-test');
  try {
    await m081.up(env.db);

    const rule = iqService.createTaxRule(env.db, {
      company_id: 'company-alpha',
      tax_type: 'withholding_tax',
      name_ar: 'ضريبة الاستقطاع المباشر 5%',
      name_en: 'Direct Withholding Tax 5%',
      rate_pct: 5.0,
      valid_from: '2026-01-01'
    });
    assert.equal(rule.rate_pct, 5.0);
    assert.ok(rule.rule_number.startsWith('TAXR-2026-'));

    const filing = iqService.fileTaxDeclaration(env.db, {
      company_id: 'company-alpha',
      tax_year: 2026,
      tax_quarter: 2,
      tax_type: 'withholding_tax',
      gross_taxable_amount_iqd: 50000000.0, // 50M IQD
      calculated_tax_due_iqd: 2500000.0   // 2.5M IQD (5%)
    });
    assert.equal(filing.filing_status, 'draft');
    assert.equal(filing.calculated_tax_due_iqd, 2500000.0);
    assert.ok(filing.filing_number.startsWith('IQ-TAX-2026-'));
  } finally {
    cleanup(env);
  }
});

test('4. CBI FX Conversion Rate & Bilingual Template Configuration', async () => {
  const env = await setup('fx-bilingual-test');
  try {
    await m081.up(env.db);

    const fx = iqService.recordCBIRate(env.db, {
      company_id: 'company-alpha',
      conversion_date: '2026-07-30',
      cbi_official_rate_iqd: 1310.0,
      parallel_market_rate_iqd: 1485.0,
      notes: 'Central Bank of Iraq official exchange rate window'
    });
    assert.equal(fx.cbi_official_rate_iqd, 1310.0);

    const tpl = iqService.configureBilingualTemplate(env.db, {
      company_id: 'company-alpha',
      template_key: 'tax_invoice_official',
      title_ar: 'فاتورة ضريبية رسمية',
      title_en: 'Official Tax Invoice',
      header_ar: 'جمهورية العراق - الهيئة العامة للضرائب',
      header_en: 'Republic of Iraq - General Commission for Taxes'
    });
    assert.equal(tpl.title_ar, 'فاتورة ضريبية رسمية');
  } finally {
    cleanup(env);
  }
});
