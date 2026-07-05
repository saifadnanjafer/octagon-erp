# WORKSHOP OMNISYSTEM MASTER SPEC
## Master Design Document (MD) for a Local-First, Arabic-First Workshop Operating System

**Project Codename:** PENTAGON OMNISYSTEM  
**Owner:** Saif / الورشة  
**Version:** 1.0  
**Date:** 2026-04-12  
**Document Type:** Master Design Document (MD)  
**Language Direction:** Arabic-first, RTL-native, English-supported  
**Deployment Style:** Local-first, offline-capable, self-hostable, modular  
**Scope:** Full workshop operating system for governance, HR, payroll, attendance, inventory, projects, production, QC, maintenance, costing, procurement, CRM, WhatsApp intelligence, reporting, and auditability.

---

# 1. Executive Intent

This system is not a payroll app, not a spreadsheet replacement, and not a simple ERP.
It is a **workshop operating brain** designed specifically for a real manufacturing/design/signage workshop with mixed workflows:

- signage and lighting
- printing and packaging
- CNC / laser / fiber / galvo work
- customized products
- architectural decor and execution
- maintenance and tools
- field installation
- HR and payroll
- inventory, procurement, and cash discipline
- project traceability
- operational intelligence from noisy real-world data

The workshop already owns strong knowledge, machines, procedures, internal regulations, maintenance schedules, payroll logic, and operational experience. What is missing is **a single coherent execution system** that turns all of this into control.

This MD defines that system.

The design goal is aggressive:

> Build a massive, workshop-native operating platform that preserves the current salary and timesheet logic, extends it without breaking it, absorbs legacy behavior, exposes hidden operational leakage, and transforms the workshop from reactive management into measurable command.

---

# 2. Core Non-Negotiables

## 2.1 Preserve Existing Salary & Timesheet Logic
The current salary and attendance calculation logic is treated as **protected core logic**.
It must not be broken or replaced casually.

Allowed:
- add validation layers
- add audit trails
- add simulation mode
- add approval workflows
- add better UI and better import tools
- add anomaly detection
- add more detailed earning/deduction components
- add attendance reconciliation
- add scenario comparison

Not allowed:
- changing core monthly salary behavior without explicit versioning
- changing time-sheet import behavior without fallback compatibility mode
- changing lateness, overtime, Friday, and deduction logic invisibly

## 2.2 Arabic-First
Everything must work naturally in Arabic:
- RTL layouts
- Arabic labels first
- Arabic reports first
- Arabic PDF first
- English available for technical/admin screens and export schemas

## 2.3 Offline-First and Local-First
The workshop must remain operational even with:
- bad internet
- no internet
- power disruptions with safe restore
- local network-only deployment

## 2.4 Auditability
Every important operation must be explainable:
- who changed what
- when
- why
- before/after values
- impact on payroll / inventory / project / finance

## 2.5 Zero Black Box Money
Every dinar must be traceable through:
- request
- approval
- execution
- settlement
- linkage to project / department / line / stock / employee / vendor

## 2.6 Workshop Reality Over Corporate Fantasy
The system must support realities like:
- Friday work
- overnight work
- 20-hour shifts
- manual corrections
- machine breakdown during production
- mixed field + workshop work
- informal requests becoming jobs
- materials issued from stock without perfect discipline
- WhatsApp-originated work orders
- gradual operational cleanup instead of forced perfection from day one

---

# 3. Strategic Objective

Convert the workshop from:

- fragmented files
- WhatsApp dependence
- manual reconciliation
- hidden leakage
- person-dependent decision loops
- weak traceability

into:

- a governed workshop OS
- controlled payroll and attendance
- measurable production
- project-based costing and profitability
- governed procurement and petty cash
- inventory intelligence
- maintenance discipline
- QC gates
- document-backed HR decisions
- role-based access and approvals
- management dashboard with real warnings

---

# 4. System Vision

The platform is a **federated modular operating system** with one shared data backbone.

It has four layers:

## Layer A: Governance Layer
- internal regulations
- PENTAGON governance
- roles and permissions
- approval matrix
- policies
- disciplinary workflows
- HR documents
- signed acknowledgements

## Layer B: Operational Layer
- projects
- production orders
- work tickets
- costing
- scheduling
- attendance
- payroll
- QC
- maintenance
- procurement
- inventory
- field tasks

## Layer C: Intelligence Layer
- anomaly detection
- hidden leakage discovery
- attendance inconsistency detection
- payroll exception engine
- procurement waste detection
- machine downtime intelligence
- WhatsApp ingestion / task extraction
- management alerts

## Layer D: Evidence Layer
- documents
- signed forms
- photos
- invoices
- receipts
- GPS/location check-ins
- maintenance logs
- machine files
- chats and attached evidence

---

# 5. Product Structure

The system is split into the following major domains:

1. Identity, Roles, and Permissions
2. HR Core
3. Attendance & Time Engine
4. Payroll Engine
5. Employee Performance & Discipline
6. Projects & Job Orders
7. Costing & Quotation
8. Production Operations
9. Machine & Maintenance Management
10. Inventory & Warehouse
11. Procurement & Vendors
12. Finance Operations & Settlements
13. CRM / Client Workflow
14. QC / Delivery / Installation
15. Knowledge Base / SOP / Internal Regulations
16. WhatsApp Intelligence Ingestion
17. Reporting, Dashboards, and Alerts
18. Backup / Sync / Deployment / Security
19. Integration Layer
20. Future AI Copilot Layer

---

# 6. Recommended Technology Direction

## 6.1 Recommended Build Stack
For a serious system of this size, use a modern full-stack architecture.

### Preferred Stack
- **Frontend:** Next.js + TypeScript + Tailwind + shadcn/ui
- **App State:** Zustand or Redux Toolkit
- **Forms:** React Hook Form + Zod
- **Data Grid:** AG Grid / TanStack Table
- **Charts:** Recharts / ECharts
- **Backend API:** FastAPI or NestJS
- **Database:** PostgreSQL
- **Local File Storage:** local filesystem or MinIO-compatible object storage
- **Desktop Packaging (optional):** Tauri or Electron
- **Background Jobs:** Celery / RQ / BullMQ
- **Realtime:** WebSocket / Server-Sent Events
- **Search:** PostgreSQL FTS first, later Meilisearch or OpenSearch
- **OCR / Parsing pipeline:** Python worker services
- **Offline Local Cache:** IndexedDB + service worker
- **Auth:** local RBAC + optional LDAP later

## 6.2 Why not only HTML + localStorage?
Because this system must support:
- many entities
- auditability
- concurrency
- file attachments
- dashboards
- reconciliation
- rules versioning
- long-term reliability

The existing payroll module can remain available as:
- reference implementation
- compatibility module
- fallback local calculator
- migration test oracle

---

# 7. Master Data Model

The system needs strong master data.

## 7.1 Core Entities
- Employee
- Department
- Role
- Permission
- Workshop Line
- Machine
- Tool
- Material Item
- Vendor
- Client
- Project
- Quote
- Work Order
- Production Ticket
- Attendance Record
- Payroll Run
- Payslip
- Deduction Rule
- Allowance Rule
- Maintenance Task
- Purchase Request
- Purchase Order
- Goods Receipt
- Stock Movement
- Cash Settlement
- Expense Voucher
- Disciplinary Action
- Reward Record
- QC Check
- Delivery Record
- Installation Visit
- Incident Report
- WhatsApp Message Event
- Extracted Task/Event
- Attachment
- Audit Log

## 7.2 Key Principles
- every entity has UUID
- Arabic name + optional English alias
- created_at / updated_at / created_by / updated_by
- soft delete where appropriate
- immutable audit tables for financial and payroll state transitions
- rules versioning tables

---

# 8. Identity, Roles, and Permissions

## 8.1 Core Roles
- Owner / الإدارة العليا
- Operations Director
- Executive Manager
- HR Admin
- Accountant
- Procurement Officer
- Warehouse Officer
- Payroll Officer
- Department Head
- Production Planner
- QC Officer
- Safety Officer
- Maintenance Officer
- Project Manager
- Field Supervisor
- Operator / Technician
- Read-only Auditor

## 8.2 Permission Model
Each permission is granular and grouped by domain.
Examples:
- employee.read
- employee.create
- attendance.import
- attendance.override
- payroll.calculate
- payroll.finalize
- payroll.reopen
- stock.issue
- stock.adjust
- project.close
- purchase.approve.level_1
- purchase.approve.level_2
- qc.reject
- maintenance.complete
- report.export_sensitive

## 8.3 Approval Matrix
Approval thresholds must be configurable by:
- role
- department
- monetary ceiling
- transaction type
- urgency type

Examples:
- petty cash under threshold
- emergency machine repair
- stock adjustment by value
- discount approval by quote margin

---

# 9. HR Core

## 9.1 Employee Profile
Each employee record includes:
- full Arabic name
- legal name if different
- nickname / workshop name
- employee code
- fingerprint/badge mapping
- phone numbers
- emergency contact
- department and line
- position and level
- join date
- contract type
- salary package
- bank/payment method
- national docs
- residence / address
- working schedule type
- leave balances
- skill matrix
- machine authorization matrix
- disciplinary log
- reward log
- attached documents

## 9.2 Contract Management
Store:
- contract versions
- start / end dates
- probation
- salary terms
- allowances
- special conditions
- signature images / PDF scans
- linked regulations version acknowledged by employee

## 9.3 Skill Matrix
Track which employee can operate:
- laser CO2
- CNC router
- fiber laser
- galvo laser
- welding equipment
- paint booth / spray system
- installation tools
- ERP modules they are allowed to use

---

# 10. Attendance & Time Engine

This is one of the most critical modules.

## 10.1 Design Rule
Do not replace current timesheet/payroll behavior.
Build a **Time Intelligence Layer around it**.

## 10.2 Sources of Attendance
- fingerprint device
- manual entry
- WhatsApp attendance group
- sheet import
- field mission slip
- manager correction
- shift record
- overtime approval record

## 10.3 Time Entities
- raw check-in event
- raw check-out event
- normalized attendance day record
- exception record
- correction request
- approved correction
- attendance source confidence score

## 10.4 Attendance Statuses
Support all existing logic and extend with:
- normal
- late
- absent
- leave paid
- leave unpaid
- permission partial
- Friday not worked
- Friday worked
- holiday
- night shift
- external mission
- workshop standby
- machine emergency attendance
- split shift
- overnight carryover

## 10.5 Time Reconciliation Engine
This engine compares:
- fingerprint logs
- manual records
- WhatsApp check-in evidence
- field mission records
- project activity logs

It produces:
- trusted day record
- inconsistency flags
- unresolved attendance conflicts
- payroll-impact warnings

## 10.6 Required Features
- import current excel formats
- preserve current time-sheet formulas/behavior
- manual correction with reason mandatory
- full audit trail
- overtime pre-approval vs actual reconciliation
- Friday/day-off logic preserved
- monthly grace period preserved
- shift crossing midnight handled correctly
- manual override mode with approval
- attendance freeze before payroll finalization

## 10.7 Hidden Problem Detection
The attendance intelligence layer must detect:
- late check-ins with edited manual records
- days with reported work but no attendance
- night work claimed without linked project/ticket
- frequent Friday attendance without authorization
- suspicious repeated “manual” attendance entries
- identical attendance patterns across staff suggesting proxy or template entry

---

# 11. Payroll Engine

This module must treat the current salary calculator and specification as canonical reference behavior.

## 11.1 Payroll Philosophy
Payroll is not a spreadsheet. It is a **controlled monthly event**.

## 11.2 Modes
- Draft calculation
- Reviewed calculation
- Finalized payroll
- Paid payroll
- Reopened payroll with reason and approval

## 11.3 Required Components
### Earnings
- base salary
- fixed allowances
- daily allowances
- transport
- food
- housing
- risk/site allowance
- Friday compensation
- overtime
- project bonus
- performance bonus
- quality bonus
- attendance bonus
- emergency reward

### Deductions
- lateness
- absence
- unpaid leave
- fines
- advances
- damage recovery
- salary loan installment
- settlement deductions
- disciplinary deductions
- insurance/tax if used
- custom deductions by policy

## 11.4 Payroll Protection Features
- rule versioning per payroll run
- freeze imported attendance snapshot
- payslip explainability panel
- comparison with previous month
- outlier alert if salary deviates beyond threshold
- conflict detector if deduction exceeds approved cap

## 11.5 Payslip Details
Each payslip should show:
- summary
- attendance metrics
- earning components
- deduction components
- notes
- linked approvals
- linked advances
- linked penalties
- linked Friday/overtime computation basis

## 11.6 Payroll Audit Questions the System Must Answer
- why was this employee paid this amount?
- which days were absent?
- which days counted as Friday work?
- what manual changes happened?
- which deductions came from fines vs advances vs damage?
- who approved the final payroll?

---

# 12. Employee Performance, Discipline, and Rewards

## 12.1 Discipline System
Built from current workshop rules but systemized.

Track:
- warning verbal
- warning written
- financial deduction
- temporary suspension
- final termination recommendation

Every disciplinary case includes:
- date
- incident type
- evidence
- reporter
- employee response
- decision
- appeal window
- linked payroll effect if any

## 12.2 Reward System
Rewards include:
- attendance reward
- quality reward
- project completion reward
- emergency initiative reward
- loyalty reward
- skill growth reward

## 12.3 Behavior Analytics
The system should calculate:
- chronic lateness score
- manual correction frequency score
- attendance reliability score
- production completion score
- QC rejection score
- tool damage risk score
- discipline recovery score

---

# 13. Projects & Job Orders

## 13.1 Project Lifecycle
1. lead / inquiry
2. requirement capture
3. site visit if needed
4. quote & costing
5. approval / deposit
6. project creation
7. work orders
8. production tickets
9. QC
10. delivery / installation
11. closure
12. profitability review

## 13.2 Project Types
- signage
- printing
- customized products
- municipal / government project
- exhibition booth
- decor / architectural
- internal workshop task
- maintenance/internal CAPEX task

## 13.3 Project Record Must Include
- client
- contact
- category
- scope
- deadline
- urgency
- linked line(s)
- quoted price
- planned cost
- actual cost
- assigned manager
- work tickets
- purchase links
- stock consumption
- field visits
- photos
- QC records
- invoice/collection linkage

---

# 14. Costing & Quotation Engine

This solves one of the biggest historical problems: underpricing and invisible loss.

## 14.1 Costing Inputs
- materials
- machine time
- labor hours
- finishing time
- installation time
- transport
- risk factor
- design iterations
- wastage factor
- outsourcing if any
- lighting/electrical components

## 14.2 Quote Builder
Quote engine should generate:
- client quote version history
- internal cost sheet
- margin analysis
- discount approval route
- change order impact

## 14.3 Margin Warnings
Warn when:
- gross margin below threshold
- design complexity high but price low
- project needs special machine time but not included
- delivery/installation omitted
- too many unpaid revisions

---

# 15. Production Operations

## 15.1 Work Order Types
- design order
- print order
- CNC order
- laser order
- fiber cutting order
- paint/finish order
- assembly order
- installation order
- repair/rework order

## 15.2 Production Ticket Fields
- ticket ID
- parent project
- department
- station/machine
- operator
- scheduled start/end
- actual start/end
- required materials
- output qty
- scrap qty
- issue notes
- hold reason
- QC result

## 15.3 Manufacturing Reality Support
The system must support:
- partial completion
- handoff between lines
- waiting on material
- waiting on approval
- machine down
- redesign / rework
- urgent interruption jobs
- field installation feeding back rework

## 15.4 Production Traceability
For every item/job, system must show:
- who designed it
- who approved it
- who produced it
- which machine used
- how much scrap happened
- whether rework occurred
- whether delay caused payroll overtime

---

# 16. Machine & Maintenance Management

This should absorb all maintenance schedules and machine documentation already present.

## 16.1 Machine Registry
Each machine should include:
- machine code
- name
- category
- serial number
- purchase date
- supplier
- location
- responsible operator/team
- SOP links
- maintenance interval templates
- spare parts list
- risk class

## 16.2 Machine Categories
- CO2 laser
- CNC router
- fiber laser 1500W
- fiber galvo 20W
- wide printer
- plotter
- 3D printer
- welding machine
- spray system
- air compressor
- chiller
- generator
- computers

## 16.3 Maintenance Types
- daily checklist
- weekly checklist
- monthly preventive maintenance
- corrective maintenance
- emergency breakdown repair
- calibration
- cleaning cycle
- lubrication cycle
- consumable replacement

## 16.4 Maintenance Ticket
- machine
- issue type
- severity
- detected by
- downtime start/end
- root cause
- action taken
- part used
- technician
- photo evidence
- next due date

## 16.5 Downtime Intelligence
System must detect:
- repeated failures on same machine
- cost of downtime by machine
- maintenance skipped but machine still used
- operator-linked misuse patterns
- jobs delayed by maintenance neglect

---

# 17. Inventory & Warehouse

This is another critical leakage area.

## 17.1 Stock Categories
- raw materials
- sheets (acrylic/MDF/foam/etc.)
- metal stock
- lighting components
- inks/consumables
- adhesives / silicone / glue
- paint / finishing
- maintenance parts
- tools
- PPE
- packaging materials

## 17.2 Core Stock Movements
- opening balance
- purchase receipt
- issue to project
- issue to department
- return from project
- scrap/loss
- damage write-off
- transfer between locations
- stock adjustment
- cycle count adjustment

## 17.3 Inventory Requirements
- unit conversions
- batch/lot optional
- min/max thresholds
- reorder levels
- reserved stock for projects
- issued but unconsumed tracking
- project-linked material costing
- variance analysis

## 17.4 Tool & Asset Tracking
Track non-consumables:
- drills
- cutters/bits
- welding gear
- measuring tools
- ladders
- safety tools

Each asset can be:
- assigned
- borrowed
- returned
- damaged
- missing
- under repair

## 17.5 Hidden Leakage Detection
Detect:
- frequent micro-purchases of items that should be stocked
- repeated emergency purchases for same item
- project issues without project closure
- high scrap item categories
- missing tool patterns by department/person
- adjustments with no evidence

---

# 18. Procurement & Vendors

## 18.1 Procurement Flow
1. purchase request
2. approval
3. vendor selection
4. purchase order
5. goods receipt
6. invoice capture
7. settlement/payment
8. linkage to stock/project/expense

## 18.2 Request Types
- stock replenishment
- project-specific material
- urgent maintenance spare part
- admin expense
- outsourced job
- field logistics

## 18.3 Vendor Management
Store:
- vendor profile
- categories
- lead time
- pricing history
- last purchase date
- quality incidents
- payment terms

## 18.4 Procurement Intelligence
Detect:
- same item bought repeatedly at different prices
- urgent purchases that indicate poor planning
- high taxi/logistics cost relative to item value
- single-vendor dependency
- split purchases to avoid approvals

---

# 19. Finance Operations & Settlements

This is not full accounting at first, but finance control must be strong.

## 19.1 Financial Objects
- petty cash request
- advance request
- project settlement
- staff advance
- expense voucher
- receipt voucher
- payment voucher
- vendor payment
- client collection

## 19.2 Settlement Discipline
Every advance must have:
- beneficiary
- purpose
- amount
- approval
- due settlement date
- attached receipts
- remaining amount
- closed/open status

## 19.3 Finance Warnings
Detect:
- overdue unsettled advances
- frequent small cash withdrawals by same person
- expenses without receipts
- repeated personal-purpose-looking purchases
- project overspend beyond quoted cost

---

# 20. CRM / Client Workflow

## 20.1 Lead to Client Pipeline
- inquiry
- qualified
- quoted
- approved
- in production
- delivered
- support/warranty

## 20.2 Client Data
- company/person
- sector
- contact history
- previous jobs
- pricing sensitivity
- discount history
- complaint history
- payment history

## 20.3 After-Sales
- complaint tickets
- warranty actions
- repeat work opportunities
- installation revisit logs

---

# 21. QC / Delivery / Installation

## 21.1 QC Gates
At minimum:
- pre-production design QC
- material readiness QC
- production output QC
- pre-delivery QC
- post-installation QC

## 21.2 QC Checklist Types
- signage dimensions
- illumination test
- acrylic finish
- print color and bleed
- fitment / joint quality
- edge quality for laser/CNC
- packaging completeness
- installation safety checklist

## 21.3 Rework Tracking
System must record:
- who failed which QC gate
- root cause category
- rework hours
- extra material consumed
- impact on project margin

---

# 22. Knowledge Base / SOP / Internal Regulations

## 22.1 Documents to Store
- internal regulations versions
- PENTAGON system docs
- machine guides
- maintenance schedules
- safety procedures
- payroll rules
- contract templates
- warnings / reward forms
- onboarding guides

## 22.2 Knowledge Linking
Every SOP should be linkable to:
- machine
- department
- role
- task type
- incident type

## 22.3 Acknowledgement Workflow
Employees can be required to acknowledge:
- new regulation version
- machine safety SOP
- attendance policy
- payroll policy

---

# 23. WhatsApp Intelligence Ingestion

This is one of the biggest strategic advantages.

## 23.1 Purpose
Convert noisy WhatsApp operational behavior into structured signals.

## 23.2 Source Groups
- daily reports
- attendance in/out
- main workshop group
- project groups later

## 23.3 Ingestion Pipeline
1. import zip / chat export
2. parse messages and timestamps
3. normalize users
4. identify keywords / events
5. classify messages into candidate objects
6. route to review queue
7. approve into system records if valid

## 23.4 Extractable Event Types
- attendance mention
- late arrival excuse
- work completion report
- machine breakdown report
- material shortage
- field mission
- payroll/advance mention
- disciplinary indicator
- safety incident
- project urgency alert

## 23.5 Intelligence Features
- hidden attendance evidence
- work without formal ticket
- repeated excuses patterns
- overtime claimed in chat but missing in timesheet
- machine issue mentions before official maintenance ticket
- missing reporting days despite actual work discussion

## 23.6 Human Review
All extracted intelligence should go through review workflow before becoming official financial/legal records.

---

# 24. Reporting, Dashboards, and Alerts

## 24.1 Executive Dashboard
Show:
- today attendance summary
- late employees
- absent employees
- active projects by stage
- delayed projects
- payroll status this month
- open advances
- low stock alerts
- machine downtime alerts
- top losses/anomalies

## 24.2 Payroll Dashboard
- payroll draft/review/finalized counts
- total payroll this month
- variance from last month
- top overtime departments
- late penalty trends
- advances and deductions composition

## 24.3 Inventory Dashboard
- low stock
- fast-moving items
- high-variance items
- missing tools
- emergency purchases trend

## 24.4 Maintenance Dashboard
- machines due today
- overdue preventive maintenance
- top downtime machines
- maintenance cost by machine

## 24.5 Operational Intelligence Dashboard
- attendance inconsistency cases
- project margin risk
- repeated rework
- procurement waste indicators
- manual override frequency

---

# 25. Alert Engine

Alerts can be:
- info
- warning
- critical

Examples:
- payroll run contains reopened employee after finalization
- employee has 3 manual attendance corrections in one week
- project consumed material above estimate by 25%
- machine preventive maintenance overdue by 7 days
- stock adjustment made without attachment
- repeated Friday work without approval
- advances overdue for settlement

---

# 26. Audit & Explainability

## 26.1 Immutable Audit Design
Important actions create append-only audit records.

Must audit:
- attendance correction
- payroll calculation
- payroll finalization
- stock adjustment
- advance approval/settlement
- quote discount approval
- machine maintenance close
- disciplinary action

## 26.2 Explainability Views
For each high-stakes record, provide “Why?” panel.

Examples:
### Why did salary change?
- 2 unpaid absences
- 1 Friday worked
- 5 overtime hours approved
- advance installment deducted
- fine from disciplinary action XYZ

### Why did project margin collapse?
- 18% more material consumed
- rework ticket added
- urgent purchase taxi costs
- overtime in final 2 days

---

# 27. Data Migration Strategy

The system must migrate from existing reality.

## 27.1 Migration Sources
- salary calculator data model
- master database excel
- inventory excel
- WhatsApp exports
- internal regulations docs
- maintenance schedule PDFs/docs

## 27.2 Migration Approach
### Phase M1
- import employees
- import payroll base structures
- import current attendance tables
- import core inventory

### Phase M2
- import project history summary
- import penalties/rewards where structured
- import maintenance schedule templates

### Phase M3
- parse WhatsApp and create intelligence review queue

## 27.3 Dual Run Period
For payroll and attendance:
- keep old calculator active
- run new engine in parallel
- compare outputs
- identify differences
- lock compatibility before full cutover

---

# 28. Deployment Modes

## Mode 1: Single-Machine Local
Best for early pilot.

## Mode 2: Local Network Server
Recommended for workshop office use.
- one internal server/PC
- LAN access
- printer integration
- daily backup to external drive

## Mode 3: Hybrid with Remote Backup
- local operational server
- encrypted remote backup
- optional remote owner dashboard

---

# 29. Security Model

## 29.1 Security Requirements
- role-based access
- sensitive payroll masking
- audit trails
- encrypted credentials
- local backup encryption
- file access permissions
- forced logout on inactivity for admin roles

## 29.2 Sensitive Domains
- payroll
- disciplinary records
- contracts and IDs
- vendor bank details
- client pricing

---

# 30. UX Principles

## 30.1 Designed for Workshop Reality
- fast data entry
- minimal clicks for supervisors
- strong tables and bulk actions
- mobile-friendly field screens
- desktop-first admin screens
- print-ready forms

## 30.2 Color Logic
- normal / safe
- delayed / attention
- blocked / critical
- finalized / locked
- warning / financial risk

## 30.3 User Profiles
Different UX surfaces for:
- owner
- accountant
- HR
- warehouse
- supervisor
- operator

---

# 31. Phased Delivery Plan

## Phase 0: Foundation
- auth
- employees
- permissions
- document storage
- workshop lines/departments
- settings

## Phase 1: Protected Core
- attendance import
- time reconciliation
- payroll compatibility engine
- payslips
- employee discipline/reward log

## Phase 2: Operational Control
- projects
- costing
- production tickets
- inventory
- procurement
- settlements

## Phase 3: Governance & Reliability
- maintenance
- QC
- delivery/installations
- SOP knowledge base
- dashboard suite

## Phase 4: Intelligence
- WhatsApp ingestion
- anomaly engine
- hidden leakage detection
- predictive alerts

## Phase 5: Executive Command Center
- full profitability dashboards
- multi-branch support if needed
- AI copilot for analysis and recommendations

---

# 32. MVP vs Full System

## MVP Must Include
- employees
- attendance import/edit/reconcile
- payroll with compatibility mode
- payslips
- basic discipline/reward log
- basic projects
- stock basics
- procurement requests
- executive dashboard lite

## Full System Includes
Everything in this document.

---

# 33. Anti-Failure Mechanisms

The system must be engineered to prevent the exact failures that historically harmed the workshop.

## 33.1 Anti-Island Design
No department can become a hidden island because:
- money, work, stock, and approvals are linked
- same person cannot invisibly own the whole loop
- dashboards reveal isolated abnormal behavior

## 33.2 Anti-Silent-Loss Design
Losses become visible through:
- costing vs actual comparison
- rework tracking
- material variance
- overtime linkage
- hidden purchase alerts

## 33.3 Anti-Cash-Bleed Design
- every advance settled
- petty cash tracked
- micro-purchases highlighted
- overdue settlements blocked from new issuance

## 33.4 Anti-Ghost-Work Design
- no overtime without source linkage
- no work report without ticket/project optional review
- no field mission without slip or approval trace

---

# 34. Suggested Repository / Product Structure

```text
/workshop-omnisystem
  /apps
    /web
    /desktop
    /worker
  /services
    /payroll-engine
    /whatsapp-ingest
    /reporting
  /packages
    /ui
    /types
    /rules-engine
    /audit-sdk
  /docs
    MASTER_SPEC.md
    PAYROLL_COMPATIBILITY.md
    ATTENDANCE_RECONCILIATION.md
    INVENTORY_RULES.md
    PROJECT_COSTING.md
    WHATSAPP_INTELLIGENCE.md
  /migrations
  /scripts
  /samples
```

---

# 35. Recommended Engineering Rules

- TypeScript strict mode on
- backend schemas validated
- every mutation audited
- feature flags for risky modules
- compatibility test suite for payroll
- import dry-run mode mandatory
- no silent destructive deletes
- all payroll rules versioned
- every stock adjustment requires reason
- every reopen-finalized action requires elevated approval

---

# 36. Success Metrics

## 36.1 Within 30 Days of Deployment
- payroll finalized with lower manual confusion
- attendance conflicts visible
- employee records unified
- top low-stock items visible

## 36.2 Within 90 Days
- reduction in unexplained cash movements
- reduction in emergency micro-purchases
- reduction in untracked overtime
- better project traceability

## 36.3 Within 180 Days
- profitability by job visible
- machine downtime measurable
- HR discipline/reward history structured
- workshop no longer operationally dependent on WhatsApp memory

---

# 37. Final Product Statement

This system should feel like:
- part ERP
- part MES
- part payroll engine
- part workshop control room
- part forensic analyzer

It is not built to look pretty only.
It is built to **end blindness**.

The current workshop already has:
- real operational knowledge
- real machine knowledge
- real payroll rules
- real governance intent
- real pain history

This product converts those into one enforceable system.

---

# 38. Immediate Build Recommendation

If this project is handed to **Claude Code / Cursor / Codex / a serious engineering team**, the best execution path is:

1. freeze current payroll logic as compatibility module
2. build new platform around it, not against it
3. start with attendance + payroll + employee core
4. then inventory + procurement + projects
5. then WhatsApp intelligence and anomaly engine

That path gives the fastest real value without breaking salary trust.

---

# 39. Next Documents to Generate From This MD

This MD should be followed by these implementation documents:

1. Product Requirements Document (PRD)
2. System Architecture Document (SAD)
3. Database Schema Specification
4. Payroll Compatibility Specification
5. Attendance Reconciliation Spec
6. Inventory & Procurement Spec
7. Project Costing Spec
8. WhatsApp Intelligence Spec
9. Role & Permission Matrix
10. API Contract Document
11. UI Screen Inventory
12. Delivery Roadmap / Sprint Plan

---

# 40. Closing Line

**Build the system so the workshop stops guessing.**

Build it so every late minute, every Friday shift, every missing drill, every emergency purchase, every rework loop, every salary difference, every machine failure, and every hidden leak becomes visible, explainable, and governable.

That is the standard.

