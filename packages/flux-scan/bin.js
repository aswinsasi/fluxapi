#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// flux-scan — unscoped alias for @fluxiapi/cli
//
// This package exists so `npx flux-scan <url>` works without the scope.
// It simply forwards to the real CLI in @fluxiapi/cli, which reads the
// same process.argv, so every flag and option behaves identically.
// ═══════════════════════════════════════════════════════════════════

'use strict';

try {
  // The real CLI runs main() on load, reading process.argv.slice(2).
  // We keep argv untouched so all args/flags pass straight through.
  require('@fluxiapi/cli/dist/cli.js');
} catch (err) {
  console.error('  ❌ Could not load @fluxiapi/cli.');
  console.error('     Try running the scoped package directly:');
  console.error('       npx @fluxiapi/cli <url>');
  console.error('');
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
}
