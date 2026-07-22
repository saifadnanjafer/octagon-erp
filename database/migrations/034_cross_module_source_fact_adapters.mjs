// 034_cross_module_source_fact_adapters — Wave F
//
// Source composition:
// - SPEC-IMPLEMENT, built directly from Packet 03.28's own requirement list.
//   No operational Phase 04/05/06 module exists yet (and this migration does
//   not create one — the packet explicitly forbids that: "Do not create the
//   operational source module inside Phase 03"). This creates only the
//   versioned fact-schema registry a later phase's real module will call
//   through, and the narrow adapter that turns an accepted fact into an
//   ordinary finance_document.
//
// What this migration does:
//   1. Creates finance_source_fact_schemas — a versioned catalog of accepted
//      source-module fact types (sales invoice, purchase bill, stock receipt,
//      etc.) with their required-field contract.
//   2. Registers the single postSourceFact/reverseSourceFact action pair used
//      by every source module — one adapter, not one per module.
//
// Invariants:
//   - postSourceFact reuses the existing finance_documents.source_type/
//     source_id/source_canonical_key columns and createDocument's existing
//     duplicate-reference check (Wave C) for idempotency — no second
//     idempotency mechanism is introduced.

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '034_cross_module_source_fact_adapters',
  owner: MODULE_ID,
  version: '1.20.0',
  dependsOn: ['033_legacy_finance_migration_registry'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'SPEC-IMPLEMENT directly from Phase 03 Packet 03.28 requirement list; no donor source (explicitly no operational module to port from, by the packet’s own rule)',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS finance_source_fact_schemas (
        fact_type TEXT PRIMARY KEY,
        source_module TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        required_fields TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      INSERT OR IGNORE INTO finance_source_fact_schemas (fact_type, source_module, schema_version, required_fields, description, created_at) VALUES
        ('sales_invoice_posting', 'sales', 1, '["lines","doc_date","partner_id"]', 'Phase 04 sales invoice -> customer_invoice', '${now}'),
        ('customer_credit_note_posting', 'sales', 1, '["original_document_id","lines"]', 'Phase 04 sales credit note', '${now}'),
        ('purchase_bill_posting', 'procurement', 1, '["lines","doc_date","partner_id"]', 'Phase 04 purchase bill -> supplier_bill', '${now}'),
        ('supplier_credit_posting', 'procurement', 1, '["original_document_id","lines"]', 'Phase 04 supplier credit note', '${now}'),
        ('stock_receipt_posting', 'inventory', 1, '["lines","doc_date"]', 'Phase 04 stock receipt valuation', '${now}'),
        ('stock_issue_posting', 'inventory', 1, '["lines","doc_date"]', 'Phase 04 stock issue valuation', '${now}'),
        ('landed_cost_posting', 'inventory', 1, '["lines","doc_date"]', 'Phase 04 landed cost allocation', '${now}'),
        ('manufacturing_wip_posting', 'manufacturing', 1, '["lines","doc_date"]', 'Phase 05 WIP/variance posting', '${now}'),
        ('project_cost_posting', 'project', 1, '["lines","doc_date"]', 'Phase 05/06 project cost posting', '${now}'),
        ('payroll_liability_posting', 'payroll', 1, '["lines","doc_date"]', 'Payroll GL liability bridge (reads payroll totals only; never writes payroll/attendance tables)', '${now}'),
        ('pos_settlement_posting', 'pos', 1, '["lines","doc_date"]', 'Phase 06 POS session settlement', '${now}'),
        ('asset_depreciation_posting', 'asset', 1, '["category_id","amount","asset_reference"]', 'Phase 05 asset depreciation (delegates to postAssetDepreciation directly, not this generic adapter)', '${now}');
    `);

    const insEntity = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, 'id', ?, ?, 'finance', NULL, NULL, 0, NULL, NULL, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id = excluded.module_id, label_ar = excluded.label_ar, label_en = excluded.label_en, updated_at = excluded.updated_at
    `);
    insEntity.run('finance_source_fact', MODULE_ID, 'platform.finance', 'واقعة مصدر خارجي', 'Source Fact', MODULE_ID, now, now);

    const ins = dialect.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
        input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
        audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id, entity_id = excluded.entity_id, kind = excluded.kind,
        allowed_states = excluded.allowed_states, required_permission = excluded.required_permission,
        required_scope = excluded.required_scope, input_schema = excluded.input_schema,
        preconditions = excluded.preconditions, transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy, sequence_policy = excluded.sequence_policy,
        audit_policy = excluded.audit_policy, outbox_policy = excluded.outbox_policy,
        reversal_action = excluded.reversal_action, result_schema = excluded.result_schema,
        error_contract = excluded.error_contract, updated_at = excluded.updated_at
    `);

    const actions = [
      { id: 'finance_source_fact:post', entity_id: 'finance_source_fact', kind: 'domain', required_permission: 'finance_source_fact:post', input_schema: { required: ['fact_type', 'source_id', 'lines'] }, reversal_action: 'finance_source_fact:reverse' },
      { id: 'finance_source_fact:reverse', entity_id: 'finance_source_fact', kind: 'domain', required_permission: 'finance_source_fact:post', input_schema: { required: ['document_id'] } },
    ];

    for (const a of actions) {
      ins.run(
        a.id, MODULE_ID, a.entity_id, a.kind, JSON.stringify(a.allowed_states || []),
        a.required_permission, a.required_scope || 'company',
        a.input_schema ? JSON.stringify(a.input_schema) : null,
        JSON.stringify(a.preconditions || []), MODULE_ID, 'required', 'none',
        'required', 'required', a.reversal_action || null,
        null, null, now, now
      );
    }

    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    if (!existing.includes('034_cross_module_source_fact_adapters')) {
      existing.push('034_cross_module_source_fact_adapters');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    dialect.exec(`DROP TABLE IF EXISTS finance_source_fact_schemas;`);
    const actions = ['finance_source_fact:post', 'finance_source_fact:reverse'];
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${actions.map(() => '?').join(',')})`).run(...actions);
    dialect.prepare('DELETE FROM platform_entities WHERE id = ?').run('finance_source_fact');
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '034_cross_module_source_fact_adapters');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
