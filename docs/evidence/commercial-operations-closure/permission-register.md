# Permission Register

Two new permission tokens, both auto-derived by
`platform-runtime-bridge.mjs`'s existing scan (`SELECT DISTINCT
required_permission FROM platform_actions WHERE required_permission IS NOT
NULL`) from the `required_permission` column migration 084 sets on each
action row — no separate permission-registration step was needed (matches
the `057_assets_and_depreciation_schedules.mjs` precedent, which also relies
on this same auto-derivation rather than a dedicated permissions array):

| Permission | Used by |
|---|---|
| `returns:write` | create, submit, record_receipt, record_inspection |
| `returns:approve` | approve, reject, record_disposition, close |

The query namespace reuses the pre-existing `platform:db:read` permission —
0 new permissions there.

**Permissions added this wave: 2.**
