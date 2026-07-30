// Operations migrator — Checkpoint I5F.
//
// Governed migration for BOMs, Routings/Operation Packs, Quality Templates/Records,
// and SOP references from staged legacy collections into canonical Operations tables.

'use strict';

import crypto from 'node:crypto';
import { recordLineage } from './lineage.mjs';
import { quarantineRecord } from './quarantine.mjs';
import { updateDomainProgress } from './batch-engine.mjs';

export function migrateOperations(dialect, batchId, { actor = 'system', companyId = 'co_1781973993479_57h1z8' } = {}) {
  if (!batchId) throw new TypeError('migrateOperations requires batchId');

  const now = new Date().toISOString();
  let migratedBomsCount = 0;
  let migratedRoutingsCount = 0;
  let migratedQcPlansCount = 0;
  let migratedQcInspectionsCount = 0;
  let quarantinedCount = 0;

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    // Ensure default work center exists
    dialect.prepare(`
      INSERT INTO work_centers (
        id, company_id, code, name_ar, name_en, description, capacity_per_hour,
        efficiency_percent, working_hours_per_day, machine_cost_per_hour,
        labor_cost_per_hour, overhead_cost_per_hour, is_subcontract, is_active, created_at, updated_at
      ) VALUES ('wc_main', ?, 'WC_MAIN', 'مركز العمل الرئيسي', 'Main Work Center', '', 100, 100, 8, 0, 0, 0, 0, 1, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(companyId, now, now);

    // -----------------------------------------------------------------------
    // 1. BOMs (7 omni.boms)
    // -----------------------------------------------------------------------
    const boms = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.boms\' ORDER BY id').all();
    for (const b of boms) {
      let data = {};
      try { data = JSON.parse(b.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(b.data).digest('hex');

      const name = data.name || b.id;
      const matId = data.productId || 'mat_acrylic';
      const productId = matId.startsWith('var_') ? matId : `var_${matId}`;

      dialect.prepare(`
        INSERT INTO boms (
          id, company_id, code, product_id, name_ar, name_en, bom_type, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'manufacturing', 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, updated_at = excluded.updated_at
      `).run(b.id, companyId, b.id, productId, name, name, actor, now, now);

      // Insert BOM Version header
      dialect.prepare(`
        INSERT INTO bom_versions (
          id, company_id, bom_id, revision, quantity, state, yield_percent,
          rejected_reason, drawings, work_instructions, notes, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 1, 'approved', 100, '', '[]', '', '', ?, ?)
        ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
      `).run(b.id, companyId, b.id, now, now);

      // Insert BOM lines
      const items = data.items || data.lines || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const lineId = `baml_${b.id}_${i}`;
        const rawCompId = item.materialId || item.component_id || 'mat_acrylic';
        const componentId = rawCompId.startsWith('var_') ? rawCompId : `var_${rawCompId}`;
        const qty = item.quantity || item.qty || 1;

        dialect.prepare(`
          INSERT INTO bom_lines (
            id, company_id, bom_version_id, sequence, line_type, component_id,
            quantity, scrap_factor_percent, is_phantom, cost_share_percent, notes, created_at
          ) VALUES (?, ?, ?, ?, 'component', ?, ?, 0, 0, 0, '', ?)
          ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity
        `).run(lineId, companyId, b.id, i + 1, componentId, qty, now);
      }

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.boms', sourceId: b.id, sourceHash: hash,
        destinationAuthority: 'ENGINEERING', destinationTable: 'boms', destinationId: b.id,
        actor
      });
      migratedBomsCount++;
    }

    // -----------------------------------------------------------------------
    // 2. Routings / Operation Packs (7 omni.opPacks)
    // -----------------------------------------------------------------------
    const opPacks = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.opPacks\' ORDER BY id').all();
    for (const op of opPacks) {
      let data = {};
      try { data = JSON.parse(op.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(op.data).digest('hex');

      const name = data.name || op.id;

      dialect.prepare(`
        INSERT INTO routings (
          id, company_id, code, product_id, name_ar, name_en, is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 'var_mat_acrylic', ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, updated_at = excluded.updated_at
      `).run(op.id, companyId, op.id, name, name, actor, now, now);

      // Insert Routing Version header
      dialect.prepare(`
        INSERT INTO routing_versions (
          id, company_id, routing_id, revision, state, rejected_reason, notes, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 'approved', '', '', ?, ?)
        ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
      `).run(op.id, companyId, op.id, now, now);

      // Routing operations / steps
      const steps = data.steps || data.operations || [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const opId = `ro_${op.id}_${i}`;

        dialect.prepare(`
          INSERT INTO routing_operations (
            id, company_id, routing_version_id, sequence, code, name, description,
            work_center_id, setup_minutes, cycle_minutes_per_unit, queue_minutes,
            labor_required, machine_required, labor_rate_per_hour, machine_rate_per_hour,
            is_subcontract, subcontract_service_cost, quality_checkpoint, work_instructions, attachments, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'wc_main', ?, ?, 0, 1, 1, 0, 0, 0, 0, 0, '', '[]', ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name
        `).run(
          opId, companyId, op.id, i + 1, s.id || `OP-${i + 1}`, s.name || `Operation ${i + 1}`,
          s.description || '', s.setupMinutes || 0, s.cycleMinutes || 0, now
        );
      }

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.opPacks', sourceId: op.id, sourceHash: hash,
        destinationAuthority: 'ENGINEERING', destinationTable: 'routings', destinationId: op.id,
        actor
      });
      migratedRoutingsCount++;
    }

    // -----------------------------------------------------------------------
    // 3. Quality Templates -> quality_plans (7 omni.qcTemplates)
    // -----------------------------------------------------------------------
    const qcTemplates = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.qcTemplates\' ORDER BY id').all();
    const firstPlanId = qcTemplates.length > 0 ? qcTemplates[0].id : null;

    for (const qt of qcTemplates) {
      let data = {};
      try { data = JSON.parse(qt.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(qt.data).digest('hex');

      dialect.prepare(`
        INSERT INTO quality_plans (
          id, company_id, code, name, category, version, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 'approved', ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      `).run(qt.id, companyId, qt.id, data.title || qt.id, data.category || 'general', now, now);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.qcTemplates', sourceId: qt.id, sourceHash: hash,
        destinationAuthority: 'QUALITY', destinationTable: 'quality_plans', destinationId: qt.id,
        actor
      });
      migratedQcPlansCount++;
    }

    // -----------------------------------------------------------------------
    // 4. Quality Records -> quality_inspections (3 omni.qcRecords)
    // -----------------------------------------------------------------------
    const qcRecords = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.qcRecords\' ORDER BY id').all();
    for (const qr of qcRecords) {
      let data = {};
      try { data = JSON.parse(qr.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(qr.data).digest('hex');

      const inspType = data.type === 'finish' ? 'final' : (['incoming','in_process','final','supplier','return'].includes(data.type) ? data.type : 'final');
      const inspState = data.result === 'pass' ? 'pass' : (data.result === 'fail' ? 'fail' : 'pending');

      let planId = data.templateId || firstPlanId;
      const planExists = dialect.prepare('SELECT 1 FROM quality_plans WHERE id = ?').get(planId);
      if (!planExists) planId = firstPlanId;

      dialect.prepare(`
        INSERT INTO quality_inspections (
          id, company_id, plan_id, inspection_number, inspection_type, source_type, source_id,
          product_id, sample_size, inspected_quantity, passed_quantity, failed_quantity, state, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'work_order', ?, 'var_mat_acrylic', ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
      `).run(
        qr.id, companyId, planId, qr.id, inspType, qr.id,
        data.sampleSize || 1, data.batchSize || 1, (data.batchSize || 1) - (data.defectCount || 0),
        data.defectCount || 0, inspState, data.notes || '', data.createdAt || now, now
      );

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'omni.qcRecords', sourceId: qr.id, sourceHash: hash,
        destinationAuthority: 'QUALITY', destinationTable: 'quality_inspections', destinationId: qr.id,
        actor
      });
      migratedQcInspectionsCount++;
    }

    // -----------------------------------------------------------------------
    // 5. Demo Work Orders Quarantine (3 omni.workOrders)
    // -----------------------------------------------------------------------
    const workOrders = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'omni.workOrders\'').all();
    for (const wo of workOrders) {
      const hash = crypto.createHash('sha256').update(wo.data).digest('hex');
      if (wo.id.startsWith('demo_wo_')) {
        quarantineRecord(dialect, {
          batchId, companyId, sourceCollection: 'omni.workOrders', sourceId: wo.id, sourceHash: hash,
          sourcePayload: wo.data, domain: 'OPERATIONS', reasonCode: 'legacy_demo_record',
          reasonDetail: `Quarantined demo work order ${wo.id}`, severity: 'non_blocking',
          proposedResolution: 'Exclude from production migration'
        });
        quarantinedCount++;
      }
    }

    // Update batch domain progress for OPERATIONS
    updateDomainProgress(dialect, batchId, 'OPERATIONS', {
      state: 'reconciled',
      migrated_count: migratedBomsCount + migratedRoutingsCount + migratedQcPlansCount + migratedQcInspectionsCount,
      quarantined_count: quarantinedCount,
      skipped_count: 0,
    });

    dialect.exec('COMMIT;');

    return {
      domain: 'OPERATIONS',
      migratedBomsCount,
      migratedRoutingsCount,
      migratedQcPlansCount,
      migratedQcInspectionsCount,
      quarantinedCount,
    };
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }
}
