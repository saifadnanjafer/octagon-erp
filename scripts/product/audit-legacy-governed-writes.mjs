/**
 * Legacy writes aimed at canonically-governed paths.
 *
 * The server refuses a legacy blob write that touches a governed path (409
 * FINANCE_CANONICAL_AUTHORITY_REQUIRED and friends). A page that still mutates
 * one of those omni.* keys therefore looks fine until a user actually edits
 * something, at which point the save fails. Read-only page inspection cannot
 * see this, because it never writes.
 *
 * This lists every module that mutates a governed omni.* key so each can be
 * checked by hand: some are genuine defects, others are reads/normalisation
 * that only look like writes.
 */
import fs from 'node:fs';
import { CANONICAL_AUTHORITY_COLLECTIONS } from '../../platform/cutover/canonical-authority-map.js';

const governed = new Map();
for (const domain of CANONICAL_AUTHORITY_COLLECTIONS) {
  for (const p of domain.paths) {
    if (p.startsWith('omni.')) governed.set(p.slice(5), domain.domain);
  }
}

const files = [
  ...fs.readdirSync('modules').filter((f) => f.endsWith('.js')).map((f) => `modules/${f}`),
  'app.js',
];

const MUTATORS = '(?:push|unshift|splice|pop|shift|sort)';
const findings = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (const [key, domain] of governed) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`omni\\.${esc}\\s*\\.\\s*${MUTATORS}\\s*\\(`),
      new RegExp(`omni\\.${esc}\\s*=[^=]`),
      new RegExp(`omni\\.${esc}\\s*\\[[^\\]]+\\]\\s*=[^=]`),
    ];
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (patterns.some((re) => re.test(line))) {
        findings.push({ file, line: i + 1, key, domain, snippet: line.trim().slice(0, 120) });
      }
    });
  }
}

const byFile = findings.reduce((acc, f) => {
  (acc[f.file] = acc[f.file] || []).push(f);
  return acc;
}, {});

console.log(`governed omni.* keys: ${governed.size}`);
console.log(`mutation sites found: ${findings.length} across ${Object.keys(byFile).length} files\n`);
for (const [file, list] of Object.entries(byFile)) {
  console.log(file);
  for (const f of list) console.log(`  :${String(f.line).padEnd(6)} ${f.domain.padEnd(14)} omni.${f.key}`);
}

fs.writeFileSync('docs/product/LEGACY_GOVERNED_WRITES.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), total: findings.length, findings }, null, 2));
