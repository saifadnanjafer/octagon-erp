# Fleet Fuel Guard Vertical

## Purpose

Fleet Fuel Guard is a customer-demo vertical for companies that operate large fleets of vehicles and equipment, especially diesel/kaz fleets. The goal is to show how Octagon ERP can help control fuel usage, reduce theft risk, monitor location behavior, enforce geofence speed limits, and guide investigations from one governed ERP surface.

This document is planning/specification only. No fleet/fuel screens, sidebar pages, route changes, hardware contracts, or database migrations are part of this update.

## Customer Problem

The target customer has more than 100 vehicles and equipment units, large and small, running mostly on diesel/kaz. Their current problems include:

* fuel theft or unexplained fuel loss
* uncontrolled diesel/kaz consumption
* limited visibility into where vehicles and equipment are operating
* speeding in sensitive zones
* idle fuel waste
* weak investigation and approval control
* no reliable comparison between expected and actual fuel behavior

## Demo Scope

The first implementation phase should be presentation/demo first. It should use mock/manual data or CSV/API placeholders when the phase starts, not live hardware integration.

Planned demo modules:

1. Fleet Command Map
2. Vehicle / Equipment Register
3. Geographic Zones / Geofences
4. Speed Limit Policies By Geographic Zone
5. Fuel Ledger
6. Fuel Theft / Anomaly Detection Center
7. Fleet/Fuel Control Dashboard
8. Investigation / Approval Flow
9. Customer Demo Reports
10. AI / Jarvis explanation and investigation support

## Out-Of-Scope Hardware Integration

Hardware integration is deferred. Future sources may include:

* GPS tracker
* OBD tracker for small vehicles
* CAN/J1939 tracker for heavy equipment
* tank level sensor
* fuel dispensing/pump controller
* RFID driver/operator ID
* NFC/QR fuel authorization
* camera/photo evidence

For the presentation foundation:

* use demo/mock data later
* use manual/CSV placeholders later
* use API placeholder contracts only when implementation starts
* make no vendor-specific promises
* make no claim that hardware is already integrated

## Module Sections

### 1. Fleet Command Map

Show a map-style fleet dashboard with vehicle/equipment markers. If no map SDK is available, use a local mock map or grid for presentation.

Marker statuses:

* normal
* speeding
* fuel anomaly
* offline
* idle too long
* outside allowed zone

Filters:

* project
* site
* driver/operator
* vehicle type
* status

### 2. Vehicle / Equipment Register

Track asset number, plate number, type, fuel type, tank capacity, expected consumption per hour/km, assigned driver/operator, department/project/site, GPS placeholder, OBD/CAN/J1939 placeholder, tank sensor placeholder, and active/inactive status.

Vehicle/equipment types include car, truck, crane, loader, generator, excavator, heavy equipment, and small equipment. Fuel types include diesel/kaz and gasoline.

### 3. Geographic Zones / Geofences

Zone examples: workshop, project site, city road, highway, restricted area, fuel station, and depot.

Each zone should support a geometry placeholder, allowed vehicles/equipment, allowed working hours, allowed fuel activity yes/no, entry/exit logs, and zone violation alerts.

### 4. Speed Limit Policies By Geographic Zone

Each zone has speed limits. Limits may vary by vehicle/equipment type.

Example policy values:

* workshop: 10 km/h
* project site: 20 km/h
* city road: 60 km/h
* highway: 90 km/h
* heavy equipment: custom limits

Alerts include speeding inside zone, repeated speeding by driver, overspeed while loaded, and overspeed near restricted/sensitive areas. Detection must be deterministic first. AI may explain risk but cannot override policy.

### 5. Fuel Ledger

Ledger event types include refill events, consumption events, suspicious drop events, manual corrections, sensor reading events, and fuel dispensing events. Each ledger event should carry approval status, driver/operator stamp, vehicle/equipment stamp, and site/project stamp.

### 6. Fuel Theft / Anomaly Detection Center

Detect and score fuel drop while engine is off, fuel drop after vehicle leaves site, fuel drop outside allowed geofence, refill mismatch, high consumption compared to expected rate, long idle with high fuel burn, GPS blackout followed by fuel drop, tank sensor disconnect followed by fuel drop, repeated anomalies by driver/operator, repeated anomalies by site, repeated anomalies by vehicle/equipment, and fuel activity outside allowed time windows.

### 7. Fleet/Fuel Control Dashboard

Show total fleet count, active vehicles, offline devices, fuel consumed today/week/month, estimated suspicious fuel loss, top risky vehicles, top risky drivers/operators, top risky sites, speed violations, idle cost, and open investigations.

### 8. Investigation / Approval Flow

Manual corrections or dismissed anomalies must go through approval. Controlled actions include confirm refill, approve fuel correction, dismiss anomaly, mark as theft suspicion, assign investigation task, attach notes/photos/documents later, and audit all actions.

### 9. Customer Demo Reports

Demo reports include fuel consumption per vehicle, fuel consumption per project/site, fuel consumption per driver/operator, fuel variance report, suspected theft report, speed violation report, idle fuel waste report, vehicle efficiency report, and monthly fuel reconciliation.

## Geofence Speed Limit Logic

The speed logic must be deterministic before AI explanation:

1. Resolve the vehicle/equipment current zone.
2. Resolve the active policy for that zone and vehicle/equipment type.
3. Compare current speed with allowed speed.
4. Create an alert if speed is above the policy threshold.
5. Escalate risk if the same driver, vehicle, zone, or site has repeated violations.
6. Allow AI to explain the risk and suggest checks only after deterministic detection.

AI cannot change a speed policy, override a speed event, or dismiss a violation.

## Fuel Anomaly Logic

The fuel logic must compare actual readings/events against expected behavior:

1. Track refill, consumption, sensor, correction, and dispensing events.
2. Compare fuel drops against engine status, GPS status, geofence, time window, expected hourly burn, and expected km burn.
3. Compare pump quantity with tank-level increase when dispensing data exists.
4. Score repeated patterns by driver/operator, vehicle/equipment, project/site, and time window.
5. Route suspicious events into investigation/approval flow.

AI can explain why an anomaly looks risky, but cannot mutate ledger records or evidence.

## AI Boundaries

AI can explain anomalies, summarize suspected theft patterns, rank risky vehicles/drivers/sites, draft investigation notes, recommend checks, prepare customer-facing report text, and compare actual vs expected fuel behavior.

AI cannot approve anomaly decisions, dismiss anomalies, change the fuel ledger, edit vehicle fuel capacity, modify sensor readings, delete evidence, or approve its own recommendation.

## Approval And Audit Requirements

The vertical must preserve ERP-grade governance: fuel corrections require approval, dismissed anomalies require approval, theft suspicion markings must be audited, investigation assignments must leave a record, manual changes must keep actor/timestamp/reason/context, and AI recommendations must be stored separately from approved decisions.

## Suggested Data Model

Document only. Do not apply to `database.json` now.

```js
omni.fleet = {
  vehicles: [],
  drivers: [],
  zones: [],
  speedPolicies: [],
  gpsEvents: [],
  fuelReadings: [],
  fuelLedger: [],
  fuelAnomalies: [],
  fuelInvestigations: [],
  deviceBindings: [],
  demoMode: true
}
```

## MVP Phases

1. Presentation/demo with mock/manual data
2. CSV/API ingestion
3. Hardware vendor integration
4. AI risk scoring and investigation assistant
