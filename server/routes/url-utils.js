/**
 * URL handling and normalization utilities for content routes.
 */

const cheerio = require('cheerio');
const {
    buildUrl,
    cleanSourceUrl,
    createContext,
    resolveUrl,
    runRule,
} = require('../engine/legadoEngine');
const { isBadValue } = require('./utils');
const config = require('../config');

function safeHeaderUrl(value) {
    const text = String(value || '').split(',{')[0].trim();
    if (!/^https?:\/\//i.test(text)) return '';
    try {
        return new URL(text).href;
    } catch {
        return '';
    }
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

function valueFromSearchContext(context, source, field) {
    if (!context) return '';
    const rule = (source.ruleSearch || {})[field];
    if (!rule) return '';
    const engineContext = createContext(source, { result: context, timeout: config.jsRuntimeTimeout });
    const value = runRule(context, rule, engineContext);
    return isBadValue(value, rule) ? '' : value;
}

module.exports = {
    safeHeaderUrl,
    normalizeUrlMaybe,
    isIkanbotSource,
    isLiulianVideoSource,
    normalizeIkanbotCoverUrl,
    normalizeCoverForSource,
    extractLiulianVideoUrl,
    resolveRuleUrl,
    resolveNextUrls,
    sameUrl,
    extractUrls,
    normalizePossibleUrls,
    valueFromSearchContext,
};
