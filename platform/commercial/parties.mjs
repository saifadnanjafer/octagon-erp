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
    roles = ['customer'],
    contacts = [],
    addresses = [],
  } = partyData;

  if (!name) throw new Error('Party name is required');

  const partyId = inputId || makeId('party');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO parties (id, company_id, is_company, name, legal_name, tax_id, registration_number, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(partyId, company_id, is_company ? 1 : 0, name, legal_name, tax_id, registration_number, now, now);

  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO party_roles (id, party_id, role, company_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const role of roles) {
    insertRole.run(makeId('prole'), partyId, role, company_id, now);
  }

  const insertContact = db.prepare(`
    INSERT INTO contacts (id, party_id, name, email, phone, job_title, is_primary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of contacts) {
    insertContact.run(makeId('cnt'), partyId, c.name, c.email || '', c.phone || '', c.job_title || '', c.is_primary ? 1 : 0, now);
  }

  const insertAddress = db.prepare(`
    INSERT INTO addresses (id, party_id, type, street, city, state, country, postal_code, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const a of addresses) {
    insertAddress.run(makeId('addr'), partyId, a.type || 'billing', a.street || '', a.city || '', a.state || '', a.country || '', a.postal_code || '', a.is_default ? 1 : 0, now);
  }

  return getParty(db, { id: partyId, company_id });
}

export function getParties(db, { company_id = '*', role = null, search = null }) {
  let sql = `
    SELECT DISTINCT p.* FROM parties p
    LEFT JOIN party_roles r ON p.id = r.party_id
    WHERE p.company_id = ?
  `;
  const params = [company_id];

  if (role) {
    sql += ` AND r.role = ?`;
    params.push(role);
  }
  if (search) {
    sql += ` AND (p.name LIKE ? OR p.tax_id LIKE ? OR p.registration_number LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY p.name ASC`;

  const rows = db.prepare(sql).all(...params);
  return rows.map(p => {
    const rolesRows = db.prepare(`SELECT role FROM party_roles WHERE party_id = ?`).all(p.id);
    return { ...p, roles: rolesRows.map(r => r.role) };
  });
}

export function getParty(db, { id, company_id = '*' }) {
  const party = db.prepare(`
    SELECT * FROM parties WHERE id = ? AND company_id = ?
  `).get(id, company_id);

  if (!party) return null;

  const roles = db.prepare(`SELECT role FROM party_roles WHERE party_id = ?`).all(id).map(r => r.role);
  const contacts = db.prepare(`SELECT * FROM contacts WHERE party_id = ?`).all(id);
  const addresses = db.prepare(`SELECT * FROM addresses WHERE party_id = ?`).all(id);

  return { ...party, roles, contacts, addresses };
}
