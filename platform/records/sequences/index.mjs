// Sequence authority — Phase 01 foundation.
//
// Source composition:
// - VNext server/crud/sequences.js (project-owned) used as the implementation
//   base for template formatting and gap/reset policies.
// - Odoo ir.sequence (clean-room reference) for template placeholders and
//   multi-company scope.
// - Frappe naming series (MIT reference) for period-aware resets.
//
// Responsibilities:
//   - assign formatted numbers from templates such as PRD-{#####}
//   - keep the counter in x_sequences, one row per (scope_key, company_id, period)
//   - support reset policies: none, fiscal_year, calendar_year, calendar_month
//   - never reuse a number within a period; gaps are allowed unless configured otherwise

'use strict';

export const SEQUENCE_RESET_POLICIES = ['none', 'fiscal_year', 'calendar_year', 'calendar_month'];
export const SEQUENCE_GAP_POLICIES = ['allowed', 'disallowed'];

export class SequenceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SequenceError';
    this.code = code;
    this.details = details;
  }
}

export function currentPeriod(resetPolicy, now = new Date()) {
  if (resetPolicy === 'calendar_month') {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (resetPolicy === 'calendar_year' || resetPolicy === 'fiscal_year') {
    return String(now.getFullYear());
  }
  return 'all';
}

export function formatSequence(template, number, period, now = new Date()) {
  let formatted = template;
  formatted = formatted.replaceAll('{YYYY}', String(now.getFullYear()));
  formatted = formatted.replaceAll('{MM}', String(now.getMonth() + 1).padStart(2, '0'));
  formatted = formatted.replaceAll('{DD}', String(now.getDate()).padStart(2, '0'));
  formatted = formatted.replaceAll('{PERIOD}', period || 'all');
  const match = formatted.match(/\{(#+)\}/);
  if (match) {
    const digits = match[1].length;
    formatted = formatted.replace(match[0], String(number).padStart(digits, '0'));
  }
  return formatted;
}

export function nextSeq(dialect, {
  scopeKey,
  template,
  companyId = null,
  resetPolicy = 'none',
  gapPolicy = 'allowed',
  fiscalStartMonth = 1,
} = {}) {
  if (!scopeKey || typeof scopeKey !== 'string') {
    throw new SequenceError('scopeKey is required', 'SCOPE_KEY_REQUIRED');
  }
  if (!template || typeof template !== 'string') {
    throw new SequenceError('template is required', 'TEMPLATE_REQUIRED');
  }
  if (!SEQUENCE_RESET_POLICIES.includes(resetPolicy)) {
    throw new SequenceError(`resetPolicy must be one of ${SEQUENCE_RESET_POLICIES.join(', ')}`, 'INVALID_RESET_POLICY', { resetPolicy });
  }
  if (!SEQUENCE_GAP_POLICIES.includes(gapPolicy)) {
    throw new SequenceError(`gapPolicy must be one of ${SEQUENCE_GAP_POLICIES.join(', ')}`, 'INVALID_GAP_POLICY', { gapPolicy });
  }

  const now = new Date();
  let period = currentPeriod(resetPolicy, now);
  if (resetPolicy === 'fiscal_year') {
    const year = now.getMonth() + 1 < fiscalStartMonth ? now.getFullYear() - 1 : now.getFullYear();
    period = String(year);
  }

  const row = dialect.prepare('SELECT current_value FROM platform_sequences WHERE id = ?').get(`${scopeKey}:${companyId || 'global'}:${period}`);
  let nextNumber = 1;
  if (row) {
    nextNumber = row.current_value + 1;
    dialect.prepare('UPDATE platform_sequences SET current_value = ?, updated_at = ? WHERE id = ?')
      .run(nextNumber, now.toISOString(), `${scopeKey}:${companyId || 'global'}:${period}`);
  } else {
    dialect.prepare(`
      INSERT INTO platform_sequences (id, module_id, scope_key, template, current_value, reset_policy, gap_policy, fiscal_period_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${scopeKey}:${companyId || 'global'}:${period}`,
      'platform_kernel',
      scopeKey,
      template,
      nextNumber,
      resetPolicy,
      gapPolicy,
      period,
      now.toISOString(),
      now.toISOString()
    );
  }
  return { formatted: formatSequence(template, nextNumber, period, now), number: nextNumber, period };
}

export function peekSeq(dialect, { scopeKey, companyId = null } = {}) {
  const now = new Date();
  const period = currentPeriod('none', now);
  const row = dialect.prepare('SELECT current_value, template, reset_policy, gap_policy FROM platform_sequences WHERE id = ?')
    .get(`${scopeKey}:${companyId || 'global'}:${period}`);
  if (!row) return null;
  return {
    formatted: formatSequence(row.template, row.current_value + 1, period, now),
    number: row.current_value + 1,
    period,
  };
}

export function resetSeq(dialect, { scopeKey, companyId = null, period = 'all' } = {}) {
  dialect.prepare('DELETE FROM platform_sequences WHERE id = ?').run(`${scopeKey}:${companyId || 'global'}:${period}`);
  return { reset: true };
}
