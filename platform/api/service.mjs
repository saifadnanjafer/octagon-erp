'use strict';

export function handleServiceQuery({ dialect, ctx, resource, recordId = null }) {
  const companyId = ctx?.companyId;
  if (!companyId) return { error: 'an active company scope is required', status: 403 };
  const table = ({ contracts: 'service_contracts', policies: 'entitlement_policies', decisions: 'entitlement_decisions', usage: 'entitlement_usage_ledger', signatures: 'signature_requests', providers: 'signature_providers' })[resource];
  if (!table) return { error: 'unknown service resource', status: 404 };
  if (recordId) { const row = dialect.prepare(`SELECT * FROM ${table} WHERE id=? AND company_id=?`).get(recordId, companyId); return row ? { data: row, meta: null } : { error: 'record not found', status: 404 }; }
  const rows = dialect.prepare(`SELECT * FROM ${table} WHERE company_id=? ORDER BY created_at DESC LIMIT 200`).all(companyId);
  return { data: rows, meta: { total: rows.length } };
}
