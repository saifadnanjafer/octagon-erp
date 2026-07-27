# Authenticated Browser Acceptance — real Chromium with screenshots

## The correction that made this possible

Previous checkpoints reported "screenshots unavailable" because the harness's
external screenshot service could not composite frames. That was accepted as a
limitation for too long. It was wrong: **Playwright/Puppeteer can write
screenshots straight to disk**, and Puppeteer 25.3.0 with Chromium
**150.0.7871.24** was already installed in this repository.

`scripts/browser-acceptance.mjs` now drives real Chromium and writes real PNGs.
Playwright itself is **not** installed; Puppeteer was used instead rather than
pulling a new dependency for an equivalent capability.

## Run

| Item | Value |
|---|---|
| Command | `node scripts/browser-acceptance.mjs` |
| Chromium | `Chrome/150.0.7871.24` |
| Puppeteer | 25.3.0 |
| Base URL | `http://localhost:8080` (`octagon-preview-auth`) |
| Database | staged **disposable copy**; operational store never opened |
| Exit code | 0 |
| **Result** | **23 passed / 0 failed / 0 skipped** |
| Screenshots | 9, written directly to disk |
| Raw artifacts | `test-artifacts/<runId>/` (gitignored) |
| Evidence copies | `docs/evidence/visible-expansion/screenshots/` |

## Results

| Scenario | Result | Detail |
|---|---|---|
| shell loads | PASS | |
| authenticate as disposable sysadmin | PASS | 200, `usr_test_sysadmin` |
| legacy shell login gate dismissed | PASS | see below |
| canonical console opens | PASS | |
| console exposes 8 domains | PASS | 8 tabs |
| **`party:create` through the real UI form** | **PASS** | rows increased |
| canonical inventory opens | PASS | |
| **`warehouse:create` through the real UI form** | **PASS** | verified on the server, not by DOM count |
| receipt draft stages without persisting | PASS | 0 action requests during staging |
| failed validate shows a per-line reason | PASS | code + reason rendered |
| failed validate persists no stock move | PASS | 0 moves |
| failed line stays in the draft | PASS | |
| english LTR renders | PASS | `dir=ltr` |
| tablet 768 no horizontal overflow | PASS | |
| mobile 375 no horizontal overflow | PASS | |
| **mobile main content width** | **PASS** | **375px of 375px** (was 115px) |
| authenticate as restricted viewer | PASS | |
| viewer may read | PASS | |
| **viewer write denied server-side** | **PASS** | 403, `ليس لديك صلاحية تنفيذ هذا الإجراء` |
| no uncaught page errors | PASS | |
| no unexpected console errors | PASS | |
| no failed required resources | PASS | |
| no unexpected missing resources | PASS | 2 known-optional 404s |

## Screenshots

| File | Shows |
|---|---|
| `01-console-desktop-ar.png` | Canonical Operations, Arabic RTL |
| `02-console-parties-after-create.png` | Parties grid after a real `party:create` |
| `03-inventory-warehouses-desktop.png` | Canonical Inventory, warehouses tab |
| `04-inventory-warehouse-created.png` | after a real `warehouse:create` |
| `05-inventory-receipt-failure-surface.png` | Draft→Validate failure panel with code, reason and the atomic-rollback statement |
| `06-inventory-desktop-en-ltr.png` | English LTR |
| `07-inventory-tablet-768.png` | tablet |
| `08-inventory-mobile-375.png` | mobile with the drawer closed |
| `09-viewer-permission-state.png` | restricted viewer |

Raw runs stay gitignored because they can capture session cookies and the
disposable fixture password. The copies above render only disposable test data
and no credential.

## Three corrections this run forced

### 1. A false failure from a timing-sensitive assertion

`warehouse:create` reported `rows 1 -> 1` and failed — but the record
`ACC-RLP3L` **was** on the server. The grid re-renders asynchronously from
several triggers, so a DOM row count sampled at a fixed delay is unreliable.
The assertion now verifies against the canonical list (the authority) and
reports the DOM count only as context. The feature was never broken; the test
was.

### 2. The screenshots were photographing a login wall

The first screenshots showed the shell's **legacy login overlay**, not the
modules — while a green `تم إنشاء المستودع.` toast was visible in the corner,
proving the command had executed underneath.

Cause: the original shell has its own client-side login gate driven by
`localStorage 'octagon_user_id'` (Phase 6H guest enforcement). Canonical session
authentication does not satisfy it, so the overlay covered every page.

The harness now dismisses that gate before capturing. **This only affects what
is visible** — every canonical read and command is still authorised server-side
from the session cookie, which is exactly why the viewer denial still returns
403 in the same run.

This is a genuine product observation, not just a harness quirk: the legacy
gate and the canonical session are two independent notions of "logged in".

### 3. 404s could not be judged from console text

A "Failed to load resource" console message carries no URL, so it could not be
triaged. Missing resources are now tracked from the `response` event, which has
the real path, and allowlisted by **exact pathname**
(`/claude-status.json`, `/claude-review-pointer.json` — optional tooling files
absent on this branch). Any other 404 fails the run.

## What this proves

Two canonical commands execute end-to-end from the real original-shell UI
(`party:create`, `warehouse:create`); the Draft→Validate lifecycle stages
without persisting and rolls back atomically on failure with a visible per-line
reason; Arabic RTL and English LTR both render; desktop, tablet and mobile
layouts hold with no horizontal overflow; and role-based denial is enforced by
the server, not the browser.

## What this does not prove

- **No successful stock receipt.** A product still cannot be bootstrapped from
  the UI — `product:template:create` needs `category_id` and `uom_id`, and no
  governed command exists for creating a UOM category or a product category.
  The receipt path is proven only to correct rejection and rollback.
- **No separate Products or Parties module page exists yet.** Both are still
  tabs inside the Canonical Operations console.
- No edit / archive / restore flows exist for any domain — those canonical
  actions are not implemented.
- No delivery, transfer, return, adjustment, cycle-count, replenishment,
  valuation or stock-to-GL workflow exists.
- No concurrency or failure-injection suite has been run.
