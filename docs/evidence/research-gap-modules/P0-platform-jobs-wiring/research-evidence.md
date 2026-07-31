# P0 — platform/jobs wiring — Research Evidence

- **Matrix row:** `PK-026` "Scheduler and background jobs" —
  `MASTER_CAPABILITY_INTEGRATION_MATRIX.md` line 151. Disposition: `PRESERVE` +
  `SPEC-IMPLEMENT`, target owner `platform/jobs`, phase 02.
- **Matrix's own current-state description at time of writing:** "Real
  read-only scheduler exists" — accurate for `server-scheduler.js` but written
  before `platform/jobs` was built; the matrix does not know a second, more
  complete engine already exists in-repo.
- **Repository precedent for this exact defect class:**
  `platform-runtime-bridge.mjs` (as found at the start of this wave) already
  contains this comment above the workflow/automation imports: *"FP-2 Control
  Plane: WorkflowRegistry/Runtime and AutomationEngine are real, tested
  engines that were never imported outside their own test files. See
  platform/domains/governance-actions.mjs for why this is the same class of
  defect Wave 2 had."* This wave's fix follows the exact same shape for
  `platform/jobs`.
