/**
 * Build script — merges all source data into app/js/data.js
 *
 * Usage: node scripts/build.js
 * Output: app/js/data.js (window.SOURCE_DATA embedded)
 */

const fs = require('fs');
const path = require('path');

const SOURCES_DIR = path.join(__dirname, '..', 'sources');
const OUTPUT_FILE = path.join(__dirname, '..', 'app', 'js', 'data.js');

// Category display config
const CATEGORY_CONFIG = {
    novel:  { icon: '📖', label: '小说',   order: 1 },
    comic:  { icon: '🎨', label: '漫画',   order: 2 },
    audio:  { icon: '🎧', label: '听书',   order: 3 },
    music:  { icon: '🎵', label: '音乐',   order: 4 },
    video:  { icon: '🎬', label: '影视',   order: 5 },
    game:   { icon: '🎮', label: '游戏',   order: 6 },
    special:{ icon: '🔧', label: '工具',   order: 7 },
};

console.log('🔨 Building app data...');

// Load index
const indexPath = path.join(SOURCES_DIR, 'index.json');
if (!fs.existsSync(indexPath)) {
    console.error('❌ index.json not found! Run split_sources.js first.');
    process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
console.log(`  Index: ${index.length} entries`);

// Build category summary
const categorySummary = {};
for (const [key, config] of Object.entries(CATEGORY_CONFIG)) {
    const entries = index.filter(e => e.category === key);
    categorySummary[key] = {
        key: key,
        icon: config.icon,
        label: config.label,
        order: config.order,
        count: entries.length,
    };
}

// Build lightweight output — only index metadata, NO full source objects
// Full source details are loaded on-demand via API
const output = {
    version: '2.0',
    builtAt: new Date().toISOString(),
    totalSources: index.length,
    categories: Object.values(categorySummary).sort((a, b) => a.order - b.order),
    index: index,  // Only id, name, group, category, url, type, enabled, weight, status, file, comment
};

const jsContent = `/**
 * Auto-generated source data for the 阅读+音乐 源管理器
 * Built at: ${output.builtAt}
 * Total sources: ${output.totalSources}
 * DO NOT EDIT MANUALLY — run "node scripts/build.js" to regenerate
 */
window.SOURCE_DATA = ${JSON.stringify(output, null, 2)};
`;

fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');
const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
console.log(`  Output: app/js/data.js (${sizeKB} KB)`);

// Summary
console.log(`\n✅ Build complete!`);
console.log(`   Total sources: ${output.totalSources}`);
for (const cat of output.categories) {
    console.log(`   ${cat.icon} ${cat.label}: ${cat.count}`);
}
