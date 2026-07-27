// Preview launcher WITH disposable test identities.
//
// Identical to preview-disposable-server.mjs, but additionally seeds the eight
// throwaway test roles so real Chromium acceptance can run authenticated
// workflows. Exists as a separate entry point because .claude/launch.json has
// no env field, and because making the fixture opt-in through a distinct,
// obviously-named script is safer than a flag on the normal preview.
//
// Still cannot touch operational data: the underlying launcher stages a
// disposable copy, and scripts/test-auth-fixture.mjs independently refuses any
// database path inside the repository root.

process.env.OCTAGON_TEST_FIXTURE = '1';
if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  console.error('[preview-auth] refusing to run with NODE_ENV=production');
  process.exit(1);
}

await import('./preview-disposable-server.mjs');
