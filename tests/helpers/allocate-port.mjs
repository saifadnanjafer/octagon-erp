// Checkpoint G — deterministic free-port allocation for test servers.
//
// ROOT CAUSE THIS REPLACES.
//
// Every Phase 02 / Phase 03 test server used to pick its port by guessing
// inside a 1000-wide random range, and started the server with
// OCTAGON_FALLBACK_PORTS='' so there was no fallback if the port was taken.
//
// `node --test` runs test FILES in parallel. tests/phase02/
// browser-live-evidence.test.mjs used the ranges 19080-19680 and
// tests/phase02/runtime-adversarial.test.mjs used 19080-19580 — literally
// overlapping ranges, racing, with no fallback. That is the entire explanation
// for "browser-live-evidence passes alone and fails in the aggregate run": run
// it by itself and there is nothing to collide with.
//
// The fix is to stop guessing. `net.createServer().listen(0)` makes the OS
// assign a port that is genuinely free right now; we read it, release it, and
// hand it over. A narrow TOCTOU window remains between release and the server
// binding, so allocatePort() also refuses to hand back a port it has already
// issued in this process.
//
// This is not a delay-based fix, and it skips no test and weakens no assertion.

import net from 'node:net';

// Ports already handed out by this process. Two servers started from the same
// test file must not receive the same port even if the OS would happily offer
// it again after the probe socket closed.
const issued = new Set();

function probeOnce() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    // Bind to the loopback interface the test servers actually listen on, so a
    // port free on 0.0.0.0 but busy on 127.0.0.1 is not reported as free.
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * Allocate a TCP port that the OS reports as free on 127.0.0.1.
 * @param {{attempts?: number}} [options]
 * @returns {Promise<number>}
 */
export async function allocatePort({ attempts = 20 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const port = await probeOnce();
      if (issued.has(port)) continue;
      issued.add(port);
      return port;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `allocatePort: could not obtain a free port after ${attempts} attempts${lastError ? ` (${lastError.message})` : ''}`,
  );
}

/** Ports issued so far in this process — used by the isolation regression test. */
export function issuedPorts() {
  return [...issued];
}
