import * as leadService from '../domains/crm/lead-service.mjs';

export function createLead(db, leadData) {
  const company_id = leadData.company_id || '*';
  const actor = leadData.actor || leadData.salesperson_id || 'system';
  const result = leadService.createLead(db, {
    ...leadData,
    company_id,
    actor,
  });
  return getLead(db, result.lead.id);
}

export function getLead(db, id) {
  try {
    const lead = leadService.getLead(db, id);
    const activities = db.prepare(`SELECT * FROM crm_activities WHERE lead_id = ? ORDER BY created_at`).all(id);
    return { ...lead, activities };
  } catch (err) {
    if (err.code === 'LEAD_NOT_FOUND' || err.message?.includes('unknown lead')) return null;
    throw err;
  }
}

export function updateLeadStage(db, { id, stage, company_id = '*', actor = 'system' }) {
  const lead = getLead(db, id);
  if (!lead) throw new Error(`Lead not found: ${id}`);
  
  if (stage === 'qualified') {
    const res = leadService.qualifyLead(db, { lead_id: id, company_id: lead.company_id || company_id, actor });
    return getLead(db, res.lead.id);
  }
  
  if (stage === 'lost' || stage === 'unqualified') {
    const res = leadService.disqualifyLead(db, { lead_id: id, lost_reason_id: 'crm_lost_price', company_id: lead.company_id || company_id, actor });
    return getLead(db, res.lead.id);
  }

  const res = leadService.updateLead(db, { lead_id: id, company_id: lead.company_id || company_id, actor });
  return getLead(db, res.lead.id);
}

