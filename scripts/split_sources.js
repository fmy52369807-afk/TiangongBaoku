/**
 * Split the monolithic book source JSON into categorized files.
 * Also generates an index.json manifest for the integrated app.
 *
 * Usage: node scripts/split_sources.js
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const INPUT_FILE = '墨辰整理书源大全7.1（禁止倒卖）【最新完整】.json';
const SOURCES_DIR = 'sources';

// Category mapping: bookSourceGroup → output path
const CATEGORY_MAP = {
    '小说 书源':      'novel/free_novel.json',
    '正版小说 书源':   'novel/official_novel.json',
    '漫画 书源':      'comic/free_comic.json',
    '正版漫画 书源':   'comic/official_comic.json',
    '听书 书源':      'audio/audiobook.json',
    '音乐 书源':      'music/music_sources.json',
    '影视 书源':      'video/video.json',
    '游戏 书源':      'game/game.json',
    '特殊 书源':      'special/special.json',
};

// Short category slugs for index entries
const CATEGORY_SLUG = {
    '小说 书源':      'novel',
    '正版小说 书源':   'novel',
    '漫画 书源':      'comic',
    '正版漫画 书源':   'comic',
    '听书 书源':      'audio',
    '音乐 书源':      'music',
    '影视 书源':      'video',
    '游戏 书源':      'game',
    '特殊 书源':      'special',
};

// ── Main ────────────────────────────────────────────────────────────
console.log('Reading input file...');
const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
const sources = JSON.parse(raw);
console.log(`Loaded ${sources.length} sources.`);

// Group sources by category
const buckets = {};
const uncategorized = [];

for (const src of sources) {
    const group = src.bookSourceGroup || '(no group)';
    if (CATEGORY_MAP[group]) {
        if (!buckets[group]) buckets[group] = [];
        buckets[group].push(src);
    } else {
        uncategorized.push({ name: src.bookSourceName, group });
    }
}

// Write category files
console.log('\nWriting category files...');
const stats = {};
let grandTotal = 0;

for (const [group, filePath] of Object.entries(CATEGORY_MAP)) {
    const items = buckets[group] || [];
    const outputPath = path.join(SOURCES_DIR, filePath);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf-8');
    const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
    stats[group] = { count: items.length, file: filePath, size: sizeKB + ' KB' };
    grandTotal += items.length;
    console.log(`  ${filePath}: ${items.length} sources (${sizeKB} KB)`);
}

if (uncategorized.length > 0) {
    console.log(`\n⚠ Uncategorized sources (${uncategorized.length}):`);
    uncategorized.forEach(u => console.log(`  - ${u.name} | group="${u.group}"`));
    // Add uncategorized to special if any
    if (uncategorized.length > 0 && buckets['特殊 书源']) {
        buckets['特殊 书源'].push(...uncategorized.map(u => {
            const match = sources.find(s => s.bookSourceName === u.name && s.bookSourceGroup === u.group);
            return match || u;
        }));
        // Rewrite special file
        const specialPath = path.join(SOURCES_DIR, CATEGORY_MAP['特殊 书源']);
        fs.writeFileSync(specialPath, JSON.stringify(buckets['特殊 书源'], null, 2), 'utf-8');
        console.log(`  → Merged into special.json`);
    }
}

// ── Generate index.json ─────────────────────────────────────────────
console.log('\nGenerating index.json...');
const indexEntries = [];
let globalId = 1;

for (const [group, filePath] of Object.entries(CATEGORY_MAP)) {
    const items = buckets[group] || [];
    items.forEach((src, idx) => {
        indexEntries.push({
            id: `src_${String(globalId).padStart(4, '0')}`,
            name: src.bookSourceName || '',
            group: group,
            category: CATEGORY_SLUG[group] || 'other',
            url: src.bookSourceUrl || '',
            type: src.bookSourceType ?? 0,
            enabled: src.enabled ?? true,
            weight: src.weight ?? 0,
            comment: (src.bookSourceComment || '').substring(0, 100),
            file: filePath,
            index: idx,
        });
        globalId++;
    });
}

const indexPath = path.join(SOURCES_DIR, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(indexEntries, null, 2), 'utf-8');
console.log(`  index.json: ${indexEntries.length} entries`);

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
console.log('Split Summary');
console.log('═══════════════════════════════════════════');
for (const [group, info] of Object.entries(stats)) {
    console.log(`  ${group}: ${info.count} → ${info.file} (${info.size})`);
}
console.log(`  ─────────────────────────────`);
console.log(`  Total: ${grandTotal} sources`);
console.log(`  Index: sources/index.json (${indexEntries.length} entries)`);
console.log('═══════════════════════════════════════════');
