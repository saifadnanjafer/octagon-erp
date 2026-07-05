# TASK: Audit Omni Jarvis / Omni Chatbot Architecture

You are working inside the Octagon / Omni ERP codebase.

Your job is to inspect the repository and explain exactly what the current Omni Jarvis / Omni Chatbot system is composed of.

IMPORTANT RULES:
- Do NOT modify any file.
- Do NOT refactor anything.
- Do NOT create new features.
- Only inspect, trace, and report.
- Separate clearly between:
  1. Actually implemented code
  2. Partially implemented code
  3. Planned ideas / comments / unused placeholders
  4. Dead or disconnected code

Search the whole project for these keywords:
- jarvis
- omni
- chatbot
- chat
- assistant
- agent
- ai
- openrouter
- gemini
- llm
- voice
- speech
- tts
- stt
- knowledge_base
- snapshot
- tools
- dom
- command
- action
- orchestrator
- intent
- memory
- context

Then produce a full Markdown report named:

OMNI_JARVIS_ARCHITECTURE_AUDIT.md

The report must include these sections:

## 1. Executive Summary
Explain in simple terms what Omni Jarvis currently is.

## 2. Current Architecture Layers
List all detected layers, for example:
- UI layer
- Chat interface
- Voice layer
- Intent detection
- ERP snapshot/context layer
- Knowledge base layer
- Tool/action layer
- DOM/UI control layer
- LLM provider/router layer
- Permission/safety layer
- Response/output layer

For each layer, explain:
- What it does
- Which files implement it
- Whether it is complete, partial, or missing

## 3. File Map
Create a table:

| Layer / Feature | File Path | Main Functions / Classes | Status | Notes |
|---|---|---|---|---|

## 4. Entry Points
Find how the user starts or calls Jarvis:
- UI buttons
- pages
- scripts
- event listeners
- API calls
- functions

Show the exact file paths and function names.

## 5. Data Flow
Explain the flow from user message to final answer:

User input → frontend handler → context/snapshot → LLM/tool router → execution → verification → response

Mention what actually exists and what is missing.

## 6. Tools and Actions
List all tools/actions Jarvis can currently perform.

Create a table:

| Tool / Action | Description | File Path | Reads DB? | Writes DB? | UI Action? | Safe? |
|---|---|---|---|---|---|---|

## 7. Database and Knowledge Base
Find any DB tables, JSON files, localStorage, or data structures related to:
- chat history
- memory
- knowledge base
- system prompts
- tools
- user permissions
- AI logs

Explain what is connected and what is not connected.

## 8. Voice System
Inspect if voice input/output exists.

Explain:
- Speech-to-text implementation
- Text-to-speech implementation
- language handling Arabic/English
- current bugs or risks like voice loop

## 9. LLM / API Providers
Find all AI provider integrations:
- OpenRouter
- Gemini
- OpenAI
- local fallback
- mock mode

Explain:
- where API keys are expected
- model names
- fallback behavior
- cost-control mechanisms if any

## 10. Permissions and Safety
Check whether Jarvis has protection for dangerous actions:
- delete records
- edit salaries
- edit financial entries
- send messages
- approve requests
- change settings

State clearly what protections exist and what is missing.

## 11. Missing Pieces
List what is needed to make Omni Jarvis a real ERP command assistant:
- stable orchestrator
- tool registry
- DOM agent
- permissions
- approval center
- audit logs
- knowledge base write/review flow
- model router
- verification layer

## 12. Recommended Next Build Order
Give a practical build order:
1. Fix critical broken pieces
2. Connect context/snapshot
3. Build tool registry
4. Add safe actions
5. Add DOM reader
6. Add approvals
7. Add memory/knowledge base
8. Add voice polish

## 13. Final Verdict
Answer these questions clearly:
- Is Omni Jarvis currently a real working agent or mostly chatbot?
- Can it read ERP data?
- Can it execute actions?
- Can it control UI?
- Can it use the knowledge base?
- What is the strongest part?
- What is the weakest part?
- What should be built next?

Use Arabic language in the final explanation, but keep file paths, function names, and code identifiers in English.
Be direct and technical.
