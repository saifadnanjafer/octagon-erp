import crypto from 'node:crypto';

function makeId(prefix = 'party') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createParty(db, partyData) {
  const {
    id: inputId,
    company_id = '*',
    is_company = 0,
    name,
    legal_name = '',
    tax_id = '',
    registration_number = '',
    phone = '',
    email = '',
    payment_terms = '',
    currency = 'IQD',
    roles = ['customer'],
    contacts = [],
    addresses = [],
  } = partyData;

  if (!name || !String(name).trim()) throw new Error('Party name is required');

  // Duplicate identifier validation check
  if (tax_id && String(tax_id).trim()) {
    const dupTax = db.prepare(`SELECT id, name FROM parties WHERE tax_id = ? AND company_id = ? AND status = 'active'`).get(String(tax_id).trim(), company_id);
    if (dupTax && dupTax.id !== inputId) {
      throw new Error(`DUPLICATE_IDENTIFIER: Tax ID ${tax_id} already registered for party '${dupTax.name}'`);
    }
  }
  if (registration_number && String(registration_number).trim()) {
    const dupReg = db.prepare(`SELECT id, name FROM parties WHERE registration_number = ? AND company_id = ? AND status = 'active'`).get(String(registration_number).trim(), company_id);
    if (dupReg && dupReg.id !== inputId) {
      throw new Error(`DUPLICATE_IDENTIFIER: Registration number ${registration_number} already registered for party '${dupReg.name}'`);
    }
  }

  const partyId = inputId || makeId('party');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO parties (id, company_id, is_company, name, legal_name, tax_id, registration_number, phone, email, payment_terms, currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(partyId, company_id, is_company ? 1 : 0, String(name).trim(), legal_name || '', tax_id || '', registration_number || '', phone || '', email || '', payment_terms || '', currency || 'IQD', now, now);

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO party_roles (id, party_id, role, company_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const role of roles) {
    insertRole.run(makeId('prole'), partyId, role, company_id, now);
  }

  const insertContact = db.prepare(`
    INSERT INTO contacts (id, party_id, name, email, phone, job_title, is_primary, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const c of contacts) {
    insertContact.run(makeId('cnt'), partyId, c.name, c.email || '', c.phone || '', c.job_title || '', c.is_primary ? 1 : 0, now);
  }

  const insertAddress = db.prepare(`
    INSERT INTO addresses (id, party_id, type, street, city, state, country, postal_code, is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const a of addresses) {
    insertAddress.run(makeId('addr'), partyId, a.type || 'billing', a.street || '', a.city || '', a.state || '', a.country || '', a.postal_code || '', a.is_default ? 1 : 0, now);
  }

  return getParty(db, { id: partyId, company_id });
}

export function updateParty(db, partyData) {
  const { id, company_id = '*' } = partyData;
  if (!id) throw new Error('Party ID is required');
  const party = db.prepare(`SELECT * FROM parties WHERE id = ?`).get(id);
  if (!party) throw new Error(`Party not found: ${id}`);
  const now = new Date().toISOString();

  const name = partyData.name !== undefined ? String(partyData.name).trim() : party.name;
  const legal_name = partyData.legal_name !== undefined ? partyData.legal_name : party.legal_name;
  const tax_id = partyData.tax_id !== undefined ? partyData.tax_id : party.tax_id;
  const registration_number = partyData.registration_number !== undefined ? partyData.registration_number : party.registration_number;
  const phone = partyData.phone !== undefined ? partyData.phone : party.phone;
  const email = partyData.email !== undefined ? partyData.email : party.email;
  const payment_terms = partyData.payment_terms !== undefined ? partyData.payment_terms : party.payment_terms;
  const currency = partyData.currency !== undefined ? partyData.currency : party.currency;
  const status = partyData.status !== undefined ? partyData.status : party.status;
  const is_company = partyData.is_company !== undefined ? (partyData.is_company ? 1 : 0) : party.is_company;

  if (tax_id && tax_id !== party.tax_id && String(tax_id).trim()) {
    const dupTax = db.prepare(`SELECT id, name FROM parties WHERE tax_id = ? AND company_id = ? AND id != ? AND status = 'active'`).get(String(tax_id).trim(), party.company_id, id);
    if (dupTax) {
      throw new Error(`DUPLICATE_IDENTIFIER: Tax ID ${tax_id} already registered for party '${dupTax.name}'`);
    }
  }

  db.prepare(`
    UPDATE parties SET name = ?, legal_name = ?, tax_id = ?, registration_number = ?, phone = ?, email = ?, payment_terms = ?, currency = ?, is_company = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(name, legal_name, tax_id, registration_number, phone, email, payment_terms, currency, is_company, status, now, id);

  if (Array.isArray(partyData.roles)) {
    db.prepare(`DELETE FROM party_roles WHERE party_id = ?`).run(id);
    const insertRole = db.prepare(`INSERT OR IGNORE INTO party_roles (id, party_id, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`);
    for (const r of partyData.roles) {
      insertRole.run(makeId('prole'), id, r, party.company_id, now);
    }
  }

  return getParty(db, { id, company_id: party.company_id });
}

export function archiveParty(db, { id }) {
  return updateParty(db, { id, status: 'archived' });
}

export function restoreParty(db, { id }) {
  return updateParty(db, { id, status: 'active' });
}

export function addPartyRole(db, { party_id, role }) {
  if (!party_id || !role) throw new Error('Party ID and role are required');
  const party = db.prepare(`SELECT * FROM parties WHERE id = ?`).get(party_id);
  if (!party) throw new Error(`Party not found: ${party_id}`);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO party_roles (id, party_id, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(makeId('prole'), party_id, role, party.company_id, now);
  return getParty(db, { id: party_id, company_id: party.company_id });
}

export function removePartyRole(db, { party_id, role }) {
  if (!party_id || !role) throw new Error('Party ID and role are required');
  db.prepare(`DELETE FROM party_roles WHERE party_id = ? AND role = ?`).run(party_id, role);
  return getParty(db, { id: party_id });
}

export function createPartyContact(db, { party_id, name, email = '', phone = '', job_title = '', is_primary = 0 }) {
  if (!party_id || !name) throw new Error('Party ID and contact name are required');
  const now = new Date().toISOString();
  const id = makeId('cnt');
  db.prepare(`
    INSERT INTO contacts (id, party_id, name, email, phone, job_title, is_primary, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, party_id, String(name).trim(), email || '', phone || '', job_title || '', is_primary ? 1 : 0, now);
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
}

export function updatePartyContact(db, { id, name, email, phone, job_title, is_primary, is_active }) {
  if (!id) throw new Error('Contact ID is required');
  const cnt = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
  if (!cnt) throw new Error(`Contact not found: ${id}`);

  const nextName = name !== undefined ? String(name).trim() : cnt.name;
  const nextEmail = email !== undefined ? email : cnt.email;
  const nextPhone = phone !== undefined ? phone : cnt.phone;
  const nextJob = job_title !== undefined ? job_title : cnt.job_title;
  const nextPrim = is_primary !== undefined ? (is_primary ? 1 : 0) : cnt.is_primary;
  const nextAct = is_active !== undefined ? (is_active ? 1 : 0) : (cnt.is_active ?? 1);

  db.prepare(`
    UPDATE contacts SET name = ?, email = ?, phone = ?, job_title = ?, is_primary = ?, is_active = ? WHERE id = ?
  `).run(nextName, nextEmail, nextPhone, nextJob, nextPrim, nextAct, id);
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
}

export function archivePartyContact(db, { id }) {
  return updatePartyContact(db, { id, is_active: 0 });
}

export function createPartyAddress(db, { party_id, type = 'billing', street = '', city = '', state = '', country = '', postal_code = '', is_default = 0 }) {
  if (!party_id) throw new Error('Party ID is required');
  const now = new Date().toISOString();
  const id = makeId('addr');
  db.prepare(`
    INSERT INTO addresses (id, party_id, type, street, city, state, country, postal_code, is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, party_id, type || 'billing', street || '', city || '', state || '', country || '', postal_code || '', is_default ? 1 : 0, now);
  return db.prepare(`SELECT * FROM addresses WHERE id = ?`).get(id);
}

export function updatePartyAddress(db, { id, type, street, city, state, country, postal_code, is_default, is_active }) {
  if (!id) throw new Error('Address ID is required');
  const addr = db.prepare(`SELECT * FROM addresses WHERE id = ?`).get(id);
  if (!addr) throw new Error(`Address not found: ${id}`);

  const nextType = type !== undefined ? type : addr.type;
  const nextStreet = street !== undefined ? street : addr.street;
  const nextCity = city !== undefined ? city : addr.city;
  const nextState = state !== undefined ? state : addr.state;
  const nextCountry = country !== undefined ? country : addr.country;
  const nextPostal = postal_code !== undefined ? postal_code : addr.postal_code;
  const nextDef = is_default !== undefined ? (is_default ? 1 : 0) : addr.is_default;
  const nextAct = is_active !== undefined ? (is_active ? 1 : 0) : (addr.is_active ?? 1);

  db.prepare(`
    UPDATE addresses SET type = ?, street = ?, city = ?, state = ?, country = ?, postal_code = ?, is_default = ?, is_active = ? WHERE id = ?
  `).run(nextType, nextStreet, nextCity, nextState, nextCountry, nextPostal, nextDef, nextAct, id);
  return db.prepare(`SELECT * FROM addresses WHERE id = ?`).get(id);
}

export function archivePartyAddress(db, { id }) {
  return updatePartyAddress(db, { id, is_active: 0 });
}

export function getParties(db, { company_id = '*', role = null, search = null, include_archived = false } = {}) {
  let sql = `
    SELECT DISTINCT p.* FROM parties p
    LEFT JOIN party_roles r ON p.id = r.party_id
    WHERE (p.company_id = ? OR p.company_id = '*')
  `;
  const params = [company_id];

  if (!include_archived) {
    sql += ` AND p.status = 'active'`;
  }
  if (role) {
    if (role === 'dual') {
      sql += ` AND p.id IN (SELECT party_id FROM party_roles WHERE role = 'customer') AND p.id IN (SELECT party_id FROM party_roles WHERE role = 'supplier')`;
    } else {
      sql += ` AND r.role = ?`;
      params.push(role);
    }
  }
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.tax_id LIKE ? OR p.registration_number LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY p.name ASC`;

  const rows = db.prepare(sql).all(...params);
  return rows.map(p => {
    const rolesRows = db.prepare(`SELECT role FROM party_roles WHERE party_id = ?`).all(p.id);
    const contacts = db.prepare(`SELECT * FROM contacts WHERE party_id = ? AND is_active = 1`).all(p.id);
    const addresses = db.prepare(`SELECT * FROM addresses WHERE party_id = ? AND is_active = 1`).all(p.id);
    return { ...p, roles: rolesRows.map(r => r.role), contacts, addresses };
  });
}

export function getParty(db, { id, company_id = '*' }) {
  const party = db.prepare(`
    SELECT * FROM parties WHERE id = ? AND (company_id = ? OR company_id = '*')
  `).get(id, company_id);

  if (!party) return null;

  const roles = db.prepare(`SELECT role FROM party_roles WHERE party_id = ?`).all(id).map(r => r.role);
  const contacts = db.prepare(`SELECT * FROM contacts WHERE party_id = ? AND (is_active = 1 OR is_active IS NULL)`).all(id);
  const addresses = db.prepare(`SELECT * FROM addresses WHERE party_id = ? AND (is_active = 1 OR is_active IS NULL)`).all(id);

  return { ...party, roles, contacts, addresses };
}
