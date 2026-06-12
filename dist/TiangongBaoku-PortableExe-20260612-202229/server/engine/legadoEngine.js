const cheerio = require('cheerio');
const { JSONPath } = require('jsonpath-plus');
const { fetchUrl } = require('./httpClient');
const { runJsRule } = require('./jsRuntime');

const htmlTags = new Set([
    'a', 'abbr', 'article', 'aside', 'body', 'br', 'button', 'dd', 'div', 'dl', 'dt',
    'em', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
    'html', 'i', 'img', 'input', 'label', 'li', 'main', 'meta', 'nav', 'ol', 'option',
    'p', 'pre', 'script', 'section', 'select', 'small', 'span', 'strong', 'table',
    'tbody', 'td', 'textarea', 'th', 'thead', 'title', 'tr', 'ul',
]);

function cleanSourceUrl(url) {
    const text = String(url || '').trim();
    if (!text) return '';
    const hashHash = text.indexOf('##');
    const clean = hashHash >= 0 ? text.slice(0, hashHash) : text;
    try {
        const parsed = new URL(clean);
        parsed.hash = '';
        return parsed.href.replace(/\/$/, '');
    } catch {
        return clean.replace(/#.*$/, '').replace(/\/$/, '');
    }
}

function createContext(source, overrides = {}) {
    const sourceUrl = cleanSourceUrl(source && source.bookSourceUrl);
    return {
        source: source || {},
        sourceUrl,
        baseUrl: overrides.baseUrl || sourceUrl,
        result: overrides.result,
        key: overrides.key || '',
        page: overrides.page || 1,
        book: overrides.book || {},
        chapter: overrides.chapter || {},
        variables: overrides.variables || {},
        timeout: overrides.timeout || 5000,
    };
}

async function fetchSourceUrl(url, context, options = {}) {
    const built = buildUrl(url, context);
    if (!built.url || !/^https?:\/\//i.test(built.url)) return '';
    const headers = {
        ...parseHeader(context.source && context.source.header),
        ...built.headers,
        ...(options.headers || {}),
    };
    return fetchUrl(built.url, { headers, method: built.method, body: built.body }, options.timeout);
}

function buildUrl(url, context = {}) {
    let text = String(url || '').trim();
    if (!text) return { url: '', headers: {} };

    const jsSuffix = text.match(/^([\s\S]*?)(?:\r?\n)+@js:([\s\S]+)$/);
    if (jsSuffix) {
        text = jsSuffix[1].trim();
        runJs(jsSuffix[2], '', context);
    }

    if (text.startsWith('<js>') && text.endsWith('</js>')) {
        text = '@js:' + text.slice(4, -5);
    }

    if (text.startsWith('@js:')) {
        text = String(runJs(text.slice(4), '', context) || '');
    }

    text = applyTemplate(text, context);
    text = applyPageConditionals(text, context);
    text = applyVariableReads(text, context);

    const parsedOptions = parseUrlOptions(text);
    text = parsedOptions.url;
    text = resolveUrl(text, context.baseUrl || context.sourceUrl || '');
    text = stripUrlComment(text);

    return { ...parsedOptions, url: text };
}

function applyPageConditionals(url, context = {}) {
    const page = Number(context.page || 1);
    return String(url || '').replace(/(-?)<,([^>]*)>/g, (match, prefix, content) => {
        return page > 1 ? prefix + content : '';
    });
}

function runRule(input, rule, context = {}) {
    if (rule === undefined || rule === null || rule === '') return input;

    const local = { ...context, result: input, rawResult: context.rawResult !== undefined ? context.rawResult : input };
    const alternatives = splitTopLevel(String(rule), '||');
    if (alternatives.length > 1) {
        for (const alt of alternatives) {
            const value = runRule(input, alt, local);
            if (isUseful(value, alt)) return value;
        }
        return '';
    }

    const chain = splitRuleChain(String(rule));
    let current = input;
    for (const segment of chain) {
        current = runRuleSegment(current, segment, { ...local, result: current });
    }
    return current;
}

function runRuleList(input, rule, context = {}) {
    if (rule === undefined || rule === null || rule === '') return Array.isArray(input) ? input : [input];

    const local = { ...context, rawResult: context.rawResult !== undefined ? context.rawResult : input };

    const alternatives = splitTopLevel(String(rule), '||');
    if (alternatives.length > 1) {
        for (const alt of alternatives) {
            const value = runRuleList(input, alt, local);
            if (value && value.length) return value;
        }
        return [];
    }

    const chain = splitRuleChain(String(rule));
    if (!chain.length) return [];

    let current = runListSegment(input, chain[0], { ...local, result: input });
    for (const segment of chain.slice(1)) {
        const normalizedSegment = normalizeRulePrefix(String(segment || '').trim());
        if (normalizedSegment.startsWith('@js:') || normalizedSegment.startsWith('<js>')) {
            current = runListSegment(current, segment, { ...local, result: current });
        } else {
            current = current.flatMap(item => {
                const value = runRuleList(item, segment, { ...local, result: item });
                return value && value.length ? value : [runRule(item, segment, { ...local, result: item })];
            });
        }
    }
    return current.filter(item => item !== undefined && item !== null && String(item) !== '');
}

function runRuleSegment(input, rawSegment, context) {
    let segment = String(rawSegment || '').trim();
    if (!segment) return input;
    segment = normalizeRulePrefix(segment);

    if (segment.startsWith('<js>') && segment.endsWith('</js>')) {
        segment = '@js:' + segment.slice(4, -5);
    }

    const inlineJs = extractInlineJsTag(segment);
    if (inlineJs) {
        let value = inlineJs.before ? runRuleSegment(input, inlineJs.before, context) : input;
        value = runJs(inlineJs.code, value, context);
        if (inlineJs.after && inlineJs.after.startsWith('##')) {
            const regexParts = splitRegexReplace('__value__' + inlineJs.after);
            return normalizeValue(applyRegexReplacements(value, regexParts.replacements));
        }
        return inlineJs.after ? runRuleSegment(value, inlineJs.after, { ...context, result: value }) : normalizeValue(value);
    }

    if (segment.startsWith('@put:')) {
        applyPutRule(input, segment, context);
        return input;
    }

    if (segment.startsWith('@get:')) {
        const key = (segment.match(/^@get:\{?([^}\s]+)\}?/) || [])[1];
        const rest = segment.replace(/^@get:\{?[^}\s]+\}?\s*/, '');
        const value = key ? context.variables[key] : '';
        return rest ? runRule(value, rest, context) : value;
    }

    if (segment.startsWith('@js:')) {
        return runJs(segment.slice(4), input, context);
    }

    const jsIndex = findJsSuffix(segment);
    let jsCode = '';
    if (jsIndex >= 0) {
        jsCode = segment.slice(jsIndex + 4);
        segment = segment.slice(0, jsIndex);
    }

    let putRule = '';
    const putIndex = segment.indexOf('@put:');
    if (putIndex > 0) {
        putRule = segment.slice(putIndex);
        segment = segment.slice(0, putIndex).trim();
    }

    const regexParts = splitRegexReplace(segment);
    segment = regexParts.rule;

    let value;
    const jsonInput = parseJsonMaybe(input);
    if (segment.includes('{{')) {
        value = applyTemplate(segment, { ...context, result: input });
        value = applyVariableReads(value, context);
    } else if (isJsonPathRule(segment) || (isObjectLike(jsonInput) && isJsonPathShorthand(segment))) {
        value = jsonRuleValue(input, segment);
    } else if (isXPathRule(segment)) {
        value = cssValue(input, xpathToCss(segment), context.baseUrl || context.sourceUrl || '');
    } else if (isCssRule(segment) || isRootModifier(segment)) {
        value = cssValue(input, segment, context.baseUrl || context.sourceUrl || '');
    } else if (isPlainObject(input) && Object.prototype.hasOwnProperty.call(input, segment)) {
        value = input[segment];
    } else {
        value = segment || input;
    }

    value = applyRegexReplacements(value, regexParts.replacements);
    if (putRule) applyPutRule(input, putRule, context);

    if (jsCode) {
        value = runJs(jsCode, value, context);
    }

    return normalizeValue(value);
}

function runListSegment(input, rawSegment, context) {
    let segment = String(rawSegment || '').trim();
    if (!segment) return Array.isArray(input) ? input : [input];
    segment = normalizeRulePrefix(segment);
    const reverse = segment.startsWith('-');
    if (reverse) segment = normalizeRulePrefix(segment.slice(1).trim());

    if (segment.startsWith('<js>') && segment.endsWith('</js>')) {
        segment = '@js:' + segment.slice(4, -5);
    }

    if (segment.startsWith('@js:')) {
        const value = runJs(segment.slice(4), input, context);
        return Array.isArray(value) ? value : tryJsonArray(value);
    }

    let putRule = '';
    const putIndex = segment.indexOf('@put:');
    if (putIndex > 0) {
        putRule = segment.slice(putIndex);
        segment = segment.slice(0, putIndex).trim();
    }

    const regexParts = splitRegexReplace(segment);
    segment = regexParts.rule;

    let list = [];
    const jsonInput = parseJsonMaybe(input);
    if (isJsonPathRule(segment) || (isObjectLike(jsonInput) && isJsonPathShorthand(segment))) {
        list = jsonValues(input, segment);
        if (list.length === 1 && Array.isArray(list[0])) list = list[0];
    } else if (isObjectLike(jsonInput) && !Array.isArray(jsonInput) && Object.prototype.hasOwnProperty.call(jsonInput, segment)) {
        const value = jsonInput[segment];
        list = Array.isArray(value) ? value : [value];
    } else if (isXPathRule(segment)) {
        list = cssList(input, xpathToCss(segment));
    } else if (isCssRule(segment) || looksLikeSelector(segment)) {
        list = cssList(input, segment);
    } else if (Array.isArray(input)) {
        list = input;
    } else {
        list = [input];
    }

    if (regexParts.replacements.length) {
        list = list.map(item => applyRegexReplacements(item, regexParts.replacements));
    }

    if (putRule) applyPutRule(input, putRule, context);
    if (reverse) list.reverse();
    return list;
}

function runJs(jsCode, input, context = {}) {
    const sourceLib = context.source && context.source.jsLib ? String(context.source.jsLib) : '';
    const code = sourceLib && !String(jsCode || '').includes(sourceLib)
        ? sourceLib + '\n' + String(jsCode || '')
        : String(jsCode || '');
    return runJsRule(code, {
        result: input,
        rawResult: context.rawResult !== undefined ? context.rawResult : input,
        baseUrl: context.baseUrl || context.sourceUrl || '',
        key: context.key || '',
        page: context.page || 1,
        book: context.book || {},
        chapter: context.chapter || {},
        variables: context.variables || {},
        sourceKey: context.sourceUrl || '',
        sourceBookSourceUrl: context.sourceUrl || '',
        sourceComment: context.source && context.source.bookSourceComment || '',
    }, context.timeout || 5000);
}

function applyTemplate(template, context = {}) {
    return String(template || '')
        .replace(/\{\{([\s\S]+?)\}\}/g, (match, expr) => {
            const value = evalTemplateExpr(expr.trim(), context);
            return value === undefined || value === null ? '' : String(value);
        })
        .replace(/\{(\$[\s\S]+?)\}/g, (match, expr) => {
        const value = evalTemplateExpr(expr.trim(), context);
        return value === undefined || value === null ? '' : String(value);
    });
}

function applyVariableReads(value, context = {}) {
    return String(value || '').replace(/@get:\{?([A-Za-z0-9_$.-]+)\}?/g, (match, key) => {
        const variables = context.variables || {};
        const value = variables[key] !== undefined ? variables[key] : variables['_java_get_' + key];
        return value === undefined || value === null ? '' : String(value);
    });
}

function normalizeRulePrefix(rule) {
    let text = String(rule || '').trim();
    text = text.replace(/^@(css|json|jsonp|JSon):/i, '');
    text = text.replace(/^@(xpath|XPath):/i, '');
    return text.trim();
}

function extractInlineJsTag(rule) {
    const text = String(rule || '');
    const lower = text.toLowerCase();
    const start = lower.indexOf('<js>');
    if (start < 0) return null;
    const end = lower.indexOf('</js>', start + 4);
    if (end < 0) return null;
    return {
        before: text.slice(0, start).trim(),
        code: text.slice(start + 4, end),
        after: text.slice(end + 5).trim(),
    };
}

function isXPathRule(rule) {
    return /^\/\//.test(String(rule || '').trim());
}

function xpathToCss(rule) {
    let text = String(rule || '').trim();
    const textMode = /\/text\(\)\s*$/.test(text);
    text = text.replace(/\/text\(\)\s*$/, '');
    const attrMode = (text.match(/\/@([a-zA-Z_:][\w:.-]*)\s*$/) || [])[1];
    if (attrMode) text = text.replace(/\/@[a-zA-Z_:][\w:.-]*\s*$/, '');
    text = text
        .replace(/^\/\//, '')
        .replace(/\/\//g, ' ')
        .replace(/\//g, ' > ')
        .replace(/\[@class=['"]([^'"]+)['"]\]/g, '.$1')
        .replace(/\[@id=['"]([^'"]+)['"]\]/g, '#$1')
        .replace(/\[@([a-zA-Z_:][\w:.-]*)=['"]([^'"]+)['"]\]/g, '[$1="$2"]')
        .replace(/\[(\d+)\]/g, (_, n) => `.${Number(n) - 1}`);
    return `${text}${attrMode ? '@' + attrMode : textMode ? '@text' : ''}`;
}

function evalTemplateExpr(expr, context) {
    const alternatives = splitTopLevel(expr, '||');
    if (alternatives.length > 1) {
        for (const alt of alternatives) {
            const value = evalTemplateExpr(alt, context);
            if (isUseful(value, alt)) return value;
        }
        return '';
    }

    if (expr === 'key') return context.key || '';
    if (expr === 'page') return context.page || 1;
    if (expr === 'baseUrl') return context.baseUrl || '';
    if (expr === 'source.key') return context.sourceUrl || '';
    if (expr === 'source.bookSourceUrl') return context.sourceUrl || '';
    if (/^(java|source)\./.test(expr)) return runJs('result = ' + expr, context.result, context);

    const regexParts = splitRegexReplace(expr);
    let value;
    if (isJsonPathRule(regexParts.rule)) {
        value = firstJsonValue(context.result, regexParts.rule);
    } else if (regexParts.rule.startsWith('@') || isCssRule(regexParts.rule)) {
        const cssRule = regexParts.rule.startsWith('@') ? regexParts.rule.slice(1) : regexParts.rule;
        value = cssValue(context.result, cssRule, context.baseUrl || context.sourceUrl || '');
    } else if (isPlainObject(context.result) && Object.prototype.hasOwnProperty.call(context.result, regexParts.rule)) {
        value = context.result[regexParts.rule];
    } else {
        value = '';
    }

    value = applyRegexReplacements(value, regexParts.replacements);
    if (!isUseful(value, expr) && looksLikeTemplateExpression(regexParts.rule)) {
        value = runJs('result = (' + regexParts.rule + ')', context.result, context);
    }
    return value;
}

function looksLikeTemplateExpression(expr) {
    const text = String(expr || '').trim();
    if (!text) return false;
    if (isJsonPathRule(text) || isCssRule(text)) return false;
    return /[+\-*/?:()]|\b(baseUrl|key|page|book|chapter|source|java|Number|String|encodeURI|encodeURIComponent)\b/.test(text);
}

function cssList(input, rule) {
    const html = htmlFromInput(input);
    const $ = cheerio.load(html);
    const parsed = parseCssRule(rule);
    const elements = applyElementRange(selectWithParsedRule($, parsed), parsed);
    if (String(rule || '').includes('@')) {
        return elements.toArray()
            .map(el => applyModifier($(el), parsed.modifiers, $))
            .filter(Boolean);
    }
    return elements.toArray().map(el => $.html(el));
}

function cssValue(input, rule, baseUrl) {
    const html = htmlFromInput(input);
    const $ = cheerio.load(html);
    const textRule = parseTextSelectorRule(rule);
    if (textRule) {
        const el = $('a').toArray()
            .map(node => $(node))
            .find(node => node.text().includes(textRule.text));
        if (!el) return '';
        const value = applyModifier(el, [textRule.modifier], $);
        return (textRule.modifier === 'href' || textRule.modifier === 'src') ? resolveUrl(value, baseUrl) : value;
    }
    const parsed = parseCssRule(rule);

    let el;
    if (parsed.selector) {
        const elements = selectWithParsedRule($, parsed);
        const lastModifier = parsed.modifiers[parsed.modifiers.length - 1];
        if (parsed.range) {
            const ranged = applyElementRange(elements, parsed);
            if (!ranged.length) return '';
            if (lastModifier === 'html' || lastModifier === 'text') {
                return ranged.toArray().map(node => applyModifier($(node), parsed.modifiers, $)).filter(Boolean).join('\n');
            }
            el = ranged.first();
        } else {
            if ((lastModifier === 'html' || lastModifier === 'text') && elements.length > 1 && shouldJoinMultiple(parsed.selector, parsed.index)) {
                return elements.toArray().map(node => applyModifier($(node), parsed.modifiers, $)).filter(Boolean).join('\n');
            }
            el = elements.eq(parsed.index || 0);
        }
    } else {
        el = rootElement($);
    }
    if (!el || !el.length) return '';

    const value = applyModifier(el, parsed.modifiers, $);
    if (parsed.modifiers[parsed.modifiers.length - 1] === 'href' || parsed.modifiers[parsed.modifiers.length - 1] === 'src') {
        return resolveUrl(value, baseUrl);
    }
    return value;
}

function parseTextSelectorRule(rule) {
    const match = String(rule || '').trim().match(/^text\.([^@]+)(?:@([a-zA-Z][\w-]*))?$/);
    if (!match) return null;
    return { text: match[1], modifier: match[2] || 'text' };
}

function shouldJoinMultiple(selector, index) {
    if (index !== 0) return false;
    const text = String(selector || '');
    return (
        /(^|[\s>+~])p($|[\s>+~.#[:])/.test(text) ||
        /#(txt|content|readerArticle|chaptercontent|BookText|TextContent|booktxt|nr1)\b/.test(text) ||
        /\.(article-text|chapter-content|read-content|article-content|content|con|font_max|readcontent)\b/.test(text)
    );
}

function rootElement($) {
    const bodyChildren = $('body').children();
    if (bodyChildren.length === 1) return bodyChildren.first();
    const htmlChildren = $.root().children();
    return htmlChildren.length ? htmlChildren.first() : $('body');
}

function parseCssRule(rule) {
    let text = String(rule || '').trim();
    const startsWithModifier = text.startsWith('@');
    const tokens = splitCssTokens(text);
    let selector = tokens.shift() || '';
    const modifiers = [];

    if (startsWithModifier) {
        if (selector) modifiers.push(selector);
        selector = '';
    }

    while (tokens.length) {
        const token = tokens.shift();
        if (!token) continue;
        if (isAttributeModifier(token) && !isSelectorToken(token)) {
            modifiers.push(token);
        } else if (!selector) {
            selector = token;
        } else if (isChainedSelectorToken(token)) {
            selector += ' ' + normalizeSelectorToken(token);
        } else {
            modifiers.push(token);
        }
    }

    if (isRootModifier(selector)) {
        modifiers.unshift(selector);
        selector = '';
    }

    let index = 0;
    let range = null;
    selector = normalizeSelectorToken(selector)
        .replace(/^text\.(.+)$/g, (_, text) => `a:contains("${cssString(text)}")`)
        .replace(/(^|[\s>+~])text\.([^\s>+~]+)/g, (_, prefix, text) => `${prefix}a:contains("${cssString(text)}")`);

    selector = selector.replace(/\[(-?\d+)\s*[:,]\s*(-?\d+)\](?=$|[\s>+~.#[:])/, (_, start, end) => {
        range = [Number(start), Number(end)];
        return '';
    });
    selector = selector.replace(/\.(-?\d+):(-?\d+)(?=$|[\s>+~:#\[])/, (_, start, end) => {
        range = [Number(start), Number(end)];
        return '';
    });
    selector = selector.replace(/:(-?\d+):(-?\d+)(?=$|[\s>+~#\[])/, (_, start, end) => {
        range = [Number(start), Number(end)];
        return '';
    });
    selector = selector.replace(/\[(-?\d+)\](?=$|[\s>+~.#[:])/, (_, n) => {
        index = Number(n);
        return '';
    });
    selector = selector.replace(/\.(-?\d+)(?=$|[\s>+~:#\[])/, (_, n) => {
        index = Number(n);
        return '';
    });
    selector = selector.replace(/:(-?\d+)(?=$|[\s>+~#\[])/, (_, n) => {
        index = Number(n);
        return '';
    });

    const attrPipe = selector.match(/\[([^\]=~$^*]+)~=([^\]]+)\]/);
    if (attrPipe) {
        const attr = attrPipe[1].trim();
        const values = attrPipe[2].split('|').map(v => v.trim()).filter(Boolean);
        selector = values.map(v => selector.replace(attrPipe[0], `[${attr}*="${v}"]`)).join(', ');
    }

    if (!modifiers.length) modifiers.push('text');
    return { selector: selector.trim(), modifiers, index, range };
}

function applyElementRange(elements, parsed) {
    if (!parsed.range) return elements;
    const length = elements.length;
    let [start, end] = parsed.range;
    if (start < 0) start = length + start;
    if (end < 0) end = length + end;
    start = Math.max(0, start);
    end = Math.min(length - 1, end);
    if (end < start) return elements.slice(0, 0);
    return elements.slice(start, end + 1);
}

function normalizeSelectorToken(selector) {
    return String(selector || '')
        .replace(/^class\./g, '.')
        .replace(/(^|[\s>+~])class\./g, '$1.')
        .replace(/^id\./g, '#')
        .replace(/(^|[\s>+~])id\./g, '$1#')
        .replace(/(^|[\s>+~])tag\./g, '$1');
}

function selectWithParsedRule($, parsed) {
    if (!parsed.selector) return rootElement($);
    try {
        return $(parsed.selector);
    } catch {
        const repaired = parsed.selector.replace(/\[(-?\d+)\]/g, '');
        try {
            return repaired ? $(repaired) : cheerio.load('')('');
        } catch {
            return cheerio.load('')('');
        }
    }
}

function cssString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function splitCssTokens(rule) {
    const tokens = [];
    let current = '';
    let bracket = 0;
    for (let i = 0; i < rule.length; i++) {
        const ch = rule[i];
        if (ch === '[') bracket++;
        if (ch === ']') bracket = Math.max(0, bracket - 1);
        if (ch === '@' && bracket === 0) {
            tokens.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    tokens.push(current);
    return tokens.map(s => s.trim()).filter(s => s !== '');
}

function applyModifier($el, modifiers, $) {
    let current = $el;
    let value = '';
    for (const modifier of modifiers) {
        if (modifier === 'text' || modifier === 'textNodes') value = current.text();
        else if (modifier === 'ownText') {
            value = current.contents().filter(function() { return this.type === 'text'; }).text();
        } else if (modifier === 'html') value = current.html() || '';
        else if (modifier === 'all') value = $.html(current) || '';
        else if (modifier === 'href' || modifier === 'src' || modifier === 'content' || modifier === 'style' || modifier.startsWith('data-')) {
            value = current.attr(modifier) || '';
        } else {
            const selectorRule = parseCssRule(modifier);
            let next = selectorRule.selector ? current.find(selectorRule.selector) : current.find(modifier);
            next = applyElementRange(next, selectorRule);
            if (!selectorRule.range) next = next.eq(selectorRule.index || 0);
            if (next.length) {
                current = next;
                value = $.html(current);
            } else {
                value = current.attr(modifier) || current.text();
            }
        }
    }
    return String(value || '').trim();
}

function firstJsonValue(input, rule) {
    const values = jsonValues(input, rule);
    return values.length ? normalizeValue(values[0]) : '';
}

function jsonRuleValue(input, rule) {
    const values = jsonValues(input, rule);
    if (!values.length) return '';
    if (values.length === 1) return normalizeValue(values[0]);
    return values.map(normalizeValue).join('\n');
}

function jsonValues(input, rule) {
    const data = parseJsonMaybe(input);
    if (!isObjectLike(data)) return [];
    try {
        return JSONPath({ path: normalizeJsonPath(rule), json: data }) || [];
    } catch {
        return [];
    }
}

function splitRegexReplace(rule) {
    const parts = String(rule || '').split('##');
    if (parts.length < 2) return { rule: String(rule || '').trim(), replacements: [] };
    const baseRule = parts.shift().trim();
    const replacements = [];
    for (let i = 0; i < parts.length; i += 2) {
        replacements.push({ pattern: parts[i] || '', replacement: parts[i + 1] || '' });
    }
    return { rule: baseRule, replacements };
}

function applyRegexReplacements(value, replacements) {
    let text = Array.isArray(value) ? value.map(item => normalizeValue(item)).join('\n') : normalizeValue(value);
    text = String(text || '');
    for (const { pattern, replacement } of replacements) {
        if (!pattern) continue;
        if (pattern === '$') {
            text = text + (replacement || '');
            continue;
        }
        if (pattern === '^') {
            text = (replacement || '') + text;
            continue;
        }
        try {
            text = text.replace(new RegExp(pattern, 'g'), replacement || '');
        } catch {
            text = text.split(pattern).join(replacement || '');
        }
    }
    return text;
}

function applyPutRule(input, rule, context) {
    const body = String(rule).replace(/^@put:/, '').trim();
    const inner = body.startsWith('{') && body.endsWith('}') ? body.slice(1, -1) : body;
    const pairs = splitTopLevel(inner, ',');
    for (const pair of pairs) {
        const idx = pair.indexOf(':');
        if (idx < 0) continue;
        const key = pair.slice(0, idx).trim().replace(/^["']|["']$/g, '');
        const rawRule = pair.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        context.variables[key] = runRule(input, rawRule, context);
    }
}

function splitRuleChain(rule) {
    return splitTopLevel(rule, '&&').flatMap(splitRuleLines).map(s => s.trim()).filter(Boolean);
}

function splitRuleLines(rule) {
    const text = String(rule || '');
    const out = [];
    let current = '';
    let quote = '';
    let depth = 0;
    let inJsTag = false;
    let segmentStart = 0;

    for (let i = 0; i < text.length; i++) {
        if (text.slice(i, i + 4).toLowerCase() === '<js>') inJsTag = true;
        if (text.slice(i, i + 5).toLowerCase() === '</js>') {
            current += text.slice(i, i + 5);
            i += 4;
            inJsTag = false;
            continue;
        }

        const ch = text[i];
        if (quote) {
            current += ch;
            if (ch === quote && text[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }
        if (!inJsTag) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        }

        if (ch === '\n' && depth === 0 && !inJsTag) {
            const trimmed = current.trim();
            const next = text.slice(i + 1).trimStart();
            const currentIsAtJs = trimmed.startsWith('@js:');
            if (trimmed && !currentIsAtJs && isRuleStart(next)) {
                out.push(trimmed);
                current = '';
                segmentStart = i + 1;
                continue;
            }
        }
        current += ch;
    }
    if (current.trim()) out.push(current.trim());
    return out;
}

function isRuleStart(text) {
    return /^(<js>|@js:|@(css|json|jsonp|JSon|xpath|XPath):|\$|[#.\[]|class\.|id\.|tag\.|text\.|body\b|html\b|href\b|src\b)/.test(String(text || '').trim());
}

function splitTopLevel(text, delimiter) {
    const out = [];
    let quote = '';
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text.slice(i, i + delimiter.length);
        if (quote) {
            current += ch;
            if (ch === quote && text[i - 1] !== '\\') quote = '';
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        if (depth === 0 && next === delimiter) {
            out.push(current);
            current = '';
            i += delimiter.length - 1;
            continue;
        }
        current += ch;
    }
    out.push(current);
    return out;
}

function findJsSuffix(rule) {
    const idx = rule.indexOf('@js:');
    return idx > 0 ? idx : -1;
}

function parseUrlOptions(text) {
    const comma = String(text).indexOf(',{');
    const commaLoose = String(text).indexOf(",{");
    const commaSingle = String(text).indexOf(",{'");
    const optionIndex = comma >= 0 ? comma : (commaLoose >= 0 ? commaLoose : commaSingle);
    if (optionIndex < 0) return { url: text, headers: {} };
    const url = text.slice(0, optionIndex);
    const raw = text.slice(optionIndex + 1).replace(/'/g, '"');
    try {
        const options = JSON.parse(raw);
        return {
            url,
            headers: options.headers || {},
            method: options.method || undefined,
            body: options.body || undefined,
        };
    } catch {
        return { url, headers: {} };
    }
}

function parseHeader(header) {
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

function stripUrlComment(url) {
    const text = String(url || '');
    const marker = text.indexOf('##');
    return marker >= 0 ? text.slice(0, marker) : text;
}

function resolveUrl(url, baseUrl) {
    const text = String(url || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    try {
        return new URL(text, baseUrl).href;
    } catch {
        return text;
    }
}

function isJsonPathRule(rule) {
    const text = String(rule || '').trim();
    if (text.includes('@')) return false;
    if (/^(text|class|id|tag)\./.test(text)) return false;
    return text.startsWith('$') || text.startsWith('$.') || text.startsWith('$..') || text === '[*]' || /^[a-zA-Z_$][\w$]*(?:\.|\[)/.test(text);
}

function isJsonPathShorthand(rule) {
    return /^\.[A-Za-z_$][\w$]*(?:\.|\[|$)/.test(String(rule || '').trim());
}

function normalizeJsonPath(rule) {
    const text = String(rule || '').trim();
    let normalized = text;
    if (normalized === '[*]') normalized = '$[*]';
    else if (normalized.startsWith('.')) normalized = '$' + normalized;
    else if (!normalized.startsWith('$')) normalized = '$.' + normalized;
    return normalized.replace(/\]\s*([A-Za-z_$])/g, '].$1');
}

function isCssRule(rule) {
    const text = String(rule || '').trim();
    return text.includes('@') || looksLikeSelector(text) || isRootModifier(text);
}

function looksLikeSelector(text) {
    return /^(#|\.|\[|[a-zA-Z]+[#.\[]|class\.|id\.|tag\.|text\.)/.test(String(text || '').trim());
}

function isRootModifier(text) {
    return ['text', 'textNodes', 'ownText', 'html', 'all', 'href', 'src', 'content', 'style'].includes(String(text || '').trim());
}

function isModifier(text) {
    const token = String(text || '').trim();
    return isRootModifier(token) || /^[a-zA-Z_][\w-]*$/.test(token);
}

function isAttributeModifier(text) {
    const token = String(text || '').trim();
    return isRootModifier(token) || /^[a-zA-Z_][\w:-]*$/.test(token);
}

function isSelectorToken(text) {
    const token = String(text || '').trim();
    if (!token) return false;
    if (isRootModifier(token)) return false;
    if (/^(#|\.|\[|class\.|id\.|tag\.)/.test(token)) return true;
    if (/^[a-zA-Z][\w-]*(?:[#.\[:]|$)/.test(token) && htmlTags.has(token.replace(/[#.\[:].*$/, '').toLowerCase())) {
        return true;
    }
    return false;
}

function isChainedSelectorToken(text) {
    const token = String(text || '').trim();
    if (!token || isRootModifier(token)) return false;
    return /^(#|\.|\[|class\.|id\.|tag\.|text\.)/.test(token);
}

function htmlFromInput(input) {
    if (typeof input === 'string') return input;
    return normalizeValue(input);
}

function parseJsonMaybe(input) {
    if (isObjectLike(input)) return input;
    try {
        return JSON.parse(String(input));
    } catch {
        return input;
    }
}

function tryJsonArray(value) {
    if (Array.isArray(value)) return value;
    const parsed = parseJsonMaybe(value);
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : [];
}

function normalizeValue(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return stringifySafe(value);
    return String(value);
}

function stringifySafe(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return JSON.stringify(value.map(item => normalizeForJson(item)));
    if (isPlainObject(value)) return JSON.stringify(normalizeForJson(value));
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
        return String(value);
    }
}

function normalizeForJson(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(normalizeForJson);
    const plain = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'function') continue;
        if (['parent', 'prev', 'next', 'children'].includes(key)) continue;
        plain[key] = normalizeForJson(item);
    }
    return plain;
}

function isObjectLike(value) {
    return typeof value === 'object' && value !== null;
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function isUseful(value, rule) {
    if (value === undefined || value === null) return false;
    const text = String(value).trim();
    if (!text) return false;
    if (text === String(rule).trim()) return false;
    if (text.includes('{{') || text.includes('}}')) return false;
    return true;
}

module.exports = {
    cleanSourceUrl,
    createContext,
    fetchSourceUrl,
    buildUrl,
    runRule,
    runRuleList,
    applyTemplate,
    resolveUrl,
};
