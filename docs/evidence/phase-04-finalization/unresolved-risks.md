# Unresolved Risks — Phase 04 Finalization

## Critical / hard-gate

1. **No owner-approved opening inventory accounting date.** Real
   operational-source migration remains fail-closed with
   `OPENING_CUTOVER_DATE_REQUIRED`. Selecting a date without owner authority
   would fabricate a material accounting fact. Not attempted.
2. **No real Chromium acceptance has run.** Activating any Phase 04 retirement
   lock before browser parity would break live workshop workflows. Hard gate.
3. **Legacy inventory / commercial / reservation / task writers remain fully
   active.** The duplicate-authority condition persists. Wave 1–2 built the
   canonical path but activated nothing; `services/stockService.js` still
   mutates governed facts directly from the browser at 16 call sites.
4. **The operational database is intentionally unmigrated.** No Phase 04
   cutover flag row and no retirement lock exist in it. Production cutover is
   not authorized.

## High

1. **The canonical client has never reached a real platform runtime from a
   browser.** Every test uses a recording `fetch` stub. The Phase 04 aggregate
   proves the server-side actions work; nothing yet proves this client
   successfully drives them end to end.
2. **The preserved Phase 05 work (`cd86a05`) is unverified.** ~16k lines,
   5 migrations, 7 platform modules. Its tests were not run, no browser
   acceptance exists, and its correctness is unassessed. It sits on its own
   branch, unpushed. It must not be treated as complete because it exists.
3. **Historical `CLOSED` / `FULL COMPLIANCE` / `independently verified`
   evidence elsewhere in this repository can mislead later agents.** Repository
   reality, executable runtime behavior and real browser evidence outrank
   narrative claims.
4. **Phase 01–03 regressions were not re-run this session.** Their last
   recorded status is inherited, not re-verified. Do not report it as current.
5. **Wave 2 is partially wired.** `addMaterial` routes through the seam;
   `editMaterial`, `addCustomerFromForm` and `editSupplier` do not. A partially
   converted domain is a state to finish, not to ship.

## Medium

1. The operational database has active WAL/SHM components. Future observation
   must keep using staged byte copies rather than opening the live path.
2. VNext begins dirty (17 modified files). Any write or cleanup there could
   destroy owner work. It was not inspected or touched this session.
3. `app.js` is ~37,300 lines. Surgical edits are viable but the file's size
   makes broad conversion risky without incremental browser verification after
   each step.
4. The `roles` defect introduced in Wave 1 and caught in Wave 2 shows the
   forbidden-key list is a blunt instrument. Any future addition to
   `FORBIDDEN_INPUT_KEYS` must be checked against the business vocabulary of
   every governed action, not just the identity vocabulary.

## Deferred

Donor licensing, capability selection and later-domain authority risks are not
assessed here. They do not authorize bypassing the Phase 04 hard gate.
