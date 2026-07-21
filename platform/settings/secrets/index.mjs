// Encrypted secret vault — Phase 02 packet 02.14.
//
// Source composition:
// - Octagon server-jarvis-security.js AI-key proxy (PRESERVE the rule: a secret
//   never reaches client JS and never appears in a response body).
// - VNext vnext/server/modules/governance/integration-engine.js encrypted
//   credentials (project-owned, MERGE-REFACTOR): the credential-by-reference
//   idea is kept; key versioning, AEAD, and rotation are added here.
// - RuoYi/NocoBase credential patterns (references, behavior only).
//
// Invariants (§ 10.4, § 10.5):
//   - ciphertext lives ONLY in secret_values; every other table stores `secret://ref`
//   - there is NO ordinary read endpoint: `reveal()` requires reveal_policy
//     'restricted' AND an explicit permission AND writes an audit event
//   - a missing/short key FAILS CLOSED — the vault never falls back to plaintext
//   - a backup of settings/config never carries plaintext (see exportSafe())

'use strict';

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

export class SecretError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SecretError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Resolve the master key. Production reads OCTAGON_SECRET_KEY (base64, 32 bytes).
 * Tests inject a key directly. There is deliberately no generated default: a
 * missing key must stop secret writes, not silently weaken them.
 */
export function resolveMasterKey(provided = null) {
  const raw = provided || process.env.OCTAGON_SECRET_KEY || null;
  if (!raw) throw new SecretError('no encryption key is configured', 'SECRET_KEY_UNAVAILABLE');
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'base64');
  if (buf.length !== KEY_BYTES) throw new SecretError(`encryption key must be ${KEY_BYTES} bytes`, 'SECRET_KEY_INVALID', { length: buf.length });
  return buf;
}

export class SecretVault {
  /**
   * @param {object} dialect
   * @param {{ key?: Buffer|string, keys?: Record<number, Buffer|string>, evaluator?: object }} options
   *   `keys` maps key_version -> key so an old ciphertext stays readable after rotation.
   */
  constructor(dialect, options = {}) {
    this.dialect = dialect;
    this.evaluator = options.evaluator || null;
    this.keys = new Map();
    if (options.keys) {
      for (const [version, key] of Object.entries(options.keys)) this.keys.set(Number(version), resolveMasterKey(key));
    }
    if (options.key) this.keys.set(this.keys.size ? Math.max(...this.keys.keys()) + 1 : 1, resolveMasterKey(options.key));
    if (!this.keys.size) {
      // Deferred resolution: throw at USE time, not construction time, so a
      // process without secrets configured can still boot read-only surfaces.
      this.keys = new Map();
    }
  }

  #currentVersion() {
    if (!this.keys.size) throw new SecretError('no encryption key is configured', 'SECRET_KEY_UNAVAILABLE');
    return Math.max(...this.keys.keys());
  }

  #key(version) {
    const key = this.keys.get(Number(version));
    if (!key) throw new SecretError(`no key available for version ${version}`, 'SECRET_KEY_VERSION_MISSING', { version });
    return key;
  }

  #now() { return new Date().toISOString(); }

  #event(ref, event, actorId, detail = null) {
    this.dialect.prepare(`
      INSERT INTO secret_events (id, ref, event, occurred_at, actor_id, detail) VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ref, event, this.#now(), actorId || 'system', detail ? JSON.stringify(detail) : null);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, 'user', ?, 'secret_references', ?, ?, 'secrets', 'success')
    `).run(crypto.randomUUID(), actorId || 'system', `secret.${event}`, ref, this.#now());
  }

  declare({ ref, moduleId, tenantId = null, companyId = null, label = null, requiredPermission = null, revealPolicy = 'never', rotationRequired = false }, actor = 'system') {
    if (!/^secret:\/\/[a-z0-9._-]+$/i.test(ref)) throw new SecretError('secret ref must look like secret://name', 'SECRET_REF_INVALID', { ref });
    this.dialect.prepare(`
      INSERT INTO secret_references (ref, module_id, tenant_id, company_id, label, required_permission, reveal_policy, rotation_required, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref) DO UPDATE SET module_id=excluded.module_id, label=excluded.label,
        required_permission=excluded.required_permission, reveal_policy=excluded.reveal_policy, rotation_required=excluded.rotation_required
    `).run(ref, moduleId, tenantId, companyId, label, requiredPermission, revealPolicy, rotationRequired ? 1 : 0, this.#now(), actor);
    this.#event(ref, 'declare', actor);
    return this.describe(ref);
  }

  /** Metadata only — this is what a settings/config UI is allowed to see. */
  describe(ref) {
    const r = this.dialect.prepare('SELECT * FROM secret_references WHERE ref = ?').get(ref);
    if (!r) return null;
    const current = this.dialect.prepare('SELECT key_version, created_at, rotated_at FROM secret_values WHERE ref = ? AND active = 1').get(ref);
    return {
      ref: r.ref, moduleId: r.module_id, tenantId: r.tenant_id, companyId: r.company_id,
      label: r.label, requiredPermission: r.required_permission, revealPolicy: r.reveal_policy,
      rotationRequired: r.rotation_required === 1,
      isSet: !!current,
      keyVersion: current?.key_version ?? null,
      lastRotatedAt: current?.rotated_at ?? null,
      // The masked display a configuration UI renders. Never the value.
      display: current ? '••••••••' : null,
    };
  }

  set(ref, plaintext, { actor = 'system', ctx = null } = {}) {
    const meta = this.dialect.prepare('SELECT required_permission FROM secret_references WHERE ref = ?').get(ref);
    if (!meta) throw new SecretError(`secret ${ref} is not declared`, 'SECRET_NOT_DECLARED', { ref });
    if (meta.required_permission && this.evaluator && ctx) {
      this.evaluator.require({ permission: meta.required_permission, ctx });
    }
    const version = this.#currentVersion();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.#key(version), iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('UPDATE secret_values SET active = 0 WHERE ref = ?').run(ref);
      this.dialect.prepare(`
        INSERT INTO secret_values (id, ref, key_version, algorithm, iv, auth_tag, ciphertext, active, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(`sec_${crypto.randomUUID()}`, ref, version, ALGORITHM, iv.toString('base64'), authTag.toString('base64'),
        ciphertext.toString('base64'), this.#now(), actor);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.#event(ref, 'set', actor, { keyVersion: version });
    return this.describe(ref);
  }

  /**
   * INTERNAL USE ONLY: decrypt for a server-side consumer (an integration
   * making an outbound call). Never returns to an HTTP response body.
   */
  use(ref, consumer) {
    if (typeof consumer !== 'function') throw new SecretError('use() requires a consumer function', 'SECRET_CONSUMER_REQUIRED');
    const row = this.dialect.prepare('SELECT * FROM secret_values WHERE ref = ? AND active = 1').get(ref);
    if (!row) throw new SecretError(`secret ${ref} has no value`, 'SECRET_NOT_SET', { ref });
    let plaintext;
    try {
      const decipher = crypto.createDecipheriv(row.algorithm, this.#key(row.key_version), Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
      plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      // Corrupted or tampered ciphertext must be a hard, visible failure —
      // never a silent empty credential that produces a confusing 401 upstream.
      this.#event(ref, 'decrypt_failed', 'system', { reason: e.code || 'AUTH_TAG_MISMATCH' });
      throw new SecretError(`secret ${ref} could not be decrypted`, 'SECRET_CORRUPT', { ref });
    }
    try {
      return consumer(plaintext);
    } finally {
      plaintext = null;
    }
  }

  /**
   * Restricted reveal. Requires reveal_policy='restricted', the declared
   * permission, and an explicit reason; always audited. Refuses outright when
   * the policy is 'never' — which is the default for every declared secret.
   */
  reveal(ref, { ctx, reason }) {
    const meta = this.dialect.prepare('SELECT * FROM secret_references WHERE ref = ?').get(ref);
    if (!meta) throw new SecretError(`secret ${ref} is not declared`, 'SECRET_NOT_DECLARED', { ref });
    if (meta.reveal_policy !== 'restricted') {
      throw new SecretError(`secret ${ref} may never be revealed`, 'SECRET_REVEAL_FORBIDDEN', { ref });
    }
    if (!reason || String(reason).trim().length < 5) throw new SecretError('a reveal requires a stated reason', 'SECRET_REVEAL_REASON_REQUIRED');
    if (!this.evaluator || !ctx) throw new SecretError('a reveal requires an authorization context', 'SECRET_REVEAL_CONTEXT_REQUIRED');
    this.evaluator.require({ permission: meta.required_permission || 'platform:secrets:reveal', ctx });
    this.#event(ref, 'reveal', ctx.actorId, { reason: String(reason).slice(0, 300) });
    return this.use(ref, (plaintext) => plaintext);
  }

  /** Re-encrypt every active secret under a new key version. Old values stay readable. */
  rotateKey(newKey, { actor = 'system' } = {}) {
    const nextVersion = (this.keys.size ? Math.max(...this.keys.keys()) : 0) + 1;
    const rotated = [];
    const rows = this.dialect.prepare('SELECT ref FROM secret_values WHERE active = 1').all();
    // Read every plaintext under the OLD keys before installing the new one.
    const plaintexts = new Map();
    for (const { ref } of rows) plaintexts.set(ref, this.use(ref, (p) => p));
    this.keys.set(nextVersion, resolveMasterKey(newKey));
    for (const [ref, plaintext] of plaintexts) {
      this.set(ref, plaintext, { actor });
      this.#event(ref, 'rotate', actor, { keyVersion: nextVersion });
      this.dialect.prepare('UPDATE secret_values SET rotated_at = ? WHERE ref = ? AND active = 1').run(this.#now(), ref);
      rotated.push(ref);
    }
    return { keyVersion: nextVersion, rotated };
  }

  revoke(ref, actor = 'system') {
    this.dialect.prepare('UPDATE secret_values SET active = 0 WHERE ref = ?').run(ref);
    this.#event(ref, 'revoke', actor);
    return this.describe(ref);
  }

  /**
   * A backup/support-bundle-safe export: references and metadata only, never
   * ciphertext and never plaintext (§ 39 "backup/restore strategy without plaintext").
   */
  exportSafe() {
    return this.dialect.prepare('SELECT ref, module_id, label, reveal_policy, rotation_required FROM secret_references ORDER BY ref').all()
      .map((r) => ({ ref: r.ref, moduleId: r.module_id, label: r.label, revealPolicy: r.reveal_policy, rotationRequired: r.rotation_required === 1, value: null }));
  }
}

export function createSecretVault(dialect, options) { return new SecretVault(dialect, options); }

/**
 * Redaction filter for logs, audit rows, job payloads, errors, and support
 * bundles. Applied by the notification, job, and integration layers.
 */
export function redactForLogs(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') {
    // Order matters: protect the safe `secret://ref` form first, then redact.
    const REF = '__OCTAGON_SECRET_REF_SENTINEL__';
    const refs = [];
    let out = value.replace(/secret:\/\/[a-z0-9._-]+/gi, (m) => { refs.push(m); return REF; });
    out = out
      .replace(/\bok_[A-Za-z0-9_-]{16,}/g, 'ok_***REDACTED***')
      // `token: abc`, `api_key=abc`, `password abc`, `Bearer abc` — a secret
      // written into free text is still a leak, so the label form is redacted too.
      .replace(/\b(secret|password|passwd|token|api[_-]?key|client[_-]?secret|bearer|credential)\b\s*[:=]?\s*["']?([A-Za-z0-9_\-.+/]{8,})["']?/gi,
        (_, label) => `${label} ***REDACTED***`)
      .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '***REDACTED***');
    return out.replace(new RegExp(REF, 'g'), () => refs.shift());
  }
  if (Array.isArray(value)) return value.map((v) => redactForLogs(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /secret|password|passwd|token|api[_-]?key|client_secret|authorization|credential|private[_-]?key/i.test(k)
        ? '***REDACTED***'
        : redactForLogs(v, depth + 1);
    }
    return out;
  }
  return value;
}
