// Disposable REVIEW-ONLY fixture rows for the Quality Management feature
// surface. Every id is prefixed `rev_`, every name/description is obviously
// fictional ("[DEMO] ..."), and every insert is `ON CONFLICT(id) DO NOTHING`
// so this is safe to call more than once against the same disposable
// review database.
//
// Table sources (read from migration source, never guessed — STRICT sqlite
// tables reject wrong types/columns):
//   - product_templates / product_variants
//       -> database/migrations/036_party_product_uom_pricing_foundation.mjs
//   - warehouses
//       -> database/migrations/037_warehouse_stock_ledger_valuation.mjs
//   - quality_inspections / quality_ncrs
//       -> database/migrations/056_quality_management_and_subcontracting.mjs
//   - quality_operational_checkpoints / quality_disposition_requests /
//     quality_rework_routes
//       -> database/migrations/080_build09_quality_rework_scrap.mjs
//
// Reference rows (product, warehouse) reuse the same `rev_` ids as
// scripts/review/fixtures/production.mjs on purpose: both files can be run
// independently or together against the same disposable database and the
// demo data stays coherent either way.

const REVIEWER = 'rev_user_reviewer';

/**
 * @param {{prepare: Function}} dialect - synchronous `prepare(sql).run(...)` dialect.
 * @param {{tenantId?: string, companyId: string, branchId?: string, now?: string}} ctx
 */
export async function seedQualityFixtures(dialect, { companyId, now } = {}) {
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new Error('seedQualityFixtures requires a database dialect with prepare()');
  }
  if (!companyId) {
    throw new Error('seedQualityFixtures requires companyId');
  }
  const ts = now || new Date().toISOString();

  // ---- Minimum reference data needed to satisfy STRICT foreign keys ----
  dialect.prepare(`INSERT INTO product_templates
    (id, company_id, name, code, type, category_id, list_price, standard_price, is_active, created_at)
    VALUES ('rev_tmpl_finished', ?, '[DEMO] Steel Frame Assembly', 'DEMO-TMPL-SF', 'storable', '', 0, 450000, 1, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts);

  dialect.prepare(`INSERT INTO product_variants
    (id, template_id, company_id, sku, name, standard_price, is_active, created_at)
    VALUES ('rev_prod_finished', 'rev_tmpl_finished', ?, 'DEMO-SF-100', '[DEMO] Steel Frame Assembly', 450000, 1, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, ts);

  dialect.prepare(`INSERT INTO warehouses (id, company_id, name, code, is_active, created_at)
    VALUES ('rev_warehouse_main', ?, '[DEMO] Review Main Warehouse', 'DEMO-WH', 1, ?) ON CONFLICT(id) DO NOTHING`)
    .run(companyId, ts);

  // ---- Inspections backing the checkpoint / accepted / failed bullets ----
  const insertInspection = dialect.prepare(`INSERT INTO quality_inspections
    (id, company_id, inspection_number, inspection_type, source_type, source_id, product_id,
     sample_size, inspected_quantity, passed_quantity, failed_quantity, state, inspector_id, inspected_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'rev_prod_finished', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  // Open checkpoint's inspection — still awaiting a result.
  insertInspection.run('rev_qi_open_final', companyId, 'DEMO-QI-0001', 'final', 'work_order', 'rev_wo_batch1_op10', 5.0, 0.0, 0.0, 0.0, 'in_progress', null, null, ts, ts);
  // 1 accepted inspection.
  insertInspection.run('rev_qi_accepted', companyId, 'DEMO-QI-0002', 'final', 'production_order', 'rev_po_steel_frame_batch1', 5.0, 5.0, 5.0, 0.0, 'pass', REVIEWER, ts, ts, ts);
  // 1 failed inspection.
  insertInspection.run('rev_qi_failed', companyId, 'DEMO-QI-0003', 'in_process', 'work_order', 'rev_wo_batch1_op10', 5.0, 5.0, 2.0, 3.0, 'fail', REVIEWER, ts, ts, ts);

  // ---- 1 NCR, raised off the failed inspection ----
  dialect.prepare(`INSERT INTO quality_ncrs
    (id, company_id, ncr_number, inspection_id, title, severity, disposition, root_cause, state, assigned_to, created_at, updated_at)
    VALUES ('rev_ncr_1', ?, 'DEMO-NCR-0001', 'rev_qi_failed', ?, 'major', 'rework', ?, 'open', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .run(companyId, '[DEMO] Weld porosity on frame batch 1', '[DEMO] Shielding gas flow inconsistent during batch 1 assembly', REVIEWER, ts, ts);

  // ---- 1 open checkpoint + 1 checkpoint driving the NCR disposition ----
  const insertCheckpoint = dialect.prepare(`INSERT INTO quality_operational_checkpoints
    (id, company_id, warehouse_id, checkpoint_type, source_type, source_id, inspection_id, product_id,
     sample_size, accepted_quantity, rejected_quantity, status, ncr_id, opened_by, decided_by, created_at, updated_at)
    VALUES (?, ?, 'rev_warehouse_main', ?, ?, ?, ?, 'rev_prod_finished', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertCheckpoint.run('rev_qoc_open', companyId, 'final', 'work_order', 'rev_wo_batch1_op10', 'rev_qi_open_final', 5.0, 0.0, 0.0, 'pending', null, REVIEWER, null, ts, ts);
  insertCheckpoint.run('rev_qoc_failed', companyId, 'in_process', 'work_order', 'rev_wo_batch1_op10', 'rev_qi_failed', 5.0, 2.0, 3.0, 'ncr', 'rev_ncr_1', REVIEWER, REVIEWER, ts, ts);

  // ---- 1 rework disposition + 1 scrap-approval example ----
  const insertDisposition = dialect.prepare(`INSERT INTO quality_disposition_requests
    (id, company_id, warehouse_id, checkpoint_id, disposition_type, quantity, reason_code, ncr_id, status, requested_by, approved_by, created_at, updated_at)
    VALUES (?, ?, 'rev_warehouse_main', 'rev_qoc_failed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  insertDisposition.run('rev_qdr_rework', companyId, 'rework', 3.0, 'weld_porosity', 'rev_ncr_1', 'approved', REVIEWER, REVIEWER, ts, ts);
  insertDisposition.run('rev_qdr_scrap', companyId, 'scrap', 1.0, 'unrepairable_crack', null, 'approved', REVIEWER, REVIEWER, ts, ts);

  // ---- 1 rework route, executing the rework disposition ----
  dialect.prepare(`INSERT INTO quality_rework_routes
    (id, company_id, disposition_request_id, route_reference, status, created_by, created_at, updated_at)
    VALUES ('rev_qrr_1', ?, 'rev_qdr_rework', 'DEMO-REWORK-0001', 'planned', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`).run(companyId, REVIEWER, ts, ts);

  return {
    summary: {
      openCheckpoint: 'rev_qoc_open',
      acceptedInspection: 'rev_qi_accepted',
      failedInspection: 'rev_qi_failed',
      ncr: 'rev_ncr_1',
      rework: 'rev_qrr_1',
      scrapApproval: 'rev_qdr_scrap',
    },
  };
}
