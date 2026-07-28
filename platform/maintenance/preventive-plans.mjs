// platform/maintenance/preventive-plans.mjs — Preventive Maintenance Plans Domain Engine.

'use strict';

import crypto from 'node:crypto';
import { MaintenanceError } from './maintenance-orders.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function createPreventivePlan(db, input) {
  const { code, title, name, asset_id, frequency_type, frequency_value, interval_days } = input;
  const pTitle = title || name;
  if (!pTitle || !asset_id) throw new MaintenanceError('title and asset_id are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const companyId = input.company_id || 'default';
  const id = `pmplan_${crypto.randomUUID()}`;
  const planCode = code || `PM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const freqVal = Number(frequency_value || interval_days || 30.0);
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO maintenance_preventive_plans (
      id, company_id, code, title, asset_id, frequency_type, frequency_value, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id, companyId, planCode, pTitle, asset_id, frequency_type || 'days', freqVal, now, now
  );

  return { id, code: planCode, name: pTitle, title: pTitle, is_active: 1 };
}
