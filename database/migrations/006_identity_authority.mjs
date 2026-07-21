// 006_identity_authority — Phase 02 Wave A
//
// Source composition (see docs/evidence/phase-02/source-composition-ledger.md
// rows GV-001, GV-019, PK-012):
// - VNext vnext/server/auth/auth-hardening.js (project-owned): x_totp_enrollments,
//   x_auth_password_policy, x_session_revocations, x_api_keys shapes.
// - VNext vnext/server/modules/governance/sso-engine.js (project-owned): provider
//   registry shape.
// - Odoo addons/auth_totp, auth_oauth, auth_password_policy (clean-room behavior).
// - RuoYi yudao-module-system login-log / user tables (MIT reference, behavior only).
//
// Canonical authority created here:
//   identity_users            — THE user record (replaces platform_users as a writer)
//   identity_credentials      — password hashes, never in identity_users
//   identity_sessions         — revocable, expiring, rotatable sessions
//   identity_session_events   — device/login history
//   identity_login_attempts   — lockout / brute-force evidence
//   identity_password_policy  — typed policy, single row
//   identity_password_resets  — single-use, expiring reset tokens
//   identity_mfa_methods      — TOTP + recovery codes
//   identity_service_accounts — machine actors, cannot hold a session
//   identity_api_keys         — hashed only, scoped, expiring, revocable
//   identity_sso_providers    — per-tenant OIDC/OAuth/SAML adapters
//   identity_sso_logins       — state/nonce/PKCE replay protection
//   identity_impersonations   — audited, time-bounded, privilege-limited
//
// platform_users becomes a READ-ONLY VIEW over identity_users x
// organization_memberships so every Phase 01 caller keeps working while there is
// exactly one writer. See packet 02.32 legacy-authority-cutover.md.

export const migration = {
  id: '006_identity_authority',
  owner: 'platform.identity',
  version: '2.0.0',
  dependsOn: ['005_platform_kernel_control_plane'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext auth-hardening/sso-engine (project-owned) + Odoo auth_* clean-room + RuoYi system login-log reference',

  up(dialect) {
    const now = new Date().toISOString();

    dialect.exec(`
      CREATE TABLE IF NOT EXISTS identity_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        login TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        locale TEXT NOT NULL DEFAULT 'ar',
        is_owner INTEGER NOT NULL DEFAULT 0,
        mfa_required INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_identity_users_login ON identity_users(tenant_id, login);
      CREATE INDEX IF NOT EXISTS idx_identity_users_status ON identity_users(status);

      CREATE TABLE IF NOT EXISTS identity_credentials (
        user_id TEXT PRIMARY KEY REFERENCES identity_users(id) ON DELETE CASCADE,
        algorithm TEXT NOT NULL DEFAULT 'scrypt',
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        must_change INTEGER NOT NULL DEFAULT 0,
        changed_at TEXT NOT NULL,
        changed_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_password_policy (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        min_length INTEGER NOT NULL DEFAULT 10,
        max_length INTEGER NOT NULL DEFAULT 128,
        require_upper INTEGER NOT NULL DEFAULT 1,
        require_lower INTEGER NOT NULL DEFAULT 1,
        require_digit INTEGER NOT NULL DEFAULT 1,
        require_symbol INTEGER NOT NULL DEFAULT 1,
        min_char_classes INTEGER NOT NULL DEFAULT 3,
        max_failed_attempts INTEGER NOT NULL DEFAULT 5,
        lockout_seconds INTEGER NOT NULL DEFAULT 900,
        reset_ttl_seconds INTEGER NOT NULL DEFAULT 3600,
        session_idle_seconds INTEGER NOT NULL DEFAULT 3600,
        session_absolute_seconds INTEGER NOT NULL DEFAULT 43200,
        max_concurrent_sessions INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        active_company_id TEXT,
        active_branch_id TEXT,
        actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','impersonated')),
        impersonator_id TEXT,
        mfa_satisfied INTEGER NOT NULL DEFAULT 0,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        idle_expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_reason TEXT,
        user_agent TEXT,
        ip TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON identity_sessions(user_id, revoked_at);

      CREATE TABLE IF NOT EXISTS identity_session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT NOT NULL,
        event TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        detail TEXT,
        ip TEXT,
        user_agent TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_session_events_user ON identity_session_events(user_id, occurred_at);

      CREATE TABLE IF NOT EXISTS identity_login_attempts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        login TEXT NOT NULL,
        succeeded INTEGER NOT NULL,
        reason_code TEXT,
        occurred_at TEXT NOT NULL,
        ip TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_login_attempts ON identity_login_attempts(tenant_id, login, occurred_at);

      CREATE TABLE IF NOT EXISTS identity_password_resets (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        requested_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_mfa_methods (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        method TEXT NOT NULL CHECK (method IN ('totp','recovery_code')),
        secret TEXT,
        confirmed INTEGER NOT NULL DEFAULT 0,
        consumed_at TEXT,
        last_counter INTEGER,
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_mfa_user ON identity_mfa_methods(user_id, method);

      CREATE TABLE IF NOT EXISTS identity_service_accounts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        company_id TEXT,
        name TEXT NOT NULL,
        purpose TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_api_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        service_account_id TEXT NOT NULL REFERENCES identity_service_accounts(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        company_id TEXT,
        label TEXT,
        scopes TEXT NOT NULL DEFAULT '[]',
        ip_allowlist TEXT NOT NULL DEFAULT '[]',
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 120,
        created_at TEXT NOT NULL,
        created_by TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        rotated_from TEXT,
        last_used_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_api_keys_account ON identity_api_keys(service_account_id);

      CREATE TABLE IF NOT EXISTS identity_api_key_usage (
        id TEXT PRIMARY KEY,
        api_key_id TEXT NOT NULL,
        window_start TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_api_key_window ON identity_api_key_usage(api_key_id, window_start);

      CREATE TABLE IF NOT EXISTS identity_sso_providers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        kind TEXT NOT NULL CHECK (kind IN ('oidc','oauth2','saml')),
        name TEXT NOT NULL,
        issuer TEXT,
        client_id TEXT,
        client_secret_ref TEXT,
        authorize_url TEXT,
        token_url TEXT,
        jwks_url TEXT,
        email_domains TEXT NOT NULL DEFAULT '[]',
        jit_provisioning INTEGER NOT NULL DEFAULT 0,
        jit_role_template TEXT,
        require_verified_email INTEGER NOT NULL DEFAULT 1,
        allow_account_link INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled','disabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_sso_logins (
        state TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES identity_sso_providers(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        code_verifier TEXT,
        code_challenge TEXT,
        redirect_uri TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS identity_federated_links (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES identity_sso_providers(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_federated ON identity_federated_links(provider_id, subject);

      CREATE TABLE IF NOT EXISTS identity_impersonations (
        id TEXT PRIMARY KEY,
        impersonator_id TEXT NOT NULL REFERENCES identity_users(id),
        target_user_id TEXT NOT NULL REFERENCES identity_users(id),
        session_id TEXT,
        reason TEXT NOT NULL,
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ended_at TEXT
      ) STRICT;
    `);

    dialect.prepare(`INSERT INTO identity_password_policy (id, updated_at) VALUES (1, ?)
      ON CONFLICT(id) DO NOTHING`).run(now);

    // ---- Organization membership authority (packet 02.01) -------------------
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS organization_departments (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        parent_id TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS organization_operating_scopes (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        kind TEXT NOT NULL CHECK (kind IN ('warehouse','project','team','site')),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES identity_users(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES platform_tenants(id),
        company_id TEXT NOT NULL REFERENCES platform_companies(id),
        branch_id TEXT REFERENCES platform_branches(id),
        department_id TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
        valid_from TEXT,
        valid_to TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_membership ON organization_memberships(user_id, company_id, COALESCE(branch_id,''));
      CREATE INDEX IF NOT EXISTS idx_membership_user ON organization_memberships(user_id, status);

      CREATE TABLE IF NOT EXISTS organization_scope_assignments (
        id TEXT PRIMARY KEY,
        membership_id TEXT NOT NULL REFERENCES organization_memberships(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL REFERENCES organization_operating_scopes(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_scope_assignment ON organization_scope_assignments(membership_id, scope_id);
    `);

    // ---- Migrate Phase 01 platform_users rows into the canonical authority ---
    const legacy = dialect.prepare('SELECT id, company_id, branch_id, name, email, status, roles, created_at FROM platform_users').all();
    const insertUser = dialect.prepare(`
      INSERT INTO identity_users (id, tenant_id, login, name, email, actor_type, status, locale, is_owner, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'user', ?, 'ar', ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const insertMembership = dialect.prepare(`
      INSERT INTO organization_memberships (id, user_id, tenant_id, company_id, branch_id, is_default, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, 1, 'active', ?, 'migration:006')
      ON CONFLICT DO NOTHING
    `);
    for (const row of legacy) {
      const tenantRow = dialect.prepare('SELECT tenant_id FROM platform_companies WHERE id = ?').get(row.company_id);
      const tenantId = tenantRow?.tenant_id || 'default';
      insertUser.run(row.id, tenantId, row.id, row.name, row.email || null, row.status, row.id === 'system' ? 1 : 0, row.created_at, now);
      insertMembership.run(`mem_${row.id}_${row.company_id}`, row.id, tenantId, row.company_id, row.branch_id || null, row.created_at);
    }

    // ---- platform_users becomes a derived read-only view --------------------
    // Roles are derived from authorization_role_assignments once migration 008
    // exists; until then the view exposes an empty role array so nothing
    // silently escalates. Migration 008 replaces this view with the role-aware
    // definition. Exactly one writer at every point in time.
    dialect.exec(`
      DROP TABLE IF EXISTS platform_users;
      CREATE VIEW platform_users AS
        SELECT
          u.id            AS id,
          m.company_id    AS company_id,
          m.branch_id     AS branch_id,
          u.name          AS name,
          u.email         AS email,
          u.status        AS status,
          '[]'            AS roles,
          u.created_at    AS created_at
        FROM identity_users u
        JOIN organization_memberships m ON m.user_id = u.id AND m.status = 'active';
    `);
  },

  down(dialect) {
    const now = new Date().toISOString();
    // Restore the Phase 01 platform_users table from the canonical authority.
    dialect.exec(`DROP VIEW IF EXISTS platform_users;`);
    dialect.exec(`
      CREATE TABLE platform_users (
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
    `);
    const rows = dialect.prepare(`
      SELECT u.id, m.company_id, m.branch_id, u.name, u.email, u.status, u.created_at
      FROM identity_users u JOIN organization_memberships m ON m.user_id = u.id AND m.is_default = 1
    `).all();
    const ins = dialect.prepare('INSERT INTO platform_users (id, company_id, branch_id, name, email, status, roles, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING');
    for (const r of rows) ins.run(r.id, r.company_id, r.branch_id, r.name, r.email, r.status, '[]', r.created_at || now);

    dialect.exec(`
      DROP TABLE IF EXISTS organization_scope_assignments;
      DROP TABLE IF EXISTS organization_memberships;
      DROP TABLE IF EXISTS organization_operating_scopes;
      DROP TABLE IF EXISTS organization_departments;
      DROP TABLE IF EXISTS identity_impersonations;
      DROP TABLE IF EXISTS identity_federated_links;
      DROP TABLE IF EXISTS identity_sso_logins;
      DROP TABLE IF EXISTS identity_sso_providers;
      DROP TABLE IF EXISTS identity_api_key_usage;
      DROP TABLE IF EXISTS identity_api_keys;
      DROP TABLE IF EXISTS identity_service_accounts;
      DROP TABLE IF EXISTS identity_mfa_methods;
      DROP TABLE IF EXISTS identity_password_resets;
      DROP TABLE IF EXISTS identity_login_attempts;
      DROP TABLE IF EXISTS identity_session_events;
      DROP TABLE IF EXISTS identity_sessions;
      DROP TABLE IF EXISTS identity_password_policy;
      DROP TABLE IF EXISTS identity_credentials;
      DROP TABLE IF EXISTS identity_users;
    `);
  }
};
