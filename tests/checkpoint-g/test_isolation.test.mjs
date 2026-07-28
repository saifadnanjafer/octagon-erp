// Checkpoint G — test isolation regression.
//
// Closes Checkpoint F blocker M2 / mission item G5.
//
// The Phase 02 browser suite passed alone and failed in the aggregate run. The
// cause was not flakiness in the product: test servers picked ports by guessing
// inside overlapping random ranges, with OCTAGON_FALLBACK_PORTS='' so a taken
// port was fatal. `node --test` runs files in parallel, and
// browser-live-evidence.test.mjs (19080-19680) and
// runtime-adversarial.test.mjs (19080-19580) overlapped directly.
//
// These tests lock the fix in: ports must come from the OS, must never repeat
// within a process, and no test file may go back to guessing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { allocatePort, issuedPorts } from '../helpers/allocate-port.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('allocatePort returns a port that is genuinely bindable', async () => {
  const port = await allocatePort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `implausible port ${port}`);

  // Prove it: actually bind it.
  await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => srv.close((e) => (e ? reject(e) : resolve())));
  });
});

test('allocatePort never issues the same port twice in one process', async () => {
  const ports = [];
  for (let i = 0; i < 25; i += 1) ports.push(await allocatePort());
  assert.equal(new Set(ports).size, ports.length, `allocatePort repeated a port: ${ports.join(',')}`);

  const all = issuedPorts();
  assert.equal(new Set(all).size, all.length, 'the issued-port ledger contains a duplicate');
});

test('concurrent allocation hands out distinct ports', async () => {
  const ports = await Promise.all(Array.from({ length: 16 }, () => allocatePort()));
  assert.equal(new Set(ports).size, ports.length, `concurrent allocation collided: ${ports.join(',')}`);
});

test('no test file guesses a port from a random range any more', () => {
  // The exact idiom that caused the aggregate failure. If it reappears
  // anywhere under tests/, this fails — including in new suites.
  const offenders = [];
  for (const file of walk(TESTS_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/Math\.floor\(Math\.random\(\)\s*\*\s*1000\)/.test(source)) {
      offenders.push(path.relative(TESTS_ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `test files still guess ports randomly: ${offenders.join(', ')}`);
});

test('every test file that starts a server allocates its port from the OS', () => {
  const offenders = [];
  for (const file of walk(TESTS_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    // A file that disables the server's own port fallback must not then pick
    // its port by any means other than allocatePort().
    if (!source.includes("OCTAGON_FALLBACK_PORTS: ''")) continue;
    if (!source.includes('allocatePort')) offenders.push(path.relative(TESTS_ROOT, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `these files disable port fallback but do not use allocatePort(): ${offenders.join(', ')}`,
  );
});
