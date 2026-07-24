# Opening Stock Reservations by Material

## Detail Table

| Legacy Material ID | Material Name | On-Hand | Reserved Qty | Available Qty | Reservation Status | Source Document Type | Reconciled |
|---|---|---|---|---|---|---|---|
| `mat_acrylic` | أكريليك | 45 | 12 | 33 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_adhesive` | غراء | 18 | 2 | 16 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_foam` | فوم | 60 | 5 | 55 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_led` | LED | 200 | 50 | 150 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_mdf` | خشب MDF | 30 | 8 | 22 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_paint` | طلاء | 25 | 4 | 21 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_power` | محول كهرباء | 15 | 3 | 12 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| `mat_vinyl` | فينيل | 8 | 2 | 6 | `reserved_unallocated` | `legacy_opening_reservation` | YES |
| **TOTALS** | | **401** | **86** | **315** | | | **YES** |

## Unallocated Reservation Policy
All legacy reservations without an explicit sales order or work order link are set to status `reserved_unallocated` and tracked in `stock_reservations` and `phase04_opening_stock_reservations`. Available quantity for sales and manufacturing is strictly reduced to 315 units.
