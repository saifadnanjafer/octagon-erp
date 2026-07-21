# Phase 02 Unresolved Risks

1. **Runtime authority cutover is incomplete (high priority):** the canonical
   identity/session/permission/settings/workflow services are proven in
   disposable SQLite integration tests, but the live legacy `server.js` login,
   session, ACL, and several P0 adapters remain runtime authorities. The full
   cutover requires a controlled migration, real HTTP/browser proof, parity,
   rollback, and owner approval. Gate B, H, and I remain partial.
2. **Browser automation is unavailable:** browser evidence is contract-level and
   explicitly not counted as server authorization proof.
3. **PostgreSQL is a declared stub:** all Phase 02 migrations are SQLite-only
   and PostgreSQL compatibility remains unproven.
4. **Frappe source is absent locally:** Frappe-specific behavior is clean-room
   specified from the Phase 02 contract and ERPNext usage; no Frappe code was
   copied.
5. **External worker topology is not separately supervised:** durable leases,
   retries, dead-letter, and crash recovery exist, but deployment-level worker
   supervision remains open.
6. **SAML and passkeys are deferred:** SAML is explicitly rejected by the
   adapter until an approved ADR; passkeys have no local source/threat model.

No unresolved critical/high vulnerability was found in the focused disposable-
database security suite. Risk #1 is a closure/cutover gap, not a claim of
runtime security acceptance.

