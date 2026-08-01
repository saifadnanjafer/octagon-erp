// 064_commercial_rma_foundation — clean-room RMA case orchestration.
// Stock and finance remain owned by sales:return:create.
const MODULE_ID = 'commercial_sales';

const ACTIONS = [
  ['sales:rma:create', 'commercial_rma_case', 'sales:order:write', ['order_id', 'lines']],
  ['sales:rma:submit', 'commercial_rma_case', 'sales:order:write', ['rma_id']],
  ['sales:rma:approve', 'commercial_rma_case', 'sales:order:approve', ['rma_id']],
  ['sales:rma:post_return', 'commercial_rma_case', 'sales:invoice:write', ['rma_id', 'warehouse_id']],
];

export const migration = {
  id: '064_commercial_rma_foundation',
  owner: 'platform.kernel',
  version: '1.43.0',
  parent: '063_cutover_lineage_quarantine_and_mapping',
  dependsOn: ['063_cutover_lineage_quarantine_and_mapping'],
  dialect: ['sqlite', 'postgres'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-01 clean-room RMA case orchestration on canonical sales, inventory, and finance authorities.',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS commercial_rma_cases (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        sale_order_id TEXT NOT NULL REFERENCES sale_orders(id),
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','approved','rejected','returned')),
        reason TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL,
        posted_sale_return_id TEXT,
        idempotency_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_rma_idempotency
        ON commercial_rma_cases(company_id, idempotency_key);
      CREATE TABLE IF NOT EXISTS commercial_rma_lines (
        id TEXT PRIMARY KEY,
        rma_id TEXT NOT NULL REFERENCES commercial_rma_cases(id) ON DELETE CASCADE,
        sale_order_line_id TEXT NOT NULL REFERENCES sale_order_lines(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        reason TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at)
      VALUES ('commercial_rma_case', 'commercial_sales', 'platform.sales', 'id', 'حالة إرجاع', 'Commercial RMA Case', 'commercial', 1, '{}', '{}', 'company', 'generic', 'scoped', 'registered', 'metadata', 'audit', 1, '064_commercial_rma_foundation', datetime('now'), datetime('now'))
      ON CONFLICT(id) DO NOTHING;
    `);
    const add = db.prepare(`INSERT INTO platform_actions (id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,reversal_action,result_schema,error_contract,created_at,updated_at) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, ?, ?, ? ) ON CONFLICT(id) DO NOTHING`);
    const now = new Date().toISOString();
    const errors = JSON.stringify({ envelope: 'stable', rollback: 'atomic' });
    for (const [id, entity, permission, required] of ACTIONS) add.run(id, MODULE_ID, entity, permission, JSON.stringify({ type: 'object', required }), errors, now, now);
  },
  down(db) {
    for (const [id] of ACTIONS) db.prepare('DELETE FROM platform_actions WHERE id = ?').run(id);
    db.prepare("DELETE FROM platform_entities WHERE id = 'commercial_rma_case'").run();
    db.exec('DROP TABLE IF EXISTS commercial_rma_lines; DROP TABLE IF EXISTS commercial_rma_cases;');
  },
};
