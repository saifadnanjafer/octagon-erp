# Integration Queue — requests for LANE-A to apply to shared files

Format: `- [ ] (TASK_ID) <exact edit, exact file, exact location>`
LANE-A applies at session start/end, checks the box, commits.

<!-- append requests below this line -->
- [x] (T3.1) server.js near the top after `const jarvisSecurity = require('./server-jarvis-security');`: add `const { installOctagonScheduler } = require('./server-scheduler');`
- [x] (T3.1) server.js before `const server = http.createServer(...)`: add `let octagonScheduler = null;`
- [x] (T3.1) server.js inside the request handler immediately after `if (jarvisSecurity.handle(req, res, requestUrl)) return;`: add `if (octagonScheduler && octagonScheduler.handle(req, res, requestUrl)) return;`
- [x] (T3.1) server.js after `initializeDatabase();`: add `octagonScheduler = installOctagonScheduler({ sqliteDb: dbSync, loadDbForMutation, saveDb, makeId, sendJson, readRequestBody, requireRoleSession, isLocalRequest, createDatabaseBackup, backupStatusSnapshot, serverStatusSnapshot, routeStaticSnapshot, dbFile: DB_FILE, sqliteDbFile: SQLITE_DB_FILE, backupDir: BACKUP_DIR });`
- [x] (T3.1) server.js in `apiProtectionMatrix()`: add scheduler rows for `GET /api/cron/status`, `POST /api/cron/run`, and `POST /api/cron/alerts/dismiss` as local/system-admin protected scheduler endpoints.
- [x] (T3.1) index.html after `modules/work-orders.js`: add `<script src="modules/scheduled-alerts.js?v=20260712-t3.1-v1"></script>`
- [x] (T3.2) index.html in `<head>` with the other module stylesheets: add `<link rel="stylesheet" href="modules/import-wizard.css?v=20260712-t3.2-v1">`
- [x] (T3.2) index.html after `app.js` in the additive module script block: add `<script src="modules/import-wizard.js?v=20260712-t3.2-v1"></script>`
- [x] (T3.3) index.html after `modules/schema-registry.js` and before `app.js`: add `<script src="modules/acl-client.js?v=20260712-t3.3-v1"></script>` so `Acl.can()` is available to app/module UI code.
- [ ] (T3.3) server.js near startup: load `acl.json` server-side and expose a helper equivalent to `Acl.can(group, action, role)` using the request session role.
- [ ] (T3.3) server.js in `/api/db`, `/api/collection`, and `/api/record` write paths: map touched collections to ACL groups from `acl.json`, reject or strip writes where the session role does not have `write`, and log the rejection with actor, collection, group, and endpoint.
- [ ] (T3.3) server.js in `apiProtectionMatrix()`: add ACL enforcement notes for `/api/db`, `/api/collection`, and `/api/record`.
- [x] (T3.4) index.html after `modules/schema-registry.js` and before `app.js`: add `<script src="modules/state-registry.js?v=20260712-t3.4-v1"></script>` so future modules can call `OctagonStates.transition()`.

<!-- T3.3 server-side ACL enforcement (3 remaining items above) is a substantial
     new implementation, not just wiring — deferred to its own careful pass
     since it touches the same write paths T1.3's guard already covers.
     Client-side Acl.can()/acl.json are live; only the server enforcement
     itself is still pending. -->
