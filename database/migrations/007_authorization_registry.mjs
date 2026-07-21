// 007_authorization_registry — Phase 02 Wave B (packets 02.06 – 02.11)
//
// Source composition:
// - VNext vnext/server/acl/acl-engine.js (project-owned, MERGE-CANONICAL):
//   x_acl_roles / x_acl_grants / x_acl_field_rules shapes and the {all,dept,own}
//   scope ranking are the base. Extended with: explicit DENY effect, permission
//   registry with stable ids, role templates + versioning, record predicates
//   beyond dept/own, route coverage, and persisted decisions.
// - Odoo odoo/addons/base/models/ir_rule.py + res_groups.py (clean-room):
//   record rules as per-model domains combined per group; global vs group rules.
// - NocoBase packages/core/acl/src/acl.ts (clean-room): role→resource→action→
//   fields→data-scope decomposition.
// - RuoYi yudao-module-system data-scope + menu/button permission tokens
//   (MIT reference, behavior only).
//
// Canonical authority: ONE permission namespace, ONE grant table, ONE decision
// log. platform_acl_roles / platform_acl_grants from Phase 01 remain as
// compatibility READ sources for the Phase 01 hook and are mirrored into the new
// tables here; the legacy tables get no new writer. See legacy-authority-cutover.md.

export const migration = {
  id: '007_authorization_registry',
  owner: 'platform.authorization',
  version: '2.0.0',
  dependsOn: ['006_identity_authority'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext acl-engine (project-owned) + Odoo ir_rule/res_groups clean-room + NocoBase acl.ts clean-room + RuoYi data-scope reference',

  up(dialect) {
    const now = new Date().toISOString();

    dialect.exec(`
      -- One vocabulary for the entire product (packet 02.06).
      CREATE TABLE IF NOT EXISTS authorization_permissions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'module','page','resource','action','field','document_state','report',
          'import','export','print','share','configuration','settings','file',
          'integration','api','ai_tool','scope'
        )),
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        label_ar TEXT,
        label_en TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0,
        depends_on TEXT NOT NULL DEFAULT '[]',
        deprecated INTEGER NOT NULL DEFAULT 0,
        replaced_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_perm_module ON authorization_permissions(module_id);
      CREATE INDEX IF NOT EXISTS idx_perm_resource ON authorization_permissions(resource, action);

      CREATE TABLE IF NOT EXISTS authorization_role_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        label_ar TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        permissions TEXT NOT NULL DEFAULT '[]',
        field_rules TEXT NOT NULL DEFAULT '[]',
        record_scopes TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_role_template ON authorization_role_templates(name, version);

      CREATE TABLE IF NOT EXISTS authorization_roles (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        name TEXT NOT NULL,
        label_ar TEXT,
        template_id TEXT,
        template_version INTEGER,
        is_system INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_role_name ON authorization_roles(tenant_id, name);

      -- effect='deny' always wins over 'allow' (§ 9.1, § 32).
      CREATE TABLE IF NOT EXISTS authorization_grants (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        effect TEXT NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
        scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','company','branch','department','warehouse','project','team','own','assignee')),
        document_states TEXT NOT NULL DEFAULT '[]',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_grant ON authorization_grants(role_id, permission, effect);
      CREATE INDEX IF NOT EXISTS idx_grant_role ON authorization_grants(role_id);

      CREATE TABLE IF NOT EXISTS authorization_role_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        company_id TEXT,
        branch_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        valid_from TEXT,
        valid_to TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_role_assignment ON authorization_role_assignments(user_id, role_id, COALESCE(company_id,''), COALESCE(branch_id,''));
      CREATE INDEX IF NOT EXISTS idx_role_assignment_user ON authorization_role_assignments(user_id, status);

      CREATE TABLE IF NOT EXISTS authorization_field_rules (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        field TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('read','write','none','masked')),
        classification TEXT NOT NULL DEFAULT 'normal' CHECK (classification IN ('normal','personal','secret')),
        condition TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_field_rule ON authorization_field_rules(role_id, entity, field);

      CREATE TABLE IF NOT EXISTS authorization_record_scopes (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        scope_kind TEXT NOT NULL CHECK (scope_kind IN ('all','tenant','company','branch','department','warehouse','project','employee','own','assignee','team','predicate')),
        predicate TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_record_scope ON authorization_record_scopes(role_id, entity, scope_kind);

      -- Every protected route must appear here or it is denied (packet 02.10).
      CREATE TABLE IF NOT EXISTS authorization_route_coverage (
        id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        route TEXT NOT NULL,
        module_id TEXT NOT NULL,
        permission TEXT,
        public INTEGER NOT NULL DEFAULT 0,
        rationale TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_route_coverage ON authorization_route_coverage(method, route);

      -- Persisted decision evidence (§ 15, packet 02.30).
      CREATE TABLE IF NOT EXISTS authorization_decisions (
        decision_id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        branch_id TEXT,
        permission TEXT NOT NULL,
        resource TEXT,
        action TEXT,
        record_id TEXT,
        allowed INTEGER NOT NULL,
        reason_code TEXT NOT NULL,
        matched_grants TEXT NOT NULL DEFAULT '[]',
        matched_denies TEXT NOT NULL DEFAULT '[]',
        effective_scopes TEXT NOT NULL DEFAULT '[]',
        required_approval INTEGER NOT NULL DEFAULT 0,
        policy_references TEXT NOT NULL DEFAULT '[]',
        audit_classification TEXT NOT NULL DEFAULT 'normal',
        correlation_id TEXT,
        source_channel TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_decisions_actor ON authorization_decisions(actor_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_denied ON authorization_decisions(allowed, occurred_at);
    `);

    // ---- Seed the least-privilege system role templates ---------------------
    const tpl = dialect.prepare(`
      INSERT INTO authorization_role_templates (id, name, label_ar, version, permissions, field_rules, record_scopes, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, 'active', ?, ?) ON CONFLICT(id) DO NOTHING
    `);
    tpl.run('tpl_owner', 'owner', 'مالك النظام', JSON.stringify([{ permission: '*', scope: 'all' }]), '[]', '[]', now, now);
    tpl.run('tpl_viewer', 'viewer', 'مستعرض', JSON.stringify([]), '[]', '[]', now, now);

    // ---- Mirror Phase 01 platform_acl_roles/grants into the canonical tables --
    // Read-once migration. The legacy tables keep no writer after this point.
    const insRole = dialect.prepare(`
      INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 'active', ?, ?) ON CONFLICT(id) DO NOTHING
    `);
    const insGrant = dialect.prepare(`
      INSERT INTO authorization_grants (id, role_id, permission, effect, scope, created_at, created_by)
      VALUES (?, ?, ?, 'allow', ?, ?, 'migration:007') ON CONFLICT DO NOTHING
    `);
    const tenants = dialect.prepare("SELECT id FROM platform_tenants WHERE status = 'active'").all();
    const legacyRoles = dialect.prepare('SELECT role, label_ar FROM platform_acl_roles').all();
    const legacyGrants = dialect.prepare('SELECT role, perm, scope FROM platform_acl_grants').all();
    const SCOPE_MAP = { all: 'all', dept: 'department', own: 'own' };
    for (const tenant of tenants) {
      for (const r of legacyRoles) {
        const roleId = `role_${tenant.id}_${r.role}`;
        insRole.run(roleId, tenant.id, r.role, r.label_ar, now, now);
        for (const g of legacyGrants.filter((x) => x.role === r.role)) {
          insGrant.run(`grant_${roleId}_${g.perm.replace(/[^a-zA-Z0-9]/g, '_')}`, roleId, g.perm, SCOPE_MAP[g.scope] || 'all', now);
        }
      }
    }
    // The seeded system user is an owner of the default tenant.
    dialect.prepare(`
      INSERT INTO authorization_role_assignments (id, user_id, role_id, status, created_at, created_by)
      VALUES (?, 'system', 'role_default_admin', 'active', ?, 'migration:007')
      ON CONFLICT DO NOTHING
    `).run('asg_system_admin', now);

    // ---- platform_users view becomes role-aware ------------------------------
    // Phase 01's permission hook reads platform_users.roles; it now sees the
    // canonical assignment table instead of a denormalized column. Still exactly
    // one writer (authorization_role_assignments); the view is derived.
    dialect.exec(`
      DROP VIEW IF EXISTS platform_users;
      CREATE VIEW platform_users AS
        SELECT
          u.id         AS id,
          m.company_id AS company_id,
          m.branch_id  AS branch_id,
          u.name       AS name,
          u.email      AS email,
          u.status     AS status,
          COALESCE((
            SELECT '["' || GROUP_CONCAT(r.name, '","') || '"]'
            FROM authorization_role_assignments a
            JOIN authorization_roles r ON r.id = a.role_id AND r.status = 'active'
            WHERE a.user_id = u.id AND a.status = 'active'
              AND (a.company_id IS NULL OR a.company_id = m.company_id)
          ), '[]') AS roles,
          u.created_at AS created_at
        FROM identity_users u
        JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'active';
    `);
  },

  down(dialect) {
    dialect.exec(`
      DROP VIEW IF EXISTS platform_users;
      CREATE VIEW platform_users AS
        SELECT u.id, m.company_id, m.branch_id, u.name, u.email, u.status, '[]' AS roles, u.created_at
        FROM identity_users u
        JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'active';

      DROP TABLE IF EXISTS authorization_decisions;
      DROP TABLE IF EXISTS authorization_route_coverage;
      DROP TABLE IF EXISTS authorization_record_scopes;
      DROP TABLE IF EXISTS authorization_field_rules;
      DROP TABLE IF EXISTS authorization_role_assignments;
      DROP TABLE IF EXISTS authorization_grants;
      DROP TABLE IF EXISTS authorization_roles;
      DROP TABLE IF EXISTS authorization_role_templates;
      DROP TABLE IF EXISTS authorization_permissions;
    `);
  }
};
