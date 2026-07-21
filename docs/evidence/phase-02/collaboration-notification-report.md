# Collaboration and Notification Report

`platform/collaboration/index.mjs` owns record history, snapshots, amendment
lineage, chatter, followers, mentions, and activities. `platform/notifications/`
owns templates, preferences, in-app inbox, channel delivery, retry/dead-letter,
provider health, and security-notice override. All payloads inherit record scope
and field masking; external delivery is outbox-bound.

Evidence: `node tests/phase02/collaboration-files-jobs.test.mjs` **29/29 passed**,
covering real-change history, masked history/snapshots, chatter permission,
mentions/followers, activities, dedupe, preference rules, timeout/retry/dead-letter,
masked notifications, and rollback with no send.

