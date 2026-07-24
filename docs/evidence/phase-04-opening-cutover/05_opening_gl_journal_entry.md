# Opening GL Journal Entry Evidence

## Document and Journal Details
- **Finance Document ID:** `fdoc_open_opening_stock_gl_batch_opening_...`
- **Document Number:** `OPEN-INV-001`
- **Journal Entry ID:** `fentry_open_opening_stock_gl_batch_opening_...`
- **Journal:** `jnl_opening` (Opening Journal / يومية افتتاحية)
- **Posting Date:** Single explicit cutover timestamp
- **State:** `posted`
- **Currency:** `IQD`

## Journal Lines Table

| Line ID | Account Code | Account Name | Debit (IQD) | Credit (IQD) | Description |
|---|---|---|---|---|---|
| `fline_debit_opening` | `104000` | Stock Valuation Asset / حساب تقييم المخزون | 1,963,000 | 0 | Opening Inventory Valuation Cutover (Asset) |
| `fline_credit_opening` | `390000` | Opening Balance Equity / حقوق الملكية الافتتاحية | 0 | 1,963,000 | Opening Inventory Equity Cutover (Credit) |
| **TOTALS** | | | **1,963,000** | **1,963,000** | **Balance Difference: 0 IQD** |
