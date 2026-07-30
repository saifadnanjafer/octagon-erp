# M2.3–M2.4 — CRM Domain Services

**Status:** Lead lifecycle, duplicate detection, merge, scoring and Party conversion **COMPLETE AND PROVEN**
**Date:** 2026-07-30

## Modules

`platform/domains/crm/`

| File | Responsibility |
|---|---|
| `errors.mjs` | 30 typed error codes — the HTTP layer, UI and concurrency tests all branch on `code`, so a message string is not an interface |
| `shared.mjs` | scope, ids, normalisation, validation, numbering, audit, outbox, idempotency |
| `duplicate-service.mjs` | deterministic matching across leads and canonical Parties |
| `lead-service.mjs` | Lead lifecycle commands |
| `scoring-service.mjs` | rules-based explainable scoring |
| `conversion-service.mjs` | atomic Lead → Party → Opportunity |

## Canonical reuse

The ActionExecutor's `trustedActionInput` already strips client-supplied
company/actor and substitutes server-derived values, rejecting spoofs before a
handler runs. The services read `input.company_id` / `input.actor` as trusted
facts and assert presence, so direct test calls cannot run unscoped either.

| Concern | Authority used | Not built |
|---|---|---|
| Customer identity | `parties` + `party_roles` | no CRM customer master |
| Numbering | `platform_sequences` | no second numbering authority |
| Audit | `platform_audit_log` | — |
| Events | `platform_outbox` | — |
| Idempotency | `action_idempotency` | — |

## Numbering

`LEAD-YYYY-#####` / `OPP-YYYY-#####`, company-scoped, allocated inside the
caller's transaction via `platform_sequences`. Proven: two leads in one company
get `00001`/`00002`; a second company restarts at `00001`; rows appear under
`module_id='crm'` in the existing sequence table.

## Duplicate detection — deterministic bands

| Band | Trigger | Permitted action |
|---|---|---|
| `exact` | email or normalised phone identical | reuse Party automatically |
| `high_confidence` | organisation + a contact channel | reuse Party automatically |
| `possible` | organisation only | **refuse — require explicit choice** |
| `none` | nothing matches | create one Party |

Phone normalisation folds Arabic-Indic digits (`٠٧٧٠ ١٢٣ ٤٥٦٧` → `07701234567`)
and strips formatting; organisation normalisation drops legal suffixes
(`Rafidain Co.` → `rafidain`). Company-scoped: another company's parties are
invisible.

**Nothing auto-merges.** Two people at one company are a legitimate pair of
leads; collapsing them silently destroys a real contact.

## Lead lifecycle

`new → contacted → qualified → converted`, alternates `unqualified`,
`duplicate`, `archived`.

Guards proven: contact and qualify are idempotent; disqualify requires a *valid*
lost reason; archived leads reject mutation until restored; a converted lead
cannot be reopened; optimistic `version` conflicts are rejected with
`VERSION_CONFLICT` and the loser does **not** overwrite.

### Merge

Losers become `duplicate` and are **kept, never deleted** — their history is how
anyone later explains where a customer came from. Activities, interactions and
tags move to the survivor; blank survivor fields are filled from the loser while
already-decided fields are left alone. Self-merge is rejected.

## Scoring — explainable by construction

Eight seeded rules over `crm_scoring_rules`. Every point traces to a named rule
with bilingual labels, so "why is this lead 65?" has an itemised answer. Scores
are bounded 0–100 and written to `crm_score_history` on every change.

Manual override requires `crm:manage_scoring` **and a reason** — an unexplained
manual score is indistinguishable from a mistake. No model, no inference, no
demographic guessing.

## Lead conversion — atomic

Ordering is deliberate: the Lead's state is written **last**, so any failure
above leaves it `qualified` and retryable.

Proven:

| Case | Result |
|---|---|
| New customer | Party created, `customer` role added, Opportunity opened at stage probability, weighted = expected × probability |
| Known customer (exact email) | **reuses** `party_known`, party count unchanged, `customer` role added **alongside** existing `supplier` |
| Ambiguous (organisation only) | **refused** `PARTY_AMBIGUOUS`; lead stays `qualified`; zero opportunities created |
| Ambiguous + explicit `party_id` | proceeds, `matchBasis: 'explicit'` |
| Unqualified lead | `LEAD_NOT_QUALIFIED` |
| Second conversion | `LEAD_ALREADY_CONVERTED`, still exactly one opportunity |
| Mid-command failure (bad pipeline) | rollback leaves **no orphan Party, no orphan role, no orphan Opportunity, no conversion link**, lead still `qualified` |
| Idempotency key replay | returns the original result, `replayed: true`, still one opportunity |
| Cross-company | `LEAD_NOT_FOUND` even with a valid id |

Audit (`crm.lead.convert`) and outbox (`crm.lead.converted`) are asserted
present after a successful conversion.

## Tests

`tests/module-wave-1/crm/domain.test.mjs` — 14 cases:

```
PASS: scopeIsRequired                     PASS: conversionCreatesParty
PASS: validation                          PASS: conversionReusesExactParty
PASS: numberingIsScopedAndSequential      PASS: conversionRefusesAmbiguousMatch
PASS: leadLifecycle                       PASS: conversionGuardsAndAtomicity
PASS: optimisticConcurrency               PASS: conversionIdempotencyKey
PASS: duplicateDetectionBands             PASS: crossCompanyLeadIsInvisible
PASS: leadMergeKeepsHistory
PASS: scoringIsExplainable
```

### Regression

```
npm run test:migration        → 5 files, 5 pass, 0 fail
CRM migration suite           → 8/8
registry suite                → 6/6
precommit                     → passed
```

## Defect found and fixed

`recallIdempotent`/`rememberIdempotent` were written against an assumed
`action_idempotency` shape. The real table is
`(id, actor_id, company_id, tenant_id, operation_type, idempotency_key, payload_hash, response_json, status_code, created_at, expires_at)`
with `UNIQUE(actor_id, company_id, operation_type, idempotency_key)`.

Worse, both functions wrapped the failure in `try/catch` and returned `null` —
so idempotency was **silently disabled** and a replayed conversion would have hit
the `LEAD_ALREADY_CONVERTED` guard instead of returning the original result. The
catch is removed: idempotency is a correctness guarantee, and a quietly
non-functional cache is worse than a loud failure.

## Not yet done

ActionExecutor registration, HTTP query layer, runtime permission enforcement,
Opportunity/Pipeline/Stage/Activity services, Sales integration, Work Item
integration, Customer 360, reporting, shell UI, failure injection, multi-process
concurrency, browser acceptance.

**Classification: PARTIAL — REMEDIATION REQUIRED.**
