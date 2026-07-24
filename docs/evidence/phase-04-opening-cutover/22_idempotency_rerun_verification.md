# Idempotency Re-run Verification Evidence

## Re-run Execution Summary

```json
{
  "idempotentRerun": true,
  "rerunCounts": {
    "first": {
      "maps": 37,
      "quarantine": 0,
      "parties": 7,
      "products": 8,
      "workItems": 11
    },
    "second": {
      "maps": 37,
      "quarantine": 0,
      "parties": 7,
      "products": 8,
      "workItems": 11
    }
  },
  "reconciliationMatch": {
    "firstRunStatus": "PASSED",
    "secondRunStatus": "PASSED",
    "stockOnHands": 401,
    "reservations": 86,
    "valuation": 1963000,
    "stockToGl": 1963000
  }
}
```

## Verification Result
Running `scripts/migrate_legacy_data.mjs` a second time against the migrated database produces exact identical row counts, exact identical mapping keys, zero duplicate moves/quants/GL entries, and 100% matching reconciliation gates.
