# Phase 02 Unresolved Risks

**Phase 02 closure status:** CLOSED  
**Verified:** 2026-07-22  
**Branch:** `remediation/phase-02-final-closure`

The closure gates that were open in the earlier partial checkpoint are now
resolved. The items below are the remaining accepted risks that were explicitly
recorded as non-blockers in `PHASE_02_CLOSURE.md` and
`runtime-authority-cutover-final.md`.

## Accepted residual risks (not closure blockers)

1. **Payroll, attendance, timesheet, and payroll-dependent employee records**
   remain frozen and were intentionally outside the Phase 02 authority boundary.

2. **PostgreSQL is a declared stub:** Phase 02 migrations and runtime paths are
   verified on SQLite. PostgreSQL compatibility is documented but not exercised
   in this phase.

3. **External durable worker topology:** bounded leases, retries, dead-letter,
   and crash-recovery contracts pass in tests and the runtime bridge. Full
   deployment-level supervision (separate worker processes, queue back-ends,
   observability) remains an operational follow-up.

4. **SAML and passkeys:** SAML is rejected by the adapter until an approved
   ADR and threat model are produced. Passkeys have no local source/threat model.

5. **`GET /api/auth/options`** exposes only the login picker fields (id, login,
   name, locale) required by the shell. It does not expose credentials, secret
   material, or session tokens.

6. **`/uploads/` binary compatibility reads** remain until file metadata is moved
   to the canonical file service. Access is still permission-gated.

7. **Non-SQLite degraded mode** is fail-closed: governed paths are stripped from
   the legacy JSON store when SQLite is unavailable. This is a documented
   degradation, not a production path.

## Closure statement

Phase 02 is closed. The HIGH risks from the previous partial checkpoint
(duplicate runtime governance writer, incomplete live caller cutover, and
incomplete browser evidence) were resolved by the server-side strangler,
migration 013, the client cutover, and the expanded live browser evidence suite.
The remaining risks above are accepted and recorded. Phase 03 is not started
and is not authorized by this closure.
