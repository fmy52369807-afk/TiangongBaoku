/**
 * General-purpose utility functions extracted from content routes.
 */

function requestParam(req, key, fallback = '') {
    if (req.body && req.body[key] !== undefined) return req.body[key];
    if (req.query && req.query[key] !== undefined) return req.query[key];
    return fallback;
}

function numericRequestParam(req, key, fallback) {
    const value = requestParam(req, key, fallback);
    return parseInt(value, 10);
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
    if (/站点已暂停|暂停|site\s+has\s+been\s+suspended/i.test(text)) return 'site_paused';
    const json = parseJsonMaybe(text);
    if (json && typeof json === 'object') {
        const body = JSON.stringify(json);
        if (/搜索结果为空|no\s*result|not\s*found/i.test(body)) return 'no_search_result';
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
    if (/^\[object\s+Object\]$/i.test(val)) return true;
    if (/^(undefined|null|NaN)$/i.test(val)) return true;
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

async function mapWithConcurrency(items, limit, mapper) {
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
    let nextIndex = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
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

module.exports = {
    requestParam,
    numericRequestParam,
    parseEmbeddedHeaders,
    parseSourceHeader,
    parseLooseHeaderObject,
    isAudioLikeCategory,
    unique,
    cleanText,
    applyReplaceRegex,
    classifyEmptySearch,
    parseJsonMaybe,
    decodeHtml,
    isBadValue,
    normalizeNavText,
    isNavigationText,
    isBadDetailField,
    decodeRawContext,
    encodeSession,
    decodeSession,
    tryJson,
    stringifyForRaw,
    valueFromContext,
    syncVariables,
    mapWithConcurrency,
    extractMeta,
    extractTitle,
};
