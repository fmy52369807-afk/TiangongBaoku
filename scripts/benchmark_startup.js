#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const iterations = Number(process.argv[process.argv.indexOf('--iterations') + 1]) || 7;
const values = [];

function freePort() {
    return 36000 + Math.floor(Math.random() * 2000);
}

async function measureOnce() {
    const port = freePort();
    const dbPath = path.join(os.tmpdir(), `tiangongbaoku-bench-${process.pid}-${Date.now()}-${port}.db`);
    const started = performance.now();
    const child = spawn(process.execPath, ['server/index.js'], {
        cwd: root,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath, DEMO_MODE: 'true', JWT_SECRET: 'benchmark-only' },
        stdio: ['ignore', 'ignore', 'ignore'],
    });
    try {
        let ready = false;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/health`);
                if (response.ok) { ready = true; break; }
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!ready) throw new Error('health endpoint did not become ready');
        return performance.now() - started;
    } finally {
        child.kill();
        for (const suffix of ['', '-shm', '-wal']) {
            try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
        }
    }
}

(async () => {
    for (let index = 0; index < iterations; index += 1) values.push(await measureOnce());
    values.sort((a, b) => a - b);
    const percentile = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
    const report = {
        generatedAt: new Date().toISOString(),
        environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
        coldStartup: {
            iterations,
            readyEndpoint: '/api/health',
            p50Ms: Number(percentile(0.5).toFixed(1)),
            p95Ms: Number(percentile(0.95).toFixed(1)),
            samplesMs: values.map((value) => Number(value.toFixed(1))),
            note: '从 spawn server/index.js 到 DEMO_MODE 健康检查返回 200；临时 SQLite；本地 Windows 进程测量。',
        },
    };
    const outputIndex = process.argv.indexOf('--out');
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(path.resolve(root, process.argv[outputIndex + 1]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
