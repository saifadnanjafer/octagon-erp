# Local Source Inventory

| Source | Absolute path | Use in this remediation | License/provenance decision |
|---|---|---|---|
| Octagon ERP | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp` | target repository and operational source database | project-owned; changed |
| Phase 04 attempt | Git commit `93067bc1f12553e4b73e26297e47448818c22cd8` | preserved schema/domain foundation; audited claims | project history |
| Phase 03 final cutover | Git commit `e3f23fdecf218c2fe9cc955bf9e9cb7f00057d23` | finance/runtime prerequisite and StockAccounting target | project history |
| Existing remediation commits | `51a49203...`, `56e273f1...` | inherited evidence and partial implementation; independently re-audited | project history |
| Commercial VNext | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\octagon-erp-commercial-vnext` | background source-composition reference inherited from earlier work | no new file copied in this run |
| Shared COMPANY storage | `C:\Users\Zahraa dlbooz\Downloads\odoo-19.0\COMPANY` | canonical location for non-runtime archives/backups | no project-local backup created |
| OS temporary directory | `%LOCALAPPDATA%\Temp\octagon-phase04-*` | disposable database copies and test databases | removed after proof unless a test explicitly owns cleanup |

No Odoo, ERPNext, NocoBase, RuoYi, AureusERP, IDURAR, or other external donor source was copied during this independent run. Domain behavior was implemented against Octagon's existing code/contracts and tested locally. The donor ledger therefore records reference-only/no-copy status rather than implying a new provenance chain.
