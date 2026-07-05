# TASK: Omni Jarvis Security Hardening Sprint

You are working inside the Octagon / Omni ERP codebase.

Goal:
Secure Omni/Jarvis before adding new AI features.

This is NOT a feature sprint.
This is a security and architecture hardening sprint.

IMPORTANT RULES:
- Do not rewrite the whole system.
- Do not break the existing chat/voice UI.
- Keep current behavior working as much as possible.
- Make small, traceable commits/changes.
- Before editing, inspect the relevant files.
- After editing, run smoke tests.
- Produce a final Markdown report.

Primary findings from the audit:
1. Jarvis is a real but thin LLM-as-controller agent.
2. The governance/approval/audit layer exists and is the strongest part.
3. The biggest risk is that enforcement is client-side only.
4. Dangerous tools can be bypassed from browser JS:
   window.JarvisBrain.tools.<tool>.run(...)
5. API keys are hardcoded in client-side files:
   - octagon-erp/modules/ai-providers.js
   - octagon-erp/app.js
   - ContactBox integration
   - Gemini key repeated multiple times
6. Knowledge Base is not grounded yet.
7. Snapshot is shallow.

Your task is to fix the first two critical problems only:
A) Server-side enforcement for gated/dangerous Jarvis tools.
B) Remove hardcoded API keys from client code and route AI calls through server-side proxy/env config.

Do NOT implement KB RAG yet.
Do NOT implement durable memory yet.
Do NOT enrich snapshot yet except if necessary for security.

---

# PART 1 — Inspect Current System

Inspect these files first:

- server.js
- octagon-erp/omni-ai-assistant.js
- octagon-erp/modules/jarvis-brain.js
- octagon-erp/modules/ai-governance.js
- octagon-erp/modules/ai-providers.js
- octagon-erp/jarvis-voice-runtime.js
- octagon-erp/modules/jarvis-action-agent.js
- octagon-erp/app.js
- any DB/helper files used by actions/tools

Find:
- How tools are registered
- Which tools write DB
- Which tools are gated
- Which tools are approval-required
- How approval queue is stored
- How audit log is stored
- How AI providers are called
- Where API keys are hardcoded

---

# PART 2 — Create Server-Side Jarvis Action Endpoint

Create a server-side route, for example:

POST /api/jarvis/action

The client must send:
{
  "tool": "tool_name",
  "args": {},
  "requestId": "...optional..."
}

The server must:
1. Identify current user/session if auth exists.
2. Load tool metadata.
3. Run permission check server-side.
4. Run gateTool() or equivalent server-side.
5. If action is safe:
   - execute server-side
   - write audit log
   - return result
6. If action is dangerous/gated:
   - create approval request server-side
   - do NOT execute immediately
   - return approval_required response
7. If action is denied:
   - return denied response
   - write audit log
8. Never trust client-side risk flags.

If current project has no real auth/session:
- Implement a minimal server-side placeholder currentUser resolver.
- Clearly mark it as temporary.
- Do not pretend it is production-grade.

---

# PART 3 — Approval Execution Must Re-Validate

Create or update the server-side approval execution flow.

When an approved action is executed:
1. Re-load the pending action from server-side storage.
2. Re-check user permission.
3. Re-check gate policy.
4. Execute only if still allowed.
5. Write audit log before/after execution.
6. Mark approval as executed.
7. Prevent double execution.

Acceptance:
- Approval approval alone is not enough.
- Execution must revalidate permissions and policy.

---

# PART 4 — Prevent Client-Side Tool Bypass

Modify frontend Jarvis code so the browser no longer directly executes dangerous DB-writing tools.

Required:
- Existing UI can still call Jarvis.
- Safe UI actions can still work if they are genuinely UI-only.
- DB-writing/money/HR/customer/task creation tools must go through server endpoint.
- Do not expose raw tool runners globally for dangerous tools.

If window.JarvisBrain.tools must remain for compatibility:
- Dangerous tools exposed there must become wrappers that call /api/jarvis/action.
- They must not directly mutate DB/client state.
- Add a warning/comment explaining this.

Search for direct calls to:
- .run(...)
- create_journal_entry
- edit salary/payroll/finance tools
- create customer
- create task
- delete/update tools
- approval tools

Update them to use the server route when needed.

---

# PART 5 — Move API Keys to Server Environment

Remove hardcoded provider keys from all client JS files.

Search for:
- sk-
- openrouter
- OPENROUTER_API_KEY
- Gemini
- GEMINI_API_KEY
- ContactBox
- apiKey
- Authorization
- Bearer

Create server-side env config:
- OPENROUTER_API_KEY
- GEMINI_API_KEY
- CONTACTBOX_API_KEY
- any other provider key

Add/update .env.example with placeholder names only.
Do NOT put real keys in .env.example.

Create or update server-side AI proxy route, for example:

POST /api/ai/chat

The client sends:
{
  "provider": "openrouter",
  "model": "...",
  "messages": [...],
  "options": {}
}

The server:
1. Reads key from process.env.
2. Calls provider.
3. Returns response.
4. Never returns the API key.
5. Handles missing key gracefully.
6. Applies basic allowlist for provider/model if possible.

Update frontend provider calls to use this proxy.

---

# PART 6 — Key Leak Cleanup

After removing hardcoded keys:
1. Search entire repo again for exposed keys.
2. If any real-looking key remains, remove it.
3. Add notes in final report that all previously exposed keys must be rotated manually outside code.

Use commands like:
- grep -R "sk-" .
- grep -R "AIza" .
- grep -R "Bearer" .
- grep -R "apiKey" .

Do not print real keys in the final report.
If found, redact them like:
sk-REDACTED
AIza-REDACTED

---

# PART 7 — Audit Logging

Make sure every server-side Jarvis action writes audit entries for:
- requested
- approved queued
- denied
- executed
- failed

Audit entry should include:
- timestamp
- user id/name if available
- tool name
- risk level
- status
- sanitized args
- result summary
- error summary if failed

Do not log API keys, secrets, full prompts with sensitive data, or passwords.

---

# PART 8 — Smoke Tests

Run or create minimal smoke tests/checks:

1. Safe action still works.
2. Dangerous action returns approval_required instead of executing.
3. Approved action revalidates before execution.
4. Direct client-side dangerous tool cannot bypass gate.
5. AI request works through server proxy.
6. Missing API key returns clean error.
7. No hardcoded keys remain in client files.

If automated tests are not available, create a manual checklist with exact commands and expected outputs.

---

# PART 9 — Final Report

Create:

OMNI_JARVIS_SECURITY_HARDENING_REPORT.md

Include:

## 1. Summary
What was changed and why.

## 2. Files Changed
Table:
| File | Change | Reason |
|---|---|---|

## 3. Server-Side Gate
Explain how dangerous tools are now enforced server-side.

## 4. Approval Revalidation
Explain how approved actions are rechecked before execution.

## 5. API Key Migration
Explain which keys were removed from client code and which env vars are required.

## 6. Remaining Manual Steps
Include:
- Rotate OpenRouter key
- Rotate Gemini key
- Rotate ContactBox key
- Check deployment secrets
- Check browser cache/deployed old JS

## 7. Smoke Test Results
List each test and status.

## 8. Remaining Risks
Be honest. Mention anything still client-side, temporary auth placeholders, or incomplete server enforcement.

## 9. Next Recommended Sprint
After this security hardening, recommend:
1. Enrich snapshot
2. KB RAG grounding
3. Durable memory
4. Post-execution read-back verification
5. DOM reader hardening

Use Arabic for explanations, but keep file names, function names, routes, and code identifiers in English.
