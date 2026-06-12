const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourcesDir = path.join(root, 'sources');
const quarantineDir = path.join(root, 'quarantine');
const docsDir = path.join(root, 'docs');

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
    console.error('Usage: node scripts/prune_dead_sources.js <sourceId...>');
    process.exit(1);
}

const indexPath = path.join(sourcesDir, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
const removeIds = new Set(ids);
const removed = [];
const byFile = new Map();

for (const entry of index) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
}

const sourceCache = new Map();
function loadSourceFile(file) {
    if (!sourceCache.has(file)) {
        sourceCache.set(file, JSON.parse(fs.readFileSync(path.join(sourcesDir, file), 'utf-8')));
    }
    return sourceCache.get(file);
}

for (const entry of index) {
    if (!removeIds.has(entry.id)) continue;
    const sourceList = loadSourceFile(entry.file);
    removed.push({
        removedAt: new Date().toISOString(),
        entry,
        source: sourceList[entry.index] || null,
    });
}

const missing = ids.filter(id => !removed.some(item => item.entry.id === id));
if (missing.length) {
    console.error('Missing source IDs: ' + missing.join(', '));
    process.exit(1);
}

const newIndex = [];
for (const [file, entries] of byFile) {
    const sourceList = loadSourceFile(file);
    const keptSources = [];
    const keptEntries = [];

    for (const entry of entries) {
        if (removeIds.has(entry.id)) continue;
        const source = sourceList[entry.index];
        if (!source) continue;
        keptEntries.push(entry);
        keptSources.push(source);
    }

    fs.writeFileSync(path.join(sourcesDir, file), JSON.stringify(keptSources, null, 2), 'utf-8');
    keptEntries.forEach((entry, idx) => {
        newIndex.push({ ...entry, index: idx });
    });
}

if (!fs.existsSync(quarantineDir)) fs.mkdirSync(quarantineDir, { recursive: true });
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const quarantinePath = path.join(quarantineDir, `removed_sources_${stamp}.json`);
const reportPath = path.join(docsDir, 'dead_source_prune_report.json');

fs.writeFileSync(indexPath, JSON.stringify(newIndex, null, 2), 'utf-8');
fs.writeFileSync(quarantinePath, JSON.stringify(removed, null, 2), 'utf-8');
fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    removedCount: removed.length,
    removed: removed.map(item => ({
        id: item.entry.id,
        name: item.entry.name,
        category: item.entry.category,
        status: item.entry.status,
        file: item.entry.file,
        index: item.entry.index,
        url: item.entry.url,
        comment: item.entry.comment || '',
    })),
    quarantinePath,
    beforeCount: index.length,
    afterCount: newIndex.length,
}, null, 2), 'utf-8');

console.log(`Removed ${removed.length} sources.`);
console.log(`Before: ${index.length}`);
console.log(`After: ${newIndex.length}`);
console.log(`Quarantine: ${quarantinePath}`);
console.log(`Report: ${reportPath}`);
