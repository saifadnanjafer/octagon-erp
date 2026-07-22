// 015_finance_document_lifecycle — Wave B
//
// Source composition:
// - VNext doc-state.js (project-owned) for lifecycle state-machine concepts.
// - Frappe document.py (MIT reference) for submit/approve/cancel/amend hooks.
// - Odoo account_move.py (clean-room reference) for posted-state immutability.
//
// What this migration does:
//   1. Adds the missing finance_document lifecycle actions: create, submit, approve, cancel.
//   2. Ensures the finance_document lifecycle definition is registered.
//   3. Keeps existing finance_document:post / :reverse / :amend actions unchanged.
//
// Invariants:
//   - No applied migration is modified.
//   - New actions are idempotent (ON CONFLICT).

import crypto from 'node:crypto';

const MODULE_ID = 'finance_canonical';
const now = new Date().toISOString();

export const migration = {
  id: '015_finance_document_lifecycle',
  owner: MODULE_ID,
  version: '1.1.0',
  dependsOn: ['014_finance_canonical_schema_and_coa'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext doc-state.js + Frappe document.py + Odoo account_move.py mapped to finance_document lifecycle actions',

  up(dialect) {
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
        id: 'finance_document:create', entity_id: 'finance_document', kind: 'domain',
        required_permission: 'finance_document:create',
        input_schema: { required: ['move_type', 'doc_date', 'lines'] },
      },
      {
        id: 'finance_document:submit', entity_id: 'finance_document', kind: 'domain',
        required_permission: 'finance_document:submit', allowed_states: ['draft'],
        input_schema: { required: ['document_id'] },
      },
      {
        id: 'finance_document:approve', entity_id: 'finance_document', kind: 'domain',
        required_permission: 'finance_document:approve', allowed_states: ['submitted'],
        input_schema: { required: ['document_id'] },
      },
      {
        id: 'finance_document:cancel', entity_id: 'finance_document', kind: 'domain',
        required_permission: 'finance_document:cancel', allowed_states: ['draft', 'submitted', 'approved'],
        input_schema: { required: ['document_id'] },
      },
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

    // Ensure the lifecycle definition is registered (idempotent).
    dialect.prepare(`
      INSERT INTO x_doc_state_defs (entity, definition, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity) DO UPDATE SET
        definition = excluded.definition,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      'finance_document',
      JSON.stringify({
        states: ['draft', 'submitted', 'approved', { name: 'posted', terminal: true }, 'cancelled', 'reversed'],
        initial: 'draft',
        transitions: [
          { from: 'draft', to: 'submitted', action: 'finance_document:submit' },
          { from: 'submitted', to: 'approved', action: 'finance_document:approve' },
          { from: 'approved', to: 'posted', action: 'finance_document:post' },
          { from: 'draft', to: 'cancelled', action: 'finance_document:cancel' },
          { from: 'submitted', to: 'cancelled', action: 'finance_document:cancel' },
          { from: 'approved', to: 'cancelled', action: 'finance_document:cancel' },
          { from: 'posted', to: 'reversed', action: 'finance_document:reverse' },
        ],
      }),
      now, MODULE_ID
    );

    // Record this migration in the finance_canonical module manifest.
    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    if (!existing.includes('015_finance_document_lifecycle')) {
      existing.push('015_finance_document_lifecycle');
      dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(existing), now, MODULE_ID);
    }
  },

  down(dialect) {
    const actions = [
      'finance_document:create',
      'finance_document:submit',
      'finance_document:approve',
      'finance_document:cancel',
    ];
    const placeholders = actions.map(() => '?').join(',');
    dialect.prepare(`DELETE FROM platform_actions WHERE id IN (${placeholders})`).run(...actions);

    const existing = JSON.parse(dialect.prepare('SELECT migrations FROM platform_modules WHERE id = ?').get(MODULE_ID)?.migrations || '[]');
    const next = existing.filter(id => id !== '015_finance_document_lifecycle');
    dialect.prepare('UPDATE platform_modules SET migrations = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(next), new Date().toISOString(), MODULE_ID);
  }
};
