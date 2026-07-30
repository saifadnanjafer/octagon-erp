// tests/module-wave-2/wms/wms.test.mjs — Integration tests for W2-M9 WMS.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m075 } from '../../../database/migrations/075_advanced_wms.mjs';
import * as wmsService from '../../../platform/domains/wms/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-wms-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Product Variant
  db.prepare(`
    INSERT INTO product_templates (id, company_id, name, created_at, updated_at)
    VALUES ('tmpl-valves', 'company-alpha', 'High Pressure Safety Valve', datetime('now'), datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO product_variants (id, template_id, company_id, name, sku, created_at, updated_at)
    VALUES ('prod-valve-hp', 'tmpl-valves', 'company-alpha', 'High Pressure Safety Valve 2-Inch', 'VALVE-HP-2', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 075: Up, rerun, and schema verification', async () => {
  const env = await setup('m075-schema');
  try {
    await m075.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wms_warehouses', 'wms_zones', 'wms_bins', 'wms_wave_pickings', 'wms_stock_transfers', 'wms_bin_inventories')
    `).all().map(r => r.name);

    assert.equal(tables.length, 6);

    // Rerun check
    await m075.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Warehouse Hierarchy & Bin Setup', async () => {
  const env = await setup('wh-setup');
  try {
    await m075.up(env.db);

    const wh = wmsService.createWarehouse(env.db, {
      company_id: 'company-alpha',
      code: 'WH-BASRA-01',
      name: 'Basra Central Distribution Center'
    });
    assert.equal(wh.code, 'WH-BASRA-01');

    const zone = wmsService.createZone(env.db, {
      company_id: 'company-alpha',
      warehouse_id: wh.id,
      code: 'ZONE-A',
      name: 'High Density Storage',
      type: 'storage'
    });
    assert.equal(zone.code, 'ZONE-A');

    const bin = wmsService.createBin(env.db, {
      company_id: 'company-alpha',
      zone_id: zone.id,
      bin_code: 'Z1-A01-R02-B05'
    });
    assert.equal(bin.bin_code, 'Z1-A01-R02-B05');
  } finally {
    cleanup(env);
  }
});

test('3. Bin Stock Inbound Receipt & Wave Picking Setup', async () => {
  const env = await setup('inbound-wave');
  try {
    await m075.up(env.db);

    const wh = wmsService.createWarehouse(env.db, { company_id: 'company-alpha', code: 'WH-01', name: 'Main' });
    const zone = wmsService.createZone(env.db, { company_id: 'company-alpha', warehouse_id: wh.id, code: 'Z1', name: 'Storage' });
    const bin = wmsService.createBin(env.db, { company_id: 'company-alpha', zone_id: zone.id, bin_code: 'BIN-101' });

    // Receive 100 units to BIN-101
    const inv = wmsService.receiveInventoryToBin(env.db, {
      company_id: 'company-alpha',
      bin_id: bin.id,
      product_id: 'prod-valve-hp',
      quantity: 100.0
    });
    assert.equal(inv.on_hand_qty, 100.0);

    const wave = wmsService.createWavePicking(env.db, {
      company_id: 'company-alpha',
      warehouse_id: wh.id,
      picking_strategy: 'batch'
    });
    assert.equal(wave.status, 'planned');
    assert.ok(wave.wave_number.startsWith('WAVE-2026-'));

    const task = wmsService.addPickTask(env.db, {
      company_id: 'company-alpha',
      wave_id: wave.id,
      bin_id: bin.id,
      product_id: 'prod-valve-hp',
      qty_to_pick: 20.0
    });
    assert.equal(task.qty_to_pick, 20.0);
  } finally {
    cleanup(env);
  }
});

test('4. Inter-Bin Stock Transfer & Available Stock Protection', async () => {
  const env = await setup('bin-transfer');
  try {
    await m075.up(env.db);

    const wh = wmsService.createWarehouse(env.db, { company_id: 'company-alpha', code: 'WH-01', name: 'Main' });
    const zone = wmsService.createZone(env.db, { company_id: 'company-alpha', warehouse_id: wh.id, code: 'Z1', name: 'Storage' });
    const binSrc = wmsService.createBin(env.db, { company_id: 'company-alpha', zone_id: zone.id, bin_code: 'BIN-SRC' });
    const binDst = wmsService.createBin(env.db, { company_id: 'company-alpha', zone_id: zone.id, bin_code: 'BIN-DST' });

    wmsService.receiveInventoryToBin(env.db, { company_id: 'company-alpha', bin_id: binSrc.id, product_id: 'prod-valve-hp', quantity: 50.0 });

    // Transfer 20 units from binSrc to binDst
    const trf = wmsService.executeBinTransfer(env.db, {
      company_id: 'company-alpha',
      from_bin_id: binSrc.id,
      to_bin_id: binDst.id,
      product_id: 'prod-valve-hp',
      quantity: 20.0,
      transferred_by: 'wh-operator-01'
    });
    assert.equal(trf.status, 'completed');
    assert.ok(trf.transfer_number.startsWith('WTRF-2026-'));

    const invSrc = env.db.prepare('SELECT on_hand_qty FROM wms_bin_inventories WHERE bin_id = ? AND product_id = ?').get(binSrc.id, 'prod-valve-hp');
    const invDst = env.db.prepare('SELECT on_hand_qty FROM wms_bin_inventories WHERE bin_id = ? AND product_id = ?').get(binDst.id, 'prod-valve-hp');

    assert.equal(invSrc.on_hand_qty, 30.0); // 50 - 20
    assert.equal(invDst.on_hand_qty, 20.0);

    // Over-stock transfer attempt (requesting 40 units when only 30 available)
    assert.throws(() => {
      wmsService.executeBinTransfer(env.db, {
        company_id: 'company-alpha',
        from_bin_id: binSrc.id,
        to_bin_id: binDst.id,
        product_id: 'prod-valve-hp',
        quantity: 40.0,
        transferred_by: 'wh-operator-01'
      });
    }, /Insufficient available stock in bin/);
  } finally {
    cleanup(env);
  }
});
