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
    banner: { js: '#!/usr/bin/env node' },
    define: { __TOOLSMITH_VERSION__: JSON.stringify(manifest.version) },
    legalComments: 'none',
    // No minification: the plugin copy is a committed, reviewable artifact.
    minify: false,
  });
  chmodSync(outfile, 0o755);
  console.log(`built ${outfile} (toolsmith ${manifest.version})`);
}
