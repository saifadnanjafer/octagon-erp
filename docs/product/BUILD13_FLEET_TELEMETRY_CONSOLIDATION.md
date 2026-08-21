# BUILD-13 Fleet Telemetry Consolidation Decision

## Status

**OWNER DECISION REQUIRED — do not merge or retire either writer yet.**

The retained `fleet` page mixes two different concerns:

1. It stores manually entered vehicles, fuel logs, and trip logs in the
   legacy `omni.fleet` store.
2. Its command-map, risk, investigation, and integration tabs manufacture
   telemetry, speed, fuel, zone, maintenance, and anomaly values whenever
   verified telemetry is unavailable.

The BUILD-10 fleet pages use the governed platform tables registered by
`083_build10_fleet_telematics_geofences` and their registered actions. They
are the only verified source for live location, trip projection, geofence,
speed, fuel telemetry, and maintenance-trigger facts.

## Completed safe recovery

- Removed Fleet controls that claimed to load or reload demo operations.
- Preserved legacy manual vehicle, fuel, and trip entry paths; no records
  were migrated, deleted, or rewritten.
- Added a BUILD-13 regression test prohibiting those demo controls.

## Authority map

| Capability | Current legacy page | Governed BUILD-10 source |
|---|---|---|
| Vehicle registry and manual fuel/trip entry | `omni.fleet` | legacy-only; migration not verified |
| Live vehicle location | simulated in `modules/fleet.js` | `fleet_location_points` / `fleet_live_map_simulator` |
| Trip projection | simulated fallback | `fleet_trip_projections` / `vehicle_trip_timeline` |
| Geofence and speed events | simulated fallback | `fleet_geofence_events`, `fleet_speed_events` |
| Fuel telemetry and suspected loss | simulated fallback | `fleet_fuel_telemetry`, `suspected_fuel_loss_queue` |
| Maintenance triggers | simulated fallback | `fleet_maintenance_triggers` |

## Required owner choice

Choose one option before a functional merge:

1. **Migrate and consolidate** — define field mapping and a cutover date for
   legacy vehicle/fuel/trip records, rehearse on a disposable database, then
   redirect legacy telemetry tabs to BUILD-10 after browser parity proves all
   supported manual workflows.
2. **Retain the legacy register temporarily** — keep manual legacy entry
   paths, but make every simulated telemetry tab fail closed and link to its
   corresponding BUILD-10 governed source. This removes fabricated telemetry
   but intentionally reduces the legacy page's apparent feature set.
3. **Retire the legacy Fleet page** — only after confirming that every needed
   manual workflow is present in a governed destination and a data-retention
   policy has been approved.

No option has been inferred from source code or historical documentation.
