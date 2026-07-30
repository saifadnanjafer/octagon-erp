# CRM permissions

Runtime permission namespace:

- `perm_crm_read`
- `perm_crm_create`
- `perm_crm_update`
- `perm_crm_assign`
- `perm_crm_convert`
- `perm_crm_manage`

CRM GET routes require `perm_crm_read`. Each mutation action declares the
smallest applicable CRM permission in `platform_actions`; all action routes also
require the platform write boundary.

The runtime no longer auto-enables CRM while registering handlers. A disabled
module fails with `MODULE_NOT_ENABLED`. The disposable browser fixture grants
the Sales role all six CRM permissions and the Viewer role read only. Chromium
proved that Sales can create a Lead and Viewer cannot.

Company isolation, server-derived scope, missing permission, and disabled-module
denials are covered by the CRM domain, runtime, API, and browser tests.
