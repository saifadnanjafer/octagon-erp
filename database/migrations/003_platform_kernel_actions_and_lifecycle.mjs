// 003_platform_kernel_actions_and_lifecycle
//
// Source composition:
// - VNext vnext/server/state/doc-state.js (project-owned) for x_doc_state_defs,
//   x_doc_states, and lifecycle transition tables.
// - VNext vnext/server/modules/r3-infra.js (project-owned) for idempotency
//   evidence patterns.
// - Frappe model/document.py (MIT reference) for docstatus and lifecycle hooks.
// - Odoo account_move.py (clean-room reference) for posted/reverse/cancel semantics.
//
// Adds the action registry runtime tables and seeds the first lifecycle example
// using a non-financial, non-stock, non-payroll entity (crm_lead).

export const migration = {
  id: '003_platform_kernel_actions_and_lifecycle',
  owner: 'platform.kernel',
  version: '1.0.0',
  dependsOn: ['002_platform_kernel_entities_and_storage'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext doc-state.js + r3-infra.js mapped to platform_actions, x_doc_state_defs, x_doc_states, action_idempotency',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS x_doc_state_defs (
        entity TEXT PRIMARY KEY,
        definition TEXT NOT NULL,
        updated_at TEXT,
        updated_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS x_doc_states (
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        state TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (entity, record_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS x_doc_state_history (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT,
        reason TEXT,
        correlation_id TEXT,
        version INTEGER NOT NULL,
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_doc_state_history_record ON x_doc_state_history (entity, record_id);

      CREATE TABLE IF NOT EXISTS action_idempotency (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        tenant_id TEXT,
        operation_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        response_json TEXT,
        status_code INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        UNIQUE (actor_id, company_id, operation_type, idempotency_key)
      ) STRICT;
    `);

    // Add kind column to platform_actions if it does not already exist.
    try {
      dialect.exec(`ALTER TABLE platform_actions ADD COLUMN kind TEXT;`);
    } catch (_) {
      // Column may already exist; ignore.
    }

    const now = new Date().toISOString();

    // Seed a lifecycle for crm_lead (workflow entity, protected from generic CRUD).
    dialect.prepare(`
      INSERT INTO x_doc_state_defs (entity, definition, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity) DO UPDATE SET
        definition = excluded.definition,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      'crm_lead',
      JSON.stringify({
        states: [
          'draft',
          'submitted',
          { name: 'approved', terminal: true },
          'cancelled',
        ],
        initial: 'draft',
        transitions: [
          { from: 'draft', to: 'submitted', action: 'submit' },
          { from: 'submitted', to: 'approved', action: 'approve' },
          { from: 'submitted', to: 'cancelled', action: 'cancel' },
          { from: 'approved', to: 'cancelled', action: 'cancel' },
          { from: 'approved', to: 'draft', action: 'reverse_approval' },
          { from: 'draft', to: 'cancelled', action: 'cancel' },
        ],
      }),
      now,
      'platform_kernel'
    );

    // Seed crm_lead actions.
    const ins = dialect.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission, required_scope,
        input_schema, preconditions, transaction_owner, idempotency_policy, sequence_policy,
        audit_policy, outbox_policy, reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        kind = excluded.kind,
        allowed_states = excluded.allowed_states,
        required_permission = excluded.required_permission,
        required_scope = excluded.required_scope,
        input_schema = excluded.input_schema,
        preconditions = excluded.preconditions,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        sequence_policy = excluded.sequence_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        reversal_action = excluded.reversal_action,
        result_schema = excluded.result_schema,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);

    const actions = [
      {
        id: 'crm_lead:create', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'create',
        required_permission: 'crm_lead:create', input_schema: { required: ['data'] },
        preconditions: [], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
      },
      {
        id: 'crm_lead:submit', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'lifecycle_transition',
        required_permission: 'crm_lead:submit', allowed_states: ['draft'],
        preconditions: ['record_exists'], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
      },
      {
        id: 'crm_lead:approve', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'lifecycle_transition',
        required_permission: 'crm_lead:approve', allowed_states: ['submitted'],
        preconditions: ['record_exists'], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
      },
      {
        id: 'crm_lead:cancel', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'lifecycle_transition',
        required_permission: 'crm_lead:cancel', allowed_states: ['submitted', 'approved'],
        preconditions: ['record_exists'], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
      },
      {
        id: 'crm_lead:reverse_approval', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'reverse',
        required_permission: 'crm_lead:reverse_approval', allowed_states: ['approved'],
        preconditions: ['record_exists'], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
        reversal_action: 'reverse_approval',
      },
      {
        id: 'crm_lead:amend', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'amend',
        required_permission: 'crm_lead:amend', allowed_states: ['approved'],
        preconditions: ['record_exists'], transaction_owner: 'platform.kernel', idempotency_policy: 'required',
      },
    ];

    for (const a of actions) {
      ins.run(
        a.id, a.module_id, a.entity_id, a.kind, JSON.stringify(a.allowed_states || []),
        a.required_permission, a.required_scope || 'company',
        a.input_schema ? JSON.stringify(a.input_schema) : null,
        JSON.stringify(a.preconditions || []), a.transaction_owner, a.idempotency_policy || 'required',
        a.sequence_policy || 'none', a.audit_policy || 'required', a.outbox_policy || 'required',
        a.reversal_action || null,
        a.result_schema ? JSON.stringify(a.result_schema) : null,
        a.error_contract ? JSON.stringify(a.error_contract) : null,
        now, now
      );
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS action_idempotency;
      DROP TABLE IF EXISTS x_doc_state_history;
      DROP TABLE IF EXISTS x_doc_states;
      DROP TABLE IF EXISTS x_doc_state_defs;
    `);
    dialect.prepare('DELETE FROM platform_actions WHERE module_id = ?').run('platform_kernel');
  }
};
