# BUILD-04 — Integration Hub rendering hardening

Eliminate redundant synchronous rebuilds of the existing `integration_hub`
workspace so it remains responsive for pilot use and automation. Preserve the
single existing route and all staged-only connector boundaries.

Requirements:

- Render the enterprise workspace, marketplace workspace, and e-commerce
  workspace once per Integration Hub activation, using a shared coalesced
  scheduler or equivalent bounded mechanism.
- Do not add a public page, activate any connector, make any external request,
  or mutate operational data.
- Retain the existing staged/approval/audit semantics for every connector
  action.
- Add disposable, focused regression coverage for the coalescing behavior and
  run the affected route/permission regression.
- Record executable evidence before marking this task complete.
