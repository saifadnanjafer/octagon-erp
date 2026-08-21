#!/usr/bin/env node
/*
 * Product Recovery 1 — Phase H: classify every unique runtime error seen
 * across the 231-page runtime inspection, instead of reporting only
 * aggregate counts.
 *
 * Source of truth: docs/product/PAGE_RUNTIME_INSPECTION.json
 * (consoleErrors[] and failedRequests[] per page, captured by
 * scripts/product/inspect-pages.mjs). Important framing: inspect-pages.mjs
 * never clicks a page's own action buttons (read-only by design), so every
 * error here fired purely from page LOAD/navigation — none were provoked by
 * a user submitting a form. That rules out "the user mistyped something" as
 * an explanation for any 4xx seen here; a validation-shaped status code on
 * an unattended page load is a client sending an incomplete default request,
 * not a user input problem.
 *
 * Classification is a first-pass heuristic keyed off HTTP status + path
 * shape, cross-referenced against docs/product/PAGE_REALITY_LEDGER.json so
 * each error is tagged with whether it lands on a page actually being kept
 * (KEEP_PRIMARY) — those are the ones Phase H says must be fixed before
 * closing this recovery wave.
 *
 * Output: docs/product/PAGE_RUNTIME_ERROR_LEDGER.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const P = (...parts) => path.join(root, ...parts);
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

const runtime = readJson(P('docs', 'product', 'PAGE_RUNTIME_INSPECTION.json'));
const reality = readJson(P('docs', 'product', 'PAGE_REALITY_LEDGER.json'));
if (!runtime) throw new Error('docs/product/PAGE_RUNTIME_INSPECTION.json is required');

const realityById = new Map((reality?.rows || []).map((row) => [row.pageId, row]));

const normalizePath = (p) => p
  .replace(/\/[0-9a-f]{6,}(?=\/|$)/gi, '/:id')
  .replace(/\/(rev_[a-z0-9_]+|usr_[a-z0-9_]+)(?=\/|$)/gi, '/:id')
  .replace(/=\d+/g, '=:n');

function classifyFailedRequest(status, detail = '') {
  if (status === 401) return { category: 'EXPECTED_AUTH', note: 'unauthenticated request — normal for a pre-login asset or a session boundary check' };
  if (status === 403) return { category: 'FIXTURE_GAP', note: 'permission denied — most 403s found this pass traced to a permission token missing from the registry entirely (see the fix for wms/shopfloor/quality :view tokens); treat each remaining one as a fixture/registry gap until proven otherwise, not an intentional restriction' };
  if (status === 404) return { category: 'BROKEN_ENDPOINT', note: 'client requested a path the server does not serve' };
  if (status === 409 && /CANONICAL_AUTHORITY_REQUIRED/.test(detail)) return { category: 'EXPECTED_CANONICAL_GUARD', note: 'the server refused a legacy full-state mutation of a canonical fact; the authority boundary held' };
  if (status === 400 || status === 422) return { category: 'CLIENT_CONTRACT_BUG', note: 'request rejected on page LOAD with no user input involved — the client is sending an incomplete/incorrect default request, not validating real user input' };
  if (status >= 500) return { category: 'SERVER_ERROR', note: 'server threw while handling the request' };
  return { category: 'UNKNOWN', note: `unclassified status ${status}` };
}

function classifyConsoleError(text) {
  if (/^Failed to load resource: the server responded with a status of \d+/.test(text)) {
    return { category: 'DERIVED_FROM_NETWORK_LOG', note: 'browser-generated duplicate of a failedRequests entry — not counted separately' };
  }
  if (/BLOCKED|refusing to persist/i.test(text)) return { category: 'EXPECTED_VALIDATION', note: 'a client-side safety guard intentionally refused an unsafe write — this is the guard working, not a bug' };
  if (/Cannot read propert|is not a function|is not defined|undefined is not|null is not an object/i.test(text)) {
    return { category: 'UNHANDLED_EXCEPTION', note: 'uncaught client-side JS exception' };
  }
  return { category: 'UNKNOWN', note: 'unrecognized console.error text — needs manual triage' };
}

// --- aggregate failed requests -------------------------------------------
const failedGroups = new Map();
runtime.pages.forEach((pageEntry) => {
  (pageEntry.failedRequests || []).forEach((req) => {
    const key = `${req.status} ${req.method || 'GET'} ${normalizePath(req.path)}`;
    if (!failedGroups.has(key)) {
      const { category, note } = classifyFailedRequest(req.status, req.detail);
      failedGroups.set(key, { status: req.status, method: req.method || 'GET', path: normalizePath(req.path), category, note, pages: new Set() });
    }
    failedGroups.get(key).pages.add(pageEntry.id);
  });
});

// --- aggregate console errors (excluding the browser-generated duplicates) ---
const consoleGroups = new Map();
runtime.pages.forEach((pageEntry) => {
  (pageEntry.consoleErrors || []).forEach((text) => {
    const { category, note } = classifyConsoleError(text);
    if (category === 'DERIVED_FROM_NETWORK_LOG') return;
    const key = `${category}::${text.slice(0, 140)}`;
    if (!consoleGroups.has(key)) consoleGroups.set(key, { text: text.slice(0, 200), category, note, pages: new Set() });
    consoleGroups.get(key).pages.add(pageEntry.id);
  });
});

const isRetained = (pageId) => {
  const row = realityById.get(pageId);
  if (!row) return { retained: null, priority: null };
  const disposition = row.recommendedDisposition || '';
  const retained = disposition.startsWith('KEEP_PRIMARY') || (!row.emptinessCause && (row.functionalState === 'STRONG' || row.functionalState === 'USABLE'));
  return { retained, priority: row.reviewPriority };
};

const rows = [];
failedGroups.forEach((group) => {
  const pages = [...group.pages];
  const retainedP0P1 = pages.filter((id) => { const r = isRetained(id); return r.retained && (r.priority === 'P0' || r.priority === 'P1'); });
  rows.push({
    kind: 'network', status: group.status, method: group.method, path: group.path,
    category: group.category, note: group.note, pages, pageCount: pages.length,
    retainedP0P1Pages: retainedP0P1, needsFix: retainedP0P1.length > 0,
  });
});
consoleGroups.forEach((group) => {
  const pages = [...group.pages];
  const retainedP0P1 = pages.filter((id) => { const r = isRetained(id); return r.retained && (r.priority === 'P0' || r.priority === 'P1'); });
  rows.push({
    kind: 'console', text: group.text,
    category: group.category, note: group.note, pages, pageCount: pages.length,
    retainedP0P1Pages: retainedP0P1, needsFix: retainedP0P1.length > 0,
  });
});
rows.sort((a, b) => b.pageCount - a.pageCount);

const categoryCounts = rows.reduce((acc, row) => { acc[row.category] = (acc[row.category] || 0) + 1; return acc; }, {});
const needsFixRows = rows.filter((row) => row.needsFix);

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
const clip = (value, max) => { const text = cell(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

const md = [];
md.push('# Page Runtime Error Ledger');
md.push('');
md.push('Generated by `scripts/product/build-runtime-error-ledger.mjs` — do not hand-edit.');
md.push(`Source: docs/product/PAGE_RUNTIME_INSPECTION.json (${runtime.generatedAt}).`);
md.push('');
md.push('Every error here fired on page LOAD — `inspect-pages.mjs` never clicks a page\'s own');
md.push('action buttons, so nothing in this file was provoked by a user submitting a form.');
md.push('A validation-shaped 4xx on an unattended page load means the client sent an');
md.push('incomplete default request, not that a user typed something wrong.');
md.push('');
md.push(`Unique error signatures: **${rows.length}** (${failedGroups.size} network, ${consoleGroups.size} console)`);
md.push(`Signatures that hit a retained P0/P1 page (must fix before closing this recovery wave): **${needsFixRows.length}**`);
md.push('');
md.push('## Category distribution');
md.push('');
md.push('| Category | Unique signatures |');
md.push('|---|---|');
Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => md.push(`| ${cat} | ${count} |`));
md.push('');

md.push(`## Signatures on retained P0/P1 pages — fix these (${needsFixRows.length})`);
md.push('');
md.push('| Kind | Signature | Category | Pages hit | P0/P1 pages needing fix | Note |');
md.push('|---|---|---|---|---|---|');
needsFixRows.forEach((row) => {
  const signature = row.kind === 'network' ? `${row.status} ${row.method} ${row.path}` : row.text;
  md.push(`| ${row.kind} | ${clip(signature, 70)} | ${cell(row.category)} | ${row.pageCount} | ${clip(row.retainedP0P1Pages.map((p) => `\`${p}\``).join(', '), 60)} | ${clip(row.note, 90)} |`);
});
md.push('');

md.push(`## All other signatures (${rows.length - needsFixRows.length})`);
md.push('');
md.push('| Kind | Signature | Category | Pages hit | Note |');
md.push('|---|---|---|---|---|');
rows.filter((row) => !row.needsFix).forEach((row) => {
  const signature = row.kind === 'network' ? `${row.status} ${row.method} ${row.path}` : row.text;
  md.push(`| ${row.kind} | ${clip(signature, 70)} | ${cell(row.category)} | ${row.pageCount} | ${clip(row.note, 90)} |`);
});
md.push('');
fs.writeFileSync(P('docs', 'product', 'PAGE_RUNTIME_ERROR_LEDGER.md'), `${md.join('\n')}\n`, 'utf8');

// Machine-readable twin, for tests/functional-pages to assert against
// without re-parsing markdown.
const jsonOut = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/product/build-runtime-error-ledger.mjs',
  totalSignatures: rows.length,
  needsFixCount: needsFixRows.length,
  categoryCounts,
  needsFix: needsFixRows.map((row) => ({
    kind: row.kind,
    signature: row.kind === 'network' ? `${row.status} ${row.method} ${row.path}` : row.text,
    category: row.category,
    note: row.note,
    pageCount: row.pageCount,
    retainedP0P1Pages: row.retainedP0P1Pages,
  })),
};
fs.writeFileSync(P('docs', 'product', 'PAGE_RUNTIME_ERROR_LEDGER.json'), `${JSON.stringify(jsonOut, null, 2)}\n`, 'utf8');

console.log(`Runtime error ledger: ${rows.length} unique signatures (${needsFixRows.length} on retained P0/P1 pages) -> docs/product/PAGE_RUNTIME_ERROR_LEDGER.md`);
console.log(`  categories: ${JSON.stringify(categoryCounts)}`);
