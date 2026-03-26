#!/usr/bin/env node
// Starts the Gravity FastAPI backend (port 8000) using its dedicated Python venv.
// Called by: npm run gravity (root package.json)

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Gravity backend is a sibling of the Kimi project root
const GRAVITY_DIR = path.resolve(
    __dirname,
    '..',        // scripts/ → project root
    '..',        // project root → "antiravity -zitoun ai"
    'gravity-search-starter',
    'gravity-search-starter',
    'backend'
);

// Use the venv Python (Windows: Scripts/python.exe)
const VENV_PYTHON = path.join(GRAVITY_DIR, '.venv', 'Scripts', 'python.exe');
const FALLBACK_PYTHON = 'python';

const PORT = 8000;

// ─── Check if port already in use ────────────────────────────────────────────

function isPortBusy(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => { server.close(); resolve(false); });
        server.listen(port, '127.0.0.1');
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const busy = await isPortBusy(PORT);
if (busy) {
    console.log(`[Gravity] Port ${PORT} already in use — Gravity backend already running.`);
    process.exit(0);
}

// Pick Python: prefer venv, fallback to system Python
const pythonExe = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : FALLBACK_PYTHON;
console.log(`[Gravity] Starting FastAPI...`);
console.log(`[Gravity] Python: ${pythonExe}`);
console.log(`[Gravity] CWD:    ${GRAVITY_DIR}`);

const proc = spawn(
    pythonExe,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--reload'],
    {
        cwd: GRAVITY_DIR,
        stdio: 'inherit',
        shell: false,
    }
);

proc.on('error', (err) => {
    console.error(`[Gravity] Failed to start: ${err.message}`);
    process.exit(1);
});

proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`[Gravity] Process exited with code ${code}`);
        process.exit(code ?? 1);
    }
});

// Forward SIGINT/SIGTERM so Ctrl-C kills the child too
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => proc.kill(sig));
}
