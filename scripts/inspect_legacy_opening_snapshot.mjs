// Read-only Phase 04 preflight for the legacy opening-stock source.
//
// SQLite can create -wal/-shm files merely by opening a WAL-mode database.
// This inspector therefore opens only a staged byte copy and verifies every
// operational source component before and after observation.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fingerprint(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { path: file, sha256: sha256File(file), size: stat.size };
}

function sourceComponents(source) {
  const sourceJson = path.basename(source).toLowerCase() === 'database.db'
    ? path.join(path.dirname(source), 'database.json')
    : null;
  return {
    database: fingerprint(source),
    wal: fingerprint(`${source}-wal`),
    shm: fingerprint(`${source}-shm`),
    json: sourceJson ? fingerprint(sourceJson) : null,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function inspectLegacyOpeningSnapshot(sourceDbPath) {
  const source = path.resolve(sourceDbPath);
  if (!fs.existsSync(source)) throw new Error(`Source database not found: ${source}`);
  const before = sourceComponents(source);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase04-observe-'));
  const staged = path.join(tempDir, 'database.db');
  let db;
  try {
    fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(`${source}-wal`)) {
      fs.copyFileSync(`${source}-wal`, `${staged}-wal`, fs.constants.COPYFILE_EXCL);
    }
    const afterCopy = sourceComponents(source);
    if (canonicalJson(afterCopy) !== canonicalJson(before)) {
      throw new Error('SOURCE_CHANGED_DURING_OBSERVATION_COPY');
    }

    db = new DatabaseSync(staged, { readOnly: true });
    const rows = db.prepare(`
      SELECT id, data
      FROM collections
      WHERE collection = 'omni.materials'
      ORDER BY id
    `).all();
    const materials = rows.map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
    const totals = materials.reduce((result, material) => {
      const onHand = Number(material.stock || 0);
      const reserved = Number(material.reservedQty ?? material.reserved ?? 0);
      const cost = Number(material.cost || 0);
      result.onHand += onHand;
      result.reserved += reserved;
      result.available += onHand - reserved;
      result.valuation += onHand * cost;
      if (onHand > 0 && (!Number.isFinite(cost) || cost <= 0)) {
        result.invalidCostMaterialIds.push(material.id);
      }
      return result;
    }, {
      onHand: 0,
      reserved: 0,
      available: 0,
      valuation: 0,
      invalidCostMaterialIds: [],
    });

    db.close();
    db = null;
    const after = sourceComponents(source);
    return {
      source,
      sourceComponentsBefore: before,
      sourceComponentsAfter: after,
      sourceUnchanged: canonicalJson(after) === canonicalJson(before),
      materialCount: materials.length,
      totals,
      materials: materials.map((material) => ({
        id: material.id,
        name: material.name || null,
        onHand: Number(material.stock || 0),
        reserved: Number(material.reservedQty ?? material.reserved ?? 0),
        available: Number(material.stock || 0) - Number(material.reservedQty ?? material.reserved ?? 0),
        unitCost: Number(material.cost || 0),
        valuation: Number(material.stock || 0) * Number(material.cost || 0),
      })),
    };
  } finally {
    try { db?.close(); } catch (_) {}
    for (const file of [`${staged}-shm`, `${staged}-wal`, staged]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(tempDir);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceArg = process.argv[2] || path.resolve('database.db');
  const result = inspectLegacyOpeningSnapshot(sourceArg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.sourceUnchanged && result.totals.invalidCostMaterialIds.length === 0 ? 0 : 2;
}
