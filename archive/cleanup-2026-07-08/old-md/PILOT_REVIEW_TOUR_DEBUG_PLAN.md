**Build update (2026-07-02):** Phase 1 registry plus the first manual Review Session UI/autosave slice are implemented.
# Octagon â€” Pilot Review Tour & Debug Mode
**Status:** PLANNING â€” nothing below is built yet. This file is the live planning doc; it gets edited as we talk (per Saif's instruction: "make the plan somewhere as a file will be edited with the chat"). Sections: Follow Up Â· Tour Â· Commands Â· Questions Â· My Reviews.

**Decisions locked in (2026-07-02, round 1):**
- Pentagonâ†’Octagon rename: **deferred, not now** â€” "Ø¹ÙˆÙÙ‡Ø§ Ù‡Ø³Ù‡ Ù…Ùˆ ÙˆÙ‚ØªÙ‡ Ø±ÙƒØ² Ø¹Ù„Ù‰ Ø§Ù„audit Ø§Ù„ÙŠØ¯ÙˆÙŠ" (skip it for now, focus on the manual audit). Moved to Â§1 Follow Up as backlog, not in scope for this build.
- Debug Mode = **manual QA/UAT review tool** (not a technical console).
- Tour + Debug Mode = **one unified "Review Session"** with two drive modes (AI-guided / manual).
- Element inventory = **hybrid, Jarvis-driven**: for each of the 94 pages, Jarvis loads the page, takes a screenshot, uses its own configured AI-provider API to look at it, and asks Saif questions about what's on screen in real time â€” Saif answers and they go through it together, page by page, one review session per page, until all pages are covered. On top of that, an automatic DOM scan also runs per page (so nothing gets missed even if Jarvis's questions don't cover every element). Saif noted he's open to me handing heavy prep work (e.g. the page-by-page groundwork) off to a subagent with a handoff doc if it's a lot of work.

---

## 0. What Saif asked for (2026-07-02, source message)

1. **Kill "Pentagon" everywhere.** "There is no more pentagon. There's only octagon... wherever you see pentagon, I don't know, change it, remove it, delete it. I don't care."
2. **Pilot review should cover everything** â€” every page, every tab, every button, every slider. Not a sample, not a spot-check.
3. **Jarvis should auto-navigate during the tour** â€” not just describe what to do, but actually move the browser to the next page/element when Saif clicks "next."
4. **A new Debug Mode**, launched from a button, with its own roadmap:
   - Lives *inside* the Omni system (not a separate app).
   - Doesn't require Jarvis/AI to run.
   - Saif can record a **voice note** while reviewing.
   - Flow: press **Record** â†’ follow guided steps â†’ debug manually.
   - The tool should **prompt Saif to press/click every element on the current screen**.
   - It should **capture his whole review as a chat-style log** (voice + typed notes) tied to what he was looking at, so it can be "recorded" (kept as a review transcript/report).
5. **Don't build anything yet** â€” answer/ask questions first, then build.

---

## 1. FOLLOW UP

Action items that fall out of this conversation, tracked here so nothing gets lost between messages.

- [ ] Get answers to the remaining open questions in Â§4 below (blocking â€” nothing gets built until these are resolved).
- [ ] **BACKLOG, not now:** Pentagonâ†’Octagon rename. Deferred per Saif ("Ø¹ÙˆÙÙ‡Ø§ Ù‡Ø³Ù‡ Ù…Ùˆ ÙˆÙ‚ØªÙ‡" â€” not the time for it). When it does happen: its own isolated pass, full regression re-run after, since `PentagonAuth`/`PentagonDB` alone are 300+ occurrences across ~90 files.
- [ ] Whatever gets built should plug into the existing, already-documented "button-by-button audit" item that `MASTER_ROADMAP.md`'s Phase 6 already lists as pending â€” this feature *is* that audit, made repeatable instead of one-off.
- [ ] Once the remaining questions are answered: scope the build into phases (a real roadmap doc per Saif's "whole roadmap for that" ask), likely: (1) DOM auto-scan + element registry per page, (2) manual Debug Mode UI (record/mark/note), (3) Jarvis-driven session (screenshot + AI questions), (4) unified Review Session wiring both modes together, (5) report/output.
- [ ] Heavy page-by-page prep work can be handed to a subagent with a handoff doc if it turns out to be a lot of grinding â€” Saif is fine with that split.

---

## 2. TOUR (AI-guided walkthrough) â€” now folded into "Review Session," see Â§3

Final design lives in Â§3 (the two are one system). Kept here for traceability to Saif's original ask: "Jarvis should auto-navigate you when you click next." In the final design that becomes: Jarvis calls `switchPage()` (reusing the same navigation mechanism `modules/jarvis-action-agent.js` already uses for voice commands) to move to the next page automatically as part of the Review Session flow â€” Saif never has to manually find the next page himself.

---

## 3. REVIEW SESSION (unified Tour + Debug Mode)

**Where it lives:** inside the existing floating Omni chat-bot widget (`omni-ai-assistant.js`) â€” not a new panel. A **"ðŸ” Debug"** action button sits next to the normal chat controls. Clicking it starts a Review Session as a conversation in that same chat window.

**Flow, per Saif's description, mapped to what already exists in the codebase:**

1. **Start.** Saif clicks ðŸ” Debug in the chat widget. A small picker appears first: which page(s) to review (default: next un-reviewed page in order) and which AI provider/model to use (`OctagonAI.useGemini()` / `.useOpenRouter()` / `.useContactBox()` â€” reusing `modules/ai-providers.js`'s existing provider switch, just exposed as a UI dropdown instead of console-only).
2. **Load + scan.** The session navigates to the target page (`switchPage()`), then runs an automatic DOM scan (`document.querySelectorAll('button, input, select, .tab, [role="tab"], input[type=range], a[onclick]')` scoped to the active `.page` section) to build the ground-truth element checklist â€” this is deterministic and doesn't cost an API call. This satisfies "every button, every tab, every slider" without depending on the AI to notice everything.
3. **Screenshot + questions.** The chat then takes a screenshot of the current page (browser `getDisplayMedia`/canvas capture â€” no new permission model needed beyond what voice recording already asks for) and sends it to whichever provider Saif picked, using the same `inlineData` mechanism `app.js` already uses for audio (swap `mimeType: 'audio/webm'` for `'image/png'`). The model asks Saif specific questions about elements from the DOM-scan checklist ("does the X slider move the Y value correctly?", "did the Z button do what you expected?").
4. **Saif answers.** By typing or by voice â€” voice reuses the chat's existing `send(audio=...)` path, which already round-trips through Gemini for transcription. Each answer gets tied to the specific element it was about.
5. **Continuous autosave.** After every exchange, the running session (page, element checklist with pass/fail/skip, every Q&A/transcript so far) is written to disk immediately â€” not just at the end. If Saif closes the tab mid-page, whatever was captured is still saved as a partial report.
6. **Report storage.** Each session's output is a report file in a **new, separate folder** (proposed: `octagon-erp/review-reports/`, gitignored like the other local-only data folders) â€” one file per page per session, named with page id + timestamp. Saif's plan: "the agent reviews them later" â€” i.e., a future Claude session reads this folder to see what's been covered and what came up.
7. **Next.** When a page is done, the same "Debug" flow can immediately move to the next un-reviewed page (`switchPage()` again) â€” this is the "auto-navigate on next" behavior from the original ask, now happening naturally as part of one continuous session instead of a separate "Tour" mode.

**Manual-only fallback:** none of the AI/screenshot machinery is required for Saif to use this â€” he can start a session, decline the AI questions, and just click through the DOM-scanned checklist himself marking pass/fail/notes, per his original "I don't need Jarvis, I'd love to send a voice note" framing. The AI layer adds guided questions on top; it's not load-bearing.

**Relationship to the existing `modules/workshop-stabilization.js` / `modules/route-health.js` doctors:** those are automated, code-level checks (do the right globals/functions/collections exist). This Review Session is the human-judgment complement â€” whether a button *actually does the right thing*, not just whether it exists.

---

## ROADMAP (phased build order)

1. **Element registry (DOM-scan).** A function that, given the current page, returns every reviewable element (buttons/tabs/inputs/sliders/links) with a stable id, label, and type. No AI, no UI yet â€” just the data layer everything else depends on.
2. **Review-session data model + autosave.** Session object (page, element list with statuses, Q&A log, timestamps), continuous write to `review-reports/`. No AI yet â€” this is what makes "even unfinished sessions get saved" true.
3. **Manual mode UI.** The ðŸ” Debug button in the chat widget, a checklist view driven by phase 1's registry, mark pass/fail/skip + typed notes, wired to phase 2's autosave. **This alone already satisfies most of the original ask** (press everything, review in chat, gets recorded) â€” usable before any AI/screenshot work exists.
4. **Voice notes.** Record button reusing the chat's existing `send(audio=...)`/Gemini transcription path, tied to the current element instead of a normal chat message.
5. **Provider picker UI.** Small dropdown wired to `modules/ai-providers.js`'s existing `useGemini()`/`useOpenRouter()`/`useContactBox()`, so Saif controls model/cost before starting a session.
6. **AI-guided questions (screenshot + vision call).** Extends the existing Gemini `inlineData` audio pattern to images; the model asks about elements from phase 1's registry. Auto-navigate to the next page on completion (the "Tour" behavior).
7. **Roadmap/dashboard view.** A page (or a panel inside `route_health`/`deploy_ready`) showing, at a glance, which of the 94 pages have been reviewed, pass/fail counts, and links into each report â€” built from the `review-reports/` folder phase 2-6 have been writing to.

Phases 1-3 are pure data/UI plumbing with no AI dependency and directly deliver the core ask (manual click-through + voice + chat-log capture). Phases 4-6 layer AI/voice on top. Phase 7 is the "see everything at a glance" roadmap view. Recommend building and confirming phases 1-3 work end-to-end on one real page before extending to all 94 and before adding the AI layer â€” cheaper to catch a wrong assumption early.

---

## 4. QUESTIONS

### Answered (round 1, 2026-07-02)
1. ~~Pentagon rename depth~~ â†’ **deferred, not now** (moved to Â§1 Follow Up backlog).
2. ~~Debug Mode nature~~ â†’ **manual QA/UAT review tool**, confirmed.
3. ~~Tour vs Debug Mode~~ â†’ **one unified Review Session, two modes**.
4. ~~Element inventory: generated or curated?~~ â†’ **hybrid**: automatic DOM scan on every page, *plus* Jarvis actively drives each per-page session â€” loads the page, screenshots it, calls its configured AI-provider API, asks Saif real questions about what's on screen, logs his answers. One review session per page, 94 sessions total to cover everything.

### Answered (round 2, 2026-07-02)
5. Voice notes â†’ **transcribed to text** (reuse the existing Gemini audio pipeline already in `app.js`/`omni-ai-assistant.js`'s `send(audio=...)`).
6. Review output â†’ **it happens inside the existing Omni chat-bot widget itself.** Saif's words: open the omni chat bot, click a "Debug" button/action, it lays out the full plan/steps/questions and the whole thing becomes a conversation inside that same chat while he works the page. **Auto-saves continuously** â€” even an unfinished session saves whatever was captured as a partial report. Reports get written to a **new, separate folder** (not mixed into the existing docs), and get reviewed later "by the agent" (Claude, in a follow-up session).
7. Entry point â†’ **floating global button**, confirmed â€” consistent with #6, since the chat widget (`omni-ai-assistant.js`) is already a floating global element.
8. AI provider/cost â†’ Saif wants **his own control over which provider/model runs this** (sees Gemini free / OpenRouter paid / Claude via ContactBox as live options) rather than me hardcoding Gemini. Good news: `modules/ai-providers.js` already has provider switching (`OctagonAI.useGemini()` / `.useOpenRouter()` / `.useContactBox()`, `octagonAIProvider` in localStorage) â€” it's just console/programmatic today, no UI picker. Plan: add a small model/provider picker to the review-session UI so Saif picks before starting, rather than building a new provider system from scratch. On DOM-scan vs. other technical approach: Saif explicitly deferred that call to me ("Ù…Ø§Ø¹Ø±Ù ØµØ±Ø§Ø­Ù‡ ÙƒÙ„Ø´ Ø¨Ù‡Ø§Ù„Ø§Ù…ÙˆØ±" â€” I honestly don't know much about these things) â€” decided in Â§2/Â§3 below.

**All blocking questions answered.** What follows is the concrete build plan â€” reviewing this is the last step before I start writing code.

---

## 5. COMMANDS

Control surface for the unified Review Session, living inside the `omni-ai-assistant.js` chat widget.

| Command | Phase | What it does |
|---|---|---|
| ðŸ” Debug (button in chat) | 3 | Starts a Review Session on the current (or next un-reviewed) page |
| Pick page / pick provider | 3, 5 | Small selectors shown at session start |
| Mark Pass / Fail / Skip | 3 | Logs a verdict for the element currently in focus, from the DOM-scanned checklist |
| Add Note (typed) | 3 | Attaches a typed note to the current element/page |
| Record (voice) | 4 | Starts/stops a voice-note capture, transcribed and tied to the current element |
| Next page | 6 | Ends the current page's session, auto-navigates (`switchPage()`) to the next un-reviewed page, starts a new session there |
| End Session | 2 | Closes the review (or is implicitly triggered by closing/navigating away); whatever was captured up to that point is already saved |

---

## 6. MY REVIEWS

*(Empty â€” this is where Saif's own review notes/feedback go once a session actually runs. Nothing to log yet.)*

