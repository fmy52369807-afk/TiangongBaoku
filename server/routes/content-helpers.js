/**
 * Helper functions for content routes — source loading, entry parsing,
 * TOC resolution, payload fetching, and detail assembly.
 */

const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
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
const { fetchUrl } = require('../engine/httpClient');
const { createAdapter } = require('../engine/sourceAdapters');

const {
    cleanText,
    isBadValue,
    isNavigationText,
    isBadDetailField,
    decodeRawContext,
    encodeSession,
    decodeSession,
    tryJson,
    stringifyForRaw,
    valueFromContext,
    syncVariables,
    extractMeta,
    extractTitle,
    applyReplaceRegex,
    classifyEmptySearch,
    isAudioLikeCategory,
    unique,
    parseSourceHeader,
    parseEmbeddedHeaders,
} = require('./utils');

const {
    categoryProfile,
    outputMode,
} = require('./profiles');

const {
    safeHeaderUrl,
    normalizeUrlMaybe,
    normalizeCoverForSource,
    extractLiulianVideoUrl,
    isLiulianVideoSource,
    resolveRuleUrl,
    resolveNextUrls,
    sameUrl,
    extractUrls,
    valueFromSearchContext,
} = require('./url-utils');

const {
    filterComicImageUrls,
    isAntbywComicSource,
    fallbackAntbywEntries,
    fetchAntbywPagedImages,
    fallbackComicImageUrls,
    fallbackStructuredComicImageUrls,
    fallbackYydsmhImageUrls,
    shouldSkipGenericComicFallback,
} = require('./comic-fallback');

const {
    isMissevanSource,
    isHhlMaoerSource,
    isFiveSingSource,
    isLizhiSource,
    isFuciyuanSource,
    repairAudioTocUrl,
    fallbackAudioEntries,
    fallbackMusicEntries,
    fallbackAudioSearchList,
    fallbackAudioPayloadUrl,
    fallbackAudioItemUrl,
} = require('./audio-fallback');

const {
    isCmsVideoSource,
    fetchCmsVideoEntries,
    parseCmsVideoEntries,
    prioritizeReachableVideoEntries,
    fallbackVideoEntries,
} = require('./video-fallback');

// --- Source loading (with TTL cache) ---

const _cache = { index: null, sources: new Map(), indexMtimeMs: 0 };

function loadIndex() {
    const indexPath = path.join(config.sourcesPath, 'index.json');
    if (!fs.existsSync(indexPath)) {
        throw new Error('sources/index.json not found. Run node scripts/build.js');
    }
    const mtimeMs = fs.statSync(indexPath).mtimeMs;
    if (_cache.index && _cache.indexMtimeMs === mtimeMs) return _cache.index;
    _cache.index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    _cache.indexMtimeMs = mtimeMs;
    _cache.sources.clear();
    return _cache.index;
}

function loadSource(sourceId) {
    const entry = loadIndex().find(item => item.id === sourceId);
    if (!entry) {
        _cache.sources.set(sourceId, null);
        return null;
    }
    const sourcePath = path.join(config.sourcesPath, entry.file);
    const mtimeMs = fs.existsSync(sourcePath) ? fs.statSync(sourcePath).mtimeMs : 0;
    const cached = _cache.sources.get(sourceId);
    if (cached && cached.fileMtimeMs === mtimeMs) return cached.value;
    const fileData = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
    const source = fileData[entry.index];
    const result = source ? { entry, source } : null;
    _cache.sources.set(sourceId, { fileMtimeMs: mtimeMs, value: result });
    return result;
}

function invalidateSourceCache() {
    _cache.index = null;
    _cache.sources.clear();
    _cache.indexMtimeMs = 0;
}

// --- TOC / entry helpers ---

function resolveNextTocUrls(ruleValue, html, context, currentUrl) {
    const rules = String(ruleValue || '').split('||').map(item => item.trim()).filter(Boolean);
    for (const rule of rules.length ? rules : [ruleValue]) {
        let nextValue = runRuleList(html, rule, context);
        if (!nextValue.length) nextValue = runRule(html, rule, context);
        const urls = resolveNextUrls(nextValue, context)
            .filter(url => url && url !== currentUrl && !sameUrl(url, currentUrl));
        if (urls.length) return urls;
    }
    return [];
}

function fallbackEntries(html, baseUrl) {
    const $ = cheerio.load(String(html || ''));
    const seen = new Set();
    const entries = [];
    const candidates = $('.chapter a[href], .chapters a[href], .chapter-list a[href], .comic-chapter a[href], .detail-list a[href], .detail-list-select a[href], #chapterlist a[href], #list a[href], .list a[href], dl dd a[href], a[href]').toArray();
    candidates.forEach((el) => {
        const href = $(el).attr('href') || '';
        const name = cleanText($(el).text());
        const url = resolveUrl(href, baseUrl);
        if (!isUsableEntryLink(href, name, url, baseUrl) || seen.has(url)) return;
        seen.add(url);
        entries.push({ index: entries.length, name, url, isVip: false, isVolume: false, updateTime: '' });
    });
    return entries;
}

function fallbackMangaSearcherEntries(body, baseUrl) {
    if (!/api-get-v[23]\.mgsearcher\.com\/api\/manga\/get/i.test(String(baseUrl || ''))) return [];
    const parsed = tryJson(body);
    const manga = parsed && parsed.data;
    const chapters = Array.isArray(manga && manga.chapters) ? manga.chapters : [];
    if (!manga || !manga.id || !chapters.length) return [];
    const apiVersion = /api-get-v3\.mgsearcher\.com/i.test(String(baseUrl || '')) ? 'v3' : 'v2';
    return chapters.map((chapter, index) => ({
        index,
        name: cleanText(chapter.attributes?.title || chapter.title || `第 ${index + 1} 话`),
        url: `https://api-get-${apiVersion}.mgsearcher.com/api/chapter/getinfo?m=${manga.id}&c=${chapter.id}`,
        updateTime: cleanText(chapter.attributes?.updatedAt || chapter.updatedAt || ''),
        isVip: false,
        isVolume: false,
    })).filter(item => item.url);
}

function isUsableEntryLink(href, name, url, baseUrl) {
    if (!href || !name || !url || url === baseUrl || name.length > 120) return false;
    if (/^(19|20)\d{2}$/.test(cleanText(name))) return false;
    if (/^(javascript:|#|void\b)/i.test(String(href).trim())) return false;
    if (isNavigationText(name)) return false;
    if (/第.{0,20}(章|节|集|话|回|卷)|chapter|episode|话|回|卷|^\d{1,4}([.、\s-]|$)/i.test(name)) return true;
    return /\.(html?|shtml)(\?|$)/i.test(url) && !/class|bookcase|login|search|index/i.test(url);
}

function findTocLink(html, baseUrl) {
    const $ = cheerio.load(String(html || ''));
    const labels = /(查看更多章节|更多章节|全部章节|章节目录|目录)/;
    const exact = $('a[href]').toArray().find(el => labels.test(cleanText($(el).text())));
    if (exact) return resolveUrl($(exact).attr('href') || '', baseUrl);

    const option = $('select option[value], option[value]').toArray()
        .map(el => $(el).attr('value') || '')
        .find(value => value && !sameUrl(resolveUrl(value, baseUrl), baseUrl));
    return option ? resolveUrl(option, baseUrl) : '';
}

function repairTocUrl(tocUrl, itemUrl) {
    const text = String(tocUrl || '');
    if (!text) return '';
    if (isInvalidTocUrl(text)) return '';
    if (looksLikeHtmlUrl(text)) return '';
    const id = (String(itemUrl || '').match(/\/novel\/([^/?#]+)/i) || [])[1];
    if (id && /\/novel\/\/chapters/i.test(text)) {
        return text.replace(/\/novel\/\/chapters/i, '/novel/' + id + '/chapters');
    }
    return text;
}

function isInvalidTocUrl(value) {
    const text = String(value || '').trim();
    return !text || /^(javascript:|#|void\b)/i.test(text);
}

function looksLikeHtmlUrl(value) {
    const text = String(value || '');
    return /%3C|<\s*(div|a|img|html|body|script)|&lt;\s*(div|a|img|html|body|script)/i.test(text);
}

function findComicApiTocUrl(html, itemUrl) {
    if (!/manhuafree\.com|g-mh\.org|baozimh\.org|bzmh\.org/i.test(String(itemUrl || ''))) return '';
    const mid = (String(html || '').match(/data-mid\s*=\s*["']?(\d+)/i) || [])[1];
    const apiVersion = /g-mh\.org/i.test(String(itemUrl || '')) ? 'v3' : 'v2';
    return mid ? `https://api-get-${apiVersion}.mgsearcher.com/api/manga/get?mid=${mid}&mode=all` : '';
}

// --- Fetch with retry ---

async function fetchSourceUrlWithRetry(url, context, options = {}, attempts = 2) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fetchSourceUrl(url, context, options);
        } catch (err) {
            lastError = err;
            if (!/timeout|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err.message || '')) break;
        }
    }
    throw lastError;
}

// --- Entries page fetcher ---

async function fetchEntriesPage(source, adapter, tocUrl, sessionData, startIndex = 0) {
    const context = createContext(source, {
        baseUrl: tocUrl,
        timeout: config.jsRuntimeTimeout,
        variables: sessionData.variables || {},
    });
    const html = await fetchSourceUrlWithRetry(tocUrl, context, { timeout: config.requestTimeout }, 2);
    if (!html) return { html: '', entries: [], nextTocUrls: [], variables: context.variables || {} };

    const rule = source.ruleToc || {};
    const ruleContext = { ...context, result: html, baseUrl: tocUrl };
    const items = runRuleList(html, rule.chapterList, ruleContext) || [];
    let entries = items.map((item, offset) => {
        const index = startIndex + offset;
        const itemContext = { ...ruleContext, result: item, chapter: { index } };
        const name = runRule(item, rule.chapterName, itemContext);
        const url = runRule(item, rule.chapterUrl, itemContext);
        const updateTime = runRule(item, rule.updateTime, itemContext);
        const isVip = rule.isVip ? runRule(item, rule.isVip, itemContext) : '';
        const isVolume = rule.isVolume ? runRule(item, rule.isVolume, itemContext) : '';
        return {
            index,
            name: cleanText(isBadValue(name, rule.chapterName) ? `第 ${index + 1} 项` : name),
            url: normalizeComicEntryUrl(
                isBadValue(url, rule.chapterUrl) ? '' : buildUrl(String(url), { ...itemContext, baseUrl: tocUrl }).url,
                tocUrl
            ),
            updateTime: cleanText(isBadValue(updateTime, rule.updateTime) ? '' : updateTime),
            isVip: !!isVip && !/^false|0$/i.test(String(isVip)),
            isVolume: !!isVolume && !/^false|0$/i.test(String(isVolume)),
        };
    });
    const validEntries = entries.filter(item => {
        if (item.isVolume && !item.url) return true;
        if ((isMissevanSource(source) || isHhlMaoerSource(source)) && item.url) return true;
        return isUsableEntryLink(item.url, item.name, item.url, tocUrl);
    });
    if (validEntries.length) entries = validEntries;
    if (adapter.category === 'music') {
        const musicEntries = fallbackMusicEntries(source, html, tocUrl, sessionData.rawContext, startIndex);
        if (musicEntries.length && (!entries.some(item => item.url) || isFiveSingSource(source) || isLizhiSource(source) || isFuciyuanSource(source))) {
            entries = musicEntries;
        }
    }
    if ((adapter.category === 'video' || Number(source.bookSourceType) === 4) && /api\.php\/provide\/vod|\/provide\/vod/i.test(String(source?.bookSourceUrl || tocUrl || ''))) {
        const cmsEntries = parseCmsVideoEntries(html, startIndex);
        if (cmsEntries.length) entries = await prioritizeReachableVideoEntries(cmsEntries);
    }
    if ((adapter.category === 'video' || Number(source.bookSourceType) === 4) && (!entries.some(item => item.url) || /api\.php\/provide\/vod|\/provide\/vod|ikanbot\.com/i.test(String(source?.bookSourceUrl || tocUrl || '')))) {
        const videoEntries = await fallbackVideoEntries(source, html, tocUrl, entries, startIndex);
        if (videoEntries.length) entries = videoEntries;
    }
    if (!entries.some(item => item.url)) entries = fallbackMangaSearcherEntries(html, tocUrl);
    if (isAntbywComicSource(source) || isAntbywComicSource(tocUrl)) {
        const antbywEntries = fallbackAntbywEntries(html, tocUrl, startIndex);
        if (antbywEntries.length && (!entries.some(item => /a=read/i.test(item.url || '')) || antbywEntries.length > entries.filter(item => item.url && !item.isVolume).length)) {
            entries = antbywEntries;
        }
    }
    if (!entries.some(item => item.url)) entries = fallbackEntries(html, tocUrl);
    if (!entries.some(item => item.url)) entries = fallbackAudioEntries(source, html, tocUrl, startIndex);
    entries = entries.map(item => ({ ...item, url: normalizeComicEntryUrl(item.url, tocUrl) }));
    entries = adapter.normalizeEntries(entries);

    let nextTocUrls = [];
    if (rule.nextTocUrl) {
        nextTocUrls = resolveNextTocUrls(rule.nextTocUrl, html, ruleContext, tocUrl);
    }
    return { html, entries, nextTocUrls, variables: syncVariables(ruleContext) };
}

function normalizeComicEntryUrl(url, baseUrl) {
    const text = String(url || '');
    if (!/\/user\/page_direct\?/i.test(text)) return text;
    try {
        const parsed = new URL(text, baseUrl);
        const comicId = parsed.searchParams.get('comic_id');
        const sectionSlot = parsed.searchParams.get('section_slot') || '0';
        const chapterSlot = parsed.searchParams.get('chapter_slot');
        if (comicId && chapterSlot && /bzmanga\.com|baozimh\.com|bzmh\.org/i.test(parsed.hostname + ' ' + baseUrl)) {
            return `https://cn.dzmanga.com/comic/chapter/${comicId}/${sectionSlot}_${chapterSlot}.html`;
        }
    } catch {}
    return text;
}

function mergeEntries(pages) {
    const seen = new Set();
    const merged = [];
    for (const entry of pages.flat()) {
        const key = entry.url || `${entry.name}:${entry.index}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...entry, index: merged.length });
    }
    return merged;
}

function decodeLegadoDataUrl(url) {
    const match = String(url || '').match(/^data:([^;,]+)?;base64,([^,]+)(?:,([\s\S]+))?$/i);
    if (!match) return null;
    let meta = {};
    if (match[3]) {
        try {
            meta = JSON.parse(match[3]);
        } catch {
            meta = {};
        }
    }
    return {
        kind: match[1] || '',
        value: Buffer.from(match[2], 'base64').toString('utf-8'),
        meta,
    };
}

function isFanqieDataUrl(url, kind) {
    const decoded = decodeLegadoDataUrl(url);
    if (!decoded) return null;
    if (kind && decoded.kind !== kind) return null;
    if (decoded.meta && decoded.meta.type && decoded.meta.type !== 'fqnovel') return null;
    return decoded.value ? decoded : null;
}

function makeFanqieDataUrl(kind, value) {
    return `data:${kind};base64,${Buffer.from(String(value || '')).toString('base64')},{"type":"fqnovel"}`;
}

function fanqieChapterLists(data) {
    const root = tryJson(data) || data || {};
    const payload = root.data || root;
    if (Array.isArray(payload.item_data_list)) return [payload.item_data_list];
    if (Array.isArray(payload.chapterListWithVolume)) return payload.chapterListWithVolume;
    if (Array.isArray(payload.chapter_list)) return [payload.chapter_list];
    if (Array.isArray(payload.chapterList)) return [payload.chapterList];
    return [];
}

async function fetchFanqieDirectoryEntries(bookId, startIndex = 0) {
    const raw = await fetchUrl(`https://fanqienovel.com/api/reader/directory/detail?bookId=${encodeURIComponent(bookId)}`, {
        headers: {
            Referer: 'https://fanqienovel.com/',
        },
    }, config.requestTimeout);
    const lists = fanqieChapterLists(raw);
    const entries = [];
    lists.forEach((list) => {
        (Array.isArray(list) ? list : []).forEach((chapter) => {
            const itemId = chapter.itemId || chapter.item_id || chapter.id;
            const name = chapter.title || chapter.ChapterName || chapter.name || '';
            if (!itemId || !name) return;
            entries.push({
                index: startIndex + entries.length,
                name: cleanText(name),
                url: makeFanqieDataUrl('item_id', itemId),
                updateTime: cleanText(chapter.firstPassTime || chapter.first_pass_time || chapter.updateTime || ''),
                isVip: Boolean(chapter.needPay || chapter.isChapterLock || chapter.is_vip),
                isVolume: false,
            });
        });
    });
    return entries;
}

function extractFanqieContent(raw) {
    const parsed = tryJson(raw);
    const data = parsed && (parsed.data && (parsed.data.data || parsed.data) || parsed);
    return cleanText(data && (data.content || data.content_text || data.text) || '');
}

async function fetchFanqieContentByItemId(itemId) {
    const urls = [
        `https://fq-book.netsite.cc/content?item_id=${encodeURIComponent(itemId)}`,
        `https://fqgo.52dns.cc/content?item_id=${encodeURIComponent(itemId)}`,
        `https://fqxs.ns114.cc/content?item_id=${encodeURIComponent(itemId)}`,
        `https://api.52dns.cc/content?item_id=${encodeURIComponent(itemId)}`,
    ];
    let lastRaw = '';
    for (const url of urls) {
        try {
            const raw = await fetchUrl(url, {}, config.requestTimeout);
            lastRaw = raw || lastRaw;
            const content = extractFanqieContent(raw);
            if (content) {
                return { raw, content };
            }
        } catch {}
    }
    return { raw: lastRaw, content: '' };
}

// --- Payload content ---

async function fetchPayloadContent(source, rule, startUrl, context, maxPages = 8) {
    const fanqieItem = isFanqieDataUrl(startUrl, 'item_id');
    if (fanqieItem) {
        const fetched = await fetchFanqieContentByItemId(fanqieItem.value);
        return {
            raw: fetched.raw,
            content: fetched.content,
            fetchedContentPages: fetched.raw ? 1 : 0,
            nextContentUrls: [],
        };
    }

    const visited = new Set();
    let currentUrl = startUrl;
    let rawCombined = '';
    const parts = [];
    const urls = [];
    for (let page = 0; currentUrl && !visited.has(currentUrl) && page < maxPages; page++) {
        visited.add(currentUrl);
        const pageContext = { ...context, baseUrl: currentUrl };
        const raw = await fetchSourceUrl(currentUrl, pageContext, { timeout: config.requestTimeout });
        if (!raw) break;
        rawCombined += raw;
        let content = rule.content ? runRule(raw, rule.content, { ...pageContext, result: raw, baseUrl: currentUrl }) || '' : '';
        if (content) parts.push(content);
        let nextUrl = '';
        if (rule.nextContentUrl) {
            const nextValue = runRule(raw, rule.nextContentUrl, { ...pageContext, result: raw, baseUrl: currentUrl });
            nextUrl = resolveNextUrls(nextValue, { ...pageContext, result: raw, baseUrl: currentUrl })[0] || '';
        }
        if (!nextUrl || nextUrl === currentUrl || visited.has(nextUrl)) break;
        urls.push(nextUrl);
        currentUrl = nextUrl;
    }
    return {
        raw: rawCombined,
        content: parts.join('\n'),
        fetchedContentPages: visited.size,
        nextContentUrls: urls,
    };
}

// --- Search ---

const fiveSingCoverCache = new Map();

function cleanSearchField(value, rule) {
    const text = cleanText(value);
    return isBadValue(text, rule) ? '' : text;
}

function isPlaceholderCover(url) {
    return /(?:^|\/\/)1t\.click\/HNK\b/i.test(String(url || ''));
}

async function fetchFiveSingSearchCover(source, itemUrl) {
    const url = String(itemUrl || '');
    if (!isFiveSingSource(source) || !/^https?:\/\/5sing\.kugou\.com\//i.test(url)) return '';
    if (fiveSingCoverCache.has(url)) return fiveSingCoverCache.get(url);
    let cover = '';
    try {
        const html = await fetchUrl(url, {
            headers: {
                ...parseSourceHeader(source.header),
                Referer: cleanSourceUrl(source.bookSourceUrl) || 'http://5sing.kugou.com/',
            },
        }, config.requestTimeout);
        const $ = cheerio.load(String(html || ''));
        cover = normalizeCoverForSource(
            source,
            $('.user_tx img').attr('src') || $('meta[property="og:image"]').attr('content') || '',
            url
        );
    } catch {
        cover = '';
    }
    fiveSingCoverCache.set(url, cover);
    return cover;
}

async function searchSource(entry, keyword, searchTimeout) {
    const loaded = loadSource(entry.id);
    if (!loaded || !loaded.source.searchUrl) return { status: 'skipped', error: 'missing_search_url', count: 0 };
    const { source } = loaded;
    const adapter = createAdapter(entry, source);
    const context = createContext(source, { key: keyword, page: 1, timeout: config.jsRuntimeTimeout });
    const searchTarget = buildUrl(source.searchUrl, context);
    if (!/^https?:\/\//i.test(searchTarget.url) || searchTarget.url.includes('{{')) {
        return { status: 'skipped', error: 'invalid_search_url', count: 0 };
    }
    const raw = await fetchUrl(searchTarget.url, {
        headers: {
            ...parseSourceHeader(source.header),
            ...searchTarget.headers,
        },
        method: searchTarget.method,
        body: searchTarget.body,
    }, searchTimeout);
    if (!raw) return { status: 'failed', error: 'empty_response', count: 0 };
    const rule = source.ruleSearch || {};
    const ruleContext = { ...context, result: raw, baseUrl: searchTarget.url };
    let list = runRuleList(raw, rule.bookList, ruleContext).filter(item => !(typeof item === 'string' && item === raw));
    if (!list.length && isAudioLikeCategory(entry.category)) {
        list = await fallbackAudioSearchList(source, raw, keyword, context.page || 1);
    }
    if (!list.length) {
        const emptyError = classifyEmptySearch(raw);
        return { status: 'failed', error: emptyError, count: 0, listError: '规则未匹配' };
    }
    let items = await Promise.all(list.slice(0, 30).map(async (item, offset) => {
        const itemContext = { ...ruleContext, result: item };
        const rawUrl = runRule(item, rule.bookUrl, itemContext);
        let itemUrl = buildUrl(String(rawUrl || ''), {
            ...itemContext,
            baseUrl: searchTarget.url || cleanSourceUrl(source.bookSourceUrl),
        }).url;
        if (isAudioLikeCategory(entry.category) && (isBadValue(itemUrl, rule.bookUrl) || (entry.category === 'music' && isFuciyuanSource(source)))) {
            itemUrl = fallbackAudioItemUrl(source, item, searchTarget.url || cleanSourceUrl(source.bookSourceUrl));
        }
        let coverUrl = normalizeCoverForSource(source, runRule(item, rule.coverUrl, itemContext), searchTarget.url);
        if (isPlaceholderCover(coverUrl)) coverUrl = '';
        if (!coverUrl && isFiveSingSource(source) && offset < 10) {
            coverUrl = await fetchFiveSingSearchCover(source, itemUrl);
        }
        return adapter.normalizeItem({
            sourceId: entry.id,
            sourceName: entry.name,
            category: entry.category,
            type: categoryProfile(entry.category).payloadKind,
            name: cleanSearchField(runRule(item, rule.name, itemContext), rule.name),
            author: cleanSearchField(runRule(item, rule.author, itemContext), rule.author),
            itemUrl,
            coverUrl,
            intro: cleanSearchField(runRule(item, rule.intro, itemContext), rule.intro).slice(0, 240),
            kind: cleanSearchField(runRule(item, rule.kind, itemContext), rule.kind),
            lastChapter: cleanSearchField(runRule(item, rule.lastChapter, itemContext), rule.lastChapter),
            raw: Buffer.from(stringifyForRaw(item)).toString('base64'),
            adapterTags: adapter.tags,
            warnings: adapter.warnings,
        });
    }));
    items = items.filter(item => adapter.validateSearchItem(item).ok);
    return { status: 'ok', items, adapter };
}

// --- Entries fetching ---

async function fetchAllEntries(source, adapter, decodedUrl, sessionData, options = {}) {
    const maxPages = Math.min(Math.max(options.maxPages || 20, 1), 160);
    const budgetMs = Math.min(Math.max(options.budgetMs || 45000, 8000), 90000);
    const fanqieBook = isFanqieDataUrl(decodedUrl, 'book_id');
    if (fanqieBook) {
        const entries = adapter.normalizeEntries(await fetchFanqieDirectoryEntries(fanqieBook.value, 0));
        return {
            entries,
            fetchedTocPages: entries.length ? 1 : 0,
            failedPages: [],
            nextTocUrl: '',
            nextTocUrls: [],
            variables: sessionData.variables || {},
        };
    }

    const visited = new Set();
    const queue = [decodedUrl];
    const pages = [];
    const failedPages = [];
    const queued = new Set(queue);
    const startedAt = Date.now();
    let variables = sessionData.variables || {};
    let nextTocUrls = [];
    while (queue.length && visited.size < maxPages) {
        if (Date.now() - startedAt > budgetMs && pages.length) break;
        const currentUrl = queue.shift();
        queued.delete(currentUrl);
        if (!currentUrl || visited.has(currentUrl)) continue;
        visited.add(currentUrl);
        let page;
        try {
            page = await fetchEntriesPage(source, adapter, currentUrl, { ...sessionData, variables }, pages.flat().length);
        } catch (err) {
            failedPages.push({ url: currentUrl, error: err.message });
            if (currentUrl === decodedUrl && !pages.length) throw err;
            continue;
        }
        if (!page.html && currentUrl === decodedUrl && !pages.length) return null;
        pages.push(page.entries);
        variables = { ...variables, ...(page.variables || {}) };
        nextTocUrls = page.nextTocUrls || [];
        for (const url of nextTocUrls) {
            if (!visited.has(url) && !queued.has(url) && queue.length + visited.size < maxPages) {
                queue.push(url);
                queued.add(url);
            }
        }
    }
    let entries = mergeEntries(pages);
    if (adapter.category === 'video' && !entries.some(item => item.url)) {
        let fallbackRaw = '';
        try {
            fallbackRaw = await fetchUrl(decodedUrl, {
                headers: parseSourceHeader(source.header),
            }, config.requestTimeout);
        } catch {
            fallbackRaw = '';
        }
        const fixed = await fallbackVideoEntries(source, fallbackRaw, decodedUrl, entries, 0);
        if (fixed.length) entries = fixed;
    }
    const remainingTocUrls = queue.filter(url => url && !visited.has(url));
    return {
        entries,
        fetchedTocPages: visited.size,
        failedPages,
        nextTocUrl: remainingTocUrls[0] || nextTocUrls.find(url => !visited.has(url)) || '',
        nextTocUrls: remainingTocUrls.length ? remainingTocUrls : nextTocUrls.filter(url => !visited.has(url)),
        variables,
    };
}

// --- Payload content resolution ---

async function resolvePayloadContent(entry, source, adapter, decodedUrl, rule, sessionData, context, raw, content) {
    if (entry.category === 'video' && isLiulianVideoSource(source)) {
        const liulianUrl = extractLiulianVideoUrl(raw);
        if (liulianUrl) content = liulianUrl;
    }
    if (isAudioLikeCategory(entry.category) && !extractUrls(content, decodedUrl).length) {
        const fallbackAudio = await fallbackAudioPayloadUrl(source, raw, decodedUrl);
        if (fallbackAudio) content = fallbackAudio;
    }
    if (content && rule.replaceRegex && outputMode(entry.category, rule) === 'text') {
        content = applyReplaceRegex(content, rule.replaceRegex);
    }
    if (!content && entry.category === 'comic' && /\.(jpg|jpeg|png|webp|gif|avif)(?:[?#].*)?$/i.test(decodedUrl)) {
        content = `<img src="${decodedUrl}">`;
    }
    const mode = outputMode(entry.category, rule);
    let urls = extractUrls(content, decodedUrl);
    if (entry.category === 'comic') {
        urls = filterComicImageUrls(urls, decodedUrl, content);
        const antbywUrls = raw ? await fetchAntbywPagedImages(source, raw, decodedUrl, 80) : [];
        if (antbywUrls.length) {
            urls = antbywUrls;
            content = urls.map(url => `<img src="${url}">`).join('\n');
        }
        const yydsmhUrls = raw ? await fallbackYydsmhImageUrls(raw, decodedUrl) : [];
        if (yydsmhUrls.length) {
            urls = yydsmhUrls;
            content = urls.map(url => `<img src="${url}">`).join('\n');
        }
        if (!urls.length && raw && !shouldSkipGenericComicFallback(raw, decodedUrl, content)) {
            urls = fallbackStructuredComicImageUrls(raw, decodedUrl);
            if (!urls.length) urls = fallbackComicImageUrls(raw, decodedUrl);
            if (urls.length && !content) {
                content = urls.map(url => `<img src="${url}">`).join('\n');
            }
        }
        if (!urls.length && raw && !shouldSkipGenericComicFallback(raw, decodedUrl, content) && /api\/chapter\/getinfo|images|chapter_img|chapterimg|comic-contain|mh_info/i.test(raw)) {
            urls = fallbackStructuredComicImageUrls(raw, decodedUrl);
            if (!urls.length) urls = filterComicImageUrls(extractUrls(raw, decodedUrl), decodedUrl, raw);
        }
    }
    if (!content && entry.category !== 'comic') content = decodedUrl;
    return { content, urls, mode };
}

// --- Video grouping ---

function groupVideoEntries(entries) {
    let currentLine = '默认线路';
    return entries.map(entry => {
        if (entry.isVolume || !entry.url) {
            currentLine = entry.name || currentLine;
            return { ...entry, line: currentLine, selectable: false };
        }
        return { ...entry, line: currentLine, selectable: true };
    });
}

// --- Detail assembly ---

async function fetchDetail(loaded, itemUrl, rawContext) {
    const { entry, source } = loaded;
    const adapter = createAdapter(entry, source);
    const decodedUrl = decodeURIComponent(itemUrl);
    const context = createContext(source, {
        baseUrl: decodedUrl,
        result: rawContext,
        timeout: config.jsRuntimeTimeout,
    });
    const html = await fetchSourceUrl(decodedUrl, context, { timeout: config.requestTimeout });
    if (!html) throw new Error('Unable to fetch detail');

    const rule = source.ruleBookInfo || {};
    let data = rule.init ? runRule(html, rule.init, { ...context, result: html, baseUrl: decodedUrl }) : html;
    if (isBadValue(data, rule.init)) data = html;
    const parsed = typeof data === 'string' ? tryJson(data) : data;
    const templateContext = parsed || rawContext || data;
    const dataContext = { ...context, result: data, baseUrl: decodedUrl };
    const profile = categoryProfile(entry.category);

    const readField = (field) => {
        const ruleValue = rule[field];
        let value = ruleValue ? runRule(data, ruleValue, dataContext) : '';
        if (isBadDetailField(field, value, ruleValue)) {
            value = valueFromContext(rawContext, profile.detailFields[field] || [])
                || valueFromSearchContext(rawContext, source, field);
        }
        return value;
    };

    let tocUrl = '';
    if (rule.tocUrl) {
        tocUrl = resolveRuleUrl(rule.tocUrl, source, decodedUrl, {
            ...dataContext,
            result: data,
        });
    }
    tocUrl = repairTocUrl(tocUrl, decodedUrl);
    if (isAudioLikeCategory(entry.category)) tocUrl = repairAudioTocUrl(tocUrl, decodedUrl);
    if (entry.category === 'comic' && !tocUrl) {
        tocUrl = findComicApiTocUrl(html, decodedUrl);
    }
    if (!tocUrl && !rule.tocUrl && source.ruleToc && source.ruleToc.chapterList) {
        tocUrl = decodedUrl;
    }
    const shouldSearchTocLink = !tocUrl || isInvalidTocUrl(tocUrl) || (sameUrl(tocUrl, decodedUrl) && Boolean(rule.tocUrl));
    if (shouldSearchTocLink) {
        const foundTocUrl = findTocLink(html, decodedUrl);
        tocUrl = isInvalidTocUrl(foundTocUrl) ? '' : (foundTocUrl || tocUrl);
    }
    if ((!tocUrl || isInvalidTocUrl(tocUrl)) && source.ruleToc && source.ruleToc.chapterList) tocUrl = decodedUrl;

    const detail = {
        sourceId: entry.id,
        sourceName: entry.name,
        category: entry.category,
        profile,
        adapter: {
            tags: adapter.tags,
            warnings: adapter.warnings,
            capabilities: adapter.capabilities,
            webViewRequired: adapter.webViewRequired,
            loginRequired: adapter.loginRequired,
            browserRequired: adapter.browserRequired,
        },
        name: cleanText(readField('name') || extractMeta(html, 'title') || extractTitle(html) || valueFromContext(rawContext, profile.detailFields.name) || '未命名'),
        author: cleanText(readField('author') || valueFromContext(rawContext, profile.detailFields.author) || ''),
        coverUrl: normalizeCoverForSource(
            source,
            readField('coverUrl') || extractMeta(html, 'image'),
            decodedUrl,
            normalizeCoverForSource(source, valueFromContext(rawContext, profile.detailFields.coverUrl), decodedUrl)
        ),
        intro: cleanText(readField('intro') || extractMeta(html, 'description') || valueFromContext(rawContext, profile.detailFields.intro) || ''),
        kind: cleanText(readField('kind') || ''),
        lastChapter: cleanText(readField('lastChapter') || ''),
        wordCount: cleanText(readField('wordCount') || ''),
        downloadUrls: extractUrls(readField('downloadUrls'), decodedUrl),
        tocUrl,
        itemUrl: decodedUrl,
        session: encodeSession({
            variables: syncVariables(dataContext),
            rawContext,
        }),
    };
    return detail;
}

module.exports = {
    loadIndex,
    loadSource,
    invalidateSourceCache,
    resolveNextTocUrls,
    fallbackEntries,
    fallbackMangaSearcherEntries,
    isUsableEntryLink,
    findTocLink,
    repairTocUrl,
    isInvalidTocUrl,
    looksLikeHtmlUrl,
    findComicApiTocUrl,
    fetchSourceUrlWithRetry,
    fetchEntriesPage,
    normalizeComicEntryUrl,
    mergeEntries,
    fetchPayloadContent,
    groupVideoEntries,
    fetchDetail,
    searchSource,
    fetchAllEntries,
    resolvePayloadContent,
};
