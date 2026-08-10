#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const config = require('../server/config');
const { searchSource } = require('../server/routes/content-helpers');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'sources', 'index.json'), 'utf8'));
const sampleSize = Math.max(1, Number(process.argv[process.argv.indexOf('--sample') + 1]) || 28);
const timeoutMs = Math.min(5000, Number(process.env.VERIFY_SOURCE_TIMEOUT_MS) || 2500);
config.requestTimeout = timeoutMs;

function chooseSample() {
    const groups = new Map();
    for (const entry of index.filter((item) => item.enabled !== false)) {
        const key = entry.category || 'other';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }
    const categories = [...groups.keys()].sort();
    const selected = [];
    categories.forEach((category, categoryIndex) => {
        const list = groups.get(category);
        const wanted = Math.max(1, Math.floor(sampleSize / categories.length) + (categoryIndex < sampleSize % categories.length ? 1 : 0));
        for (let i = 0; i < Math.min(wanted, list.length); i += 1) selected.push(list[i]);
    });
    return selected.slice(0, sampleSize);
}

function classify(error) {
    const text = String(error?.message || error || '').toLowerCase();
    if (text.includes('timeout') || text.includes('timed out') || text.includes('abort')) return 'timeout';
    if (text.includes('private') || text.includes('blocked') || text.includes('forbidden')) return 'blocked';
    return 'failed';
}

function safeError(error) {
    return classify(error);
}

(async () => {
    const selected = chooseSample();
    const rows = [];
    for (const entry of selected) {
        const started = performance.now();
        try {
            const result = await searchSource(entry, 'demo', timeoutMs);
            const status = result.status === 'ok' && result.items?.length ? 'ok' : result.status === 'skipped' ? 'skipped' : result.status === 'ok' ? 'empty' : 'failed';
            rows.push({ sourceId: entry.id, category: entry.category || 'other', status, latencyMs: Number((performance.now() - started).toFixed(1)), itemCount: status === 'ok' ? result.items.length : 0, reason: status === 'ok' || status === 'empty' ? '' : safeError(result.error || result.listError) });
        } catch (error) {
            rows.push({ sourceId: entry.id, category: entry.category || 'other', status: classify(error), latencyMs: Number((performance.now() - started).toFixed(1)), itemCount: 0, reason: safeError(error) });
        }
    }
    const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
    const percentile = (p) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : null;
    const counts = rows.reduce((result, row) => { result[row.status] = (result[row.status] || 0) + 1; return result; }, {});
    const report = {
        generatedAt: new Date().toISOString(),
        environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
        inventory: { configured: index.length, enabled: index.filter((item) => item.enabled !== false).length, verified: counts.ok || 0, note: 'verified 仅表示本次固定关键词 demo 的搜索返回可解析条目；不是内容授权或长期可用性证明。' },
        sample: { requested: sampleSize, selected: rows.length, keyword: 'demo', timeoutMs, stratifiedBy: 'category', counts, latencyP50Ms: percentile(0.5), latencyP95Ms: percentile(0.95), parseSuccessRate: rows.length ? Number(((counts.ok || 0) / rows.length).toFixed(3)) : 0 },
        results: rows,
    };
    const outputIndex = process.argv.indexOf('--out');
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(path.resolve(root, process.argv[outputIndex + 1]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
