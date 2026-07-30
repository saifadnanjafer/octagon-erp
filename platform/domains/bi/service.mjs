// platform/domains/bi/service.mjs — Business Intelligence Domain Service.

import crypto from 'node:crypto';

function uid(prefix = 'bi') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function createDashboard(db, {
  company_id,
  title,
  category = 'executive',
  description = null,
  layout_config = null,
  is_default = 0,
  owner_id
}) {
  if (!company_id || !title || !owner_id) {
    throw new Error('company_id, title, and owner_id are required');
  }

  const id = uid('dsh');
  const count = db.prepare('SELECT COUNT(*) as c FROM bi_dashboards WHERE company_id = ?').get(company_id).c + 1;
  const dashboard_number = `DSH-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO bi_dashboards (id, company_id, dashboard_number, title, category, description, layout_config, is_default, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, dashboard_number, title, category, description, layout_config, is_default ? 1 : 0, owner_id);

  return db.prepare('SELECT * FROM bi_dashboards WHERE id = ?').get(id);
}

export function addWidget(db, {
  company_id,
  dashboard_id,
  title,
  widget_type = 'kpi_card',
  query_code,
  refresh_interval_sec = 300,
  pos_x = 0,
  pos_y = 0,
  width = 4,
  height = 3
}) {
  if (!company_id || !dashboard_id || !title || !query_code) {
    throw new Error('company_id, dashboard_id, title, and query_code are required');
  }

  const id = uid('wgt');
  db.prepare(`
    INSERT INTO bi_widgets (id, company_id, dashboard_id, title, widget_type, query_code, refresh_interval_sec, pos_x, pos_y, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, dashboard_id, title, widget_type, query_code, refresh_interval_sec, pos_x, pos_y, width, height);

  return db.prepare('SELECT * FROM bi_widgets WHERE id = ?').get(id);
}

export function defineKPI(db, {
  company_id,
  kpi_code,
  name,
  domain_module,
  unit = 'USD',
  target_value = 0.0,
  warning_threshold = null,
  critical_threshold = null,
  calculation_formula = null
}) {
  if (!company_id || !kpi_code || !name || !domain_module) {
    throw new Error('company_id, kpi_code, name, and domain_module are required');
  }

  const id = uid('kpi');
  db.prepare(`
    INSERT INTO bi_kpi_definitions (id, company_id, kpi_code, name, domain_module, unit, target_value, warning_threshold, critical_threshold, calculation_formula)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, kpi_code, name, domain_module, unit, target_value, warning_threshold, critical_threshold, calculation_formula);

  return db.prepare('SELECT * FROM bi_kpi_definitions WHERE id = ?').get(id);
}

export function recordKPISnapshot(db, {
  company_id,
  kpi_id,
  snapshot_date,
  actual_value,
  target_value = null
}) {
  if (!company_id || !kpi_id || !snapshot_date || actual_value === undefined) {
    throw new Error('company_id, kpi_id, snapshot_date, and actual_value are required');
  }

  const kpi = db.prepare('SELECT * FROM bi_kpi_definitions WHERE id = ?').get(kpi_id);
  const tgt = target_value !== null ? target_value : (kpi ? kpi.target_value : 0.0);

  let status = 'green';
  if (kpi && kpi.critical_threshold !== null && actual_value <= kpi.critical_threshold) {
    status = 'red';
  } else if (kpi && kpi.warning_threshold !== null && actual_value <= kpi.warning_threshold) {
    status = 'yellow';
  }

  const id = uid('snp');
  db.prepare(`
    INSERT INTO bi_kpi_snapshots (id, company_id, kpi_id, snapshot_date, actual_value, target_value, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, kpi_id, snapshot_date, actual_value, tgt, status);

  return db.prepare('SELECT * FROM bi_kpi_snapshots WHERE id = ?').get(id);
}

export function scheduleReport(db, {
  company_id,
  title,
  dashboard_id = null,
  cron_expression = '0 8 * * 1',
  recipient_emails,
  format = 'PDF'
}) {
  if (!company_id || !title || !recipient_emails) {
    throw new Error('company_id, title, and recipient_emails are required');
  }

  const id = uid('rpt');
  const count = db.prepare('SELECT COUNT(*) as c FROM bi_scheduled_reports WHERE company_id = ?').get(company_id).c + 1;
  const report_number = `RPT-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO bi_scheduled_reports (id, company_id, report_number, title, dashboard_id, cron_expression, recipient_emails, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, report_number, title, dashboard_id, cron_expression, recipient_emails, format);

  return db.prepare('SELECT * FROM bi_scheduled_reports WHERE id = ?').get(id);
}
