# Engineering Handoff — Page Specification Catalog Wave 2

## Reproducibility

- Documentation branch: `codex/octagon-page-spec-catalog`
- Catalog start/baseline SHA: `aa730dd23462aab3e90b70ad2db1bf6cc945ca99`
- Engineering reference SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`
- Scope: documentation files under `docs/page-specs/**` only.

## Completed documentation batch

- Deepened **32** BUILD-09 operational page specifications.
- Added synchronized coverage, contradiction, and handoff artifacts.
- Enriched every manifest page with `pageId/specPath/domain/kind/canonicalStatus/parent/aliases/upstream/downstream/capabilitiesOwned/capabilitiesConsumed/sourceFiles/catalogBaselineSha/lastVerifiedSha/engineeringReferenceSha/functionalStatus/usabilityStatus/recommendedDisposition`.
- Regenerated `INDEX.md` from the manifest population.

## Engineering facts to preserve

- Build-09 resources are server-scoped by company and active warehouse.
- Canonical Inventory/Quality remains authoritative for stock and inspection effects; page workflows store orchestration state and canonical references.
- The highest-risk remaining work is evidence: direct lifecycle browser proof, fixture readiness, maker-checker/role isolation, and responsive scanner behavior.

## Next recommended documentation wave

1. Reconcile the next highest-priority undocumented/THIN ops pages against their real renderer and API/domain modules.
2. Attach any newly discovered cross-page edges to `CROSS_PAGE_CONTRADICTIONS.md` rather than silently changing ownership.
3. Keep engineering changes in the dedicated engineering worktree and update the reference SHA before researching a later wave.

# Wave 3 — Engineering Handoff

## Reference and scope

- Catalog start SHA: `3c047bb0d04985cd88a536d4dbb16b74d2d6405a`.
- Engineering reference SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Deep-reviewed pages: **26**; previous Wave 2 pages preserved.
- Documentation-only scope: files under `docs/page-specs/**` in the catalog worktree.

## Highest-value findings

1. **P0 authority conflicts:** local Sales Contracts, Workshop Ledger, Finance Installments, and Field Service surfaces can imply or perform writes outside canonical Sales/Finance/Service authorities. Freeze or migrate before adding workflow breadth.
2. **P1 readiness mismatch:** Workshop Readiness checks `sales_orders` while canonical Sales uses `sale_orders`; this can produce false readiness.
3. **P1 commercial-to-operations gap:** Sales delivery and Finance invoice-request edges are evidenced, but Sales-to-workshop/service and Workshop-to-Procurement edges are not verified.
4. **P1 duplicate task/job vocabulary:** canonical Project tasks delegate to Work Items, while legacy project/task/work-order surfaces remain visible.
5. **P1 procurement closure proof:** canonical requisition → RFQ → order → receipt → match → bill actions exist; one complete browser/API evidence chain with Finance posting is still required.

## Recommended implementation order

- Establish canonical authority decisions for contracts, field service, workshop ledger, installments, and task/job vocabulary.
- Correct and regression-test the readiness table authority.
- Prove the three high-value flow chains in `BUSINESS_FLOW_MAP.md` before creating more pages.
- Keep Finance as the sole GL writer and require source-document/idempotency references for every operational handoff.

# Wave 4 — Engineering Handoff

## Reference and scope

- Catalog starting SHA: `10152af1772bf9efba43cc42bb4226b73b63abca`.
- Engineering reference SHA: `25c24df753962bbf3c13301eed71624bc0ee39b6`.
- Deep-reviewed pages: **26**; Waves 2-3 preserved.
- Documentation-only scope: `docs/page-specs/**` in the isolated catalog worktree.

## Highest-value findings

1. **P0 Finance authority:** local Cashbox/Expenses/Income helpers remain visible beside canonical Finance documents and journal posting. Treat local rows as legacy/provisional until migrated or retired.
2. **P0 Workflow authority:** durable WorkflowRegistry/WorkflowRuntime is a strong canonical runtime, but the legacy canvas/localStorage surface must become an adapter with publication/run proof.
3. **P1 Finance page wiring:** domain APIs and tests exist, but many finance navigation pages lack page-specific API evidence; do not infer functionality from shared backend existence.
4. **P1 Consolidation/Treasury/Intercompany:** domain boundaries are present and tested, but page-level lifecycle and isolation edges remain incomplete.
5. **P1 Service Kiosk and Tax:** domain/test evidence exists; direct page-to-domain handoffs and source lineage still need bounded proof.

## Recommended next implementation order

- Resolve P0 Finance and Workflow authority conflicts before adding more local actions.
- Select canonical consolidation group/run/report hierarchy and treasury proposal execution contract.
- Prove intercompany pair isolation and Procurement-to-AP closure from the prior wave.
- Attach direct page browser/API evidence to the pages currently classified THIN or PARTIALLY_CONNECTED.
