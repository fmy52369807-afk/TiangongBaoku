#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { extractValue, extractList, applyTemplate, resolveUrl } = require('../server/engine/ruleParser');

const root = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'sources', 'index.json'), 'utf8'));
const byCategory = {};
for (const source of index) {
  const category = source.category || 'other';
  byCategory[category] ||= { configured: 0, enabled: 0 };
  byCategory[category].configured += 1;
  if (source.enabled) byCategory[category].enabled += 1;
}

const sample = [
  ['template', () => applyTemplate('https://example.test/search?q={{key}}&p={{page}}', { key: 'demo', page: 1 })],
  ['css', () => extractValue('<h1>Demo</h1>', 'h1@text')],
  ['jsonpath', () => extractList('{"data":{"items":[{"name":"Demo"}]}}', '$.data.items[*]')],
  ['url', () => resolveUrl('../chapter/1', 'https://example.test/book/2')],
];
const durations = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  for (const [, run] of sample) run();
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
const percentile = p => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))];
const report = {
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
  sourceInventory: {
    configured: index.length,
    enabled: index.filter(item => item.enabled).length,
    verified: null,
    verifiedNote: 'No external connectivity probe was run. Use scripts/check_sources.js for an opt-in, timestamped sample.',
    byCategory,
  },
  localRuleMicrobenchmark: { iterations: 100, p50Ms: Number(percentile(0.5).toFixed(3)), p95Ms: Number(percentile(0.95).toFixed(3)), sample: 'template/css/jsonpath/url fixtures' },
};
const outputIndex = process.argv.indexOf('--out');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) fs.writeFileSync(path.resolve(root, process.argv[outputIndex + 1]), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
