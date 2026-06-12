/**
 * Type-aware content routes.
 *
 * Legado sources share the same rule names, but each category means something
 * different: novel chapters, comic pages, audio tracks, video episodes, games,
 * or tool/download entries. These routes keep that semantic layer explicit.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cheerio = require('cheerio');
const net = require('net');
const http = require('http');
const https = require('https');
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

const router = express.Router();

function requestParam(req, key, fallback = '') {
    if (req.body && req.body[key] !== undefined) return req.body[key];
    if (req.query && req.query[key] !== undefined) return req.query[key];
    return fallback;
}

function numericRequestParam(req, key, fallback) {
    const value = requestParam(req, key, fallback);
    return parseInt(value, 10);
}

function safeHeaderUrl(value) {
    const text = String(value || '').split(',{')[0].trim();
    if (!/^https?:\/\//i.test(text)) return '';
    try {
        return new URL(text).href;
    } catch {
        return '';
    }
}

function parseEmbeddedHeaders(value) {
    const text = String(value || '');
    const index = text.indexOf(',{');
    if (index < 0) return {};
    try {
        const parsed = JSON.parse(text.slice(index + 1));
        return parsed && typeof parsed.headers === 'object' ? parsed.headers : {};
    } catch {
        return {};
    }
}

function parseSourceHeader(header) {
    if (!header) return {};
    if (typeof header === 'object') return header;
    try {
        return JSON.parse(String(header));
    } catch {
        return parseLooseHeaderObject(header);
    }
}

function parseLooseHeaderObject(header) {
    const text = String(header || '').trim();
    if (!text.startsWith('{') || !text.endsWith('}')) return {};
    const body = text.slice(1, -1);
    const headers = {};
    const pattern = /['"]?([^'",\n\r:]+)['"]?\s*:\s*(['"])(.*?)\2\s*,?/g;
    let match;
    while ((match = pattern.exec(body)) !== null) {
        const key = match[1].trim();
        const value = match[3];
        if (key) headers[key] = value;
    }
    return headers;
}

function isAudioLikeCategory(category) {
    return category === 'audio' || category === 'music';
}

function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function isBlockedProxyHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    const ipType = net.isIP(host);
    if (ipType === 4) {
        const [a, b] = host.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    if (ipType === 6) {
        return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
    }
    return false;
}

function fetchBinary(url, headers = {}, timeout = 15000, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return reject(new Error('Invalid URL'));
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) return reject(new Error('Only HTTP/HTTPS URLs are allowed'));
        if (!config.allowPrivateNetworkFetch && isBlockedProxyHost(parsed.hostname)) return reject(new Error('Private network URLs are not allowed'));
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                ...headers,
            },
            timeout,
            rejectUnauthorized: config.rejectUnauthorized,
        }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                const next = new URL(response.headers.location, url).href;
                response.destroy();
                return fetchBinary(next, headers, timeout, redirects + 1).then(resolve, reject);
            }
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks),
            }));
        });
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
        req.on('error', reject);
        req.end();
    });
}

async function probeDirectMediaUrl(url, headers = {}, timeout = 8000) {
    const text = String(url || '').trim();
    if (!/^https?:\/\//i.test(text)) return { ok: false, reason: 'invalid_media_url' };
    if (!/\.(?:m3u8|mp4|webm|mov)(?:[?#].*)?$/i.test(text)) return { ok: true };
    try {
        const fetched = await fetchBinary(text, headers, timeout);
        if (fetched.statusCode < 200 || fetched.statusCode >= 400) {
            return { ok: false, reason: `media_http_${fetched.statusCode}` };
        }
        if (/\.m3u8(?:[?#].*)?$/i.test(text)) {
            const body = fetched.body.toString('utf8', 0, Math.min(fetched.body.length, 512));
            if (!/^#EXTM3U/m.test(body)) return { ok: false, reason: 'invalid_m3u8_playlist' };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: 'media_unreachable', detail: err.message };
    }
}

function contentTypeFromUrl(url) {
    const text = String(url || '').split('?')[0].toLowerCase();
    if (text.endsWith('.png')) return 'image/png';
    if (text.endsWith('.webp')) return 'image/webp';
    if (text.endsWith('.gif')) return 'image/gif';
    if (text.endsWith('.avif')) return 'image/avif';
    return 'image/jpeg';
}

function isHlsPlaylistUrl(url) {
    return /\.m3u8(?:[?#].*)?$/i.test(String(url || ''));
}

function hlsProxyUrl(url, referer = '') {
    const cleanUrl = safeHeaderUrl(url);
    if (!cleanUrl) return '';
    return '/api/content/hls?url=' + encodeURIComponent(cleanUrl) + (referer ? '&referer=' + encodeURIComponent(referer) : '');
}

function rewriteHlsAttribute(line, baseUrl, referer) {
    return line.replace(/\bURI=(["'])(.*?)\1/gi, (match, quote, value) => {
        if (!value || /^(?:data:|skd:|blob:)/i.test(value)) return match;
        try {
            const absolute = new URL(value, baseUrl).href;
            return `URI=${quote}${hlsProxyUrl(absolute, referer)}${quote}`;
        } catch {
            return match;
        }
    });
}

function rewriteHlsPlaylist(playlist, baseUrl) {
    const referer = safeHeaderUrl(baseUrl);
    return String(playlist || '').split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) return rewriteHlsAttribute(line, baseUrl, referer);
        if (/^(?:data:|blob:|skd:)/i.test(trimmed)) return line;
        try {
            return hlsProxyUrl(new URL(trimmed, baseUrl).href, referer);
        } catch {
            return line;
        }
    }).join('\n');
}

function contentTypeFromMediaUrl(url, fallback = '') {
    const text = String(url || '').split('?')[0].toLowerCase();
    if (fallback) return fallback;
    if (text.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl; charset=utf-8';
    if (text.endsWith('.ts')) return 'video/mp2t';
    if (text.endsWith('.m4s')) return 'video/iso.segment';
    if (text.endsWith('.mp4')) return 'video/mp4';
    if (text.endsWith('.key')) return 'application/octet-stream';
    return 'application/octet-stream';
}

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(config.sourcesPath, 'index.json'), 'utf-8'));
}

function loadSource(sourceId) {
    const entry = loadIndex().find(item => item.id === sourceId);
    if (!entry) return null;
    const fileData = JSON.parse(fs.readFileSync(path.join(config.sourcesPath, entry.file), 'utf-8'));
    const source = fileData[entry.index];
    return source ? { entry, source } : null;
}

function cleanText(value) {
    return decodeHtml(String(value || ''))
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function applyReplaceRegex(content, replaceRegex) {
    let text = String(content || '');
    if (!replaceRegex) return text;
    const parts = String(replaceRegex).split('##');
    const start = parts[0] === '' ? 1 : 0;
    for (let i = start; i < parts.length; i += 2) {
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

function classifyEmptySearch(raw) {
    const text = String(raw || '').trim();
    if (!text) return 'empty_response';
    if (/just a moment|cloudflare|cf-browser|challenge-platform/i.test(text)) return 'blocked_by_site';
    if (/\u7ad9\u70b9\u5df2\u6682\u505c|\u6682\u505c|site\s+has\s+been\s+suspended/i.test(text)) return 'site_paused';
    const json = parseJsonMaybe(text);
    if (json && typeof json === 'object') {
        const body = JSON.stringify(json);
        if (/\u641c\u7d22\u7ed3\u679c\u4e3a\u7a7a|no\s*result|not\s*found/i.test(body)) return 'no_search_result';
        const candidates = [json.data, json.list, json.results, json.result && json.result.list, json.results && json.results.list];
        if (candidates.some(item => Array.isArray(item) && item.length === 0)) return 'no_search_result';
        if (json.total === 0 || json.count === 0) return 'no_search_result';
        if (json.meta && json.meta.pagination && Number(json.meta.pagination.total || 0) === 0) return 'no_search_result';
    }
    if (/404 not found|not found/i.test(text)) return 'not_found';
    return 'rules_no_match';
}

function parseJsonMaybe(value) {
    if (value && typeof value === 'object') return value;
    try {
        return JSON.parse(String(value || ''));
    } catch {
        return null;
    }
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function isBadValue(value, rule) {
    const val = String(value || '').trim();
    if (!val) return true;
    if (rule && val === String(rule).trim()) return true;
    if (val.startsWith('[JS_RULE]')) return true;
    if (val.includes('{{') || val.includes('}}') || val.includes('{$')) return true;
    if (val.includes('@content') || val.includes('@text')) return true;
    if (/^<!doctype|^<html/i.test(val) && val.length > 5000) return true;
    return false;
}

function normalizeNavText(value) {
    return cleanText(value)
        .replace(/[>》»]+$/g, '')
        .replace(/^[<《«]+/g, '')
        .trim();
}

function isNavigationText(value) {
    const text = normalizeNavText(value);
    if (!text) return true;
    if (/^(返回|返回首页|返回首頁|首页|首頁|主页|主頁|书架|書架|目录|目錄|全部章节|全部章節|登录|登入|注册|註冊|搜索|排行|分类|分類)$/i.test(text)) return true;
    if (/^(返回|首页|主页|书架|加入书架|电脑版|手机版|TXT下载|下载|上一页|下一页|上一章|下一章|查看更多章节|更多章节|全部章节|章节目录|目录|开始阅读)$/i.test(text)) return true;
    if (/^(登录|注册|搜索|排行|分类|最近更新|完本小说|全本小说)$/i.test(text)) return true;
    return false;
}

function isBadDetailField(field, value, rule) {
    if (isBadValue(value, rule)) return true;
    if (field === 'name' && isNavigationText(value)) return true;
    if ((field === 'intro' || field === 'lastChapter') && isNavigationText(value)) return true;
    return false;
}

function decodeRawContext(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(Buffer.from(String(raw), 'base64').toString('utf-8'));
    } catch {
        return null;
    }
}

function encodeSession(value) {
    return Buffer.from(JSON.stringify(value || {})).toString('base64');
}

function decodeSession(value) {
    if (!value) return {};
    try {
        const parsed = JSON.parse(Buffer.from(String(value), 'base64').toString('utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function tryJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function stringifyForRaw(value) {
    const seen = new WeakSet();
    try {
        return JSON.stringify(value, (key, item) => {
            if (typeof item === 'function') return undefined;
            if (item && typeof item === 'object') {
                if (seen.has(item)) return undefined;
                seen.add(item);
                if (['parent', 'prev', 'next', 'children'].includes(key)) return undefined;
            }
            return item;
        });
    } catch {
        return JSON.stringify(String(value || ''));
    }
}

function valueFromContext(context, keys) {
    if (!context || typeof context !== 'object') return '';
    for (const key of keys) {
        const value = context[key];
        if (value !== undefined && value !== null && String(value).trim()) return value;
    }
    return '';
}

function syncVariables(context) {
    if (context && context.variables) return { ...context.variables };
    return {};
}

function extractMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp('<meta[^>]+name=["\']' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
        new RegExp('<meta[^>]+property=["\'](?:og:)?' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
        new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\'](?:og:)?' + escaped + '["\']', 'i'),
    ];
    for (const pattern of patterns) {
        const match = String(html || '').match(pattern);
        if (match && match[1]) return decodeHtml(match[1].trim());
    }
    return '';
}

function extractTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? decodeHtml(match[1]).replace(/\s*[-_|].*$/, '').trim() : '';
}

function categoryProfile(category) {
    const profiles = {
        novel: {
            itemName: '章节',
            payloadKind: 'text',
            openLabel: '阅读正文',
            entryLabel: '目录',
            detailFields: {
                name: ['name', 'bookName', 'book_name', 'novelName', 'title'],
                author: ['author', 'authorName', 'writer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb_url'],
                intro: ['intro', 'summary', 'description', 'bookIntro', 'abstract'],
            },
        },
        comic: {
            itemName: '话',
            payloadKind: 'images',
            openLabel: '阅读漫画',
            entryLabel: '目录',
            detailFields: {
                name: ['name', 'title', 'comicName'],
                author: ['author', 'authorName', 'writer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'brief', 'description', 'summary'],
            },
        },
        audio: {
            itemName: '音频',
            payloadKind: 'audio',
            openLabel: '播放音频',
            entryLabel: '节目列表',
            detailFields: {
                name: ['name', 'title', 'albumName', 'book_name'],
                author: ['author', 'announcer', 'anchorName', 'nickname'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb_url'],
                intro: ['intro', 'desc', 'description', 'abstract'],
            },
        },
        music: {
            itemName: '歌曲',
            payloadKind: 'audio',
            openLabel: '播放音乐',
            entryLabel: '播放列表',
            detailFields: {
                name: ['name', 'title', 'songName'],
                author: ['author', 'artist', 'singer', 'uname'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb'],
                intro: ['intro', 'album', 'description', 'des'],
            },
        },
        video: {
            itemName: '集',
            payloadKind: 'video',
            openLabel: '播放视频',
            entryLabel: '播放源 / 剧集',
            detailFields: {
                name: ['name', 'title', 'video_name'],
                author: ['author', 'actor', 'celebrity'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl', 'img'],
                intro: ['intro', 'info', 'description', 'desc'],
            },
        },
        game: {
            itemName: '入口',
            payloadKind: 'link',
            openLabel: '打开 / 下载',
            entryLabel: '入口',
            detailFields: {
                name: ['name', 'title'],
                author: ['author', 'developer'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'description', 'html5introduce'],
            },
        },
        special: {
            itemName: '资源',
            payloadKind: 'link',
            openLabel: '操作 / 下载',
            entryLabel: '资源列表',
            detailFields: {
                name: ['name', 'title', 'server_filename'],
                author: ['author', 'owner', 'developername'],
                coverUrl: ['cover', 'coverUrl', 'pic', 'picUrl'],
                intro: ['intro', 'description', 'message'],
            },
        },
    };
    return profiles[category] || profiles.special;
}

function outputMode(category, ruleContent = {}) {
    if (ruleContent.imageStyle || category === 'comic') return 'html';
    if (category === 'novel') return 'text';
    return 'raw';
}

function valueFromSearchContext(context, source, field) {
    if (!context) return '';
    const rule = (source.ruleSearch || {})[field];
    if (!rule) return '';
    const engineContext = createContext(source, { result: context, timeout: config.jsRuntimeTimeout });
    const value = runRule(context, rule, engineContext);
    return isBadValue(value, rule) ? '' : value;
}

function normalizeUrlMaybe(value, baseUrl) {
    const text = String(value || '').trim();
    if (!text) return '';
    const duplicated = text.match(/^(https?:\/\/[^/]+)(https?:\/\/.+)$/i);
    if (duplicated) return normalizeUrlMaybe(duplicated[2], baseUrl);
    if (/^(data:|blob:|magnet:|thunder:|ftp:|javascript:)/i.test(text)) return text;
    if (/^https?:\/\//i.test(text) || text.startsWith('/')) return resolveUrl(text, baseUrl);
    return text;
}

function isIkanbotSource(source) {
    return /ikanbot|aikanbot/i.test(String(source?.bookSourceUrl || source?.searchUrl || ''));
}

function isLiulianVideoSource(source) {
    return /66yy\.net/i.test(String(source?.bookSourceUrl || source?.searchUrl || ''));
}

function normalizeIkanbotCoverUrl(value, baseUrl) {
    let text = String(value || '').trim();
    if (!text || /^data:image/i.test(text)) return '';
    text = text.replace(/^https?:\/\/imgp\.aikanbot\.com\/proxy\?url=/i, '');
    try {
        text = decodeURIComponent(text);
    } catch {
        // Keep the original value when it is not URI encoded.
    }
    const url = normalizeUrlMaybe(text, baseUrl);
    if (!url || /\/resources\/logo\.svg(?:$|\?)/i.test(url)) return '';
    return url;
}

function normalizeCoverForSource(source, value, baseUrl, fallback = '') {
    const url = isIkanbotSource(source)
        ? normalizeIkanbotCoverUrl(value, baseUrl)
        : normalizeUrlMaybe(value, baseUrl);
    return url || fallback || '';
}

function extractLiulianVideoUrl(raw) {
    const script = String(raw || '').match(/var\s+player_[a-z0-9_]+\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
    if (!script) return '';
    try {
        const data = JSON.parse(script[1].replace(/\\\//g, '/'));
        return /^https?:\/\//i.test(String(data.url || '')) ? data.url : '';
    } catch {
        const match = script[1].match(/"url"\s*:\s*"([^"]+)"/i);
        return match ? match[1].replace(/\\\//g, '/') : '';
    }
}

function resolveRuleUrl(ruleValue, source, baseUrl, context) {
    if (!ruleValue) return '';
    const value = runRule(context?.result || '', ruleValue, {
        ...(context || {}),
        source,
        baseUrl,
    });
    const candidate = Array.isArray(value) ? value.find(Boolean) : value;
    return buildUrl(String(candidate || ''), {
        ...(context || {}),
        source,
        baseUrl,
        result: context?.result,
    }).url;
}

function resolveNextUrls(value, context) {
    const list = Array.isArray(value) ? value : [value];
    return list
        .flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => buildUrl(String(item || ''), context).url)
        .filter(Boolean);
}

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

function extractUrls(value, baseUrl) {
    const text = String(value || '').trim();
    if (!text) return [];
    const urls = [];
    const $ = cheerio.load(text);
    $('img,source,audio,video,a').each((_, el) => {
        const raw = $(el).attr('src')
            || $(el).attr('data-src')
            || $(el).attr('data-original')
            || $(el).attr('data-url')
            || $(el).attr('data-lazy-src')
            || $(el).attr('href');
        for (const candidate of normalizePossibleUrls(raw, baseUrl)) urls.push(candidate);
    });
    const directMatches = text.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    for (const url of directMatches) {
        for (const candidate of normalizePossibleUrls(url, baseUrl)) urls.push(candidate);
    }
    const pathMatches = text.match(/["'(:]\s*(\/[^"'()<>\s]+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^"'()<>\s]*)?)/gi) || [];
    for (const match of pathMatches) {
        const raw = match.replace(/^["'(:]\s*/, '');
        for (const candidate of normalizePossibleUrls(raw, baseUrl)) urls.push(candidate);
    }
    return [...new Set(urls)];
}

function normalizePossibleUrls(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const first = raw.split(',{')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!first || /^(javascript:|#|void\b)/i.test(first)) return [];
    if (/^\/\//.test(first)) return ['https:' + first];
    const url = normalizeUrlMaybe(first, baseUrl);
    return url ? [url] : [];
}

function filterComicImageUrls(urls, entryUrl, raw = '') {
    const rawText = String(raw || '');
    const rawLooksLikeChapterPayload = /api\/chapter\/getinfo|images|chapter_img|chapterimg|comic-contain|mh_info|f40-1-4\.g-mh\.online/i.test(rawText);
    return [...new Set((urls || [])
        .map(url => String(url || '').split(',{')[0].trim())
        .map(url => normalizeKnownComicImageHost(url))
        .filter(url => isLikelyComicPageImage(url, entryUrl, rawLooksLikeChapterPayload)))];
}

function normalizeKnownComicImageHost(url) {
    const text = String(url || '');
    if (/\/\/s\d+\.bzmh\.net\//i.test(text)) return text.replace(/\/\/(s\d+)\.bzmh\.net\//i, '//$1.bzcdn.net/');
    return text;
}

function fallbackComicImageUrls(raw, entryUrl) {
    if (!rawLooksLikeComicChapter(raw, entryUrl)) return [];
    const urls = extractUrls(raw, entryUrl)
        .map(url => String(url || '').split(',{')[0].trim())
        .filter(url => /^https?:\/\//i.test(url))
        .filter(url => /\.(jpg|jpeg|png|webp|gif|avif)(?:[?#][^\s]*)?$/i.test(url))
        .filter(url => !isBadComicImageUrl(url));
    return [...new Set(urls)];
}

function fallbackStructuredComicImageUrls(raw, entryUrl) {
    const parsed = tryJson(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const targeted = collectTargetedComicImageUrls(parsed, entryUrl);
    if (targeted.length) return filterComicImageUrls(targeted, entryUrl, raw);

    const urls = [];
    const pushImage = (value) => {
        const normalized = normalizeStructuredComicImageUrl(value, entryUrl);
        if (normalized) urls.push(normalized);
    };
    const visit = (value, key = '') => {
        if (value === undefined || value === null) return;
        if (typeof value === 'string') {
            if (/^(url|src|path|image|img|pic|page|mangaPic)$/i.test(key)) pushImage(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(item => visit(item, key));
            return;
        }
        if (typeof value !== 'object') return;

        if (Array.isArray(value.images)) visit(value.images, 'images');
        if (Array.isArray(value.pageImages)) visit(value.pageImages, 'pageImages');
        if (Array.isArray(value.chapterImages)) visit(value.chapterImages, 'chapterImages');
        if (Array.isArray(value.chapter_img)) visit(value.chapter_img, 'chapter_img');
        if (Array.isArray(value.chapterimg)) visit(value.chapterimg, 'chapterimg');
        if (value.url || value.src || value.path || value.image || value.img || value.pic) {
            pushImage(value.url || value.src || value.path || value.image || value.img || value.pic);
        }
        Object.entries(value).forEach(([childKey, childValue]) => {
            if (/cover|thumb|poster|avatar|logo/i.test(childKey)) return;
            visit(childValue, childKey);
        });
    };
    visit(parsed);
    return filterComicImageUrls([...new Set(urls)], entryUrl, raw);
}

function collectTargetedComicImageUrls(parsed, entryUrl) {
    const candidates = [
        parsed?.data?.info?.images?.images,
        parsed?.data?.images?.images,
        parsed?.data?.chapter?.images,
        parsed?.data?.chapter?.pageImages,
        parsed?.data?.pageImages,
        parsed?.data?.chapterImages,
        parsed?.data?.chapter_img,
        parsed?.info?.images?.images,
        parsed?.images?.images,
        parsed?.pageImages,
        parsed?.chapterImages,
        parsed?.chapter_img,
    ];
    for (const candidate of candidates) {
        const urls = normalizeStructuredComicImageArray(candidate, entryUrl);
        if (urls.length) return urls;
    }
    return [];
}

function normalizeStructuredComicImageArray(value, entryUrl) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map(item => {
            if (typeof item === 'string') return item;
            if (!item || typeof item !== 'object') return '';
            return item.url || item.src || item.path || item.image || item.img || item.pic || '';
        })
        .map(item => normalizeStructuredComicImageUrl(item, entryUrl))
        .filter(Boolean))];
}

function normalizeStructuredComicImageUrl(value, entryUrl) {
    const raw = String(value || '').split(',{')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!raw || isBadComicImageUrl(raw)) return '';
    if (/^\/\//.test(raw)) return 'https:' + raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\//.test(raw) && /api-get-v[23]\.mgsearcher\.com|g-mh\.org|manhuafree\.com/i.test(String(entryUrl || ''))) {
        return 'https://f40-1-4.g-mh.online' + raw;
    }
    return normalizeUrlMaybe(raw, entryUrl) || '';
}

async function fallbackYydsmhImageUrls(raw, entryUrl) {
    if (!/yydsmh\.com/i.test(String(entryUrl || ''))) return [];
    const text = String(raw || '');
    const aid = (text.match(/\baid\s*:\s*['"]?(\d+)/i) || [])[1];
    const cid = (text.match(/\bcid\s*:\s*['"]?(\d+)/i) || [])[1] || (String(entryUrl || '').match(/\/episode\/\d+\/(\d+)\.html/i) || [])[1];
    const picCount = Number((text.match(/\bpicCount\s*:\s*['"]?(\d+)/i) || [])[1] || 0);
    if (!aid || !cid || !picCount) return [];
    const urls = [];
    const limit = 5;
    for (let offset = 0; offset < picCount; offset += limit) {
        const body = new URLSearchParams({ id: cid, aid, offset: String(offset), limit: String(limit) }).toString();
        const result = await fetchUrl('https://www.yydsmh.com/api/comic/read/pics', {
            method: 'POST',
            body,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                Referer: entryUrl,
                Origin: 'https://www.yydsmh.com',
            },
        }, config.requestTimeout);
        const parsed = tryJson(result);
        const pics = parsed?.data?.pic;
        if (!Array.isArray(pics) || !pics.length) break;
        pics.forEach(item => {
            const url = normalizeStructuredComicImageUrl(item?.pic, entryUrl);
            if (url) urls.push(url);
        });
        if (pics.length < limit) break;
    }
    return filterComicImageUrls(urls, entryUrl, 'reader-pic-slot chapterImages');
}

function shouldSkipGenericComicFallback(raw, entryUrl, content = '') {
    const url = String(entryUrl || '');
    const html = String(raw || '');
    const body = String(content || '');
    return /kaixinman\.com/i.test(url)
        && /chapter-images/i.test(html)
        && /<img\s+src=["']?\s*["']?[^>]*>/i.test(body);
}

function rawLooksLikeComicChapter(raw, entryUrl) {
    const text = String(raw || '');
    if (/api\/chapter\/getinfo|chapter_img|chapterimg|comic-contain|mh_info|mangaPic|pageImages|chapterImages|reading-content|readerarea|comicpage|comiclist/i.test(text)) {
        return true;
    }
    try {
        const url = new URL(entryUrl);
        return /chapter|chapters|read|reader|episode|ep[=/_-]|\d+\.html$/i.test(url.pathname + url.search);
    } catch {
        return /chapter|chapters|read|reader|episode|ep[=/_-]|\d+\.html/i.test(String(entryUrl || ''));
    }
}

function isLikelyComicPageImage(url, entryUrl, rawLooksLikeChapterPayload) {
    const text = String(url || '');
    if (!/^https?:\/\//i.test(text)) return false;
    if (!/\.(jpg|jpeg|png|webp|gif|avif)(?:[?#][^\s]*)?$/i.test(text)) return false;
    if (isBadComicImageUrl(text)) return false;
    if (/f40-1-4\.g-mh\.online|g-mh\.online|mhxk\.com|mhpic|manga.*chapter|chapter.*manga|comic.*chapter|chapter.*comic|\/chapter\/|\/chapters\//i.test(text)) return true;
    if (rawLooksLikeChapterPayload && !isSameSiteHomepageAsset(text, entryUrl)) return true;
    return false;
}

function isBadComicImageUrl(url) {
    return /(logo|favicon|avatar|icon|banner|cover|thumb|thumbnail|poster|qrcode|qr-code|wechat|weixin|app-download|download-app|appdl|loading|load\.gif|\/(?:acg|bl)\.gif|placeholder|default|empty|rank|recommend|hot|category|menu|nav|sprite|assets\/images\/logo|bookcover|coverimg|cover_img|posterimg)/i.test(String(url || ''));
}

function isSameSiteHomepageAsset(url, entryUrl) {
    try {
        const image = new URL(url);
        const entry = new URL(entryUrl);
        return image.hostname === entry.hostname && /\/assets\/|\/static\/|\/images\/|\/img\//i.test(image.pathname);
    } catch {
        return false;
    }
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

function fallbackAudioEntries(source, raw, tocUrl, startIndex = 0) {
    const parsed = tryJson(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    if (isMissevanSource(source)) {
        const episodes = [
            ...(Array.isArray(parsed?.info?.episodes?.episode) ? parsed.info.episodes.episode : []),
            ...(Array.isArray(parsed?.info?.episodes?.music) ? parsed.info.episodes.music : []),
            ...(Array.isArray(parsed?.info?.episodes?.ft) ? parsed.info.episodes.ft : []),
        ];
        if (episodes.length) {
            return episodes.map((item, offset) => ({
                index: startIndex + offset,
                name: cleanText(item.name || item.soundstr || `第 ${startIndex + offset + 1} 集`),
                url: item.sound_id ? `https://www.missevan.com/sound/getsound?soundid=${item.sound_id}` : '',
                updateTime: cleanText(item.duration || item.create_time || ''),
                isVip: Boolean(item.need_pay || item.pay_type),
                isVolume: false,
            })).filter(item => item.url);
        }
        const sound = parsed?.info?.sound;
        if (sound?.id) {
            return [{
                index: startIndex,
                name: cleanText(sound.soundstr || sound.name || '音频'),
                url: `https://www.missevan.com/sound/getsound?soundid=${sound.id}`,
                updateTime: cleanText(sound.duration || ''),
                isVip: Boolean(sound.pay_type),
                isVolume: false,
            }];
        }
    }
    if (/hhlqilongzhu\.cn/i.test(String(source?.bookSourceUrl || tocUrl || ''))) {
        const rows = Array.isArray(parsed.data) ? parsed.data : [];
        return rows.map((item, offset) => ({
            index: startIndex + offset,
            name: cleanText(item.title || item.name || `第 ${startIndex + offset + 1} 集`),
            url: item.soundid ? resolveUrl(`/api/ximalaya/maoer_app.php?soundid=${item.soundid}`, tocUrl) : '',
            updateTime: cleanText(item.intro || ''),
            isVip: false,
            isVolume: false,
        })).filter(item => item.url);
    }
    return [];
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

async function fetchPayloadContent(source, rule, startUrl, context, maxPages = 8) {
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

async function fallbackAudioSearchList(source, raw, keyword, page) {
    if (!isMissevanSource(source) && !isHhlMaoerSource(source)) return [];
    const items = [];
    const parsed = tryJson(raw);
    if (isHhlMaoerSource(source)) {
        if (Array.isArray(parsed?.data)) return parsed.data;
        try {
            const url = `https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(keyword)}&page=${encodeURIComponent(page || 1)}`;
            const searchRaw = await fetchUrl(url, { headers: parseSourceHeader(source.header) }, config.requestTimeout);
            const searchParsed = tryJson(searchRaw);
            const rows = Array.isArray(searchParsed?.info?.Datas) ? searchParsed.info.Datas : [];
            return rows.map(item => ({
                ...item,
                albumId: item.id || item.albumId,
                title: item.name || item.title,
                Nickname: item.author || item.Nickname || item.catalog_name || '',
                intro: item.abstract || item.intro || '',
                cover: item.cover || item.coverUrl || '',
            })).filter(item => item.albumId);
        } catch {
            return [];
        }
    }
    if (Array.isArray(parsed?.info?.Datas)) items.push(...parsed.info.Datas);
    try {
        const url = `https://www.missevan.com/sound/getsearch?s=${encodeURIComponent(keyword)}&type=3&page_size=10&p=${encodeURIComponent(page || 1)}`;
        const soundRaw = await fetchUrl(url, { headers: parseSourceHeader(source.header) }, config.requestTimeout);
        const soundParsed = tryJson(soundRaw);
        if (Array.isArray(soundParsed?.info?.Datas)) items.push(...soundParsed.info.Datas);
    } catch {}
    return items;
}

function isMissevanSource(source) {
    return /missevan\.com/i.test(String(source?.bookSourceUrl || source?.searchUrl || ''));
}

function isHhlMaoerSource(source) {
    return /hhlqilongzhu\.cn/i.test(`${source?.bookSourceUrl || ''} ${source?.searchUrl || ''}`);
}

function isFiveSingSource(source) {
    return /5sing\.kugou\.com/i.test(`${source?.bookSourceUrl || ''} ${source?.searchUrl || ''}`);
}

function isLizhiSource(source) {
    return /lizhi\.fm/i.test(`${source?.bookSourceUrl || ''} ${source?.searchUrl || ''}`);
}

function isFuciyuanSource(source) {
    return /fuciyuanbang\.ciyuans\.com|fuciyuan7\.com/i.test(`${source?.bookSourceUrl || ''} ${source?.searchUrl || ''}`);
}

function isMiguSource(source) {
    return /app\.u\.nf\.migu\.cn|migu\.cn|MORIN/i.test(`${source?.bookSourceUrl || ''} ${source?.searchUrl || ''} ${source?.jsLib || ''}`);
}

function repairAudioTocUrl(tocUrl, itemUrl) {
    const text = String(tocUrl || '');
    const item = String(itemUrl || '');
    if (/missevan\.com\/dramaapi\/getdrama\?drama_id=$/i.test(text)) {
        const id = (item.match(/drama_id=(\d+)/i) || item.match(/\/(?:m?drama\/)?drama\/(\d+)/i) || [])[1];
        return id ? text + id : text;
    }
    if (!text && /missevan\.com\/dramaapi\/getdrama\?drama_id=\d+/i.test(item)) return item;
    if (!text && /missevan\.com\/sound\/getsound\?soundid=\d+/i.test(item)) return item;
    return text;
}

function fallbackMusicEntries(source, raw, tocUrl, rawContext, startIndex = 0) {
    const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
    if (isFiveSingSource(source)) {
        return [{
            index: startIndex,
            name: cleanText(context.songName || context.name || extractTitle(raw) || '音频'),
            url: tocUrl,
            updateTime: cleanText(context.singer || context.nickName || ''),
            isVip: false,
            isVolume: false,
        }].filter(item => item.url);
    }
    if (isFuciyuanSource(source)) {
        const url = context.url || context.music || context.mp3 || '';
        return [{
            index: startIndex,
            name: cleanText(context.title || context.name || '音频'),
            url,
            updateTime: cleanText(context.artist || context.uname || ''),
            isVip: false,
            isVolume: false,
        }].filter(item => /\.(mp3|m4a|aac|flac|wav|ogg)(\?|$)/i.test(item.url));
    }
    if (isLizhiSource(source)) {
        const parsed = tryJson(raw);
        const voice = parsed?.data?.userVoice || parsed?.userVoice || parsed?.data || parsed || {};
        const info = voice.voiceInfo || {};
        const play = voice.voicePlayProperty || {};
        const trackUrl = play.trackUrl || voice.trackUrl || '';
        return [{
            index: startIndex,
            name: cleanText(info.name || context?.voiceInfo?.name || context.name || '音频'),
            url: trackUrl || tocUrl,
            updateTime: cleanText(info.lableName || ''),
            isVip: false,
            isVolume: false,
        }].filter(item => item.url);
    }
    if (isMiguSource(source)) {
        const url = context.musicInfo || tocUrl;
        return [{
            index: startIndex,
            name: cleanText(context.musicName || context.name || '音频'),
            url: String(url || '').split(',{')[0],
            updateTime: cleanText(context.musicAuthor || context.author || context.musicSort || ''),
            isVip: false,
            isVolume: false,
        }].filter(item => item.url);
    }
    return [];
}

async function fallbackVideoEntries(source, raw, tocUrl, entries, startIndex = 0) {
    const cmsEntries = parseCmsVideoEntries(raw, startIndex);
    if (cmsEntries.length) return await prioritizeReachableVideoEntries(cmsEntries);
    if (!/ikanbot\.com/i.test(String(source?.bookSourceUrl || tocUrl || ''))) return [];
    const ikanbotEntries = await fetchIkanbotEntries(raw, tocUrl, startIndex);
    if (ikanbotEntries.length) return ikanbotEntries;
    const selectable = (entries || []).filter(item => item && item.url);
    const navOnly = selectable.length > 0 && selectable.every(item => /\/(?:billboard|kanlist|history)(?:\.html|\/|$)/i.test(String(item.url || '')) || /^https?:\/\/v\.ikanbot\.com\/?$/i.test(String(item.url || '')));
    if (!navOnly) return [];
    const title = cleanText(extractMeta(raw, 'title') || extractTitle(raw) || '播放');
    return [{
        index: startIndex,
        name: title.replace(/[-_]?免费在线观看.*$/i, '') || '播放',
        url: tocUrl,
        updateTime: '默认线路',
        isVip: false,
        isVolume: false,
    }];
}

function isCmsVideoSource(entry, source, url = '') {
    return (entry?.category === 'video' || Number(source?.bookSourceType) === 4)
        && /api\.php\/provide\/vod|\/provide\/vod/i.test(String(source?.bookSourceUrl || url || ''));
}

async function fetchCmsVideoEntries(entry, source, tocUrl, startIndex = 0) {
    if (!isCmsVideoSource(entry, source, tocUrl)) return [];
    try {
        const raw = await fetchUrl(tocUrl, {
            headers: parseSourceHeader(source.header),
        }, config.requestTimeout);
        const entries = parseCmsVideoEntries(raw, startIndex);
        return entries.length ? await prioritizeReachableVideoEntries(entries) : [];
    } catch {
        return [];
    }
}

function parseCmsVideoEntries(raw, startIndex = 0) {
    const parsed = raw && typeof raw === 'object' ? raw : tryJson(raw);
    const item = Array.isArray(parsed?.list) ? parsed.list[0] : null;
    const playText = String(item?.vod_play_url || '');
    if (!playText) return [];
    const lines = String(item?.vod_play_from || '').split('$$$');
    const groups = playText.split('$$$');
    const out = [];
    for (let i = 0; i < groups.length; i++) {
        const line = cleanText(lines[i] || `线路 ${i + 1}`);
        for (const part of groups[i].split('#')) {
            const idx = part.indexOf('$');
            if (idx <= 0) continue;
            const name = cleanText(part.slice(0, idx)) || `第 ${out.length + 1} 集`;
            const url = part.slice(idx + 1).trim().replace(/^"+|"+$/g, '');
            if (!/^https?:\/\//i.test(url)) continue;
            out.push({
                index: startIndex + out.length,
                name,
                url,
                updateTime: line,
                line,
                isVip: false,
                isVolume: false,
            });
        }
    }
    return out;
}

async function fetchIkanbotEntries(raw, tocUrl, startIndex = 0) {
    const pageUrl = String(tocUrl || '').split(',{')[0].trim();
    const idFromUrl = (pageUrl.match(/\/play\/(\d+)/i) || [])[1];
    let html = String(raw || '');
    if (!html || !/current_id|e_token/i.test(html)) {
        try {
            html = await fetchUrl(pageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36',
                    Referer: 'https://www.aikanbot.com',
                    'x-requested-with': 'com.UCMobile',
                },
            }, config.requestTimeout);
        } catch {
            html = '';
        }
    }
    const currentId = (html.match(/id=["']current_id["'][^>]*value=["']([^"']+)/i) || [])[1] || idFromUrl;
    const tokenSource = (html.match(/id=["']e_token["'][^>]*value=["']([^"']+)/i) || [])[1];
    const mtype = (html.match(/id=["']mtype["'][^>]*value=["']([^"']+)/i) || [])[1] || '1';
    if (!currentId || !tokenSource) return [];
    const token = makeIkanbotToken(currentId, tokenSource);
    if (!token) return [];
    try {
        const apiUrl = `https://v.ikanbot.com/api/getResN?videoId=${encodeURIComponent(currentId)}&mtype=${encodeURIComponent(mtype)}&token=${encodeURIComponent(token)}`;
        const rawApi = await fetchUrl(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36',
                Referer: pageUrl || 'https://v.ikanbot.com/',
                'x-requested-with': 'com.UCMobile',
            },
        }, config.requestTimeout);
        const parsed = tryJson(rawApi);
        const rows = Array.isArray(parsed?.data?.list) ? parsed.data.list : [];
        const out = [];
        for (const row of rows) {
            const list = parseIkanbotResData(row.resData);
            for (const item of list) {
                if (!item.url) continue;
                out.push({
                    index: startIndex + out.length,
                    name: cleanText(item.name || item.flag || `线路 ${out.length + 1}`),
                    url: item.url,
                    updateTime: cleanText(item.flag || `线路 ${out.length + 1}`),
                    isVip: false,
                    isVolume: false,
                });
            }
        }
        return await prioritizeReachableVideoEntries(out);
    } catch {
        return [];
    }
}

async function prioritizeReachableVideoEntries(entries) {
    const direct = (entries || []).filter(item => item && /\.(?:m3u8|mp4|webm|mov)(?:[?#].*)?$/i.test(item.url));
    if (!direct.length) return entries || [];
    const probeTargets = direct.slice(0, 12);
    const results = await Promise.all(probeTargets.map(async item => ({
        item,
        probe: await probeDirectMediaUrl(item.url, { Referer: 'https://v.ikanbot.com/' }, 6000),
    })));
    const byUrl = new Map(results.map(row => [row.item.url, row.probe]));
    const ranked = (entries || []).map(item => {
        const probe = byUrl.get(item.url);
        if (!probe) return { ...item };
        return {
            ...item,
            playable: probe.ok,
            updateTime: probe.ok ? `${item.updateTime || '线路'} · 可播放` : `${item.updateTime || '线路'} · 不可达`,
        };
    });
    if (!results.some(row => row.probe.ok)) return ranked;
    return ranked
        .sort((a, b) => Number(b.playable === true) - Number(a.playable === true))
        .map((item, index) => ({ ...item, index }));
}

function makeIkanbotToken(currentId, tokenSource) {
    let token = String(tokenSource || '');
    const tail = String(currentId || '').slice(-4);
    const parts = [];
    for (const ch of tail) {
        const n = parseInt(ch, 10);
        if (!Number.isFinite(n)) return '';
        const start = n % 3 + 1;
        parts.push(token.substring(start, start + 8));
        token = token.substring(start + 8);
    }
    return parts.join('');
}

function parseIkanbotResData(value) {
    let rows = [];
    try {
        rows = JSON.parse(String(value || '[]'));
    } catch {
        rows = [];
    }
    const out = [];
    for (const row of rows) {
        const flag = row.flag || '';
        const chunks = String(row.url || '').split('#').filter(Boolean);
        for (const chunk of chunks) {
            const parts = chunk.split('$');
            const name = parts.length > 1 ? parts[0] : '';
            const url = parts.length > 1 ? parts[1] : parts[0];
            if (/^https?:\/\//i.test(url)) out.push({ name, url, flag });
        }
    }
    return out;
}

async function fallbackAudioPayloadUrl(source, raw, entryUrl) {
    const parsed = tryJson(raw);
    if (isFiveSingSource(source)) {
        const fiveSingUrl = await fetchFiveSingAudioUrl(entryUrl);
        if (fiveSingUrl) return fiveSingUrl;
    }
    if (isFuciyuanSource(source) && /\.(mp3|m4a|aac|flac|wav|ogg)(\?|$)/i.test(String(entryUrl || ''))) {
        return String(entryUrl || '');
    }
    if (isMiguSource(source)) {
        const miguUrl = await fetchMiguAudioUrl(entryUrl);
        if (miguUrl) return miguUrl;
    }
    if (!parsed || typeof parsed !== 'object') return '';
    if (isLizhiSource(source)) {
        return parsed?.data?.userVoice?.voicePlayProperty?.trackUrl
            || parsed?.userVoice?.voicePlayProperty?.trackUrl
            || parsed?.data?.voicePlayProperty?.trackUrl
            || parsed?.voicePlayProperty?.trackUrl
            || '';
    }
    if (isMiguSource(source)) {
        return parsed?.data?.url || parsed?.url || '';
    }
    if (isMissevanSource(source) || /missevan\.com/i.test(String(entryUrl || ''))) {
        const sound = parsed?.info?.sound || {};
        return sound.soundurl_128
            || sound.soundurl
            || sound.dash?.audio?.find(item => item?.base_url)?.base_url
            || '';
    }
    if (isHhlMaoerSource(source) || /hhlqilongzhu\.cn/i.test(String(entryUrl || ''))) {
        return parsed.url || parsed.data?.url || '';
    }
    return '';
}

function fallbackAudioItemUrl(source, item, baseUrl) {
    if (isFuciyuanSource(source) && item && typeof item === 'object' && item.url) {
        return resolveUrl(item.url, baseUrl);
    }
    if (isMissevanSource(source) && item && typeof item === 'object') {
        const id = item.id || item.sound_id || item?.info?.sound?.id;
        if (!id) return '';
        if (item.soundstr || item.index_name === 'm_sound' || item?.info?.sound) {
            return `https://www.missevan.com/sound/getsound?soundid=${id}`;
        }
        return `https://www.missevan.com/dramaapi/getdrama?drama_id=${id}`;
    }
    if (isHhlMaoerSource(source) && item && typeof item === 'object') {
        if (item.albumId) return resolveUrl(`/api/ximalaya/maoer_app.php?albumId=${item.albumId}`, baseUrl);
        if (item.soundid) return resolveUrl(`/api/ximalaya/maoer_app.php?soundid=${item.soundid}`, baseUrl);
    }
    return '';
}

async function fetchMiguAudioUrl(entryUrl) {
    const url = String(entryUrl || '').split(',{')[0].trim();
    if (!/^https?:\/\/app\.u\.nf\.migu\.cn\//i.test(url)) return '';
    try {
        const raw = await fetchUrl(url, {
            headers: {
                'User-Agent': 'stagefright/1.2 (Linux;Android 15)',
                channel: '014000D',
            },
        }, config.requestTimeout);
        const parsed = tryJson(raw);
        return parsed?.data?.url || parsed?.url || '';
    } catch {
        return '';
    }
}

async function fetchFiveSingAudioUrl(entryUrl) {
    const match = String(entryUrl || '').match(/5sing\.kugou\.com\/([^/]+)\/(\d+)\.html/i);
    if (!match) return '';
    const songtype = match[1];
    const songid = match[2];
    const params = {
        appid: 3146,
        clienttime: Math.ceil(Date.now() / 1000),
        clientver: 610850,
        dfid: '-',
        from: 'com.sing.client.player',
        mid: 114514,
        songfields: 'ID,SN,SK,SW,SS,ST,SI,CT,M,S,ZQ,WO,ZC,HY,YG,CK,D,RQ,DD,E,R,RC,SG,C,CS,LV,LG,SY,UID,PT,SCSR,SC,KM5',
        songid,
        songtype,
        token: '',
        userfields: 'ID,NN,I,YCRQ,FCRQ',
        uuid: '-',
    };
    const keys = Object.keys(params).sort();
    const signText = keys.map(key => `${key}=${params[key]}`).join('');
    const signature = crypto.createHash('md5')
        .update(`UqgPMZpjgRZQ7s8JAuUIP5DQdo5O5NB${signText}UqgPMZpjgRZQ7s8JAuUIP5DQdo5O5NB`)
        .digest('hex');
    const query = keys.map(key => `${key}=${params[key]}`.replace(/,/g, '%2c')).join('&') + `&signature=${signature}`;
    try {
        const raw = await fetchUrl(`https://5sapi.kugou.com/song/getSongUrl?${query}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.73 Safari/537.36',
                Referer: entryUrl,
            },
        }, config.requestTimeout);
        const data = tryJson(raw)?.data || {};
        return data.squrl || data.squrl_backup || data.hqurl || data.hqurl_backup || data.lqurl || data.lqurl_backup || '';
    } catch {
        return '';
    }
}

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
            const report = {
                index,
                sourceId: entry.id,
                name: entry.name,
                category: entry.category,
                status: 'pending',
                count: 0,
                error: '',
            };
            sourceReports.push(report);
            try {
                const loaded = loadSource(entry.id);
                if (!loaded || !loaded.source.searchUrl) {
                    report.status = 'skipped';
                    report.error = 'missing_search_url';
                    return;
                }
                const { source } = loaded;
                const adapter = createAdapter(entry, source);
                const context = createContext(source, { key: keyword, page: 1, timeout: config.jsRuntimeTimeout });
                const searchTarget = buildUrl(source.searchUrl, context);
                if (!/^https?:\/\//i.test(searchTarget.url) || searchTarget.url.includes('{{')) {
                    report.status = 'skipped';
                    report.error = 'invalid_search_url';
                    return;
                }
                const raw = await fetchUrl(searchTarget.url, {
                    headers: {
                        ...parseSourceHeader(source.header),
                        ...searchTarget.headers,
                    },
                    method: searchTarget.method,
                    body: searchTarget.body,
                }, searchTimeout);
                if (!raw) {
                    report.status = 'failed';
                    report.error = 'empty_response';
                    return;
                }
                const rule = source.ruleSearch || {};
                const ruleContext = { ...context, result: raw, baseUrl: searchTarget.url };
                let list = runRuleList(raw, rule.bookList, ruleContext).filter(item => !(typeof item === 'string' && item === raw));
                if (!list.length && isAudioLikeCategory(entry.category)) {
                    list = await fallbackAudioSearchList(source, raw, keyword, context.page || 1);
                }
                if (!list.length) {
                    const emptyError = classifyEmptySearch(raw);
                    report.status = 'failed';
                    report.error = '规则未匹配';
                    errors.push({ sourceId: entry.id, name: entry.name, error: '规则未匹配' });
                    report.error = emptyError;
                    if (errors.length) errors[errors.length - 1].error = emptyError;
                    return;
                }
                const items = list.slice(0, 30).map(item => {
                    const itemContext = { ...ruleContext, result: item };
                    const rawUrl = runRule(item, rule.bookUrl, itemContext);
                    let itemUrl = buildUrl(String(rawUrl || ''), {
                        ...itemContext,
                        baseUrl: searchTarget.url || cleanSourceUrl(source.bookSourceUrl),
                    }).url;
                    if (isAudioLikeCategory(entry.category) && (isBadValue(itemUrl, rule.bookUrl) || (entry.category === 'music' && isFuciyuanSource(source)))) {
                        itemUrl = fallbackAudioItemUrl(source, item, searchTarget.url || cleanSourceUrl(source.bookSourceUrl));
                    }
                    const normalized = adapter.normalizeItem({
                        sourceId: entry.id,
                        sourceName: entry.name,
                        category: entry.category,
                        type: categoryProfile(entry.category).payloadKind,
                        name: cleanText(runRule(item, rule.name, itemContext)),
                        author: cleanText(runRule(item, rule.author, itemContext)),
                        itemUrl,
                        coverUrl: normalizeCoverForSource(source, runRule(item, rule.coverUrl, itemContext), searchTarget.url),
                        intro: cleanText(runRule(item, rule.intro, itemContext)).slice(0, 240),
                        kind: cleanText(runRule(item, rule.kind, itemContext)),
                        lastChapter: cleanText(runRule(item, rule.lastChapter, itemContext)),
                        raw: Buffer.from(stringifyForRaw(item)).toString('base64'),
                        adapterTags: adapter.tags,
                        warnings: adapter.warnings,
                    });
                    return normalized;
                }).filter(item => adapter.validateSearchItem(item).ok);
                const kw = String(keyword).toLowerCase();
                const matched = items.filter(item => item.name.toLowerCase().includes(kw) || String(item.author || '').toLowerCase().includes(kw)).slice(0, perSourceLimit);
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
        const decodedUrl = decodeURIComponent(tocUrl);
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
                adapter: {
                    tags: adapter.tags,
                    warnings: adapter.warnings,
                    capabilities: adapter.capabilities,
                },
                nextTocUrl: '',
                nextTocUrls: [],
                session: encodeSession({ variables: sessionData.variables || {}, rawContext: sessionData.rawContext || null }),
            });
        }

        const maxPages = Math.min(Math.max(numericRequestParam(req, 'maxPages', adapter.maxEntryPages || 20) || 20, 1), 160);
        const visited = new Set();
        const queue = [decodedUrl];
        const pages = [];
        const failedPages = [];
        const queued = new Set(queue);
        const startedAt = Date.now();
        const budgetMs = Math.min(Math.max(numericRequestParam(req, 'budgetMs', 45000) || 45000, 8000), 90000);
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
            if (!page.html && currentUrl === decodedUrl && !pages.length) return res.status(404).json({ error: 'Unable to fetch entries' });
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
        if (entry.category === 'video' && !entries.some(item => item.url)) {
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
        res.json({
            sourceId,
            category: entry.category,
            profile: categoryProfile(entry.category),
            totalEntries: entries.length,
            entries,
            fetchedTocPages: visited.size,
            failedTocPages: failedPages.length,
            failedPages: failedPages.slice(0, 10),
            partial: failedPages.length > 0,
            adapter: {
                tags: adapter.tags,
                warnings: adapter.warnings,
                capabilities: adapter.capabilities,
            },
            nextTocUrl: remainingTocUrls[0] || nextTocUrls.find(url => !visited.has(url)) || '',
            nextTocUrls: remainingTocUrls.length ? remainingTocUrls : nextTocUrls.filter(url => !visited.has(url)),
            session: encodeSession({ variables, rawContext: sessionData.rawContext || null }),
        });
    } catch (err) {
        console.error('[Content] Entries error:', err);
        res.status(500).json({ error: '列表加载失败: ' + err.message });
    }
});

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
        const decodedUrl = decodeURIComponent(entryUrl);
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
            if (!mediaProbe.ok) {
                response.validation = mediaProbe;
            }
            response.mediaProbe = mediaProbe;
        }
        response.adapter = {
            tags: adapter.tags,
            warnings: adapter.warnings,
            capabilities: adapter.capabilities,
        };
        res.json(response);
    } catch (err) {
        console.error('[Content] Payload error:', err);
        res.status(500).json({ error: '内容加载失败: ' + err.message });
    }
});

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
