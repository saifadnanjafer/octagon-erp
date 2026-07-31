# Licensing and Provenance

## This wave's build (platform/jobs wiring)

- **Reuse mode:** none — no source reuse of any kind. `platform/jobs/index.mjs`
  was already authored, in-repo, project-owned code (its own header credits
  Octagon's own `server-scheduler.js` cron vocabulary and VNext lease/retry
  patterns as prior influences, not this wave). This wave only *wires* the
  already-existing, already-authored engine into the runtime; it wrote zero
  lines of new domain logic borrowed from any donor.
- **Files touched:** `platform-runtime-bridge.mjs`, `server.js`,
  `platform/control_plane/index.mjs`, `modules/fpc-release-health.js` — all
  pre-existing, project-owned Octagon files.
- **Files created:** `tests/phase02/jobs-wiring.test.mjs` (new, project-owned,
  no external template used).
- **No AGPL/fair-code/Enterprise-only donor code was read, copied, or adapted
  this wave.**

## Research corpus

The capability matrix's own §15 "Final contribution boundary by source" table
governs future donor-adaptation decisions; no donor adaptation happened this
wave, so no boundary was exercised or tested against actual donor source.
