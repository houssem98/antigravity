#!/usr/bin/env node
// Bundle and execute the phase-2 test suite. Mirrors run-eval.mjs so CI
// can invoke `npm run phase2` without knowing esbuild flags.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const src = join(repoRoot, 'src/services/deepResearchService.phase2.test.ts');
const outDir = join(repoRoot, 'node_modules/.cache/eval');
const out = join(outDir, 'phase2.mjs');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log('[phase2] Bundling test suite…');
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
            // exceljs and pptxgenjs both use dynamic require() for Node
            // builtins and stream helpers — esbuild's ESM bundler can't
            // inline those, so we externalize the packages and let Node's
            // runtime CJS loader resolve them natively.
            '--external:exceljs',
            '--external:pptxgenjs',
            `--outfile=${out}`,
        ],
        { stdio: 'inherit', cwd: repoRoot, shell: process.platform === 'win32' },
    );
} catch (e) {
    console.error('[phase2] Bundle failed:', e);
    process.exit(1);
}

const result = spawnSync('node', [out], { stdio: 'inherit' });
process.exit(result.status ?? 1);
