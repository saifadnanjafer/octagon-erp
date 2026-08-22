#!/usr/bin/env node
// Review Freeze 2 — UI/UX audit matrix generator (spec section 15).
//
// Reads docs/review/PAGE_INVENTORY.json (source of truth for the 233 real
// pages — never invent a pageId not present there) and emits
// docs/review/UI_UX_AUDIT_MATRIX.md: one row per page, grouped P0 -> P1 ->
// P2 -> P3 (spec section 11 ordering, so reviewers do P0 first), scored
// against the 8 categories in spec section 15 (Information Architecture,
// Visual Consistency, Data Presentation, States, Forms, Responsive UX,
// Accessibility, Language).
//
// This script does NOT score pages — it has no browser and cannot observe
// rendered UI. It produces the empty template (UI/UX/accessibility/
// responsive scores blank, "top issue" blank, reviewer blank, status
// "NOT REVIEWED") plus a "checklist notes" column populated only from
// static signals already present in PAGE_INVENTORY.json (hasPlaceholder,
// rtlStatus/ltrStatus gaps, mobileStatus, missing dedicated view file) so a
// human reviewer isn't re-deriving what's already known.
//
// Output is inventory/reporting ONLY — it never edits any page, view, or
// route, and never writes to PAGE_INVENTORY.json/database.db/database.json.
//
// Usage: node scripts/review/uiux-matrix.mjs   (or: npm run review:uiux-matrix)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const inventoryPath = path.join(repoRoot, 'docs', 'review', 'PAGE_INVENTORY.json');
const outPath = path.join(repoRoot, 'docs', 'review', 'UI_UX_AUDIT_MATRIX.md');

const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];
const PRIORITY_LABELS = {
  P0: 'P0 — Critical Operations',
  P1: 'P1 — High Priority',
  P2: 'P2 — Standard',
  P3: 'P3 — Low Priority',
};

// Spec section 15: the 8 UI/UX audit categories, listed here so the doc
// header stays self-documenting for reviewers who only open this file.
const CATEGORIES = [
  ['A. Information Architecture', 'purpose clear, correct nav group, title matches task, primary action visible, related actions grouped, no duplicate destinations'],
  ['B. Visual Consistency', 'spacing, typography, card structure, button hierarchy, form structure, table structure, badges/status colors, icon usage, borders/shadows, design-token compliance'],
  ['C. Data Presentation', 'readable labels/dates/numbers/currency/references, no raw IDs, no raw JSON, columns prioritized, long content handled, pagination/filter clarity'],
  ['D. States', 'loading, empty, denied, error, stale, success, partial failure, offline where applicable'],
  ['E. Forms', 'labels, required fields, defaults, lookup behavior, validation, error placement, cancel behavior, confirmation, destructive-action warning — N/A for pages with no form'],
  ['F. Responsive UX', 'desktop 1440x900, laptop 1366x768, tablet 1024x768, mobile 390x844, horizontal overflow, drawer/modal behavior, touch target size'],
  ['G. Accessibility', 'keyboard nav, focus visibility, logical tab order, semantic labels, contrast, screen-reader names, modal focus trap, Escape behavior'],
  ['H. Language', 'Arabic translation, English translation, RTL direction, LTR direction, mixed alignment, numeric/date readability, untranslated strings'],
];

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Static-signal checklist notes derived only from PAGE_INVENTORY.json fields — no observation, no scoring. */
function checklistNotes(page) {
  const notes = [];

  if (page.hasPlaceholder) {
    notes.push('placeholder content present');
  }
  if (/needs review/i.test(page.rtlStatus || '')) {
    notes.push('RTL gap: no Arabic label found');
  }
  if (!/English label present/i.test(page.ltrStatus || '')) {
    notes.push('LTR gap: no English label found');
  }
  if (/not verified/i.test(page.mobileStatus || '')) {
    notes.push('mobile status not verified');
  } else if (/kiosk-oriented/i.test(page.mobileStatus || '')) {
    notes.push('mobile/kiosk-oriented page');
  }
  if (page.hasViewFile === false) {
    notes.push('no dedicated view file (module/inline-rendered)');
  }
  if (page.hasPageMetadata === false) {
    notes.push('no PAGE_METADATA entry');
  }
  if (/^none/i.test(page.expectedDeniedState || '')) {
    notes.push('no permission gate (public/open page)');
  }

  return notes.length ? notes.join('; ') : '—';
}

function loadPages() {
  const raw = fs.readFileSync(inventoryPath, 'utf8');
  const pages = JSON.parse(raw);
  if (!Array.isArray(pages)) {
    throw new Error(`expected PAGE_INVENTORY.json to be a JSON array, got ${typeof pages}`);
  }
  for (const p of pages) {
    if (!p.pageId) throw new Error(`page missing pageId: ${JSON.stringify(p)}`);
    if (!PRIORITY_ORDER.includes(p.reviewPriority)) {
      throw new Error(`page ${p.pageId} has unknown reviewPriority ${JSON.stringify(p.reviewPriority)}`);
    }
  }
  return pages;
}

function renderCategoryLegend() {
  const lines = [
    '## Categories scored (spec section 15)',
    '',
    'Every page below is evaluated — by a human reviewer, in the running review',
    'environment — against these 8 categories:',
    '',
  ];
  for (const [name, detail] of CATEGORIES) {
    lines.push(`- **${name}** — ${detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderGroupTable(priority, pages) {
  const rows = pages
    .filter((p) => p.reviewPriority === priority)
    // Stable, deterministic order within a priority group: by moduleDomain then pageId.
    .sort((a, b) => {
      if (a.moduleDomain !== b.moduleDomain) return a.moduleDomain.localeCompare(b.moduleDomain);
      return a.pageId.localeCompare(b.pageId);
    });

  const header = `## ${PRIORITY_LABELS[priority]} (${rows.length} pages)`;
  const columns = [
    'Page ID', 'Label (EN)', 'Label (AR)', 'Module Domain', 'Priority',
    'Checklist Notes', 'UI Score', 'UX Score', 'A11y Score', 'Responsive Score',
    'Top Issue', 'Suggested Improvement', 'Reviewer', 'Status',
  ];
  const lines = [header, '', `| ${columns.join(' | ')} |`, `|${columns.map(() => '---').join('|')}|`];

  for (const p of rows) {
    const cells = [
      escapeCell(p.pageId),
      escapeCell(p.labelEn),
      escapeCell(p.labelAr),
      escapeCell(p.moduleDomain),
      escapeCell(p.reviewPriority),
      escapeCell(checklistNotes(p)),
      '—', '—', '—', '—',
      '—',
      '—',
      '—',
      'NOT REVIEWED',
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('');
  return { markdown: lines.join('\n'), rowCount: rows.length };
}

function main() {
  const pages = loadPages();

  const header = [
    '# UI/UX Audit Matrix — Octagon ERP Review Freeze 2',
    '',
    `Generated by \`scripts/review/uiux-matrix.mjs\` from \`docs/review/PAGE_INVENTORY.json\`.`,
    `Do not hand-edit the generated rows — re-run \`npm run review:uiux-matrix\` after` ,
    'PAGE_INVENTORY.json changes. Fill in scores/notes as a human reviewer, in place,' ,
    'below each row (or track edits in a copy — this file is the template).',
    '',
    `Total pages: **${pages.length}**. Grouped P0 first, then P1, P2, P3 (spec section 11 —` ,
    'reviewers work P0 first).',
    '',
    '## Scoring template (spec section 15)',
    '',
    'Per page, a human reviewer fills in: **UI score** (1-5), **UX score** (1-5),',
    '**accessibility score** (1-5), **responsive score** (1-5), **top issue**,',
    '**suggested improvement**, **reviewer** (login), **status**. All of these are',
    'left blank (`—`) / `NOT REVIEWED` below — this file cannot be scored by static',
    'analysis, it has no browser and does not observe rendered UI.',
    '',
    'The **checklist notes** column IS filled in here, from static signals already',
    'present in PAGE_INVENTORY.json (placeholder content, RTL/LTR label gaps,',
    'mobile-verification status, missing view file/metadata, open permission gate)',
    'so the reviewer is not re-deriving what is already known.',
    '',
  ].join('\n');

  const legend = renderCategoryLegend();

  const sections = [];
  let totalRows = 0;
  for (const priority of PRIORITY_ORDER) {
    const { markdown, rowCount } = renderGroupTable(priority, pages);
    sections.push(markdown);
    totalRows += rowCount;
  }

  if (totalRows !== pages.length) {
    throw new Error(`row count mismatch: emitted ${totalRows}, expected ${pages.length}`);
  }

  const out = [header, legend, ...sections].join('\n');
  fs.writeFileSync(outPath, out, 'utf8');

  console.log(`Wrote ${outPath}`);
  console.log(`Total pages: ${pages.length}`);
  for (const priority of PRIORITY_ORDER) {
    console.log(`  ${priority}: ${pages.filter((p) => p.reviewPriority === priority).length}`);
  }
}

main();
