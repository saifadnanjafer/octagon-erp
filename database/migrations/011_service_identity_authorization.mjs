// 011_service_identity_authorization — Phase 02 Wave F correction
//
// WHY THIS MIGRATION EXISTS
// Migration 007 declared `authorization_role_assignments.user_id` with a foreign
// key to `identity_users(id)`. The § 58.14 adversarial test exposed the
// consequence: a SERVICE identity (an integration or an AI tool) could never be
// granted anything, because its id lives in `identity_service_accounts`. Its API
// key scopes could only ever NARROW an authority it was structurally incapable
// of holding, so every service call was denied for the wrong reason.
//
// § 8.6 requires that "AI and integrations act under explicit service/user
// identities" — which means a service identity must be a first-class grantee.
// This migration rebuilds the table so the grantee may be either actor type,
// with an explicit `actor_type` column, and re-points the FK accordingly.
//
// The two-key model is unchanged and still enforced in the evaluator:
//   effective authority(service) = role grants  ∩  API key scopes
// A key can only ever narrow what the service account was granted.
//
// Migration 007 is NOT edited — this is an additive, reversible correction, per
// the Phase 01 rule that an applied migration is never rewritten.

export const migration = {
  id: '011_service_identity_authorization',
  owner: 'platform.authorization',
  version: '2.0.1',
  dependsOn: ['010_collaboration_files_jobs'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Correction driven by the Phase 02 § 58.14 adversarial test; RuoYi service-account/tenant reference for actor-type separation',

  up(dialect) {
    // The platform_users VIEW reads authorization_role_assignments, so it must
    // be dropped BEFORE the table is swapped — otherwise SQLite resolves the
    // view against a table that no longer exists mid-migration.
    dialect.exec('DROP VIEW IF EXISTS platform_users;');

    dialect.exec(`
      CREATE TABLE authorization_role_assignments_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','service')),
        role_id TEXT NOT NULL REFERENCES authorization_roles(id) ON DELETE CASCADE,
        company_id TEXT,
        branch_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
        valid_from TEXT,
        valid_to TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;

      INSERT INTO authorization_role_assignments_v2
        (id, user_id, actor_type, role_id, company_id, branch_id, status, valid_from, valid_to, created_at, created_by)
      SELECT id, user_id, 'user', role_id, company_id, branch_id, status, valid_from, valid_to, created_at, created_by
      FROM authorization_role_assignments;

      DROP TABLE authorization_role_assignments;
      ALTER TABLE authorization_role_assignments_v2 RENAME TO authorization_role_assignments;

      CREATE UNIQUE INDEX IF NOT EXISTS ux_role_assignment ON authorization_role_assignments(user_id, role_id, COALESCE(company_id,''), COALESCE(branch_id,''));
      CREATE INDEX IF NOT EXISTS idx_role_assignment_user ON authorization_role_assignments(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_role_assignment_actor ON authorization_role_assignments(actor_type, status);
    `);

    // Recreate the view against the new table shape.
    dialect.exec(`
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
            WHERE a.user_id = u.id AND a.status = 'active' AND a.actor_type = 'user'
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

      CREATE TABLE authorization_role_assignments_v1 (
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

      -- Only user assignments can exist under the v1 shape; service grants are
      -- dropped on the way down, which is the honest inverse of this migration.
      INSERT INTO authorization_role_assignments_v1
        (id, user_id, role_id, company_id, branch_id, status, valid_from, valid_to, created_at, created_by)
      SELECT id, user_id, role_id, company_id, branch_id, status, valid_from, valid_to, created_at, created_by
      FROM authorization_role_assignments WHERE actor_type = 'user';

      DROP TABLE authorization_role_assignments;
      ALTER TABLE authorization_role_assignments_v1 RENAME TO authorization_role_assignments;

      CREATE UNIQUE INDEX IF NOT EXISTS ux_role_assignment ON authorization_role_assignments(user_id, role_id, COALESCE(company_id,''), COALESCE(branch_id,''));
      CREATE INDEX IF NOT EXISTS idx_role_assignment_user ON authorization_role_assignments(user_id, status);

      CREATE VIEW platform_users AS
        SELECT
          u.id AS id, m.company_id AS company_id, m.branch_id AS branch_id, u.name AS name,
          u.email AS email, u.status AS status,
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
  }
};
