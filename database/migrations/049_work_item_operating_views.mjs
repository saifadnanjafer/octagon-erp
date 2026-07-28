// 049_work_item_operating_views — Checkpoint C4
//
// Extends the existing canonical Work Item authority for visible Task Manager,
// Kanban, Calendar, workload, mobile, SLA, dependency, and Workshop TV views.
// Behaviour is clean-room adapted from frozen project-owned VNext project/SLA
// contracts plus targeted Odoo 19 and ERPNext task lifecycle review.

const MODULE_ID = 'work_item_canonical';

const ACTIONS = [
  ['work_item:assign', 'task:write', ['id']],
  ['work_item:transition', 'task:write', ['id', 'stage']],
  ['work_item:add_subtask', 'task:write', ['parent_id', 'title']],
  ['work_item:add_dependency', 'task:write', ['id', 'blocker_work_item_id']],
  ['work_item:complete', 'task:write', ['id']],
  ['work_item:cancel', 'task:write', ['id']],
];

const COLUMNS = [
  'sales_ref TEXT',
  'procurement_ref TEXT',
  'quality_ref TEXT',
  'sla_policy TEXT',
  "sla_status TEXT NOT NULL DEFAULT 'on_track'",
  'sla_breached_at TEXT',
  'last_stage_moved_at TEXT',
  'recurrence_next_at TEXT',
];

function addColumn(db, definition) {
  try {
    db.exec(`ALTER TABLE work_items ADD COLUMN ${definition};`);
  } catch (error) {
    if (!String(error?.message || error).includes('duplicate column')) throw error;
  }
}

export const migration = {
  id: '049_work_item_operating_views',
  owner: MODULE_ID,
  version: '1.28.0',
  parent: '048_pos_atomic_workflows',
  dependsOn: ['048_pos_atomic_workflows'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible-owned-facts',
  sourceProvenance: 'Frozen VNext project task and SLA behaviour plus clean-room Odoo 19 and ERPNext task review, integrated into canonical Octagon Work Items',

  up(db) {
    for (const definition of COLUMNS) addColumn(db, definition);

    db.exec(`
      CREATE TABLE IF NOT EXISTS work_item_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        from_stage TEXT,
        to_stage TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        actor_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_work_item_events_item
        ON work_item_events(work_item_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_work_items_due_status
        ON work_items(company_id, status, due_date);
      CREATE INDEX IF NOT EXISTS idx_work_items_team_status
        ON work_items(company_id, assigned_team_id, status);
      CREATE INDEX IF NOT EXISTS idx_work_items_sla
        ON work_items(company_id, sla_status, sla_due_at);
    `);

    const now = new Date().toISOString();
    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, 'work_item', 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id=excluded.module_id, entity_id='work_item',
        required_permission=excluded.required_permission,
        input_schema=excluded.input_schema,
        transaction_owner='platform_action_executor',
        idempotency_policy='required', audit_policy='required',
        outbox_policy='required', error_contract=excluded.error_contract,
        updated_at=excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'work item, relations, lifecycle event, audit, outbox, and idempotency are atomic',
      codes: [
        'INPUT_MISSING_FIELD',
        'IDEMPOTENCY_KEY_REQUIRED',
        'UNTRUSTED_ACTION_SCOPE',
        'PRECONDITION_FAILED',
        'WORK_ITEM_BLOCKED',
        'WORK_ITEM_VERSION_CONFLICT',
      ],
    });
    for (const [id, permission, required] of ACTIONS) {
      insertAction.run(
        id,
        MODULE_ID,
        permission,
        JSON.stringify({ type: 'object', required }),
        errorContract,
        now,
        now,
      );
    }
  },

  down(db) {
    const remove = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) remove.run(id);
    db.exec(`
      DROP INDEX IF EXISTS idx_work_items_sla;
      DROP INDEX IF EXISTS idx_work_items_team_status;
      DROP INDEX IF EXISTS idx_work_items_due_status;
      DROP INDEX IF EXISTS idx_work_item_events_item;
      DROP TABLE IF EXISTS work_item_events;
    `);
  },
};

export default migration;
