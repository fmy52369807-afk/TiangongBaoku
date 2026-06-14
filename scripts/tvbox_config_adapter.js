/**
 * TVBox/CatVod config preflight and CMS converter.
 *
 * This script intentionally converts only simple CMS JSON API sites. CatVod
 * Spider/Jar/Drpy sites need a real CatVod runtime and are reported as pending.
 *
 * Usage:
 *   node scripts/tvbox_config_adapter.js
 *   node scripts/tvbox_config_adapter.js data/tvbox-subscriptions-12586.json
 *   node scripts/tvbox_config_adapter.js https://example.com/tvbox.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'tvbox-subscriptions-12586.json');
const REPORT_FILE = path.join(ROOT, 'data', 'tvbox-adapter-report.json');
const CONVERTED_FILE = path.join(ROOT, 'data', 'tvbox-converted-video-sources.json');
const REQUEST_TIMEOUT = 12000;
const MAX_SUBSCRIPTIONS = 20;

async function main() {
    const input = process.argv[2] || DEFAULT_INPUT;
    const root = await loadInput(input);
    const subscriptionUrls = collectSubscriptionUrls(root, input).slice(0, MAX_SUBSCRIPTIONS);
    const configs = [];
    const converted = [];
    const errors = [];

    if (isTvboxConfig(root)) {
        configs.push({ name: nameFromInput(input), url: input, config: root });
    }

    for (const item of subscriptionUrls) {
        try {
            const config = await fetchJsonLike(item.url);
            if (isTvboxConfig(config)) {
                configs.push({ name: item.name || nameFromInput(item.url), url: item.url, config });
            } else if (Array.isArray(config?.urls)) {
                errors.push({
                    name: item.name,
                    url: item.url,
                    reason: 'nested_subscription_list',
                    count: config.urls.length,
                });
            } else {
                errors.push({ name: item.name, url: item.url, reason: 'not_tvbox_config' });
            }
        } catch (err) {
            errors.push({ name: item.name, url: item.url, reason: err.message });
        }
    }

    const configReports = configs.map(({ name, url, config }) => {
        const sites = Array.isArray(config.sites) ? config.sites : [];
        const report = {
            name,
            url,
            spider: config.spider || '',
            siteCount: sites.length,
            cmsConvertible: [],
            spiderRequired: [],
            unsupported: [],
        };

        for (const site of sites) {
            const classified = classifySite(site);
            if (classified.kind === 'cms') {
                report.cmsConvertible.push(classified.summary);
                converted.push(makeCmsLegadoSource(classified.site, { configName: name, configUrl: url }));
            } else if (classified.kind === 'spider') {
                report.spiderRequired.push(classified.summary);
            } else {
                report.unsupported.push(classified.summary);
            }
        }
        return report;
    });

    const uniqueConverted = dedupeBy(converted, source => source.bookSourceUrl);
    const report = {
        generatedAt: new Date().toISOString(),
        input: normalizePath(input),
        subscriptionCount: subscriptionUrls.length,
        configCount: configs.length,
        convertedCount: uniqueConverted.length,
        errors,
        configs: configReports,
    };

    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(CONVERTED_FILE, JSON.stringify(uniqueConverted, null, 2), 'utf8');

    console.log(`TVBox configs: ${configs.length}`);
    console.log(`CMS convertible sites: ${uniqueConverted.length}`);
    console.log(`Report: ${normalizePath(REPORT_FILE)}`);
    console.log(`Converted candidates: ${normalizePath(CONVERTED_FILE)}`);
    if (errors.length) console.log(`Errors/skipped subscriptions: ${errors.length}`);
}

async function loadInput(input) {
    if (/^https?:\/\//i.test(input)) return fetchJsonLike(input);
    const full = path.isAbsolute(input) ? input : path.join(ROOT, input);
    return parseJsonLike(fs.readFileSync(full, 'utf8'), full);
}

function collectSubscriptionUrls(data, input) {
    if (Array.isArray(data?.urls)) {
        return data.urls
            .map(item => typeof item === 'string' ? { name: nameFromInput(item), url: item } : item)
            .filter(item => item && /^https?:\/\//i.test(String(item.url || '')));
    }
    if (isTvboxConfig(data)) return [];
    if (/^https?:\/\//i.test(input)) return [{ name: nameFromInput(input), url: input }];
    return [];
}

function isTvboxConfig(data) {
    return data && typeof data === 'object' && Array.isArray(data.sites);
}

async function fetchJsonLike(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'application/json,text/plain,*/*',
            },
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        return parseJsonLike(await res.text(), url);
    } finally {
        clearTimeout(timer);
    }
}

function parseJsonLike(raw, label) {
    const cleaned = stripLeadingComments(String(raw || '').replace(/^\uFEFF/, ''));
    try {
        return JSON.parse(cleaned);
    } catch (err) {
        throw new Error(`json_parse_failed:${path.basename(label || '')}:${err.message}`);
    }
}

function stripLeadingComments(text) {
    return text
        .split(/\r?\n/)
        .filter(line => !/^\s*\/\//.test(line))
        .join('\n')
        .trim();
}

function classifySite(site) {
    const api = String(site?.api || '').trim();
    const key = String(site?.key || '').trim();
    const name = String(site?.name || key || api || 'unknown').trim();
    const type = Number(site?.type);
    const searchable = site?.searchable !== 0;
    const quickSearch = site?.quickSearch !== 0;
    const summary = { key, name, type, api, searchable, quickSearch };

    if (/^https?:\/\//i.test(api) && /(?:api\.php\/)?provide\/vod/i.test(api)) {
        return { kind: 'cms', site: { ...site, name, api }, summary: { ...summary, reason: 'cms_vod_api' } };
    }

    if (type === 3 || /^csp_/i.test(api) || /spider|drpy|jar|catvod/i.test(api)) {
        return { kind: 'spider', site, summary: { ...summary, reason: 'catvod_runtime_required' } };
    }

    return { kind: 'unsupported', site, summary: { ...summary, reason: 'unknown_or_non_cms_site' } };
}

function makeCmsLegadoSource(site, origin) {
    const api = String(site.api || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const name = cleanName(site.name || site.key || api);
    const comment = `从 TVBox/CatVod 配置转换的 CMS 源。来源：${origin.configName || origin.configUrl}`;
    return {
        bookSourceComment: comment,
        bookSourceGroup: '影视 TVBox/CMS 候选',
        bookSourceName: `${name}（TVBox/CMS）`,
        bookSourceType: 4,
        bookSourceUrl: api,
        customOrder: 9200,
        enabled: false,
        enabledCookieJar: false,
        enabledExplore: true,
        header: '{"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"}',
        ruleSearch: {
            bookList: '$.list[*]',
            name: '$.vod_name',
            author: '$.vod_actor',
            kind: '{{$.vod_year}} {{$.type_name}} {{$.vod_remarks}}',
            coverUrl: '$.vod_pic',
            intro: '$.vod_content',
            bookUrl: `${api}?ac=detail&ids={{$.vod_id}}`,
        },
        ruleBookInfo: {
            name: '$.list[0].vod_name',
            author: '$.list[0].vod_actor',
            kind: '{{$.list[0].vod_year}} {{$.list[0].type_name}} {{$.list[0].vod_remarks}}',
            coverUrl: '$.list[0].vod_pic',
            intro: '$.list[0].vod_content',
            tocUrl: '{{baseUrl}}',
        },
        ruleToc: {
            chapterList: `<js>
const data = JSON.parse(result || '{}');
const item = (data.list && data.list[0]) ? data.list[0] : {};
const playText = item.vod_play_url || '';
const fromText = item.vod_play_from || '';
const groups = String(playText).split('$$$');
const lines = String(fromText).split('$$$');
const out = [];
const isHttp = new RegExp('^https?://', 'i');
for (let i = 0; i < groups.length; i++) {
  const line = lines[i] || '';
  for (const part of groups[i].split('#')) {
    const idx = part.indexOf('$');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const url = part.slice(idx + 1).trim();
    if (isHttp.test(url)) out.push({ name, url, line });
  }
}
result = out;
</js>`,
            chapterName: '$.name',
            chapterUrl: '$.url',
            updateTime: '$.line',
        },
        ruleContent: {
            content: '{{baseUrl}}',
        },
        searchUrl: `${api}?ac=detail&wd={{key}}&pg={{page}}`,
        weight: 0,
        tvboxOrigin: {
            key: site.key || '',
            type: site.type,
            configName: origin.configName || '',
            configUrl: origin.configUrl || '',
        },
    };
}

function cleanName(value) {
    return String(value || '').replace(/[\u0000-\u001F]/g, '').trim() || '未命名影视源';
}

function dedupeBy(items, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function nameFromInput(value) {
    try {
        const url = new URL(value);
        return url.hostname;
    } catch {
        return path.basename(String(value || ''), path.extname(String(value || ''))) || 'input';
    }
}

function normalizePath(value) {
    return path.relative(ROOT, value).replace(/\\/g, '/');
}

main().catch(err => {
    console.error(err.stack || err.message);
    process.exit(1);
});
