// platform/domains/contracts/service.mjs — Contracts and Legal Management Domain Services.

import { createHash } from 'crypto';

export function getContract(db, contractId, companyId) {
  const row = db.prepare(`
    SELECT * FROM contracts WHERE id = ? AND (company_id = ? OR company_id = '*')
  `).get(contractId, companyId);
  return row || null;
}

export function generateContractNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `CNT-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM contracts WHERE company_id = ? AND contract_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createContract(db, {
  company_id,
  branch_id = null,
  title_ar,
  title_en,
  type_id,
  party_id = null,
  project_id = null,
  sale_order_id = null,
  purchase_order_id = null,
  invoice_id = null,
  contract_value = 0,
  currency = 'IQD',
  start_date = null,
  end_date = null,
  notice_period_days = 30,
  auto_renew = 0,
  governing_law = 'Iraqi Law',
  jurisdiction = 'Baghdad Courts',
  owner_user_id
}, user) {
  if (!company_id || !title_ar || !title_en || !type_id || !owner_user_id) {
    throw new Error('MISSING_REQUIRED_FIELDS: company_id, title_ar, title_en, type_id, owner_user_id are required');
  }

  // Check type exists
  const typeRow = db.prepare('SELECT * FROM contract_types WHERE id = ?').get(type_id);
  if (!typeRow) {
    throw new Error(`INVALID_CONTRACT_TYPE: Contract type ${type_id} does not exist`);
  }

  // Verify Party if provided
  if (party_id) {
    const partyRow = db.prepare('SELECT id FROM parties WHERE id = ?').get(party_id);
    if (!partyRow) {
      throw new Error(`INVALID_PARTY: Party ${party_id} does not exist`);
    }
  }

  const id = `cnt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const contract_number = generateContractNumber(db, company_id);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contracts (
      id, company_id, branch_id, contract_number, title_ar, title_en, type_id,
      party_id, project_id, sale_order_id, purchase_order_id, invoice_id,
      status, contract_value, currency, start_date, end_date, notice_period_days,
      auto_renew, governing_law, jurisdiction, owner_user_id, version,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'draft', ?, ?, ?, ?, ?,
      ?, ?, ?, ?, 1,
      ?, ?, ?, ?
    )
  `).run(
    id, company_id, branch_id, contract_number, title_ar, title_en, type_id,
    party_id, project_id, sale_order_id, purchase_order_id, invoice_id,
    contract_value, currency, start_date, end_date, notice_period_days,
    auto_renew, governing_law, jurisdiction, owner_user_id,
    user.id || 'system', user.id || 'system', now, now
  );

  // If party_id provided, insert primary contract party
  if (party_id) {
    const partyLinkId = `cp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    db.prepare(`
      INSERT INTO contract_parties (id, contract_id, party_id, role, created_at)
      VALUES (?, ?, ?, 'counterparty', ?)
    `).run(partyLinkId, id, party_id, now);
  }

  return getContract(db, id, company_id);
}

export function transitionContractStatus(db, { contract_id, company_id, target_status, reason = '' }, user) {
  const contract = getContract(db, contract_id, company_id);
  if (!contract) {
    throw new Error(`CONTRACT_NOT_FOUND: Contract ${contract_id} not found in company ${company_id}`);
  }

  const allowedTransitions = {
    draft: ['internal_review', 'cancelled'],
    internal_review: ['counterparty_review', 'approved', 'draft', 'cancelled'],
    counterparty_review: ['approved', 'internal_review', 'cancelled'],
    approved: ['signature_pending', 'active', 'cancelled'],
    signature_pending: ['active', 'cancelled'],
    active: ['expiring', 'renewed', 'completed', 'terminated', 'suspended', 'disputed'],
    expiring: ['renewed', 'completed', 'terminated'],
    suspended: ['active', 'terminated', 'cancelled'],
    disputed: ['active', 'terminated', 'suspended'],
    renewed: ['active', 'completed'],
    completed: ['superseded'],
    terminated: [],
    cancelled: []
  };

  const validNext = allowedTransitions[contract.status] || [];
  if (!validNext.includes(target_status)) {
    throw new Error(`INVALID_STATUS_TRANSITION: Cannot transition contract from ${contract.status} to ${target_status}`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE contracts
    SET status = ?, updated_by = ?, updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(target_status, user.id || 'system', now, contract_id, company_id);

  return getContract(db, contract_id, company_id);
}

export function amendContract(db, { contract_id, company_id, title_ar, title_en, description, effective_date, new_value = null }, user) {
  const contract = getContract(db, contract_id, company_id);
  if (!contract) {
    throw new Error(`CONTRACT_NOT_FOUND: Contract ${contract_id} not found`);
  }

  if (contract.status !== 'active' && contract.status !== 'approved') {
    throw new Error(`CONTRACT_NOT_AMENDABLE: Contract must be active or approved to amend (current: ${contract.status})`);
  }

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM contract_amendments WHERE contract_id = ?').get(contract_id);
  const amdNumber = (countRow ? countRow.cnt : 0) + 1;
  const amdId = `amd-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contract_amendments (
      id, contract_id, amendment_number, title_ar, title_en, description,
      effective_date, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
  `).run(amdId, contract_id, amdNumber, title_ar, title_en, description, effective_date, user.id || 'system', now);

  // Bump contract version and value if updated
  const newVersion = contract.version + 1;
  const updatedValue = new_value !== null ? new_value : contract.contract_value;

  db.prepare(`
    UPDATE contracts
    SET version = ?, contract_value = ?, updated_by = ?, updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(newVersion, updatedValue, user.id || 'system', now, contract_id, company_id);

  return getContract(db, contract_id, company_id);
}

export function renewContract(db, { contract_id, company_id, new_end_date, revised_value = null, notes = '' }, user) {
  const contract = getContract(db, contract_id, company_id);
  if (!contract) {
    throw new Error(`CONTRACT_NOT_FOUND: Contract ${contract_id} not found`);
  }

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM contract_renewals WHERE contract_id = ?').get(contract_id);
  const renewalNumber = (countRow ? countRow.cnt : 0) + 1;
  const renId = `ren-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contract_renewals (
      id, contract_id, renewal_number, previous_end_date, new_end_date,
      revised_value, renewal_notes, renewed_by, renewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    renId, contract_id, renewalNumber, contract.end_date || now, new_end_date,
    revised_value !== null ? revised_value : contract.contract_value,
    notes, user.id || 'system', now
  );

  const updatedValue = revised_value !== null ? revised_value : contract.contract_value;
  db.prepare(`
    UPDATE contracts
    SET status = 'active', end_date = ?, contract_value = ?, updated_by = ?, updated_at = ?
    WHERE id = ? AND company_id = ?
  `).run(new_end_date, updatedValue, user.id || 'system', now, contract_id, company_id);

  return getContract(db, contract_id, company_id);
}

export function addContractObligation(db, { contract_id, company_id, title_ar, title_en, responsible_party = 'internal', assigned_user_id = null, due_date = null, penalty_amount = 0 }) {
  const contract = getContract(db, contract_id, company_id);
  if (!contract) {
    throw new Error(`CONTRACT_NOT_FOUND: Contract ${contract_id} not found`);
  }

  const id = `obg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contract_obligations (
      id, contract_id, company_id, title_ar, title_en, responsible_party,
      assigned_user_id, due_date, status, penalty_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, contract_id, company_id, title_ar, title_en, responsible_party, assigned_user_id, due_date, penalty_amount, now, now);

  return db.prepare('SELECT * FROM contract_obligations WHERE id = ?').get(id);
}

export function fulfillContractObligation(db, { obligation_id, company_id, evidence = '' }, user) {
  const obg = db.prepare('SELECT * FROM contract_obligations WHERE id = ? AND company_id = ?').get(obligation_id, company_id);
  if (!obg) {
    throw new Error(`OBLIGATION_NOT_FOUND: Obligation ${obligation_id} not found`);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE contract_obligations
    SET status = 'fulfilled', fulfilled_at = ?, fulfillment_evidence = ?, updated_at = ?
    WHERE id = ?
  `).run(now, evidence, now, obligation_id);

  return db.prepare('SELECT * FROM contract_obligations WHERE id = ?').get(obligation_id);
}

export function addContractGuarantee(db, { contract_id, company_id, guarantee_type = 'performance_bond', bank_name, reference_number, amount, currency = 'IQD', issue_date, expiry_date }) {
  const contract = getContract(db, contract_id, company_id);
  if (!contract) {
    throw new Error(`CONTRACT_NOT_FOUND: Contract ${contract_id} not found`);
  }

  const id = `gtn-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO contract_guarantees (
      id, contract_id, company_id, guarantee_type, bank_name, reference_number,
      amount, currency, issue_date, expiry_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, contract_id, company_id, guarantee_type, bank_name, reference_number, amount, currency, issue_date, expiry_date, now, now);

  return db.prepare('SELECT * FROM contract_guarantees WHERE id = ?').get(id);
}

export function createLegalMatter(db, { company_id, title_ar, title_en, contract_id = null, party_id = null, category = 'litigation', assigned_lawyer = '', estimated_cost = 0 }, user) {
  const year = new Date().getFullYear();
  const prefix = `LGL-${year}-`;
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM legal_matters WHERE company_id = ? AND matter_number LIKE ?').get(company_id, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  const matter_number = `${prefix}${String(seq).padStart(4, '0')}`;

  const id = `lgl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO legal_matters (
      id, company_id, matter_number, title_ar, title_en, contract_id,
      party_id, category, status, assigned_lawyer, estimated_cost,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(id, company_id, matter_number, title_ar, title_en, contract_id, party_id, category, assigned_lawyer, estimated_cost, user.id || 'system', now, now);

  return db.prepare('SELECT * FROM legal_matters WHERE id = ?').get(id);
}

export function listContracts(db, { company_id, status, type_id, party_id, search, limit = 100, offset = 0 }) {
  const filters = ['(company_id = ? OR company_id = \'*\')'];
  const params = [company_id];

  if (status) { filters.push('status = ?'); params.push(status); }
  if (type_id) { filters.push('type_id = ?'); params.push(type_id); }
  if (party_id) { filters.push('party_id = ?'); params.push(party_id); }
  if (search) {
    filters.push('(contract_number LIKE ? OR title_ar LIKE ? OR title_en LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM contracts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM contracts WHERE ${where}`).get(...params).n;

  return { rows, total };
}
