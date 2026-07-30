// tests/module-wave-2/ai_copilot/ai_copilot.test.mjs — Integration tests for W2-M16 AI Copilot & JARVIS Governance.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m082 } from '../../../database/migrations/082_ai_copilot_and_jarvis_governance.mjs';
import * as aiService from '../../../platform/domains/ai_copilot/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-ai-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 082: Up, rerun, and schema verification', async () => {
  const env = await setup('m082-schema');
  try {
    await m082.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ai_agents', 'ai_sessions', 'ai_messages', 'ai_tool_call_audits', 'ai_guardrail_rules')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m082.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. AI Agent Registration & Copilot Chat Session Lifecycle', async () => {
  const env = await setup('agent-session');
  try {
    await m082.up(env.db);

    const agt = aiService.registerAgent(env.db, {
      company_id: 'company-alpha',
      agent_name: 'JARVIS Executive ERP Assistant',
      model_name: 'claude-3-5-sonnet',
      system_prompt: 'You are JARVIS, the chief AI copilot for Octagon ERP. Enforce strict single-write-authority and governed domain actions.',
      temperature: 0.1
    });
    assert.equal(agt.agent_name, 'JARVIS Executive ERP Assistant');
    assert.ok(agt.agent_number.startsWith('AGT-2026-'));

    const ses = aiService.startSession(env.db, {
      company_id: 'company-alpha',
      agent_id: agt.id,
      user_id: 'cfo-user-01',
      session_title: 'Q3 Financial Forecast Analysis',
      domain_scope: 'finance'
    });
    assert.equal(ses.domain_scope, 'finance');
    assert.ok(ses.session_number.startsWith('SES-2026-'));

    const msg1 = aiService.recordMessage(env.db, {
      company_id: 'company-alpha',
      session_id: ses.id,
      sender_type: 'user',
      content: 'Generate Q3 revenue variance forecast for refinery operations',
      prompt_tokens: 15,
      completion_tokens: 0
    });
    assert.equal(msg1.sender_type, 'user');

    const msg2 = aiService.recordMessage(env.db, {
      company_id: 'company-alpha',
      session_id: ses.id,
      sender_type: 'assistant',
      content: 'I have evaluated Q3 revenue against baseline budget BDG-2026-0004. Projected variance is +4.2%.',
      prompt_tokens: 280,
      completion_tokens: 45
    });
    assert.equal(msg2.sender_type, 'assistant');

    const msgs = env.db.prepare('SELECT * FROM ai_messages WHERE session_id = ?').all(ses.id);
    assert.equal(msgs.length, 2);
  } finally {
    cleanup(env);
  }
});

test('3. Governed AI Action Tool Call Audit Logging', async () => {
  const env = await setup('tool-audit-test');
  try {
    await m082.up(env.db);

    const agt = aiService.registerAgent(env.db, {
      company_id: 'company-alpha',
      agent_name: 'JARVIS Action Copilot',
      system_prompt: 'Governed tool execution assistant'
    });

    const ses = aiService.startSession(env.db, {
      company_id: 'company-alpha',
      agent_id: agt.id,
      user_id: 'sales-vp',
      session_title: 'Automated Opportunity Stage Advancement',
      domain_scope: 'sales'
    });

    const msg = aiService.recordMessage(env.db, {
      company_id: 'company-alpha',
      session_id: ses.id,
      sender_type: 'assistant',
      content: 'Invoking CRM action to advance opportunity stage to won.'
    });

    const audit = aiService.auditToolCall(env.db, {
      company_id: 'company-alpha',
      message_id: msg.id,
      tool_name: 'crm:advance-opportunity-stage',
      parameters: { opportunity_id: 'OPP-2026-0012', target_stage: 'won' },
      approval_status: 'user_approved',
      execution_status: 'success',
      execution_result: { updated: true, new_stage: 'won' }
    });
    assert.equal(audit.approval_status, 'user_approved');
    assert.equal(audit.execution_status, 'success');
    assert.ok(audit.audit_number.startsWith('TC-2026-'));
  } finally {
    cleanup(env);
  }
});

test('4. AI Guardrail Safety & Security Policy Configuration', async () => {
  const env = await setup('guardrail-test');
  try {
    await m082.up(env.db);

    const grd1 = aiService.configureGuardrailRule(env.db, {
      company_id: 'company-alpha',
      rule_name: 'PII Redaction Engine',
      category: 'pii_redaction',
      action_on_violation: 'redact'
    });
    assert.equal(grd1.category, 'pii_redaction');

    const grd2 = aiService.configureGuardrailRule(env.db, {
      company_id: 'company-alpha',
      rule_name: 'Prompt Injection Defense Shield',
      category: 'prompt_injection_shield',
      action_on_violation: 'block'
    });
    assert.equal(grd2.action_on_violation, 'block');
    assert.ok(grd2.rule_number.startsWith('GRD-2026-'));
  } finally {
    cleanup(env);
  }
});
