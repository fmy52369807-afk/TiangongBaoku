/**
 * Audio/music fallback functions and source identification helpers.
 */

const crypto = require('crypto');
const { fetchUrl } = require('../engine/httpClient');
const { resolveUrl } = require('../engine/legadoEngine');
const config = require('../config');
const { cleanText, tryJson, extractTitle, parseSourceHeader } = require('./utils');

// --- Source identification ---

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

// --- Audio TOC URL repair ---

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

// --- Audio entries (TOC) ---

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

// --- Music entries ---

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

// --- Audio search ---

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

// --- Audio payload URL ---

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

// --- Audio item URL (search results) ---

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

// --- Platform-specific audio fetchers ---

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

module.exports = {
    isMissevanSource,
    isHhlMaoerSource,
    isFiveSingSource,
    isLizhiSource,
    isFuciyuanSource,
    isMiguSource,
    repairAudioTocUrl,
    fallbackAudioEntries,
    fallbackMusicEntries,
    fallbackAudioSearchList,
    fallbackAudioPayloadUrl,
    fallbackAudioItemUrl,
    fetchMiguAudioUrl,
    fetchFiveSingAudioUrl,
};
