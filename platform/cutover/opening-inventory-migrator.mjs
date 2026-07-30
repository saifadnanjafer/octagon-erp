// Opening-inventory migrator — Checkpoint I5C.
//
// Migrates opening stock quants and reservations for all 8 materials.
// Enforces exact reconciliation: 401 = 86 + 315, IQD 1,963,000 aggregate value.
// Accounting entry posting remains blocked behind the unapproved owner approval gate.

'use strict';

import crypto from 'node:crypto';
import { recordLineage } from './lineage.mjs';
import { updateDomainProgress } from './batch-engine.mjs';

export function migrateOpeningInventory(dialect, batchId, { actor = 'system', companyId = 'co_1781973993479_57h1z8' } = {}) {
  if (!batchId) throw new TypeError('migrateOpeningInventory requires batchId');

  const now = new Date().toISOString();

  // Read materials
  const materials = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.materials\' ORDER BY id').all();

  let totalOnHand = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  let totalValue = 0;
  let migratedCount = 0;

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    // Register owner approval gate for accounting date
    dialect.prepare(`
      INSERT INTO cutover_approval_gates (
        id, batch_id, gate_key, gate_title_ar, gate_title_en, description, state, blocks, created_at, updated_at
      ) VALUES (?, ?, 'opening_inventory_accounting_date', 'تاريخ القيد المالي للمخزون الافتتاحي',
                'Opening Inventory Accounting Date Approval',
                'Opening inventory quantity migration complete; accounting posting requires explicit owner-approved date',
                'pending', 'finance_posting', ?, ?)
      ON CONFLICT(batch_id, gate_key) DO UPDATE SET updated_at = excluded.updated_at
    `).run(`gate_${batchId}_inv_date`, batchId, now, now);

    for (const mat of materials) {
      let data = {};
      try { data = JSON.parse(mat.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(mat.data).digest('hex');

      const variantId = `var_${mat.id}`;
      const stock = data.stock || 0;
      const reserved = data.reserved || 0;
      const available = stock - reserved;
      const unitCost = data.cost || 0;
      const itemValue = stock * unitCost;

      totalOnHand += stock;
      totalReserved += reserved;
      totalAvailable += available;
      totalValue += itemValue;

      // 1. Insert stock_quant into LOC_MAIN
      const quantId = `sq_open_${mat.id}`;
      dialect.prepare(`
        INSERT INTO stock_quants (
          id, company_id, product_id, location_id, quantity, reserved_quantity, updated_at
        ) VALUES (?, ?, ?, 'LOC_MAIN', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, reserved_quantity = excluded.reserved_quantity, updated_at = excluded.updated_at
      `).run(quantId, companyId, variantId, stock, reserved, now);

      // 2. Insert stock_reservation if reserved > 0
      if (reserved > 0) {
        const resId = `res_open_${mat.id}`;
        dialect.prepare(`
          INSERT INTO stock_reservations (
            id, company_id, warehouse_id, location_id, product_id, variant_id,
            source_document_type, source_document_id, quantity, status, version, created_at, updated_at
          ) VALUES (?, ?, 'MAIN_WORKSHOP', 'LOC_MAIN', ?, ?, 'legacy_opening_reservation', 'OPENING_BALANCE', ?, 'active', 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
        `).run(resId, companyId, mat.id, variantId, reserved, now, now);
      }

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.materials', sourceId: mat.id, sourceHash: hash,
        destinationAuthority: 'INVENTORY', destinationTable: 'stock_quants', destinationId: quantId,
        actor
      });
      migratedCount++;
    }

    // Invariant check: 401 = 86 + 315
    if (totalOnHand !== 401 || totalReserved !== 86 || totalAvailable !== 315 || totalValue !== 1963000) {
      throw new Error(`Opening inventory reconciliation failure: onHand=${totalOnHand} (exp 401), reserved=${totalReserved} (exp 86), available=${totalAvailable} (exp 315), value=${totalValue} (exp 1963000)`);
    }

    // Record inventory reconciliation results
    const recs = [
      { metric: 'materials_count', expected: '8', actual: String(materials.length), diff: '0', status: 'exact' },
      { metric: 'total_on_hand', expected: '401', actual: String(totalOnHand), diff: '0', status: 'exact' },
      { metric: 'total_reserved', expected: '86', actual: String(totalReserved), diff: '0', status: 'exact' },
      { metric: 'total_available', expected: '315', actual: String(totalAvailable), diff: '0', status: 'exact' },
      { metric: 'aggregate_value_iqd', expected: '1963000', actual: String(totalValue), diff: '0', status: 'exact' },
    ];

    for (const r of recs) {
      const recId = `rr_${crypto.randomBytes(6).toString('hex')}`;
      dialect.prepare(`
        INSERT INTO cutover_reconciliation_results (
          id, batch_id, domain, metric, expected_value, actual_value, difference, status, is_blocking, evaluated_at
        ) VALUES (?, ?, 'INVENTORY', ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(batch_id, domain, metric) DO UPDATE SET actual_value = excluded.actual_value, status = excluded.status
      `).run(recId, batchId, r.metric, r.expected, r.actual, r.diff, r.status, now);
    }

    // Update batch domain progress for INVENTORY
    updateDomainProgress(dialect, batchId, 'INVENTORY', {
      state: 'reconciled',
      migrated_count: migratedCount,
      source_count: materials.length,
      quarantined_count: 0,
      skipped_count: 0
    });

    dialect.exec('COMMIT;');

    return {
      domain: 'INVENTORY',
      materialCount: materials.length,
      onHand: totalOnHand,
      reserved: totalReserved,
      available: totalAvailable,
      aggregateValue: totalValue,
      accountingGateStatus: 'pending_owner_approval',
      reconciliationStatus: 'exact',
    };
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }
}
