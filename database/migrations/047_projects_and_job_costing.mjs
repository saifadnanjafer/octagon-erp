// 047_projects_and_job_costing — Phase 05 Wave B
//
// Source composition:
// - ERPNext `erpnext/projects` + `erpnext/accounts` cost-centre dimension
//   (GPL-3, clean-room reference only): project → task → timesheet → costing
//   shape, and the "project is an accounting dimension" idea.
// - Odoo 19 `addons/project` and `addons/sale_project` (LGPL-3, clean-room
//   reference only): milestone billing, fixed-price versus time-and-material
//   invoicing policy, and the project-template pattern.
// - Octagon Phase 03 `016_accounting_dimensions` supplies the real dimension
//   mechanism; this migration registers `project` as one of those dimensions
//   rather than inventing a parallel one.
//
// Authority rules enforced here:
//   - NO project task table. Project work is Phase 04 `work_items` carrying a
//     `project_ref`.
//   - NO project ledger. `project_cost_facts` records what the canonical
//     engines (stock, finance, manufacturing) already posted; it never posts.
//   - NO project invoice writer. Billing goes through the Phase 03 pipeline.
//   - Project labour cost NEVER reads payroll, attendance or timesheet data.
//     It uses `project_effort_entries` with a configured rate. This is the
//     Rule Zero surface of this wave.

const MODULES = [
  ['project_core', 'Projects', ['projects', 'phases', 'milestones', 'budgets', 'commitments', 'billing', 'profitability']],
];

const ENTITIES = [
  ['project', 'project_core', 'platform.projects', 'Project'],
  ['project_template', 'project_core', 'platform.projects', 'Project Template'],
  ['project_budget', 'project_core', 'platform.projects', 'Project Budget'],
  ['project_milestone', 'project_core', 'platform.projects', 'Project Milestone'],
  ['project_change_order', 'project_core', 'platform.projects', 'Project Change Order'],
];

const ACTIONS = [
  ['project:create', 'project_core', 'project', 'project:write', ['name']],
  ['project:update', 'project_core', 'project', 'project:write', ['project_id']],
  ['project:plan', 'project_core', 'project', 'project:write', ['project_id']],
  ['project:approve', 'project_core', 'project', 'project:approve', ['project_id']],
  ['project:activate', 'project_core', 'project', 'project:approve', ['project_id']],
  ['project:hold', 'project_core', 'project', 'project:approve', ['project_id']],
  ['project:complete', 'project_core', 'project', 'project:approve', ['project_id']],
  ['project:close', 'project_core', 'project', 'project:close', ['project_id']],
  ['project:cancel', 'project_core', 'project', 'project:close', ['project_id']],
  ['project:template:create', 'project_core', 'project_template', 'project:write', ['name']],
  ['project:template:apply', 'project_core', 'project', 'project:write', ['project_id', 'template_id']],
  ['project:phase:create', 'project_core', 'project', 'project:write', ['project_id', 'name']],
  ['project:milestone:create', 'project_core', 'project_milestone', 'project:write', ['project_id', 'name']],
  ['project:milestone:achieve', 'project_core', 'project_milestone', 'project:write', ['milestone_id']],
  ['project:member:assign', 'project_core', 'project', 'project:write', ['project_id', 'member_ref']],
  ['project:work_item:create', 'project_core', 'project', 'project:write', ['project_id', 'title']],
  ['project:budget:create', 'project_core', 'project_budget', 'project:budget:write', ['project_id']],
  ['project:budget:approve', 'project_core', 'project_budget', 'project:budget:approve', ['budget_id']],
  ['project:budget:revise', 'project_core', 'project_budget', 'project:budget:write', ['budget_id']],
  ['project:commitment:record', 'project_core', 'project', 'project:budget:write', ['project_id', 'amount']],
  ['project:commitment:release', 'project_core', 'project', 'project:budget:write', ['commitment_id']],
  ['project:effort:record', 'project_core', 'project', 'project:cost:write', ['project_id', 'hours']],
  ['project:expense:record', 'project_core', 'project', 'project:cost:write', ['project_id', 'amount']],
  ['project:material:issue', 'project_core', 'project', 'project:cost:write', ['project_id', 'product_id', 'quantity']],
  ['project:change_order:create', 'project_core', 'project_change_order', 'project:write', ['project_id', 'title']],
  ['project:change_order:approve', 'project_core', 'project_change_order', 'project:approve', ['change_order_id']],
  ['project:risk:record', 'project_core', 'project', 'project:write', ['project_id', 'title']],
  ['project:issue:record', 'project_core', 'project', 'project:write', ['project_id', 'title']],
  ['project:document:attach', 'project_core', 'project', 'project:write', ['project_id', 'document_ref']],
  ['project:cost_code:create', 'project_core', 'project', 'project:budget:write', ['code', 'name']],
  ['project:manufacturing:absorb', 'project_core', 'project', 'project:cost:write', ['project_id', 'production_order_id']],
  ['project:billing_rule:set', 'project_core', 'project', 'project:billing:write', ['project_id', 'billing_method']],
  ['project:bill', 'project_core', 'project', 'project:billing:post', ['project_id']],
  ['project:retainage:release', 'project_core', 'project', 'project:billing:post', ['project_id']],
  ['project:snapshot:profitability', 'project_core', 'project', 'project:write', ['project_id']],
];

export const migration = {
  id: '047_projects_and_job_costing',
  owner: 'project_core',
  version: '1.24.2',
  parent: '046_mrp_planning_subcontracting_and_control_plane',
  dependsOn: ['046_mrp_planning_subcontracting_and_control_plane'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Phase 05 Wave B — canonical project and job-costing schema; clean-room references: ERPNext projects, Odoo 19 project/sale_project; dimension mechanism reused from Octagon migration 016',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_cost_codes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        cost_type TEXT NOT NULL DEFAULT 'other' CHECK(cost_type IN ('labor','material','equipment','subcontract','overhead','expense','other')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        definition TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','planned','approved','active','on_hold','completed','closed','cancelled')),
        customer_party_id TEXT REFERENCES parties(id),
        sale_order_id TEXT REFERENCES sale_orders(id),
        contract_ref TEXT,
        quotation_ref TEXT,
        template_id TEXT REFERENCES project_templates(id),
        manager_ref TEXT,
        dimension_value_id TEXT,
        currency TEXT NOT NULL DEFAULT 'IQD',
        planned_start TEXT,
        planned_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        contract_value REAL NOT NULL DEFAULT 0 CHECK(contract_value >= 0),
        retainage_percent REAL NOT NULL DEFAULT 0 CHECK(retainage_percent >= 0 AND retainage_percent < 100),
        billing_method TEXT NOT NULL DEFAULT 'fixed_price' CHECK(billing_method IN ('fixed_price','time_and_material','milestone','progress')),
        percent_complete REAL NOT NULL DEFAULT 0 CHECK(percent_complete >= 0 AND percent_complete <= 100),
        approved_by TEXT,
        approved_at TEXT,
        closed_at TEXT,
        cancelled_reason TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(company_id, state);

      CREATE TABLE IF NOT EXISTS project_phases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 10,
        name TEXT NOT NULL,
        planned_start TEXT,
        planned_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        percent_complete REAL NOT NULL DEFAULT 0 CHECK(percent_complete >= 0 AND percent_complete <= 100),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed','cancelled')),
        created_at TEXT NOT NULL,
        UNIQUE(project_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_milestones (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        phase_id TEXT REFERENCES project_phases(id),
        company_id TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 10,
        name TEXT NOT NULL,
        due_date TEXT,
        achieved_at TEXT,
        billing_amount REAL NOT NULL DEFAULT 0 CHECK(billing_amount >= 0),
        billing_percent REAL NOT NULL DEFAULT 0 CHECK(billing_percent >= 0),
        is_billable INTEGER NOT NULL DEFAULT 0,
        billed_document_id TEXT REFERENCES finance_documents(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','achieved','billed','cancelled')),
        created_at TEXT NOT NULL,
        UNIQUE(project_id, sequence)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_roles (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        standard_cost_per_hour REAL NOT NULL DEFAULT 0 CHECK(standard_cost_per_hour >= 0),
        standard_bill_per_hour REAL NOT NULL DEFAULT 0 CHECK(standard_bill_per_hour >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_members (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        member_ref TEXT NOT NULL,
        role_id TEXT REFERENCES project_roles(id),
        allocation_percent REAL NOT NULL DEFAULT 100 CHECK(allocation_percent > 0),
        joined_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE(project_id, member_ref)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_budgets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
        revision_of_id TEXT REFERENCES project_budgets(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','superseded','rejected')),
        total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, revision)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_budget_lines (
        id TEXT PRIMARY KEY,
        budget_id TEXT NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        cost_code_id TEXT REFERENCES project_cost_codes(id),
        phase_id TEXT REFERENCES project_phases(id),
        description TEXT,
        cost_type TEXT NOT NULL DEFAULT 'other' CHECK(cost_type IN ('labor','material','equipment','subcontract','overhead','expense','other')),
        amount REAL NOT NULL CHECK(amount >= 0),
        quantity REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_commitments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        commitment_type TEXT NOT NULL CHECK(commitment_type IN ('purchase_requisition','purchase_order','subcontract','manufacturing_order','other')),
        source_document_type TEXT,
        source_document_id TEXT,
        cost_code_id TEXT REFERENCES project_cost_codes(id),
        amount REAL NOT NULL CHECK(amount >= 0),
        released_amount REAL NOT NULL DEFAULT 0 CHECK(released_amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_released','released','cancelled')),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_cost_facts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        phase_id TEXT REFERENCES project_phases(id),
        cost_code_id TEXT REFERENCES project_cost_codes(id),
        work_item_id TEXT REFERENCES work_items(id),
        cost_type TEXT NOT NULL CHECK(cost_type IN ('labor','material','equipment','subcontract','overhead','expense','manufacturing','revenue')),
        amount REAL NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'IQD',
        finance_document_id TEXT REFERENCES finance_documents(id),
        stock_move_id TEXT REFERENCES stock_moves(id),
        production_order_id TEXT REFERENCES production_orders(id),
        source_reference TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_cost_facts_project ON project_cost_facts(company_id, project_id, cost_type);

      CREATE TABLE IF NOT EXISTS project_effort_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        work_item_id TEXT REFERENCES work_items(id),
        phase_id TEXT REFERENCES project_phases(id),
        member_ref TEXT NOT NULL,
        role_id TEXT REFERENCES project_roles(id),
        effort_date TEXT NOT NULL,
        hours REAL NOT NULL CHECK(hours > 0),
        cost_rate_per_hour REAL NOT NULL DEFAULT 0 CHECK(cost_rate_per_hour >= 0),
        bill_rate_per_hour REAL NOT NULL DEFAULT 0 CHECK(bill_rate_per_hour >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        is_billable INTEGER NOT NULL DEFAULT 1,
        billed_document_id TEXT REFERENCES finance_documents(id),
        cost_fact_id TEXT REFERENCES project_cost_facts(id),
        source TEXT NOT NULL DEFAULT 'project_entry',
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_billing_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        billing_method TEXT NOT NULL CHECK(billing_method IN ('fixed_price','time_and_material','milestone','progress')),
        revenue_account_id TEXT REFERENCES finance_accounts(id),
        receivable_account_id TEXT REFERENCES finance_accounts(id),
        retainage_account_id TEXT REFERENCES finance_accounts(id),
        retainage_percent REAL NOT NULL DEFAULT 0 CHECK(retainage_percent >= 0 AND retainage_percent < 100),
        default_bill_rate REAL NOT NULL DEFAULT 0 CHECK(default_bill_rate >= 0),
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(project_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_billings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        billing_method TEXT NOT NULL,
        milestone_id TEXT REFERENCES project_milestones(id),
        amount REAL NOT NULL CHECK(amount > 0),
        retainage_amount REAL NOT NULL DEFAULT 0 CHECK(retainage_amount >= 0),
        currency TEXT NOT NULL DEFAULT 'IQD',
        percent_complete REAL,
        finance_document_id TEXT REFERENCES finance_documents(id),
        status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
        billed_by TEXT NOT NULL,
        billed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_change_orders (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        reference TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        contract_value_delta REAL NOT NULL DEFAULT 0,
        budget_delta REAL NOT NULL DEFAULT 0,
        schedule_delta_days REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
        requested_by TEXT NOT NULL,
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, reference)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_risks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        likelihood TEXT NOT NULL DEFAULT 'medium' CHECK(likelihood IN ('low','medium','high')),
        impact TEXT NOT NULL DEFAULT 'medium' CHECK(impact IN ('low','medium','high')),
        mitigation TEXT,
        owner_ref TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','mitigated','realised','closed')),
        work_item_id TEXT REFERENCES work_items(id),
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_issues (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
        work_item_id TEXT REFERENCES work_items(id),
        raised_at TEXT NOT NULL,
        resolved_at TEXT,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        document_ref TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT 'attachment',
        title TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_profitability_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL,
        snapshot_at TEXT NOT NULL,
        budget_amount REAL NOT NULL DEFAULT 0,
        committed_amount REAL NOT NULL DEFAULT 0,
        actual_cost REAL NOT NULL DEFAULT 0,
        billed_amount REAL NOT NULL DEFAULT 0,
        unbilled_amount REAL NOT NULL DEFAULT 0,
        contract_value REAL NOT NULL DEFAULT 0,
        percent_complete REAL NOT NULL DEFAULT 0,
        forecast_at_completion REAL NOT NULL DEFAULT 0,
        margin_amount REAL NOT NULL DEFAULT 0,
        margin_percent REAL,
        currency TEXT NOT NULL DEFAULT 'IQD',
        created_by TEXT NOT NULL
      ) STRICT;
    `);

    const now = new Date().toISOString();

    // Register `project` as a canonical accounting dimension so project cost
    // flows through the Phase 03 dimension mechanism instead of a private one.
    const hasDimensions = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'finance_dimensions'",
    ).get();
    if (hasDimensions) {
      const columns = db.prepare('PRAGMA table_info(finance_dimensions)').all().map((row) => row.name);
      if (columns.includes('code') && columns.includes('company_id')) {
        const insert = db.prepare(`
          INSERT INTO finance_dimensions (id, company_id, code, name, is_active, created_at, created_by)
          VALUES (?, ?, 'project', 'Project', 1, ?, 'migration_047')
          ON CONFLICT DO NOTHING
        `);
        for (const company of db.prepare('SELECT id FROM platform_companies').all()) {
          try {
            insert.run(`findim_project_${company.id}`, company.id, now);
          } catch (_) {
            // A deployment that already defined its own project dimension keeps it.
          }
        }
      }
    }

    const insertFlag = db.prepare(`
      INSERT INTO platform_feature_flags (key, module_id, scope, enabled, audit_policy, created_at, updated_at)
      VALUES ('phase05.projects.enabled', 'project_core', 'global', 1, 'required', ?, ?)
      ON CONFLICT(key) DO NOTHING
    `);

    registerCatalogue(db, now);
    insertFlag.run(now, now);
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [id] of ACTIONS) deleteAction.run(id);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);
    db.prepare("DELETE FROM platform_feature_flags WHERE key = 'phase05.projects.enabled'").run();
    const deleteModule = db.prepare('DELETE FROM platform_modules WHERE id = ?');
    for (const [id] of MODULES.slice().reverse()) deleteModule.run(id);

    db.exec(`
      DROP TABLE IF EXISTS project_profitability_snapshots;
      DROP TABLE IF EXISTS project_documents;
      DROP TABLE IF EXISTS project_issues;
      DROP TABLE IF EXISTS project_risks;
      DROP TABLE IF EXISTS project_change_orders;
      DROP TABLE IF EXISTS project_billings;
      DROP TABLE IF EXISTS project_billing_rules;
      DROP TABLE IF EXISTS project_effort_entries;
      DROP TABLE IF EXISTS project_cost_facts;
      DROP TABLE IF EXISTS project_commitments;
      DROP TABLE IF EXISTS project_budget_lines;
      DROP TABLE IF EXISTS project_budgets;
      DROP TABLE IF EXISTS project_members;
      DROP TABLE IF EXISTS project_roles;
      DROP TABLE IF EXISTS project_milestones;
      DROP TABLE IF EXISTS project_phases;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS project_templates;
      DROP TABLE IF EXISTS project_cost_codes;
    `);
  },
};

function registerCatalogue(db, now) {
  const insertModule = db.prepare(`
    INSERT INTO platform_modules (
      id, name, version, status, kind, owner, dependencies, optional_dependencies,
      capabilities, migrations, settings, created_at, updated_at
    ) VALUES (?, ?, '1.24.2', 'enabled', 'standard', 'octagon', ?, '[]', ?, ?, '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, version = excluded.version, status = excluded.status,
      capabilities = excluded.capabilities, migrations = excluded.migrations,
      updated_at = excluded.updated_at
  `);
  for (const [id, name, capabilities] of MODULES) {
    insertModule.run(
      id, name, JSON.stringify(['platform_kernel', 'work_item_canonical', 'finance_canonical']),
      JSON.stringify(capabilities), JSON.stringify(['047_projects_and_job_costing']), now, now,
    );
  }

  const insertEntity = db.prepare(`
    INSERT INTO platform_entities (
      id, module_id, storage_owner, primary_key, label_ar, label_en, section,
      chatter, fields, relations, scope, lifecycle_policy, query_policy,
      action_policy, customization_policy, history_policy, api_exposed,
      migration_owner, created_at, updated_at
    ) VALUES (?, ?, ?, 'id', ?, ?, 'operations', 1, '{}', '{}', 'company',
      'generic', 'scoped', 'registered', 'metadata', 'audit', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, storage_owner = excluded.storage_owner,
      label_en = excluded.label_en, updated_at = excluded.updated_at
  `);
  for (const [id, moduleId, storageOwner, label] of ENTITIES) {
    insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
  }

  const errorContract = JSON.stringify({
    envelope: 'stable',
    rollback: 'project mutation, stock consequence, finance consequence, audit, outbox and idempotency are atomic',
    codes: [
      'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
      'PROJECT_STATE_INVALID', 'PROJECT_BUDGET_NOT_APPROVED', 'PROJECT_BILLING_RULE_MISSING',
      'FROZEN_ZONE_WRITE_DENIED',
    ],
  });
  const insertAction = db.prepare(`
    INSERT INTO platform_actions (
      id, module_id, entity_id, kind, allowed_states, required_permission,
      required_scope, input_schema, preconditions, transaction_owner,
      idempotency_policy, sequence_policy, audit_policy, outbox_policy,
      reversal_action, result_schema, error_contract, created_at, updated_at
    ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
      'platform_action_executor', 'required', 'none', 'required', 'required',
      ?, NULL, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      module_id = excluded.module_id, entity_id = excluded.entity_id,
      required_permission = excluded.required_permission,
      input_schema = excluded.input_schema, reversal_action = excluded.reversal_action,
      error_contract = excluded.error_contract, updated_at = excluded.updated_at
  `);
  const reversals = {
    'project:approve': 'project:cancel',
    'project:commitment:record': 'project:commitment:release',
    'project:create': 'project:cancel',
  };
  for (const [id, moduleId, entityId, permission, required] of ACTIONS) {
    insertAction.run(
      id, moduleId, entityId, permission,
      JSON.stringify({ type: 'object', required }),
      reversals[id] || null, errorContract, now, now,
    );
  }
}
