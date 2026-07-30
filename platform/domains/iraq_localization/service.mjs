// platform/domains/iraq_localization/service.mjs — Iraq Localization & Tax Domain Service.

import crypto from 'node:crypto';

function uid(prefix = 'iq') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function createTaxRule(db, {
  company_id,
  tax_type,
  name_ar,
  name_en,
  rate_pct = 0.0,
  valid_from
}) {
  if (!company_id || !tax_type || !name_ar || !name_en || !valid_from) {
    throw new Error('company_id, tax_type, name_ar, name_en, and valid_from are required');
  }

  const id = uid('taxr');
  const count = db.prepare('SELECT COUNT(*) as c FROM iq_tax_rules WHERE company_id = ?').get(company_id).c + 1;
  const rule_number = `TAXR-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO iq_tax_rules (id, company_id, rule_number, tax_type, name_ar, name_en, rate_pct, valid_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, rule_number, tax_type, name_ar, name_en, rate_pct, valid_from);

  return db.prepare('SELECT * FROM iq_tax_rules WHERE id = ?').get(id);
}

export function getGovernorates(db) {
  return db.prepare('SELECT * FROM iq_governorates WHERE is_active = 1 ORDER BY governorate_code ASC').all();
}

export function fileTaxDeclaration(db, {
  company_id,
  tax_year,
  tax_quarter = null,
  tax_type,
  gross_taxable_amount_iqd,
  calculated_tax_due_iqd
}) {
  if (!company_id || !tax_year || !tax_type || gross_taxable_amount_iqd === undefined || calculated_tax_due_iqd === undefined) {
    throw new Error('company_id, tax_year, tax_type, gross_taxable_amount_iqd, and calculated_tax_due_iqd are required');
  }

  const id = uid('fil');
  const count = db.prepare('SELECT COUNT(*) as c FROM iq_tax_filings WHERE company_id = ?').get(company_id).c + 1;
  const filing_number = `IQ-TAX-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO iq_tax_filings (id, company_id, filing_number, tax_year, tax_quarter, tax_type, gross_taxable_amount_iqd, calculated_tax_due_iqd, filing_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(id, company_id, filing_number, tax_year, tax_quarter, tax_type, gross_taxable_amount_iqd, calculated_tax_due_iqd);

  return db.prepare('SELECT * FROM iq_tax_filings WHERE id = ?').get(id);
}

export function recordCBIRate(db, {
  company_id,
  conversion_date,
  cbi_official_rate_iqd = 1310.0,
  parallel_market_rate_iqd = null,
  notes = null
}) {
  if (!company_id || !conversion_date) {
    throw new Error('company_id and conversion_date are required');
  }

  const id = uid('fx');
  db.prepare(`
    INSERT INTO iq_currency_conversions (id, company_id, conversion_date, cbi_official_rate_iqd, parallel_market_rate_iqd, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, company_id, conversion_date, cbi_official_rate_iqd, parallel_market_rate_iqd, notes);

  return db.prepare('SELECT * FROM iq_currency_conversions WHERE id = ?').get(id);
}

export function configureBilingualTemplate(db, {
  company_id,
  template_key,
  title_ar,
  title_en,
  header_ar = null,
  header_en = null,
  footer_ar = null,
  footer_en = null
}) {
  if (!company_id || !template_key || !title_ar || !title_en) {
    throw new Error('company_id, template_key, title_ar, and title_en are required');
  }

  const id = uid('tmp');
  db.prepare(`
    INSERT INTO iq_bilingual_templates (id, company_id, template_key, title_ar, title_en, header_ar, header_en, footer_ar, footer_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, template_key, title_ar, title_en, header_ar, header_en, footer_ar, footer_en);

  return db.prepare('SELECT * FROM iq_bilingual_templates WHERE id = ?').get(id);
}
