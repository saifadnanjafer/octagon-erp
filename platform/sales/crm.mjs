import crypto from 'node:crypto';

function makeId(prefix = 'lead') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function createLead(db, leadData) {
  const {
    company_id = '*',
    name,
    partner_id = null,
    contact_name = '',
    email = '',
    phone = '',
    expected_revenue = 0.0,
    probability = 10.0,
    salesperson_id = null,
  } = leadData;

  if (!name) throw new Error('Lead name is required');
  const id = makeId('lead');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO crm_leads (
      id, company_id, name, partner_id, contact_name, email, phone, stage, expected_revenue, probability, salesperson_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)
  `).run(id, company_id, name, partner_id, contact_name, email, phone, Number(expected_revenue), Number(probability), salesperson_id, now, now);

  return getLead(db, id);
}

export function getLead(db, id) {
  const lead = db.prepare(`SELECT * FROM crm_leads WHERE id = ?`).get(id);
  if (!lead) return null;
  const activities = db.prepare(`SELECT * FROM crm_activities WHERE lead_id = ?`).all(id);
  return { ...lead, activities };
}

export function updateLeadStage(db, { id, stage }) {
  const validStages = ['new', 'qualified', 'proposition', 'won', 'lost'];
  if (!validStages.includes(stage)) throw new Error(`Invalid lead stage: ${stage}`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE crm_leads SET stage = ?, updated_at = ? WHERE id = ?`).run(stage, now, id);
  return getLead(db, id);
}
