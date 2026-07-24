import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../phase02/harness.mjs';
import { openPosSession } from '../../platform/pos/session.mjs';

async function setupDb() {
  const { dialect } = await setup('wave-f');
  return dialect;
}

test('Wave F: POS session cannot bypass canonical cash-shift ownership', async () => {
  const db = await setupDb();
  assert.throws(
    () => openPosSession(db, {
      company_id: '*',
      user_id: 'cashier_01',
      cash_shift_id: 'missing-shift',
    }),
    /active canonical cash shift/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_sessions').get().n, 0);
});

test('Wave F: Commercial Cutover Settings & CANONICAL_ONLY Default', async () => {
  const db = await setupDb();
  const settings = db.prepare(`SELECT * FROM commercial_cutover_settings`).all();

  assert.ok(settings.length >= 5);
  const salesSetting = settings.find(s => s.module_name === 'sales');
  assert.equal(salesSetting.state, 'CANONICAL_ONLY');
});
