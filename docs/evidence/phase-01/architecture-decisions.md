# Phase 01 Architecture Decisions

**Phase:** 01  
**Date:** 2026-07-21  

---

## ADR-P01-001: One canonical migration runner

**Decision:** Build one migration runner in `database/migration-runner/index.mjs` based on VNext's runner, with dependency ordering, checksums, locks, transaction policy, and rollback support.

**Rationale:**
- Eliminates runtime DDL and ad-hoc schema creation in `server.js`.
- Provides a deterministic fresh-install and upgrade path.
- Keeps VNext migrations as evidence without editing them.

**Consequences:**
- All schema changes must go through a numbered migration.
- PostgreSQL dialect adapter is required later but the contract is stable.

---

## ADR-P01-002: One module registry with lifecycle states

**Decision:** Implement `platform/kernel/modules/index.mjs` with `available → installed → licensed → enabled → visible → authorized` vocabulary.

**Rationale:**
- Phase 01 needs `installed` and `enabled`; later phases need license, visibility, and authorization.
- Prevents duplicate registry engines.

**Consequences:**
- Module disable removes routes/views/jobs from active registration without deleting data.
- Uninstall is blocked when dependent platform artifacts exist.

---

## ADR-P01-003: Entity registry separates metadata from storage

**Decision:** Entity descriptors live in `platform_entities`; records live in `x_records`.

**Rationale:**
- Matches NocoBase/VNext separation of collection metadata and storage.
- Allows custom fields to be stored in extension tables without runtime DDL on canonical tables.

**Consequences:**
- No runtime schema creation from entity metadata.
- Legacy collections are bridged read-only.

---

## ADR-P01-004: Generic CRUD only for safe entities

**Decision:** Generic create/update/delete is allowed only when `lifecycle_policy === 'generic'`.

**Rationale:**
- Protects workflow/state_machine/immutable/append_only documents from accidental generic mutation.
- Forces business transitions through registered actions.

**Consequences:**
- Existing business documents must declare their lifecycle policy correctly.
- Client buttons must bind to actions, not generic endpoints.

---

## ADR-P01-005: Sequence authority is transaction-neutral

**Decision:** `nextSeq` does not open its own transaction; the caller provides the transaction boundary.

**Rationale:**
- Allows sequence allocation to be atomic with the authoritative record creation.
- Avoids nested transaction issues with SQLite `DatabaseSync`.

**Consequences:**
- All future callers must wrap `nextSeq` in a transaction.

---

## ADR-P01-006: Outbox delivery preserves business commit

**Decision:** Outbox consumers run after the business transaction commits, inside a per-row delivery transaction.

**Rationale:**
- A consumer failure cannot roll back an already committed business transaction.
- Retries and dead-letter handling are explicit.

**Consequences:**
- Consumers must be idempotent.
- Exactly-once delivery relies on idempotency and audit, not transaction rollback.

---

## ADR-P01-007: Permission hook is deny-by-default

**Decision:** `platform/governance/permissions/index.mjs` denies access unless an explicit grant exists.

**Rationale:**
- Prevents silent access when permissions are not configured.
- Aligns with fail-closed requirement.

**Consequences:**
- Phase 02 must complete the full role/permission engine and migrate legacy `acl.json`.

---

## ADR-P01-008: Server-derived context only

**Decision:** Actor, company, branch, tenant, and correlation ID are derived from trusted server state or headers, never from request bodies.

**Rationale:**
- Prevents body spoofing of scope and identity.
- Required for audit and permission correctness.

**Consequences:**
- Phase 02 authentication/session layer must populate the same context shape.

---

## ADR-P01-009: No separate VNext product

**Decision:** VNext is used as project-owned source; all runtime authority lives in Octagon.

**Rationale:**
- Prevents duplicate engines and dual-write paths.
- Satisfies the "one product" invariant.

**Consequences:**
- VNext code is merged or adapted, not deployed as a parallel service.

---

## ADR-P01-010: Frozen zones remain untouched

**Decision:** Payroll, attendance, and employee records required by payroll are not modified in Phase 01.

**Rationale:**
- Avoids destabilizing live business behavior.
- Lets later domain phases own the cutover.

**Consequences:**
- These domains continue on their current authority until their owning phase.

---

## Next review

These decisions may be amended only through a formal ADR update in a subsequent phase.
