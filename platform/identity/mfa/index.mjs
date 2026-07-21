// MFA (TOTP + recovery codes) and impersonation — Phase 02 packet 02.03.
//
// Source composition:
// - VNext vnext/server/auth/auth-hardening.js (project-owned, MERGE-REFACTOR):
//   base32Decode/base32Encode, generateHOTP, verifyTotp, createTotpEnrollment,
//   confirmTotpEnrollment, buildOtpAuthUri. Reused as-is in behavior; hardened
//   here with replay protection (last_counter) and single-use recovery codes,
//   which the VNext original explicitly lacked.
// - Odoo addons/auth_totp (clean-room): enrollment-then-confirm flow, per-user
//   secret, RFC 6238 30s period / 6 digits / SHA1.
//
// Stop condition honoured (§ 28): passkeys (WebAuthn) and SAML are NOT
// implemented. No source and no threat model for them is available locally, so
// implementing from memory is forbidden. See unresolved-risks.md.

'use strict';

import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;

export class MfaError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MfaError';
    this.code = code;
    this.details = details;
  }
}

function base32Decode(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += BASE32_ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
  const buf = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < buf.length; i++) buf[i] = parseInt(bits.substr(i * 8, 8), 2);
  return buf;
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.substr(i, 5), 2)];
  const rem = bits.length % 5;
  if (rem) out += BASE32_ALPHABET[parseInt(bits.slice(-rem).padEnd(5, '0'), 2)];
  return out;
}

export function generateHOTP(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) { counterBuffer[i] = Number(tmp & 0xffn); tmp >>= 8n; }
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

/** Returns the matching counter, or null. Counter is needed for replay defence. */
export function matchTotpCounter(secret, token, { window = 1, at = Date.now() } = {}) {
  const buf = base32Decode(secret);
  const base = Math.floor(at / (PERIOD_SECONDS * 1000));
  const clean = String(token || '').trim();
  if (!/^\d{6}$/.test(clean)) return null;
  for (let i = -window; i <= window; i++) {
    const candidate = base + i;
    const expected = generateHOTP(buf, candidate);
    // constant-time compare of the 6-digit strings
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return candidate;
  }
  return null;
}

export function generateTotpSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function buildOtpAuthUri(secret, accountLabel, issuer = 'Octagon ERP') {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret, issuer, digits: '6', period: String(PERIOD_SECONDS), algorithm: 'SHA1' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export class MfaAuthority {
  constructor(dialect, options = {}) {
    this.dialect = dialect;
    this.now = options.now || (() => new Date());
  }

  /**
   * Start (or restart) TOTP enrollment. The secret and otpauth URI are returned
   * exactly once for the enrollment response and must never be logged.
   */
  beginTotpEnrollment(userId, label = userId) {
    const secret = generateTotpSecret();
    const now = this.now().toISOString();
    this.dialect.prepare("DELETE FROM identity_mfa_methods WHERE user_id = ? AND method = 'totp' AND confirmed = 0").run(userId);
    const id = `mfa_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO identity_mfa_methods (id, user_id, method, secret, confirmed, created_at)
      VALUES (?, ?, 'totp', ?, 0, ?)
    `).run(id, userId, secret, now);
    return { id, secret, otpauthUri: buildOtpAuthUri(secret, label) };
  }

  confirmTotpEnrollment(userId, code) {
    const row = this.dialect.prepare("SELECT id, secret FROM identity_mfa_methods WHERE user_id = ? AND method = 'totp' AND confirmed = 0 ORDER BY created_at DESC").get(userId);
    if (!row) throw new MfaError('no pending TOTP enrollment', 'MFA_NO_ENROLLMENT');
    const counter = matchTotpCounter(row.secret, code, { at: this.now().getTime() });
    if (counter === null) return false;
    this.dialect.prepare("UPDATE identity_mfa_methods SET confirmed = 1, confirmed_at = ?, last_counter = ? WHERE id = ?")
      .run(this.now().toISOString(), counter, row.id);
    // A confirmed method supersedes any earlier one.
    this.dialect.prepare("DELETE FROM identity_mfa_methods WHERE user_id = ? AND method = 'totp' AND id <> ?").run(userId, row.id);
    return true;
  }

  hasConfirmedTotp(userId) {
    return !!this.dialect.prepare("SELECT 1 FROM identity_mfa_methods WHERE user_id = ? AND method = 'totp' AND confirmed = 1").get(userId);
  }

  /**
   * Verify a login-time TOTP challenge. Replay is rejected: a counter that is
   * <= the last accepted counter cannot be reused even inside the drift window.
   */
  verifyTotpChallenge(userId, code) {
    const row = this.dialect.prepare("SELECT id, secret, last_counter FROM identity_mfa_methods WHERE user_id = ? AND method = 'totp' AND confirmed = 1").get(userId);
    if (!row) throw new MfaError('no confirmed TOTP method', 'MFA_NOT_ENROLLED');
    const counter = matchTotpCounter(row.secret, code, { at: this.now().getTime() });
    if (counter === null) return { ok: false, reasonCode: 'MFA_BAD_CODE' };
    if (row.last_counter !== null && counter <= Number(row.last_counter)) {
      return { ok: false, reasonCode: 'MFA_CODE_REPLAYED' };
    }
    this.dialect.prepare('UPDATE identity_mfa_methods SET last_counter = ? WHERE id = ?').run(counter, row.id);
    return { ok: true };
  }

  /**
   * Issue recovery codes. Only hashes are stored; the plaintext list is returned
   * once for the user to record. Lost-device recovery path.
   */
  issueRecoveryCodes(userId, count = 8) {
    this.dialect.prepare("DELETE FROM identity_mfa_methods WHERE user_id = ? AND method = 'recovery_code'").run(userId);
    const now = this.now().toISOString();
    const codes = [];
    const ins = this.dialect.prepare(`
      INSERT INTO identity_mfa_methods (id, user_id, method, secret, confirmed, created_at) VALUES (?, ?, 'recovery_code', ?, 1, ?)
    `);
    for (let i = 0; i < count; i++) {
      const code = crypto.randomBytes(6).toString('hex');
      codes.push(code);
      ins.run(`mfa_${crypto.randomUUID()}`, userId, crypto.createHash('sha256').update(code).digest('hex'), now);
    }
    return codes;
  }

  /** Recovery codes are strictly single-use. */
  consumeRecoveryCode(userId, code) {
    const hash = crypto.createHash('sha256').update(String(code)).digest('hex');
    const row = this.dialect.prepare("SELECT id, consumed_at FROM identity_mfa_methods WHERE user_id = ? AND method = 'recovery_code' AND secret = ?").get(userId, hash);
    if (!row) return { ok: false, reasonCode: 'MFA_BAD_RECOVERY_CODE' };
    if (row.consumed_at) return { ok: false, reasonCode: 'MFA_RECOVERY_CODE_USED' };
    this.dialect.prepare('UPDATE identity_mfa_methods SET consumed_at = ? WHERE id = ?').run(this.now().toISOString(), row.id);
    return { ok: true };
  }

  remainingRecoveryCodes(userId) {
    const row = this.dialect.prepare("SELECT COUNT(*) AS n FROM identity_mfa_methods WHERE user_id = ? AND method = 'recovery_code' AND consumed_at IS NULL").get(userId);
    return Number(row?.n || 0);
  }

  removeAll(userId) {
    this.dialect.prepare('DELETE FROM identity_mfa_methods WHERE user_id = ?').run(userId);
  }
}

export function createMfaAuthority(dialect, options) { return new MfaAuthority(dialect, options); }
export const _internal = { base32Decode, base32Encode };
