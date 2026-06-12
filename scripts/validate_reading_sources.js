const fs = require('fs');
const path = require('path');

const config = require('../server/config');
const {
    buildUrl,
    createContext,
    fetchSourceUrl,
    resolveUrl,
    runRule,
    runRuleList,
} = require('../server/engine/legadoEngine');
const cheerio = require('../server/node_modules/cheerio');

const keyword = getArg('--keyword') || '剑来';
const limit = Number(getArg('--limit') || 20);
const only = getArg('--source');
const timeout = Number(getArg('--timeout') || config.requestTimeout || 15000);
const projectRoot = path.join(__dirname, '..');
const sourcesPath = path.resolve(projectRoot, 'sources');

function getArg(name) {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : '';
}

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(sourcesPath, 'index.json'), 'utf8'));
}

function loadSource(entry) {
    const arr = JSON.parse(fs.readFileSync(path.join(sourcesPath, entry.file), 'utf8'));
    return arr[entry.index];
}

function cleanText(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/[（(]本章未完[^）)]*[）)]/g, '')
        .replace(/[（(]本章完[）)]/g, '')
        .replace(/本章未完[，,、\s]*(请)?(点击)?(下一页|翻页|继续阅读).*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function hasIncompleteMarker(text) {
    return /本章未完|未完待续|下一页继续阅读|点击下一页|请翻页|继续阅读后面精彩内容/i.test(String(text || ''));
}

function normalizeNextUrl(value, baseUrl, currentUrl) {
    const text = String(value || '').trim();
    if (!text || /^(javascript:|#|void\b)/i.test(text)) return '';
    const url = buildUrl(text, { baseUrl }).url || resolveUrl(text, baseUrl);
    if (!/^https?:\/\//i.test(url)) return '';
    if (url === currentUrl) return '';
    return url;
}

function fallbackNextContentUrl(html, baseUrl, currentUrl) {
    const $ = cheerio.load(String(html || ''));
    const selectors = ['a[rel=next]', '#next_url', '.next a', '.pagebar a', '.prenext a', 'a:contains("下一页")', 'a:contains("下一章")', 'a:contains("下一")'];
    for (const selector of selectors) {
        for (const el of $(selector).toArray()) {
            const label = cleanText($(el).text());
            const href = $(el).attr('href') || '';
            if (!href) continue;
            if (selector.includes('contains') && !/下一页|下一章|下一/.test(label)) continue;
            const url = normalizeNextUrl(href, baseUrl, currentUrl);
            if (url) return url;
        }
    }
    return '';
}

function applyReplaceRegex(content, replaceRegex) {
    let text = String(content || '');
    if (!replaceRegex) return text;
    const parts = String(replaceRegex).split('##');
    for (let i = 0; i < parts.length; i += 2) {
        const pattern = parts[i] || '';
        const replacement = parts[i + 1] || '';
        if (!pattern) continue;
        try {
            text = text.replace(new RegExp(pattern, 'g'), replacement);
        } catch {
            text = text.split(pattern).join(replacement);
        }
    }
    return text;
}

async function fetchFullChapter(source, rule, startUrl) {
    const seen = new Set();
    const parts = [];
    let rawLength = 0;
    let nextUrl = startUrl;
    const maxPages = Number(getArg('--max-pages') || 10);

    for (let pageIndex = 0; nextUrl && pageIndex < maxPages; pageIndex++) {
        seen.add(nextUrl);
        const chapterContext = createContext(source, { baseUrl: nextUrl, timeout: config.jsRuntimeTimeout, chapter: { index: pageIndex } });
        const html = await fetchSourceUrl(nextUrl, chapterContext, { timeout });
        rawLength += String(html || '').length;
        if (!html) break;

        let part = runRule(html, rule.content, { ...chapterContext, result: html, baseUrl: nextUrl }) || '';
        parts.push(part);

        let rawNext = '';
        if (rule.nextContentUrl) {
            rawNext = runRule(html, rule.nextContentUrl, { ...chapterContext, result: html, baseUrl: nextUrl });
        }
        let candidate = Array.isArray(rawNext)
            ? rawNext.map(item => normalizeNextUrl(item, nextUrl, nextUrl)).find(Boolean) || ''
            : normalizeNextUrl(rawNext, nextUrl, nextUrl);
        if (!candidate && hasIncompleteMarker(part)) {
            candidate = fallbackNextContentUrl(html, nextUrl, nextUrl);
        }
        nextUrl = seen.has(candidate) ? '' : candidate;
    }

    const rawContent = parts.join('\n\n');
    return {
        content: cleanText(applyReplaceRegex(rawContent, rule.replaceRegex)),
        rawLength,
        pageCount: seen.size,
        incompleteMarker: hasIncompleteMarker(rawContent),
        truncatedByPageLimit: !!nextUrl,
    };
}

function bad(value) {
    const text = String(value || '').trim();
    return !text || text.includes('{{') || text.includes('}}') || /^<!doctype|^<html/i.test(text);
}

async function validate(entry) {
    const source = loadSource(entry);
    const base = {
        sourceId: entry.id,
        sourceName: entry.name,
        category: entry.category,
        ok: false,
        phase: 'init',
    };

    if (!source || !source.searchUrl || !source.ruleSearch || !source.ruleToc || !source.ruleContent) {
        return { ...base, phase: 'unsupported', error: 'missing reading rules' };
    }

    const context = createContext(source, { key: keyword, page: 1, timeout: config.jsRuntimeTimeout });
    const searchTarget = buildUrl(source.searchUrl, context);
    if (!/^https?:\/\//i.test(searchTarget.url)) return { ...base, phase: 'searchUrl', error: searchTarget.url || 'empty' };

    base.phase = 'searchFetch';
    const searchBody = await fetchSourceUrl(searchTarget.url, context, { headers: searchTarget.headers, timeout });
    if (!searchBody || searchBody.length < 10) return { ...base, error: 'empty search response' };

    base.phase = 'searchParse';
    const searchContext = { ...context, baseUrl: searchTarget.url, result: searchBody };
    const list = runRuleList(searchBody, source.ruleSearch.bookList, searchContext);
    if (!list.length) return { ...base, error: 'no search items' };

    let picked = null;
    for (const item of list.slice(0, 20)) {
        const itemContext = { ...searchContext, result: item };
        const name = cleanText(runRule(item, source.ruleSearch.name, itemContext));
        const author = cleanText(runRule(item, source.ruleSearch.author, itemContext));
        const bookUrlRaw = runRule(item, source.ruleSearch.bookUrl, itemContext);
        const bookUrl = buildUrl(String(bookUrlRaw || ''), { ...itemContext, baseUrl: searchTarget.url }).url;
        if (name && /^https?:\/\//i.test(bookUrl) && (name.includes(keyword) || keyword.includes(name) || author.includes(keyword))) {
            picked = { item, name, author, bookUrl };
            break;
        }
        if (!picked && name && /^https?:\/\//i.test(bookUrl)) picked = { item, name, author, bookUrl };
    }
    if (!picked) return { ...base, error: 'no usable search result', searchItems: list.length };

    base.phase = 'bookFetch';
    const bookContext = createContext(source, { baseUrl: picked.bookUrl, result: picked.item, timeout: config.jsRuntimeTimeout });
    const bookBody = await fetchSourceUrl(picked.bookUrl, bookContext, { timeout });
    if (!bookBody || bookBody.length < 10) return { ...base, error: 'empty book response', picked };

    base.phase = 'bookParse';
    const bookRule = source.ruleBookInfo || {};
    let bookData = bookRule.init ? runRule(bookBody, bookRule.init, { ...bookContext, result: bookBody }) : bookBody;
    if (bad(bookData)) bookData = bookBody;
    const tocTemplateContext = mergeObjects(picked.item, tryParse(bookData) || bookData);
    const tocRaw = bookRule.tocUrl && !isTemplateUrlRule(bookRule.tocUrl)
        ? runRule(bookData, bookRule.tocUrl, { ...bookContext, result: bookData, baseUrl: picked.bookUrl })
        : bookRule.tocUrl;
    const tocUrl = bookRule.tocUrl
        ? buildUrl(bad(tocRaw) ? bookRule.tocUrl : tocRaw, { ...bookContext, result: tocTemplateContext, baseUrl: picked.bookUrl }).url
        : picked.bookUrl;
    if (!/^https?:\/\//i.test(tocUrl)) return { ...base, error: 'bad toc url', picked, tocUrl };

    base.phase = 'tocFetch';
    const tocContext = createContext(source, { baseUrl: tocUrl, timeout: config.jsRuntimeTimeout });
    const tocBody = await fetchSourceUrl(tocUrl, tocContext, { timeout });
    if (!tocBody || tocBody.length < 10) return { ...base, error: 'empty toc response', picked, tocUrl };

    base.phase = 'tocParse';
    const tocRule = source.ruleToc || {};
    const chapterItems = runRuleList(tocBody, tocRule.chapterList, { ...tocContext, result: tocBody, baseUrl: tocUrl });
    if (!chapterItems.length) return { ...base, error: 'no chapters', picked, tocUrl };

    let firstChapter = null;
    for (const item of chapterItems.slice(0, 10)) {
        const itemContext = { ...tocContext, result: item, baseUrl: tocUrl };
        const name = cleanText(runRule(item, tocRule.chapterName, itemContext)) || cleanText(runRule(item, 'a@text', itemContext));
        const url = buildUrl(String(runRule(item, tocRule.chapterUrl, itemContext) || ''), { ...itemContext, baseUrl: tocUrl }).url;
        if (name && /^https?:\/\//i.test(url)) {
            firstChapter = { name, url };
            break;
        }
    }
    if (!firstChapter) return { ...base, error: 'no usable chapter url', picked, tocUrl, chapters: chapterItems.length };

    base.phase = 'chapterParse';
    const chapter = await fetchFullChapter(source, source.ruleContent, firstChapter.url);
    if (!chapter.rawLength) return { ...base, error: 'empty chapter response', picked, tocUrl, firstChapter };
    const qualityIssues = [];
    if (chapter.content.length < 500) qualityIssues.push('short_content');
    if (hasIncompleteMarker(chapter.content)) qualityIssues.push('incomplete_marker');
    if (chapter.truncatedByPageLimit) qualityIssues.push('page_limit');
    if (/服务临时维护|站点已暂停|认证失败|不能为空|404|not found/i.test(chapter.content.slice(0, 300))) qualityIssues.push('error_page');
    if (qualityIssues.length) {
        return {
            ...base,
            error: 'content quality issue',
            qualityIssues,
            picked,
            tocUrl,
            chapters: chapterItems.length,
            firstChapter,
            contentLength: chapter.content.length,
            pageCount: chapter.pageCount,
        };
    }

    return {
        ...base,
        ok: true,
        phase: 'ok',
        picked: { name: picked.name, author: picked.author, bookUrl: picked.bookUrl },
        tocUrl,
        chapters: chapterItems.length,
        firstChapter,
        contentLength: chapter.content.length,
        pageCount: chapter.pageCount,
    };
}

function tryParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function mergeObjects(...values) {
    const merged = {};
    for (const value of values) {
        const parsed = typeof value === 'string' ? tryParse(value) : value;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
        }
    }
    return Object.keys(merged).length ? merged : values.find(Boolean);
}

function isTemplateUrlRule(rule) {
    const text = String(rule || '').trim();
    return text.startsWith('@js:') || text.includes('{{') || /^https?:\/\//i.test(text) || text.startsWith('/');
}

(async () => {
    let entries = loadIndex().filter(e => e.category === 'novel');
    if (only) entries = entries.filter(e => e.id === only || e.name.includes(only));
    entries = entries.slice(0, limit);

    const results = [];
    for (const entry of entries) {
        try {
            const result = await validate(entry);
            results.push(result);
            console.log(JSON.stringify(result));
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

    const ok = results.filter(r => r.ok).length;
    const phaseCounts = {};
    const qualityCounts = {};
    for (const item of results) {
        phaseCounts[item.phase || 'unknown'] = (phaseCounts[item.phase || 'unknown'] || 0) + 1;
        for (const issue of item.qualityIssues || []) {
            qualityCounts[issue] = (qualityCounts[issue] || 0) + 1;
        }
    }
    const report = {
        keyword,
        checked: results.length,
        ok,
        failed: results.length - ok,
        phaseCounts,
        qualityCounts,
        contentQualityFailures: results.filter(r => r.qualityIssues && r.qualityIssues.length).map(r => ({
            sourceId: r.sourceId,
            sourceName: r.sourceName,
            issues: r.qualityIssues,
            contentLength: r.contentLength || 0,
            pageCount: r.pageCount || 0,
            firstChapter: r.firstChapter,
        })),
        results,
    };
    fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'docs', 'reading_source_validation.json'), JSON.stringify(report, null, 2), 'utf8');
    console.error(`checked=${report.checked} ok=${report.ok} failed=${report.failed}`);
})();
