# Action Register

No new `ActionExecutor` action was registered this wave. This is a read/
scheduling wiring fix, not a new user-facing write command:

- `JobQueue.enqueue`/`execute`/`cancel`/`recoverStaleLeases` are internal
  engine operations invoked by the server's own poll loop and by tests, not
  exposed as a governed user action this wave (no admin "cancel this job"
  button was added — that is deferred hardening, see `deferred-hardening.md`).
- `WebhookService.subscribe`/`queue`/`dispatch` are likewise internal; no
  webhook-subscription management UI or action was added this wave.

**Action count added this wave: 0.**
