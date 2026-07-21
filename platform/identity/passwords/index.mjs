// Password policy, hashing, and reset tokens — Phase 02 packet 02.03.
//
// Source composition:
// - VNext vnext/server/auth/auth-hardening.js (project-owned, MERGE-REFACTOR):
//   DEFAULT_PASSWORD_POLICY, checkPasswordPolicy character-class logic, clampInt/
//   boolInt normalization, Arabic error strings. Hardened here with scrypt
//   hashing, timing-safe compare, and single-use expiring reset tokens which the
//   VNext original did not have.
// - Odoo addons/auth_password_policy (clean-room behavior): minimum-length and
//   strength-estimate policy as a configurable record.
//
// Invariants (§ 8, § 10):
//   - a raw password never reaches a log, an audit row, or a response body
//   - reset tokens are stored hashed, expire, and are single-use
//   - policy violations are returned as reason lists, never as silent truncation

'use strict';

import crypto from 'node:crypto';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class PasswordError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PasswordError';
    this.code = code;
    this.details = details;
  }
}

export const DEFAULT_PASSWORD_POLICY = Object.freeze({
  min_length: 10,
  max_length: 128,
  require_upper: 1,
  require_lower: 1,
  require_digit: 1,
  require_symbol: 1,
  min_char_classes: 3,
  max_failed_attempts: 5,
  lockout_seconds: 900,
  reset_ttl_seconds: 3600,
  session_idle_seconds: 3600,
  session_absolute_seconds: 43200,
  max_concurrent_sessions: 0,
});

function clampInt(value, fallback, min, max) {
  const n = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : Number(fallback);
  return Math.max(min, Math.min(max, n));
}

function boolInt(value, fallback) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

export function loadPasswordPolicy(dialect) {
  const row = dialect.prepare('SELECT * FROM identity_password_policy WHERE id = 1').get();
  return row ? { ...DEFAULT_PASSWORD_POLICY, ...row } : { ...DEFAULT_PASSWORD_POLICY };
}

export function savePasswordPolicy(dialect, patch = {}) {
  const current = loadPasswordPolicy(dialect);
  const next = {
    min_length: clampInt(patch.min_length, current.min_length, 4, 256),
    max_length: clampInt(patch.max_length, current.max_length, 8, 512),
    require_upper: boolInt(patch.require_upper, current.require_upper),
    require_lower: boolInt(patch.require_lower, current.require_lower),
    require_digit: boolInt(patch.require_digit, current.require_digit),
    require_symbol: boolInt(patch.require_symbol, current.require_symbol),
    min_char_classes: clampInt(patch.min_char_classes, current.min_char_classes, 1, 4),
    max_failed_attempts: clampInt(patch.max_failed_attempts, current.max_failed_attempts, 1, 100),
    lockout_seconds: clampInt(patch.lockout_seconds, current.lockout_seconds, 30, 86400),
    reset_ttl_seconds: clampInt(patch.reset_ttl_seconds, current.reset_ttl_seconds, 60, 86400),
    session_idle_seconds: clampInt(patch.session_idle_seconds, current.session_idle_seconds, 60, 86400),
    session_absolute_seconds: clampInt(patch.session_absolute_seconds, current.session_absolute_seconds, 300, 2592000),
    max_concurrent_sessions: clampInt(patch.max_concurrent_sessions, current.max_concurrent_sessions, 0, 100),
  };
  dialect.prepare(`
    UPDATE identity_password_policy SET
      min_length=?, max_length=?, require_upper=?, require_lower=?, require_digit=?, require_symbol=?,
      min_char_classes=?, max_failed_attempts=?, lockout_seconds=?, reset_ttl_seconds=?,
      session_idle_seconds=?, session_absolute_seconds=?, max_concurrent_sessions=?, updated_at=?
    WHERE id = 1
  `).run(
    next.min_length, next.max_length, next.require_upper, next.require_lower, next.require_digit,
    next.require_symbol, next.min_char_classes, next.max_failed_attempts, next.lockout_seconds,
    next.reset_ttl_seconds, next.session_idle_seconds, next.session_absolute_seconds,
    next.max_concurrent_sessions, new Date().toISOString()
  );
  return loadPasswordPolicy(dialect);
}

/**
 * Validate a candidate password. Never logs, never echoes the password.
 * @returns {{ok: boolean, errors: string[], codes: string[]}}
 */
export function checkPasswordPolicy(password, policy) {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...(policy || {}) };
  const pw = String(password ?? '');
  const errors = [];
  const codes = [];
  if (pw.length < p.min_length) { errors.push(`كلمة المرور قصيرة جداً (الحد الأدنى ${p.min_length} حرفاً)`); codes.push('PASSWORD_TOO_SHORT'); }
  if (pw.length > p.max_length) { errors.push(`كلمة المرور طويلة جداً (الحد الأقصى ${p.max_length} حرفاً)`); codes.push('PASSWORD_TOO_LONG'); }
  const classes = {
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  if (Number(p.require_upper) && !classes.upper) { errors.push('يجب أن تحتوي على حرف كبير واحد على الأقل'); codes.push('PASSWORD_NEEDS_UPPER'); }
  if (Number(p.require_lower) && !classes.lower) { errors.push('يجب أن تحتوي على حرف صغير واحد على الأقل'); codes.push('PASSWORD_NEEDS_LOWER'); }
  if (Number(p.require_digit) && !classes.digit) { errors.push('يجب أن تحتوي على رقم واحد على الأقل'); codes.push('PASSWORD_NEEDS_DIGIT'); }
  if (Number(p.require_symbol) && !classes.symbol) { errors.push('يجب أن تحتوي على رمز خاص واحد على الأقل'); codes.push('PASSWORD_NEEDS_SYMBOL'); }
  const classCount = Object.values(classes).filter(Boolean).length;
  if (classCount < Number(p.min_char_classes)) {
    errors.push(`يجب استخدام ${p.min_char_classes} أنواع مختلفة على الأقل من الأحرف`);
    codes.push('PASSWORD_NEEDS_CLASSES');
  }
  return { ok: errors.length === 0, errors, codes };
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return { algorithm: 'scrypt', salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  let actual;
  try {
    actual = crypto.scryptSync(String(password), String(salt), SCRYPT_KEYLEN, SCRYPT_PARAMS);
  } catch {
    return false;
  }
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// Legacy Octagon password migration (packet 02.04 runtime cutover). Existing
// users were stored with SHA256(password + salt). This verifier accepts one
// successful legacy login and immediately re-hashes the password to scrypt so
// the legacy format has the shortest possible lifetime.
function hashLegacySha256(password, salt) {
  return crypto.createHash('sha256').update(String(password || '') + String(salt || '')).digest('hex');
}

function verifyLegacySha256(password, salt, expectedHash) {
  const actual = hashLegacySha256(password, salt);
  const expected = Buffer.from(String(expectedHash), 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  if (actualBytes.length !== expected.length) return false;
  return crypto.timingSafeEqual(actualBytes, expected);
}

export function setPassword(dialect, userId, password, { actor = 'system', enforcePolicy = true, mustChange = false } = {}) {
  if (enforcePolicy) {
    const result = checkPasswordPolicy(password, loadPasswordPolicy(dialect));
    if (!result.ok) throw new PasswordError('password does not satisfy policy', 'PASSWORD_POLICY_VIOLATION', { errors: result.errors, codes: result.codes });
  }
  const { algorithm, salt, hash } = hashPassword(password);
  dialect.prepare(`
    INSERT INTO identity_credentials (user_id, algorithm, salt, hash, must_change, changed_at, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET algorithm=excluded.algorithm, salt=excluded.salt, hash=excluded.hash,
      must_change=excluded.must_change, changed_at=excluded.changed_at, changed_by=excluded.changed_by
  `).run(userId, algorithm, salt, hash, mustChange ? 1 : 0, new Date().toISOString(), actor);
  return { userId, mustChange };
}

export function checkCredentials(dialect, userId, password) {
  const row = dialect.prepare('SELECT algorithm, salt, hash, must_change FROM identity_credentials WHERE user_id = ?').get(userId);
  if (!row) return { ok: false, reasonCode: 'NO_CREDENTIAL' };
  let ok = false;
  if (row.algorithm === 'legacy_sha256') {
    ok = verifyLegacySha256(password, row.salt, row.hash);
    if (ok) {
      // Upgrade to scrypt on first successful verification. The legacy hash is
      // removed from the row and never stored again.
      const { salt, hash } = hashPassword(password);
      dialect.prepare(`
        UPDATE identity_credentials SET algorithm = ?, salt = ?, hash = ?, changed_at = ?, changed_by = ?
        WHERE user_id = ?
      `).run('scrypt', salt, hash, new Date().toISOString(), 'legacy_migration_upgrade', userId);
    }
  } else {
    ok = verifyPassword(password, row.salt, row.hash);
  }
  return { ok, reasonCode: ok ? null : 'BAD_PASSWORD', mustChange: row.must_change === 1 };
}

// --- Reset tokens ----------------------------------------------------------

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a single-use, expiring reset token. The raw token is returned exactly
 * once so a transport (mail channel) can deliver it; it is never persisted and
 * must never be logged.
 */
export function createPasswordReset(dialect, userId, { requestedBy = null, now = new Date() } = {}) {
  const policy = loadPasswordPolicy(dialect);
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + policy.reset_ttl_seconds * 1000).toISOString();
  const id = `pwr_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO identity_password_resets (id, token_hash, user_id, created_at, expires_at, requested_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, hashToken(raw), userId, now.toISOString(), expiresAt, requestedBy);
  return { id, token: raw, expiresAt };
}

export function consumePasswordReset(dialect, token, newPassword, { now = new Date() } = {}) {
  const row = dialect.prepare('SELECT * FROM identity_password_resets WHERE token_hash = ?').get(hashToken(token));
  if (!row) throw new PasswordError('reset token is not valid', 'RESET_TOKEN_INVALID');
  if (row.consumed_at) throw new PasswordError('reset token already used', 'RESET_TOKEN_CONSUMED');
  if (Date.parse(row.expires_at) <= now.getTime()) throw new PasswordError('reset token has expired', 'RESET_TOKEN_EXPIRED');
  setPassword(dialect, row.user_id, newPassword, { actor: `reset:${row.id}` });
  dialect.prepare('UPDATE identity_password_resets SET consumed_at = ? WHERE id = ?').run(now.toISOString(), row.id);
  return { userId: row.user_id };
}

export const _internal = { hashToken };
