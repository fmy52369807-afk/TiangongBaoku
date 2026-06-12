const vm = require('vm');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { JSONPath } = require('jsonpath-plus');

function runJsRule(jsCode, context = {}, timeout = 5000) {
    const sandbox = buildSandbox(context, timeout);
    const normalizedCode = normalizeReturnCode(jsCode);
    const expressionCode = looksLikeExpression(jsCode)
        ? `try { var __exprResult = (${jsCode}); if (__exprResult !== undefined) return __exprResult; } catch (__exprError) {}`
        : '';
    const scriptCode = `
        (function() {
            ${expressionCode}
            ${normalizedCode}
            return result;
        })();
    `;

    try {
        const script = new vm.Script(scriptCode, { filename: 'rule.js' });
        const vmContext = vm.createContext(sandbox);
        const value = script.runInContext(vmContext, { timeout });
        if (value !== undefined) return value;
        if (sandbox.result !== undefined) return sandbox.result;
        return null;
    } catch (err) {
        console.error('[JS Runtime] Error:', err.message);
        return null;
    }
}

function normalizeReturnCode(jsCode) {
    const code = String(jsCode || '');
    if (hasTopLevelReturn(code)) return code;
    const trimmed = code.trim();
    const split = splitLastStatement(trimmed);
    if (!split || !split.last) return code;
    const before = split.before;
    const expr = split.last.replace(/;\s*$/, '').trim();
    const tailStart = before.length;
    const openComment = trimmed.lastIndexOf('/*', tailStart);
    const closeComment = trimmed.lastIndexOf('*/', tailStart);
    if (openComment > closeComment) return code;
    if (!isReturnableExpression(expr)) return code;
    return `${before}return (${expr});`;
}

function hasTopLevelReturn(code) {
    let quote = '';
    let depth = 0;
    let lineComment = false;
    let blockComment = false;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1];
        if (lineComment) {
            if (ch === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (ch === '*' && next === '/') {
                blockComment = false;
                i++;
            }
            continue;
        }
        if (quote) {
            if (ch === quote && code[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '/' && next === '/') {
            lineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            blockComment = true;
            i++;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (depth === 0 && code.slice(i).match(/^return\b/)) return true;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
    return false;
}

function splitLastStatement(code) {
    let quote = '';
    let depth = 0;
    let lastBreak = -1;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (quote) {
            if (ch === quote && code[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        if ((ch === ';' || ch === '\n') && depth === 0 && code.slice(i + 1).trim()) lastBreak = i;
    }
    return {
        before: lastBreak >= 0 ? code.slice(0, lastBreak + 1) : '',
        last: lastBreak >= 0 ? code.slice(lastBreak + 1).trim() : code.trim(),
    };
}

function isReturnableExpression(expr) {
    const text = String(expr || '').trim();
    if (!text) return false;
    if (/^(var|let|const|if|for|while|switch|try|catch|function|class|throw|return)\b/.test(text)) return false;
    if (/^[A-Za-z_$][\w$]*\s*=/.test(text)) return false;
    if (/[+\-*/%&|^!?<>]=/.test(text)) return false;
    return true;
}

function looksLikeExpression(jsCode) {
    const text = String(jsCode || '').trim();
    if (!text || text.includes('\n') || text.includes(';')) return false;
    if (/^(var|let|const|if|for|while|switch|try|function|return)\b/.test(text)) return false;
    if (/\bresult\s*=/.test(text)) return false;
    return true;
}

function extractNestedJsRule(rule) {
    const text = String(rule || '').trim();
    if (text.startsWith('@js:')) return text.slice(4);
    const match = text.match(/^<js>([\s\S]*)<\/js>$/i);
    return match ? match[1] : '';
}

function buildSandbox(ctx, timeout) {
    const sessionStore = new Map(Object.entries(ctx.variables || {}));
    let currentContent = ctx.result || '';
    const originalContent = ctx.rawResult !== undefined ? ctx.rawResult : ctx.result;

    const readVar = (key) => {
        const direct = sessionStore.get(String(key));
        if (direct !== undefined) return direct;
        const legacy = sessionStore.get('_java_get_' + key);
        return legacy !== undefined ? legacy : '';
    };
    const writeVar = (key, value) => {
        sessionStore.set(String(key), value);
        sessionStore.set('_java_get_' + key, value);
        if (ctx.variables && typeof ctx.variables === 'object') ctx.variables[key] = value;
        return value;
    };
    const ruleContext = () => ({
        baseUrl: ctx.baseUrl || '',
        result: currentContent,
        key: ctx.key || '',
        page: ctx.page || 1,
        book: ctx.book || {},
        chapter: ctx.chapter || {},
    });
    const safeAjax = (url) => {
        const clean = String(url || '').split(',{')[0].trim();
        if (!/^https?:\/\//i.test(clean)) return '';
        return '';
    };

    const sandbox = {
        result: ctx.result || '',
        src: originalContent || '',
        baseUrl: ctx.baseUrl || '',
        key: ctx.key || '',
        page: ctx.page || 1,
        book: ctx.book || {},
        chapter: ctx.chapter || {},

        java: {
            ajax(url) {
                return safeAjax(url);
            },
            ajaxAll(urls) {
                return (urls || []).map(url => {
                    const body = safeAjax(url);
                    return {
                        body: () => body,
                        code: () => body ? 200 : 0,
                    };
                });
            },
            get(key) {
                return readVar(key);
            },
            put(key, value) {
                writeVar(key, value);
                if (key === 'key') sandbox.key = value;
                if (key === 'page') sandbox.page = value;
                return value;
            },
            getString(rule, input) {
                const target = input === undefined ? currentContent : input;
                const nestedJs = extractNestedJsRule(rule);
                if (nestedJs) {
                    return runJsRule(nestedJs, {
                        ...ctx,
                        result: target,
                        rawResult: originalContent,
                        variables: Object.fromEntries(sessionStore),
                    }, timeout);
                }
                return simpleRuleValue(target, rule, ruleContext());
            },
            getStringList(rule, input) {
                const values = simpleRuleList(input === undefined ? currentContent : input, rule, ruleContext())
                    .map(item => simpleRuleValue(item, 'text', ruleContext()));
                values.toArray = () => values;
                return values;
            },
            getElements(rule, input) {
                const values = simpleRuleList(input === undefined ? currentContent : input, rule, ruleContext())
                    .map(item => wrapElement(item, ctx.baseUrl || ''));
                values.toArray = () => values;
                values.isEmpty = () => values.length === 0;
                return values;
            },
            getElement(rule, input) {
                return this.getElements(rule, input)[0] || wrapElement('', ctx.baseUrl || '');
            },
            setContent(value) {
                currentContent = value;
                sandbox.result = value;
                sandbox.src = value;
                return value;
            },
            toast() {},
            longToast() {},
            log() {},
            startBrowser(url) {
                return url;
            },
            startBrowserAwait(url) {
                return url;
            },
            openUrl(url) {
                return url;
            },
            timeFormat(timestamp) {
                return formatTime(timestamp, 0);
            },
            timeFormatUTC(timestamp, fmt, offset) {
                return formatTime(timestamp, offset || 8);
            },
            base64Encode(str) {
                return Buffer.from(String(str || '')).toString('base64');
            },
            base64Decode(str) {
                return Buffer.from(String(str || ''), 'base64').toString('utf-8');
            },
            hexDecodeToString(hex) {
                return Buffer.from(String(hex || ''), 'hex').toString('utf-8');
            },
            md5Encode(str) {
                return crypto.createHash('md5').update(String(str || '')).digest('hex');
            },
            md5Encode16(str) {
                return crypto.createHash('md5').update(String(str || '')).digest('hex').substring(8, 24);
            },
            aesBase64DecodeToString(str, key, transformation, iv) {
                return aesBase64DecodeToString(str, key, transformation, iv);
            },
            encodeURI: value => encodeURI(String(value || '')),
            encodeURIComponent: value => encodeURIComponent(String(value || '')),
            decodeURI: value => decodeURI(String(value || '')),
            decodeURIComponent: value => decodeURIComponent(String(value || '')),
            t2s: value => String(value || ''),
            s2t: value => String(value || ''),
            setCookie(url, cookie) {
                sessionStore.set('_cookie_' + url, cookie);
            },
            getCookie(url) {
                return sessionStore.get('_cookie_' + url) || '';
            },
            removeCookie(url) {
                sessionStore.delete('_cookie_' + url);
            },
            get(url, headers) {
                const body = safeAjax(url);
                return { body: () => body, headers: () => headers || {} };
            },
        },

        cookie: {
            getKey(domain, key) {
                return sessionStore.get(`_cookie_${domain}_${key}`) || '';
            },
            setKey(domain, key, value) {
                sessionStore.set(`_cookie_${domain}_${key}`, value);
            },
            getCookie(url) {
                return sessionStore.get('_cookie_' + url) || '';
            },
            removeCookie(domain) {
                for (const key of sessionStore.keys()) {
                    if (key.startsWith(`_cookie_${domain}`)) sessionStore.delete(key);
                }
                return '';
            },
        },

        source: {
            _vars: {},
            key: ctx.sourceKey || ctx.sourceBookSourceUrl || ctx.baseUrl || '',
            bookSourceUrl: ctx.sourceBookSourceUrl || ctx.sourceKey || ctx.baseUrl || '',
            bookSourceComment: ctx.sourceComment || '',
            get(key) {
                return readVar(key) || this._vars[key] || '';
            },
            put(key, value) {
                this._vars[key] = value;
                writeVar(key, value);
                return value;
            },
            setVariable(value) {
                this._vars._variable = value;
                writeVar('_source_variable', value);
            },
            getVariable() {
                return this._vars._variable || readVar('_source_variable') || '';
            },
            getKey() {
                return this.key || this.bookSourceUrl || '';
            },
            getLoginInfoMap() {
                return { get: key => sessionStore.get('_login_' + key) || '' };
            },
            login() {
                return true;
            },
        },

        cache: {
            _store: new Map(),
            get(key) {
                return this._store.get(key);
            },
            put(key, value) {
                this._store.set(key, value);
                return value;
            },
        },

        JSON: {
            ...JSON,
            parse(value, reviver) {
                if (value && typeof value === 'object') return value;
                return JSON.parse(value, reviver);
            },
        },
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Date,
        RegExp,
        parseInt,
        parseFloat,
        encodeURI,
        decodeURI,
        encodeURIComponent,
        decodeURIComponent,
        isNaN,
        isFinite,
        setTimeout: () => {},
        setInterval: () => {},
        console: { log: () => {}, error: () => {}, warn: () => {} },
    };

    sandbox.org = {
        jsoup: {
            Jsoup: {
                parse(value) {
                    return wrapElement(value, ctx.baseUrl || '');
                },
            },
        },
    };
    sandbox.Packages = {
        android: { text: { TextUtils: { isEmpty: str => !str || String(str).length === 0 } } },
        java: { lang: { String, Integer: { parseInt } }, util: { Base64: { getDecoder: () => ({ decode: value => Buffer.from(String(value || ''), 'base64') }) } } },
        javax: { crypto: { spec: {}, Cipher: { getInstance: () => ({ init() {}, doFinal: () => Buffer.from('') }) } } },
    };

    return sandbox;
}

function simpleRuleList(input, rule, context) {
    const text = normalizeRule(String(rule || ''));
    if (!text) return [];
    const data = parseJsonMaybe(input);
    if (isObjectLike(data) && isJsonRule(text)) {
        try {
            return JSONPath({ path: normalizeJsonPath(text), json: data }) || [];
        } catch {
            return [];
        }
    }
    const html = stringifySafe(input);
    const $ = cheerio.load(html);
    const parsed = parseSimpleCss(text);
    try {
        return $(parsed.selector).toArray().map(el => $.html(el));
    } catch {
        return [];
    }
}

function simpleRuleValue(input, rule, context) {
    const text = normalizeRule(String(rule || ''));
    if (!text) return String(input || '');
    if (text.includes('{{')) return applySimpleTemplate(text, input, context);
    if (text === 'text' || text === 'textNodes') return wrapElement(input, context.baseUrl).text();
    if (text === 'html' || text === 'all') return stringifySafe(input);
    if (text === 'href' || text === 'src' || text.startsWith('data-')) return wrapElement(input, context.baseUrl).attr(text);

    const data = parseJsonMaybe(input);
    if (isObjectLike(data) && isJsonRule(text)) {
        try {
            const values = JSONPath({ path: normalizeJsonPath(text), json: data }) || [];
            return formatValue(values[0]);
        } catch {
            return '';
        }
    }

    const html = stringifySafe(input);
    const $ = cheerio.load(html);
    const parsed = parseSimpleCss(text);
    const el = $(parsed.selector).eq(parsed.index || 0);
    if (!el.length) return '';
    if (parsed.modifier === 'html' || parsed.modifier === 'all') return el.html() || '';
    if (parsed.modifier === 'href' || parsed.modifier === 'src' || parsed.modifier.startsWith('data-')) {
        const raw = el.attr(parsed.modifier) || '';
        try { return new URL(raw, context.baseUrl || '').href; } catch { return raw; }
    }
    return el.text().trim();
}

function wrapElement(value, baseUrl) {
    const html = stringifySafe(value);
    const $ = cheerio.load(html);
    const root = $.root().children().first();
    const current = root.length ? root : $.root();
    return {
        html: () => root.length ? $.html(root) : html,
        text: () => current.text().trim(),
        attr: (name) => {
            const raw = current.attr(name) || '';
            if ((name === 'href' || name === 'src') && raw) {
                try { return new URL(raw, baseUrl).href; } catch { return raw; }
            }
            return raw;
        },
        select: (selector) => {
            const list = current.find(selector).toArray().map(el => wrapElement($.html(el), baseUrl));
            list.toArray = () => list;
            list.isEmpty = () => list.length === 0;
            list.attr = name => list[0] ? list[0].attr(name) : '';
            list.text = () => list.map(item => item.text()).join('');
            list.html = () => list.map(item => item.html()).join('');
            return list;
        },
        parentNode: () => wrapElement(current.parent().length ? $.html(current.parent()) : '', baseUrl),
        parent: () => wrapElement(current.parent().length ? $.html(current.parent()) : '', baseUrl),
        toString: () => root.length ? $.html(root) : html,
    };
}

function normalizeRule(rule) {
    return String(rule || '').trim()
        .replace(/^@(css|json|jsonp|JSon):/i, '')
        .replace(/^@(xpath|XPath):/i, '');
}

function parseSimpleCss(rule) {
    let text = String(rule || '').trim();
    let modifier = 'text';
    const parts = text.split('@').filter(Boolean);
    let selector = parts.shift() || '';
    if (parts.length) modifier = parts.pop();
    selector = selector
        .replace(/^class\./g, '.')
        .replace(/(^|[\s>+~])class\./g, '$1.')
        .replace(/^id\./g, '#')
        .replace(/(^|[\s>+~])id\./g, '$1#')
        .replace(/(^|[\s>+~])tag\./g, '$1')
        .replace(/\[(-?\d+)\]/g, '');
    let index = 0;
    selector = selector.replace(/\.(-?\d+)$/, (_, n) => {
        index = Number(n);
        return '';
    });
    if (!selector || ['text', 'textNodes', 'html', 'all', 'href', 'src'].includes(selector)) {
        modifier = selector || modifier;
        selector = 'body';
    }
    return { selector, modifier, index };
}

function applySimpleTemplate(template, input, context) {
    return String(template || '').replace(/\{\{([\s\S]+?)\}\}/g, (_, expr) => {
        const key = expr.trim();
        if (key === 'key') return context.key || '';
        if (key === 'page') return context.page || 1;
        if (key === 'baseUrl') return context.baseUrl || '';
        return simpleRuleValue(input, key, context);
    });
}

function parseJsonMaybe(input) {
    if (isObjectLike(input)) return input;
    try { return JSON.parse(String(input)); } catch { return input; }
}

function isJsonRule(rule) {
    const text = String(rule || '').trim();
    return text.startsWith('$') || text === '[*]' || /^[a-zA-Z_$][\w$]*(?:\.|\[)/.test(text);
}

function normalizeJsonPath(rule) {
    const text = String(rule || '').trim();
    if (text === '[*]') return '$[*]';
    if (text.startsWith('$')) return text;
    return '$.' + text;
}

function formatValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return stringifySafe(value);
    return String(value);
}

function stringifySafe(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value.html === 'function') {
        try { return value.html(); } catch {}
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
        try {
            const text = value.toString();
            if (text && text !== '[object Object]') return text;
        } catch {}
    }
    try {
        return JSON.stringify(value);
    } catch {
        try {
            const seen = new WeakSet();
            return JSON.stringify(value, (key, item) => {
                if (typeof item === 'object' && item !== null) {
                    if (seen.has(item)) return undefined;
                    seen.add(item);
                }
                if (typeof item === 'function') return undefined;
                return item;
            });
        } catch {
            return String(value);
        }
    }
}

function isObjectLike(value) {
    return typeof value === 'object' && value !== null;
}

function formatTime(timestamp, offsetHours = 0) {
    const n = Number(timestamp);
    const d = new Date(n < 10000000000 ? n * 1000 : n);
    if (isNaN(d.getTime())) return String(timestamp || '');
    const time = offsetHours ? new Date(d.getTime() + offsetHours * 3600000) : d;
    return time.toISOString().replace('T', ' ').slice(0, 19);
}

function aesBase64DecodeToString(str, key, transformation, iv) {
    const keyBuf = Buffer.from(String(key || ''), 'utf8');
    const ivBuf = Buffer.from(String(iv || '').slice(0, 16).padEnd(16, '\0'), 'utf8');
    const size = keyBuf.length === 32 ? 256 : keyBuf.length === 24 ? 192 : 128;
    const mode = String(transformation || '').toUpperCase().includes('/ECB/') ? 'ecb' : 'cbc';
    const algorithm = `aes-${size}-${mode}`;
    const decipher = crypto.createDecipheriv(algorithm, keyBuf.slice(0, size / 8), mode === 'ecb' ? null : ivBuf);
    decipher.setAutoPadding(!String(transformation || '').toUpperCase().includes('NOPADDING'));
    return Buffer.concat([
        decipher.update(Buffer.from(String(str || ''), 'base64')),
        decipher.final(),
    ]).toString('utf8');
}

module.exports = { runJsRule };
