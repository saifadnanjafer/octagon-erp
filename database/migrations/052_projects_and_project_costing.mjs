// 052_projects_and_project_costing — Canonical Projects workspace (Checkpoint D1)
//
// What this migration does:
//   1. Adds the canonical project register (projects, templates, phases,
//      milestones, deliverables, WBS nodes).
//   2. Adds the project financial dimensions: cost codes, budget lines
//      (approved + revised), and commitments.
//   3. Adds project governance records: change orders, risks, issues,
//      documents.
//   4. Adds project billing requests (fixed price / milestone / T&M) with a
//      retention foundation.
//   5. Adds project effort entries — NEW canonical labor facts owned by this
//      module. These NEVER read or write payroll/attendance/timesheet tables.
//   6. Registers the entities and governed actions in the platform registry.
//
// Authority boundaries honoured here:
//   - Project tasks are canonical work_items (work_items.project_ref), so no
//     second task table is created.
//   - Actual cost is DERIVED from canonical facts (stock moves, procurement,
//     effort entries) at query time. No duplicate profitability total is
//     stored as an independent authority.
//   - Revenue/cost postings stay with Phase 03 Finance; this module only
//     raises governed billing requests.
//
// Source provenance: clean-room behavioural implementation. The project-owned
// VNext donor (octagon-erp-commercial-vnext/vnext/server/modules/projects/
// project-engine.js @ cf7ae4ed) is a 17-line stub and carried no reusable
// lifecycle, so nothing was salvaged from it. Lifecycle shape (phase ->
// milestone -> billing, budget vs committed vs actual) is a clean-room
// behavioural adaptation of Odoo 19 Community `project` / `sale_project` and
// ERPNext `projects` module concepts; no donor code was copied.

const MODULE_ID = 'platform.kernel';
const PROJECTS_MODULE = 'operations_projects';
const migrationIdSelf = '052_projects_and_project_costing';

const ENTITIES = [
  ['project', PROJECTS_MODULE, 'platform.projects', 'Project'],
  ['project_template', PROJECTS_MODULE, 'platform.projects', 'Project Template'],
  ['project_phase', PROJECTS_MODULE, 'platform.projects', 'Project Phase'],
  ['project_milestone', PROJECTS_MODULE, 'platform.projects', 'Project Milestone'],
  ['project_cost_code', PROJECTS_MODULE, 'platform.projects', 'Project Cost Code'],
  ['project_budget_line', PROJECTS_MODULE, 'platform.projects', 'Project Budget Line'],
  ['project_commitment', PROJECTS_MODULE, 'platform.projects', 'Project Commitment'],
  ['project_change_order', PROJECTS_MODULE, 'platform.projects', 'Project Change Order'],
  ['project_risk', PROJECTS_MODULE, 'platform.projects', 'Project Risk'],
  ['project_issue', PROJECTS_MODULE, 'platform.projects', 'Project Issue'],
  ['project_billing_request', PROJECTS_MODULE, 'platform.projects', 'Project Billing Request'],
  ['project_effort_entry', PROJECTS_MODULE, 'platform.projects', 'Project Effort Entry'],
];

const ACTIONS = [
  ['projects:project:create', 'project', 'projects:project:write', ['name']],
  ['projects:project:update', 'project', 'projects:project:write', ['project_id']],
  ['projects:project:set_status', 'project', 'projects:project:write', ['project_id', 'status']],
  ['projects:project:archive', 'project', 'projects:project:write', ['project_id']],
  ['projects:project:apply_template', 'project', 'projects:project:write', ['project_id', 'template_id']],
  ['projects:template:create', 'project_template', 'projects:project:write', ['name']],
  ['projects:phase:create', 'project_phase', 'projects:project:write', ['project_id', 'name']],
  ['projects:phase:update', 'project_phase', 'projects:project:write', ['phase_id']],
  ['projects:milestone:create', 'project_milestone', 'projects:project:write', ['project_id', 'name']],
  ['projects:milestone:achieve', 'project_milestone', 'projects:project:write', ['milestone_id']],
  ['projects:cost_code:create', 'project_cost_code', 'projects:budget:write', ['project_id', 'code', 'name']],
  ['projects:budget:set_line', 'project_budget_line', 'projects:budget:write', ['project_id', 'cost_code_id', 'amount']],
  ['projects:budget:approve', 'project_budget_line', 'projects:budget:approve', ['project_id']],
  ['projects:budget:revise', 'project_budget_line', 'projects:budget:approve', ['project_id', 'cost_code_id', 'amount']],
  ['projects:commitment:record', 'project_commitment', 'projects:budget:write', ['project_id', 'cost_code_id', 'amount']],
  ['projects:commitment:release', 'project_commitment', 'projects:budget:write', ['commitment_id']],
  ['projects:change_order:create', 'project_change_order', 'projects:project:write', ['project_id', 'title']],
  ['projects:change_order:approve', 'project_change_order', 'projects:budget:approve', ['change_order_id']],
  ['projects:change_order:reject', 'project_change_order', 'projects:budget:approve', ['change_order_id']],
  ['projects:risk:create', 'project_risk', 'projects:project:write', ['project_id', 'title']],
  ['projects:risk:update', 'project_risk', 'projects:project:write', ['risk_id']],
  ['projects:issue:create', 'project_issue', 'projects:project:write', ['project_id', 'title']],
  ['projects:issue:resolve', 'project_issue', 'projects:project:write', ['issue_id']],
  ['projects:task:create', 'project', 'projects:project:write', ['project_id', 'title']],
  // Effort may anchor to a project OR a production / work / maintenance
  // order, so only `hours` is schema-required; the engine enforces that at
  // least one canonical execution anchor is present.
  ['projects:effort:record', 'project_effort_entry', 'projects:effort:write', ['hours']],
  ['projects:billing:request', 'project_billing_request', 'projects:billing:write', ['project_id', 'amount']],
  ['projects:billing:approve', 'project_billing_request', 'projects:billing:approve', ['billing_request_id']],
];

// Standard-cost rate configuration. Manufacturing/Projects labour cost is
// derived from THESE configured rates — never from payroll facts.
const DEFAULT_COST_RATES = [
  ['role', 'project_manager', 12.0],
  ['role', 'engineer', 9.0],
  ['role', 'technician', 6.0],
  ['role', 'operator', 5.0],
  ['role', 'default', 5.0],
];

export const migration = {
  id: '052_projects_and_project_costing',
  owner: MODULE_ID,
  version: '1.31.0',
  parent: '051_checkpoint_c_control_entity_policy',
  dependsOn: ['051_checkpoint_c_control_entity_policy'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Clean-room behavioural implementation on canonical work_items/finance/inventory authorities. VNext projects donor (vnext/server/modules/projects/project-engine.js @ cf7ae4ed) was inspected and found to be a 17-line stub; nothing salvaged. Lifecycle concepts modelled behaviourally on Odoo 19 Community project/sale_project and ERPNext projects; no donor code copied.',

  up(db) {
    // ---------------------------------------------------------------
    // 1. Project register, templates, phases, milestones, WBS
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        default_billing_method TEXT NOT NULL DEFAULT 'fixed_price'
          CHECK(default_billing_method IN ('fixed_price','milestone','time_and_material')),
        phases TEXT NOT NULL DEFAULT '[]',
        milestones TEXT NOT NULL DEFAULT '[]',
        cost_codes TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        branch_id TEXT,
        project_number TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        party_id TEXT REFERENCES parties(id),
        contract_id TEXT,
        sale_order_id TEXT,
        template_id TEXT REFERENCES project_templates(id),
        manager_user_id TEXT,
        team TEXT NOT NULL DEFAULT '[]',
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft','active','on_hold','completed','cancelled','archived')),
        billing_method TEXT NOT NULL DEFAULT 'fixed_price'
          CHECK(billing_method IN ('fixed_price','milestone','time_and_material')),
        contract_value REAL NOT NULL DEFAULT 0.0,
        retention_percent REAL NOT NULL DEFAULT 0.0,
        currency_code TEXT NOT NULL DEFAULT 'IQD',
        cost_center_id TEXT,
        analytic_dimension TEXT NOT NULL DEFAULT '{}',
        documents TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, project_number)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_projects_company_status ON projects(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_projects_party ON projects(party_id);

      CREATE TABLE IF NOT EXISTS project_phases (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_phase_id TEXT REFERENCES project_phases(id) ON DELETE CASCADE,
        wbs_code TEXT NOT NULL DEFAULT '',
        sequence INTEGER NOT NULL DEFAULT 10,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        planned_start TEXT,
        planned_end TEXT,
        actual_start TEXT,
        actual_end TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        progress REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK(status IN ('planned','in_progress','completed','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id, sequence);

      CREATE TABLE IF NOT EXISTS project_milestones (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        phase_id TEXT REFERENCES project_phases(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        due_date TEXT,
        achieved_at TEXT,
        achieved_by TEXT,
        billing_amount REAL NOT NULL DEFAULT 0.0,
        billing_percent REAL NOT NULL DEFAULT 0.0,
        is_billable INTEGER NOT NULL DEFAULT 0,
        billing_request_id TEXT,
        deliverables TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','achieved','missed','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id, status);
    `);

    // ---------------------------------------------------------------
    // 2. Cost codes, budget lines, commitments
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_cost_codes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        cost_type TEXT NOT NULL DEFAULT 'material'
          CHECK(cost_type IN ('material','labor','machine','subcontract','overhead','other')),
        account_id TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, code)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_budget_lines (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cost_code_id TEXT NOT NULL REFERENCES project_cost_codes(id) ON DELETE CASCADE,
        approved_amount REAL NOT NULL DEFAULT 0.0,
        revised_amount REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','approved','revised')),
        approved_by TEXT,
        approved_at TEXT,
        revision_no INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, cost_code_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_commitments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cost_code_id TEXT NOT NULL REFERENCES project_cost_codes(id),
        source_type TEXT NOT NULL DEFAULT 'purchase_order'
          CHECK(source_type IN ('purchase_order','subcontract','manual','production_order')),
        source_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0.0,
        released_amount REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'open'
          CHECK(state IN ('open','partially_released','released','cancelled')),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_commitments_project ON project_commitments(project_id, state);
    `);

    // ---------------------------------------------------------------
    // 3. Change orders, risks, issues
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_change_orders (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        change_number TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cost_impact REAL NOT NULL DEFAULT 0.0,
        revenue_impact REAL NOT NULL DEFAULT 0.0,
        schedule_impact_days INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','submitted','approved','rejected','cancelled')),
        requested_by TEXT,
        decided_by TEXT,
        decided_at TEXT,
        decision_reason TEXT NOT NULL DEFAULT '',
        attachments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, change_number)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_risks (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        probability INTEGER NOT NULL DEFAULT 3 CHECK(probability BETWEEN 1 AND 5),
        impact INTEGER NOT NULL DEFAULT 3 CHECK(impact BETWEEN 1 AND 5),
        severity INTEGER NOT NULL DEFAULT 9,
        mitigation TEXT NOT NULL DEFAULT '',
        owner_user_id TEXT,
        state TEXT NOT NULL DEFAULT 'open'
          CHECK(state IN ('open','mitigated','accepted','closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_issues (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'medium'
          CHECK(severity IN ('low','medium','high','critical')),
        raised_by TEXT,
        assigned_user_id TEXT,
        work_item_id TEXT,
        resolution TEXT NOT NULL DEFAULT '',
        resolved_at TEXT,
        state TEXT NOT NULL DEFAULT 'open'
          CHECK(state IN ('open','in_progress','resolved','closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);

    // ---------------------------------------------------------------
    // 4. Billing requests (with retention foundation)
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_billing_requests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        milestone_id TEXT REFERENCES project_milestones(id),
        billing_method TEXT NOT NULL DEFAULT 'fixed_price'
          CHECK(billing_method IN ('fixed_price','milestone','time_and_material')),
        description TEXT NOT NULL DEFAULT '',
        gross_amount REAL NOT NULL DEFAULT 0.0,
        retention_percent REAL NOT NULL DEFAULT 0.0,
        retention_amount REAL NOT NULL DEFAULT 0.0,
        net_amount REAL NOT NULL DEFAULT 0.0,
        effort_hours REAL NOT NULL DEFAULT 0.0,
        state TEXT NOT NULL DEFAULT 'draft'
          CHECK(state IN ('draft','approved','invoiced','cancelled')),
        approved_by TEXT,
        approved_at TEXT,
        finance_document_id TEXT,
        requested_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_billing_project ON project_billing_requests(project_id, state);
    `);

    // ---------------------------------------------------------------
    // 5. Effort entries + standard cost rates
    //
    // FROZEN-ZONE BOUNDARY: these are NEW canonical facts owned by this
    // module. employee_id is a read-only reference only. Cost is computed
    // from project_cost_rates (configured standard cost) and NEVER from
    // payroll, attendance, or timesheet data.
    // ---------------------------------------------------------------
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_cost_rates (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL DEFAULT '*',
        rate_scope TEXT NOT NULL DEFAULT 'role'
          CHECK(rate_scope IN ('role','employee','work_center')),
        rate_key TEXT NOT NULL,
        hourly_cost REAL NOT NULL DEFAULT 0.0,
        currency_code TEXT NOT NULL DEFAULT 'IQD',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(company_id, rate_scope, rate_key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS project_effort_entries (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        branch_id TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        phase_id TEXT REFERENCES project_phases(id) ON DELETE SET NULL,
        cost_code_id TEXT REFERENCES project_cost_codes(id),
        work_item_id TEXT,
        production_order_id TEXT,
        work_order_id TEXT,
        maintenance_order_id TEXT,
        employee_ref TEXT,
        role_key TEXT NOT NULL DEFAULT 'default',
        work_center_id TEXT,
        entry_type TEXT NOT NULL DEFAULT 'labor'
          CHECK(entry_type IN ('labor','machine')),
        effort_date TEXT NOT NULL,
        hours REAL NOT NULL CHECK(hours > 0),
        hourly_cost REAL NOT NULL DEFAULT 0.0,
        total_cost REAL NOT NULL DEFAULT 0.0,
        rate_source TEXT NOT NULL DEFAULT 'role',
        notes TEXT NOT NULL DEFAULT '',
        recorded_by TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_effort_project ON project_effort_entries(project_id, effort_date);
      CREATE INDEX IF NOT EXISTS idx_project_effort_production ON project_effort_entries(production_order_id);
    `);

    // Link-only cost attribution. This table carries NO amounts: it maps a
    // canonical source fact (a stock move, a purchase order line, a finance
    // document) to a project + cost code. Actual cost is always read from the
    // source fact at query time, so this can never drift into a second
    // costing authority.
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_cost_links (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        cost_code_id TEXT REFERENCES project_cost_codes(id),
        source_authority TEXT NOT NULL
          CHECK(source_authority IN ('stock_move','purchase_order_line','finance_document','effort_entry','production_order')),
        source_id TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source_authority, source_id, project_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_project_cost_links_project
        ON project_cost_links(project_id, source_authority);
    `);

    const now = new Date().toISOString();
    const insertRate = db.prepare(`
      INSERT INTO project_cost_rates (id, company_id, rate_scope, rate_key, hourly_cost, currency_code, is_active, created_at, updated_at)
      VALUES (?, '*', ?, ?, ?, 'IQD', 1, ?, ?)
      ON CONFLICT(company_id, rate_scope, rate_key) DO NOTHING
    `);
    for (const [scope, key, cost] of DEFAULT_COST_RATES) {
      insertRate.run(`pcr_${scope}_${key}`, scope, key, cost, now, now);
    }

    // ---------------------------------------------------------------
    // 6. Registry: module, entities, governed actions
    //
    // Registering the module in platform_modules is what gives this domain
    // server-side enable/disable enforcement: the canonical ActionExecutor
    // rejects any action whose owning module is not 'enabled'
    // (platform/kernel/actions/index.mjs -> MODULE_NOT_ENABLED), and the
    // Control Plane adds per-company/branch assignment and licensing on top.
    // ---------------------------------------------------------------
    db.prepare(`
      INSERT INTO platform_modules (
        id, name, version, status, kind, owner, dependencies, optional_dependencies,
        capabilities, migrations, settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        dependencies = excluded.dependencies,
        capabilities = excluded.capabilities,
        migrations = excluded.migrations,
        updated_at = excluded.updated_at
    `).run(
      PROJECTS_MODULE, 'Projects', '1.0.0', 'enabled', 'standard', 'operations',
      JSON.stringify(['platform_kernel', 'finance', 'commercial_inventory']),
      JSON.stringify(['commercial_sales']),
      JSON.stringify(['projects.register', 'projects.budget', 'projects.billing', 'projects.effort']),
      JSON.stringify([migrationIdSelf]),
      JSON.stringify({ navigation_page: 'projects' }),
      now, now,
    );

    // Default per-company control-plane assignment so the workspace is
    // navigable where companies already exist. Licensing stays a Control
    // Plane decision; absence of a license row is not an implicit grant.
    const companies = db.prepare('SELECT id FROM platform_companies').all();
    const insertAssignment = db.prepare(`
      INSERT INTO platform_module_assignments (
        id, module_id, scope_type, scope_id, enabled, navigation_visible,
        configuration_url, configuration_status, version, created_at, updated_at, updated_by
      ) VALUES (?, ?, 'company', ?, 1, 1, ?, 'ready', 1, ?, ?, ?)
      ON CONFLICT(module_id, scope_type, scope_id) DO NOTHING
    `);
    for (const company of companies) {
      insertAssignment.run(
        `pma_${PROJECTS_MODULE}_${company.id}`,
        PROJECTS_MODULE,
        company.id,
        '/projects',
        now, now, 'migration:052',
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
        module_id = excluded.module_id,
        storage_owner = excluded.storage_owner,
        label_en = excluded.label_en,
        query_policy = 'scoped',
        action_policy = 'registered',
        history_policy = 'audit',
        updated_at = excluded.updated_at
    `);
    for (const [id, moduleId, storageOwner, label] of ENTITIES) {
      insertEntity.run(id, moduleId, storageOwner, label, label, moduleId, now, now);
    }

    const insertAction = db.prepare(`
      INSERT INTO platform_actions (
        id, module_id, entity_id, kind, allowed_states, required_permission,
        required_scope, input_schema, preconditions, transaction_owner,
        idempotency_policy, sequence_policy, audit_policy, outbox_policy,
        reversal_action, result_schema, error_contract, created_at, updated_at
      ) VALUES (?, ?, ?, 'domain', '[]', ?, 'company', ?, '[]',
        'platform_action_executor', 'required', 'none', 'required', 'required',
        NULL, NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        kind = excluded.kind,
        required_permission = excluded.required_permission,
        input_schema = excluded.input_schema,
        transaction_owner = excluded.transaction_owner,
        idempotency_policy = excluded.idempotency_policy,
        audit_policy = excluded.audit_policy,
        outbox_policy = excluded.outbox_policy,
        error_contract = excluded.error_contract,
        updated_at = excluded.updated_at
    `);
    const errorContract = JSON.stringify({
      envelope: 'stable',
      rollback: 'business mutation, audit, outbox, and idempotency are atomic',
      codes: [
        'INPUT_MISSING_FIELD', 'IDEMPOTENCY_KEY_REQUIRED', 'UNTRUSTED_ACTION_SCOPE',
        'PRECONDITION_FAILED', 'PROJECT_NOT_FOUND', 'BUDGET_NOT_APPROVED',
        'FROZEN_ZONE_WRITE_DENIED', 'MODULE_NOT_ENABLED',
      ],
    });
    for (const [actionId, entityId, permission, required] of ACTIONS) {
      insertAction.run(
        actionId,
        PROJECTS_MODULE,
        entityId,
        permission,
        JSON.stringify({ type: 'object', required }),
        errorContract,
        now,
        now,
      );
    }
  },

  down(db) {
    const deleteAction = db.prepare('DELETE FROM platform_actions WHERE id = ?');
    for (const [actionId] of ACTIONS) deleteAction.run(actionId);
    const deleteEntity = db.prepare('DELETE FROM platform_entities WHERE id = ?');
    for (const [id] of ENTITIES) deleteEntity.run(id);

    db.prepare('DELETE FROM platform_module_licenses WHERE module_id = ?').run(PROJECTS_MODULE);
    db.prepare('DELETE FROM platform_module_assignments WHERE module_id = ?').run(PROJECTS_MODULE);
    db.prepare('DELETE FROM platform_modules WHERE id = ?').run(PROJECTS_MODULE);

    db.exec(`
      DROP TABLE IF EXISTS project_cost_links;
      DROP TABLE IF EXISTS project_effort_entries;
      DROP TABLE IF EXISTS project_cost_rates;
      DROP TABLE IF EXISTS project_billing_requests;
      DROP TABLE IF EXISTS project_issues;
      DROP TABLE IF EXISTS project_risks;
      DROP TABLE IF EXISTS project_change_orders;
      DROP TABLE IF EXISTS project_commitments;
      DROP TABLE IF EXISTS project_budget_lines;
      DROP TABLE IF EXISTS project_cost_codes;
      DROP TABLE IF EXISTS project_milestones;
      DROP TABLE IF EXISTS project_phases;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS project_templates;
    `);
  },
};
