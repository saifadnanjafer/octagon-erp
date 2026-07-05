# OMNI / JARVIS ARCHITECTURE AUDIT

> Read-only audit. No file was modified. Every claim below is traced to a real file/line in `octagon-erp/`.
> Internal identifiers still say `jarvis`; the user-facing name is **Omni**. `window.OmniBrain === window.JarvisBrain`, `window.OmniVoiceRuntime === window.JarvisVoiceRuntime` (compatibility aliases).
> Audit date: 2026-07-05.

---

## 1. Executive Summary

Omni is **a real (lightweight) LLM-as-controller agent**, not just a chatbot — but it is a *thin* agent sitting on top of a very large monolith (`app.js`, ~2.1 MB).

The pattern (documented in `modules/jarvis-brain.js:4-8`) is HuggingGPT/OMNI-style:

```
user words → PLANNER (LLM reads a live snapshot + a tool catalog)
           → strict JSON plan { speak, actions[] }
           → EXECUTOR (safe tools run for real; sensitive ones → approval queue)
           → spoken / written reply
```

Concretely, Omni today can: read live ERP counts and payroll, navigate pages, click on-screen buttons, create tasks/customers immediately, and *propose* (approval-gated) financial/HR/inventory writes. It speaks and listens in Arabic + English, keeps short conversation memory, has a prompt-injection guard, a governance/approval queue, and an append-only audit log. It also degrades gracefully to a deterministic planner when the network/LLM is down.

The weak spots are: the Knowledge Base is **not** auto-grounded into answers (only reachable if the model chooses a search tool), the live "snapshot" is shallow (counts only), all API keys are **hardcoded in client JS**, and the whole safety gate is **client-side only** (no server enforcement).

---

## 2. Current Architecture Layers

| # | Layer | Primary file(s) | Status |
|---|---|---|---|
| 1 | UI / floating assistant shell | `omni-ai-assistant.js` | ✅ Complete |
| 2 | Chat interface + history | `omni-ai-assistant.js` (`state.byPage`, `octagonAIChat`) | ✅ Complete |
| 3 | Orb / command entry | `modules/jarvis-orb.js`, `modules/command-palette.js` | ✅ Complete |
| 4 | Voice layer (STT/TTS/state machine) | `jarvis-voice-runtime.js` (V2) + inline stack in `omni-ai-assistant.js` | ✅ Complete (hybrid) |
| 5 | Intent / planning | `modules/jarvis-brain.js` → `plan()` (LLM) + `localPlan()` (deterministic) | ✅ Complete |
| 6 | ERP snapshot / context | `jarvis-brain.js:308 snapshot()`, `app.js:37221 buildOctagonAiContext()` | 🟡 Partial (counts only) |
| 7 | Knowledge base | `modules/knowledge-base.js` (+ `-seed.js`, `knowledge.js`) | 🟡 Partial (tool-search only, no RAG) |
| 8 | Tool / action registry | `jarvis-brain.js` `TOOLS` + 38 modules injecting `report_*_today` | ✅ Complete |
| 9 | DOM / UI control | `modules/jarvis-action-agent.js`, `modules/jarvis-system-map.js` | ✅ Complete |
| 10 | LLM provider / router | `modules/ai-providers.js` + original caller in `app.js:37188` | ✅ Complete |
| 11 | Permission / safety / governance | `modules/ai-governance.js`, `services/permissionService.js` | ✅ Complete (client-side) |
| 12 | Response / output | `jarvis-brain.js:1727 compose()` + `omni-ai-assistant.js:2323 runOmniTurn()` | ✅ Complete |
| 13 | Read-only business audit | `modules/jarvis-audit.js` | ✅ Complete |
| 14 | Deterministic NL reporting (separate) | `modules/nl-reporting.js` | ✅ Complete (not LLM) |

---

## 3. File Map

| Layer / Feature | File Path | Main Functions / Classes | Status | Notes |
|---|---|---|---|---|
| Assistant shell / chat / voice UI | `omni-ai-assistant.js` (160 KB) | `runOmniTurn()` (2323), `send()` (2444), `sendRecordedVoice()` (2406), `speakJarvis()` (663), `buildJarvisRecognition()` (781), `mount()` (2864), `wrapAiCallerForBudget()` (2714) | ✅ | Single entry point for text/voice/handsfree. Exports `window.octagonAIAssistant` / `OmniAssistant`. |
| Brain / orchestrator | `modules/jarvis-brain.js` (110 KB) | `handle()` (1756), `plan()` (1564), `localPlan()` (1622), `execute()` (1681), `compose()` (1727), `snapshot()` (308), `toolCatalog()` (1443), `buildPlannerPrompt()` (1455), `TOOLS`, `queueApproval()` (655), `gateInfo()` (643) | ✅ | Exports `window.JarvisBrain` / `OmniBrain` incl. `.tools`. `TURN_HISTORY` = memory. |
| LLM router | `modules/ai-providers.js` (22 KB) | `chat()` (223), `callOpenRouter()` (142), `callContactBox()` (183), `cfg()` (81), `ROUTES`, `MODELS` | ✅ | Overrides `window.callOctagonAi`. Exports `window.OctagonAI` / `OmniAI`. |
| Original Gemini caller + legacy context + AI store | `app.js` (2.1 MB) | `callOctagonAi()` (37188), `buildOctagonAiContext()` (37221), `getAiControl()` (30512), `getAiActionRegistry()`, `getAiContextMap()` | ✅ | `omni.aiControl.actionQueue` lives here. `intelligence` page = System Brain. |
| Voice Runtime V2 | `jarvis-voice-runtime.js` (39 KB) | `JARVIS_STATES` machine, `start/stop/holdMic/interrupt/speak/submitUserTurn` | ✅ | Barge-in + echo/self-loop prevention. Exports `JarvisVoiceRuntime` / `OmniVoiceRuntime`. |
| DOM action agent | `modules/jarvis-action-agent.js` (10 KB) | `collectVisibleJarvisActions()`, `executeJarvisAction()`, `highlightJarvisTarget()`, `validateActionSafety()` | ✅ | Read-only DOM queries + visual highlight overlay. |
| System map / coverage | `modules/jarvis-system-map.js` (11 KB) | `systemMap` builder, coverage score | 🟡 | Local/deterministic map; informational. |
| Orb UI | `modules/jarvis-orb.js` (9 KB) | `Orb` object, AR/EN chip | ✅ | Living ball; drives `toggleAIChat()`. |
| Governance core | `modules/ai-governance.js` (60 KB) | `gateTool()` (144), `detectAiPromptInjectionSignals()` (163), `executeApprovedAiAction()` (598), `wireQueueExecution()` (637), `audit()` (71), `TOOL_RISK`, `APPROVAL_REQUIRED`, `GATE_TARGET` | ✅ | Exports `window.OctagonAIGovernance`. Owns `ai_status` page. |
| Read-only business audit | `modules/jarvis-audit.js` (38 KB) | `audit_salary_explain`, `audit_advances`, `audit_fingerprints`, `audit_finance_reconciliation` | ✅ | Registers tools onto `JarvisBrain.tools`. Exports `window.JarvisAudit`. |
| Self-test harness | `modules/jarvis-test-harness.js` (36 KB) | voice/brain/tool regression tests | ✅ | Dev/QA only. |
| Knowledge base page + tools | `modules/knowledge-base.js` (40 KB), `knowledge-base-seed.js` (450 KB), `knowledge.js` (21 KB) | `searchPublished()`, `registerJarvis()` → `search_knowledge_base`, `report_knowledge_base` | 🟡 | Tools exist but planner rarely auto-uses them; **no automatic RAG**. |
| Deterministic NL reporting | `modules/nl-reporting.js` (41 KB) | Arabic/English question → deterministic report | ✅ | Independent of the LLM brain. `omni.nlReports`. |
| Command palette | `modules/command-palette.js` (8 KB) | Ctrl+K overlay → page jump or hand to assistant | ✅ | Additive UX. |
| Workshop AI operating layer | `modules/workshop-ai.js` (71 KB) | briefing / SOP / action queue tools | ✅ | Registers workshop tools onto the brain. |
| Custom OpenAI-compatible API | `custom-api-integration.js`, `custom-api-examples.js` | reads `.env` `CUSTOM_API_*` | 🟡 | Optional/experimental provider path. |
| Per-module report tools (×38) | `modules/{appointments,fleet,helpdesk,...}.js` | `JarvisBrain.tools.report_*_today = {...}` | ✅ | Extensible tool registry pattern. |

---

## 4. Entry Points

How a user reaches Omni (all converge on one pipeline):

1. **Floating button `#ptxAIButton`** — created by `mount()` in `omni-ai-assistant.js:2864`; click → `toggle()` → panel open. Launcher bootstrapped by `ensureAIChatLauncher()` / `loadOctagonAIAssistant()` in `index.html:1934-1969`.
2. **Voice orb** — `modules/jarvis-orb.js`; press wakes the orb and calls `window.toggleAIChat()` (`index.html:1949`) / `window.JarvisVoiceRuntime.start()`.
3. **Command palette** — `Ctrl/Cmd+K` (`modules/command-palette.js`) → jump to page or hand the typed question to `ptxAIAssistant`.
4. **Text send** — `send()` (`omni-ai-assistant.js:2444`) reads `#ptxAIInput` → `runOmniTurn(text,{channel:'text'})`.
5. **Recorded voice note** — `send(audio)` → `sendRecordedVoice()` (2406): Gemini transcribes first, then the transcript runs through the **same** `runOmniTurn`.
6. **Hands-free speech** — `JarvisVoiceRuntime` (V2) → `submitUserTurn()` → `runOmniTurn(...,{channel:'handsfree', spoken:true})`.
7. **System Brain page** (`intelligence`) — `index.html:1317` nav button → `app.js:submitAiSystemCommand()` (37256) — a legacy grounded-Q&A console.
8. **Programmatic** — any module can call `window.JarvisBrain.handle(text, opts)` directly.

---

## 5. Data Flow

```
[User: text | voice note | hands-free | palette | orb]
        │
        ▼
omni-ai-assistant.js  send() / sendRecordedVoice()  ──(voice note: Gemini transcribe first)
        │
        ▼
runOmniTurn(text, opts)                        (2323) — one pipeline for every channel
        │
        ▼
window.JarvisBrain.handle(text, {page, channel})           (jarvis-brain.js:1756)
        │
        ├─ 1. PROMPT-INJECTION GUARD  detectAiPromptInjectionSignals()  → high risk = refuse
        │
        ├─ 2. DETERMINISTIC-FIRST  localPlan()   (simple navigate / offline → skip the LLM)
        │
        ├─ 3. PLANNER  plan(text)                 (LLM)
        │        buildPlannerPrompt() = persona + rules + TURN_HISTORY
        │                             + PAGE keys + live UI buttons + toolCatalog() + snapshot()
        │        caller → window.callOctagonAi = OctagonAI.chat (ai-providers.js)
        │            router: OpenRouter(DeepSeek) → ContactBox(Claude) → Gemini fallback
        │        → strict JSON { speak, actions[], clarify }
        │
        ├─ 4. EXECUTOR  execute(plan)             (1681)
        │        for each action: gateInfo()/gateTool()
        │            • safe   → run immediately (real mutation of the live `omni` store)
        │            • gated  → queueApproval() → omni.aiControl.actionQueue (NOT executed)
        │        every step → audit('ai.tool.executed' | 'ai.tool.blocked')
        │
        ├─ 5. compose(plan, results)  →  final text
        └─ 6. rememberTurn()          →  TURN_HISTORY (rolling 6)
        │
        ▼
render() chat bubble  +  (if voice/handsfree) speakJarvis(answer)

── Approval sub-flow (deferred execution) ─────────────────────────
omni.aiControl.actionQueue  →  page ai_queue  →  waiQueueApprove(id)
        → wireQueueExecution wrapper → executeApprovedAiAction(id)
        → re-validate permission AT EXECUTION TIME → run window.JarvisBrain.tools[tool]
```

**Exists:** every box above is implemented and wired.
**Missing / thin:** step 3's context is counts-only (no record-level data, no KB text); there is no server-side re-check of the gate; no vector retrieval anywhere in the flow.

---

## 6. Tools and Actions

Built-in tools in `modules/jarvis-brain.js` `TOOLS` (risk from the tool + `ai-governance.js` `TOOL_RISK`/`APPROVAL_REQUIRED`):

| Tool / Action | Description | File Path | Reads DB? | Writes DB? | UI Action? | Safe? |
|---|---|---|---|---|---|---|
| `navigate` | Switch ERP page | jarvis-brain.js:708(reg. ~709) | ✅ | ❌ | ✅ nav | ✅ safe |
| `click_ui` | Click a visible button by id/label | jarvis-brain.js | ✅ | (via UI) | ✅ click | ✅ safe |
| `lookup_employee_payroll` | Read-only payroll/attendance for a person/month | jarvis-brain.js | ✅ | ❌ | ❌ | ✅ safe |
| `create_task` | Create a task | jarvis-brain.js | ✅ | ✅ task | ✅ | ✅ safe (+followup) |
| `create_customer` | Create a contact record | jarvis-brain.js | ✅ | ✅ contact | ❌ | ✅ safe |
| `report_low_stock` | Low-stock list | jarvis-brain.js | ✅ | ❌ | ❌ | ✅ safe |
| `report_overdue_tasks` | Overdue tasks | jarvis-brain.js | ✅ | ❌ | ❌ | ✅ safe |
| `report_maintenance` | Machines in maintenance | jarvis-brain.js | ✅ | ❌ | ❌ | ✅ safe |
| `report_attention` | Top attention items | jarvis-brain.js | ✅ | ❌ | ❌ | ✅ safe |
| `set_language` | Switch AR/EN | jarvis-brain.js | ❌ | ⚙️ pref | ✅ | ✅ safe |
| `propose_purchase` | Draft purchase → queue | jarvis-brain.js | ✅ | ⏸ queue | ❌ | 🟡 sensitive |
| `propose_finance_review` | Draft finance review → queue | jarvis-brain.js | ✅ | ⏸ queue | ❌ | 🟡 sensitive |
| `propose_payroll_review` | Draft payroll review → queue | jarvis-brain.js | ✅ | ⏸ queue | ❌ | 🟡 sensitive |
| `propose_whatsapp_reply` | Draft WhatsApp reply → queue | jarvis-brain.js | ✅ | ⏸ queue | ❌ | 🟡 sensitive |
| `add_customer_debt` | Charge/settle customer balance | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `create_sales_receipt` | Post a real sale/receivable | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `record_customer_payment` | Settle a balance / move money | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `create_purchase_expense` | Spend money | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `create_journal_entry` | Post double-entry accounting | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `modify_material` | Mutate inventory item | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `modify_employee` | Mutate employee/payroll data | jarvis-brain.js | ✅ | 🔒 **gated** | ❌ | 🔴 high |
| `execute_js_mutation` | Arbitrary JS on live data | jarvis-brain.js | ✅ | 🔒 **critical, gated** | ❌ | 🔴 critical |
| `audit_salary_explain` / `audit_advances` / `audit_fingerprints` / `audit_finance_reconciliation` | Read-only business audit | jarvis-audit.js:525+ | ✅ | ❌ | ❌ | ✅ safe |
| `search_knowledge_base` / `report_knowledge_base` | Search/summarize KB | knowledge-base.js:945/929 | ✅ (KB) | ❌ | ❌ | ✅ safe |
| `report_*_today` (×38 modules) | Per-module daily snapshots (fleet, helpdesk, appointments, loyalty, projects, HR, …) | `modules/*.js` (e.g. fleet.js:808, appointments.js:437) | ✅ | ❌ | ❌ | ✅ safe |

Legend: ✅ yes · ❌ no · ⏸ queued only · 🔒 approval-gated (never runs inline) · ⚙️ preference.

**Total surface:** ~22 built-in + 4 audit + 2 KB + 38 module report tools ≈ **60+ tools**. All write/financial/HR tools are gated; only the deferred `executeApprovedAiAction()` path actually mutates protected data.

---

## 7. Database and Knowledge Base

Client-side store is the bare global `omni` (in `app.js`, mirrored to `window.omni`); server truth is `database.db` (SQLite) + `database.json` fallback (per project memory).

| Data structure | Where | Purpose | Connected to Omni? |
|---|---|---|---|
| `octagonAIChat` (localStorage) | `omni-ai-assistant.js` `state.byPage` | Per-page chat history | ✅ read/write by the assistant |
| `TURN_HISTORY` (in-memory array, ≤6) | `jarvis-brain.js:1744` | Short conversation memory fed to planner | ✅ but **volatile** (lost on reload) |
| `omni.aiControl.actionQueue` | `app.js:getAiControl()` (30512) | Approval queue (pending AI actions) | ✅ core to the gate |
| `omni.aiAuditLog` (≤4000) | `ai-governance.js:66 normalizeAiAuditLog()` | Append-only AI audit trail, keys scrubbed | ✅ written by `audit()` |
| `omni.aiToolRegistry` | `ai-governance.js:281` | Tool Registry v2 (risk/scopes/approval) | 🟡 metadata mirror; runtime truth is `JarvisBrain.tools` |
| `omni.aiSystem` | `ai-governance.js:178` | AI manifest (philosophy/providers/gates) | 🟡 informational (ai_status page) |
| `omni.aiProviders` | `ai-governance.js:207` | Provider descriptors (apiKeySource only, never keys) | 🟡 informational |
| `omni.knowledgeBase` `{categories, articles, faqs, drafts, activityLog}` | `knowledge-base.js` (+ 450 KB seed) | In-app KB / FAQ portal | 🟡 **only via `search_knowledge_base` tool** — not auto-grounded |
| `omni.workshopMemory` | `ai-governance.js:653 normalizeWorkshopMemory()` | Workshop long-term notes | 🟡 present, lightly used |
| System prompt | Built at runtime by `buildPlannerPrompt()` (jarvis-brain) + `buildOctagonAiContext()` (app.js) | Not stored in DB | ✅ |
| User permissions | `services/permissionService.js`, `omni.aiControl.permissions` | Approval eligibility | ✅ consulted at queue + execution |

**Connected:** chat, action queue, audit log, live snapshot counts, and (on demand) KB search.
**Not connected:** the KB body text is never injected into the planner context automatically; `jarvisReadable:true` flags on seed articles (`knowledge-base-seed.js`) are read by the **UI filter only**, not by any retrieval pipeline. There is no vector index / embeddings store anywhere.

---

## 8. Voice System

Both a full inline stack (`omni-ai-assistant.js`) and a V2 state-machine runtime (`jarvis-voice-runtime.js`) exist; the assistant **delegates to V2 when present** and falls back to inline (`omni-ai-assistant.js:388, 487, 504, 526, 665, 932`).

- **STT (speech-to-text):** two paths —
  1. Live hands-free: browser `SpeechRecognition` via `buildJarvisRecognition()` (`omni-ai-assistant.js:781`) + V2 machine in `jarvis-voice-runtime.js`.
  2. Recorded voice note: **Gemini** inline-audio transcription (`sendRecordedVoice()` → `callOctagonAi(..., {audio, task:'transcribe'})`; router forces Gemini for audio, `ai-providers.js:248-252`).
- **TTS (text-to-speech):** `speakJarvis()` (`663`) with cloud TTS (`synthesizeCloudTTS()` 582 / `pcmBase64ToWavUrl()` 564) and a browser fallback (`synthesizeBrowserKeyTTS()` 620); voice picked by `pickSpeechVoice()` / `detectSpeechLangCode()`.
- **Language handling (AR/EN):** conversation language is a first-class signal — `window.__jarvisReplyLang` (set by the orb AR/EN chip) overrides UI language end-to-end, so English speech → English thinking + reply (`jarvis-brain.js:21-33`, `ai-providers.js:241`). Arabic voice selection warns once if no Arabic voice installed (`warnMissingArabicVoiceOnce()` 361).
- **Loop/echo protection (real, and needed):** `isJarvisEcho()` (774), `detectWakeWord()` (761), `blockJarvisRestart()` (479), `shouldHoldJarvisMic()` (482), `pauseJarvisListening()` (486), plus the V2 barge-in state machine (`USER_SPEAKING`, interrupt on `user_barge_in`). `speakJarvis()` owns mic resume so the mic never reopens during TTS (`runOmniTurn` finally-block, 2393-2398).
- **Risks:** voice quality depends on the browser's installed voices; Gemini is a hard dependency for voice-note transcription (no audio path through OpenRouter); the anti-loop logic is intricate — a regression here re-introduces the classic self-listening loop.

---

## 9. LLM / API Providers

Router: `modules/ai-providers.js` `chat()` overrides `window.callOctagonAi` / `callPentagonAi`.

**Providers & fallback chain** (`ai-providers.js:254-289`):
`selected provider (OpenRouter | ContactBox)` → on empty/error → **Gemini** (original `app.js` caller) → throw (caller then uses its own deterministic `localPlan`).

**Smart routing by task** (`ROUTES`, 56-63; active only when `autoRoute` and no user-pinned model):
- `fast` / `arabic` / `tools` / `sensitive` → OpenRouter **DeepSeek V3** (`deepseek/deepseek-chat`)
- `reasoning` → ContactBox **Claude Opus** (`claude-opus-4-8`)
- `transcribe` → **Gemini** flash

**Models** (`MODELS`, 28-37): `deepseek`, `deepseek-r1`, `qwen`, `qwen-coder`, `claude-sonnet`(4-6), `claude-opus`(4-8/4-7/4-6). Note (46-48): ContactBox/Claude **must not plan tools** — the proxy injects an agentic wrapper that leaks `<function_calls>`, so Claude is reasoning/audit-prose only.

**Keys — all hardcoded in client JS (security issue):**
- OpenRouter: `ai-providers.js:69` (`sk-or-v1-…`)
- ContactBox: `ai-providers.js:73` (`sk-0e9…`)
- Gemini: `app.js:37185` (`AIzaSy…`, repeated at 3481, 12783, 13003, 13128, 13292)
- Custom OpenAI-compatible provider from `.env` `CUSTOM_API_*` (`custom-api-integration.js`)

Keys are overridable via localStorage `octagonAIProvider` (`cfg()` 81). The file's own header warns to rotate before going online.

**Cost control (present but light):** per-session token/cost budget — `estimateTokens()` (2705), `wrapAiCallerForBudget()` (2714), `clearSessionBudget()` (2760), persisted as `jarvis_session_tokens` / `jarvis_session_cost`. `maxTokens:1400` default. No hard server-side spend cap; the real cap must be set on the OpenRouter dashboard.

---

## 10. Permissions and Safety

Governance lives in `modules/ai-governance.js` and is consulted by the brain on every tool run.

| Dangerous action | Protection | Where |
|---|---|---|
| Delete records / `archive_record` | `APPROVAL_REQUIRED` → queue | ai-governance.js:120-127 |
| Edit salaries / `modify_employee`, `direct_payroll_edit` | `high`/`critical`; `modify_employee` gated; direct edit = `forbidden` | ai-governance.js:109-121, app.js getAiActionRegistry |
| Financial entries / `create_journal_entry`, `add_customer_debt`, `post_finance` | `high`, `APPROVAL_REQUIRED`, target `finance` | ai-governance.js:109-133 |
| Send messages / `send_whatsapp` | `high`, gated (only `propose_whatsapp_reply` drafts allowed inline) | ai-governance.js:111,123 |
| Approve requests | `waiQueueApprove` re-validates permission **at execution time** | ai-governance.js:598-606 |
| Change settings / `admin_settings_change` | `forbidden` (blocked) | app.js getAiActionRegistry |
| Arbitrary code / `execute_js_mutation`, `apply_code_patch` | `critical`, gated | ai-governance.js:114, jarvis-brain.js:755 |
| Prompt injection | `detectAiPromptInjectionSignals()`; `high` risk refused before planner | ai-governance.js:152-174, jarvis-brain.js:1758-1769 |
| Untrusted pasted data | Planner rules mark pasted text as untrusted DATA | jarvis-brain.js:1472/1490 |
| Audit trail | append-only `omni.aiAuditLog`, keys scrubbed | ai-governance.js:53-77 |

**Gate mechanics:** `gateTool()` (144) = `APPROVAL_REQUIRED` list OR tool `.gated` OR risk `high`/`critical`. Gated tools are queued with their payload (`execute()` 1694-1712) and only run through `executeApprovedAiAction()` after a manager approves — with a fresh permission check. Unknown tools default to `medium` (never assumed safe, 140).

**What's missing:**
- **All enforcement is client-side.** A user who can run JS in the page can call `window.JarvisBrain.tools.create_journal_entry.run(...)` directly, bypassing the planner gate. There is no server-side authorization on the mutation itself.
- Hardcoded keys (Section 9) are readable by any user.
- No rate-limiting / abuse ceiling beyond the soft token budget.
- The approval queue trusts the client clock and the client `PentagonAuth` user.

---

## 11. Missing Pieces (to become a real ERP command assistant)

1. **Server-side enforcement of the gate** — mirror `gateTool` + permission checks on the backend (`server.js`) so mutations can't be issued from the console. *(biggest gap)*
2. **Secret management** — move all four keys out of client JS to a server proxy; rotate the leaked ones.
3. **Deeper context / snapshot** — `snapshot()` returns counts only; add record-level, page-scoped context and selection state (the action agent already exposes `jarvisGetSelectedRecordContext()` — feed it into the planner).
4. **Real Knowledge-Base grounding (RAG)** — index `omni.knowledgeBase` articles/FAQs (respecting `jarvisReadable`) and inject top-k matches into `buildPlannerPrompt()`, instead of relying on the model to choose `search_knowledge_base`.
5. **Durable memory** — `TURN_HISTORY` is volatile; persist conversation + a summarized long-term memory (there is already `omni.workshopMemory` to build on).
6. **Unified tool registry** — reconcile the runtime `JarvisBrain.tools` with the descriptive `omni.aiToolRegistry` so risk/scope metadata and executors can't drift.
7. **Verification layer** — after `execute()`, read back the store (or re-query the server) to confirm the action's effect before telling the user "done".
8. **Approval-center UX + notifications** — richer `ai_queue` with diffs, and push to the approver.
9. **KB write/review flow into the loop** — let approved drafts feed retrieval; close the learn-from-usage loop.
10. **Provider hardening** — server-side model router with real spend caps and ret/timeout budgets (currently soft, client-side).

---

## 12. Recommended Next Build Order

1. **Fix critical safety first** — rotate + proxy the API keys; add server-side authorization on every gated tool (`server.js`). Nothing else matters if the gate is bypassable.
2. **Connect context/snapshot** — enrich `snapshot()` with page-scoped, record-level data + selected-record context.
3. **Consolidate the tool registry** — one source of truth (executor + risk + scope); auto-generate the catalog from it.
4. **Safe actions maturity** — expand read/report + draft (`propose_*`) tools; keep all money/HR gated.
5. **DOM reader** — promote `jarvisGetSelectedRecordContext()` / `collectVisibleJarvisActions()` into the planner prompt so click/edit intent is grounded in what's actually on screen.
6. **Approvals** — server-backed queue, diffs, execution-time re-validation (already partly done), approver notifications.
7. **Memory + Knowledge Base** — persist `TURN_HISTORY`, add KB RAG grounding + summarized long-term memory.
8. **Voice polish** — stabilize the AR/EN state machine, reduce Gemini dependence for transcription, regression-guard the anti-loop logic (`jarvis-test-harness.js`).

---

## 13. Final Verdict (الخلاصة النهائية)

**هل Omni Jarvis حالياً وكيل حقيقي (agent) أم مجرد chatbot؟**
هو **وكيل حقيقي لكن خفيف (thin agent)** — وليس مجرد chatbot. النمط واضح في `modules/jarvis-brain.js`: `PLANNER (LLM)` يقرأ `snapshot()` + `toolCatalog()` وينتج خطة JSON، ثم `EXECUTOR` ينفّذ الأدوات الآمنة فعلياً ويحوّل الحسّاسة إلى طابور الموافقة. هذه بنية agent كاملة (تخطيط → تنفيذ → حوكمة → ذاكرة قصيرة → fallback حتمي)، لكنها رقيقة فوق مونوليث ضخم (`app.js`).

**هل يقرأ بيانات الـ ERP؟** نعم — عبر `snapshot()` وأدوات القراءة (`lookup_employee_payroll`, `report_*`, `jarvis-audit.js`). لكن القراءة **سطحية** (أعداد إجمالية فقط في الـ snapshot، لا سجلات مفصّلة).

**هل ينفّذ إجراءات؟** نعم — `navigate`, `click_ui`, `create_task`, `create_customer` تُنفَّذ فوراً؛ وكل ما يمسّ المال/الرواتب/المخزون (`create_journal_entry`, `add_customer_debt`, `modify_employee`, `execute_js_mutation` …) **محكوم بالموافقة** ولا يُنفَّذ إلا بعد اعتماد المدير عبر `executeApprovedAiAction()`.

**هل يتحكّم بالواجهة (UI)؟** نعم — عبر `modules/jarvis-action-agent.js`: تنقّل بين الصفحات، ضغط أزرار مرئية بالاسم/المعرّف، مع تظليل بصري للهدف (`highlightJarvisTarget`). الأوامر المتسلسلة ("افتح X ثم اضغط Y") تُنفَّذ بالترتيب.

**هل يستخدم قاعدة المعرفة؟** جزئياً فقط. توجد أداة `search_knowledge_base`، لكن **لا يوجد RAG تلقائي** — محتوى `omni.knowledgeBase` لا يُحقَن في سياق المخطِّط تلقائياً، وعَلَم `jarvisReadable` يستعمله فلتر الواجهة فقط. هذه أضعف حلقة في السلسلة.

**أقوى جزء (strongest part):** طبقة الحوكمة والأمان — `gateTool()` + `APPROVAL_REQUIRED` + طابور الموافقة مع إعادة التحقق وقت التنفيذ + سجل تدقيق append-only + حارس حقن الأوامر + مخطِّط حتمي احتياطي. بنية أمان ناضجة نسبياً على مستوى العميل.

**أضعف جزء (weakest part):** (1) كل الحوكمة **client-side فقط** — يمكن تجاوز البوابة باستدعاء `window.JarvisBrain.tools.<tool>.run()` مباشرة من الـ console؛ (2) **مفاتيح الـ API كلها مكتوبة داخل كود العميل** (OpenRouter/ContactBox/Gemini)؛ (3) قاعدة المعرفة غير مربوطة كـ RAG؛ (4) الـ snapshot سطحي.

**ما الذي يجب بناؤه تالياً (next):** فرض البوابة على الخادم (`server.js`) + إخراج المفاتيح إلى بروكسي وتدويرها — هذان أولاً؛ ثم إثراء الـ snapshot، ثم ربط قاعدة المعرفة كـ RAG، ثم ذاكرة دائمة، ثم طبقة تحقّق بعد التنفيذ (read-back) تؤكّد أثر الإجراء قبل قول "تم".
