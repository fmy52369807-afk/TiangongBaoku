const fs = require('fs');
const path = require('path');

const config = require('../server/config');
const {
    buildUrl,
    cleanSourceUrl,
    createContext,
    fetchSourceUrl,
    runRule,
    runRuleList,
} = require('../server/engine/legadoEngine');
const { createAdapter } = require('../server/engine/sourceAdapters');
const { fetchUrl } = require('../server/engine/httpClient');

const projectRoot = path.join(__dirname, '..');
const sourcesPath = path.join(projectRoot, 'sources');
const docsPath = path.join(projectRoot, 'docs');

const DEFAULT_KEYWORDS = {
    novel: '剑来',
    comic: '海贼王',
    audio: '三体',
    music: '周杰伦',
    video: '庆余年',
    game: '拳皇',
    special: '阅读',
};

const args = parseArgs(process.argv.slice(2));
const category = args.category || 'all';
const only = args.source || '';
const limit = Number(args.limit || 20);
const timeout = Number(args.timeout || config.requestTimeout || 15000);
const deep = args.deep === 'true' || args.deep === true;
const keywordOverride = args.keyword || '';

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = true;
        } else {
            parsed[key] = next;
            i++;
        }
    }
    return parsed;
}

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(sourcesPath, 'index.json'), 'utf8'));
}

function loadSource(entry) {
    const file = JSON.parse(fs.readFileSync(path.join(sourcesPath, entry.file), 'utf8'));
    return file[entry.index];
}

function cleanText(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function isBad(value, rule) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (rule && text === String(rule).trim()) return true;
    if (text.includes('{{') || text.includes('}}') || text.includes('{$')) return true;
    return false;
}

function tryJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function encodeRaw(value) {
    return Buffer.from(JSON.stringify(value || {})).toString('base64');
}

function extractUrls(value) {
    return String(value || '').match(/https?:\/\/[^\s"'<>\\]+/g) || [];
}

function resolveRuleUrl(ruleValue, source, baseUrl, context) {
    if (!ruleValue) return '';
    const value = runRule(context.result || '', ruleValue, { ...context, source, baseUrl });
    const candidate = Array.isArray(value) ? value.find(Boolean) : value;
    return buildUrl(String(candidate || ''), { ...context, source, baseUrl, result: context.result }).url;
}

function resolveNextUrls(value, context) {
    const list = Array.isArray(value) ? value : [value];
    return list
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => buildUrl(String(item || ''), context).url)
        .filter(Boolean);
}

function resolveNextTocUrls(ruleValue, body, context, currentUrl) {
    const rules = String(ruleValue || '').split('||').map(item => item.trim()).filter(Boolean);
    for (const rule of rules.length ? rules : [ruleValue]) {
        const nextValue = runRule(body, rule, context);
        const urls = resolveNextUrls(nextValue, context)
            .filter(url => url && url !== currentUrl && !sameUrl(url, currentUrl));
        if (urls.length) return urls;
    }
    return [];
}

function sameUrl(a, b) {
    try {
        const left = new URL(a);
        const right = new URL(b);
        left.hash = '';
        right.hash = '';
        return left.href === right.href;
    } catch {
        return String(a || '') === String(b || '');
    }
}

async function auditSource(entry) {
    const source = loadSource(entry);
    const adapter = createAdapter(entry, source);
    const keyword = keywordOverride || source?.ruleSearch?.checkKeyWord || DEFAULT_KEYWORDS[entry.category] || 'test';
    const base = {
        sourceId: entry.id,
        sourceName: entry.name,
        category: entry.category,
        status: entry.status,
        ok: false,
        phase: 'init',
        adapter: {
            tags: adapter.tags,
            warnings: adapter.warnings,
            capabilities: adapter.capabilities,
            webViewRequired: adapter.webViewRequired,
            loginRequired: adapter.loginRequired,
            browserRequired: adapter.browserRequired,
        },
    };

    if (!source) return { ...base, phase: 'load', error: 'missing source data' };
    if (!source.searchUrl || !source.ruleSearch || !source.ruleSearch.bookList) {
        return { ...base, phase: 'unsupported', error: 'missing search rules' };
    }
    if (adapter.loginRequired && !deep) {
        return { ...base, phase: 'special', error: 'login_required', skipped: true };
    }
    if (adapter.webViewRequired && !deep) {
        return { ...base, phase: 'special', error: 'webview_required', skipped: true };
    }

    const context = createContext(source, { key: keyword, page: 1, timeout: config.jsRuntimeTimeout });
    const searchTarget = buildUrl(source.searchUrl, context);
    if (!/^https?:\/\//i.test(searchTarget.url)) {
        return { ...base, phase: 'searchUrl', error: searchTarget.url || 'empty search url' };
    }

    base.phase = 'searchFetch';
    const searchBody = await fetchUrl(searchTarget.url, {
        headers: searchTarget.headers,
        method: searchTarget.method,
        body: searchTarget.body,
    }, timeout);
    if (!searchBody || String(searchBody).length < 10) {
        return { ...base, phase: 'searchFetch', error: 'empty search response' };
    }

    base.phase = 'searchParse';
    const rule = source.ruleSearch || {};
    const searchContext = { ...context, result: searchBody, baseUrl: searchTarget.url };
    const list = runRuleList(searchBody, rule.bookList, searchContext).filter(item => !(typeof item === 'string' && item === searchBody));
    if (!list.length) return { ...base, phase: 'searchParse', error: 'no search items' };

    let picked = null;
    for (const item of list.slice(0, 20)) {
        const itemContext = { ...searchContext, result: item };
        const rawUrl = runRule(item, rule.bookUrl, itemContext);
        const itemUrl = buildUrl(String(rawUrl || ''), { ...itemContext, baseUrl: searchTarget.url || cleanSourceUrl(source.bookSourceUrl) }).url;
        const candidate = adapter.normalizeItem({
            sourceId: entry.id,
            sourceName: entry.name,
            category: entry.category,
            name: cleanText(runRule(item, rule.name, itemContext)),
            author: cleanText(runRule(item, rule.author, itemContext)),
            itemUrl,
            coverUrl: runRule(item, rule.coverUrl, itemContext),
            intro: cleanText(runRule(item, rule.intro, itemContext)).slice(0, 240),
            kind: cleanText(runRule(item, rule.kind, itemContext)),
            raw: encodeRaw(item),
            rawItem: item,
        });
        const validation = adapter.validateSearchItem(candidate);
        if (validation.ok) {
            picked = candidate;
            break;
        }
    }
    if (!picked) {
        return { ...base, phase: 'searchParse', error: 'no usable search item', searchItems: list.length };
    }

    base.phase = 'detailFetch';
    const detailContext = createContext(source, {
        baseUrl: picked.itemUrl,
        result: picked.rawItem,
        timeout: config.jsRuntimeTimeout,
    });
    const detailBody = await fetchSourceUrl(picked.itemUrl, detailContext, { timeout });
    if (!detailBody || String(detailBody).length < 10) {
        return { ...base, phase: 'detailFetch', error: 'empty detail response', picked: summarizeItem(picked) };
    }

    base.phase = 'detailParse';
    const bookRule = source.ruleBookInfo || {};
    let detailData = bookRule.init ? runRule(detailBody, bookRule.init, { ...detailContext, result: detailBody, baseUrl: picked.itemUrl }) : detailBody;
    if (isBad(detailData, bookRule.init)) detailData = detailBody;
    const parsedDetail = typeof detailData === 'string' ? tryJson(detailData) : detailData;
    const templateContext = parsedDetail || picked.rawItem || detailData;
    const detailRuleContext = { ...detailContext, result: detailData, baseUrl: picked.itemUrl };
    let tocUrl = '';
    if (bookRule.tocUrl) {
        tocUrl = resolveRuleUrl(bookRule.tocUrl, source, picked.itemUrl, { ...detailRuleContext, result: templateContext });
    }
    if (!tocUrl && source.ruleToc && source.ruleToc.chapterList) tocUrl = picked.itemUrl;
    if (!tocUrl) return { ...base, phase: 'detailParse', error: 'missing entries url', picked: summarizeItem(picked) };

    base.phase = 'entriesFetch';
    const fetchedEntries = await fetchAllEntries(source, adapter, tocUrl, detailRuleContext.variables || {});
    if (!fetchedEntries.firstBody || String(fetchedEntries.firstBody).length < 10) {
        return { ...base, phase: 'entriesFetch', error: 'empty entries response', picked: summarizeItem(picked), tocUrl };
    }

    base.phase = 'entriesParse';
    let entries = fetchedEntries.entries;
    if (!entries.length) return { ...base, phase: 'entriesParse', error: 'no entries', picked: summarizeItem(picked), tocUrl };
    const entriesValidation = adapter.validateEntries(entries);
    if (!entriesValidation.ok) {
        return { ...base, phase: 'entriesParse', error: entriesValidation.reason, picked: summarizeItem(picked), entries: entries.length };
    }

    const firstEntry = entries.find(item => item.url && item.selectable !== false);
    if (!deep) {
        return {
            ...base,
            ok: true,
            phase: 'entriesOk',
            skippedPayload: true,
            picked: summarizeItem(picked),
            entries: entries.length,
            fetchedTocPages: fetchedEntries.pages,
            firstEntry: summarizeEntry(firstEntry),
        };
    }

    base.phase = 'payloadFetch';
    const contentRule = source.ruleContent || {};
    const payloadContext = createContext(source, {
        baseUrl: firstEntry.url,
        timeout: config.jsRuntimeTimeout,
        variables: entriesContext.variables || {},
        chapter: { index: firstEntry.index, title: firstEntry.name },
    });
    let payloadRaw = '';
    let payloadContent = '';
    if (contentRule.content) {
        payloadRaw = await fetchSourceUrl(firstEntry.url, payloadContext, { timeout });
        if (payloadRaw) {
            payloadContent = runRule(payloadRaw, contentRule.content, { ...payloadContext, result: payloadRaw, baseUrl: firstEntry.url }) || '';
        }
    }
    if (!payloadContent) payloadContent = firstEntry.url;
    const payload = adapter.normalizePayload({
        category: entry.category,
        type: categoryPayloadKind(entry.category),
        content: entry.category === 'novel' ? cleanText(payloadContent) : String(payloadContent || ''),
        text: cleanText(payloadContent),
        urls: extractUrls(payloadContent),
        mediaUrl: '',
        rawLength: String(payloadRaw || '').length,
    });
    const payloadValidation = adapter.validatePayload(payload);
    if (!payloadValidation.ok) {
        return {
            ...base,
            phase: 'payloadParse',
            error: payloadValidation.reason,
            picked: summarizeItem(picked),
            entries: entries.length,
            firstEntry: summarizeEntry(firstEntry),
            payloadSummary: summarizePayload(payload),
        };
    }

    return {
        ...base,
        ok: true,
        phase: 'ok',
        picked: summarizeItem(picked),
        entries: entries.length,
        fetchedTocPages: fetchedEntries.pages,
        firstEntry: summarizeEntry(firstEntry),
        payloadSummary: summarizePayload(payload),
    };
}

async function fetchAllEntries(source, adapter, tocUrl, variables = {}) {
    const tocRule = source.ruleToc || {};
    const visited = new Set();
    const queue = [tocUrl];
    const all = [];
    let firstBody = '';
    while (queue.length && visited.size < (adapter.maxEntryPages || 20)) {
        const currentUrl = queue.shift();
        if (!currentUrl || visited.has(currentUrl)) continue;
        visited.add(currentUrl);
        const entriesContext = createContext(source, {
            baseUrl: currentUrl,
            timeout: config.jsRuntimeTimeout,
            variables,
        });
        const body = await fetchSourceUrl(currentUrl, entriesContext, { timeout });
        if (!firstBody) firstBody = body || '';
        if (!body) continue;
        const ruleContext = { ...entriesContext, result: body, baseUrl: currentUrl };
        const entryItems = runRuleList(body, tocRule.chapterList, ruleContext);
        let pageEntries = entryItems.map((item, index) => {
            const itemContext = { ...ruleContext, result: item, baseUrl: currentUrl, chapter: { index: all.length + index } };
            const name = runRule(item, tocRule.chapterName, itemContext);
            const url = runRule(item, tocRule.chapterUrl, itemContext);
            const isVolume = tocRule.isVolume ? runRule(item, tocRule.isVolume, itemContext) : '';
            return {
                index: all.length + index,
                name: cleanText(isBad(name, tocRule.chapterName) ? `item ${all.length + index + 1}` : name),
                url: isBad(url, tocRule.chapterUrl) ? '' : buildUrl(String(url), { ...itemContext, baseUrl: currentUrl }).url,
                isVolume: !!isVolume && !/^false|0$/i.test(String(isVolume)),
            };
        });
        pageEntries = adapter.normalizeEntries(pageEntries);
        all.push(...pageEntries);
        if (tocRule.nextTocUrl) {
            const nextUrls = resolveNextTocUrls(tocRule.nextTocUrl, body, ruleContext, currentUrl);
            for (const next of nextUrls) {
                if (!visited.has(next)) queue.push(next);
            }
        }
    }
    const seen = new Set();
    const entries = all.filter(entry => {
        const key = entry.url || `${entry.name}:${entry.index}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map((entry, index) => ({ ...entry, index }));
    return { entries, pages: visited.size, firstBody };
}

function categoryPayloadKind(category) {
    return {
        novel: 'text',
        comic: 'images',
        audio: 'audio',
        music: 'audio',
        video: 'video',
        game: 'link',
        special: 'link',
    }[category] || 'text';
}

function summarizeItem(item) {
    return {
        name: item.name,
        author: item.author,
        itemUrl: item.itemUrl,
        kind: item.kind,
    };
}

function summarizeEntry(entry) {
    if (!entry) return null;
    return {
        index: entry.index,
        name: entry.name,
        url: entry.url,
        line: entry.line,
    };
}

function summarizePayload(payload) {
    return {
        type: payload.type,
        textLength: String(payload.text || payload.content || '').length,
        urlCount: (payload.urls || []).length,
        mediaUrl: payload.mediaUrl || '',
        rawLength: payload.rawLength || 0,
    };
}

async function main() {
    let entries = loadIndex();
    if (category !== 'all') entries = entries.filter(entry => entry.category === category);
    if (only) entries = entries.filter(entry => entry.id === only || String(entry.name || '').includes(only));
    entries = entries.slice(0, limit);

    const results = [];
    for (const entry of entries) {
        try {
            const result = await auditSource(entry);
            results.push(result);
            console.log(JSON.stringify({
                id: result.sourceId,
                category: result.category,
                ok: result.ok,
                phase: result.phase,
                error: result.error || '',
                skipped: !!result.skipped,
            }));
        } catch (err) {
            const result = {
                sourceId: entry.id,
                sourceName: entry.name,
                category: entry.category,
                ok: false,
                phase: 'exception',
                error: err.message,
            };
            results.push(result);
            console.log(JSON.stringify(result));
        }
    }

    const phaseCounts = {};
    const categoryCounts = {};
    const adapterTags = {};
    for (const result of results) {
        phaseCounts[result.phase || 'unknown'] = (phaseCounts[result.phase || 'unknown'] || 0) + 1;
        categoryCounts[result.category] = categoryCounts[result.category] || { checked: 0, ok: 0, failed: 0, skipped: 0 };
        categoryCounts[result.category].checked++;
        if (result.ok) categoryCounts[result.category].ok++;
        else categoryCounts[result.category].failed++;
        if (result.skipped) categoryCounts[result.category].skipped++;
        for (const tag of result.adapter?.tags || []) {
            adapterTags[tag] = (adapterTags[tag] || 0) + 1;
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        args: { category, only, limit, timeout, deep, keyword: keywordOverride || null },
        checked: results.length,
        ok: results.filter(item => item.ok).length,
        failed: results.filter(item => !item.ok && !item.skipped).length,
        skipped: results.filter(item => item.skipped).length,
        phaseCounts,
        categoryCounts,
        adapterTags,
        failures: results.filter(item => !item.ok).map(item => ({
            sourceId: item.sourceId,
            sourceName: item.sourceName,
            category: item.category,
            phase: item.phase,
            error: item.error,
            adapter: item.adapter,
            picked: item.picked,
            firstEntry: item.firstEntry,
            payloadSummary: item.payloadSummary,
        })),
        results,
    };

    fs.mkdirSync(docsPath, { recursive: true });
    fs.writeFileSync(path.join(docsPath, 'source_runtime_audit.json'), JSON.stringify(report, null, 2), 'utf8');
    console.error(`checked=${report.checked} ok=${report.ok} failed=${report.failed} skipped=${report.skipped}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
