// database/migrations/082_ai_copilot_and_jarvis_governance.mjs — AI Copilot & JARVIS Governance Foundation Migration.

export const migration = {
  id: '082_ai_copilot_and_jarvis_governance',
  description: 'Migration 082: AI Copilot & JARVIS Governance Foundation (AI Agents, Sessions, Messages, Tool Call Audits, Guardrail Rules)',

  async up(db) {
    // 1. Registered AI Agents
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_agents (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        agent_number TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        model_name TEXT NOT NULL DEFAULT 'claude-3-5-sonnet',
        system_prompt TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.2,
        status TEXT NOT NULL DEFAULT 'active', -- active, disabled
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_ai_agents_company
      ON ai_agents(company_id, agent_name)
    `).run();

    // 2. AI Sessions
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        session_number TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        session_title TEXT NOT NULL,
        domain_scope TEXT NOT NULL DEFAULT 'general', -- general, sales, finance, inventory, HR
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_ai_sessions_user
      ON ai_sessions(company_id, user_id)
    `).run();

    // 3. AI Messages
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
        message_number TEXT NOT NULL,
        sender_type TEXT NOT NULL, -- user, assistant, system
        content TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session
      ON ai_messages(session_id, created_at)
    `).run();

    // 4. AI Tool Call Audits (Governed action executions)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_tool_call_audits (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
        audit_number TEXT NOT NULL,
        tool_name TEXT NOT NULL, -- e.g. sales:create-order, finance:post-journal
        parameters_json TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'pre_approved', -- pre_approved, user_approved, rejected
        execution_status TEXT NOT NULL DEFAULT 'success', -- success, failed, blocked
        execution_result_json TEXT,
        error_message TEXT,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_ai_tool_audits_tool
      ON ai_tool_call_audits(company_id, tool_name, approval_status)
    `).run();

    // 5. AI Guardrail Rules
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_guardrail_rules (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        rule_number TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        category TEXT NOT NULL, -- pii_redaction, permission_check, prompt_injection_shield, spending_limit
        action_on_violation TEXT NOT NULL DEFAULT 'block', -- block, redact, flag
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  },

  async down(db) {
    const tables = [
      'ai_guardrail_rules',
      'ai_tool_call_audits',
      'ai_messages',
      'ai_sessions',
      'ai_agents'
    ];
    for (const table of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }
};
