// Import, export, print, and public forms — Phase 02 packet 02.28.
//
// Source composition:
// - Octagon modules/documents.js, knowledge.js, esign.js and the existing RTL
//   print templates (PRESERVE: Arabic-first, RTL output, A4 defaults).
// - VNext vnext/client/excel.js + vnext/server/print/print-templates.js and
//   migration 629 public forms (project-owned, MERGE-CANONICAL).
// - Aureus webkul Excel/PDF/resource-export implementations (MIT reference,
//   behavior only): column selection and export shaping.
// - Frappe data import/export + print format (SPEC-IMPLEMENT — FRAPPE_ROOT absent).
//
// Invariants (§ 12.7 – 12.10, § 53):
//   - an import row executes through the SAME registered action as a UI/API call
//   - an export applies the SAME row scope and field masking as a list read
//   - a spreadsheet formula is neutralized on export (CSV injection defence)
//   - a public form is an anti-abuse-controlled call to a registered action,
//     never generic CRUD

'use strict';

import crypto from 'node:crypto';
import { AuthorizationError } from '../authorization/evaluator/index.mjs';

export class DataExchangeError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'DataExchangeError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Neutralize a value that a spreadsheet would interpret as a formula.
 * `=cmd|' /C calc'!A0` is the classic CSV-injection payload.
 */
export function neutralizeFormula(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

export function toCsv(rows, columns) {
  const escape = (v) => {
    const safe = neutralizeFormula(v ?? '');
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c])).join(',')).join('\n');
  return body ? `${header}\n${body}` : header;
}

export class DataExchangeService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.actionExecutor = deps.actionExecutor || null;
    this.configuration = deps.configuration || null;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  // --- import ---------------------------------------------------------------

  /**
   * Run an import. `mode: 'dry_run'` validates and reports without executing.
   * Every row goes through `actionExecutor.execute(actionId, ...)`, so imports
   * inherit validation, permission, audit, and idempotency automatically.
   */
  import({ entity, actionId, rows, ctx, mode = 'dry_run', rowErrorStrategy = 'skip',
    idempotencyKey = null, importPermission = null, fileId = null }) {
    if (!Array.isArray(rows)) throw new DataExchangeError('rows must be an array', 'IMPORT_ROWS_INVALID');
    if (this.evaluator) {
      const decision = this.evaluator.evaluate({ permission: importPermission || `${entity}:import`, ctx, entity });
      if (!decision.allowed) throw new AuthorizationError(decision);
    }
    if (idempotencyKey) {
      const existing = this.dialect.prepare('SELECT id FROM import_jobs WHERE entity = ? AND idempotency_key = ?').get(entity, idempotencyKey);
      if (existing) return { ...this.getImport(existing.id), duplicate: true };
    }

    const id = `imp_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO import_jobs (id, entity, action_id, file_id, company_id, mode, row_error_strategy, total_rows, status, idempotency_key, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(id, entity, actionId, fileId, ctx?.activeCompanyId || null, mode, rowErrorStrategy, rows.length,
      idempotencyKey, ctx?.actorId || 'system', this.#now());

    const roleIds = this.evaluator ? this.evaluator.effectiveRoleIds(ctx) : [];
    const insRow = this.dialect.prepare('INSERT INTO import_rows (id, import_id, row_number, payload, status, error, record_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let ok = 0;
    let failed = 0;
    let aborted = false;

    for (let i = 0; i < rows.length; i++) {
      const payload = rows[i];
      const rowNumber = i + 1;
      try {
        // 1. Protected/masked fields cannot be written through an import either.
        if (this.evaluator) this.evaluator.assertWritableFields(entity, payload, roleIds);
        // 2. Custom-field validation, the same as a form submit.
        if (this.configuration) {
          const validation = this.configuration.validateCustomValues(entity, payload, { companyId: ctx?.activeCompanyId });
          if (!validation.ok) throw new DataExchangeError(validation.errors.map((e) => e.messageAr).join('; '), 'IMPORT_ROW_INVALID', { errors: validation.errors });
        }
        if (mode === 'dry_run') {
          insRow.run(`irw_${crypto.randomUUID()}`, id, rowNumber, JSON.stringify(payload), 'ok', null, null);
          ok += 1;
          continue;
        }
        // 3. Execute through the registered action — never a raw INSERT.
        if (!this.actionExecutor) throw new DataExchangeError('no action executor is wired', 'ACTION_EXECUTOR_MISSING');
        const result = this.actionExecutor.execute(actionId, {
          data: payload,
          idempotency_key: `${id}:${rowNumber}`,
        }, ctx);
        insRow.run(`irw_${crypto.randomUUID()}`, id, rowNumber, JSON.stringify(payload), 'ok', null, result?.record_id || null);
        ok += 1;
      } catch (error) {
        insRow.run(`irw_${crypto.randomUUID()}`, id, rowNumber, JSON.stringify(payload), 'failed', String(error.message || error), null);
        failed += 1;
        if (rowErrorStrategy === 'abort') { aborted = true; break; }
      }
    }

    const report = { ok, failed, aborted, mode, processed: ok + failed };
    this.dialect.prepare("UPDATE import_jobs SET status = ?, ok_rows = ?, failed_rows = ?, report = ?, finished_at = ? WHERE id = ?")
      .run(aborted ? 'failed' : 'completed', ok, failed, JSON.stringify(report), this.#now(), id);
    return this.getImport(id);
  }

  getImport(id) {
    const r = this.dialect.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, entity: r.entity, actionId: r.action_id, mode: r.mode, status: r.status,
      totalRows: r.total_rows, okRows: r.ok_rows, failedRows: r.failed_rows,
      report: r.report ? JSON.parse(r.report) : null,
      rows: this.dialect.prepare('SELECT row_number, status, error, record_id FROM import_rows WHERE import_id = ? ORDER BY row_number').all(id),
    };
  }

  // --- export ---------------------------------------------------------------

  /**
   * Export through the evaluator's scoped list, so an export can never see more
   * than the same actor's list view, and masked fields stay masked.
   */
  export({ entity, ctx, exportPermission = null, columns = null, format = 'csv', limit = 10000 }) {
    const permission = exportPermission || `${entity}:export`;
    const { rows, decision } = this.evaluator.listScoped({ entity, ctx, permission, limit });
    const roleIds = this.evaluator.effectiveRoleIds(ctx);
    const { hidden, masked } = this.evaluator.fieldPartition(entity, roleIds);

    const discovered = new Set();
    for (const r of rows) for (const k of Object.keys(r.data || {})) discovered.add(k);
    let effectiveColumns = columns || [...discovered];
    // A caller cannot widen the column set to reach a hidden field.
    effectiveColumns = effectiveColumns.filter((c) => !hidden.includes(c));

    const flat = rows.map((r) => {
      const out = { id: r.id };
      for (const c of effectiveColumns) out[c] = r.data?.[c] ?? '';
      return out;
    });
    const outputColumns = ['id', ...effectiveColumns];

    const id = `exp_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO export_jobs (id, entity, format, filters, columns, masked_columns, row_count, company_id, requested_by, created_at)
      VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)
    `).run(id, entity, format, JSON.stringify(outputColumns), JSON.stringify(masked), flat.length,
      ctx?.activeCompanyId || null, ctx?.actorId || 'system', this.#now());

    return {
      id, entity, format, rowCount: flat.length, columns: outputColumns,
      maskedColumns: masked, hiddenColumns: hidden,
      content: format === 'csv' ? toCsv(flat, outputColumns) : flat,
      decisionId: decision.decisionId,
    };
  }

  // --- print ----------------------------------------------------------------

  registerPrintTemplate({ id, moduleId, entity, name, locale = 'ar', direction = 'rtl', body, paper = 'A4', requiredPermission = null }) {
    const prev = this.dialect.prepare('SELECT MAX(version) AS v FROM print_templates WHERE entity = ? AND name = ? AND locale = ?').get(entity, name, locale);
    const version = Number(prev?.v || 0) + 1;
    const templateId = id || `pt_${entity}_${name}_${locale}_v${version}`;
    this.dialect.prepare(`
      INSERT INTO print_templates (id, module_id, entity, name, locale, direction, body, paper, required_permission, version, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(templateId, moduleId, entity, name, locale, direction, body, paper, requiredPermission, version, this.#now());
    this.dialect.prepare("UPDATE print_templates SET status = 'retired' WHERE entity = ? AND name = ? AND locale = ? AND id <> ?")
      .run(entity, name, locale, templateId);
    return { id: templateId, entity, name, locale, direction, version };
  }

  /**
   * Render a print template. Masked fields are masked in the OUTPUT, so a PDF
   * can never become a data-leak path (§ 34 "report/template masking").
   */
  render({ entity, name, locale = 'ar', recordId, data, ctx, readPermission = null }) {
    const template = this.dialect.prepare("SELECT * FROM print_templates WHERE entity = ? AND name = ? AND locale = ? AND status = 'active'").get(entity, name, locale);
    if (!template) throw new DataExchangeError('print template not found', 'PRINT_TEMPLATE_NOT_FOUND', { entity, name, locale });
    if (this.evaluator) {
      const decision = this.evaluator.evaluate({
        permission: template.required_permission || readPermission || `${entity}:print`, ctx, entity, recordId,
      });
      if (!decision.allowed) throw new AuthorizationError(decision);
    }
    const roleIds = this.evaluator ? this.evaluator.effectiveRoleIds(ctx) : [];
    const safeData = this.evaluator ? this.evaluator.maskRecord(entity, data, roleIds) : data;
    const rendered = String(template.body).replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, path) => {
      const value = path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), safeData);
      // Escape so a record value can never inject markup into the output.
      return value == null ? '' : String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    });
    return {
      html: rendered, direction: template.direction, locale: template.locale,
      paper: template.paper, version: template.version,
    };
  }

  // --- public forms ---------------------------------------------------------

  /**
   * Accept an unauthenticated submission. It is NOT generic CRUD: it invokes a
   * named registered action, is rate-limited per IP, and records every attempt
   * including the refusals.
   */
  submitPublicForm({ formKey, actionId, payload, ip = null, systemCtx, rateLimitPerHour = 20 }) {
    const windowStart = new Date(this.now().getTime() - 3600000).toISOString();
    const recent = this.dialect.prepare('SELECT COUNT(*) AS n FROM public_form_submissions WHERE form_key = ? AND ip IS ? AND created_at > ?')
      .get(formKey, ip, windowStart);
    const id = `pfs_${crypto.randomUUID()}`;
    if (Number(recent.n) >= rateLimitPerHour) {
      this.dialect.prepare('INSERT INTO public_form_submissions (id, form_key, action_id, payload, ip, accepted, reason_code, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(id, formKey, actionId, JSON.stringify(payload), ip, 'RATE_LIMITED', this.#now());
      throw new DataExchangeError('تم تجاوز عدد المحاولات المسموح', 'PUBLIC_FORM_RATE_LIMITED', { formKey });
    }
    // Oversized submissions are refused before any work happens.
    const serialized = JSON.stringify(payload || {});
    if (serialized.length > 64 * 1024) {
      this.dialect.prepare('INSERT INTO public_form_submissions (id, form_key, action_id, payload, ip, accepted, reason_code, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(id, formKey, actionId, '{}', ip, 'PAYLOAD_TOO_LARGE', this.#now());
      throw new DataExchangeError('حجم البيانات كبير جداً', 'PUBLIC_FORM_TOO_LARGE');
    }
    if (!this.actionExecutor) throw new DataExchangeError('no action executor is wired', 'ACTION_EXECUTOR_MISSING');
    try {
      const result = this.actionExecutor.execute(actionId, { data: payload, idempotency_key: id }, systemCtx);
      this.dialect.prepare('INSERT INTO public_form_submissions (id, form_key, action_id, payload, ip, accepted, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(id, formKey, actionId, serialized, ip, this.#now());
      return { accepted: true, submissionId: id, recordId: result?.record_id || null };
    } catch (error) {
      this.dialect.prepare('INSERT INTO public_form_submissions (id, form_key, action_id, payload, ip, accepted, reason_code, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
        .run(id, formKey, actionId, serialized, ip, 'ACTION_FAILED', this.#now());
      // The public caller learns nothing about internal structure.
      throw new DataExchangeError('تعذّر قبول الطلب', 'PUBLIC_FORM_REJECTED');
    }
  }
}

export function createDataExchangeService(dialect, deps) { return new DataExchangeService(dialect, deps); }
