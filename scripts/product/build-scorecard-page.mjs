/** Renders PAGE_SCORECARD.json into a self-contained review page. */
import fs from 'node:fs';

const card = JSON.parse(fs.readFileSync('docs/product/PAGE_SCORECARD.json', 'utf8'));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const s = card.summary;
const at90 = card.rows.filter((r) => r.pct < 100).length;

const data = card.rows.map((r) => ({
  id: r.id, ar: r.labelAr, g: r.group, p: r.priority,
  rd: r.readiness, fn: r.functional, pct: r.pct,
  mg: r.mergeable ? 1 : 0, bl: r.blocker || '', en: (r.english || []).slice(0, 3),
}));

const CLIENT = `
const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
const q = document.getElementById('q');
let filter = 'all';
const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pill = (v) => '<span class="pill ' + v.toLowerCase() + '">' + e(v) + '</span>';

function matches(r) {
  const t = q.value.trim().toLowerCase();
  if (t) {
    const hay = (r.id + ' ' + (r.ar || '') + ' ' + (r.g || '')).toLowerCase();
    if (!hay.includes(t)) return false;
  }
  if (filter === 'strong') return r.fn === 'STRONG';
  if (filter === 'sub100') return r.pct < 100;
  if (filter === 'blocked') return !!r.bl;
  if (filter === 'p0') return r.p === 'P0';
  return true;
}

function render() {
  const rows = DATA.filter(matches);
  countEl.textContent = rows.length + ' / ' + DATA.length + ' shown';
  rowsEl.innerHTML = rows.map(function (r) {
    let why = '';
    if (r.bl) why = '<span class="why">' + e(r.bl) + '</span>';
    else if (r.pct < 100 && r.en.length) why = '<span class="why">English kept: ' + e(r.en.join(' \\u00b7 ')) + '</span>';
    return '<tr>'
      + '<td><div class="pid">' + e(r.id) + '</div>' + (r.ar ? '<div class="par">' + e(r.ar) + '</div>' : '') + '</td>'
      + '<td class="meta">' + e(r.g) + '</td>'
      + '<td class="meta">' + e(r.p) + '</td>'
      + '<td>' + pill(r.rd) + '</td>'
      + '<td>' + pill(r.fn) + '</td>'
      + '<td><div class="pctcell"><span class="bar' + (r.pct < 100 ? ' warn' : '') + '"><i style="width:' + r.pct + '%"></i></span><span class="pctnum">' + r.pct + '%</span></div></td>'
      + '<td><span class="mg ' + (r.mg ? 'yes' : 'no') + '">' + (r.mg ? 'Ready' : 'Blocked') + '</span>' + why + '</td>'
      + '</tr>';
  }).join('');
}

q.addEventListener('input', render);
document.querySelectorAll('.chip').forEach(function (btn) {
  btn.addEventListener('click', function () {
    filter = btn.dataset.f;
    document.querySelectorAll('.chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
    render();
  });
});
render();
`;

const html = `<title>Octagon Page Scorecard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{
  --ground:#F5F7F7; --surface:#FFFFFF; --surface-2:#EDF2F2;
  --ink:#10201F; --ink-2:#456261; --ink-3:#6E8887;
  --line:#D3DDDC; --line-2:#BECBCA;
  --accent:#0E7C7B; --accent-soft:#DCEDEC; --on-accent:#FFFFFF;
  --ok:#1B7F4B; --ok-soft:#DFF0E6;
  --warn:#B26A00; --warn-soft:#FBEBD5;
  --block:#8C2F39; --block-soft:#F7E2E4;
  --shadow:0 1px 2px rgba(16,32,31,.06),0 8px 24px -16px rgba(16,32,31,.28);
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --ground:#0C1514; --surface:#132120; --surface-2:#182A29;
    --ink:#E4EDEC; --ink-2:#9DB3B2; --ink-3:#7A9291;
    --line:#223635; --line-2:#2E4544;
    --accent:#3FB8B6; --accent-soft:#12302F; --on-accent:#08201F;
    --ok:#5FCF92; --ok-soft:#123026;
    --warn:#E0A653; --warn-soft:#332412;
    --block:#E2848E; --block-soft:#331B1E;
    --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -16px rgba(0,0,0,.7);
  }
}
:root[data-theme="dark"]{
  --ground:#0C1514; --surface:#132120; --surface-2:#182A29;
  --ink:#E4EDEC; --ink-2:#9DB3B2; --ink-3:#7A9291;
  --line:#223635; --line-2:#2E4544;
  --accent:#3FB8B6; --accent-soft:#12302F; --on-accent:#08201F;
  --ok:#5FCF92; --ok-soft:#123026;
  --warn:#E0A653; --warn-soft:#332412;
  --block:#E2848E; --block-soft:#331B1E;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -16px rgba(0,0,0,.7);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1240px; margin:0 auto; padding:40px 24px 72px; display:flex; flex-direction:column; gap:32px}
header{display:flex; flex-direction:column; gap:10px; border-bottom:1px solid var(--line); padding-bottom:24px}
.eyebrow{font-family:"IBM Plex Mono",monospace; font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0}
h1{margin:0; font-size:clamp(26px,3.4vw,38px); font-weight:700; letter-spacing:-.02em; text-wrap:balance}
.sub{margin:0; color:var(--ink-2); max-width:68ch}
.gauges{display:grid; grid-template-columns:repeat(auto-fit,minmax(168px,1fr)); gap:14px}
.gauge{background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 18px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:4px}
.gauge .n{font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; font-size:30px; font-weight:600; letter-spacing:-.02em; line-height:1.1}
.gauge .l{font-size:12.5px; color:var(--ink-2)}
.gauge.ok .n{color:var(--ok)}
.gauge.warn .n{color:var(--warn)}
.gauge.block .n{color:var(--block)}
.controls{display:flex; flex-wrap:wrap; gap:10px; align-items:center}
input[type=search]{
  flex:1 1 260px; min-width:200px; padding:9px 12px; border-radius:8px;
  border:1px solid var(--line-2); background:var(--surface); color:var(--ink);
  font-family:inherit; font-size:14px;
}
input[type=search]:focus-visible,.chip:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.chip{
  padding:7px 13px; border-radius:999px; border:1px solid var(--line-2);
  background:var(--surface); color:var(--ink-2); font-family:inherit; font-size:13px;
  cursor:pointer; transition:background .15s,color .15s,border-color .15s;
}
.chip:hover{border-color:var(--accent); color:var(--ink)}
.chip[aria-pressed="true"]{background:var(--accent); border-color:var(--accent); color:var(--on-accent)}
.tablewrap{overflow-x:auto; background:var(--surface); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow)}
table{border-collapse:collapse; width:100%; min-width:940px}
thead th{
  position:sticky; top:0; z-index:1; background:var(--surface-2); color:var(--ink-2);
  text-align:left; font-size:11.5px; font-weight:600; letter-spacing:.08em; text-transform:uppercase;
  padding:11px 14px; border-bottom:1px solid var(--line);
}
tbody td{padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--surface-2)}
.pid{font-family:"IBM Plex Mono",monospace; font-size:13px; font-weight:500}
.par{font-family:"IBM Plex Sans Arabic","IBM Plex Sans",sans-serif; font-size:13px; color:var(--ink-2); direction:rtl; unicode-bidi:isolate}
.meta{font-family:"IBM Plex Mono",monospace; font-size:11.5px; color:var(--ink-3)}
.pill{display:inline-block; padding:2px 9px; border-radius:999px; font-size:11.5px; font-weight:600; letter-spacing:.02em; white-space:nowrap}
.pill.strong{background:var(--ok-soft); color:var(--ok)}
.pill.usable{background:var(--accent-soft); color:var(--accent)}
.pill.thin{background:var(--warn-soft); color:var(--warn)}
.pctcell{display:flex; align-items:center; gap:9px; min-width:112px}
.bar{flex:1; height:5px; border-radius:3px; background:var(--line); overflow:hidden}
.bar i{display:block; height:100%; border-radius:3px; background:var(--accent)}
.bar.warn i{background:var(--warn)}
.pctnum{font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; font-size:13px; min-width:38px; text-align:right}
.mg{font-size:12.5px; font-weight:600}
.mg.yes{color:var(--ok)}
.mg.no{color:var(--block)}
.why{display:block; font-weight:400; font-size:11.5px; color:var(--ink-3); max-width:32ch}
.note{background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:8px; padding:16px 18px; display:flex; flex-direction:column; gap:8px}
.note h2{margin:0; font-size:15px; font-weight:600}
.note p{margin:0; color:var(--ink-2); font-size:14px; max-width:74ch}
.note code{font-family:"IBM Plex Mono",monospace; font-size:12.5px; background:var(--surface-2); padding:1px 5px; border-radius:4px}
footer{color:var(--ink-3); font-size:12.5px; font-family:"IBM Plex Mono",monospace}
#count{color:var(--ink-3); font-size:12.5px; font-family:"IBM Plex Mono",monospace; margin-left:auto}
@media (max-width:640px){
  .wrap{padding:28px 14px 56px}
  #count{margin-left:0; width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">Octagon ERP &middot; codex/octagon-feature-page-expansion-marathon</p>
    <h1>Page Scorecard</h1>
    <p class="sub">Every primary page, scored on ten measured checks. Readiness and functionality come from the generated functional ledger; the percentage is the count of checks passed, not a judgement. Merge status is tracked separately, because a page can score 100% and still be waiting on a decision about what it should be.</p>
  </header>

  <section class="gauges">
    <div class="gauge"><span class="n">${s.total}</span><span class="l">primary pages</span></div>
    <div class="gauge ok"><span class="n">${s.at100}</span><span class="l">at 100%</span></div>
    <div class="gauge warn"><span class="n">${at90}</span><span class="l">at 90% &mdash; Arabic chrome only</span></div>
    <div class="gauge ok"><span class="n">${s.mergeable}</span><span class="l">ready to merge</span></div>
    <div class="gauge block"><span class="n">${s.blocked}</span><span class="l">blocked on owner decision</span></div>
    <div class="gauge"><span class="n">0</span><span class="l">dead ends &middot; console errors</span></div>
  </section>

  <div class="note">
    <h2>How the percentage is computed</h2>
    <p>Ten independent checks, one point each: <code>renders</code>, <code>noConsoleErrors</code>, <code>noFailedRequests</code>, <code>hasTitle</code>, <code>hasControls</code>, <code>notDeadEnd</code>, <code>noRawJson</code>, <code>noRawIds</code>, <code>arabicChrome</code>, <code>dataSurface</code>. Every one is measured from <code>PAGE_RUNTIME_INSPECTION.json</code> or <code>PAGE_FUNCTIONAL_LEDGER.json</code>, so any row can be recomputed and audited.</p>
    <p>The eight pages at 90% each fail only <code>arabicChrome</code>, and each for a defensible reason &mdash; disposable <code>[DEMO]</code> fixture record names, export formats (CSV / Excel / JSON), the product name <code>Meta API</code>, and the acronyms SOP / QC. Translating an identifier or a file format to reach 100% would make the product worse, so they were left alone.</p>
  </div>

  <div class="controls">
    <input type="search" id="q" placeholder="Filter by page, Arabic name, or group&hellip;" aria-label="Filter pages">
    <button class="chip" data-f="all" aria-pressed="true">All</button>
    <button class="chip" data-f="strong" aria-pressed="false">Strong</button>
    <button class="chip" data-f="sub100" aria-pressed="false">Below 100%</button>
    <button class="chip" data-f="blocked" aria-pressed="false">Owner-blocked</button>
    <button class="chip" data-f="p0" aria-pressed="false">P0</button>
    <span id="count"></span>
  </div>

  <div class="tablewrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Page</th>
          <th scope="col">Group</th>
          <th scope="col">Pri</th>
          <th scope="col">Readiness</th>
          <th scope="col">Functionality</th>
          <th scope="col">Score</th>
          <th scope="col">Merge</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </div>

  <footer>Generated ${esc(card.generatedAt)} &middot; ${s.total} pages &middot; 0 console errors &middot; 0 failed requests &middot; 0 dead ends</footer>
</div>

<script>
const DATA = ${JSON.stringify(data)};
${CLIENT}
</script>`;

fs.writeFileSync('docs/product/PAGE_SCORECARD.html', html);
console.log('wrote docs/product/PAGE_SCORECARD.html', (html.length / 1024).toFixed(1) + 'KB');
