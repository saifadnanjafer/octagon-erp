// platform/domains/ai_copilot/service.mjs — AI Copilot & JARVIS Governance Domain Service.

import crypto from 'node:crypto';

function uid(prefix = 'ai') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

export function registerAgent(db, {
  company_id,
  agent_name,
  model_name = 'claude-3-5-sonnet',
  system_prompt,
  temperature = 0.2
}) {
  if (!company_id || !agent_name || !system_prompt) {
    throw new Error('company_id, agent_name, and system_prompt are required');
  }

  const id = uid('agt');
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_agents WHERE company_id = ?').get(company_id).c + 1;
  const agent_number = `AGT-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO ai_agents (id, company_id, agent_number, agent_name, model_name, system_prompt, temperature)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, agent_number, agent_name, model_name, system_prompt, temperature);

  return db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id);
}

export function startSession(db, {
  company_id,
  agent_id,
  user_id,
  session_title,
  domain_scope = 'general'
}) {
  if (!company_id || !agent_id || !user_id || !session_title) {
    throw new Error('company_id, agent_id, user_id, and session_title are required');
  }

  const id = uid('ses');
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_sessions WHERE company_id = ?').get(company_id).c + 1;
  const session_number = `SES-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO ai_sessions (id, company_id, session_number, agent_id, user_id, session_title, domain_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, session_number, agent_id, user_id, session_title, domain_scope);

  return db.prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id);
}

export function recordMessage(db, {
  company_id,
  session_id,
  sender_type,
  content,
  prompt_tokens = 0,
  completion_tokens = 0
}) {
  if (!company_id || !session_id || !sender_type || !content) {
    throw new Error('company_id, session_id, sender_type, and content are required');
  }

  const id = uid('msg');
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_messages WHERE session_id = ?').get(session_id).c + 1;
  const message_number = `MSG-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO ai_messages (id, company_id, session_id, message_number, sender_type, content, prompt_tokens, completion_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, session_id, message_number, sender_type, content, prompt_tokens, completion_tokens);

  return db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(id);
}

export function auditToolCall(db, {
  company_id,
  message_id,
  tool_name,
  parameters,
  approval_status = 'pre_approved',
  execution_status = 'success',
  execution_result = null,
  error_message = null
}) {
  if (!company_id || !message_id || !tool_name || !parameters) {
    throw new Error('company_id, message_id, tool_name, and parameters are required');
  }

  const id = uid('tc');
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_tool_call_audits WHERE company_id = ?').get(company_id).c + 1;
  const audit_number = `TC-2026-${String(count).padStart(4, '0')}`;
  const parameters_json = typeof parameters === 'string' ? parameters : JSON.stringify(parameters);
  const execution_result_json = execution_result ? (typeof execution_result === 'string' ? execution_result : JSON.stringify(execution_result)) : null;

  db.prepare(`
    INSERT INTO ai_tool_call_audits (id, company_id, message_id, audit_number, tool_name, parameters_json, approval_status, execution_status, execution_result_json, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, message_id, audit_number, tool_name, parameters_json, approval_status, execution_status, execution_result_json, error_message);

  return db.prepare('SELECT * FROM ai_tool_call_audits WHERE id = ?').get(id);
}

export function configureGuardrailRule(db, {
  company_id,
  rule_name,
  category,
  action_on_violation = 'block'
}) {
  if (!company_id || !rule_name || !category) {
    throw new Error('company_id, rule_name, and category are required');
  }

  const id = uid('grd');
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_guardrail_rules WHERE company_id = ?').get(company_id).c + 1;
  const rule_number = `GRD-2026-${String(count).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO ai_guardrail_rules (id, company_id, rule_number, rule_name, category, action_on_violation, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(id, company_id, rule_number, rule_name, category, action_on_violation);

  return db.prepare('SELECT * FROM ai_guardrail_rules WHERE id = ?').get(id);
}
