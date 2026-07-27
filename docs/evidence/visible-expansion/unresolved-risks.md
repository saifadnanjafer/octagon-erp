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

## Deferred

Donor licensing and later-domain authority risks are not assessed. No donor
repository has been opened in any checkpoint so far, and VNext has not been
inspected — the gaps encountered have been wiring and action-surface gaps, not
missing capability.
