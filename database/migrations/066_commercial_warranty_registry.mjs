// BUILD-03 — canonical warranty case registry; service/stock writers remain governed elsewhere.
const ACTIONS = [
  ['sales:warranty:create', 'commercial_warranty_case', 'sales:warranty:write', ['sale_order_id', 'issue', 'idempotency_key']],
  ['sales:warranty:submit', 'commercial_warranty_case', 'sales:warranty:write', ['warranty_id']],
  ['sales:warranty:approve', 'commercial_warranty_case', 'sales:warranty:approve', ['warranty_id']],
  ['sales:warranty:close', 'commercial_warranty_case', 'sales:warranty:write', ['warranty_id']],
];
export const migration = {
  id: '066_commercial_warranty_registry', owner: 'platform.kernel', version: '1.45.0',
  parent: '065_commercial_contract_authority', dependsOn: ['065_commercial_contract_authority'],
  dialect: ['sqlite', 'postgres'], transactionPolicy: 'required', rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-03 clean-room warranty registry; no parallel service, inventory, or finance writer.',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS commercial_warranty_cases (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, branch_id TEXT, sale_order_id TEXT NOT NULL REFERENCES sale_orders(id),
      product_id TEXT, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','approved','closed','rejected')),
      issue TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_warranty_idempotency ON commercial_warranty_cases(company_id, idempotency_key);`);
    db.exec("INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at) VALUES ('commercial_warranty_case','commercial_sales','platform.sales','id','مطالبة ضمان','Commercial Warranty Case','commercial',1,'{}','{}','company','explicit','scoped','registered','metadata','audit',1,'066_commercial_warranty_registry',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING");
    const add = db.prepare(`INSERT INTO platform_actions (id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,reversal_action,result_schema,error_contract,created_at,updated_at) VALUES (?, 'commercial_sales', ?, 'domain', '[]', ?, 'company', ?, '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
    const now = new Date().toISOString(); for (const [id, entity, permission, required] of ACTIONS) add.run(id, entity, permission, JSON.stringify({ type: 'object', required }), JSON.stringify({ envelope: 'stable', rollback: 'atomic' }), now, now);
  },
  down(db) { for (const [id] of ACTIONS) db.prepare('DELETE FROM platform_actions WHERE id = ?').run(id); db.prepare("DELETE FROM platform_entities WHERE id = 'commercial_warranty_case'").run(); db.exec('DROP INDEX IF EXISTS idx_commercial_warranty_idempotency; DROP TABLE IF EXISTS commercial_warranty_cases;'); },
};
