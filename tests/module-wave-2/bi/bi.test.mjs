// tests/module-wave-2/bi/bi.test.mjs — Integration tests for W2-M13 BI & Executive Cockpit.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m079 } from '../../../database/migrations/079_business_intelligence.mjs';
import * as biService from '../../../platform/domains/bi/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-bi-${n}-${Date.now()}-${process.pid}.db`); }

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

test('1. Migration 079: Up, rerun, and schema verification', async () => {
  const env = await setup('m079-schema');
  try {
    await m079.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bi_dashboards', 'bi_widgets', 'bi_kpi_definitions', 'bi_kpi_snapshots', 'bi_scheduled_reports')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m079.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Executive Dashboard Creation & Widget Placement', async () => {
  const env = await setup('dash-widget');
  try {
    await m079.up(env.db);

    const dsh = biService.createDashboard(env.db, {
      company_id: 'company-alpha',
      title: 'Executive Financial Cockpit',
      category: 'executive',
      description: 'High-level financial performance overview for C-suite',
      owner_id: 'ceo-user'
    });
    assert.equal(dsh.category, 'executive');
    assert.ok(dsh.dashboard_number.startsWith('DSH-2026-'));

    const wgt1 = biService.addWidget(env.db, {
      company_id: 'company-alpha',
      dashboard_id: dsh.id,
      title: 'Monthly Recurring Revenue (MRR)',
      widget_type: 'kpi_card',
      query_code: 'FIN_MRR_TOTAL',
      pos_x: 0,
      pos_y: 0,
      width: 4,
      height: 2
    });
    assert.equal(wgt1.title, 'Monthly Recurring Revenue (MRR)');

    const widgets = env.db.prepare('SELECT * FROM bi_widgets WHERE dashboard_id = ?').all(dsh.id);
    assert.equal(widgets.length, 1);
  } finally {
    cleanup(env);
  }
});

test('3. KPI Definition, Snapshot Tracking & Warning/Critical Status', async () => {
  const env = await setup('kpi-test');
  try {
    await m079.up(env.db);

    const kpi = biService.defineKPI(env.db, {
      company_id: 'company-alpha',
      kpi_code: 'FIN_GROSS_MARGIN_PCT',
      name: 'Gross Margin Percentage',
      domain_module: 'finance',
      unit: 'pct',
      target_value: 65.0,
      warning_threshold: 55.0,
      critical_threshold: 45.0
    });
    assert.equal(kpi.kpi_code, 'FIN_GROSS_MARGIN_PCT');

    // Normal snapshot (above warning)
    const snp1 = biService.recordKPISnapshot(env.db, {
      company_id: 'company-alpha',
      kpi_id: kpi.id,
      snapshot_date: '2026-06-30',
      actual_value: 68.5
    });
    assert.equal(snp1.status, 'green');

    // Warning snapshot
    const snp2 = biService.recordKPISnapshot(env.db, {
      company_id: 'company-alpha',
      kpi_id: kpi.id,
      snapshot_date: '2026-07-15',
      actual_value: 50.0
    });
    assert.equal(snp2.status, 'yellow');

    // Critical snapshot
    const snp3 = biService.recordKPISnapshot(env.db, {
      company_id: 'company-alpha',
      kpi_id: kpi.id,
      snapshot_date: '2026-07-31',
      actual_value: 40.0
    });
    assert.equal(snp3.status, 'red');
  } finally {
    cleanup(env);
  }
});

test('4. Scheduled Report Creation', async () => {
  const env = await setup('rpt-test');
  try {
    await m079.up(env.db);

    const rpt = biService.scheduleReport(env.db, {
      company_id: 'company-alpha',
      title: 'Weekly Executive Briefing PDF',
      recipient_emails: 'executives@company-alpha.com, cfo@company-alpha.com',
      cron_expression: '0 7 * * 1',
      format: 'PDF'
    });
    assert.equal(rpt.format, 'PDF');
    assert.ok(rpt.report_number.startsWith('RPT-2026-'));
  } finally {
    cleanup(env);
  }
});
