# Design Findings Guide — Octagon ERP Review Freeze 2

When you record a finding (in `FUNCTIONAL_REVIEW_MATRIX.md`,
`UI_UX_AUDIT_MATRIX.md`, or a `UI_CHANGE_REQUEST_TEMPLATE.md`/
`BUG_REPORT_TEMPLATE.md` entry), classify it into exactly one of the 9
categories below (spec section 17). Definitions are exact; examples are
grounded in real pages from `docs/review/PAGE_INVENTORY.json` so you can tell
categories apart quickly without re-deriving the distinction each time.

If a finding seems to fit two categories, pick the one that describes the
**root cause**, not the symptom (e.g., a button that's unreachable by
keyboard is an Accessibility finding even though the symptom is "can't
submit the form"). If you're genuinely unsure after that, file it under the
more severe of the two candidates and say so in the finding.

---

## 1. Consistency

**Definition:** The feature works correctly, but looks or behaves visually
differently from established patterns elsewhere in the app.

**Examples:**
- The vertical-industry pages (`pharmacy`, `retail`, `clinic`, `restaurant`,
  `real-estate`, `hotel` — all `Vertical` moduleDomain) use different card
  spacing or button placement from each other, even though they're meant to
  share one layout pattern.
- `event_checkin` uses a different status-badge color for "checked in" than
  `mobile_picking` uses for "picked" — both are terminal-success states in
  their respective flows and should read the same way.

**Not this category:** if the inconsistent element is also missing a
keyboard focus ring or has insufficient contrast, that's Accessibility, not
Consistency — the visual difference itself isn't the problem, its
unusability is.

---

## 2. Usability

**Definition:** The feature works, but is confusing, slow, or requires
unnecessary steps to complete a task.

**Examples:**
- `dock_checkin` (Warehouse and Mobile) requires navigating through 4 screens
  to confirm a single dock arrival when the data needed is already visible on
  `dock_schedule` — the flow could be one click from the schedule.
- `wave_planning` buries the "release wave" primary action inside a secondary
  menu instead of surfacing it as a visible button, so operators have to
  hunt for the action they perform most often.

**Not this category:** if the extra steps exist because the button that
would skip them is simply invisible/unreachable, check whether it's a
rendering bug (Functional) before defaulting to Usability.

---

## 3. Information Architecture

**Definition:** The page, its label, or its navigation location is wrong —
it lives in the wrong nav group, is mislabeled relative to its actual task,
or duplicates another page's purpose.

**Examples:**
- `risk_compliance` sits under the general "إدارة الأعمال والمبيعات"
  (Business & Sales) nav group in the current build, when its content is
  governance/compliance-related and reviewers keep expecting to find it under
  administration — worth raising as an IA finding even though nothing is
  "broken."
- `consolidation_lineage` and `consolidation_runs` (Finance domain) have
  overlapping content with unclear distinction in their nav-group placement —
  a reviewer can't tell from the nav label alone which one to open for a
  given task.

**Not this category:** a page that's in the right place but whose on-page
title text doesn't match what's in the nav link is Content (a
label/terminology problem), not IA — IA is about *location*, Content is
about *wording*.

---

## 4. Responsive

**Definition:** The page fails, or becomes impractical to use, on a smaller
viewport (laptop, tablet, or mobile) even though it works on desktop.

**Examples:**
- `fleet_live_map_simulator` (Tour 10, reviewed at laptop 1366x768) causes
  horizontal page overflow because the map canvas has a fixed pixel width
  wider than the viewport.
- `skills_catalog`'s competency matrix (Tour 8, reviewed at tablet
  1024x768) shrinks column text below a readable size instead of
  scrolling or collapsing columns.
- `mobile_receiving` (Tour 3, reviewed at mobile 390x844) has scan/confirm
  buttons smaller than a comfortable touch target, making one-handed
  warehouse use error-prone.

**Not this category:** if the same broken layout also appears at desktop
1440x900, it's not viewport-specific — file it as Functional or Consistency
depending on what's actually wrong, not Responsive.

---

## 5. Accessibility

**Definition:** A keyboard-navigation, focus-visibility, contrast, semantic-
label, or screen-reader problem — the interface can't be reliably perceived
or operated by assistive technology or without a mouse.

**Examples:**
- `ai_proposal_inbox`'s approve/reject buttons have no visible focus ring
  when tabbed to, so a keyboard-only reviewer can't tell which action they're
  about to trigger.
- `tenant_detail`'s status badges convey state (active/suspended/etc.) by
  color alone, with no text or icon fallback — unreadable to a
  colorblind reviewer or a screen reader.
- A modal opened from `security_center` (e.g., an audit-detail dialog) doesn't
  trap focus — Tab moves focus to elements behind the modal, and Escape
  doesn't close it.

**Not this category:** a badge color that's merely inconsistent with the
rest of the app (but still has adequate contrast and a text label) is
Consistency, not Accessibility — the bar here is "can it be perceived/
operated," not "does it match."

---

## 6. Content

**Definition:** A translation, terminology, field-name, help-text, or
empty-state wording problem.

**Examples:**
- `tenant_detail`/`tenant_directory` have no Arabic label in
  `PAGE_INVENTORY.json` (`rtlStatus`: "no Arabic label found — needs
  review") — surfacing as untranslated English text when the app is in
  Arabic mode.
- `mismatch_queue`'s empty state (when there are no unmatched intercompany
  transactions) shows a bare "No data" instead of a sentence explaining what
  the page is for and what would populate it.
- A field on `finance_installments` is labeled with an internal shorthand
  term instead of the term reviewers recognize from `contracts`.

**Not this category:** if the missing/wrong text is a raw ID or JSON blob
displayed to the user (not a translation/wording issue but a data-formatting
one), that's Data Presentation under the UI/UX audit categories (spec
section 15), not a Content finding under this 9-category scheme — this
guide's Content category is specifically about wording/translation, not
formatting.

---

## 7. Functional

**Definition:** An action, query, permission check, or workflow simply
doesn't work — it errors, silently no-ops, returns wrong data, or lets
something through that should be blocked (or blocks something that
shouldn't be).

**Examples:**
- Clicking "approve" on `ai_proposal_inbox` as `review.ai_reviewer` doesn't
  actually change the proposal's status — the UI shows success but the data
  is unchanged on reload.
- `variance_review` (cycle-count variance) shows a count that doesn't match
  the underlying count-session records when cross-checked against
  `count_session`.
- A permission-gated action button on `admin_panel` is hidden for
  `review.viewer` (correct), but the underlying API call still succeeds when
  triggered directly — this is exactly the scenario `KNOWN_LIMITATIONS.md`
  flags as untested (`authorization_route_coverage` is empty in this build)
  — confirm and file as Functional if the server doesn't independently
  reject it (also see Security/Scope below; if the server actually returns
  the data instead of just accepting the write, file as Security/Scope,
  which is more severe).

**Not this category:** if the button/action is simply missing or unreachable
(not present in the DOM, not that it errors when clicked), check
Accessibility (can't reach it via keyboard) or Information Architecture (it's
on the wrong page) before defaulting to Functional.

---

## 8. Security/Scope

**Definition:** A user sees or changes data outside their permitted scope —
cross-tenant, cross-company, cross-role, or cross-employee data leakage or
unauthorized mutation.

**Examples:**
- Signed in as `review.isolation_viewer` (second tenant/company per
  `scripts/review/roles.mjs`), any page shows data belonging to
  `REVIEW_TENANT`/`REVIEW_COMPANY` instead of being empty/denied — this is
  the specific scenario `TEAM_HANDOFF.md` calls out reviewers to test.
- Signed in as `review.employee_self_service` (scope: `own`), `person_skill_evidence`
  or `development_plans` (Tour 8) shows another employee's records, not just
  the signed-in identity's own.
- A write action whose button the UI hides from `review.viewer` still
  succeeds when triggered directly against the underlying API — per
  `KNOWN_LIMITATIONS.md`, treat this as P0 whenever confirmed, since
  `authorization_route_coverage` is empty in this build and the client-side
  `PAGE_PERMISSIONS` gate is not proof of a server-side check.
- Anything in the review environment that looks like real (non-`[DEMO]`)
  customer, employee, or financial data — stop and report immediately per
  `TEAM_HANDOFF.md`'s "Prohibited use of review data" section.

**Not this category:** a permission-gated button that's correctly hidden
*and* correctly rejected server-side, but has a confusing error message when
somehow triggered, is a Content or Usability finding on the error message,
not a Security/Scope finding — the boundary held, only the messaging is off.

---

## 9. Performance

**Definition:** The page or action is slow, repeats requests unnecessarily,
leaks resources over time, or freezes the UI.

**Examples:**
- `telemetry_explorer` (Tour 10, IoT domain) becomes sluggish or
  unresponsive after being left open for several minutes, suggesting a
  polling loop that isn't cleaning up.
- `consolidation_runs` (Finance domain) issues the same lookup request
  multiple times on a single page load instead of once (visible in the
  browser's network tab), slowing initial render without changing the
  result.
- Switching between `warehouse_topology` and `zone_bin_management`
  repeatedly causes memory usage to climb without returning to baseline,
  consistent with event listeners or timers not being torn down on
  navigation.

**Not this category:** a page that's slow because it's genuinely rendering a
large dataset (e.g., `tenant_directory` with hundreds of demo tenants) and
stays responsive throughout is not a Performance finding by itself — only
file it if the slowness is disproportionate to the data size, or the UI
actually freezes/hangs rather than just taking a moment to render.

---

## Quick disambiguation table

| If the finding is about... | File it as |
|---|---|
| Looks different from a similar page elsewhere | Consistency |
| Works, but takes too many steps / is confusing | Usability |
| Wrong nav group / wrong page for the task / duplicate pages | Information Architecture |
| Breaks or becomes impractical on a smaller screen | Responsive |
| Can't be used via keyboard, low contrast, no semantic label | Accessibility |
| Wrong/missing translation, bad field name, bad empty-state copy | Content |
| Action/query/permission/workflow doesn't actually work | Functional |
| Data or action crosses a tenant/company/role/employee boundary | Security/Scope |
| Slow, repeated requests, resource leak, freeze | Performance |
