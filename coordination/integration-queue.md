# Integration Queue — requests for LANE-A to apply to shared files

Format: `- [ ] (TASK_ID) <exact edit, exact file, exact location>`
LANE-A applies at session start/end, checks the box, commits.

<!-- append requests below this line -->
- [ ] (T3.1) server.js near the top after `const jarvisSecurity = require('./server-jarvis-security');`: add `const { installOctagonScheduler } = require('./server-scheduler');`
- [ ] (T3.1) server.js before `const server = http.createServer(...)`: add `let octagonScheduler = null;`
- [ ] (T3.1) server.js inside the request handler immediately after `if (jarvisSecurity.handle(req, res, requestUrl)) return;`: add `if (octagonScheduler && octagonScheduler.handle(req, res, requestUrl)) return;`
- [ ] (T3.1) server.js after `initializeDatabase();`: add `octagonScheduler = installOctagonScheduler({ sqliteDb: dbSync, loadDbForMutation, saveDb, makeId, sendJson, readRequestBody, requireRoleSession, isLocalRequest, createDatabaseBackup, backupStatusSnapshot, serverStatusSnapshot, routeStaticSnapshot, dbFile: DB_FILE, sqliteDbFile: SQLITE_DB_FILE, backupDir: BACKUP_DIR });`
- [ ] (T3.1) server.js in `apiProtectionMatrix()`: add scheduler rows for `GET /api/cron/status`, `POST /api/cron/run`, and `POST /api/cron/alerts/dismiss` as local/system-admin protected scheduler endpoints.
- [ ] (T3.1) index.html after `modules/work-orders.js`: add `<script src="modules/scheduled-alerts.js?v=20260712-t3.1-v1"></script>`
- [ ] (T3.2) index.html in `<head>` with the other module stylesheets: add `<link rel="stylesheet" href="modules/import-wizard.css?v=20260712-t3.2-v1">`
- [ ] (T3.2) index.html after `app.js` in the additive module script block: add `<script src="modules/import-wizard.js?v=20260712-t3.2-v1"></script>`
