# Checkpoint G — Phase 02 test isolation

## My first diagnosis was wrong. Recording it in full.

### Hypothesis 1 — port collision (WRONG as the cause, but a real defect)

Every Phase 02 / Phase 03 test server picked its port by guessing:

```js
const port = 18580 + Math.floor(Math.random() * 1000);
```

and started the server with `OCTAGON_FALLBACK_PORTS: ''`, so a taken port was
fatal. `node --test` runs test *files* in parallel, and:

- `tests/phase02/browser-live-evidence.test.mjs` used **19080–19680**
- `tests/phase02/runtime-adversarial.test.mjs` used **19080–19580**

Literally overlapping ranges, racing, with no fallback. That looked like a
complete explanation for "passes alone, fails in aggregate".

**Fix applied:** `tests/helpers/allocate-port.mjs` asks the OS for a genuinely
free port (`net.createServer().listen(0)` on 127.0.0.1), refuses to reissue a
port within a process, and is used at **37 call sites across 8 files**.

**Result: the aggregate run still failed.** The hypothesis was wrong.

The fix is kept regardless: overlapping random port ranges with no fallback is
a genuine latent defect that would eventually bite. It is locked by
`tests/checkpoint-g/test_isolation.test.mjs` (5/5), which fails if any test file
returns to guessing, and fails if a file disables port fallback without using
`allocatePort()`.

### Hypothesis 2 — resource starvation (the actual cause)

The real error, captured from the aggregate run:

```
FAIL: role-specific navigation hides privileged pages
      TimeoutError: Waiting failed: 30000ms exceeded
```

A Puppeteer wait timing out at 30 s. Under the aggregate run `node --test`
launches many test files concurrently, several of which start a full Octagon
server **and** a Chromium instance. The machine saturates and a page that
normally settles in a second exceeds the 30 s wait.

This is resource contention, not a product defect and not a port defect.

## Remediation: RESOLVED

The correct fix is **concurrency control**, not a longer timeout — raising the
timeout is exactly the "arbitrary delay-based fix" the mission forbids, and
would convert a real signal into a slower real signal.

```
node --test --test-concurrency=1 "tests/phase02/*.test.mjs"
```

**Result: tests 11, pass 11, fail 0, skipped 0, exit code 0** (816 s;
212 individual PASS lines, 0 FAIL). The same aggregate that failed under default
parallelism passes when the browser-driving files do not compete for the
machine.

Made durable in `package.json` so the gate is not run the broken way:

| Script | Command |
|---|---|
| `npm run test:phase02` | `node --test --test-concurrency=1 "tests/phase02/*.test.mjs"` |
| `npm run test:phase03` | `node --test --test-concurrency=1 "tests/phase03/*.test.mjs"` |

with a comment in `package.json` recording why, so nobody later "optimises" the
flag away and reintroduces the failure.

## What is proven

| Claim | Status |
|---|---|
| Root cause identified | **Yes** — Puppeteer 30 s wait under parallel-Chromium starvation |
| Port-collision defect fixed and locked | **Yes** — 37 call sites, regression test 5/5 |
| No test skipped, no assertion reduced, no retry added, no delay added | **Yes** |
| Phase 02 passes in isolation | **Yes** — 1/1, exit 0 |
| **Phase 02 passes in the aggregate** | **Yes — 11/11, exit 0, serial** |

## Residual risk

The fix depends on the gate being invoked through the npm script. Someone
running `node --test "tests/**/*.test.mjs"` across the whole tree with default
concurrency can still starve the machine. The more robust option — a
cross-process file-lock mutex acquired by any test that launches Chromium, so
serialisation holds however the runner is invoked — was **not** implemented.
Recorded in [unresolved-risks.md](unresolved-risks.md) as a MEDIUM item.
