# CRM lifecycle proof

Disposable backend tests prove:

1. Create and qualify a Lead.
2. Convert it while creating or reusing canonical Party.
3. Create an Opportunity and move it through governed pipeline stages.
4. Schedule a direct Opportunity Activity.
5. Request a canonical Sales quotation.
6. Create one canonical Work Item from an Activity with replay protection.
7. Mark lost/reopen and mark won only with evidence or an explicit privileged
   override.
8. Deny cross-company access.
9. Deny disabled-module and missing-permission execution.
10. Replay sensitive commands without duplicate records.

Authenticated Chromium additionally proves the real HTTP/server/original-shell
path: Sales login, governed CRM reads, visible Lead creation, all eight CRM
areas, English LTR, 375px mobile layout, Viewer login, and server-side mutation
denial.
