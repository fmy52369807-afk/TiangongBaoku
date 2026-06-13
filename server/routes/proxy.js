/**
 * HTTP proxy and media helper functions for content routes.
 */

const net = require('net');
const http = require('http');
const https = require('https');
const config = require('../config');

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
    const { safeHeaderUrl } = require('./url-utils');
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
    const { safeHeaderUrl } = require('./url-utils');
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

module.exports = {
    isBlockedProxyHost,
    fetchBinary,
    probeDirectMediaUrl,
    contentTypeFromUrl,
    isHlsPlaylistUrl,
    hlsProxyUrl,
    rewriteHlsAttribute,
    rewriteHlsPlaylist,
    contentTypeFromMediaUrl,
};
