# BUILD-01 — Commercial Returns/RMA Single-Authority Foundation

Build a clean-room RMA case workflow on the selected cutover baseline.
`sales:return:create` remains the sole stock-and-finance return writer. The
new RMA case may orchestrate intake, approval, and disposition, but must
delegate any posted return to that existing action/engine rather than duplicate
inventory, fiscal, credit-note, or commission logic. Use disposable-database
tests only. Do not merge or cherry-pick expansion code.
