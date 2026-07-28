# Unresolved Risks — Visible Expansion

## Critical / hard-gate

1. **No owner-approved opening inventory accounting date.** Real
   operational-source migration remains fail-closed with
   `OPENING_CUTOVER_DATE_REQUIRED`. Not attempted. It did not block any work in
   these checkpoints and must not be invented.
2. **No Phase 04 domain is retired.** Every cutover flag reports `enforced:
   false`. The legacy writers (`services/stockService.js` at 16 call sites, 79
   legacy commercial array references in `app.js`) remain fully active. The
   canonical path is built and now proven, but nothing has been cut over.

## High

1. **A product cannot be bootstrapped from the UI.** `product:template:create`
   requires `category_id` and `uom_id`. The canonical action surface exposes
   `uom:create` but **no action for creating a UOM category or a product
   category** — both are only reachable as direct module functions
   (`uom.createUomCategory`, `products.createProductCategory`), not as governed
   commands. Consequence: no end-to-end stock receipt has been posted from the
   browser, because there is no product to receive. Either those two creates
   need governed actions, or the UI needs a seeded catalogue to work against.
2. **Only two commands have executed end-to-end from the UI**: `party:create`
   (Checkpoint A) and `warehouse:create` + `stock:location:create`
   (Checkpoint B). `stock:move:post` is proven only through its *rejection*
   path. `work_item:create`, `product:template:create` and every sales /
   procurement / POS command remain unexercised in a browser.
3. **Screenshots are unavailable in this environment.** The screenshot service
   times out because the Browser pane does not composite frames. All visual
   claims in the evidence are DOM measurements and are labelled as such. No
   screenshot artefact exists for any checkpoint.
4. **The shell has no mobile sidebar collapse.** At a 375px viewport the
   sidebar keeps its full 260px, leaving `mainContent` at 115px, which squeezes
   **every** page in the application. Collapsing it manually fixes the layout,
   so the markup and page CSS are fine — only the default state is wrong.
   Pre-existing and shell-wide; flagged separately, not changed here.
5. **Checkpoints C–F are not started.** Sales, Procurement, POS, Work
   Management and Administration have no distinct module page. Projects,
   Manufacturing, Quality, Assets, Maintenance and Fleet do not exist.

## Medium

1. **Two defects were introduced by this work and caught only in a browser**,
   both invisible to unit tests at the time:
   - the client percent-encoded action ids, so *every* canonical command was
     broken from Wave 1 until Checkpoint A;
   - the console treated the legacy `PermissionService` as authoritative and
     hid all tabs from a canonically-authenticated user.

   In the first case the unit tests asserted the **encoded** URL and therefore
   locked the defect in. The lesson is recorded here because it will recur:
   assert the contract the server requires, not the string the implementation
   currently produces.
2. **Render races are a live hazard in these modules.** Both the console and
   the inventory module are driven by navigation, tab clicks, language switches
   and `octagon:canonical-changed` simultaneously. Both now carry a
   render-generation guard; any new panel-based module needs the same or it will
   strand a loading skeleton.
3. **The disposable auth fixture is powerful and must stay fenced.** It creates
   login-capable identities. Its three guards are tested and there is no bypass,
   but any future change to it deserves the same scrutiny as production auth.
4. **The Phase 05 work on `cd86a05` is still unverified** — ~16k lines, 5
   migrations, 7 platform modules, tests never run, sitting unpushed on its own
   branch. It must not be treated as complete because it exists.
5. **`app.js` is ~37,400 lines.** Surgical edits are viable, but broad
   conversion of the 79 legacy commercial call sites needs incremental browser
   verification after each step.

## Checkpoint C1 status addendum — 2026-07-28

The following earlier statements are superseded:

- Sales is no longer a read-only console surface.
- Sales lifecycle commands executed end-to-end in authenticated Chromium.
- Screenshots are available and manually reviewed.
- The product/UOM/category bootstrap gap no longer blocks disposable Sales
  acceptance because governed category actions are available on this branch.

Remaining hard risks:

1. The owner-approved opening inventory accounting date is still absent.
   Operational-source migration remains fail-closed.
2. Phase 04 domain retirement/cutover is still not authorized or claimed.
3. Checkpoints C2–C6 remain open at this point in branch history.
4. Legacy writers remain outside the now-retired Sales page; later proof gates
   must pass before any broad cutover classification.

## Deferred

Later-domain donor licensing and authority risks remain to be assessed in their
own checkpoints. For C1, the frozen project-owned VNext Sales engine plus Odoo
19 and ERPNext Sales lifecycle sources were inspected read-only; only clean-room
behavior was adapted, and no donor code was copied.

## Checkpoint C2 status addendum — 2026-07-28

The following earlier statements are now superseded:

- Procurement is no longer a read-only console surface.
- Procurement lifecycle commands executed end-to-end in authenticated
  Chromium.
- Canonical Inventory receipt/quality and Finance supplier-bill/return
  consequences are visibly proven.
- C2 screenshots are available and manually reviewed.

Remaining risks after C2:

1. The owner-approved opening inventory accounting date is still absent.
   Operational-source migration remains fail-closed.
2. Broad Phase 04 domain retirement remains unauthorized and is not claimed.
3. C3 POS, C4 Work Management, C5 Administration/Module Control, and C6 final
   closure remain open.
4. Legacy procurement code still exists outside the original Procurement page;
   the page-level legacy renderer is retired only while canonical Procurement
   is active.
5. PostgreSQL execution is not proven. Migration 047 follows portable schema
   design, but this checkpoint's executable migration proof is SQLite.

For C2, frozen project-owned VNext Procurement plus Odoo 19 and ERPNext Buying
sources were inspected read-only. Only clean-room behavior was implemented; no
third-party code was copied.

## Checkpoint C3 status addendum — 2026-07-28

The following earlier statements are now superseded:

- POS is no longer a legacy or read-only surface.
- Terminal, session, split-tender sale, receipt, refund, stock restoration,
  credit-note, and reconciliation workflows executed end-to-end in
  authenticated Chromium.
- POS audit/outbox consequences and operational-role access are visibly proven.
- C3 screenshots are available and manually reviewed.

Remaining risks after C3:

1. The owner-approved opening inventory accounting date is still absent.
   Operational-source migration remains fail-closed.
2. Broad Phase 04 domain retirement remains unauthorized and is not claimed.
3. C4 Work Management, C5 Administration/Module Control, and C6 final closure
   remain open.
4. Legacy POS implementation files remain present for compatibility; route and
   page ownership are retired while canonical POS is active.
5. PostgreSQL execution is not proven. Migration 048 follows portable schema
   design, but this checkpoint's executable migration proof is SQLite.

Frozen project-owned VNext POS sources plus Odoo 19 and ERPNext POS sources were
inspected read-only. Only clean-room behavior was implemented; no third-party
code was copied.

## Checkpoint C4 status addendum — 2026-07-28

The following earlier statements are now superseded:

- Work Management is no longer split across visible Task Manager, Kanban and
  Workshop TV authorities.
- The complete Work Item lifecycle executed in authenticated Chromium.
- Canonical subtasks, dependencies, calendar movement, gated completion,
  workload and Workshop TV are visibly proven.
- C4 screenshots are available and reviewed.

Remaining risks after C4:

1. C5 Administration/Module Control and C6 final closure remain open.
2. The owner-approved opening-inventory accounting date remains absent;
   operational migration stays fail-closed.
3. Broad Phase 04 writer retirement/cutover remains unauthorized and unclaimed.
4. Legacy task code remains present for compatibility; route ownership is
   retired only while the canonical Work Management module is active.
5. PostgreSQL execution is not proven. Migration 049 follows portable design,
   but executable migration proof is SQLite.

Frozen project-owned VNext Project/SLA sources plus Odoo 19 and ERPNext Task
sources were inspected read-only. Only clean-room behavior was implemented.

## Checkpoint C5 status addendum — 2026-07-28

The following earlier statements are now superseded:

- Administration is no longer a legacy-only page.
- Nineteen scoped Control Plane areas are visible.
- Optional module disable, navigation removal, direct server denial, recovery,
  license denial/recovery, feature flags, health, and restricted-viewer denial
  executed in authenticated Chromium.
- C5 screenshots are available and reviewed.

Remaining risks after C5:

1. C6 cross-domain closure remains open.
2. The owner-approved opening-inventory accounting date remains absent;
   operational migration stays fail-closed.
3. Broad Phase 04 writer retirement/cutover remains unauthorized and unclaimed.
4. Legacy Administration/marketplace/settings code remains for compatibility;
   the original Administration route is canonical while the C5 authority is
   active.
5. PostgreSQL execution is not proven. Migration 050 follows portable design,
   but executable migration proof is SQLite.
6. Backups are represented as governed run metadata and configuration status;
   this checkpoint did not execute or claim a production backup.

Frozen project-owned VNext Control Plane sources plus Odoo 19 settings and
ERPNext configuration sources were inspected read-only. Only clean-room
behavior was implemented.

## Checkpoint C6 final risk position — 2026-07-28

C6 is no longer open. Sales, Procurement, POS, Work Management,
Administration, cross-domain rollback/concurrency, and authenticated Chromium
are complete within Checkpoint C.

Remaining non-blocking boundaries:

1. The owner-approved opening-inventory accounting date is absent. Operational
   opening-stock migration remains fail-closed; no date was invented.
2. Broad production Phase 04 writer retirement/cutover was not authorized and
   is not claimed.
3. PostgreSQL execution is unproven; executable evidence is SQLite on
   disposable databases.
4. Legacy compatibility files remain; original route ownership is canonical
   while delivered modules are active.
5. Production backup execution was not performed.
6. This evidence is produced by the implementation agent, not an independent
   verifier.

No critical/high defect remains in the delivered scope.

**CHECKPOINT C COMPLETE — SAFE TO CONTINUE**
