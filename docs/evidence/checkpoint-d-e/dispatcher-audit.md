# Original-shell page dispatcher — audit and correction

## The claim under review

The Checkpoint D1 report stated that `app.js` contains **duplicate
`switchPage` definitions and the later definition wins**, and that the D1
render dispatch had been added to a shadowed copy.

## What is actually true

That claim was **incorrect**. It was a misdiagnosis in the D1 session and is
corrected here rather than "fixed" by changing working code.

Verified on this branch:

```
$ grep -n "^function switchPage\|window.switchPage *=" app.js
4134:function switchPage(page) {
4140:    return window.switchPage('timesheet');   # a call, not a definition
```

There is exactly **one** `switchPage` definition in `app.js`.

Genuine duplicate top-level function definitions in `app.js`:

```
$ grep -oE "^function [A-Za-z0-9_]+" app.js | sort | uniq -d
function renderAttendanceCalendar
```

`renderAttendanceCalendar` is the only duplicate. It is unrelated to
navigation, sits in the frozen attendance area, and was **not** touched.

What the D1 session actually saw were two `const pageMap = {...}` declarations
in two different function scopes (`switchPage` and
`ensurePageTemplateLoaded`). Two locals with the same name in separate scopes
is normal JavaScript, not a shadowing defect.

## The real defect, and the real fix

The actual D1 problem was **load-order/race**, not duplication.

The effective dispatcher is a wrapper chain:

```
window.switchPage
  = guardedSwitchPage            (index.html, __octagonTemplateGuard)
      -> module wrappers          (appointments, canonical-*, enterprise-suite, ...)
          -> function switchPage  (app.js:4134)
```

`guardedSwitchPage` awaits `ensurePageTemplateLoaded(page)` before delegating.
Module wrappers installed at script-eval time wrap the inner function; the
guard installs afterwards and becomes outermost. For a page that is a **core
`pageMap` entry** — `projects`, `mrp` — the shell hydrates `views/<page>.html`
into the page host, and that hydration can land after a synchronous render
dispatch, replacing a canonical workspace with retired legacy markup.

The fix, applied identically in `modules/canonical-projects.js` and
`modules/canonical-engineering.js`, is to wrap `switchPage` and activate the
workspace only once `ensurePageTemplateLoaded(page)` has settled:

```js
root.switchPage = function (page) {
  const result = orig.apply(this, arguments);
  if (page === '<page>') {
    Promise.resolve(root.ensurePageTemplateLoaded('<page>')).catch(() => {})
      .then(() => { const el = host(); if (el && el.classList.contains('page-active')) activate(); });
  }
  return result;
};
```

This makes the ordering deterministic instead of a race. It follows the
pattern already established by `modules/appointments.js`, adds **no third
dispatcher**, and preserves permission checks, lazy view loading, and every
existing module initialisation — all of which still run inside `orig`.

## Regression coverage

`tests/checkpoint-d-e/shell_dispatcher.test.mjs` asserts, as static
contracts against the real source:

1. `app.js` declares `switchPage` exactly once.
2. `renderAttendanceCalendar` is the only duplicate top-level function name,
   so a new navigation duplicate would fail this test.
3. Every canonical module (`canonical-projects`, `canonical-engineering`)
   wraps `switchPage`, calls the original, and gates activation on
   `ensurePageTemplateLoaded`.
4. Each canonical module guards its wrapper with a `__canonical*Wrapped` flag
   so repeated script evaluation cannot install a second wrapper.
5. `index.html` still installs the single template guard, and it is still
   idempotent via `__octagonTemplateGuard`.

Live confirmation on a disposable database: navigating to `projects` and to
`mrp` mounts the canonical workspace (18 and 12 tabs respectively) and the
legacy markup is gone.
