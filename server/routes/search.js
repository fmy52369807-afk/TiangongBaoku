/**
 * Search routes — cross-source search via proxying source websites
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const {
    buildUrl,
    cleanSourceUrl,
    createContext,
    fetchSourceUrl,
    resolveUrl,
    runRule,
    runRuleList,
} = require('../engine/legadoEngine');

const router = express.Router();

// Check if extracted value looks like a failed rule (raw expression returned)
function isFailedExtraction(val, rule) {
    if (!val || val.length < 1) return true;
    // Equal to the rule itself = extraction failed (most reliable check)
    if (val === rule) return true;
    // Looks like a JSONPath or CSS rule expression
    if (/^\$\.[a-zA-Z]/.test(val) || /^[a-z]+\d*@[a-z]/.test(val)) return true;
    return false;
}

function cleanExtracted(val, rule) {
    if (isFailedExtraction(val, rule)) return '';
    return val || '';
}

function loadIndex() {
    const indexPath = path.join(config.sourcesPath, 'index.json');
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
}
function loadSourceFile(filePath) {
    const fullPath = path.join(config.sourcesPath, filePath);
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

// POST /api/search
router.post('/', async (req, res) => {
    try {
        const { keyword, category, sourceIds } = req.body;
        const disabledSourceIds = Array.isArray(req.body.disabledSourceIds)
            ? new Set(req.body.disabledSourceIds.map(String))
            : new Set();
        const maxResults = Math.min(
            Math.max(parseInt(req.body.maxResults || config.maxSearchResults, 10) || config.maxSearchResults, 1),
            100
        );
        if (!keyword || keyword.trim().length < 1) {
            return res.status(400).json({ error: '请输入搜索关键词' });
        }

        const index = loadIndex();
        let targets = index.filter(entry => entry.enabled !== false && !disabledSourceIds.has(String(entry.id)));

        // Filter by category
        if (category && category !== 'all') {
            targets = targets.filter(e => e.category === category);
        }

        // Filter by specific source IDs
        if (sourceIds && Array.isArray(sourceIds)) {
            targets = targets.filter(e => sourceIds.includes(e.id));
        }

        // Prioritize ok sources, then try a bounded number of sources in parallel.
        targets.sort((a, b) => (a.status === 'ok' ? -1 : 1) - (b.status === 'ok' ? -1 : 1));
        targets = targets.slice(0, 50);

        const errors = [];
        const results = [];

        // Run all searches in parallel for speed
        const searchPromises = targets.map(entry => (async () => {
            try {
                const fileData = loadSourceFile(entry.file);
                const source = fileData[entry.index];
                if (!source || !source.searchUrl) return;

                const context = createContext(source, {
                    key: keyword,
                    page: 1,
                    timeout: config.jsRuntimeTimeout,
                });
                const searchTarget = buildUrl(source.searchUrl, context);
                const searchUrl = searchTarget.url;

                // Skip non-HTTP URLs and URLs with unresolved templates
                if (!searchUrl.startsWith('http')) return;
                if (searchUrl.includes('{{') || searchUrl.includes('}}')) return;

                const raw = await fetchSourceUrl(searchUrl, context, {
                    headers: searchTarget.headers,
                    timeout: config.requestTimeout,
                });

                if (!raw || raw.length < 10) return;
                if (raw.length < 200 && raw.includes('<html') && (raw.includes('404') || raw.includes('not found'))) return;

                const ruleSearch = source.ruleSearch || {};
                const ruleContext = { ...context, baseUrl: searchUrl, result: raw };
                const bookList = runRuleList(raw, ruleSearch.bookList, ruleContext);

                const validItems = (bookList || []).filter(item => {
                    if (typeof item === 'string' && item === raw) return false;
                    return true;
                });

                if (validItems.length === 0) {
                    errors.push({ sourceId: entry.id, name: entry.name, error: '规则未匹配(模板可能已变更)' });
                    return;
                }

                const items = validItems.slice(0, 30).map(item => {
                    const itemContext = { ...ruleContext, result: item };
                    const name = runRule(item, ruleSearch.name, itemContext);
                    const author = runRule(item, ruleSearch.author, itemContext);
                    const bookUrlRaw = runRule(item, ruleSearch.bookUrl, itemContext);
                    const intro = runRule(item, ruleSearch.intro, itemContext);
                    const coverUrl = runRule(item, ruleSearch.coverUrl, itemContext);

                    let bookUrl = buildUrl(String(bookUrlRaw || ''), {
                        ...itemContext,
                        baseUrl: searchUrl || cleanSourceUrl(source.bookSourceUrl),
                    }).url;
                    if (bookUrl.includes('{{') || bookUrl.includes('}}') || bookUrl.includes('@js:')) bookUrl = '';

                    return {
                        sourceId: entry.id, sourceName: entry.name,
                        name: cleanExtracted(name, ruleSearch.name),
                        author: cleanExtracted(author, ruleSearch.author),
                        bookUrl: bookUrl,
                        coverUrl: String(coverUrl || ''),
                        intro: String(intro || '').substring(0, 200),
                        raw: Buffer.from(JSON.stringify(item)).toString('base64'),
                    };
                }).filter(item => {
                    if (!item.name || item.name.length <= 1) return false;
                    const kw = String(keyword).toLowerCase();
                    return (
                        item.name.toLowerCase().includes(kw) ||
                        String(item.author || '').toLowerCase().includes(kw)
                    );
                }).slice(0, 5);

                if (items.length > 0 && results.reduce((sum, r) => sum + r.items.length, 0) < maxResults) {
                    results.push({
                        sourceId: entry.id, sourceName: entry.name,
                        category: entry.category, count: items.length, items,
                    });
                }
            } catch (err) {
                errors.push({ sourceId: entry.id, name: entry.name, error: err.message });
            }
        })());

        await Promise.all(searchPromises);

        // Limit total results
        let remaining = maxResults;
        const limitedResults = [];
        for (const group of results) {
            if (remaining <= 0) break;
            const items = group.items.slice(0, remaining);
            if (items.length) {
                limitedResults.push({ ...group, count: items.length, items });
                remaining -= items.length;
            }
        }

        const totalItems = limitedResults.reduce((sum, r) => sum + r.items.length, 0);

        res.json({
            keyword,
            totalResults: totalItems,
            sourceCount: limitedResults.length,
            errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
            results: limitedResults,
        });
    } catch (err) {
        console.error('[Search] Error:', err);
        res.status(500).json({ error: '搜索失败: ' + err.message });
    }
});

module.exports = router;
module.exports.cleanExtracted = cleanExtracted;
module.exports.isFailedExtraction = isFailedExtraction;
