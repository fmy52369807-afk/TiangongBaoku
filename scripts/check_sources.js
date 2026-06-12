/**
 * Source validity checker — scans all sources for failure indicators,
 * URL problems, duplicates, and tests HTTP connectivity.
 *
 * Usage: node scripts/check_sources.js [--connectivity]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SOURCES_DIR = 'sources';
const TIMEOUT_MS = 8000;
const TEST_CONNECTIVITY = process.argv.includes('--connectivity');

// ═══════════════════════════════════════════════════════════════════
// Helper: extract a testable base URL from source
// ═══════════════════════════════════════════════════════════════════
function getBaseUrl(src) {
    const raw = src.bookSourceUrl || '';
    // Remove Legado fragment markers (#xxx, ##xxx)
    const cleaned = raw.replace(/#.*$/, '').trim();
    if (!cleaned || cleaned.length < 4) return null;

    // Extract first URL-like string
    const match = cleaned.match(/https?:\/\/[^\s,，;；]+/i);
    if (match) return match[0];

    // If it's a bare domain-like string
    if (/^[\w.-]+\.[a-z]{2,}/i.test(cleaned)) {
        return 'https://' + cleaned;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════
// Check 1: Failure markers in comments
// ═══════════════════════════════════════════════════════════════════
const FAILURE_PATTERNS = [
    /\/\/\s*Error/i, /失效/, /已失效/, /已挂/, /已死/, /无法使用/,
    /搜索失效/, /发现失效/, /登录失效/, /接口失效/, /源失效/,
    /不可用/, /已废弃/, /停止维护/, /不再维护/,
    /deprecated/i, /broken/i, /dead/i, /obsolete/i,
    /error/i,
];

function hasFailureMarker(src) {
    const fields = [
        src.bookSourceComment || '',
        src.bookSourceName || '',
        src.bookSourceUrl || '',
    ];
    const combined = fields.join(' ');
    for (const pattern of FAILURE_PATTERNS) {
        if (pattern.test(combined)) return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════
// Check 2: URL validity
// ═══════════════════════════════════════════════════════════════════
const BAD_URL_PATTERNS = [
    /^示例/, /^test$/i, /^localhost/i, /^127\./,
    /^http:\/\/localhost/i, /^http:\/\/127\./,
    /example\.com/i, /test\.com/i,
    /placeholder/i, /^xxx/i, /^aaa/i,
    /^null$/i, /^undefined$/i, /^none$/i,
    /^待定/, /^暂无/,
];

function hasBadUrl(src) {
    const url = (src.bookSourceUrl || '').trim();
    if (!url || url.length < 3) return { bad: true, reason: 'URL为空' };

    for (const pattern of BAD_URL_PATTERNS) {
        if (pattern.test(url)) return { bad: true, reason: `匹配模式: ${pattern}` };
    }

    // Check if URL is just a descriptive text, not an actual URL
    if (!/https?:\/\//i.test(url) && !/^[\w.-]+\.[a-z]{2,}/i.test(url)) {
        // Might be a service name rather than URL
        if (/^[一-鿿]{2,}$/.test(url)) {
            return { bad: true, reason: 'URL是纯中文描述（非实际地址）' };
        }
    }

    return { bad: false, reason: null };
}

// ═══════════════════════════════════════════════════════════════════
// Check 3: Find duplicates
// ═══════════════════════════════════════════════════════════════════
function findDuplicates(sources) {
    const seen = new Map();
    const duplicates = [];

    sources.forEach((src, idx) => {
        const name = (src.bookSourceName || '').trim();
        const url = (src.bookSourceUrl || '').replace(/#.*$/, '').trim();

        // Key by name+url combination
        const key = `${name}||${url}`;
        if (seen.has(key)) {
            duplicates.push({
                name,
                url,
                firstIndex: seen.get(key),
                duplicateIndex: idx,
            });
        } else {
            seen.set(key, idx);
        }
    });

    return duplicates;
}

// ═══════════════════════════════════════════════════════════════════
// Check 4: Suspicious indicators (may not be failures but worth flagging)
// ═══════════════════════════════════════════════════════════════════
function hasSuspiciousIndicators(src) {
    const issues = [];
    const comment = (src.bookSourceComment || '').toLowerCase();
    const name = (src.bookSourceName || '').toLowerCase();

    if (/备用|backup/i.test(comment)) issues.push('注释提到"备用"');
    if (/修复/i.test(comment)) issues.push('注释提到"修复"（可能之前失效过）');
    if (/待修/i.test(comment)) issues.push('注释提到"待修"');
    if (/测试/i.test(comment)) issues.push('注释提到"测试"');
    if (/暂[时未]/i.test(comment)) issues.push('注释提到"暂未/暂时"');

    return issues;
}

// ═══════════════════════════════════════════════════════════════════
// HTTP connectivity test
// ═══════════════════════════════════════════════════════════════════
async function testConnectivity(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            // Consider 2xx/3xx as alive, 4xx/5xx as possibly alive but restricted
            if (res.statusCode < 500) {
                resolve({ alive: true, status: res.statusCode });
            } else {
                resolve({ alive: false, status: res.statusCode, reason: `HTTP ${res.statusCode}` });
            }
            res.destroy();
        });
        req.on('error', (e) => {
            resolve({ alive: false, status: 0, reason: e.code || e.message });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ alive: false, status: 0, reason: 'timeout' });
        });
        setTimeout(() => {
            req.destroy();
            resolve({ alive: false, status: 0, reason: 'timeout' });
        }, TIMEOUT_MS);
    });
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════
async function main() {
    console.log('🔍 源有效性检查工具');
    console.log('═'.repeat(60));

    // Load index
    const index = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, 'index.json'), 'utf-8'));
    console.log(`加载索引: ${index.length} 条源`);

    // Load all sources into memory
    const allSources = [];
    for (const entry of index) {
        try {
            const filePath = path.join(SOURCES_DIR, entry.file);
            const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            const src = fileContent[entry.index];
            if (src) {
                allSources.push({ ...src, _indexId: entry.id, _file: entry.file, _idx: entry.index });
            }
        } catch (e) {
            console.log(`  ⚠ 无法加载: ${entry.id} ${entry.name}`);
        }
    }
    console.log(`成功加载: ${allSources.length} 条源\n`);

    // ══ Check 1: Failure markers ══
    console.log('═'.repeat(60));
    console.log('📋 检查 1: 注释/名称中的失效标记');
    console.log('═'.repeat(60));
    const failedMarked = allSources.filter(hasFailureMarker);
    console.log(`发现 ${failedMarked.length} 条源包含失效标记:\n`);
    failedMarked.forEach((src, i) => {
        const comment = (src.bookSourceComment || '').replace(/\n/g, ' ').substring(0, 80);
        console.log(`  ${i + 1}. [${src._indexId}] ${src.bookSourceName}`);
        console.log(`     Group: ${src.bookSourceGroup}`);
        console.log(`     Comment: ${comment}`);
        console.log();
    });

    // ══ Check 2: Bad URLs ══
    console.log('═'.repeat(60));
    console.log('📋 检查 2: URL 有效性');
    console.log('═'.repeat(60));
    const badUrlSources = [];
    allSources.forEach(src => {
        const result = hasBadUrl(src);
        if (result.bad) {
            badUrlSources.push({ ...src, _urlIssue: result.reason });
        }
    });
    console.log(`发现 ${badUrlSources.length} 条源 URL 异常:\n`);
    badUrlSources.forEach((src, i) => {
        console.log(`  ${i + 1}. [${src._indexId}] ${src.bookSourceName}`);
        console.log(`     URL: ${src.bookSourceUrl}`);
        console.log(`     Issue: ${src._urlIssue}`);
        console.log();
    });

    // ══ Check 3: Duplicates ══
    console.log('═'.repeat(60));
    console.log('📋 检查 3: 重复源检测');
    console.log('═'.repeat(60));
    const duplicates = findDuplicates(allSources);
    console.log(`发现 ${duplicates.length} 组重复源:\n`);
    duplicates.forEach((dup, i) => {
        console.log(`  ${i + 1}. "${dup.name}" (URL: ${dup.url})`);
    });

    // ══ Check 4: Suspicious indicators ══
    console.log('\n' + '═'.repeat(60));
    console.log('📋 检查 4: 可疑标记（可能有问题）');
    console.log('═'.repeat(60));
    const suspicious = allSources
        .map(src => ({ src, issues: hasSuspiciousIndicators(src) }))
        .filter(s => s.issues.length > 0);
    console.log(`发现 ${suspicious.length} 条源有可疑标记:\n`);
    suspicious.forEach(({ src, issues }, i) => {
        console.log(`  ${i + 1}. [${src._indexId}] ${src.bookSourceName}`);
        issues.forEach(issue => console.log(`     ⚡ ${issue}`));
    });

    // ══ Check 5: Optional connectivity test ══
    if (TEST_CONNECTIVITY) {
        console.log('\n' + '═'.repeat(60));
        console.log('📋 检查 5: HTTP 连通性测试（这可能需要几分钟）');
        console.log('═'.repeat(60));

        // Deduplicate URLs
        const uniqueUrls = new Map();
        allSources.forEach(src => {
            const baseUrl = getBaseUrl(src);
            if (baseUrl) {
                if (!uniqueUrls.has(baseUrl)) {
                    uniqueUrls.set(baseUrl, []);
                }
                uniqueUrls.get(baseUrl).push(src.bookSourceName);
            }
        });

        console.log(`去重后共 ${uniqueUrls.size} 个独立 URL，正在测试...\n`);

        const deadUrls = [];
        const aliveUrls = [];
        const errorUrls = [];
        let tested = 0;

        // Test in batches to avoid overwhelming the network
        const urlArray = Array.from(uniqueUrls.entries());
        const BATCH_SIZE = 10;

        for (let i = 0; i < urlArray.length; i += BATCH_SIZE) {
            const batch = urlArray.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(
                batch.map(async ([url, names]) => {
                    const result = await testConnectivity(url);
                    return { url, names, result };
                })
            );

            for (const { url, names, result } of results) {
                tested++;
                const pct = ((tested / urlArray.length) * 100).toFixed(0);
                if (result.alive) {
                    aliveUrls.push({ url, names, status: result.status });
                    process.stdout.write(`  [${pct}%] ✅ ${url} (${result.status})\n`);
                } else {
                    deadUrls.push({ url, names, reason: result.reason });
                    process.stdout.write(`  [${pct}%] ❌ ${url} (${result.reason})\n`);
                }
            }
        }

        console.log(`\n连通性测试完成:`);
        console.log(`  存活: ${aliveUrls.length}`);
        console.log(`  失效: ${deadUrls.length}`);

        // List dead ones
        if (deadUrls.length > 0) {
            console.log(`\n失效 URL 详情:`);
            deadUrls.forEach(({ url, names, reason }) => {
                console.log(`  ❌ ${url} [${reason}]`);
                console.log(`     关联源: ${names.slice(0, 3).join(', ')}`);
            });
        }
    }

    // ══ Summary ══
    console.log('\n' + '═'.repeat(60));
    console.log('📊 汇总报告');
    console.log('═'.repeat(60));

    // Combine all definitely-bad sources
    const badSourceIds = new Set();
    failedMarked.forEach(s => badSourceIds.add(s._indexId));
    badUrlSources.forEach(s => badSourceIds.add(s._indexId));

    console.log(`总源数:           ${allSources.length}`);
    console.log(`包含失效标记:     ${failedMarked.length}`);
    console.log(`URL 异常:         ${badUrlSources.length}`);
    console.log(`重复源组:         ${duplicates.length}`);
    console.log(`可疑标记:         ${suspicious.length}`);
    console.log(`确定有问题(去重): ${badSourceIds.size}`);
    console.log(`建议保留:         ${allSources.length - badSourceIds.size}`);

    // ══ Write report ══
    const report = {
        generatedAt: new Date().toISOString(),
        totalSources: allSources.length,
        failedMarked: failedMarked.map(s => ({
            id: s._indexId,
            name: s.bookSourceName,
            group: s.bookSourceGroup,
            comment: (s.bookSourceComment || '').substring(0, 200),
            file: s._file,
            index: s._idx,
        })),
        badUrls: badUrlSources.map(s => ({
            id: s._indexId,
            name: s.bookSourceName,
            url: s.bookSourceUrl,
            issue: s._urlIssue,
            file: s._file,
            index: s._idx,
        })),
        duplicates: duplicates,
        suspicious: suspicious.map(({ src, issues }) => ({
            id: src._indexId,
            name: src.bookSourceName,
            issues,
        })),
        summary: {
            definitelyBad: badSourceIds.size,
            probablyOk: allSources.length - badSourceIds.size,
            duplicates: duplicates.length,
        },
    };

    const reportPath = 'docs/source_check_report.json';
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n📄 详细报告已保存到: ${reportPath}`);
}

main().catch(console.error);
