# Import, Export, Print, Documents, and Public Forms Report

`platform/data-exchange/index.mjs` provides dry-run reports, row-level errors,
idempotent command execution, permission-aware export, field masking, formula
injection protection, RTL print rendering, registered templates, and public-form
anti-abuse controls. Protected documents are not generic CRUD targets.

Evidence: `node tests/phase02/collaboration-files-jobs.test.mjs` **29/29 passed**,
including import dry-run/execute, idempotency, field masks, export scope, formula
injection, RTL escaping, and public-form abuse controls.

