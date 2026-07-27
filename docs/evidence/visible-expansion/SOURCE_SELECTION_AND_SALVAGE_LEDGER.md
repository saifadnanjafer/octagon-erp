# Source Selection and Salvage Ledger

## Summary

**No VNext code and no third-party donor code was salvaged in this wave.**

That is a finding, not an omission. The capability this wave needed — a visible
original-shell surface over the canonical engines — did not require importing a
data model, a workflow, or a UI component from anywhere. Octagon already owned:

- the canonical engines (`platform/commercial`, `platform/inventory`,
  `platform/sales`, `platform/procurement`, `platform/pos`,
  `platform/work_items`);
- the canonical HTTP surface (`platform/api/**`, `/api/v1`);
- the canonical client transport (`services/canonicalClient.js`);
- the shell's own page/nav/permission conventions.

The gap was wiring, not capability. Importing a donor UI would have added a
foreign visual language to an Arabic-first workshop shell for no functional
gain, and would have created a second set of conventions to maintain.

## Per-capability record

### Capability: visible canonical operations surface

| Field | Value |
|---|---|
| Sources compared | Octagon current shell; VNext (considered, not opened); Odoo 19 list/form pattern (conceptual only); NocoBase configurable-view concept (conceptual only) |
| Exact paths inspected | Octagon only: `app.js` (`pageMap` at 4063 and 37140, `ensurePageTemplateLoaded` at 37139, `prefetchAllViews` at 37295), `index.html` nav block, `modules/appointments.js:422-432` (switchPage-wrap pattern), `services/permissionService.js:154,255`, `platform/api/commercial.mjs:31-139`, `platform/api/index.mjs` |
| Ownership / license | Octagon's own code |
| Selected source | **Octagon's own existing conventions** |
| Reuse mode | Followed in-repo pattern; no code copied from any donor |
| Target Octagon path | `views/canonical_console.html`, `modules/canonical-console.js`, `modules/canonical-console.css` |
| Reason | The shell already has a well-defined contract for adding a page (view template → `pageMap` → prefetch → nav button → module with switchPage-wrap → permission mapping). Following it exactly means the new page inherits the existing visual identity, RTL handling, lazy loading and permission model with zero foreign dependencies. |
| Rejected alternatives | **Odoo list/form view** — mature, but importing its widget model would mean importing its CSS and JS conventions into an Arabic-first shell that has its own. **NocoBase configurable views** — attractive long-term for user-defined columns, but it is an architecture, not a snippet; adopting it partially would create two competing view systems. **VNext commercial UI** — not opened this wave: the canonical engines it would have fed already exist in Octagon, so there was nothing to transfer. |
| Tests | `tests/phase04-finalization/canonical_console.test.mjs` — 10 tests |
| Runtime status | Mounted and rendering; verified in a real browser |
| UI status | Visible in the sidebar; opens; bilingual; responsive |

### Pattern adopted in-repo (not a donor)

| Pattern | Source in Octagon | Why |
|---|---|---|
| switchPage wrap + self-activate | `modules/appointments.js:422-432` | Non-core pages are lazily fetched, so the shell's `page-active` reveal runs before the section exists. Every non-core tab in this repo already solves it this way. |
| Scoped module stylesheet | convention after a past regression where an unscoped `.btn-secondary` rule leaked globally | All rules here are scoped under `#pageCanonicalConsole`. |
| Bilingual label pairs + `octagon:language-applied` | `modules/fleet.js` and other recent modules | Matches how the rest of the shell re-renders on language switch. |

## VNext

| Field | Value |
|---|---|
| Paths inspected | none |
| Code salvaged | none |
| Files modified | **none** — 17 dirty files at entry and at exit, untouched |

VNext remains permanently frozen. It was not opened because no capability gap in
this wave pointed at it. When Waves 4–5 reach Manufacturing/Projects/Assets,
VNext is the first place to look, and that inspection will be recorded here.

## Third-party donors

| Field | Value |
|---|---|
| Repositories opened | none |
| Code copied or adapted | none |
| Licenses to preserve | none incurred this wave |

No donor repository was read. Odoo and NocoBase are named above only as
conceptual alternatives that were considered and rejected on architectural
grounds, not inspected file by file.
