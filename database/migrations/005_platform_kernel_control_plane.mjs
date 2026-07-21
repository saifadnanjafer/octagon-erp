// 005_platform_kernel_control_plane
//
// Source composition:
// - VNext R1 organization/fiscal structures (project-owned).
// - RuoYi tenant package (MIT reference) for company/branch/user vocabulary.
// - Frappe hooks (MIT reference) for settings/feature defaults.
//
// Creates control-plane foundation tables: companies, branches, users,
// feature_flags, jobs, and health contributors. Full administration UI is
// deferred to Phase 02/08.

export const migration = {
  id: '005_platform_kernel_control_plane',
  owner: 'platform.kernel',
  version: '1.0.0',
  dependsOn: ['004_platform_kernel_views'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext R1/R8 organization concepts + RuoYi tenant reference + Frappe settings reference',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS platform_tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_companies (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        fiscal_year_start INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_companies_tenant ON platform_companies(tenant_id);

      CREATE TABLE IF NOT EXISTS platform_branches (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_branches_company ON platform_branches(company_id);

      CREATE TABLE IF NOT EXISTS platform_users (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        branch_id TEXT REFERENCES platform_branches(id),
        name TEXT NOT NULL,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        roles TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_users_company ON platform_users(company_id);

      CREATE TABLE IF NOT EXISTS platform_feature_flags (
        key TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        scope TEXT NOT NULL DEFAULT 'company' CHECK (scope IN ('tenant','company','branch','user','global')),
        enabled INTEGER NOT NULL DEFAULT 0,
        audit_policy TEXT NOT NULL DEFAULT 'required',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_jobs (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL REFERENCES platform_modules(id),
        name TEXT NOT NULL,
        schedule TEXT,
        handler TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        lease_id TEXT,
        leased_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_jobs_module ON platform_jobs(module_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_enabled ON platform_jobs(enabled);

      CREATE TABLE IF NOT EXISTS platform_health_contributors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        check_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS platform_acl_roles (
        role TEXT PRIMARY KEY,
        label_ar TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS platform_acl_grants (
        role TEXT NOT NULL,
        perm TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'all',
        PRIMARY KEY (role, perm)
      ) STRICT;
    `);

    const now = new Date().toISOString();
    dialect.prepare('INSERT INTO platform_acl_roles (role, label_ar) VALUES (?, ?) ON CONFLICT(role) DO NOTHING').run('admin', 'مدير النظام');
    dialect.prepare('INSERT INTO platform_acl_grants (role, perm, scope) VALUES (?, ?, ?) ON CONFLICT(role, perm) DO NOTHING').run('admin', '*', 'all');
    dialect.prepare(`
      INSERT INTO platform_tenants (id, name, status, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status
    `).run('default', 'Default Tenant', 'active', now);
    dialect.prepare(`
      INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status
    `).run('default', 'default', 'Default Company', 'active', 1, now);
    dialect.prepare(`
      INSERT INTO platform_branches (id, company_id, name, status, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status
    `).run('default', 'default', 'Default Branch', 'active', now);
    dialect.prepare(`
      INSERT INTO platform_users (id, company_id, branch_id, name, status, roles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status
    `).run('system', 'default', 'default', 'System User', 'active', '[]', now);
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS platform_health_contributors;
      DROP TABLE IF EXISTS platform_jobs;
      DROP TABLE IF EXISTS platform_feature_flags;
      DROP TABLE IF EXISTS platform_users;
      DROP TABLE IF EXISTS platform_branches;
      DROP TABLE IF EXISTS platform_companies;
      DROP TABLE IF EXISTS platform_tenants;
    `);
  }
};
