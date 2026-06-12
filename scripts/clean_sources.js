/**
 * Source Cleaner — intelligently remove dead/duplicate sources
 * and produce clean category files + updated index.
 *
 * Usage: node scripts/clean_sources.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const SOURCES_DIR = 'sources';
const QUARANTINE_DIR = 'quarantine';
const DRY_RUN = process.argv.includes('--dry-run');

// ═════════════════════════════════════════════════════════
// Severity classification for error comments
// ═════════════════════════════════════════════════════════
const FATAL_PATTERNS = [
    /Unable to resolve host/i,       // DNS dead
    /No address associated/i,        // DNS dead
    /failed to connect/i,            // Server dead
    /Connection reset/i,              // Connection killed
    /PROTOCOL_ERROR/i,               // Protocol dead
    /stream was reset/i,             // Connection killed
    /Timed out waiting/i,            // Timeout (server likely dead)
];

const BROKEN_BOTH_PATTERNS = [
    /发现失效.*搜索失效/, /搜索失效.*发现失效/,
    /发现.*搜索.*失效/, /搜索.*发现.*失效/,
    /正文失效.*搜索失效/, /搜索失效.*正文失效/,
    /发现失效.*正文失效/, /正文失效.*发现失效/,
    /全[部都]失效/,
];

const SEARCH_BROKEN_PATTERNS = [
    /搜索失效/, /搜索暂不可用/, /搜索.*失效/,
    /搜索.*不可用/,
];

const DISCOVERY_BROKEN_PATTERNS = [
    /发现失效/, /发现目录失效/, /发现.*失效/,
];

const DOWNLOAD_BROKEN_PATTERNS = [
    /下载链接为空/, /下载失效/,
];

const VPN_NEEDED_PATTERNS = [
    /需要魔法/, /挂梯/, /需.(?:翻墙|科学|魔法|代理|VPN)/,
];

const CONTENT_BROKEN_PATTERNS = [
    /正文失效/, /正文.*失效/,
];

// ═════════════════════════════════════════════════════════
// Classify a source
// ═════════════════════════════════════════════════════════
function classifySource(src) {
    const comment = (src.bookSourceComment || '');
    const name = (src.bookSourceName || '');
    const url = (src.bookSourceUrl || '').trim();
    const combined = comment + ' ' + name;

    const verdict = {
        action: 'keep',      // keep | remove | dedup
        severity: 'ok',      // ok | partial | fatal | url_bad | vpn_needed
        reasons: [],
    };

    // Check URL first
    if (!url || url.length < 3 || url === 'undefined' || url === 'null') {
        verdict.action = 'remove';
        verdict.severity = 'url_bad';
        verdict.reasons.push('URL为空');
        return verdict;
    }

    // URL is pure Chinese
    if (/^[一-鿿]{2,}$/.test(url.replace(/#.*$/, '').trim()) && !/https?:\/\//i.test(url)) {
        verdict.action = 'remove';
        verdict.severity = 'url_bad';
        verdict.reasons.push('URL是纯中文描述，非实际地址');
        return verdict;
    }

    // Check fatal patterns
    for (const pattern of FATAL_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.action = 'remove';
            verdict.severity = 'fatal';
            verdict.reasons.push(`致命错误: ${pattern}`);
            return verdict; // Immediately fatal
        }
    }

    // Check both broken
    for (const pattern of BROKEN_BOTH_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.action = 'remove';
            verdict.severity = 'fatal';
            verdict.reasons.push(`搜索+发现均失效: ${pattern}`);
            return verdict;
        }
    }

    // Check VPN needed (not a removal reason)
    for (const pattern of VPN_NEEDED_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.severity = 'vpn_needed';
            verdict.reasons.push('需要特殊网络环境');
        }
    }

    // Check search broken
    for (const pattern of SEARCH_BROKEN_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.severity = verdict.severity === 'ok' ? 'partial' : verdict.severity;
            verdict.reasons.push('搜索功能失效');
        }
    }

    // Check discovery broken
    for (const pattern of DISCOVERY_BROKEN_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.severity = verdict.severity === 'ok' ? 'partial' : verdict.severity;
            verdict.reasons.push('发现功能失效');
        }
    }

    // Check content broken
    for (const pattern of CONTENT_BROKEN_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.severity = verdict.severity === 'ok' ? 'partial' : verdict.severity;
            verdict.reasons.push('正文获取失效');
        }
    }

    // Check download broken
    for (const pattern of DOWNLOAD_BROKEN_PATTERNS) {
        if (pattern.test(combined)) {
            verdict.reasons.push('下载功能失效');
            // Download-only sources with broken download = fatal
            if (src.bookSourceGroup === '特殊 书源' && /下载/.test(comment)) {
                verdict.action = 'remove';
                verdict.severity = 'fatal';
            }
        }
    }

    return verdict;
}

// ═════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════
function main() {
    console.log('🧹 源清理工具' + (DRY_RUN ? ' [DRY RUN模式]' : ''));
    console.log('═'.repeat(60));

    const index = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, 'index.json'), 'utf-8'));
    console.log(`加载索引: ${index.length} 条源`);

    // Load all sources
    const sourceFiles = {};
    for (const entry of index) {
        if (!sourceFiles[entry.file]) {
            sourceFiles[entry.file] = JSON.parse(
                fs.readFileSync(path.join(SOURCES_DIR, entry.file), 'utf-8')
            );
        }
    }

    // Classify all sources
    const results = {
        keep: [],
        remove: [],
        dedup: [],
    };
    const dedupSeen = new Map();

    for (const entry of index) {
        const src = sourceFiles[entry.file][entry.index];
        if (!src) continue;

        const enriched = { ...entry, _src: src };

        // Dedup check
        const dedupKey = `${src.bookSourceName}||${(src.bookSourceUrl || '').replace(/#.*$/, '').trim()}`;
        if (dedupSeen.has(dedupKey)) {
            // Keep the one with higher lastUpdateTime
            const existing = dedupSeen.get(dedupKey);
            if ((src.lastUpdateTime || 0) > (existing._src.lastUpdateTime || 0)) {
                // This one is newer, remove the old one
                results.dedup.push({ ...existing, reason: `重复源(保留更新版本): ${src.bookSourceName}` });
                dedupSeen.set(dedupKey, enriched);
            } else {
                results.dedup.push({ ...enriched, reason: `重复源: ${src.bookSourceName}` });
                continue;
            }
        } else {
            dedupSeen.set(dedupKey, enriched);
        }
    }

    // Classify non-duplicate sources
    for (const [key, entry] of dedupSeen) {
        const classification = classifySource(entry._src);
        if (classification.action === 'remove') {
            results.remove.push({
                ...entry,
                severity: classification.severity,
                reasons: classification.reasons,
            });
        } else {
            results.keep.push({
                ...entry,
                severity: classification.severity,
                reasons: classification.reasons,
            });
        }
    }

    // ══ Print report ══
    console.log(`\n📊 分类结果:`);
    console.log(`  ✅ 保留 (正常):     ${results.keep.filter(r => r.severity === 'ok').length}`);
    console.log(`  ⚠️  保留 (部分失效): ${results.keep.filter(r => r.severity === 'partial').length}`);
    console.log(`  🔒 保留 (需特殊网络): ${results.keep.filter(r => r.severity === 'vpn_needed').length}`);
    console.log(`  ❌ 移除 (确认失效): ${results.remove.length}`);
    console.log(`  🔄 移除 (重复源):   ${results.dedup.length}`);
    console.log(`  ─────────────────────────`);
    console.log(`  📦 保留总计:        ${results.keep.length}`);
    console.log(`  🗑️  移除总计:        ${results.remove.length + results.dedup.length}`);

    // Detail removed
    if (results.remove.length > 0) {
        console.log(`\n❌ 确认失效的源 (${results.remove.length}):`);
        const bySeverity = {};
        results.remove.forEach(r => {
            const s = r.severity || 'unknown';
            if (!bySeverity[s]) bySeverity[s] = [];
            bySeverity[s].push(r);
        });
        for (const [sev, items] of Object.entries(bySeverity)) {
            console.log(`\n  [${sev}] ${items.length} 条:`);
            items.forEach(item => {
                console.log(`    - [${item.id}] ${item.name}`);
                console.log(`      URL: ${item._src?.bookSourceUrl || 'N/A'}`);
                console.log(`      原因: ${item.reasons?.join(', ') || '未知'}`);
            });
        }
    }

    if (results.dedup.length > 0) {
        console.log(`\n🔄 重复源 (${results.dedup.length}):`);
        results.dedup.forEach(item => {
            console.log(`    - [${item.id}] ${item.reason}`);
        });
    }

    // Partial sources
    const partialKeeps = results.keep.filter(r => r.severity === 'partial');
    if (partialKeeps.length > 0) {
        console.log(`\n⚠️  部分功能失效但仍保留的源 (${partialKeeps.length}):`);
        partialKeeps.forEach(item => {
            console.log(`    - [${item.id}] ${item.name} | ${item.reasons?.join(', ')}`);
        });
    }

    // ══ Apply changes ══
    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN — 未实际修改文件。移除 --dry-run 以执行清理。');
        return;
    }

    // Create quarantine dir
    if (!fs.existsSync(QUARANTINE_DIR)) fs.mkdirSync(QUARANTINE_DIR);

    // Rebuild each category file with only kept sources
    const filesToRebuild = {};
    for (const entry of results.keep) {
        if (!filesToRebuild[entry.file]) {
            filesToRebuild[entry.file] = [];
        }
        filesToRebuild[entry.file].push(entry);
    }

    // Also collect all removed sources for quarantine
    const allRemoved = [...results.remove, ...results.dedup];
    const quarantineSources = [];

    console.log('\n📝 应用更改...');
    for (const [filePath, entries] of Object.entries(filesToRebuild)) {
        // Sort by original index to maintain order
        entries.sort((a, b) => a.index - b.index);

        // Rebuild source array
        const newSources = entries.map(e => e._src);
        const fullPath = path.join(SOURCES_DIR, filePath);
        fs.writeFileSync(fullPath, JSON.stringify(newSources, null, 2), 'utf-8');
        console.log(`  ✅ ${filePath}: ${newSources.length} 条源`);
    }

    // Save removed sources to quarantine
    allRemoved.forEach(entry => {
        quarantineSources.push({
            id: entry.id,
            name: entry.name,
            group: entry.group,
            url: entry._src?.bookSourceUrl || '',
            severity: entry.severity || 'dedup',
            reasons: entry.reasons || [entry.reason || '重复源'],
            originalFile: entry.file,
            originalIndex: entry.index,
            source: entry._src,
        });
    });

    const quarantinePath = path.join(QUARANTINE_DIR, 'removed_sources.json');
    fs.writeFileSync(quarantinePath, JSON.stringify(quarantineSources, null, 2), 'utf-8');
    console.log(`\n  🗄️  已移除的源备份到: ${quarantinePath}`);

    // Delete empty source files (if a category became empty)
    for (const [filePath, entries] of Object.entries(filesToRebuild)) {
        if (entries.length === 0) {
            const fullPath = path.join(SOURCES_DIR, filePath);
            fs.unlinkSync(fullPath);
            console.log(`  🗑️  删除空文件: ${filePath}`);
        }
    }

    // Regenerate index.json
    console.log('\n📋 重新生成 index.json...');
    const newIndex = [];
    let idCounter = 1;
    for (const [filePath, entries] of Object.entries(filesToRebuild)) {
        if (entries.length === 0) continue;
        entries.forEach((entry, idx) => {
            newIndex.push({
                id: `src_${String(idCounter).padStart(4, '0')}`,
                name: entry._src.bookSourceName || '',
                group: entry._src.bookSourceGroup || '',
                category: entry.category,
                url: entry._src.bookSourceUrl || '',
                type: entry._src.bookSourceType ?? 0,
                enabled: entry._src.enabled ?? true,
                weight: entry._src.weight ?? 0,
                comment: (entry._src.bookSourceComment || '').substring(0, 100),
                status: entry.severity,
                file: filePath,
                index: idx,
            });
            idCounter++;
        });
    }

    const newIndexPath = path.join(SOURCES_DIR, 'index.json');
    fs.writeFileSync(newIndexPath, JSON.stringify(newIndex, null, 2), 'utf-8');
    console.log(`  ✅ index.json: ${newIndex.length} 条源`);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('✅ 清理完成!');
    console.log('═'.repeat(60));
    console.log(`  清理前: ${index.length} 条源`);
    console.log(`  清理后: ${newIndex.length} 条源`);
    console.log(`  已移除: ${index.length - newIndex.length} 条源`);
    console.log(`    - 确认失效: ${results.remove.length}`);
    console.log(`    - 重复源:   ${results.dedup.length}`);
    console.log(`  正常源:   ${results.keep.filter(r => r.severity === 'ok').length}`);
    console.log(`  部分失效: ${results.keep.filter(r => r.severity === 'partial').length}`);
    console.log(`  需特殊网: ${results.keep.filter(r => r.severity === 'vpn_needed').length}`);
    console.log(`\n  移除的源备份在 quarantine/ 目录，可随时恢复`);
}

main();
