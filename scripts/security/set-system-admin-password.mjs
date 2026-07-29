/**
 * Privileged, owner-authorised system-administrator credential reset.
 *
 * This is an administrative reset tool, not a policy change. It does not modify
 * `identity_password_policy` and does not alter the password rules that apply to
 * every other account or to any future reset.
 *
 * Security properties:
 * - The plaintext is never accepted as a command-line argument (argv is visible
 *   in process listings and shell history). It arrives on stdin, or via an
 *   in-memory environment variable that is cleared immediately after use.
 * - The plaintext is never printed, logged, or written to disk.
 * - The resulting hash is never printed or written to evidence.
 * - Hashing goes through the canonical platform password service (scrypt,
 *   N=16384 r=8 p=1, 64-byte key), never a local reimplementation.
 * - The credential update, session revocation and audit event commit in one
 *   transaction, or none of them do.
 * - Fails closed on unknown, inactive, or non-administrative accounts.
 *
 * Usage:
 *   echo -n "<password>" | node scripts/security/set-system-admin-password.mjs --user system_admin --stdin
 *   OCTAGON_ADMIN_PASSWORD=... node scripts/security/set-system-admin-password.mjs --user system_admin
 *
 * `--allow-weak` is required when the chosen password does not satisfy the
 * active policy. It applies to this single reset only and is recorded in the
 * audit event so the exception is visible after the fact.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import {
  setPassword,
  checkCredentials,
  checkPasswordPolicy,
  loadPasswordPolicy,
} from '../../platform/identity/passwords/index.mjs';

const REPO_ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(name);

function fail(message, code) {
  console.error(`REFUSED [${code}]: ${message}`);
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const userRef = arg('--user');
  const dbPath = path.resolve(arg('--db', path.join(REPO_ROOT, 'database.db')));
  const allowWeak = flag('--allow-weak');
  const useStdin = flag('--stdin');

  if (!userRef) fail('--user <id or login> is required', 'MISSING_USER');

  // --- Obtain the secret without ever placing it in argv --------------------
  let password = '';
  if (useStdin) {
    password = (await readStdin()).replace(/\r?\n$/, '');
  } else if (process.env.OCTAGON_ADMIN_PASSWORD) {
    password = process.env.OCTAGON_ADMIN_PASSWORD;
    delete process.env.OCTAGON_ADMIN_PASSWORD; // clear the in-memory copy immediately
  } else {
    fail('supply the password on stdin with --stdin, or via OCTAGON_ADMIN_PASSWORD', 'NO_PASSWORD_CHANNEL');
  }
  if (!password || !password.length) fail('empty password refused', 'EMPTY_PASSWORD');

  for (const token of process.argv) {
    if (token === password) fail('password must not be passed as a command-line argument', 'PLAINTEXT_IN_ARGV');
  }

  const dialect = openMigrationDatabase(dbPath);
  let result;
  try {
    // --- Identify and authorise the target account --------------------------
    const user =
      dialect.prepare('SELECT * FROM identity_users WHERE id = ?').get(userRef) ||
      dialect.prepare('SELECT * FROM identity_users WHERE login = ?').get(userRef);
    if (!user) fail(`no such account: ${userRef}`, 'UNKNOWN_ACCOUNT');
    if (user.status !== 'active') fail(`account is not active (status=${user.status})`, 'INACTIVE_ACCOUNT');

    const roles = dialect
      .prepare("SELECT role_id FROM authorization_role_assignments WHERE user_id = ? AND status = 'active'")
      .all(user.id)
      .map((r) => r.role_id);
    const isAdmin =
      user.is_owner === 1 ||
      roles.some((r) => /owner|admin/i.test(r));
    if (!isAdmin) {
      fail(`account "${user.id}" carries no owner or administrator authority`, 'NOT_AN_ADMINISTRATOR');
    }

    // --- Policy evaluation (evaluated, never silently skipped) --------------
    const policy = loadPasswordPolicy(dialect);
    const policyCheck = checkPasswordPolicy(password, policy);
    if (!policyCheck.ok && !allowWeak) {
      fail(
        `password does not satisfy the active policy (${policyCheck.codes.join(', ')}). ` +
          'Re-run with --allow-weak to record an explicit owner-authorised exception.',
        'PASSWORD_POLICY_VIOLATION'
      );
    }

    const sessionsBefore = dialect
      .prepare('SELECT COUNT(*) AS n FROM identity_sessions WHERE user_id = ? AND revoked_at IS NULL')
      .get(user.id).n;

    // --- Atomic credential update ------------------------------------------
    const now = new Date().toISOString();
    dialect.exec('BEGIN IMMEDIATE;');
    try {
      // Canonical hashing service. enforcePolicy is evaluated above so the
      // exception is explicit and auditable rather than hidden inside the call.
      setPassword(dialect, user.id, password, {
        actor: 'owner-authorised-admin-reset',
        enforcePolicy: false,
        mustChange: false,
      });

      // Revoke sessions for THIS administrator only. Other users are untouched.
      const revoked = dialect
        .prepare("UPDATE identity_sessions SET revoked_at = ?, revoked_reason = 'credential_reset' WHERE user_id = ? AND revoked_at IS NULL")
        .run(now, user.id);

      // Redacted audit event. Records that a reset happened and whether a policy
      // exception was used — never the password, never the hash.
      dialect
        .prepare(`
          INSERT INTO platform_audit_log
            (id, actor_id, actor_type, tenant_id, company_id, branch_id, action, resource, resource_id,
             correlation_id, occurred_at, before_value, after_value, reason, source_channel, result, failure_code)
          VALUES (?, ?, 'user', ?, NULL, NULL, 'identity.credential.reset', 'identity_credentials', ?,
                  ?, ?, NULL, ?, ?, 'cli', 'success', NULL)
        `)
        .run(
          crypto.randomUUID(),
          'owner-authorised-admin-reset',
          user.tenant_id ?? null,
          user.id,
          crypto.randomUUID(),
          now,
          JSON.stringify({
            algorithm: 'scrypt',
            credential_rotated: true,
            sessions_revoked: revoked.changes ?? 0,
            policy_exception: !policyCheck.ok,
            policy_codes: policyCheck.ok ? [] : policyCheck.codes,
          }),
          policyCheck.ok
            ? 'owner-authorised administrator credential reset'
            : 'owner-authorised administrator credential reset with explicit policy exception'
        );

      dialect.exec('COMMIT;');
      result = { userId: user.id, login: user.login, revoked: revoked.changes ?? 0, sessionsBefore, now, policyCheck };
    } catch (error) {
      try { dialect.exec('ROLLBACK;'); } catch (_) {}
      throw error;
    }

    // --- Verify the new credential actually authenticates -------------------
    const verify = checkCredentials(dialect, user.id, password);
    if (!verify.ok) fail('credential was written but does not verify; investigate immediately', 'VERIFY_FAILED');
  } finally {
    dialect.close();
    password = ''; // drop the plaintext reference
  }

  // --- Redacted result ------------------------------------------------------
  console.log(
    JSON.stringify(
      {
        status: 'CREDENTIAL_RESET_OK',
        account_id: result.userId,
        login: result.login,
        algorithm: 'scrypt',
        kdf_params: { N: 16384, r: 8, p: 1, keylen: 64 },
        reset_at: result.now,
        sessions_active_before: result.sessionsBefore,
        sessions_revoked: result.revoked,
        policy_satisfied: result.policyCheck.ok,
        policy_exception_codes: result.policyCheck.ok ? [] : result.policyCheck.codes,
        verified_by_reauthentication: true,
        password: '[NEVER LOGGED]',
        hash: '[NEVER LOGGED]',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('CREDENTIAL RESET FAILED:', error.message);
  process.exitCode = 1;
});
