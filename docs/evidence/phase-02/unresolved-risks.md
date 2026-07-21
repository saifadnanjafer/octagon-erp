# Phase 02 Unresolved Risks

1. **HIGH — duplicate runtime governance writer:** `app.js` retains many
   `saveData()` calls that post the full legacy blob to `/api/db`. This overlaps
   the platform repositories/services without atomic reconciliation or a
   retirement commit. It blocks Gate I and Phase 02 closure.
2. **HIGH — incomplete live caller cutover:** settings/secrets, custom fields,
   workflows, approvals, chatter, notifications, files, API keys, and
   jobs/webhooks are proven in disposable platform tests but remain
   canonical-test only for the current shell/server path.
3. **HIGH — browser evidence boundary:** live evidence covers only three
   scenarios. Responsive, English/LTR, revocation, tenant/company isolation,
   field masking, workflow/approval, inbox/file, and unrelated deep-link
   scenarios remain unproven in a real browser.
4. **MEDIUM — PostgreSQL is a declared stub:** Phase 02 migrations are
   SQLite-only and PostgreSQL compatibility remains unproven.
5. **MEDIUM — external worker topology:** durable leases, retries, dead-letter,
   and crash recovery exist in the platform contracts, but deployment-level
   worker supervision remains open.
6. **MEDIUM — SAML and passkeys:** SAML is rejected by the adapter until an
   approved ADR; passkeys have no local source/threat model.

The focused suites and live browser evidence pass, but these risks are not
resolved and Phase 02 remains `PARTIAL — NOT CLOSED`. Payroll and attendance
remain frozen and Phase 03 is not started.
