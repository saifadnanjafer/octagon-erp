# Business Calendar and SLA Report

`platform/sla/index.mjs` owns business calendars, working shifts, holidays,
pause/resume, calendar snapshots, business-time arithmetic, and restart-safe SLA
clocks. SLA calculations do not rely on wall-clock elapsed time when a calendar
is configured.

Evidence: `node tests/phase02/workflow-approvals.test.mjs` **31/31 passed**,
including arithmetic, holidays/split shifts, pause/resume, calendar snapshots,
and restart survival.

