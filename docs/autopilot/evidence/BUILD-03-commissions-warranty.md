# BUILD-03 evidence — commissions and warranty

The existing `sales_commission_events` and lifecycle handlers remain the sole
commission authority. This slice adds a canonical warranty case registry on
the sales domain, with no parallel service, inventory, or finance writer.

Delivered:

- migration `066_commercial_warranty_registry` registers the warranty entity
  and create/submit/approve/close actions;
- warranty cases are idempotent and transition only through
  `draft -> submitted -> approved -> closed`;
- disposable coverage proves migration/action registration, replay safety,
  and the guarded lifecycle on a temporary database.

Validation: `npm.cmd run test:build-03` passed (1/1).
