const fs = require('fs');
const http = require('http');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const sourcesPath = path.join(projectRoot, 'sources');
const docsPath = path.join(projectRoot, 'docs');

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl || 'http://localhost:3456';
const category = args.category || 'novel';
const keyword = args.keyword || 'test';
const offset = Number(args.offset || 0);
const limit = Number(args.limit || 20);
const timeout = Number(args.timeout || 20000);
const deep = args.deep === 'true' || args.deep === true;

function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = true;
        } else {
            parsed[key] = next;
            i++;
        }
    }
    return parsed;
}

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(sourcesPath, 'index.json'), 'utf8'));
}

function loadSource(entry) {
    if (!entry || !entry.file) return null;
    try {
        const file = JSON.parse(fs.readFileSync(path.join(sourcesPath, entry.file), 'utf8'));
        return file[entry.index] || null;
    } catch {
        return null;
    }
}

function request(method, pathname, body) {
    return new Promise((resolve, reject) => {
        const target = new URL(pathname, baseUrl);
        const data = body ? JSON.stringify(body) : '';
        const req = http.request({
            hostname: target.hostname,
            port: target.port || 80,
            path: target.pathname + target.search,
            method,
            headers: data ? {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(data),
            } : {},
        }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => {
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch {}
                resolve({ status: res.statusCode, json, text });
            });
        });
        req.on('error', reject);
        req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
        if (data) req.write(data);
        req.end();
    });
}

function query(params) {
    return Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => key + '=' + encodeURIComponent(value))
        .join('&');
}

async function auditSource(entry) {
    const source = loadSource(entry);
    const sourceKeyword = args.useSourceKeyword !== 'false'
        ? cleanAuditKeyword(source?.ruleSearch?.checkKeyWord) || keyword
        : keyword;
    const result = {
        sourceId: entry.id,
        sourceName: entry.name,
        category: entry.category,
        status: entry.status,
        ok: false,
        phase: 'search',
        keyword: sourceKeyword,
    };

    const search = await request('POST', '/api/content/search', {
        keyword: sourceKeyword,
        category: entry.category,
        sourceIds: [entry.id],
        sourceLimit: 1,
        perSourceLimit: 3,
        timeout: Math.min(timeout, 12000),
    });
    result.searchStatus = search.status;
    result.searchError = search.json?.errors?.[0]?.error || search.json?.error || '';
    const item = search.json?.results?.[0]?.items?.[0];
    if (!item) {
        result.phase = 'search';
        result.error = result.searchError || 'no_search_result';
        return result;
    }
    result.item = summarizeItem(item);

    result.phase = 'detail';
    const detail = await request('POST', '/api/content/detail', {
        sourceId: item.sourceId,
        itemUrl: item.itemUrl,
        raw: item.raw,
    });
    result.detailStatus = detail.status;
    if (detail.status !== 200) {
        result.error = detail.json?.error || 'detail_failed';
        return result;
    }
    result.detail = {
        name: detail.json?.name,
        tocUrl: detail.json?.tocUrl,
        hasIntro: Boolean(detail.json?.intro),
    };

    result.phase = 'entries';
    const entries = await request('POST', '/api/content/entries', {
        sourceId: item.sourceId,
        tocUrl: detail.json?.tocUrl || item.itemUrl,
        session: detail.json?.session,
        maxPages: args.entryPages || 4,
        budgetMs: args.budgetMs || 18000,
    });
    result.entriesStatus = entries.status;
    result.entries = entries.json?.totalEntries || 0;
    result.fetchedTocPages = entries.json?.fetchedTocPages || 0;
    result.partial = Boolean(entries.json?.partial || entries.json?.nextTocUrl);
    if (entries.status !== 200 || !result.entries) {
        result.error = entries.json?.error || 'no_entries';
        return result;
    }
    const firstEntry = entries.json?.entries?.find(item => item.url);
    result.firstEntry = summarizeEntry(firstEntry);
    if (!deep) {
        result.ok = true;
        result.phase = 'entries_ok';
        return result;
    }

    result.phase = 'payload';
    const payload = await request('POST', '/api/content/payload', {
        sourceId: item.sourceId,
        entryUrl: firstEntry.url,
        index: firstEntry.index,
        title: firstEntry.name,
        session: entries.json?.session,
        maxPages: args.payloadPages || 5,
    });
    result.payloadStatus = payload.status;
    result.payload = {
        type: payload.json?.type,
        textLength: payload.json?.text?.length || 0,
        urlCount: payload.json?.urls?.length || 0,
        mediaUrl: payload.json?.mediaUrl || '',
        validation: payload.json?.validation || null,
    };
    if (entry.category === 'comic' && payload.status === 200 && (payload.json?.urls || []).length) {
        const firstImage = payload.json.urls[0];
        const image = await request('GET', '/api/content/image?' + query({
            url: firstImage,
            referer: payload.json?.entryUrl || firstEntry.url,
        }));
        result.payload.imageProbe = {
            status: image.status,
            contentType: image.text && image.text.startsWith('{') ? '' : '',
            ok: image.status === 200 && !/^</.test(String(image.text || '').trim()),
        };
    }
    result.ok = payload.status === 200
        && payload.json?.validation?.ok !== false
        && (!result.payload.imageProbe || result.payload.imageProbe.ok);
    result.error = result.ok ? '' : (payload.json?.error || payload.json?.validation?.reason || (result.payload.imageProbe ? 'image_probe_failed' : 'payload_failed'));
    result.phase = result.ok ? 'ok' : 'payload';
    return result;
}

function cleanAuditKeyword(value) {
    const text = String(value || '').replace(/<[^>]+>/g, '').trim();
    if (!text || /[\{\}\$@]/.test(text)) return '';
    return text.length > 40 ? text.slice(0, 40) : text;
}

function summarizeItem(item) {
    if (!item) return null;
    return {
        name: item.name,
        author: item.author,
        itemUrl: item.itemUrl,
    };
}

function summarizeEntry(entry) {
    if (!entry) return null;
    return {
        index: entry.index,
        name: entry.name,
        url: entry.url,
    };
}

async function main() {
    const all = loadIndex()
        .filter(entry => !category || category === 'all' || entry.category === category)
        .slice(offset, offset + limit);
    const results = [];
    for (const entry of all) {
        try {
            const result = await auditSource(entry);
            results.push(result);
            console.log(JSON.stringify({
                id: result.sourceId,
                ok: result.ok,
                phase: result.phase,
                entries: result.entries,
                error: result.error,
            }));
        } catch (err) {
            const result = {
                sourceId: entry.id,
                sourceName: entry.name,
                category: entry.category,
                ok: false,
                phase: 'exception',
                error: err.message,
            };
            results.push(result);
            console.log(JSON.stringify({ id: entry.id, ok: false, phase: 'exception', error: err.message }));
        }
    }
    if (!fs.existsSync(docsPath)) fs.mkdirSync(docsPath, { recursive: true });
    const summary = {
        generatedAt: new Date().toISOString(),
        category,
        keyword,
        offset,
        limit,
        deep,
        total: results.length,
        ok: results.filter(item => item.ok).length,
        byPhase: results.reduce((acc, item) => {
            acc[item.phase] = (acc[item.phase] || 0) + 1;
            return acc;
        }, {}),
        results,
    };
    const file = path.join(docsPath, `runtime_api_audit_${category}_${offset}_${limit}.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
    console.log('WROTE ' + file);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
