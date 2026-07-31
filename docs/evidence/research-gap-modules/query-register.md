# Query Register

One new governed read query this wave:

| Resource | Route | Permission | Returns |
|---|---|---|---|
| `job-queue` | `GET /api/v1/control-plane/job-queue` (added to `platform/control_plane/index.mjs` `handleControlPlaneQuery`) | reuses the existing `control:admin` gate already enforced by the `control-plane` namespace route in `platform/api/index.mjs` — no new permission needed | `{ counts: [{status, n}], deadLetters: [...up to 50], recent: [...up to 50] }` read directly from `job_runs`, read-only |

The pre-existing `jobs` resource (job **definitions**, `platform_jobs` table)
was not changed — `job-queue` is additive, covering the run queue instead.

**Queries added this wave: 1.**
