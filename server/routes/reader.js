/**
 * Reader routes - fetch book info, table of contents, and chapter content.
 */
const express = require('express');
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

const router = express.Router();

function loadSource(sourceId) {
    const indexPath = path.join(config.sourcesPath, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.find(e => e.id === sourceId);
    if (!entry) return null;

    const fullPath = path.join(config.sourcesPath, entry.file);
    const fileData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    return { entry, source: fileData[entry.index] };
}

function extractMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp('<meta[^>]+name=["\']' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
        new RegExp('<meta[^>]+property=["\']og:novel:' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
        new RegExp('<meta[^>]+property=["\'](?:og:)?' + escaped + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'),
        new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\'](?:og:novel:|og:)?' + escaped + '["\']', 'i'),
    ];

    for (const pattern of patterns) {
        const match = String(html || '').match(pattern);
        if (match && match[1]) return decodeHtml(match[1].trim());
    }
    return null;
}

function extractTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) return null;
    return decodeHtml(match[1]).replace(/\s*[-_|].*$/, '').trim();
}

function isBadValue(value, rule) {
    const val = String(value || '').trim();
    if (!val) return true;
    if (rule && val === String(rule).trim()) return true;
    if (val.startsWith('[JS_RULE]')) return true;
    if (val.length > 5000) return true;
    if (/^<!doctype|^<html/i.test(val)) return true;
    if (val.includes('{{') || val.includes('}}')) return true;
    if (val.includes('@content') || val.includes('@text')) return true;
    if (/^\$\{.*\}$/.test(val)) return true;
    return false;
}

function cleanText(value) {
    return decodeHtml(String(value || ''))
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[（(]本章未完[^）)]*[）)]/g, '')
        .replace(/[（(]本章完[）)]/g, '')
        .replace(/本章未完[，,、\s]*(请)?(点击)?(下一页|翻页|继续阅读).*$/gm, '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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

function decodeRawContext(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(Buffer.from(String(raw), 'base64').toString('utf-8'));
    } catch {
        return null;
    }
}

function tryParseBookData(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function mergeContexts(...values) {
    const merged = {};
    for (const value of values) {
        const parsed = typeof value === 'string' ? tryParseBookData(value) : value;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
        }
    }
    return Object.keys(merged).length ? merged : values.find(Boolean);
}

function valueFromContext(context, keys) {
    if (!context || typeof context !== 'object') return '';
    for (const key of keys) {
        if (context[key] !== undefined && context[key] !== null && String(context[key]).trim()) {
            return context[key];
        }
    }
    return '';
}

function valueFromSearchContext(context, source, field) {
    if (!context) return '';
    const rule = (source.ruleSearch || {})[field];
    if (!rule) return '';
    const engineContext = createContext(source, { result: context, timeout: config.jsRuntimeTimeout });
    const value = runRule(context, rule, engineContext);
    return isBadValue(value, rule) ? '' : value;
}

function fallbackChapters(html, baseUrl) {
    const $ = cheerio.load(String(html || ''));
    const seen = new Set();
    const chapters = [];

    const selectors = [
        '.chapter-list a[href]',
        '.catalog a[href]',
        '#catalog a[href]',
        '#chapter a[href]',
        '.listmain a[href]',
        'a[href*="/chapter/"]',
        'a[href*="/book/"][href$=".html"]',
        'a[href$=".html"]',
    ];

    for (const selector of selectors) {
        $(selector).each((_, el) => {
            const href = $(el).attr('href') || '';
            const title = cleanText($(el).clone().children('small,span.chapter-update-time').remove().end().text());
            const url = resolveUrl(href, baseUrl);

            if (!href || !title || seen.has(url)) return;
            if (url === baseUrl) return;
            if (title.length > 120) return;

            seen.add(url);
            chapters.push({
                index: chapters.length,
                name: title,
                url,
                updateTime: cleanText($(el).find('small,.chapter-update-time').text()),
                isVip: false,
            });
        });

        if (chapters.length) break;
    }

    return chapters;
}

function fallbackContent(html) {
    const $ = cheerio.load(String(html || ''));
    const selectors = [
        '#readerArticle',
        '#content',
        '#txt',
        'article',
        '.chapter-content',
        '.read-content',
        '.article-content',
        '.content',
        '.article',
        '.con',
    ];

    for (const selector of selectors) {
        const el = $(selector).first();
        el.find('script,style,iframe,ins,.ads,.ad').remove();
        const text = cleanText(el.html() || el.text());
        if (text.length > 50) return text;
    }

    return '';
}

function hasIncompleteMarker(text) {
    return /本章未完|未完待续|下一页继续阅读|点击下一页|请翻页|继续阅读后面精彩内容/i.test(String(text || ''));
}

function normalizeNextUrl(value, baseUrl, currentUrl) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^(javascript:|#|void\b)/i.test(text)) return '';
    const built = buildUrl(text, { baseUrl });
    const url = built.url || resolveUrl(text, baseUrl);
    if (!/^https?:\/\//i.test(url)) return '';
    if (url === currentUrl) return '';
    return url;
}

function fallbackNextContentUrl(html, baseUrl, currentUrl) {
    const $ = cheerio.load(String(html || ''));
    const candidates = [
        'a[rel=next]',
        '#next_url',
        '.next a',
        '.pagebar a',
        '.prenext a',
        'a:contains("下一页")',
        'a:contains("下一章")',
        'a:contains("下一")',
    ];

    for (const selector of candidates) {
        const links = $(selector).toArray();
        for (const el of links) {
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

async function fetchChapterPage(source, rule, url, seen, pageIndex) {
    const context = createContext(source, {
        baseUrl: url,
        timeout: config.jsRuntimeTimeout,
        chapter: { index: pageIndex },
    });
    const html = await fetchSourceUrl(url, context, { timeout: config.requestTimeout });
    if (!html) return { html: '', content: '', nextUrl: '' };

    let content = runRule(html, rule.content, { ...context, result: html, baseUrl: url }) || '';
    if (isBadValue(content, rule.content)) {
        content = fallbackContent(html);
    }

    let nextUrl = '';
    if (rule.nextContentUrl) {
        const rawNext = runRule(html, rule.nextContentUrl, { ...context, result: html, baseUrl: url });
        if (Array.isArray(rawNext)) {
            nextUrl = rawNext.map(item => normalizeNextUrl(item, url, url)).find(Boolean) || '';
        } else {
            nextUrl = normalizeNextUrl(rawNext, url, url);
        }
    }
    if (!nextUrl && hasIncompleteMarker(content)) {
        nextUrl = fallbackNextContentUrl(html, url, url);
    }
    if (seen.has(nextUrl)) nextUrl = '';

    return { html, content, nextUrl };
}

async function fetchFullChapter(source, rule, startUrl) {
    const seen = new Set();
    const parts = [];
    let rawLength = 0;
    let nextUrl = startUrl;
    const maxPages = Number(process.env.MAX_CHAPTER_PAGES || 10);

    for (let pageIndex = 0; nextUrl && pageIndex < maxPages; pageIndex++) {
        seen.add(nextUrl);
        const page = await fetchChapterPage(source, rule, nextUrl, seen, pageIndex);
        rawLength += String(page.html || '').length;
        if (page.content) parts.push(page.content);
        nextUrl = page.nextUrl;
    }

    return {
        content: parts.join('\n\n'),
        rawLength,
        pageCount: seen.size,
        truncatedByPageLimit: !!nextUrl,
    };
}

function resolveRuleUrl(url, source, baseUrl, contexts) {
    const ruleInput = contexts && contexts.ruleInput !== undefined ? contexts.ruleInput : contexts;
    const templateInput = contexts && contexts.templateInput !== undefined ? contexts.templateInput : ruleInput;
    const text = String(url || '').trim();
    let raw = text;
    if (!isTemplateUrlRule(text)) {
        raw = runRule(ruleInput, text, {
            source,
            sourceUrl: cleanSourceUrl(source && source.bookSourceUrl),
            baseUrl,
            result: ruleInput,
            timeout: config.jsRuntimeTimeout,
        });
        if (isBadValue(raw, text)) raw = text;
    }

    const built = buildUrl(raw, {
        source,
        sourceUrl: cleanSourceUrl(source && source.bookSourceUrl),
        baseUrl,
        result: templateInput,
        timeout: config.jsRuntimeTimeout,
    });
    if (built.url.includes('{{') || built.url.includes('}}') || built.url.includes('@js:')) return '';
    return built.url;
}

function isTemplateUrlRule(rule) {
    const text = String(rule || '').trim();
    return text.startsWith('@js:') || text.includes('{{') || /^https?:\/\//i.test(text) || text.startsWith('/');
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

router.get('/book', async (req, res) => {
    try {
        const { sourceId, bookUrl, raw } = req.query;
        if (!sourceId || !bookUrl) {
            return res.status(400).json({ error: 'sourceId and bookUrl are required' });
        }

        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });

        const { source } = loaded;
        const decodedUrl = decodeURIComponent(bookUrl);
        const rawContext = decodeRawContext(raw);
        const context = createContext(source, {
            baseUrl: decodedUrl,
            result: rawContext,
            timeout: config.jsRuntimeTimeout,
        });
        const html = await fetchSourceUrl(decodedUrl, context, { timeout: config.requestTimeout });
        if (!html) return res.status(404).json({ error: 'Unable to fetch book info' });

        const rule = source.ruleBookInfo || {};
        let bookData = rule.init ? runRule(html, rule.init, { ...context, result: html, baseUrl: decodedUrl }) : html;
        if (isBadValue(bookData, rule.init)) bookData = html;
        const parsedBookData = typeof bookData === 'string' ? tryParseBookData(bookData) : bookData;
        const templateContext = mergeContexts(rawContext, parsedBookData, bookData);
        const dataContext = { ...context, result: bookData, baseUrl: decodedUrl };

        let name = runRule(bookData, rule.name, dataContext);
        let author = runRule(bookData, rule.author, dataContext);
        let coverUrl = runRule(bookData, rule.coverUrl, dataContext);
        let intro = runRule(bookData, rule.intro, dataContext);
        let kind = runRule(bookData, rule.kind, dataContext);
        let lastChapter = runRule(bookData, rule.lastChapter, dataContext);
        let wordCount = runRule(bookData, rule.wordCount, dataContext);

        if (isBadValue(name, rule.name)) name = extractMeta(html, 'book_name') || extractMeta(html, 'title') || valueFromContext(rawContext, ['bookName', 'book_name', 'novelName', 'name', 'title', 'series_title']) || valueFromSearchContext(rawContext, source, 'name') || extractTitle(html) || '未知书名';
        if (isBadValue(author, rule.author)) author = extractMeta(html, 'author') || valueFromContext(rawContext, ['author', 'authorName', 'original_author', 'copyright']) || valueFromSearchContext(rawContext, source, 'author') || '未知作者';
        if (isBadValue(coverUrl, rule.coverUrl)) coverUrl = extractMeta(html, 'image') || valueFromContext(rawContext, ['cover', 'coverUrl', 'pic', 'picUrl', 'thumb_url']) || valueFromSearchContext(rawContext, source, 'coverUrl') || '';
        if (isBadValue(intro, rule.intro) || cleanText(intro).length < 30) intro = extractMeta(html, 'description') || valueFromContext(rawContext, ['intro', 'summary', 'description', 'bookIntro', 'abstract']) || valueFromSearchContext(rawContext, source, 'intro') || '';
        if (isBadValue(kind, rule.kind)) kind = extractMeta(html, 'category') || '';
        if (isBadValue(lastChapter, rule.lastChapter)) lastChapter = extractMeta(html, 'latest_chapter_name') || '';
        if (isBadValue(wordCount, rule.wordCount)) wordCount = '';

        let tocUrl = resolveRuleUrl(rule.tocUrl, source, decodedUrl, {
            ruleInput: bookData,
            templateInput: templateContext,
        });
        if (!tocUrl) {
            const readUrl = extractMeta(html, 'read_url') || extractMeta(html, 'og:novel:read_url');
            if (readUrl) tocUrl = resolveUrl(readUrl, decodedUrl);
        }
        if (!tocUrl && source.ruleToc && source.ruleToc.chapterList) {
            tocUrl = decodedUrl;
        }

        res.json({
            sourceId,
            name: cleanText(name),
            author: cleanText(author),
            coverUrl: resolveUrl(String(coverUrl || ''), decodedUrl),
            intro: cleanText(intro),
            kind: cleanText(kind),
            lastChapter: cleanText(lastChapter),
            wordCount: cleanText(wordCount),
            tocUrl,
        });
    } catch (err) {
        console.error('[Reader] Book error:', err);
        res.status(500).json({ error: 'Failed to fetch book info: ' + err.message });
    }
});

router.get('/toc', async (req, res) => {
    try {
        const { sourceId, tocUrl } = req.query;
        if (!sourceId || !tocUrl) {
            return res.status(400).json({ error: 'sourceId and tocUrl are required' });
        }

        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });

        const { source } = loaded;
        const decodedUrl = decodeURIComponent(tocUrl);
        const context = createContext(source, {
            baseUrl: decodedUrl,
            timeout: config.jsRuntimeTimeout,
        });
        const html = await fetchSourceUrl(decodedUrl, context, { timeout: config.requestTimeout });
        if (!html) return res.status(404).json({ error: 'Unable to fetch TOC' });

        const rule = source.ruleToc || {};
        if (!rule.chapterList) {
            return res.status(400).json({ error: 'This source does not support TOC parsing' });
        }

        const ruleContext = { ...context, result: html, baseUrl: decodedUrl };
        const items = runRuleList(html, rule.chapterList, ruleContext) || [];
        let chapters = items.map((item, i) => {
            const itemContext = { ...ruleContext, result: item, chapter: { index: i } };
            let name = runRule(item, rule.chapterName, itemContext);
            const url = runRule(item, rule.chapterUrl, itemContext);
            const updateTime = runRule(item, rule.updateTime, itemContext);
            const isVip = rule.isVip ? runRule(item, rule.isVip, itemContext) : '';
            if (isBadValue(name, rule.chapterName)) {
                name = runRule(item, 'a@text', itemContext) || cleanText(item) || `第${i + 1}章`;
            }

            return {
                index: i,
                name: cleanText(name),
                url: isBadValue(url, rule.chapterUrl) ? '' : buildUrl(String(url), { ...itemContext, baseUrl: decodedUrl }).url,
                updateTime: cleanText(isBadValue(updateTime, rule.updateTime) ? '' : updateTime),
                isVip: !!isVip && !/^false|0$/i.test(String(isVip)),
            };
        }).filter(ch => ch.url);

        if (!chapters.length) {
            chapters = fallbackChapters(html, decodedUrl);
        }

        res.json({
            sourceId,
            totalChapters: chapters.length,
            chapters,
            nextTocUrl: rule.nextTocUrl ? resolveRuleUrl(rule.nextTocUrl, source, decodedUrl, null) : null,
        });
    } catch (err) {
        console.error('[Reader] TOC error:', err);
        res.status(500).json({ error: 'Failed to fetch TOC: ' + err.message });
    }
});

router.get('/chapter', async (req, res) => {
    try {
        const { sourceId, chapterUrl } = req.query;
        if (!sourceId || !chapterUrl) {
            return res.status(400).json({ error: 'sourceId and chapterUrl are required' });
        }

        const loaded = loadSource(sourceId);
        if (!loaded) return res.status(404).json({ error: 'Source not found' });

        const { source } = loaded;
        const decodedUrl = decodeURIComponent(chapterUrl);
        const rule = source.ruleContent || {};
        const chapter = await fetchFullChapter(source, rule, decodedUrl);
        if (!chapter.rawLength) return res.status(404).json({ error: 'Unable to fetch chapter' });

        const content = cleanText(applyReplaceRegex(chapter.content, rule.replaceRegex));

        res.json({
            sourceId,
            content,
            length: content.length,
            rawLength: chapter.rawLength,
            pageCount: chapter.pageCount,
            truncatedByPageLimit: chapter.truncatedByPageLimit,
        });
    } catch (err) {
        console.error('[Reader] Chapter error:', err);
        res.status(500).json({ error: 'Failed to fetch chapter: ' + err.message });
    }
});

module.exports = router;
