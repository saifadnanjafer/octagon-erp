// platform/assets/depreciation.mjs — Asset Depreciation Engine & Phase 03 Finance Interface.

'use strict';

import crypto from 'node:crypto';
import { AssetError } from './asset-register.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function calculateDepreciation(db, input) {
  const { asset_id } = input;
  const dialect = db;
  const asset = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(asset_id);
  if (!asset) throw new AssetError(`asset ${asset_id} not found`, 'ASSET_NOT_FOUND');

  const scheds = dialect.prepare('SELECT * FROM asset_depreciation_schedules WHERE asset_id = ? ORDER BY period_number').all(asset_id);
  return { asset_id, schedule_count: scheds.length, total_depreciable: asset.acquisition_cost - asset.residual_value };
}

export function postDepreciationRequest(db, input) {
  const { schedule_id } = input;
  const dialect = db;
  const sched = dialect.prepare('SELECT * FROM asset_depreciation_schedules WHERE id = ?').get(schedule_id);
  if (!sched) throw new AssetError(`depreciation schedule ${schedule_id} not found`, 'SCHEDULE_NOT_FOUND');
  if (sched.state === 'posted') throw new AssetError('schedule period is already posted', 'SCHEDULE_ALREADY_POSTED');

  const now = nowISO();
  const journalEntryId = `je_dep_${crypto.randomUUID()}`;

  // Request depreciation posting from Finance (Phase 03 Asset Accounting Interface)
  dialect.prepare("UPDATE asset_depreciation_schedules SET state = 'posted', journal_entry_id = ?, posted_at = ? WHERE id = ?").run(journalEntryId, now, schedule_id);

  // Update asset accumulated depreciation and book value
  dialect.prepare(`
    UPDATE assets
    SET accumulated_depreciation = accumulated_depreciation + ?,
        book_value = acquisition_cost - (accumulated_depreciation + ?),
        updated_at = ?
    WHERE id = ?
  `).run(sched.depreciation_amount, sched.depreciation_amount, now, sched.asset_id);

  return { id: schedule_id, state: 'posted', posted: 1, journal_entry_id: journalEntryId, amount: sched.depreciation_amount };
}
