# Checkpoint D2 — Engineering, BOM, Routings, Work Centers

Status: **DELIVERED AND PROVEN**

## What was built

| Layer | Path |
|---|---|
| Migration | `database/migrations/053_engineering_bom_routing_mrp.mjs` |
| BOM authority | `platform/engineering/bom.mjs` |
| Routings / work centers / ECO | `platform/engineering/routing.mjs` |
| MRP | `platform/engineering/mrp.mjs` (see `mrp-and-planning.md`) |
| Action registration | `platform/engineering/index.mjs` |
| Query surface | `platform/api/engineering.mjs` |
| Router wiring | `platform/api/index.mjs` (`/api/v1/{engineering,boms,routings,work-centers,mrp}/*`) |
| Runtime wiring | `platform-runtime-bridge.mjs` (`registerEngineeringActions`) |
| Client transport | `services/canonicalClient.js` (`CanonicalClient.engineering`, `.mrp`) |
| Visible workspace | `modules/canonical-engineering.{js,css}` mounted on `#pageMrp` |
| Tests | `tests/checkpoint-d-e/engineering_bom_routing_mrp.test.mjs` |

## Schema (migration 053)

15 tables: `boms`, `bom_versions`, `bom_lines`, `bom_line_substitutes`,
`engineering_change_orders`, `work_centers`, `work_center_resources`,
`routings`, `routing_versions`, `routing_operations`, `mrp_item_policies`,
`mrp_demands`, `mrp_runs`, `mrp_requirements`, `mrp_proposals`.

Registered: **2 modules** (`operations_engineering`, `operations_mrp`),
**14 entities**, **24 governed actions** (19 engineering + 5 MRP).

## BOM capabilities

Header with Arabic/English names, product, UOM, and type
(manufacturing / phantom / subcontract). Versions carry revision, base
quantity, effective from/to, yield percent, drawings, work instructions, and
an ECO link. Lines support component / by-product / co-product types, scrap
factor, phantom expansion with a child BOM, co-product cost share, and an
operation link. `bom_line_substitutes` holds approved alternates with a
conversion ratio and priority.

### Immutability — the core contract

A version is structurally editable **only** while `state='draft'` and
`consumed_at IS NULL`.

- `draft → review → approved → superseded` (plus `rejected`).
- Approving a new revision **automatically supersedes** the previous approved
  one, so exactly one version is ever effective. Proven by test: after
  approving revision 2, revision 1 is `superseded` with
  `superseded_by_id = v2`, and the count of approved versions is exactly 1.
- `markBomConsumed()` stamps `consumed_at` the first time production uses a
  version. After that the version can never be edited or rejected — the only
  path forward is a new revision plus supersession. This is what stops a
  posted production order's bill changing underneath it.
- **Separation of duties**: the actor who submitted a version cannot approve
  it (`BOM_SELF_APPROVAL_DENIED`, HTTP 403).

Structural guards: a BOM cannot consume its own product
(`BOM_SELF_REFERENCE`); a phantom line without a resolvable child BOM is
rejected (`BOM_PHANTOM_CHILD_REQUIRED`) so a requirement can never silently
vanish during explosion; an empty version cannot be submitted
(`BOM_VERSION_EMPTY`); only one open revision at a time
(`BOM_REVISION_ALREADY_OPEN`).

A new revision **copies the previous bill** rather than starting empty.

## Routing capabilities

Versioned exactly like BOMs, with the same immutability and
separation-of-duties contract (`ROUTING_VERSION_NOT_DRAFT`,
`ROUTING_VERSION_IMMUTABLE`, `ROUTING_SELF_APPROVAL_DENIED`).

Operations carry sequence, work center, resource, setup / cycle-per-unit /
queue minutes, labour and machine requirements, labour and machine rates,
predecessor sequence, subcontract flag + supplier party + service cost,
quality checkpoint + plan reference, work instructions, and attachments.

Guards: an operation must define setup or cycle time
(`ROUTING_OPERATION_TIME_REQUIRED`); duplicate sequences are rejected
(`ROUTING_OPERATION_SEQUENCE_DUPLICATE`); a subcontract operation without a
supplier party is rejected (`ROUTING_SUBCONTRACT_PARTY_REQUIRED`).

## Work centers — one standard-cost authority

Work centers carry capacity, efficiency, working hours, WIP location,
absorption account, and machine / labour / overhead hourly rates.

The machine rate is **mirrored into the Checkpoint D1 `project_cost_rates`
table** (`rate_scope='work_center'`) on create and update, so there is exactly
ONE standard-cost authority for labour and machine time across Projects and
Manufacturing — and payroll is still never consulted. Proven by test: updating
the work centre from 25 to 30 updates `project_cost_rates` to 30.

Routing operations default their rates from the work centre, so a rate change
does not require touching every operation.

## Engineering change orders

`ECO-NNNN` numbering, change type (bom / routing / both), reason,
attachments, and a decision trail.

**Approving an ECO opens a new governed draft revision** of the BOM and/or
routing it authorises — it never edits an approved version in place. Proven by
test: after ECO approval the resulting version is revision 2 in `draft`, and
the originally approved revision 1 is still `approved` and untouched. A decided
ECO is terminal (`ECO_CLOSED`).

## Test result

```
node --test tests/checkpoint-d-e/engineering_bom_routing_mrp.test.mjs
pass 19   fail 0
```

## Live browser proof

Against a **disposable** database (`scripts/preview-authenticated-server.mjs`,
port 8093), authenticated as the new `test.manufacturing` manufacturing-manager
role, over real HTTP:

```
work center (WC-BR2, machine rate 22)
  -> BOM-00001 created (draft, 1 line)
  -> submit (review)
  -> approve as SAME actor  => DENIED 403 BOM_SELF_APPROVAL_DENIED
  -> approve as test.sysadmin => approved
  -> add line to approved version => DENIED 409 BOM_VERSION_NOT_DRAFT
  -> routing created; operation inherited machine_rate_per_hour = 22
  -> routing approve by submitter => DENIED ROUTING_SELF_APPROVAL_DENIED
  -> dashboard: 1 BOM, 1 approved, 0 draft, 1 routing, 1 work center
```

The workspace mounts in the original shell on `#pageMrp`: 12 tabs, 6 KPI
tiles, `document.documentElement.dir === "rtl"`, and a real data row
`BOM-00001 Browser BOM manufacturing 1 approved`.

## Known limitations

- `bom_line_substitutes` is written by `engineering:bom:create` /
  `add_line` (via the `substitutes` array) and is read by the query surface,
  but substitute *selection during issue* belongs to material issue
  (Checkpoint D3) and is not yet implemented.
- By-product and co-product lines are modelled and stored, and `cost_share_percent`
  is captured, but joint-cost allocation is a production-costing concern
  (Checkpoint D3) and is not yet computed.
- `routing_operations.quality_plan_ref` is a free reference until the Quality
  module (Checkpoint D6) exists to be referenced.
