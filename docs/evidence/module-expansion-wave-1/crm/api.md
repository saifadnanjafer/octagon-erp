# CRM API

Governed read routes:

- `GET /api/v1/crm/leads[/:id]`
- `GET /api/v1/crm/opportunities[/:id]`
- `GET /api/v1/crm/activities[/:id]`
- `GET /api/v1/crm/pipelines`
- `GET /api/v1/crm/stages`
- `GET /api/v1/crm/customer_360/:party_id`
- `GET /api/v1/crm/scoring_rules`
- `GET /api/v1/crm/score_history/:lead_id`
- `GET /api/v1/crm/reports?type=pipeline_summary|lead_conversion|activity_summary`

Commands use `POST /api/v1/action/:actionId`. The browser client strips
untrusted identity/scope fields and supplies an idempotency key.

The activity query uses canonical `state` and `assigned_user_id` columns. Stage
queries scope through the owning pipeline because stages do not duplicate a
company column.
