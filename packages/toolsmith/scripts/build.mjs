#!/usr/bin/env node
/**
 * Build the @mike-north/toolsmith CLI. One esbuild bundle, two consumers:
 *
 *   1. dist/toolsmith.mjs           — the npm package's `toolsmith` bin
 *                                     (gitignored; built by prepack).
 *   2. plugins/toolsmith/scripts/toolsmith.mjs
 *                                   — the COMMITTED copy shipped inside the
 *                                     plugin, so a marketplace install runs
 *                                     with zero build step and no
 *                                     node_modules. dist-sync.test.ts keeps
 *                                     it byte-identical to a fresh build.
 *
 * The bundle carries a `.mjs` extension on purpose: an extensionless
 * executable's module format depends on the nearest package.json ("type":
 * "module" in this repo, absent in a marketplace-installed plugin dir), so it
 * would parse in one context and crash in the other. `.mjs` pins ESM
 * everywhere, both via its shebang and via `node <path>`.
 *
 * The version is injected from this package's package.json at build time —
 * never hand-typed (no-hardcoded-versions rule).
 *
 * Usage:
 *   node scripts/build.mjs                 build dist/ + the plugin copy
 *   node scripts/build.mjs --out <path>    build a single bundle to <path>
 */
import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgRoot, '..', '..');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const singleOut = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : null;

const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
if (typeof manifest.version !== 'string' || !manifest.version) {
  console.error('package.json has no version string — refusing to build an unversioned CLI');
  process.exit(1);
}

// Bundle the shipped watchlist defaults so a bare npm install (no plugin
// directory anywhere nearby) still classifies against the real defaults —
// the on-disk plugin copy, when reachable, takes precedence at runtime.
const watchlistDefaults = readFileSync(
  join(repoRoot, 'plugins', 'toolsmith', 'skills', 'toolsmith', 'references', 'watchlist-defaults.json'),
  'utf8',
);
JSON.parse(watchlistDefaults); // fail the build on malformed defaults, not at runtime

const outfiles = singleOut
  ? [singleOut]
  : [
      join(pkgRoot, 'dist', 'toolsmith.mjs'),
      join(repoRoot, 'plugins', 'toolsmith', 'scripts', 'toolsmith.mjs'),
    ];

for (const outfile of outfiles) {
  await build({
    entryPoints: [join(pkgRoot, 'src', 'main.ts')],
    // Pin the working dir so the bundle's source-path comments are stable
    // regardless of where the build is invoked from (dist-sync depends on
    // byte-identical rebuilds).
    absWorkingDir: pkgRoot,
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    // `attest-it` (approve --setup only, a rare human-run one-time command)
    // is dynamically imported rather than inlined: its @attest-it/core
    // dependency ships a `yaml` build with a dynamic `require('process')`
    // esbuild cannot statically bundle into an ESM output. Marking it
    // external keeps the hot path (approve/verify/lint, which never import
    // it — see lib/attestation.ts's header) fully self-contained, and only
    // `--setup` needs `attest-it` resolvable from node_modules (true for the
    // npm-published dist/toolsmith.mjs, which declares it as a real
    // dependency; the committed marketplace copy degrades to a clear error
    // pointing at manual `.attest-it/config.yaml` authoring instead).
    external: ['attest-it'],
    banner: { js: '#!/usr/bin/env node' },
    define: {
      __TOOLSMITH_VERSION__: JSON.stringify(manifest.version),
      __TOOLSMITH_WATCHLIST_DEFAULTS__: JSON.stringify(watchlistDefaults),
    },
    legalComments: 'none',
    // No minification: the plugin copy is a committed, reviewable artifact.
    minify: false,
  });
  chmodSync(outfile, 0o755);
  console.log(`built ${outfile} (toolsmith ${manifest.version})`);
}
