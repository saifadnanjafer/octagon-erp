# Platform Service Register

| Service | Status before this wave | Status after this wave | Migration | Notes |
|---|---|---|---|---|
| `platform/jobs` (`JobQueue`) | REGISTERED BUT UNREACHABLE | Wired into `platform-runtime-bridge.mjs`; instantiated per-authority; one handler registered (`platform.jobs.maintenance_sweep`) | none new — schema already existed (migrations 005, 010) | Not a new service; connecting an existing one |
| `platform/jobs` (`WebhookService`) | REGISTERED BUT UNREACHABLE | Wired into the authority object (`authority.webhookService`); dispatched from the same 5-minute poll in `server.js` | none new (migration 010) | No subscriber/transport configured yet — see `deferred-hardening.md` |

No new platform service was created this wave; this wave connected an
existing one. `module-register.md` is intentionally not populated with a new
module row for the same reason — this is a wiring fix, not a new module.
