# Bug Report Template — Octagon ERP Review Freeze 2

Copy this block into a new entry in `FUNCTIONAL_REVIEW_MATRIX.md` (as a row) and/or
file it wherever your team tracks issues. One finding per report — do not bundle
multiple unrelated defects.

```
Finding ID:            REV-<domain>-<3-digit-sequence>   e.g. REV-WMS-014
Date:                   YYYY-MM-DD
Reviewer:
Review tag/SHA:         octagon-review-build12-freeze-v2 / <commit sha>
Role:                   <the review identity you were signed in as, e.g. review.warehouse_operator>
Tenant/company/warehouse:
Language:               ar | en
Viewport/device:        desktop-1440x900 | laptop-1366x768 | tablet-1024x768 | mobile-390x844
Page ID:
Domain:
Severity:               P0 | P1 | P2 | P3   (see DESIGN_FINDINGS_GUIDE.md / ROLE_REVIEW_SCENARIOS.md for definitions)
Category:               consistency | usability | information-architecture | responsive | accessibility | content | functional | security-scope | performance
Preconditions:
Steps to reproduce:
  1.
  2.
  3.
Expected result:
Actual result:
Screenshot/video reference:
Console/network evidence:
Reproducibility:        always | intermittent | once
Workaround:
Suggested correction:
```

## Field notes

- **Finding ID**: keep it stable once assigned — other documents may reference it.
- **Review tag/SHA**: always the frozen snapshot you're reviewing against, not a moving branch tip.
- **Role**: use the exact review identity login (see `TEAM_HANDOFF.md`), not a generic description — this lets a developer reproduce with the identical grant set.
- **Severity**: P0 = data loss, security, wrong posting, or an unusable core flow. P1 = a major workflow failure. P2 = confusing or inefficient but functional. P3 = minor visual/content issue.
- **Category**: pick the single best fit from `DESIGN_FINDINGS_GUIDE.md`. If a finding spans two categories, file it under the more severe one and note the other in "Suggested correction".
- **Console/network evidence**: paste the exact error text or a failed request's method+path+status. "Nothing" is a valid answer — don't guess.
- Never attach real customer, payroll, or financial data to a finding. The review environment only ever contains fictional `[DEMO]`-labelled data; if you see something that looks real, stop and report it as a P0 security-scope finding immediately instead of filing a normal bug.
