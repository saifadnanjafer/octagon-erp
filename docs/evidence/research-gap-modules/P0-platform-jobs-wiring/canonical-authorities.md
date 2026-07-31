See `../canonical-authority-map.md` — this build reuses `platform/jobs`
(`JobQueue`, `WebhookService`) as-is, no new authority created, and explicitly
does not merge or retire the pre-existing `server-scheduler.js` authority
(deferred, see `../deferred-hardening.md`).
