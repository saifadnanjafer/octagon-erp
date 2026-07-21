# Phase 02 Unresolved Risks

1. **Browser automation is unavailable:** browser evidence is contract-level and
   explicitly not counted as a real-login pixel proof. A future Puppeteer/Playwright
   run is recommended when the dependency is available.
2. **PostgreSQL is a declared stub:** all Phase 02 migrations are SQLite-only
   and PostgreSQL compatibility remains unproven.
3. **Frappe source is absent locally:** Frappe-specific behavior is clean-room
   specified from the Phase 02 contract and ERPNext usage; no Frappe code was
   copied.
4. **External worker topology is not separately supervised:** durable leases,
   retries, dead-letter, and crash recovery exist, but deployment-level worker
   supervision remains open.
5. **SAML and passkeys are deferred:** SAML is explicitly rejected by the
   adapter until an approved ADR; passkeys have no local source/threat model.

The runtime authority cutover (formerly risk #1) is now complete: the legacy
`server.js` session/ACL/local-bypass paths are retired and the Phase 02 platform
authority is the sole runtime authority for identity, sessions, authorization,
and related HTTP routes. No unresolved critical/high vulnerability was found in the
focused disposable-database security suite.