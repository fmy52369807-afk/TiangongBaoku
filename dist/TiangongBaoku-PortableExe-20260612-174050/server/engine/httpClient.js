/**
 * HTTP proxy client — fetch URLs with headers, bypass CORS
 */
const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const { URL } = require('url');
const config = require('../config');

/**
 * Fetch a URL and return the response body as string.
 * Handles redirects up to 5 hops.
 */
function fetchUrl(url, options = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
        if (!/^https?:\/\//i.test(String(url || '').trim())) {
            reject(new Error('Invalid URL: ' + url));
            return;
        }
        const opts = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/json,application/xhtml+xml,*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                ...options.headers,
            },
            method: options.method || 'GET',
            body: normalizeBody(options.body),
            timeout,
        };

        // Handle POST
        if (opts.method === 'POST' && opts.body) {
            opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/x-www-form-urlencoded';
            opts.headers['Content-Length'] = Buffer.byteLength(opts.body);
        }

        _doFetch(url, opts, 0, resolve, reject);
    });
}

function normalizeBody(body) {
    if (body === undefined || body === null) return null;
    if (Buffer.isBuffer(body) || typeof body === 'string') return body;
    if (typeof body === 'object') return JSON.stringify(body);
    return String(body);
}

function _doFetch(urlStr, opts, redirectCount, resolve, reject) {
    if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(urlStr);
    } catch (e) {
        return reject(new Error('Invalid URL: ' + urlStr));
    }

    const validationError = validateFetchUrl(parsedUrl);
    if (validationError) {
        return reject(new Error(validationError));
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: opts.method,
        headers: opts.headers,
        timeout: opts.timeout,
        rejectUnauthorized: config.rejectUnauthorized,
    };

    const req = client.request(reqOptions, (res) => {
        // Handle redirect
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, urlStr).href;
            res.destroy();
            return _doFetch(redirectUrl, opts, redirectCount + 1, resolve, reject);
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
            let body = Buffer.concat(chunks);

            // Handle gzip/deflate/brotli decompression
            const encoding = (res.headers['content-encoding'] || '').toLowerCase();
            try {
                if (encoding === 'gzip' || encoding === 'x-gzip') {
                    body = zlib.gunzipSync(body);
                } else if (encoding === 'deflate') {
                    body = zlib.inflateSync(body);
                } else if (encoding === 'br') {
                    body = zlib.brotliDecompressSync(body);
                }
            } catch (e) {
                // Decompress failed, try raw body
            }

            // Try to decode
            let text;
            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('charset=gb') || contentType.includes('charset=GB')) {
                const iconv = _tryIconv();
                if (iconv) {
                    text = iconv.decode(body, 'gbk');
                } else {
                    text = body.toString('utf-8');
                }
            } else {
                text = body.toString('utf-8');
            }

            const challengeCookie = extractJsCookieChallenge(text);
            if (challengeCookie && redirectCount < 5) {
                opts.headers.Cookie = mergeCookieHeader(opts.headers.Cookie, challengeCookie);
                return _doFetch(urlStr, opts, redirectCount + 1, resolve, reject);
            }

            resolve(text);
        });
        res.on('error', reject);
    });

    req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
    });
    req.on('error', reject);

    if (opts.method === 'POST' && opts.body) {
        req.write(opts.body);
    }
    req.end();
}

function extractJsCookieChallenge(text) {
    const match = String(text || '').match(/document\.cookie\s*=\s*["']([^"']+)["']/i);
    if (!match) return '';
    const cookie = match[1].split(';')[0].trim();
    if (!/^[^=]+=[^=]+$/.test(cookie)) return '';
    return cookie;
}

function mergeCookieHeader(current, nextCookie) {
    if (!current) return nextCookie;
    const name = nextCookie.split('=')[0];
    const parts = String(current).split(';').map(item => item.trim()).filter(Boolean);
    const kept = parts.filter(item => item.split('=')[0] !== name);
    kept.push(nextCookie);
    return kept.join('; ');
}

function validateFetchUrl(parsedUrl) {
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return 'Only HTTP and HTTPS URLs are allowed';
    }

    if (config.allowPrivateNetworkFetch) return null;

    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        return 'Private network URLs are not allowed';
    }

    const ipType = net.isIP(hostname);
    if (ipType === 4 && isPrivateIpv4(hostname)) {
        return 'Private network URLs are not allowed';
    }
    if (ipType === 6 && isPrivateIpv6(hostname)) {
        return 'Private network URLs are not allowed';
    }

    return null;
}

function isPrivateIpv4(ip) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;

    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
    );
}

function isPrivateIpv6(ip) {
    const normalized = ip.toLowerCase();
    return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:')
    );
}

let _iconv = null;
function _tryIconv() {
    if (_iconv !== null) return _iconv;
    try {
        _iconv = require('iconv-lite');
        return _iconv;
    } catch {
        _iconv = false;
        return null;
    }
}

module.exports = { fetchUrl };
