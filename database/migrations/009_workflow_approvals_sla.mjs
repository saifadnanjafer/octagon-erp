// 009_workflow_approvals_sla — Phase 02 Wave D (packets 02.17 – 02.23)
//
// Source composition:
// - VNext vnext/server/workflow/workflow-engine.js (project-owned,
//   MERGE-REFACTOR): workflow/run record shape, node types, current_node_index
//   resume pointer, rate limit and depth guard. Those lived in x_records JSON;
//   here they become first-class tables so a crashed worker can be recovered by
//   query rather than by JSON scanning.
// - VNext vnext/server/approvals/approvals.js (project-owned, MERGE-CANONICAL):
//   the nine worklist boxes (my/todo/done/cc/delegated/escalated/withdrawn/
//   rejected/returned), policy_chain + currentIndex advancement, payload_hash
//   binding, step_entered_at/escalation columns, maker≠checker.
// - VNext migration 620 business clocks (project-owned) for the SLA calendar.
// - NocoBase plugin-workflow Processor/Dispatcher/RunningExecutionRegistry/
//   ExecutionTimeoutManager (clean-room): leases, heartbeats, durable timers,
//   timeout management, version pinning of running instances.
// - RuoYi yudao-module-bpm (MIT reference, behavior only): approval task center.
// - Odoo addons/base_automation (clean-room): trigger boundary crossing.
//
// Invariants (§ 11):
//   - a running instance is pinned to its definition VERSION
//   - a node calls a REGISTERED action; there is no free-form SQL node
//   - a decision is idempotent: a duplicate decision cannot double-complete

export const migration = {
  id: '009_workflow_approvals_sla',
  owner: 'platform.workflow',
  version: '2.0.0',
  dependsOn: ['008_settings_secrets_policies'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext workflow-engine/approvals/migration-620 (project-owned) + NocoBase workflow runtime clean-room + RuoYi BPM reference + Odoo base_automation clean-room',

  up(dialect) {
    dialect.exec(`
      -- ---- Workflow definitions and versions (packet 02.17) ------------------
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        name TEXT NOT NULL,
        label_ar TEXT,
        entity TEXT NOT NULL,
        active_version INTEGER,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      -- A version is IMMUTABLE once activated. Changes create a new version.
      CREATE TABLE IF NOT EXISTS workflow_versions (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        initial_state TEXT NOT NULL,
        states TEXT NOT NULL DEFAULT '[]',
        transitions TEXT NOT NULL DEFAULT '[]',
        nodes TEXT NOT NULL DEFAULT '[]',
        triggers TEXT NOT NULL DEFAULT '[]',
        required_permission TEXT,
        approval_policy_id TEXT,
        compensation TEXT NOT NULL DEFAULT '[]',
        instance_migration_policy TEXT NOT NULL DEFAULT 'pin' CHECK (instance_migration_policy IN ('pin','migrate_on_activate')),
        effective_from TEXT,
        effective_to TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_version ON workflow_versions(definition_id, version);

      -- ---- Durable runtime (packet 02.18) ------------------------------------
      CREATE TABLE IF NOT EXISTS workflow_instances (
        id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        definition_version INTEGER NOT NULL,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_version INTEGER,
        tenant_id TEXT,
        company_id TEXT,
        current_state TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','waiting','completed','failed','cancelled','dead')),
        context TEXT NOT NULL DEFAULT '{}',
        lease_id TEXT,
        leased_until TEXT,
        heartbeat_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_attempt_at TEXT,
        timeout_at TEXT,
        correlation_id TEXT,
        idempotency_key TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        terminal_result TEXT,
        last_error TEXT,
        started_by TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_wf_instance_status ON workflow_instances(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_wf_instance_record ON workflow_instances(entity, record_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_idempotency ON workflow_instances(definition_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
        cursor INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running','done','failed','skipped','compensated')),
        attempt INTEGER NOT NULL DEFAULT 1,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        result TEXT,
        error TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_wf_steps ON workflow_steps(instance_id, cursor);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_step_attempt ON workflow_steps(instance_id, cursor, attempt);

      CREATE TABLE IF NOT EXISTS workflow_timers (
        id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('wait','timeout','escalation')),
        fire_at TEXT NOT NULL,
        fired_at TEXT,
        cancelled_at TEXT,
        calendar_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_wf_timers ON workflow_timers(fire_at, fired_at, cancelled_at);

      -- ---- Approvals (packets 02.19 / 02.20) ---------------------------------
      CREATE TABLE IF NOT EXISTS approval_policies (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        label_ar TEXT,
        mode TEXT NOT NULL DEFAULT 'sequential' CHECK (mode IN ('sequential','any_one_of','all_required','quorum','parallel')),
        chain TEXT NOT NULL DEFAULT '[]',
        quorum INTEGER,
        amount_threshold REAL,
        escalate_role TEXT,
        escalation_timeout_minutes INTEGER,
        maker_checker INTEGER NOT NULL DEFAULT 1,
        allow_return INTEGER NOT NULL DEFAULT 1,
        calendar_id TEXT,
        company_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_policy ON approval_policies(entity, action, COALESCE(company_id,''));

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        policy_id TEXT REFERENCES approval_policies(id),
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        payload_hash TEXT NOT NULL,
        amount REAL,
        requester_id TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        current_step INTEGER NOT NULL DEFAULT 0,
        current_roles TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned','withdrawn','expired')),
        cc TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        step_entered_at TEXT NOT NULL,
        escalated INTEGER NOT NULL DEFAULT 0,
        escalated_at TEXT,
        escalated_from_role TEXT,
        expires_at TEXT,
        workflow_instance_id TEXT,
        correlation_id TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status, company_id);
      CREATE INDEX IF NOT EXISTS idx_approval_record ON approval_requests(entity, record_id);

      CREATE TABLE IF NOT EXISTS approval_decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        decider_id TEXT NOT NULL,
        on_behalf_of TEXT,
        delegation_id TEXT,
        decision TEXT NOT NULL CHECK (decision IN ('approve','reject','return','withdraw','escalate')),
        comment TEXT,
        attachments TEXT NOT NULL DEFAULT '[]',
        decided_at TEXT NOT NULL,
        request_version INTEGER NOT NULL
      ) STRICT;
      -- One decision per decider per step: the concurrency guard.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_once ON approval_decisions(request_id, step, decider_id);

      CREATE TABLE IF NOT EXISTS worklist_items (
        id TEXT PRIMARY KEY,
        request_id TEXT REFERENCES approval_requests(id) ON DELETE CASCADE,
        instance_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('approval','activity','exception','failed_job')),
        assignee_id TEXT,
        candidate_role TEXT,
        company_id TEXT,
        title_ar TEXT,
        due_at TEXT,
        sla_calendar_id TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','done','cancelled')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_worklist_assignee ON worklist_items(assignee_id, status);
      CREATE INDEX IF NOT EXISTS idx_worklist_role ON worklist_items(candidate_role, status);

      -- ---- Business calendars and SLA (packet 02.23) -------------------------
      CREATE TABLE IF NOT EXISTS business_calendars (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        label_ar TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad',
        tenant_id TEXT,
        company_id TEXT,
        branch_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS business_calendar_shifts (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
        end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_calendar_shifts ON business_calendar_shifts(calendar_id, weekday);

      CREATE TABLE IF NOT EXISTS business_calendar_holidays (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        label_ar TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_calendar_holiday ON business_calendar_holidays(calendar_id, date);

      CREATE TABLE IF NOT EXISTS sla_clocks (
        id TEXT PRIMARY KEY,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        -- The calendar is snapshotted at start so a later calendar edit cannot
        -- retroactively change an already-running clock (§ 48).
        calendar_snapshot TEXT NOT NULL,
        target_minutes INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        due_at TEXT NOT NULL,
        paused_at TEXT,
        paused_reason TEXT,
        paused_total_minutes INTEGER NOT NULL DEFAULT 0,
        stopped_at TEXT,
        breached INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_sla_subject ON sla_clocks(subject_kind, subject_id);

      -- ---- Business rules / automation (packet 02.21) ------------------------
      CREATE TABLE IF NOT EXISTS automation_rules (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        name TEXT NOT NULL,
        label_ar TEXT,
        entity TEXT NOT NULL,
        trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('create','update','state_change','event','time')),
        trigger_config TEXT NOT NULL DEFAULT '{}',
        precondition TEXT NOT NULL DEFAULT '{}',
        postcondition TEXT NOT NULL DEFAULT '{}',
        boundary_field TEXT,
        action_id TEXT NOT NULL,
        action_input TEXT NOT NULL DEFAULT '{}',
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
        max_depth INTEGER NOT NULL DEFAULT 5,
        tenant_id TEXT,
        company_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_automation_entity ON automation_rules(entity, trigger_kind, enabled);

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        record_id TEXT,
        event_key TEXT,
        depth INTEGER NOT NULL DEFAULT 1,
        outcome TEXT NOT NULL CHECK (outcome IN ('executed','skipped','rate_limited','loop_blocked','boundary_not_crossed','failed','dry_run')),
        detail TEXT,
        correlation_id TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs(rule_id, occurred_at);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_automation_event ON automation_runs(rule_id, event_key) WHERE event_key IS NOT NULL;
    `);

    // A default Iraq-shaped business calendar: Sunday–Thursday 08:00–16:00,
    // Friday and Saturday non-working. Matches the Octagon workshop week.
    const now = new Date().toISOString();
    dialect.prepare(`INSERT INTO business_calendars (id, name, label_ar, timezone, status, created_at) VALUES (?, ?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`)
      .run('cal_default', 'default', 'التقويم الافتراضي', 'Asia/Baghdad', now);
    const shift = dialect.prepare('INSERT INTO business_calendar_shifts (id, calendar_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
    // JS weekday: 0=Sunday .. 6=Saturday. Working days: Sun(0)..Thu(4).
    for (const weekday of [0, 1, 2, 3, 4]) {
      shift.run(`shift_default_${weekday}`, 'cal_default', weekday, 8 * 60, 16 * 60);
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS automation_runs;
      DROP TABLE IF EXISTS automation_rules;
      DROP TABLE IF EXISTS sla_clocks;
      DROP TABLE IF EXISTS business_calendar_holidays;
      DROP TABLE IF EXISTS business_calendar_shifts;
      DROP TABLE IF EXISTS business_calendars;
      DROP TABLE IF EXISTS worklist_items;
      DROP TABLE IF EXISTS approval_decisions;
      DROP TABLE IF EXISTS approval_requests;
      DROP TABLE IF EXISTS approval_policies;
      DROP TABLE IF EXISTS workflow_timers;
      DROP TABLE IF EXISTS workflow_steps;
      DROP TABLE IF EXISTS workflow_instances;
      DROP TABLE IF EXISTS workflow_versions;
      DROP TABLE IF EXISTS workflow_definitions;
    `);
  }
};
