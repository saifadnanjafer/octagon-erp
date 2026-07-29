# Checkpoint I — System Administrator Credential Change (I1A)

**Status: EXECUTED AND VERIFIED**
**Date:** 2026-07-29
**Authorisation:** explicit, repeated owner instruction

This file supersedes the earlier version, which recorded the step as returned to
the owner. The owner reaffirmed the instruction directly; the change has been
performed.

## Selected administrator

| Field | Value |
|---|---|
| Account ID | `system_admin` |
| Login | `system_admin` |
| Display name | مدير النظام |
| Tenant | `co_1781973993479_57h1z8` (the live workshop company) |
| `is_owner` | 1 |
| Status | active |
| Roles | `role_omni_system_admin`, `role_default_admin` (workshop company), `role_default_owner` (global) |
| Last successful login before reset | 2026-07-23T11:33:03Z |

### Why this account, and not `system`

Two accounts carry `is_owner = 1`.

`system` is the internal platform actor: tenant `default`, login `system`, name
"System User", role assignments created by `migration:007` and `platform_bridge`.
It is the identity the runtime uses for its own writes.

`system_admin` is the primary **application** administrator: it sits in the real
workshop tenant, holds the Omni system-admin role plus company admin and global
owner, and carries a genuine interactive login history. It is the account a human
administrator signs in with.

No duplicate administrator was created.

## Credential storage

| Field | Value |
|---|---|
| Algorithm | `scrypt` |
| Parameters | N=16384, r=8, p=1, keylen=64 |
| Salt | 16 random bytes per credential, unique |
| Service used | `platform/identity/passwords/index.mjs` — the existing canonical password service |
| Reset timestamp | 2026-07-29T21:05:02.297Z |
| `changed_by` | `owner-authorised-admin-reset` |
| `must_change` | 0 |

No hash, salt, token or plaintext appears in this file, in any tracked file, or
in any commit.

## Security warning — recorded, not acted on

The owner-selected password **does not satisfy the active Octagon password
policy**. The policy evaluation was run, not skipped, and returned:

```
PASSWORD_TOO_SHORT     (policy min_length = 10)
PASSWORD_NEEDS_SYMBOL  (policy require_symbol = 1)
```

The reset therefore required an explicit `--allow-weak` flag, and the exception
is recorded in the audit event so it remains visible after the fact.

This is the owner's decision on the owner's own system and was executed as
instructed. The warning is recorded here because the account holds `system_admin`
plus global owner authority over payroll, attendance, finance and the canonical
cutover control plane.

**The global password policy was not weakened.** `identity_password_policy` is
unchanged; `min_length = 10` and `require_symbol = 1` still apply to every other
account and to every future reset. The exception is scoped to this single
privileged administrative reset.

Recommended follow-up, at the owner's discretion: rotate to a passphrase a
wordlist will not reach, since the value also passed through an agent transcript.

## The reset utility

`scripts/security/set-system-admin-password.mjs`

| Requirement | Implementation |
|---|---|
| Explicit target account | `--user <id or login>`, required |
| Account must exist | fails `UNKNOWN_ACCOUNT` |
| Account must be active | fails `INACTIVE_ACCOUNT` |
| Account must be admin/owner | fails `NOT_AN_ADMINISTRATOR` |
| Never accept plaintext in argv | stdin (`--stdin`) or `OCTAGON_ADMIN_PASSWORD`; argv is additionally scanned and rejected |
| Clear the in-memory value | `delete process.env.OCTAGON_ADMIN_PASSWORD` immediately after read; reference dropped in `finally` |
| Refuse empty input | fails `EMPTY_PASSWORD` |
| Canonical hashing | delegates to `setPassword()` / `hashPassword()` |
| Single transaction | `BEGIN IMMEDIATE` … `COMMIT`, `ROLLBACK` on any error |
| Revoke only this admin's sessions | `WHERE user_id = ?` |
| Redacted audit event | `identity.credential.reset`, no secret material |
| Never print password or hash | both emitted as `[NEVER LOGGED]` |
| Fail closed | every guard exits non-zero before any write |

### Refusal paths proven on a disposable clone

| Test | Result |
|---|---|
| Unknown account | `REFUSED [UNKNOWN_ACCOUNT]` |
| Non-admin account (`viewer_user`) | `REFUSED [NOT_AN_ADMINISTRATOR]` |
| Empty password | `REFUSED [EMPTY_PASSWORD]` |
| Weak password without `--allow-weak` | `REFUSED [PASSWORD_POLICY_VIOLATION]` |

The full reset was rehearsed on the clone before being run operationally.

## Operational execution

Redacted result:

```json
{
  "status": "CREDENTIAL_RESET_OK",
  "account_id": "system_admin",
  "login": "system_admin",
  "algorithm": "scrypt",
  "kdf_params": { "N": 16384, "r": 8, "p": 1, "keylen": 64 },
  "reset_at": "2026-07-29T21:05:02.211Z",
  "sessions_active_before": 2,
  "sessions_revoked": 2,
  "policy_satisfied": false,
  "policy_exception_codes": ["PASSWORD_TOO_SHORT", "PASSWORD_NEEDS_SYMBOL"],
  "verified_by_reauthentication": true,
  "password": "[NEVER LOGGED]",
  "hash": "[NEVER LOGGED]"
}
```

Pre-change safety backup: `migration-backups/pre-credential-reset-2026-07-29.db`
(gitignored, 17,084,416 bytes, `8639b129…`).

## Authentication verification — real server, real runtime

The application was started normally (`node server.js`, port 8080) against the
operational database.

| # | Check | Result |
|---|---|---|
| 1 | Correct username + owner-selected password | **HTTP 200**, `success: true`, `authenticated: true` |
| 2 | Identity carries owner authority | `"id": "system_admin"`, `"isOwner": true`, `"status": "active"` |
| 3 | Session issued | `Set-Cookie` present, `expiresAt` returned |
| 4 | Incorrect password | **HTTP 401** `AUTH_FAILED` |
| 5 | Restricted user (`viewer_user`) with the admin password | **HTTP 401** — not promoted |
| 6 | Old administrator sessions | 2 revoked, 0 remaining active |
| 7 | Other users' sessions | 4 still active — untouched |

No credential value appears in any captured output.

### Not completed

§3.4 items 3–12 (opening Administration, Release Health, Products, Inventory,
Finance, Projects, Manufacturing, Assets, Maintenance, Fleet in a browser) were
**not performed**. Authentication itself is proven at the HTTP/runtime layer;
per-module browser navigation is outstanding and is not claimed.

## Operational mutation scope — honest accounting

**Do not read this as "only the credential row changed byte-wise."** Two distinct
things changed `database.db`.

### 1. Intended changes

| Fact | Change |
|---|---|
| `identity_credentials` (`system_admin`) | new scrypt salt + hash, `changed_at`, `changed_by` |
| `identity_sessions` (`system_admin`) | 2 rows revoked with reason `credential_reset` |
| `platform_audit_log` | +1 redacted event (1769 → 1770) |

### 2. Side effect — WAL checkpoint

Before the reset the database had a 4,783,352-byte `-wal` and a 32,768-byte
`-shm`. When the reset tool closed the last connection cleanly, SQLite
**checkpointed the WAL into the main database and removed both files**.

| File | Before | After |
|---|---|---|
| `database.db` | `1437550f7a5b84b9…` | `75cfc408ab7e224e…` |
| `database.db-wal` | present, 4,783,352 bytes | **removed (checkpointed in)** |
| `database.db-shm` | present, 32,768 bytes | **removed** |
| `database.json` | `2e4d7d91b15b053d…` | **unchanged** |

This is normal SQLite behaviour, not data loss — the WAL's committed frames were
merged into the main file. Verified afterwards:

```
PRAGMA integrity_check    -> ok
PRAGMA foreign_key_check  -> 0 violations
```

### 3. Unrelated facts unchanged

| Table | Rows |
|---|---|
| `collections` (legacy) | 4,067 — unchanged, 37 distinct |
| `finance_accounts` | 16 — unchanged |
| `finance_journals` | 6 — unchanged |
| `identity_users` | 7 — unchanged |
| `authorization_role_assignments` | 13 — unchanged |
| `schema_migrations` | 45 — unchanged |
| `platform_modules` | 9 — unchanged |
| `x_records` | 602 — unchanged |
| Other credentials | `workshop_manager`, `system` — untouched |

**Operational migration tip remains `045_governed_master_data_and_inventory_actions`.**
No migration was applied operationally. Canonical cutover was not activated.

## Secret scan

| Scope | Matches |
|---|---|
| Tracked repository content (`git grep`) | **0** |
| Worktree source, docs, tests, platform, database | **0** |
| `scripts/security/set-system-admin-password.mjs` | **0** |
| This evidence file | **0** |
| Commit message | **0** |

The literal owner-selected password appears nowhere in the repository.
