# Control Plane and Navigation

Migration 043 registers the Phase 04 modules/entities/actions and seeds `phase04.canonical_cutover` disabled. The raw HTTP runtime checks the control-plane flag before enforcing Phase 04 generic-writer denial.

The future activation gate is:

1. legacy migration and all reconciliations pass;
2. canonical UI/API parity passes;
3. real browser/security/concurrency proof passes;
4. machine-readable writer denial passes;
5. an explicit reviewed cutover enables the flag.

`index.html`, `app.js`, views, services, navigation, deep links, RTL/LTR, and mobile layouts were not changed after the hard stop. Control-plane registration is complete; page visibility and cutover are not.
