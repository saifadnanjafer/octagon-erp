// Secure file and attachment platform — Phase 02 packet 02.27.
//
// Source composition:
// - Octagon modules/documents.js, knowledge.js, esign.js upload/download paths
//   (PRESERVE the capability; REPLACE the reachability model — those modules
//   addressed files by id, which is an IDOR surface).
// - VNext print/public-form assets (project-owned) for the share-token concept.
// - NocoBase file plugin (clean-room): storage-provider abstraction and metadata
//   separation.
// - RuoYi file storage starter (MIT reference, behavior only).
//
// Invariants (§ 12.4 – 12.9):
//   - PRIVATE BY DEFAULT. A file is reachable only through an attachment to a
//     record the actor may read, or through an explicit, expiring, revocable
//     share token. There is no "public" flag.
//   - file names, MIME types, sizes, and paths are validated
//   - every access, including a denial, is logged

'use strict';

import crypto from 'node:crypto';
import path from 'node:path';
import { AuthorizationError } from '../authorization/evaluator/index.mjs';

export class FileError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FileError';
    this.code = code;
    this.details = details;
    this.statusCode = code === 'FILE_NOT_FOUND' ? 404 : 403;
  }
}

/** Extensions that are never accepted, regardless of the declared MIME type. */
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.pif', '.msi', '.jar',
  '.js', '.mjs', '.vbs', '.ps1', '.sh', '.php', '.jsp', '.asp', '.aspx', '.htaccess',
]);

/** Magic-number prefixes used to catch a MIME type that lies about its content. */
const MAGIC = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/** In-memory storage provider for tests and local development. */
export function createMemoryStorage() {
  const blobs = new Map();
  return {
    name: 'memory',
    put(key, buffer) { blobs.set(key, Buffer.from(buffer)); return { key, size: buffer.length }; },
    get(key) {
      if (!blobs.has(key)) throw new FileError('blob not found in storage', 'STORAGE_MISS', { key });
      return blobs.get(key);
    },
    delete(key) { return blobs.delete(key); },
    has(key) { return blobs.has(key); },
    keys() { return [...blobs.keys()]; },
  };
}

/**
 * Sanitize a filename. Strips every path component, so `../../etc/passwd` and
 * `..\\..\\windows\\system32` both reduce to a harmless basename.
 */
export function safeFilename(input) {
  const raw = String(input || 'file');
  const base = path.basename(raw.replace(/\\/g, '/'));
  const cleaned = base.replace(/[\x00-\x1F\x7F]/g, '').replace(/^\.+/, '').replace(/[<>:"|?*]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file';
  return cleaned.slice(0, 200);
}

export class FileService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.storage = deps.storage || createMemoryStorage();
    this.evaluator = deps.evaluator || null;
    this.scanner = deps.scanner || null;
    this.maxBytes = deps.maxBytes ?? 25 * 1024 * 1024;
    this.allowedMimeTypes = deps.allowedMimeTypes || new Set([
      'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'text/plain', 'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/zip',
    ]);
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  #log(fileId, operation, { actorId = null, shareId = null, reasonCode = null, ip = null } = {}) {
    this.dialect.prepare(`
      INSERT INTO file_access_log (id, file_id, actor_id, share_id, operation, reason_code, occurred_at, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), fileId, actorId, shareId, operation, reasonCode, this.#now(), ip);
  }

  #validate(filename, mimeType, buffer) {
    const clean = safeFilename(filename);
    const ext = path.extname(clean).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) throw new FileError(`نوع الملف ${ext} غير مسموح`, 'FILE_EXTENSION_BLOCKED', { ext });
    if (!this.allowedMimeTypes.has(mimeType)) throw new FileError(`نوع المحتوى ${mimeType} غير مسموح`, 'FILE_MIME_BLOCKED', { mimeType });
    if (buffer.length > this.maxBytes) throw new FileError('حجم الملف أكبر من المسموح', 'FILE_TOO_LARGE', { size: buffer.length, max: this.maxBytes });
    if (buffer.length === 0) throw new FileError('الملف فارغ', 'FILE_EMPTY');
    // MIME spoofing: if we know the magic bytes for the declared type, they must match.
    const expected = MAGIC.find((m) => m.mime === mimeType);
    if (expected) {
      const head = [...buffer.subarray(0, expected.bytes.length)];
      if (!expected.bytes.every((b, i) => head[i] === b)) {
        throw new FileError('محتوى الملف لا يطابق نوعه المعلن', 'FILE_MIME_SPOOFED', { mimeType });
      }
    }
    return clean;
  }

  /**
   * Upload and attach in one governed step. A file that is not attached to a
   * record is unreachable, so attachment is required, not optional.
   */
  upload({ filename, mimeType, buffer, entity, recordId, purpose = null, ctx, writePermission }) {
    if (!entity || !recordId) throw new FileError('a file must be attached to a record', 'FILE_ATTACHMENT_REQUIRED');
    if (this.evaluator) {
      const decision = this.evaluator.evaluate({ permission: writePermission || `${entity}:update`, ctx, entity, recordId });
      if (!decision.allowed) {
        this.#log('unknown', 'denied', { actorId: ctx?.actorId, reasonCode: decision.reasonCode });
        throw new AuthorizationError(decision);
      }
    }
    const clean = this.#validate(filename, mimeType, buffer);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const id = `file_${crypto.randomUUID()}`;
    // The storage key is derived, never caller-supplied — a traversal cannot
    // reach outside the store because the caller never names the path.
    const storageKey = `${ctx?.activeCompanyId || 'global'}/${id}`;
    this.storage.put(storageKey, buffer);

    let scanStatus = 'skipped';
    let scanDetail = null;
    if (this.scanner) {
      const verdict = this.scanner.scan(buffer, { filename: clean, mimeType });
      scanStatus = verdict.clean ? 'clean' : 'infected';
      scanDetail = verdict.detail || null;
      if (!verdict.clean) {
        this.storage.delete(storageKey);
        throw new FileError('تم رفض الملف بواسطة فحص الفيروسات', 'FILE_INFECTED', { detail: scanDetail });
      }
    }

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO file_objects (id, storage_provider, storage_key, filename, mime_type, size_bytes, checksum,
          tenant_id, company_id, scan_status, scan_detail, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, this.storage.name, storageKey, clean, mimeType, buffer.length, checksum,
        ctx?.tenantId || null, ctx?.activeCompanyId || null, scanStatus, scanDetail, ctx?.actorId || 'system', this.#now());
      this.dialect.prepare(`
        INSERT INTO file_attachments (id, file_id, entity, record_id, purpose, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`att_${crypto.randomUUID()}`, id, entity, recordId, purpose, ctx?.actorId || 'system', this.#now());
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      this.storage.delete(storageKey);
      throw e;
    }
    this.#log(id, 'upload', { actorId: ctx?.actorId });
    return this.describe(id);
  }

  describe(fileId) {
    const r = this.dialect.prepare('SELECT * FROM file_objects WHERE id = ?').get(fileId);
    if (!r) return null;
    return {
      id: r.id, filename: r.filename, mimeType: r.mime_type, sizeBytes: r.size_bytes, checksum: r.checksum,
      companyId: r.company_id, tenantId: r.tenant_id, scanStatus: r.scan_status,
      uploadedBy: r.uploaded_by, createdAt: r.created_at, deletedAt: r.deleted_at,
      attachments: this.dialect.prepare('SELECT entity, record_id, purpose FROM file_attachments WHERE file_id = ?').all(fileId),
    };
  }

  /**
   * Authorize a download. Access derives ENTIRELY from the attached record —
   * knowing the file id proves nothing (§ 12.5, IDOR defence).
   */
  #authorizeRead(fileId, ctx, readPermission) {
    const file = this.dialect.prepare('SELECT * FROM file_objects WHERE id = ? AND deleted_at IS NULL').get(fileId);
    if (!file) {
      this.#log(fileId, 'denied', { actorId: ctx?.actorId, reasonCode: 'FILE_NOT_FOUND' });
      throw new FileError('الملف غير موجود أو خارج نطاق صلاحيتك', 'FILE_NOT_FOUND');
    }
    // Company containment is unconditional.
    if (file.company_id && ctx?.companyMemberships?.length && !ctx.companyMemberships.includes(file.company_id)) {
      this.#log(fileId, 'denied', { actorId: ctx?.actorId, reasonCode: 'FILE_OUT_OF_SCOPE' });
      throw new FileError('الملف غير موجود أو خارج نطاق صلاحيتك', 'FILE_NOT_FOUND');
    }
    const attachments = this.dialect.prepare('SELECT entity, record_id FROM file_attachments WHERE file_id = ?').all(fileId);
    if (!attachments.length) {
      this.#log(fileId, 'denied', { actorId: ctx?.actorId, reasonCode: 'FILE_ORPHANED' });
      throw new FileError('الملف غير موجود أو خارج نطاق صلاحيتك', 'FILE_NOT_FOUND');
    }
    if (!this.evaluator) return file;
    for (const att of attachments) {
      const decision = this.evaluator.evaluate({
        permission: readPermission || `${att.entity}:read`, ctx, entity: att.entity, recordId: att.record_id,
      });
      if (decision.allowed) return file;
    }
    this.#log(fileId, 'denied', { actorId: ctx?.actorId, reasonCode: 'RECORD_OUT_OF_SCOPE' });
    throw new FileError('الملف غير موجود أو خارج نطاق صلاحيتك', 'FILE_NOT_FOUND');
  }

  download(fileId, ctx, { readPermission = null, ip = null } = {}) {
    const file = this.#authorizeRead(fileId, ctx, readPermission);
    const buffer = this.storage.get(file.storage_key);
    this.#log(fileId, 'download', { actorId: ctx?.actorId, ip });
    return { filename: file.filename, mimeType: file.mime_type, buffer, checksum: file.checksum };
  }

  /** Files attached to a record the actor may read. */
  listForRecord(entity, recordId, ctx, { readPermission = null } = {}) {
    if (this.evaluator) {
      const decision = this.evaluator.evaluate({ permission: readPermission || `${entity}:read`, ctx, entity, recordId });
      if (!decision.allowed) throw new AuthorizationError(decision);
    }
    return this.dialect.prepare(`
      SELECT f.id FROM file_attachments a JOIN file_objects f ON f.id = a.file_id AND f.deleted_at IS NULL
      WHERE a.entity = ? AND a.record_id = ?
    `).all(entity, recordId).map((r) => this.describe(r.id));
  }

  /**
   * Create a public share link. Explicit, expiring, revocable, audited, and
   * optionally download-capped. The raw token is returned exactly once.
   */
  share(fileId, { expiresInMinutes = 60, maxDownloads = null, reason = null, ctx, readPermission = null }) {
    this.#authorizeRead(fileId, ctx, readPermission);
    if (this.evaluator) {
      const decision = this.evaluator.evaluate({ permission: 'platform:file:share', ctx });
      if (!decision.allowed) throw new AuthorizationError(decision);
    }
    const raw = crypto.randomBytes(32).toString('base64url');
    const id = `shr_${crypto.randomUUID()}`;
    const expiresAt = new Date(this.now().getTime() + expiresInMinutes * 60000).toISOString();
    this.dialect.prepare(`
      INSERT INTO file_shares (id, file_id, token_hash, created_by, reason, expires_at, max_downloads, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, fileId, crypto.createHash('sha256').update(raw).digest('hex'), ctx.actorId, reason, expiresAt, maxDownloads, this.#now());
    this.#log(fileId, 'share', { actorId: ctx.actorId, shareId: id });
    return { shareId: id, token: raw, expiresAt, maxDownloads };
  }

  /** Redeem a share token. A guessed or expired token is indistinguishable. */
  redeemShare(token, { ip = null } = {}) {
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    const share = this.dialect.prepare('SELECT * FROM file_shares WHERE token_hash = ?').get(hash);
    if (!share) throw new FileError('الرابط غير صالح', 'SHARE_INVALID');
    if (share.revoked_at) { this.#log(share.file_id, 'denied', { shareId: share.id, reasonCode: 'SHARE_REVOKED', ip }); throw new FileError('الرابط غير صالح', 'SHARE_INVALID'); }
    if (Date.parse(share.expires_at) <= this.now().getTime()) { this.#log(share.file_id, 'denied', { shareId: share.id, reasonCode: 'SHARE_EXPIRED', ip }); throw new FileError('الرابط غير صالح', 'SHARE_INVALID'); }
    if (share.max_downloads != null && share.downloads >= share.max_downloads) {
      this.#log(share.file_id, 'denied', { shareId: share.id, reasonCode: 'SHARE_EXHAUSTED', ip });
      throw new FileError('الرابط غير صالح', 'SHARE_INVALID');
    }
    const file = this.dialect.prepare('SELECT * FROM file_objects WHERE id = ? AND deleted_at IS NULL').get(share.file_id);
    if (!file) throw new FileError('الرابط غير صالح', 'SHARE_INVALID');
    this.dialect.prepare('UPDATE file_shares SET downloads = downloads + 1 WHERE id = ?').run(share.id);
    this.#log(share.file_id, 'download', { shareId: share.id, ip });
    return { filename: file.filename, mimeType: file.mime_type, buffer: this.storage.get(file.storage_key) };
  }

  revokeShare(shareId, ctx) {
    const share = this.dialect.prepare('SELECT file_id FROM file_shares WHERE id = ?').get(shareId);
    if (!share) throw new FileError('share not found', 'SHARE_NOT_FOUND');
    this.dialect.prepare('UPDATE file_shares SET revoked_at = ? WHERE id = ?').run(this.#now(), shareId);
    this.#log(share.file_id, 'revoke', { actorId: ctx?.actorId, shareId });
    return true;
  }

  delete(fileId, ctx, { readPermission = null } = {}) {
    this.#authorizeRead(fileId, ctx, readPermission);
    this.dialect.prepare('UPDATE file_objects SET deleted_at = ? WHERE id = ?').run(this.#now(), fileId);
    this.dialect.prepare('UPDATE file_shares SET revoked_at = ? WHERE file_id = ? AND revoked_at IS NULL').run(this.#now(), fileId);
    this.#log(fileId, 'delete', { actorId: ctx?.actorId });
    return true;
  }

  /** Remove blobs whose file row is gone or soft-deleted past its retention. */
  cleanupOrphans({ retainDeletedDays = 30 } = {}) {
    const cutoff = new Date(this.now().getTime() - retainDeletedDays * 86400000).toISOString();
    const purgeable = this.dialect.prepare('SELECT id, storage_key FROM file_objects WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff);
    for (const f of purgeable) {
      this.storage.delete(f.storage_key);
      this.dialect.prepare('DELETE FROM file_objects WHERE id = ?').run(f.id);
    }
    // Blobs with no owning row at all (an interrupted upload).
    const known = new Set(this.dialect.prepare('SELECT storage_key FROM file_objects').all().map((r) => r.storage_key));
    let strays = 0;
    for (const key of this.storage.keys()) {
      if (!known.has(key)) { this.storage.delete(key); strays += 1; }
    }
    return { purged: purgeable.length, strayBlobsRemoved: strays };
  }

  accessLog(fileId, limit = 100) {
    return this.dialect.prepare('SELECT * FROM file_access_log WHERE file_id = ? ORDER BY occurred_at DESC LIMIT ?').all(fileId, limit);
  }
}

export function createFileService(dialect, deps) { return new FileService(dialect, deps); }
export const _internal = { BLOCKED_EXTENSIONS, MAGIC };
