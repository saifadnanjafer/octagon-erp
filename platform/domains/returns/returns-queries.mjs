// platform/domains/returns/returns-queries.mjs — Governed read queries over the Returns/RMA authority.
//
// Every resource is scoped to ctx.companyId — the server-derived company, not
// a client-suppliable filter — matching the isolation pattern used by
// platform/control_plane/index.mjs.

'use strict';

export function handleReturnsQuery({ dialect, ctx, resource, recordId, query = {} }) {
  const companyId = ctx?.companyId;
  if (!companyId) return { error: 'company scope required', status: 400 };

  if (resource === 'rma') {
    if (recordId) {
      const rma = dialect.prepare('SELECT * FROM returns_rma WHERE id = ? AND company_id = ? AND is_active = 1').get(recordId, companyId);
      if (!rma) return { error: 'RMA not found', status: 404 };
      const lines = dialect.prepare('SELECT * FROM returns_rma_lines WHERE rma_id = ?').all(recordId);
      const timeline = dialect.prepare('SELECT * FROM returns_rma_timeline WHERE rma_id = ? ORDER BY created_at ASC').all(recordId);
      return { data: { ...rma, lines, timeline } };
    }
    let sql = 'SELECT * FROM returns_rma WHERE company_id = ? AND is_active = 1';
    const params = [companyId];
    if (query.status) { sql += ' AND status = ?'; params.push(query.status); }
    if (query.customer_id) { sql += ' AND customer_id = ?'; params.push(query.customer_id); }
    if (query.source_type) { sql += ' AND source_type = ?'; params.push(query.source_type); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const rows = dialect.prepare(sql).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'rma_timeline' && recordId) {
    const rma = dialect.prepare('SELECT id FROM returns_rma WHERE id = ? AND company_id = ?').get(recordId, companyId);
    if (!rma) return { error: 'RMA not found', status: 404 };
    const rows = dialect.prepare('SELECT * FROM returns_rma_timeline WHERE rma_id = ? ORDER BY created_at ASC').all(recordId);
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown returns resource ${resource}`, status: 404 };
}
