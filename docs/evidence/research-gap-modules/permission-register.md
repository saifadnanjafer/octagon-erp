# Permission Register

**No new permission was registered this wave.** The new `job-queue` query
resource reuses the pre-existing `control:admin` permission, already enforced
at the API-route level for the entire `control-plane` namespace
(`platform/api/index.mjs`, `if (namespace === 'control-plane' ...)
requirePermission('control:admin')`). Introducing a narrower permission for
this one read-only resource was considered and rejected as unnecessary scope
creep for a wiring fix — it can be split out later if a non-admin role ever
needs job-queue visibility without full control-plane access.

**Permissions added this wave: 0.**
