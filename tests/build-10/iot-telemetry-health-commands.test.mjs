import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import * as devices from '../../platform/iot/device-registry.mjs';
import * as telemetry from '../../platform/iot/telemetry.mjs';
import * as health from '../../platform/iot/health-diagnostics.mjs';
import * as firmware from '../../platform/iot/firmware-config.mjs';
import * as commands from '../../platform/iot/device-commands.mjs';

async function fixture(t) {
  const file = path.join(os.tmpdir(), `octagon-b10-telemetry-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { fs.unlinkSync(file); } catch {} });
  await freshInstall({ dbPath: file });
  const db = openMigrationDatabase(file);
  t.after(() => db.close());
  const ctx = { company_id: 'company-a', branch_id: 'branch-a', actor: 'operator-a' };
  return { db, ctx };
}

test('telemetry ingestion, unit normalization, duplicate payload handling and event query', async (t) => {
  const { db, ctx } = await fixture(t);
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-TEL-1', device_type: 'tracker' });

  // Ingest telemetry
  const result = telemetry.ingestTelemetrySimulated(db, {
    device_id: device.id,
    measurements: [
      { type: 'temperature', value: 98.6, unit: 'F' },
      { type: 'speed', value: 60, unit: 'mph' }
    ]
  }, ctx);

  assert.equal(result.status, 'normalized');
  assert.equal(result.processedEvents.length, 2);
  assert.equal(result.processedEvents[0].normalizedValue, 37); // 98.6 F = 37 C
  assert.equal(result.processedEvents[0].normalizedUnit, 'C');
  assert.equal(result.processedEvents[1].normalizedValue, 96.56); // 60 mph = 96.56 km/h

  // Ingest duplicate
  const dupResult = telemetry.ingestTelemetrySimulated(db, {
    device_id: device.id,
    measurements: [
      { type: 'temperature', value: 98.6, unit: 'F' },
      { type: 'speed', value: 60, unit: 'mph' }
    ]
  }, ctx);
  assert.equal(dupResult.status, 'duplicate');

  // Query events
  const events = telemetry.listTelemetryEvents(db, { ...ctx, device_id: device.id });
  assert.equal(events.length, 2);
});

test('device health calculation, score update and alert acknowledgment', async (t) => {
  const { db, ctx } = await fixture(t);
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-HLT-1', device_type: 'tracker' });

  // Calculate health before telemetry (unknown)
  let h = health.calculateDeviceHealth(db, { device_id: device.id }, ctx);
  assert.equal(h.healthState, 'unknown');
  assert.equal(h.healthScore, 50.0);

  // Ingest telemetry (makes it online)
  telemetry.ingestTelemetrySimulated(db, { device_id: device.id, measurements: [{ type: 'temperature', value: 25, unit: 'C' }] }, ctx);
  h = health.calculateDeviceHealth(db, { device_id: device.id }, ctx);
  assert.equal(h.healthState, 'online');
  assert.equal(h.healthScore, 100.0);

  // Create alert and acknowledge
  db.prepare(`
    INSERT INTO iot_device_alerts (id, company_id, device_id, alert_type, severity, message, status, created_by, created_at, updated_at)
    VALUES ('alt-1', 'company-a', ?, 'temp_high', 'warning', 'High temperature warning', 'open', 'system', datetime('now'), datetime('now'))
  `).run(device.id);

  const ack = health.acknowledgeAlert(db, { alert_id: 'alt-1' }, ctx);
  assert.equal(ack.status, 'acknowledged');
  assert.equal(ack.acknowledgedBy, 'operator-a');

  const alerts = health.listAlerts(db, { ...ctx, device_id: device.id });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 'acknowledged');
});

test('firmware catalogue, approval and simulated rollout', async (t) => {
  const { db, ctx } = await fixture(t);

  const fw = firmware.registerFirmware(db, { version: '2.0.0', device_model: 'T-100', release_notes: 'Performance update' }, ctx);
  assert.equal(fw.approvalState, 'draft');

  assert.throws(() => firmware.rolloutFirmwareSimulated(db, { firmware_id: fw.id }, ctx), (err) => err.code === 'FIRMWARE_NOT_APPROVED');

  const app = firmware.approveFirmware(db, { firmware_id: fw.id }, ctx);
  assert.equal(app.approvalState, 'approved');

  const rollout = firmware.rolloutFirmwareSimulated(db, { firmware_id: fw.id }, ctx);
  assert.equal(rollout.status, 'completed');
  assert.equal(rollout.successCount, 5);
});

test('simulated device commands request, maker-checker approval and dispatch', async (t) => {
  const { db, ctx } = await fixture(t);
  const device = devices.registerDevice(db, { ...ctx, external_ref: 'TRK-CMD-1', device_type: 'tracker' });

  // Low risk command auto-queues
  const lowCmd = commands.requestCommand(db, { device_id: device.id, command_type: 'ping' }, ctx);
  assert.equal(lowCmd.riskLevel, 'low');
  assert.equal(lowCmd.status, 'queued');

  const lowExec = commands.dispatchSimulatedCommand(db, { command_id: lowCmd.id }, ctx);
  assert.equal(lowExec.status, 'completed');

  // High risk command requires approval
  const highCmd = commands.requestCommand(db, { device_id: device.id, command_type: 'reboot_simulation' }, ctx);
  assert.equal(highCmd.riskLevel, 'high');
  assert.equal(highCmd.status, 'submitted');

  // Same user cannot approve (maker-checker)
  assert.throws(() => commands.approveCommand(db, { command_id: highCmd.id }, ctx), (err) => err.code === 'MAKER_CHECKER_VIOLATION');

  // Different user approves
  const otherCtx = { ...ctx, actor: 'supervisor-b' };
  const app = commands.approveCommand(db, { command_id: highCmd.id }, otherCtx);
  assert.equal(app.status, 'queued');

  const highExec = commands.dispatchSimulatedCommand(db, { command_id: highCmd.id }, ctx);
  assert.equal(highExec.status, 'completed');
});
