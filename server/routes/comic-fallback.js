/**
 * Comic image fallback and normalization functions.
 */

const { fetchUrl } = require('../engine/httpClient');
const config = require('../config');
const cheerio = require('cheerio');
const { tryJson, isBadValue } = require('./utils');
const { normalizeUrlMaybe, extractUrls } = require('./url-utils');

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

function isAntbywComicSource(sourceOrUrl) {
    const text = typeof sourceOrUrl === 'string'
        ? sourceOrUrl
        : [sourceOrUrl?.bookSourceUrl, sourceOrUrl?.searchUrl, sourceOrUrl?.bookSourceName].filter(Boolean).join(' ');
    return /antbyw\.com|jameson_manhua/i.test(String(text || ''));
}

function fallbackAntbywEntries(html, baseUrl, startIndex = 0) {
    if (!isAntbywComicSource(baseUrl) && !/jameson_manhua/i.test(String(html || ''))) return [];
    const $ = cheerio.load(String(html || ''));
    const byKey = new Map();
    $('a[href*="jameson_manhua"][href*="a=read"][href*="zjid="], a[href*="a=read"][href*="zjid="][href*="kuid="]').each((_, el) => {
        const href = ($(el).attr('href') || '').replace(/&amp;/g, '&');
        const url = normalizeAntbywUrl(href, baseUrl);
        if (!url) return;
        const name = cleanAntbywChapterName(
            $(el).attr('title')
            || $(el).text()
            || $(el).closest('li, dd, tr, div').text()
            || `第 ${byKey.size + 1} 章`
        );
        const key = antbywReadKey(url);
        const existing = byKey.get(key);
        if (existing && antbywChapterNameScore(existing.name) >= antbywChapterNameScore(name)) return;
        byKey.set(key, {
            index: 0,
            name,
            url,
            isVip: false,
            isVolume: false,
            updateTime: '',
        });
    });
    const entries = Array.from(byKey.values()).map((entry, index) => ({ ...entry, index: startIndex + index }));
    return entries;
}

function cleanAntbywChapterName(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 80) || '未命名章节';
}

function normalizeAntbywUrl(url, baseUrl) {
    const text = String(url || '').replace(/&amp;/g, '&').trim();
    if (!text) return '';
    try {
        return new URL(text, baseUrl || 'https://www.antbyw.com/').href;
    } catch {
        return normalizeUrlMaybe(text, baseUrl) || '';
    }
}

function antbywReadKey(url) {
    try {
        const parsed = new URL(url);
        const kuid = parsed.searchParams.get('kuid') || '';
        const zjid = parsed.searchParams.get('zjid') || '';
        return `${parsed.origin}${parsed.pathname}?kuid=${kuid}&zjid=${zjid}`;
    } catch {
        return String(url || '');
    }
}

function antbywChapterNameScore(name) {
    const text = String(name || '').trim();
    if (/^(?:阅读|开始阅读|立即阅读)$/i.test(text)) return 0;
    if (/第\s*\d+|第[一二三四五六七八九十百千万零〇]+|卷|话|回|章|篇/i.test(text)) return 3;
    return text.length > 2 ? 2 : 1;
}

function extractAntbywReadUrls(raw, baseUrl) {
    if (!isAntbywComicSource(baseUrl) && !/jameson_manhua/i.test(String(raw || ''))) return [];
    const urls = [];
    const text = String(raw || '').replace(/&amp;/g, '&');
    for (const match of text.matchAll(/href=["']([^"']*jameson_manhua[^"']*a=read[^"']*zjid=[^"']+)["']/gi)) {
        const url = normalizeAntbywUrl(match[1], baseUrl);
        if (url) urls.push(url);
    }
    for (const match of text.matchAll(/(?:\/plugin\.php|\bplugin\.php)\?id=jameson_manhua[^"'<>\\\s]*a=read[^"'<>\\\s]*zjid=[^"'<>\\\s]*/gi)) {
        const url = normalizeAntbywUrl(match[0], baseUrl);
        if (url) urls.push(url);
    }
    return [...new Set(urls)];
}

function extractAntbywImageUrls(raw, entryUrl) {
    if (!isAntbywComicSource(entryUrl) && !/imgmh\d*\.antbyw\.com|let\s+urls\s*=/i.test(String(raw || ''))) return [];
    const urls = [];
    const text = String(raw || '');
    for (const match of text.matchAll(/(?:let|var|const)\s+urls\s*=\s*(\[[\s\S]*?\])\s*;?/gi)) {
        const parsed = tryJson(match[1]);
        if (Array.isArray(parsed)) urls.push(...parsed.filter(item => typeof item === 'string'));
    }
    urls.push(...extractUrls(text, entryUrl).filter(url => /imgmh\d*\.antbyw\.com/i.test(url)));
    return filterComicImageUrls(urls, entryUrl, 'comic-contain chapterImages');
}

function extractAntbywPageUrls(raw, currentUrl) {
    const $ = cheerio.load(String(raw || '').replace(/&amp;/g, '&'));
    const urls = [];
    $('.pg.page a[href], .pg a[href], a[href*="a=read"][href*="page="]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const url = normalizeAntbywUrl(href, currentUrl);
        if (url && /a=read/i.test(url) && /page=\d+/i.test(url)) urls.push(url);
    });
    return [...new Set(urls)].sort((a, b) => antbywPageNumber(a) - antbywPageNumber(b));
}

function antbywPageNumber(url) {
    try {
        return Number(new URL(url).searchParams.get('page') || 1);
    } catch {
        return Number((String(url || '').match(/[?&]page=(\d+)/i) || [])[1] || 1);
    }
}

async function fetchAntbywPagedImages(source, raw, entryUrl, maxPages = 80) {
    if (!isAntbywComicSource(source) && !isAntbywComicSource(entryUrl) && !/jameson_manhua/i.test(String(raw || ''))) {
        return [];
    }
    const firstReadUrl = /a=read/i.test(String(entryUrl || ''))
        ? entryUrl
        : extractAntbywReadUrls(raw, entryUrl)[0];
    if (!firstReadUrl) return [];

    const headers = {
        'User-Agent': 'Mozilla/5.0',
        Referer: entryUrl,
    };
    const visited = new Set();
    const queue = [firstReadUrl];
    const imageUrls = [];
    let firstRaw = /a=read/i.test(String(entryUrl || '')) ? raw : '';

    while (queue.length && visited.size < maxPages) {
        const currentUrl = queue.shift();
        if (!currentUrl || visited.has(currentUrl)) continue;
        visited.add(currentUrl);
        let pageRaw = currentUrl === firstReadUrl && firstRaw ? firstRaw : '';
        if (!pageRaw) {
            pageRaw = await fetchUrl(currentUrl, { headers }, config.requestTimeout);
        }
        imageUrls.push(...extractAntbywImageUrls(pageRaw, currentUrl));
        for (const nextUrl of extractAntbywPageUrls(pageRaw, currentUrl)) {
            if (!visited.has(nextUrl) && !queue.includes(nextUrl)) queue.push(nextUrl);
        }
    }
    return filterComicImageUrls(imageUrls, firstReadUrl, 'comic-contain chapterImages');
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
    return /(logo|favicon|avatar|icon|banner|cover|thumb|thumbnail|poster|qrcode|qr-code|wechat|weixin|app-download|download-app|appdl|loading|loader|ajax-loader|load\.gif|\/(?:acg|bl)\.gif|placeholder|default|empty|rank|recommend|hot|category|menu|nav|back_btn|title_back|sprite|assets\/images\/logo|bookcover|coverimg|cover_img|posterimg)/i.test(String(url || ''));
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

module.exports = {
    filterComicImageUrls,
    normalizeKnownComicImageHost,
    isAntbywComicSource,
    fallbackAntbywEntries,
    extractAntbywReadUrls,
    extractAntbywImageUrls,
    fetchAntbywPagedImages,
    fallbackComicImageUrls,
    fallbackStructuredComicImageUrls,
    collectTargetedComicImageUrls,
    normalizeStructuredComicImageArray,
    normalizeStructuredComicImageUrl,
    fallbackYydsmhImageUrls,
    shouldSkipGenericComicFallback,
    rawLooksLikeComicChapter,
    isLikelyComicPageImage,
    isBadComicImageUrl,
    isSameSiteHomepageAsset,
};
