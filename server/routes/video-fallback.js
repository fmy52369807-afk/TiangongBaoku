/**
 * Video fallback functions: CMS, ikanbot, and reachability probing.
 */

const { fetchUrl } = require('../engine/httpClient');
const config = require('../config');
const { cleanText, tryJson, extractMeta, extractTitle, parseSourceHeader } = require('./utils');
const { probeDirectMediaUrl } = require('./proxy');

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

module.exports = {
    isCmsVideoSource,
    fetchCmsVideoEntries,
    parseCmsVideoEntries,
    fetchIkanbotEntries,
    prioritizeReachableVideoEntries,
    makeIkanbotToken,
    parseIkanbotResData,
    fallbackVideoEntries,
};
