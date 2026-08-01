// BUILD-02 — extend the canonical sale_contracts authority in place.
const MODULE_ID = 'commercial_sales';
const ACTIONS = [
  ['sales:contract:create', 'sale_contract', 'sales:contract:write', ['name', 'partner_id', 'idempotency_key']],
  ['sales:contract:activate', 'sale_contract', 'sales:contract:write', ['contract_id']],
  ['sales:contract:suspend', 'sale_contract', 'sales:contract:write', ['contract_id']],
  ['sales:contract:terminate', 'sale_contract', 'sales:contract:write', ['contract_id']],
];
export const migration = {
  id: '065_commercial_contract_authority', owner: 'platform.kernel', version: '1.44.0',
  parent: '064_commercial_rma_foundation', dependsOn: ['064_commercial_rma_foundation'],
  dialect: ['sqlite', 'postgres'], transactionPolicy: 'required', rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-02 clean-room contract lifecycle on the existing canonical sale_contracts table; no parallel contracts model.',
  up(db) {
    const columns = db.prepare('PRAGMA table_info(sale_contracts)').all().map((row) => row.name);
    for (const [name, type] of [['branch_id','TEXT DEFAULT NULL'],['idempotency_key',"TEXT NOT NULL DEFAULT ''"],['activated_at','TEXT DEFAULT NULL'],['suspended_at','TEXT DEFAULT NULL'],['terminated_at','TEXT DEFAULT NULL'],['updated_at','TEXT DEFAULT NULL']]) if (!columns.includes(name)) db.exec(`ALTER TABLE sale_contracts ADD COLUMN ${name} ${type}`);
    db.exec("UPDATE sale_contracts SET idempotency_key = id WHERE idempotency_key = ''");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_contracts_company_idempotency ON sale_contracts(company_id, idempotency_key)');
    db.exec("INSERT INTO platform_entities (id,module_id,storage_owner,primary_key,label_ar,label_en,section,chatter,fields,relations,scope,lifecycle_policy,query_policy,action_policy,customization_policy,history_policy,api_exposed,migration_owner,created_at,updated_at) VALUES ('sale_contract','commercial_sales','platform.sales','id','عقد مبيعات','Sales Contract','commercial',1,'{}','{}','company','explicit','scoped','registered','metadata','audit',1,'065_commercial_contract_authority',datetime('now'),datetime('now')) ON CONFLICT(id) DO NOTHING");
    const add = db.prepare(`INSERT INTO platform_actions (id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,reversal_action,result_schema,error_contract,created_at,updated_at) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]', 'platform_action_executor', 'required', 'none', 'required', 'required', NULL, NULL, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
    const now = new Date().toISOString();
    for (const [id, entity, permission, required] of ACTIONS) add.run(id, MODULE_ID, entity, permission, JSON.stringify({ type: 'object', required }), JSON.stringify({ envelope: 'stable', rollback: 'atomic' }), now, now);
  },
  down(db) { for (const [id] of ACTIONS) db.prepare('DELETE FROM platform_actions WHERE id = ?').run(id); db.prepare("DELETE FROM platform_entities WHERE id = 'sale_contract'").run(); db.exec('DROP INDEX IF EXISTS idx_sale_contracts_company_idempotency'); },
};
