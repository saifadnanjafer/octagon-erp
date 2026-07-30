# M2 — CRM

**Status: NOT DELIVERED. Design complete, implementation blocked on a scope correction.**
**Date:** 2026-07-30

## What happened

I built migration `065_crm_pipeline_and_activities` plus a CRM service layer and a
10-case test suite, on the assumption — taken from the Wave 1 brief — that CRM was
a new module to be built from scratch.

That assumption was wrong. **A CRM already exists in the canonical schema.**

The migration failed on its first run with `no such column: reference`, because
`CREATE TABLE IF NOT EXISTS crm_leads` silently did nothing: the table was already
there.

## What already exists

| Table | Created by | Columns |
|---|---|---|
| `crm_leads` | `039_crm_sales_contracts_commissions` | id, company_id, name, partner_id, contact_name, email, phone, stage, expected_revenue, probability, salesperson_id, created_at, updated_at |
| `crm_opportunities` | `046_sales_lifecycle_expansion` | id, company_id, branch_id, lead_id, party_id, name, stage, expected_value, probability, owner_user_id, expected_close_date, status, lost_reason, version, created_at, updated_at |
| `crm_activities` | `039` | id, lead_id, activity_type, summary, done, due_date, created_at |
| `crm_opportunity_activities` | `046` | id, opportunity_id, activity_type, summary, done, due_date, created_at |

`sale_orders.source_opportunity_id` also already exists — the canonical Sales
authority is already wired to accept an opportunity reference.

## Why the work was withdrawn rather than shipped

The draft migration would have created a **second, parallel CRM**: its own
`crm_leads` with a different column vocabulary (`reference`/`title`/`state` versus
the existing `name`/`stage`/`status`), its own opportunities, its own activities.

That is the exact failure the Wave 1 architecture rules prohibit — "New modules
must not create duplicate authorities" — and it is the same class of mistake the
cutover work spent three checkpoints preventing for Finance and Inventory. Two
lead tables would mean two answers to "who is this customer", diverging the moment
either is written to.

Shipping it would also have been silently destructive in a subtler way: because
`CREATE TABLE IF NOT EXISTS` no-ops, the migration would have appeared to succeed
on any database where the tables already existed, while the new service layer
wrote to columns that were never added.

The migration has been **removed from the chain**. The branch is green:

```
tests/module-expansion/registry.test.mjs  → 6/6 pass
npm run test:migration                    → 5 files, 5 pass, 0 fail
```

## What the draft is worth keeping

Preserved as design input, deliberately outside `database/migrations/` so it
cannot enter the chain:

- `docs/design/module-expansion-wave-1/065_crm_DRAFT_NOT_IN_CHAIN.mjs.txt`
- `docs/design/module-expansion-wave-1/crm-service-DRAFT.mjs.txt`

The genuinely new entities in the draft do **not** exist in 039/046 and are still
needed:

`crm_pipelines` · `crm_pipeline_stages` · `crm_sales_teams` · `crm_lead_sources` ·
`crm_lost_reasons` · `crm_competitors` · `crm_customer_segments` · `crm_tags` ·
`crm_campaigns` · `crm_interactions` · `crm_opportunity_stage_history`

The service-layer design also holds up and should be reused: qualification
required before conversion, conversion matching an existing Party on email/phone
before creating one, additive customer role so a supplier can become a customer,
lost-reason required, won-is-final, stage-belongs-to-pipeline guard, and
quotation-party-match guard.

## Correct approach for the next session

Migration 065 must **extend**, not replace:

1. `ALTER TABLE crm_leads ADD COLUMN` for the missing facts — `reference`,
   `source_id`, `campaign_id`, `team_id`, `score`, `qualified_at`/`by`,
   `converted_at`/`by`, `converted_party_id`, `converted_opportunity_id`,
   `lost_reason_id`, `duplicate_of_lead_id`, `tags`. Keep `name` and `stage`;
   do not introduce `title`/`state` synonyms.
2. `ALTER TABLE crm_opportunities ADD COLUMN` for `reference`, `pipeline_id`,
   `stage_id`, `team_id`, `source_id`, `campaign_id`, `segment_id`,
   `competitor_id`, `currency`, `quotation_order_id`. Keep `expected_value`,
   `status` and `version`.
3. `CREATE TABLE` only the eleven genuinely new tables listed above.
4. Map the existing free-text `stage` to the new `crm_pipeline_stages` rows via a
   data step, and keep `stage` in sync so nothing already reading it breaks.
5. Rewrite the service layer against the real column names.
6. Re-run the 10 drafted test cases, which remain valid at the behavioural level.

Note `crm_opportunities.version` already exists — the existing schema anticipates
optimistic concurrency, which the M9 concurrency suite should use rather than
inventing its own guard.

## Honest status

**M2 is not complete.** No CRM schema, service or UI was delivered in this
session. What was delivered is the discovery that the module already partly
exists, a validated design for extending it, and a branch that stays green.

The Wave 1 brief's premise — eight greenfield modules — should be re-checked
against the schema for the other seven before they are built. `documents`,
`knowledge` and `appointments` in particular may have existing counterparts, since
the legacy application shipped pages with those names.
