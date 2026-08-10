#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'node_modules', '.npm-cache', '.playwright-cli', 'target', 'runtime', 'dist']);
const secretPatterns = [
  { type: 'jwt', re: /Bearer\s+[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/i },
  { type: 'authorization', re: /["']Authorization["']\s*:\s*["']Bearer\s+[^"']{16,}/i },
  { type: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { type: 'secret-assignment', re: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["'][^"']{12,}["']/i },
];

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (item.isDirectory()) {
      if (!ignored.has(item.name) && !rel.startsWith('output/')) walk(full, out);
    } else if (!/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|db|sqlite|zip|exe|dll|lib|rlib|pdb|pdf)$/i.test(item.name)) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];
for (const file of walk(root)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.re.test(text)) findings.push({ path: path.relative(root, file).replaceAll('\\', '/'), type: pattern.type });
  }
}

let trackedCount = 0;
try { trackedCount = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean).length; } catch {}
const report = {
  generatedAt: new Date().toISOString(),
  trackedFileCount: trackedCount,
  currentTree: findings,
  note: 'Values are never printed. Review Git history separately and rotate any previously published third-party credentials.',
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--ci') && findings.length) process.exitCode = 1;
