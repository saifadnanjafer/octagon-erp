# Commercial Master Consolidation

Canonical tables are `parties`, `party_roles`, `contacts`, `addresses`, `product_templates`, `product_variants`, `product_categories`, `uom_categories`, `uoms`, `product_barcodes`, `price_lists`, and `price_list_items`.

Canonical actions/queries are registered and raw-HTTP reachable. Company scope is injected by `domain-handler.mjs`; customer/supplier roles are validated by the sales/procurement/POS engines.

Actual-data disposable migration results:

- parties: 7 source / 7 canonical;
- products: 8 / 8;
- categories: 4;
- UOMs: 5;
- price lists/items: 6/8;
- stable maps overall: 37;
- barcodes: 0 source.

The product/material and party/customer/supplier live UI writers remain because stock-linked cutover cannot safely activate. They are compatibility sources, not claimed retired.
