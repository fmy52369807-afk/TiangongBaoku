const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const http = require('node:http');
const { createApp } = require('../index');
const config = require('../config');
const { close: closeDb } = require('../db/database');

test('health, version and demo APIs respond from an isolated in-process server', async () => {
    const dbPath = path.join(os.tmpdir(), `tiangongbaoku-test-${process.pid}.db`);
    config.dbPath = dbPath;
    config.jwtSecret = 'test-only-secret';
    config.demoMode = true;
    const server = http.createServer(createApp());
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const deadline = Date.now() + 8000;
        let response;
        while (Date.now() < deadline) {
            try {
                response = await fetch(`http://127.0.0.1:${port}/api/health`);
                if (response.ok) break;
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(response && response.ok, 'health endpoint did not start');
        const health = await response.json();
        assert.equal(health.ok, true);
        const version = await fetch(`http://127.0.0.1:${port}/api/version`).then(r => r.json());
        assert.equal(version.product, 'TiangongBaoku');
        assert.equal(version.version, '0.2.0');
        assert.equal(version.engine, 'ruleParser v2-css-fix');
        assert.equal(version.demoMode, true);

        const search = await fetch(`http://127.0.0.1:${port}/api/content/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ keyword: 'fixture' }),
        }).then(r => r.json());
        assert.equal(search.totalResults, 5);
        assert.equal(search.results[0].items[0].sourceId, 'demo-novel');

        const detail = await fetch(`http://127.0.0.1:${port}/api/content/detail`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId: 'demo-novel', itemUrl: 'http://fixture.local/item' }),
        }).then(r => r.json());
        assert.equal(detail.profile.payloadKind, 'text');

        const entries = await fetch(`http://127.0.0.1:${port}/api/content/entries`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId: 'demo-comic', tocUrl: 'http://fixture.local/toc' }),
        }).then(r => r.json());
        assert.equal(entries.entries.length, 2);

        const payload = await fetch(`http://127.0.0.1:${port}/api/content/payload`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId: 'demo-comic', entryUrl: 'http://fixture.local/page' }),
        }).then(r => r.json());
        assert.equal(payload.type, 'images');
        assert.equal(payload.validation.ok, true);
    } finally {
        await new Promise(resolve => server.close(resolve));
        closeDb();
        config.demoMode = false;
        for (const suffix of ['', '-shm', '-wal']) {
            try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
        }
    }
});
