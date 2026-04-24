#!/usr/bin/env node
// Bundle src/services/evalRunner.ts with esbuild, then exec the bundle.
// Keeps the phase-2 bundling pattern (--define:import.meta.env={}) so the
// TS source compiles cleanly under Node without a Vite-style env shim.
//
// Usage:
//   node scripts/run-eval.mjs [fixtures|synthetic]

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');   // apps/market-ui/
const src = join(repoRoot, 'src/services/evalRunner.ts');
const outDir = join(repoRoot, 'node_modules/.cache/eval');
const out = join(outDir, 'eval.mjs');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log('[eval] Bundling evalRunner.ts…');
try {
    execFileSync(
        'npx',
        [
            '--no-install',
            'esbuild',
            src,
            '--bundle',
            '--platform=node',
            '--format=esm',
            '--define:import.meta.env={}',
            `--outfile=${out}`,
        ],
        { stdio: 'inherit', cwd: repoRoot, shell: process.platform === 'win32' },
    );
} catch (e) {
    console.error('[eval] Bundle failed:', e);
    process.exit(1);
}

const forwarded = process.argv.slice(2);
const result = spawnSync('node', [out, ...forwarded], { stdio: 'inherit' });
process.exit(result.status ?? 1);
