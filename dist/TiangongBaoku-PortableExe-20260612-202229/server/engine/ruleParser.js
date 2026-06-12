/**
 * Lightweight Legado rule parser.
 *
 * Supports JSONPath, common Legado CSS selectors, template variables,
 * and simple alternative rules separated with ||.
 */
const cheerio = require('cheerio');
const { JSONPath } = require('jsonpath-plus');

function extractValue(input, rule, contextUrl = '') {
    if (!rule || rule === '') return input;

    rule = String(rule).trim();

    if (rule.includes('||')) {
        for (const part of splitAlternatives(rule)) {
            const value = extractValue(input, part, contextUrl);
            if (isUsefulValue(value, part)) return value;
        }
        return '';
    }

    if (rule.startsWith('@js:')) {
        return '[JS_RULE]' + rule.substring(4);
    }

    if (rule.startsWith('//')) return '';

    if (isRootHtmlModifier(rule)) {
        try {
            const $ = cheerio.load(typeof input === 'string' ? input : String(input));
            const root = $('body').children().first();
            if (root.length > 0) return applyCssModifier(root, rule, $);
        } catch (e) {
            // Fall through.
        }
    }

    if (isJsonPathRule(rule)) {
        try {
            const data = typeof input === 'string' ? tryParseJson(input) : input;
            if (isObjectLike(data)) {
                const results = JSONPath({ path: normalizeJsonPath(rule), json: data });
                if (results && results.length > 0) return formatSingleResult(results[0]);
            }
        } catch (e) {
            // Fall through to other rule types.
        }
    }

    if (isCssRule(rule)) {
        try {
            const $ = cheerio.load(typeof input === 'string' ? input : String(input));
            const { selector, modifier } = parseCssModifier(rule);
            const el = $(selector).first();
            if (el.length > 0) return applyCssModifier(el, modifier, $);
        } catch (e) {
            // Fall through.
        }
    }

    if (rule.includes('{{')) {
        return applyTemplate(rule, { result: input, baseUrl: contextUrl, sourceKey: contextUrl });
    }

    const data = typeof input === 'string' ? tryParseJson(input) : input;
    if (isObjectLike(data) && !Array.isArray(data)) {
        if (Object.prototype.hasOwnProperty.call(data, rule)) {
            return formatSingleResult(data[rule]);
        }

        try {
            const results = JSONPath({ path: '$.' + rule, json: data });
            if (results && results.length > 0) return formatSingleResult(results[0]);
        } catch (e) {}

        try {
            const results = JSONPath({ path: '$..' + rule, json: data });
            if (results && results.length > 0) return formatSingleResult(results[0]);
        } catch (e) {}
    }

    return rule;
}

function extractList(input, rule, contextUrl = '') {
    if (!rule || rule === '') {
        return typeof input === 'object' ? [input] : [String(input)];
    }

    rule = String(rule).trim();

    if (rule.startsWith('@js:')) return [];

    if (rule.includes('||')) {
        for (const part of splitAlternatives(rule)) {
            const result = extractList(input, part, contextUrl);
            if (result && result.length > 0) return result;
        }
        return [];
    }

    if (isJsonPathRule(rule)) {
        try {
            const data = typeof input === 'string' ? tryParseJson(input) : input;
            if (isObjectLike(data)) {
                const results = JSONPath({ path: normalizeJsonPath(rule), json: data });
                if (results && results.length > 0) return results;
            }
        } catch (e) {
            // Fall through.
        }
    }

    if (isCssRule(rule)) {
        try {
            const $ = cheerio.load(typeof input === 'string' ? input : String(input));
            const { selector } = parseCssModifier(rule);

            if (rule.startsWith('-')) {
                const actualRule = rule.substring(1);
                const allElements = $(actualRule.replace(/@.*$/, ''));
                const withoutExcluded = $(selector.replace(/^-/, ''));
                return allElements.not(withoutExcluded).toArray().map(el => $.html(el));
            }

            return $(selector).toArray().map(el => $.html(el));
        } catch (e) {
            return [];
        }
    }

    return [input];
}

function applyTemplate(template, vars = {}) {
    if (!template) return '';

    return String(template).replace(/\{\{(.+?)\}\}/g, (match, expr) => {
        const key = expr.trim();

        if (key.includes('||')) {
            for (const part of splitAlternatives(key)) {
                const value = applyTemplate('{{' + part + '}}', vars);
                if (value && value !== '{{' + part + '}}' && !value.includes('{{')) return value;
            }
            return match;
        }

        if (key.startsWith('$') || key.startsWith('@') || isBareJsonPath(key)) {
            try {
                const data = typeof vars.result === 'string' ? tryParseJson(vars.result) : vars.result;
                if (isObjectLike(data)) {
                    const results = JSONPath({ path: normalizeJsonPath(key), json: data });
                    if (results && results.length > 0) return formatSingleResult(results[0]);
                }
            } catch (e) {}
            return match;
        }

        if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
        if (key === 'key') return String(vars.key || '');
        if (key === 'page') return String(vars.page || '1');
        if (key === 'baseUrl') return String(vars.baseUrl || '');
        if (key === 'source.key') return String(vars.sourceKey || vars.sourceBookSourceUrl || vars.baseUrl || '');
        if (key === 'source.bookSourceUrl') return String(vars.sourceBookSourceUrl || vars.sourceKey || vars.baseUrl || '');

        try {
            const data = typeof vars.result === 'string' ? tryParseJson(vars.result) : vars.result;
            if (isObjectLike(data) && Object.prototype.hasOwnProperty.call(data, key)) {
                return formatSingleResult(data[key]);
            }
        } catch (e) {}

        return match;
    });
}

function resolveUrl(url, baseUrl) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    try {
        return new URL(url, baseUrl).href;
    } catch {
        return url;
    }
}

function tryParseJson(str) {
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch {
        return str;
    }
}

function formatSingleResult(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

function isObjectLike(value) {
    return typeof value === 'object' && value !== null;
}

function splitAlternatives(rule) {
    return String(rule).split('||').map(s => s.trim()).filter(Boolean);
}

function isUsefulValue(value, rule) {
    if (value === null || value === undefined) return false;
    const text = String(value);
    if (!text) return false;
    if (text === String(rule)) return false;
    if (text.includes('{{') || text.includes('}}')) return false;
    return true;
}

function isJsonPathRule(rule) {
    return (
        rule.startsWith('$') ||
        rule.startsWith('@') ||
        rule.startsWith('..') ||
        rule === '[*]' ||
        isBareJsonPath(rule)
    );
}

function isBareJsonPath(rule) {
    if (!rule || typeof rule !== 'string') return false;
    if (rule.includes('@')) return false;
    return /^[a-zA-Z_$][\w$]*(?:\.|\[)/.test(rule);
}

function normalizeJsonPath(rule) {
    if (rule === '[*]') return '$[*]';
    if (rule.startsWith('..')) return '$' + rule;
    if (rule.startsWith('$') || rule.startsWith('@')) return rule;
    if (isBareJsonPath(rule)) return '$.' + rule;
    return rule;
}

function isCssRule(rule) {
    if (isRootHtmlModifier(rule)) return true;
    if (/@[a-zA-Z][\w-]*(?:@js:.*)?$/.test(rule)) return true;
    if (/^\[.+\]/.test(rule)) return true;
    if (/^(class\.|tag\.|id\.|\.|-class\.)/.test(rule)) return true;
    if (/^[a-zA-Z]+\.[a-zA-Z]/.test(rule)) return true;
    if (/[#\.\[]/.test(rule) && /@/.test(rule)) return true;
    return false;
}

function parseCssModifier(rule) {
    const atIndex = rule.lastIndexOf('@');
    let selector = rule;
    let modifier = 'text';

    if (atIndex > 0) {
        selector = rule.substring(0, atIndex);
        const afterAt = rule.substring(atIndex + 1);
        const match = afterAt.match(/^([a-zA-Z][\w-]*)/);
        if (match) modifier = match[1];
    }

    selector = selector.replace(/##[^,{]*$/, '');

    const pipeMatch = selector.match(/\[(\w+)~=([^\]]+)\]/);
    if (pipeMatch) {
        const attr = pipeMatch[1];
        const values = pipeMatch[2].split('|').map(v => v.trim());
        selector = values.map(v => `[${attr}*="${v}"]`).join(', ');
    }

    selector = selector
        .replace(/^class\./g, '.')
        .replace(/tag\./g, '')
        .replace(/^id\./g, '#')
        .replace(/\.(-?\d+)$/g, (_, n) => {
            const idx = Number(n);
            return idx >= 0 ? `:eq(${idx})` : `:eq(${idx})`;
        });

    return { selector, modifier };
}

function isRootHtmlModifier(rule) {
    return ['href', 'src', 'text', 'html', 'ownText'].includes(rule);
}

function applyCssModifier($el, modifier, $) {
    switch (modifier) {
        case 'text':
            return $el.text().trim();
        case 'ownText':
            return $el.contents().filter(function() {
                return this.type === 'text';
            }).text().trim();
        case 'html':
            return $el.html() || '';
        case 'href':
            return $el.attr('href') || '';
        case 'src':
            return $el.attr('src') || '';
        case 'style':
            return $el.attr('style') || '';
        default:
            return $el.attr(modifier) || $el.text().trim();
    }
}

module.exports = {
    extractValue,
    extractList,
    applyTemplate,
    resolveUrl,
};
