/**
 * Type-aware content routes.
 *
 * Legado sources share the same rule names, but each category means something
 * different: novel chapters, comic pages, audio tracks, video episodes, games,
 * or tool/download entries. These routes keep that semantic layer explicit.
 */
const express = require('express');
const config = require('../config');
const {
    buildUrl,
    cleanSourceUrl,
    createContext,
    runRule,
    runRuleList,
} = require('../engine/legadoEngine');
const { createAdapter } = require('../engine/sourceAdapters');

const {
    requestParam,
    numericRequestParam,
    parseSourceHeader,
    parseEmbeddedHeaders,
    isAudioLikeCategory,
    unique,
    cleanText,
    decodeRawContext,
    encodeSession,
    decodeSession,
    stringifyForRaw,
    syncVariables,
} = require('./utils');

const {
    fetchBinary,
    probeDirectMediaUrl,
    contentTypeFromUrl,
    isHlsPlaylistUrl,
    rewriteHlsPlaylist,
    contentTypeFromMediaUrl,
} = require('./proxy');

const {
    categoryProfile,
    outputMode,
} = require('./profiles');

const {
    safeHeaderUrl,
} = require('./url-utils');

const {
    fetchCmsVideoEntries,
} = require('./video-fallback');

const {
    loadIndex,
    loadSource,
    fetchEntriesPage,
    fetchDetail,
    searchSource,
    fetchAllEntries,
    resolvePayloadContent,
} = require('./content-helpers');

const router = express.Router();

function safeDecodeUri(value) {
    try { return decodeURIComponent(value); } catch { return value; }
}

// --- Route: search ---

router.post('/search', async (req, res) => {
    try {
        const { keyword, category, sourceIds } = req.body;
        const disabledSourceIds = Array.isArray(req.body.disabledSourceIds)
            ? new Set(req.body.disabledSourceIds.map(String))
            : new Set();
        if (!keyword || !String(keyword).trim()) return res.status(400).json({ error: '请输入搜索关键词' });
        const perSourceLimit = Math.min(Math.max(parseInt(req.body.perSourceLimit || 5, 10) || 5, 1), 20);
        const sourceOffset = Math.max(parseInt(req.body.sourceOffset || 0, 10) || 0, 0);
        const sourceLimit = Math.min(Math.max(parseInt(req.body.sourceLimit || 24, 10) || 24, 1), 80);
        const searchTimeout = Math.min(Math.max(parseInt(req.body.timeout || 6000, 10) || 6000, 1500), config.requestTimeout);
        let targets = loadIndex().filter(entry => entry.enabled !== false
            && !disabledSourceIds.has(String(entry.id))
            && (!category || category === 'all' || entry.category === category));
        if (Array.isArray(sourceIds) && sourceIds.length) targets = targets.filter(entry => sourceIds.includes(entry.id));
        targets.sort((a, b) => (a.status === 'ok' ? 0 : 1) - (b.status === 'ok' ? 0 : 1));
        const totalSources = targets.length;
        const pageStart = Array.isArray(sourceIds) && sourceIds.length ? 0 : sourceOffset;
        targets = targets.slice(pageStart, pageStart + sourceLimit);

        const results = [];
        const errors = [];
        const sourceReports = [];
        await Promise.all(targets.map(async (entry, index) => {
            const report = { index, sourceId: entry.id, name: entry.name, category: entry.category, status: 'pending', count: 0, error: '' };
            sourceReports.push(report);
            try {
                const result = await searchSource(entry, keyword, searchTimeout);
                if (result.status === 'skipped' || result.status === 'failed') {
                    report.status = result.status;
                    report.error = result.error;
                    if (result.listError) errors.push({ sourceId: entry.id, name: entry.name, error: result.listError });
                    return;
                }
                const kw = String(keyword).toLowerCase();
                const matched = result.items.filter(item => item.name.toLowerCase().includes(kw) || String(item.author || '').toLowerCase().includes(kw)).slice(0, perSourceLimit);
                report.count = matched.length;
                report.status = matched.length ? 'ok' : 'empty';
                if (matched.length) results.push({ sourceId: entry.id, sourceName: entry.name, category: entry.category, items: matched });
            } catch (err) {
                report.status = 'failed';
                report.error = err.message;
                errors.push({ sourceId: entry.id, name: entry.name, error: err.message });
            }
        }));

        const limited = results.map(group => ({ ...group, count: group.items.length }));
        const nextSourceOffset = pageStart + sourceLimit;
        res.json({
            keyword,
            category,
            sourceLimit,
            sourceOffset: pageStart,
            nextSourceOffset,
            totalSources,
            scannedSources: targets.length,
            hasMoreSources: nextSourceOffset < totalSources && !(Array.isArray(sourceIds) && sourceIds.length),
            totalResults: limited.reduce((sum, group) => sum + group.items.length, 0),
            sourceCount: limited.length,
            errors: errors.slice(0, 8),
            sourceReports: sourceReports.sort((a, b) => a.index - b.index).map(({ index, ...item }) => item),
            results: limited,
        });
    } catch (err) {
        console.error('[Content] Search error:', err);
        res.status(500).json({ error: '搜索失败: ' + err.message });
    }
});

// --- Route: detail ---

router.all('/detail', async (req, res) => {
    try {
        const sourceId = requestParam(req, 'sourceId');
        const itemUrl = requestParam(req, 'itemUrl');
        const raw = requestParam(req, 'raw');
        if (!sourceId || !itemUrl) return res.status(400).json({ error: 'sourceId and itemUrl are required' });
        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });
        const detail = await fetchDetail(loaded, itemUrl, decodeRawContext(raw));
        res.json(detail);
    } catch (err) {
        console.error('[Content] Detail error:', err);
        res.status(500).json({ error: '详情加载失败: ' + err.message });
    }
});

// --- Route: entries ---

router.all('/entries', async (req, res) => {
    try {
        const sourceId = requestParam(req, 'sourceId');
        const tocUrl = requestParam(req, 'tocUrl');
        const session = requestParam(req, 'session');
        if (!sourceId || !tocUrl) return res.status(400).json({ error: 'sourceId and tocUrl are required' });
        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });
        const { entry, source } = loaded;
        const adapter = createAdapter(entry, source);
        const decodedUrl = safeDecodeUri(tocUrl);
        const sessionData = decodeSession(session);
        const rule = source.ruleToc || {};
        if (!rule.chapterList) return res.status(400).json({ error: 'This source does not support entries' });

        const directCmsEntries = await fetchCmsVideoEntries(entry, source, decodedUrl, 0);
        if (directCmsEntries.length) {
            return res.json({
                sourceId,
                category: entry.category,
                profile: categoryProfile(entry.category),
                totalEntries: directCmsEntries.length,
                entries: directCmsEntries,
                fetchedTocPages: 1,
                failedTocPages: 0,
                failedPages: [],
                partial: false,
                adapter: { tags: adapter.tags, warnings: adapter.warnings, capabilities: adapter.capabilities },
                nextTocUrl: '',
                nextTocUrls: [],
                session: encodeSession({ variables: sessionData.variables || {}, rawContext: sessionData.rawContext || null }),
            });
        }

        const fetchResult = await fetchAllEntries(source, adapter, decodedUrl, sessionData, {
            maxPages: numericRequestParam(req, 'maxPages', adapter.maxEntryPages || 20),
            budgetMs: numericRequestParam(req, 'budgetMs', 45000),
        });
        if (!fetchResult) return res.status(404).json({ error: 'Unable to fetch entries' });

        res.json({
            sourceId,
            category: entry.category,
            profile: categoryProfile(entry.category),
            totalEntries: fetchResult.entries.length,
            entries: fetchResult.entries,
            fetchedTocPages: fetchResult.fetchedTocPages,
            failedTocPages: fetchResult.failedPages.length,
            failedPages: fetchResult.failedPages.slice(0, 10),
            partial: fetchResult.failedPages.length > 0,
            adapter: { tags: adapter.tags, warnings: adapter.warnings, capabilities: adapter.capabilities },
            nextTocUrl: fetchResult.nextTocUrl,
            nextTocUrls: fetchResult.nextTocUrls,
            session: encodeSession({ variables: fetchResult.variables, rawContext: sessionData.rawContext || null }),
        });
    } catch (err) {
        console.error('[Content] Entries error:', err);
        res.status(500).json({ error: '列表加载失败: ' + err.message });
    }
});

// --- Route: payload ---

router.all('/payload', async (req, res) => {
    try {
        const sourceId = requestParam(req, 'sourceId');
        const entryUrl = requestParam(req, 'entryUrl');
        const index = requestParam(req, 'index', 0);
        const title = requestParam(req, 'title', '');
        const session = requestParam(req, 'session');
        if (!sourceId || !entryUrl) return res.status(400).json({ error: 'sourceId and entryUrl are required' });
        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });
        const { entry, source } = loaded;
        const adapter = createAdapter(entry, source);
        const decodedUrl = safeDecodeUri(entryUrl);
        const rule = source.ruleContent || {};
        const sessionData = decodeSession(session);
        const context = createContext(source, {
            baseUrl: decodedUrl,
            timeout: config.jsRuntimeTimeout,
            variables: sessionData.variables || {},
            chapter: { index: Number(index), title },
        });
        let raw = '';
        let content = '';
        const directVideoUrl = entry.category === 'video' && /\.(?:mp4|m3u8|webm|mov)(?:[?#].*)?$/i.test(decodedUrl);
        if (rule.content && !directVideoUrl) {
            const maxPages = Math.min(Math.max(numericRequestParam(req, 'maxPages', 8) || 8, 1), 40);
            const fetched = await fetchPayloadContent(source, rule, decodedUrl, context, maxPages);
            raw = fetched.raw;
            content = fetched.content;
            context.fetchedContentPages = fetched.fetchedContentPages;
            context.nextContentUrls = fetched.nextContentUrls;
        }
        if (directVideoUrl) content = decodedUrl;
        const resolved = await resolvePayloadContent(entry, source, adapter, decodedUrl, rule, sessionData, context, raw, content);
        content = resolved.content;
        const mode = resolved.mode;
        let urls = resolved.urls;

        const response = adapter.normalizePayload({
            sourceId,
            category: entry.category,
            type: categoryProfile(entry.category).payloadKind,
            title: cleanText(title),
            entryUrl: decodedUrl,
            mode,
            content: mode === 'text' ? cleanText(content) : String(content || ''),
            text: cleanText(content),
            urls: (entry.category === 'game' || entry.category === 'special') && /^https?:\/\//i.test(decodedUrl)
                ? unique([...urls, decodedUrl])
                : urls,
            mediaUrl: urls.find(url => /\.(mp3|m4a|aac|flac|wav|ogg|mp4|m3u8)(\?|$)/i.test(url)) || (/^https?:\/\//i.test(String(content).trim()) ? String(content).trim() : ''),
            rawLength: raw.length,
            fetchedContentPages: context.fetchedContentPages || 0,
            nextContentUrls: context.nextContentUrls || [],
            session: encodeSession({ variables: syncVariables(context), rawContext: sessionData.rawContext || null }),
        });
        response.validation = adapter.validatePayload(response);
        if (entry.category === 'video' && response.mediaUrl && /\.(?:m3u8|mp4|webm|mov)(?:[?#].*)?$/i.test(response.mediaUrl)) {
            const mediaProbe = await probeDirectMediaUrl(response.mediaUrl, {
                ...parseSourceHeader(source.header),
                Referer: decodedUrl,
            }, 8000);
            if (!mediaProbe.ok) response.validation = mediaProbe;
            response.mediaProbe = mediaProbe;
        }
        response.adapter = { tags: adapter.tags, warnings: adapter.warnings, capabilities: adapter.capabilities };
        res.json(response);
    } catch (err) {
        console.error('[Content] Payload error:', err);
        res.status(500).json({ error: '内容加载失败: ' + err.message });
    }
});

// --- Route: hls proxy ---

router.get('/hls', async (req, res) => {
    try {
        const url = safeHeaderUrl(req.query.url);
        const referer = safeHeaderUrl(req.query.referer) || url;
        if (!url) return res.status(400).send('Missing hls url');
        const fetched = await fetchBinary(url, {
            Accept: '*/*',
            Referer: referer,
            Origin: referer ? new URL(referer).origin : undefined,
        }, config.requestTimeout);
        if (fetched.statusCode >= 400) return res.status(fetched.statusCode).send('HLS fetch failed');
        const upstreamType = String(fetched.headers['content-type'] || '');
        const bodyStart = fetched.body.toString('utf8', 0, Math.min(fetched.body.length, 16));
        const isPlaylist = isHlsPlaylistUrl(url) || /mpegurl|vnd\.apple/i.test(upstreamType) || /^#EXTM3U/i.test(bodyStart);
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', isPlaylist ? 'no-store' : 'public, max-age=86400');
        if (isPlaylist) {
            res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
            return res.send(rewriteHlsPlaylist(fetched.body.toString('utf8'), url));
        }
        res.set('Content-Type', contentTypeFromMediaUrl(url, upstreamType));
        if (fetched.headers['content-length']) res.set('Content-Length', fetched.headers['content-length']);
        res.send(fetched.body);
    } catch (err) {
        res.status(502).send(err.message || 'HLS proxy failed');
    }
});

// --- Route: image proxy ---

router.get('/image', async (req, res) => {
    try {
        const url = safeHeaderUrl(req.query.url);
        const embeddedHeaders = parseEmbeddedHeaders(req.query.url);
        const referer = safeHeaderUrl(req.query.referer) || safeHeaderUrl(embeddedHeaders.Referer || embeddedHeaders.referer) || url;
        if (!url) return res.status(400).send('Missing image url');
        const referers = unique([
            referer,
            /g-mh\.online|mgsearcher\.com/i.test(url) ? 'https://m.g-mh.org/' : '',
            /g-mh\.online|mgsearcher\.com/i.test(url) ? 'https://www.g-mh.org/' : '',
            /g-mh\.online|mgsearcher\.com/i.test(url) ? 'https://api-get-v3.mgsearcher.com/' : '',
        ].filter(Boolean));
        let fetched = null;
        let lastError = null;
        for (const nextReferer of referers) {
            try {
                fetched = await fetchBinary(url, {
                    Referer: nextReferer,
                    Origin: nextReferer ? new URL(nextReferer).origin : undefined,
                    ...embeddedHeaders,
                }, config.requestTimeout);
                const type = fetched.headers['content-type'] || '';
                if (fetched.statusCode < 400 && (!type || /^image\//i.test(type) || /octet-stream/i.test(type))) break;
                fetched = await fetchBinary(url, {
                    Referer: nextReferer,
                    ...embeddedHeaders,
                    Origin: undefined,
                }, config.requestTimeout);
                const retryType = fetched.headers['content-type'] || '';
                if (fetched.statusCode < 400 && (!retryType || /^image\//i.test(retryType) || /octet-stream/i.test(retryType))) break;
            } catch (err) {
                lastError = err;
            }
        }
        if (!fetched && lastError) throw lastError;
        const finalType = fetched.headers['content-type'] || '';
        if (fetched.statusCode >= 400) return res.status(fetched.statusCode).send('Image fetch failed');
        if (finalType && !/^image\//i.test(finalType) && !/octet-stream/i.test(finalType)) return res.status(502).send('Not an image');
        res.set('Content-Type', finalType || contentTypeFromUrl(url));
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(fetched.body);
    } catch (err) {
        res.status(502).send(err.message || 'Image proxy failed');
    }
});

module.exports = router;
