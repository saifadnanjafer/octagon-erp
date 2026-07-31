See `../page-register.md` — extended the existing، already-navigable "صحة
الإصدار" (Release Health) page with a fourth tab, "طابور المهام" (Job Queue),
showing queued/running/failed/dead-letter KPI cards and a dead-letter table.
Reuses the page's existing `renderKpiCard`/`renderTable`/tab-strip
components — no new UI primitives introduced. Bilingual: labels are Arabic
(matching the page's existing convention), data values are locale-neutral
numbers/timestamps. Not yet verified in a live browser — see
`../deferred-hardening.md` item 3.
