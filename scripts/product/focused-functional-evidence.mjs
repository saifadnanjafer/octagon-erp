// Focused, persisted workflow evidence that supersedes a passive inspection
// only for the listed pages. A page is not upgraded by route activation or a
// shared renderer: each entry names an executable Chromium/domain acceptance
// test that creates or advances a real disposable record and checks its result.
export const FOCUSED_FUNCTIONAL_EVIDENCE = Object.freeze({
  dock_schedule: { test: 'tests/build-09/dock-workspaces-browser.test.mjs', proof: 'Creates scoped dock appointments, rejects collisions, and persists lifecycle state.' },
  dock_checkin: { test: 'tests/build-09/dock-workspaces-browser.test.mjs', proof: 'Checks in, assigns, services, and departs an appointment with detention state.' },
  expiration_queue: { test: 'tests/build-09/expiration-queue-browser.test.mjs', proof: 'Uses governed expiry windows and creates a Quality proposal under warehouse scope.' },
  production_material_requests: { test: 'tests/build-09/production-material-workspaces-browser.test.mjs', proof: 'Creates a governed material request and acknowledges its canonical result.' },
  production_issue_return: { test: 'tests/build-09/production-material-workspaces-browser.test.mjs', proof: 'Runs governed production issue and return lifecycle with persisted stock effects.' },
  production_receipt: { test: 'tests/build-09/production-material-workspaces-browser.test.mjs', proof: 'Runs production receipt acknowledgement against a canonical result.' },
  quality_hold_queue: { test: 'tests/build-09/quality-workspaces-browser.test.mjs', proof: 'Operates the quality-hold queue and proves self-approval is refused.' },
  rework_workspace: { test: 'tests/build-09/quality-rework-scrap-domain.test.mjs', proof: 'Creates NCR-linked rework with a canonical inventory effect.' },
  scrap_approval: { test: 'tests/build-09/quality-workspaces-browser.test.mjs', proof: 'Approves scrap through Quality without claiming the stock move itself.' },
  shopfloor_terminal: { test: 'tests/build-09/shopfloor-workspaces-browser.test.mjs', proof: 'Executes the shop-floor terminal lifecycle without inventing a manufacturing transition.' },
  workcenter_queue: { test: 'tests/build-09/shopfloor-workspaces-browser.test.mjs', proof: 'Ranks the work-centre queue and assigns an operator through the governed flow.' },
  wave_execution: { test: 'tests/build-09/wave-workspaces-browser.test.mjs', proof: 'Releases a reviewed wave and shows persisted execution progress.' },
  recall_analysis: { test: 'tests/build-09/trace-workspaces-browser.test.mjs', proof: 'Runs a recall case and proves it creates proposals rather than direct stock changes.' },
  fleet_operations_board: { test: 'tests/build-10/operational-browser-chromium.test.mjs', proof: 'Renders the operational board and enforces kiosk role restrictions.' },
  work_orders: { test: 'npm.cmd run review:functional-work-orders', proof: 'Uses the visible Workshop wizard to create a fictional job, observes a successful full-state write, reloads/authenticates, and finds the same job again.' },
});

export const FOCUSED_FUNCTIONAL_TEST_FILES = Object.freeze([...new Set(Object.values(FOCUSED_FUNCTIONAL_EVIDENCE).map(entry => entry.test))]);

// Negative acceptance is evidence too. These entries never upgrade a page;
// they make a reproduced workflow failure visible in the same ledger that
// carries successful focused tests.
export const FOCUSED_FUNCTIONAL_BLOCKERS = Object.freeze({});
