/**
 * Source adapter registry.
 *
 * Adapters keep category/source-specific behavior out of route code and
 * validation scripts. Most sources use the generic adapter; special sources
 * can be registered by id, category, host, or rule markers.
 */

function createAdapter(entry = {}, source = {}) {
    const markers = collectMarkers(entry, source);
    const adapter = {
        id: entry.id || '',
        category: entry.category || '',
        tags: [],
        warnings: [],
        capabilities: categoryCapabilities(entry.category),
        searchLimit: 5,
        maxEntryPages: maxEntryPagesForCategory(entry.category),
        webViewRequired: markers.webView,
        loginRequired: markers.login,
        browserRequired: markers.browser,
        normalizeItem(item) {
            return item;
        },
        normalizeEntries(entries) {
            if (entry.category === 'video') return groupVideoEntries(entries);
            return entries;
        },
        normalizePayload(payload) {
            const next = { ...payload };
            if (entry.category === 'comic') {
                next.type = 'images';
                next.mode = 'html';
            }
            if (entry.category === 'music' || entry.category === 'audio') {
                next.type = 'audio';
            }
            if (entry.category === 'video') {
                next.type = 'video';
                next.urls = unique([...(next.urls || []), ...extractUrlLike(next.content), ...extractUrlLike(next.text)])
                    .filter(url => isPlayableVideoUrl(url) || isLikelyPlayableUrl(url));
                next.mediaUrl = validMediaUrl(next.mediaUrl)
                    || next.urls.find(isPlayableVideoUrl)
                    || next.urls.find(isLikelyPlayableUrl)
                    || '';
            }
            if (entry.category === 'music' || entry.category === 'audio') {
                next.urls = unique([...(next.urls || []), ...extractUrlLike(next.content), ...extractUrlLike(next.text)])
                    .filter(url => isPlayableAudioUrl(url) || isLikelyPlayableUrl(url));
                next.mediaUrl = validMediaUrl(next.mediaUrl)
                    || next.urls.find(isPlayableAudioUrl)
                    || next.urls.find(isLikelyPlayableUrl)
                    || '';
            }
            if (entry.category === 'game' || entry.category === 'special') {
                next.type = 'link';
                next.urls = unique([...(next.urls || []), ...extractUrlLike(next.content), ...extractUrlLike(next.text)]);
                next.mediaUrl = validMediaUrl(next.mediaUrl) || next.urls.find(isHttpUrl) || '';
            }
            return next;
        },
        validateSearchItem(item) {
            if (!item || !item.name) return { ok: false, reason: 'missing_name' };
            if (!item.itemUrl) return { ok: false, reason: 'missing_url' };
            if (/\{\{|\}\}|\{\$/.test(item.itemUrl)) return { ok: false, reason: 'unresolved_template' };
            return { ok: true };
        },
        validateEntries(entries) {
            if (!Array.isArray(entries) || !entries.length) return { ok: false, reason: 'empty_entries' };
            const selectable = entries.filter(item => item && item.url && item.selectable !== false);
            if (!selectable.length) return { ok: false, reason: 'no_selectable_entries' };
            return { ok: true };
        },
        validatePayload(payload) {
            return validatePayloadByCategory(entry.category, payload);
        },
    };

    if (adapter.webViewRequired) {
        adapter.tags.push('webview');
        adapter.warnings.push('source uses webView rules; server-side validation may be partial');
    }
    if (adapter.loginRequired) {
        adapter.tags.push('login');
        adapter.warnings.push('source appears to require login or cookies');
    }
    if (markers.signedApi) {
        adapter.tags.push('signed-api');
        adapter.warnings.push('source uses generated request signatures or API tokens');
    }
    if (adapter.browserRequired) {
        adapter.tags.push('browser');
        adapter.warnings.push('source uses startBrowser rules; payload may be a browser URL');
    }

    applyKnownSourceOverrides(adapter, entry, source);
    return adapter;
}

function maxEntryPagesForCategory(category) {
    if (category === 'novel') return 120;
    if (category === 'comic') return 80;
    if (category === 'audio') return 100;
    if (category === 'video') return 60;
    return 40;
}

function categoryCapabilities(category) {
    const map = {
        novel: ['search', 'detail', 'entries', 'text'],
        comic: ['search', 'detail', 'entries', 'images'],
        audio: ['search', 'detail', 'entries', 'audio'],
        music: ['search', 'detail', 'entries', 'audio'],
        video: ['search', 'detail', 'entries', 'video', 'lines'],
        game: ['search', 'detail', 'entries', 'link'],
        special: ['search', 'detail', 'entries', 'link', 'content'],
    };
    return map[category] || ['search', 'detail', 'entries', 'content'];
}

function collectMarkers(entry, source) {
    const text = JSON.stringify({
        name: entry.name,
        url: entry.url,
        comment: entry.comment,
        loginUrl: source.loginUrl,
        searchUrl: source.searchUrl,
        ruleContent: source.ruleContent,
        ruleBookInfo: source.ruleBookInfo,
        ruleToc: source.ruleToc,
        header: source.header,
    });
    const loginText = JSON.stringify({
        loginUrl: source.loginUrl,
        loginCheckJs: source.loginCheckJs,
        ruleLogin: source.ruleLogin,
        ruleUserInfo: source.ruleUserInfo,
        comment: entry.comment,
    });
    const headerText = JSON.stringify(source.header || {});
    return {
        webView: /webView/i.test(text),
        login: Boolean(source.loginUrl)
            || /getLoginInfoMap|source\.login|cookie\.getKey|cookie\.getCookie|java\.getCookie/i.test(text)
            || /登录|登入|账号|賬號|鐧诲綍|login required|please login/i.test(loginText),
        signedApi: /token|authorization|signature|sign_key|md5Encode|aesBase64/i.test(text) && !/cookie|getCookie/i.test(headerText),
        browser: /startBrowser|startBrowserAwait|openUrl/i.test(text),
    };
}

function applyKnownSourceOverrides(adapter, entry, source) {
    const sourceUrl = String(source.bookSourceUrl || entry.url || '');
    if (/pixiv\.net/i.test(sourceUrl)) {
        adapter.tags.push('pixiv');
        adapter.loginRequired = true;
        adapter.webViewRequired = true;
        adapter.warnings.push('Pixiv sources normally need authenticated cookies and browser headers');
    }
    if (/pan\.baidu\.com|jianguoyun\.com/i.test(sourceUrl)) {
        adapter.tags.push('cloud-drive');
        adapter.loginRequired = true;
        adapter.warnings.push('Cloud drive sources usually need user cookies and directory configuration');
    }
    if (/yikm\.net|4399\.com/i.test(sourceUrl)) {
        adapter.tags.push('game-link');
        adapter.browserRequired = true;
    }
    if (/ikanbot|cupfox|shanhuzs|4kwo|qdm/i.test(sourceUrl)) {
        adapter.tags.push('video-lines');
    }
}

function groupVideoEntries(entries) {
    let currentLine = 'default';
    return (entries || []).map(entry => {
        if (entry.isVolume || !entry.url) {
            currentLine = entry.name || currentLine;
            return { ...entry, line: currentLine, selectable: false };
        }
        return { ...entry, line: entry.line || currentLine, selectable: entry.selectable !== false };
    });
}

function validatePayloadByCategory(category, payload = {}) {
    const urls = payload.urls || [];
    const text = String(payload.text || payload.content || '');
    if (category === 'novel') {
        if (text.length < 300) return { ok: false, reason: 'short_text' };
        if (/404|not found|error|验证码|captcha/i.test(text.slice(0, 500))) return { ok: false, reason: 'error_text' };
        return { ok: true };
    }
    if (category === 'comic') {
        if (urls.some(isImageUrl) || /<img[\s>]/i.test(String(payload.content || ''))) return { ok: true };
        return { ok: false, reason: 'missing_images' };
    }
    if (category === 'music' || category === 'audio') {
        if (payload.mediaUrl || urls.some(isPlayableAudioUrl)) return { ok: true };
        return { ok: false, reason: 'missing_audio_url' };
    }
    if (category === 'video') {
        if (validMediaUrl(payload.mediaUrl) || urls.some(isPlayableVideoUrl) || urls.some(isHttpUrl)) return { ok: true };
        return { ok: false, reason: 'missing_video_url' };
    }
    if (category === 'game' || category === 'special') {
        if (payload.mediaUrl || urls.length || text.length > 20) return { ok: true };
        return { ok: false, reason: 'missing_link_or_content' };
    }
    return text || urls.length ? { ok: true } : { ok: false, reason: 'empty_payload' };
}

function isImageUrl(url) {
    return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(String(url || ''));
}

function isPlayableAudioUrl(url) {
    const text = String(url || '');
    return /\.(mp3|m4a|aac|flac|wav|ogg|m3u8)(?:[?#]|$)/i.test(text)
        || /\/hls(?:\.m3u8)?(?:[?#]|$)/i.test(text);
}

function isPlayableVideoUrl(url) {
    return /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(String(url || ''));
}

function isVideoParserUrl(url) {
    const text = String(url || '');
    if (!/^https?:\/\//i.test(text)) return false;
    if (/(search|detail|voddetail|comment|rank|module|novel)\b/i.test(text)) return false;
    return /(player|play|pframe|iframe|jx\.|\/jx\/|m3u8\.php|dplayer|parse|url=)/i.test(text);
}

function isHttpUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
}

function isLikelyPlayableUrl(url) {
    const text = String(url || '');
    if (!/^https?:\/\//i.test(text)) return false;
    if (isVideoParserUrl(text)) return true;
    if (/\.(html?|php|asp|aspx|jsp)(\?|$)/i.test(text)) return false;
    if (/(search|detail|voddetail|playurl|api\/|\/api|comment|rank|module|novel)\b/i.test(text)) return false;
    return /(m3u8|mp4|mp3|m4a|flac|aac|play|stream|media|audio|video|music|cdn|oss|cos|vod)/i.test(text);
}

function validMediaUrl(url) {
    const text = String(url || '').trim();
    if (!text || /^(javascript|about|data:;)/i.test(text)) return '';
    if (/^https?:\/\//i.test(text) && !isPlayableAudioUrl(text) && !isPlayableVideoUrl(text) && !isLikelyPlayableUrl(text)) return '';
    return text;
}

function extractUrlLike(value) {
    return String(value || '').match(/https?:\/\/[^\s"'<>\\]+/g) || [];
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

module.exports = {
    createAdapter,
    categoryCapabilities,
};
