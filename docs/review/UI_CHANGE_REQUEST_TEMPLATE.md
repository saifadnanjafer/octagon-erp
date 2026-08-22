# UI Change Request Template — Octagon ERP Review Freeze 2

Use this for a *proposed improvement* — the page works, but the reviewer believes
it should look or behave differently. This is NOT a bug report (use
`BUG_REPORT_TEMPLATE.md` for something that's broken). UI change requests are
collected as input to a future global UI remediation scope — none of them are
implemented during Review Freeze 1 itself.

```
Page ID:
Current problem:
User affected:              <which review role(s) hit this>
Frequency:                  every session | daily | occasional | rare
Proposed layout/behavior:
Must preserve:               <existing behavior/data/permission that must not regress>
Related pages:
Arabic considerations:
English considerations:
Mobile considerations:
Accessibility considerations:
Acceptance criteria:
  -
  -
Priority:                    P0 | P1 | P2 | P3
```

## Field notes

- **Current problem**: describe the friction, not the fix — "the reviewer can't tell which
  jobs are overdue without opening each one" rather than "add a red badge."
- **Proposed layout/behavior**: a sketch, a reference to a similar page in this app that
  already does it well, or plain prose is all fine — this is a request, not a spec.
- **Must preserve**: call out anything the proposal must not break (a permission boundary,
  an existing keyboard flow, a field another workflow depends on).
- **Acceptance criteria**: written so someone else could verify the change later without
  re-reading the whole conversation.
- Do not propose changes to canonical workflow states, finance/inventory/manufacturing/
  quality/payroll authority, or anything listed as frozen in this repository's `CLAUDE.md`
  files — file those as a separate architectural discussion instead, not a UI change request.
