/**
 * Sources routes 闁?list, detail, categories
 */
const express = require('express');
const cheerio = require('cheerio');
const config = require('../config');
const { loadIndex, loadSource } = require('./content-helpers');
const { categoryMeta } = require('./category-config');
const {
    buildUrl,
    cleanSourceUrl,
    createContext,
    fetchSourceUrl,
    resolveUrl,
    runRule,
    runRuleList,
} = require('../engine/legadoEngine');
const { createAdapter } = require('../engine/sourceAdapters');

const router = express.Router();

const HOT_CATEGORIES = ['novel', 'comic', 'music', 'video'];
const HOT_TITLE_RE = /婵帗鍓柟鐑樺笩椤㈡啋闁绘埈鍙冨Λ鐟嬮柣鎴幖鐎圭闁伙絽鎳橀弨顣㈠ù婊呭劋閻ㄧ闁规亽鍔忓畷姒洪柡鍫濈墢閵堚枀闁绘劗鎳撻崵鐣栭柡鍌烆暒缂嶆敓濡炲鐟ュ畷瀵峵op|rank|hot|popular/i;
const HEADING_RE = /^(闁汇垽顥撻弫鎼㈠┑鍌氱－閺佹悽闁汇垻鍏橀。绉ュ┑鍌涘▕椤ｇД闁告帒妫涚悮鐝呴柛蹇嬪姂閸庣！濞戞搩浜欏Ч澶嬬▔椤撶偟濡噟闁告瑦鍨归獮鍣熼柣妯嘉*闁诡兛绨犲Λ鐗埳戝姊堕柛锔芥緲鐏忕槃閺夆晜绋戠€圭闁衡偓閹澘鐎瓅闁圭儤甯掔花鐡呴柟鎭掑劚瑜版硲閻犲洤瀚鎲掑銈呯仛閺嗙劜[-闁炽儲鎽?\s]+)$/i;
const HOT_ENTRY_LIMIT = 8;
const HOT_SOURCE_LIMIT = 4;
const HOT_LABEL_RE = /婵帗鍓柟鐑樺笩椤㈡啋闁绘埈鍙冨Λ鐟嬮柣鎴幖鐎圭闁伙絽鎳橀弨顣㈠ù婊呭劋閻ㄧ闁规亽鍔忓畷姒洪柡鍫濈墢閵堚枀闁绘劗鎳撻崵鐣栭柡鍌烆暒缂嶆敓濡炲鐟ュ畷瀵嶅ù鑲╁У閹哥湩闁告帒妫旈棅锕焧op|rank|hot|popular/i;
const NAV_LABEL_RE = /^(闁汇垽顥撻弫鎼㈠┑鍌氱－閺佹悽闁汇垻鍏橀。绉ュ┑鍌涘▕椤ｇД闁告帒妫涚悮鐝呴柛蹇嬪姂閸庣！濞戞搩浜欏Ч澶嬬▔椤撶偟濡噟闁告瑦鍨归獮鍣熼柣妯垮煐閳ь兛绨犲Λ鐗埳戝姊堕柛锔芥緲鐏忕槃閺夆晜绋戠€圭闁衡偓閹澘鐎瓅闁圭儤甯掔花鐡呴柟鎭掑劚瑜版硲閻犲洤瀚鎲掑銈呯仛閺嗙劜濞戞棑绠戠花鐪у娑欘焾椤撶矃閺夆晝鍋犲ù鍣熼悗鐟版湰濠€鐨橀梺顔挎缁旂Д闁绘粌瀚径鐒插┑鍌氭搐婢剁劜婵繐缂氱欢绨楀ù鐘崇懁缁剁皸闁告ê妫楄ぐ绉ラ柛鎰◥缁ㄢ枀婵炴挸鎲￠崹妾ょ紒鏃傚仦婵☆潅缂佸鍨垫径鐒查柟顕呭墰閺嬫娋閻熷皝鍋撻柟顖氬竸闁汇垻鍠愬绺烽柛蹇嬪姂閸庢潙顫楀鍐ㄧ|婵帗娉泂*闁告妾烘慨鎺撶矊瀹曠劜闁哄鍓濋弸浜呴柣娆樺墮椤斿尘濞存粎鍎ら惃绁欓柡鍥х摠閺屽Α閻犲洤瀚崹宸柡鈧幆鐗堫棏|闁规亽鍔忓畷姒洪柛鎺戞闂娾晛顫楀〒杈ㄥ閻樿櫕灏℃慨鎺撳壇[-*\s]+)$/i;

function hotSourceScore(entry, source, hotCount) {
    const statusScore = { ok: 80, partial: 52, vpn_needed: 32, failed: 8, disabled: 0 }[entry.status] || 0;
    const weight = Math.max(0, Number(entry.weight || 0));
    const text = `${entry.name || ''} ${entry.group || ''} ${entry.comment || ''} ${source?.bookSourceComment || ''}`;
    const sourceHint = HOT_TITLE_RE.test(text) ? 16 : 0;
    return statusScore + Math.min(weight, 30) + sourceHint + Math.min(hotCount, 12) * 4;
}

function normalizeHotTitle(value) {
    return String(value || '')
        .replace(/[\u{1f300}-\u{1faff}]/gu, '')
        .replace(/[\[\]{}().,\^$|#]/g, '')
        .replace(/\\s+/g, ' ')
        .replace(/[?]+$/g, '')
        .trim();
}

const REAL_STRONG_HOT_LABEL_RE = /\u699c|\u6392\u884c|\u70ed\u95e8|\u70ed\u5ea6|\u7545\u9500|\u6708\u7968|\u70b9\u51fb|\u65b0\u4f5c|\u98d9\u5347|\u4f20\u64ad|\u5206\u4eab|top|rank|hot|popular/i;
const REAL_WEAK_HOT_LABEL_RE = /\u4eba\u6c14|\u63a8\u8350/i;
const REAL_RANK_URL_RE = /(?:rank|top|hot|popular|board|bang|chart|score|trend|list|qbread\/api\/rank|\/rank|\/top|\/hot|\/btop)/i;
const REAL_CATEGORY_URL_RE = /(?:category|class|sort|shuku|bookstore|\/all[/?]|\/web\/all|subcategory|fenlei|type=|sort=|category=)/i;
const REAL_HOT_LABEL_RE = new RegExp(`${REAL_STRONG_HOT_LABEL_RE.source}|${REAL_WEAK_HOT_LABEL_RE.source}`, 'i');
const REAL_NAV_LABEL_RE = /^(all|\u5168\u90e8|\u5206\u7c7b|\u4e66\u5e93|\u9ed8\u8ba4|\u8fde\u8f7d|\u5b8c\u672c|\u90fd\u5e02|\u7384\u5e7b|\u5947\u5e7b|\u6b66\u4fa0|\u4ed9\u4fa0|\u5386\u53f2|\u519b\u4e8b|\u6e38\u620f|\u7ade\u6280|\u79d1\u5e7b|\u60ac\u7591|\u8a00\u60c5|\u751f\u6d3b|\u7537\u751f|\u5973\u751f|\u9898\u6750|\u5730\u533a|\u8fdb\u5ea6|\u6536\u8d39|\u6392\u5e8f|\u63a5\u53e3|\u8bc4\u8bba|\u9875\u6570|\u5168\u90e8\u699c\u5355|\u699c\s*\u5355|\u699c\u5355|\u6761\u6f2b|\u72ec\u5bb6|\u4eba\u6c14|\u66f4\u65b0|\u8bc4\u5206|\u6536\u85cf|\u63a8\u8350|\u5206\u4eab\u699c|\u4f20\u64ad\u699c|[-*\s]+)$/i;
const REAL_SHORT_NAV_RE = /\u9996\u9875|\u5c0f\u8bf4\u9996\u9875|\u5206\u7c7b|\u6536\u85cf|\u5386\u53f2|\u641c\u7d22|\u53cd\u9988|\u4e2a\u4eba\u4e2d\u5fc3|\u7528\u6237\u4e66\u67b6|\u4f1a\u5458\u4e66\u67b6|\u9605\u8bfb\u8bb0\u5f55|\u624b\u673a\u7248|\u624b\u673a\u5c0f\u8bf4|\u6700\u8fd1\u66f4\u65b0|\u65b0\u4e66\u5165\u5e93|\u5199\u4f5c\u699c|\u5b57\u6570|\u7b14\u4e0b\u6587\u5b66|\u6392\u884c|\u603b\u70b9\u51fb|\u6708\u70b9\u51fb|\u5468\u70b9\u51fb|\u65e5\u70b9\u51fb|\u6708\u7968\u699c|\u5468\u699c|\u65e5\u699c|\u7545\u9500\u699c|\u98d9\u5347\u699c|\u65b0\u4f5c\u699c|\u771f\u9999\u699c|\u4eba\u6c14|\u7384\u5e7b\u5947\u5e7b|\u6b66\u4fa0\u4ed9\u4fa0|\u90fd\u5e02\u751f\u6d3b|\u5386\u53f2\u519b\u4e8b|\u6e38\u620f\u7ade\u6280|\u79d1\u5e7b\u672a\u6765|\u6050\u6016\u60ac\u7591|\u5176\u4ed6\u7c7b\u578b|\u53e4\u4ee3\u8a00\u60c5|\u73b0\u4ee3\u8a00\u60c5|\u5e7b\u60f3\u8a00\u60c5|\u6d6a\u6f2b\u9752\u6625|\u803d\u7f8e\u540c\u4eba/;
const REAL_UTILITY_LABEL_RE = /\u7f51\u7ad9\u5730\u56fe|\u5730\u56fe|\u76ee\u5f55|\u5e2e\u52a9|\u767b\u5f55|\u6ce8\u518c|\u4e0b\u8f7d|\u5ba2\u670d|\u7248\u6743|\u8054\u7cfb\u6211\u4eec|\u5173\u4e8e\u6211\u4eec|\u514d\u8d23\u58f0\u660e/i;
const HOT_NAV_URL_RE = /\/(bsort\d*|shuku|btop\w*|top|sort|rank|full|all|author|search|user|history|favorite|category)(\/|\.|$)/i;

function isHotEntry(title, url = '') {
    const clean = normalizeHotTitle(title);
    const target = String(url || '');
    if (!clean || clean.length > 32 || HEADING_RE.test(clean) || isNavigationHotLabel(clean)) return false;
    if (REAL_STRONG_HOT_LABEL_RE.test(clean) || REAL_RANK_URL_RE.test(target)) return true;
    return REAL_WEAK_HOT_LABEL_RE.test(clean) && REAL_RANK_URL_RE.test(target) && !REAL_CATEGORY_URL_RE.test(target);
}

function isNavigationHotLabel(value) {
    const clean = normalizeHotTitle(value);
    const plain = clean.replace(/^[\[\u3010][^\]\u3011]+[\]\u3011]\s*/, '').trim();
    if (!plain || HEADING_RE.test(plain) || NAV_LABEL_RE.test(plain) || REAL_NAV_LABEL_RE.test(plain) || REAL_SHORT_NAV_RE.test(plain) || REAL_UTILITY_LABEL_RE.test(plain)) return true;
    return REAL_HOT_LABEL_RE.test(clean) && clean.length <= 8;
}

function normalizeHotUrl(value, baseUrl = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    const url = resolveUrl(text, baseUrl);
    return /^\/\//.test(url) ? `https:${url}` : url;
}

function isNavigationHotUrl(value) {
    return HOT_NAV_URL_RE.test(String(value || ''));
}

function normalizeHotReason(value, targetUrl = '') {
    const clean = normalizeHotTitle(value).replace(/[\u21e6\u21e8\u2190\u2192\u21a9\u21aa]/g, '').trim();
    const url = String(targetUrl || '');
    if (/qbread\/api\/rank/i.test(url)) return '\u0051\u0051\u9605\u8bfb\u6392\u884c';
    if (!clean || REAL_NAV_LABEL_RE.test(clean) || REAL_SHORT_NAV_RE.test(clean)) return '\u6e90\u7ad9\u6392\u884c';
    if (/^\u63a8\u8350$|^\u4eba\u6c14$|^\u539f\u521b$|^\u6700\u65b0$|^\u70ed\u8840$|^\u90fd\u5e02|\u90fd\u5e02\u751f\u6d3b|\u5206\u7c7b|\u5168\u90e8|\u9ed8\u8ba4/i.test(clean)) return '\u6e90\u7ad9\u6392\u884c';
    return clean;
}

function cleanExploreText(value) {
    return String(value || '')
        .replace(/<\/?js>/gi, '')
        .replace(/^@js:\s*/i, '');
}

function parseJsonExplore(value) {
    const text = cleanExploreText(value).trim();
    if (!text || !/^[\[{]/.test(text)) return [];
    const normalized = text
        .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
    try {
        const parsed = JSON.parse(normalized);
        const list = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        return list.flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            return [{ title: item.title || item.name || Object.keys(item)[0] || '', url: item.url || item[Object.keys(item)[0]] || '' }];
        });
    } catch {
        return [];
    }
}

function parseLineExplore(value) {
    return cleanExploreText(value)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const pair = line.split('::');
            if (pair.length >= 2) return { title: pair[0], url: pair.slice(1).join('::') };
            const objectMatch = line.match(/["']title["']\s*:\s*["']([^"']+)["'][\s\S]*?["']url["']\s*:\s*["']([^"']*)["']/i);
            if (objectMatch) return { title: objectMatch[1], url: objectMatch[2] };
            return { title: '', url: line };
        });
}

function parseExploreEntries(value) {
    return [...parseJsonExplore(value), ...parseLineExplore(value)]
        .map(item => ({ title: normalizeHotTitle(item.title), url: String(item.url || '').trim() }))
        .filter(item => item.title || item.url);
}

function buildExploreUrl(source, item) {
    if (!item.url) return '';
    const context = createContext(source, { page: 1, timeout: config.jsRuntimeTimeout });
    const target = buildUrl(item.url.replace(/\{\{\s*page\s*\}\}/gi, '1'), context);
    if (!/^https?:\/\//i.test(target.url)) {
        return resolveUrl(target.url, cleanSourceUrl(source.bookSourceUrl));
    }
    return target.url;
}

function extractHotEntries(entry, source) {
    const exploreUrl = source?.exploreUrl;
    if (!exploreUrl) return [];
    const candidates = parseExploreEntries(exploreUrl);
    const seen = new Set();
    return candidates
        .filter(item => isHotEntry(item.title, item.url))
        .filter(item => {
            const key = `${item.title}:${item.url}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 8)
        .map((item, index) => ({
            title: item.title,
            url: item.url,
            sourceId: entry.id,
            sourceName: entry.name,
            category: entry.category,
            status: entry.status,
            group: entry.group,
            reason: item.url ? '\u6e90\u7ad9\u699c\u5355\u5165\u53e3' : '\u6e90\u7ad9\u699c\u5355\u5206\u7ec4',
            kind: 'entry',
            heat: Math.max(1, 100 - index * 5),
        }));
}

function cleanHotField(value) {
    return normalizeHotTitle(value)
        .replace(/^(缂?\d+闁告艾灏楾OP\s*\d+|NO\.?\s*\d+)[:闁?\s-]*/i, '')
        .trim();
}

function normalizeHotWork(item, fallback = {}) {
    const title = cleanHotField(item.name || item.title || item.bookName || item.book_name || item.comicName || item.comic_name || item.albumTitle || item.songName || item.song_name || item.vodName || item.topicTitle || item.comic_title || item.resourceName || item.resource_name);
    if (!title || title.length > 40 || isNavigationHotLabel(title)) return null;
    return {
        title,
        author: cleanHotField(item.author || item.authorName || item.comic_author || item.singer || item.artist || item.nickname || item.userName || ''),
        coverUrl: item.coverUrl || item.cover || item.pic || item.picurl || item.image || item.imageUrl || item.vertical_image_url || item.cover_image_url || item.comic_cover || '',
        itemUrl: item.itemUrl || item.bookUrl || item.url || item.jumpUrl || item.topicUrl || item.comic_url || item.resourceUrl || '',
        intro: String(item.intro || item.description || item.desc || item.recommend || '').slice(0, 120),
        ...fallback,
        kind: 'work',
    };
}

function walkObjects(value, out = []) {
    if (!value || out.length > 60) return out;
    if (Array.isArray(value)) {
        value.forEach(item => walkObjects(item, out));
        return out;
    }
    if (typeof value === 'object') {
        const work = normalizeHotWork(value);
        if (work) out.push(work);
        Object.values(value).forEach(item => walkObjects(item, out));
    }
    return out;
}

function extractJsonHotWorks(raw) {
    try {
        const text = String(raw || '').replace(/^\uFEFF/, '');
        return walkObjects(JSON.parse(text)).slice(0, HOT_ENTRY_LIMIT);
    } catch {
        return [];
    }
}

function extractHtmlHotWorks(raw, baseUrl) {
    const $ = cheerio.load(String(raw || ''));
    const seen = new Set();
    const works = [];
    const selectors = [
        '.bookbox', '.book-item', '.booklist li', '.lists li', '.lists dl',
        '.comic-list li', '.comic-item', '.rank-list li', '.ranklist li',
        '.list li', 'li'
    ].join(',');
    const pushWork = (item) => {
        if (works.length >= HOT_ENTRY_LIMIT) return false;
        const title = cleanHotField(item.title);
        if (!title || title.length < 2 || title.length > 36 || isNavigationHotLabel(title)) return;
        const url = normalizeHotUrl(item.href, baseUrl);
        if (!url || isNavigationHotUrl(url)) return;
        const key = `${title}:${url}`;
        if (seen.has(key)) return;
        seen.add(key);
        const work = normalizeHotWork({
            title,
            itemUrl: url,
            coverUrl: normalizeHotUrl(item.coverUrl, baseUrl),
            author: item.author,
            intro: item.intro,
        });
        if (work) works.push(work);
    };
    $(selectors).each((_, el) => {
        if (works.length >= HOT_ENTRY_LIMIT) return false;
        const $el = $(el);
        const $link = $el.find('a[href]').filter((_, a) => {
            const text = cleanHotField($(a).attr('title') || $(a).text());
            return text && !isNavigationHotLabel(text);
        }).first();
        if (!$link.length) return;
        const img = $el.find('img').first();
        pushWork({
            title: $link.attr('title') || $link.text() || img.attr('alt'),
            href: $link.attr('href') || '',
            coverUrl: img.attr('data-src') || img.attr('data-original') || img.attr('src') || '',
            author: $el.find('.author,.writer,.singer').first().text(),
            intro: $el.text().replace($link.text(), '').trim(),
        });
    });
    if (works.length < HOT_ENTRY_LIMIT) $('a[href]').each((_, el) => {
        if (works.length >= HOT_ENTRY_LIMIT) return false;
        const $el = $(el);
        const title = $el.attr('title') || $el.find('[title]').first().attr('title') || $el.text();
        const img = $el.find('img').first();
        pushWork({
            title,
            href: $el.attr('href') || '',
            coverUrl: img.attr('data-src') || img.attr('data-original') || img.attr('src') || '',
            intro: $el.parent().text().replace(title, '').trim(),
        });
    });
    return works.filter(Boolean);
}

async function fetchHotWorksFromExplore(entry, source, exploreItem) {
    const rule = source.ruleExplore || {};
    const targetUrl = buildExploreUrl(source, exploreItem);
    if (!targetUrl || targetUrl.includes('{{')) return [];
    const context = createContext(source, { page: 1, timeout: Math.min(config.jsRuntimeTimeout, 3500) });
    const raw = await fetchSourceUrl(targetUrl, context, {
        timeout: Math.min(config.requestTimeout, 6500),
    });
    if (!raw) return [];
    const adapter = createAdapter(entry, source);
    const ruleContext = { ...context, result: raw, baseUrl: targetUrl };
    let works = [];
    if (rule.bookList) {
        const list = runRuleList(raw, rule.bookList, ruleContext).filter(item => !(typeof item === 'string' && item === raw));
        works = list.slice(0, HOT_ENTRY_LIMIT).map(item => {
            const itemContext = { ...ruleContext, result: item };
            const rawUrl = rule.bookUrl ? runRule(item, rule.bookUrl, itemContext) : '';
            const itemUrl = rawUrl ? buildUrl(String(rawUrl), { ...itemContext, baseUrl: targetUrl }).url : '';
            return adapter.normalizeItem(normalizeHotWork({
                name: rule.name ? runRule(item, rule.name, itemContext) : '',
                author: rule.author ? runRule(item, rule.author, itemContext) : '',
                coverUrl: rule.coverUrl ? runRule(item, rule.coverUrl, itemContext) : '',
                intro: rule.intro ? runRule(item, rule.intro, itemContext) : '',
                itemUrl,
            }, {
                sourceId: entry.id,
                sourceName: entry.name,
                category: entry.category,
                status: entry.status,
                reason: normalizeHotReason(exploreItem.title, targetUrl),
            }));
        }).filter(item => item && item.title);
    }
    if (!works.length) works = extractJsonHotWorks(raw);
    if (!works.length) works = extractHtmlHotWorks(raw, targetUrl);
    return works.filter(work => work && work.kind === 'work' && !isNavigationHotLabel(work.title)).slice(0, HOT_ENTRY_LIMIT).map((work, index) => ({
        ...work,
        sourceId: entry.id,
        sourceName: entry.name,
        category: entry.category,
        status: entry.status,
        reason: normalizeHotReason(exploreItem.title, targetUrl),
        heat: hotSourceScore(entry, source, works.length) + 120 - index * 4,
    }));
}

async function collectCategoryHot(category, index) {
    const candidates = index
        .filter(entry => entry.category === category && entry.enabled !== false && entry.status !== 'disabled')
        .map(entry => {
            const loaded = loadSource(entry.id);
            const source = loaded?.source;
            const entries = source ? extractHotEntries(entry, source) : [];
            return { entry, source, entries, score: source ? hotSourceScore(entry, source, entries.length) : 0 };
        })
        .filter(item => item.source && item.entries.length)
        .sort((a, b) => b.score - a.score)
        .slice(0, HOT_SOURCE_LIMIT);

    const works = [];
    for (const candidate of candidates) {
        for (const exploreItem of candidate.entries.slice(0, 2)) {
            try {
                const fetched = await fetchHotWorksFromExplore(candidate.entry, candidate.source, exploreItem);
                works.push(...fetched);
                if (works.length >= 12) break;
            } catch {}
        }
        if (works.length >= 12) break;
    }

    const fallback = [];
    const seen = new Set();
    const merged = [...works, ...fallback]
        .filter(item => {
            const key = `${item.kind}:${item.title}:${item.sourceId}`;
            if (!item.title || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(item => ({
            ...item,
            reason: normalizeHotReason(item.reason || item.title || '', item.itemUrl || item.url || ''),
        }))
        .filter(item => item.kind === 'work' || isHotEntry(item.title, item.itemUrl || item.url || ''))
        .sort((a, b) => b.heat - a.heat || String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'))
        .slice(0, 12);
    return merged;
}

// GET /api/sources/hot
router.get('/hot', async (req, res) => {
    try {
        const index = loadIndex();
        const categories = {};
        await Promise.all(HOT_CATEGORIES.map(async category => {
            categories[category] = await collectCategoryHot(category, index);
        }));
        res.json({ categories, generatedAt: new Date().toISOString() });
    } catch (err) {
        console.error('[Sources] Hot error:', err);
        res.status(500).json({ error: 'Hot sources failed' });
    }
});

// GET /api/sources/categories
router.get('/categories', (req, res) => {
    const index = loadIndex();
    const categoryCounts = {};
    index.forEach(entry => {
        const cat = entry.category || 'other';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const categories = Object.entries(categoryCounts).map(([key, count]) => ({
        key,
        icon: categoryMeta(key).icon,
        label: categoryMeta(key).label || key,
        order: categoryMeta(key).order,
        count,
    }));
    categories.sort((a, b) => a.order - b.order);

    // Add "all" pseudo-category
    categories.unshift({
        key: 'all',
        icon: categoryMeta('all').icon,
        label: categoryMeta('all').label,
        order: categoryMeta('all').order,
        count: index.length,
    });

    res.json({ categories, total: index.length });
});

// GET /api/sources
router.get('/', (req, res) => {
    try {
        const index = loadIndex();
        let entries = [...index];

        // Filter by category
        const { category, page = 1, size = 50 } = req.query;
        if (category && category !== 'all') {
            entries = entries.filter(e => e.category === category);
        }

        // Pagination
        const p = parseInt(page);
        const s = Math.min(parseInt(size), 500);
        const total = entries.length;
        const start = (p - 1) * s;
        const items = entries.slice(start, start + s);

        res.json({
            total,
            page: p,
            size: s,
            hasMore: start + s < total,
            items,
        });
    } catch (err) {
        console.error('[Sources] Error:', err);
        res.status(500).json({ error: 'Hot sources failed' });
    }
});

// GET /api/sources/:id
router.get('/:id', (req, res) => {
    try {
        const index = loadIndex();
        const entry = index.find(e => e.id === req.params.id);
        if (!entry) {
            return res.status(404).json({ error: 'Source not found' });
        }

        // Load full source data
        const loaded = loadSource(entry.id);
        const fullSource = loaded && loaded.source;
        if (!fullSource) {
            return res.status(404).json({ error: 'Source payload not found' });
        }

        res.json({
            ...entry,
            source: fullSource,
        });
    } catch (err) {
        console.error('[Sources] Detail error:', err);
        res.status(500).json({ error: 'Hot sources failed' });
    }
});

module.exports = router;




