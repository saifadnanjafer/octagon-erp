# BUILD-09R-2 — Mobile receiving and picking surfaces

- Status: **IN_PROGRESS** — this slice improves the two mobile workspaces; it does not close BUILD-09R.
- Branch: `wip/july-2026-payroll-workbook-sync`
- Implementation commit: `a63a8f613908985cf86db0120993650926e8de66`

## Delivered

`mobile_receiving`, `mobile_picking`, and `count_session` now expose a
mobile-first quick-action surface instead of relying only on the shared table
toolbar. Each quick action
opens the existing governed action form and therefore preserves the canonical
WMS authority, permission checks, audit trail, idempotency, and request routing.

The shared table remains available below the quick-action surface for scoped
read, filtering, export, and status review. No new writer or alternate API was
introduced. The asset cache version was bumped for both the workspace script
and stylesheet.

## Verification

```text
node --test tests/build-09/operational-browser-chromium.test.mjs  3/3
npm.cmd run test:build-09                                     33/33
npm.cmd run test:permissions                                  39/39
```

The new Chromium scenario verifies four receiving actions, five picking
actions, and three count actions are visible; representative actions open the
expected governed forms. The existing receiving, picking, and count lifecycle
scenarios remain green.

## Remaining BUILD-09R work

This does not claim the numeric delivery floor or full real-click coverage for
every action form. Further high-traffic receiving, picking, wave, and count
forms still need bounded browser evidence before BUILD-09R can be marked
complete.
