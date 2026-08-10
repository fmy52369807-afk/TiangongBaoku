const express = require('express');
const path = require('node:path');

const router = express.Router();

const categories = {
    novel: { icon: '\u{1F4D6}', label: '\u5C0F\u8BF4', order: 1, payloadKind: 'text' },
    comic: { icon: '\u{1F3A8}', label: '\u6F2B\u753B', order: 2, payloadKind: 'images' },
    audio: { icon: '\u{1F3A7}', label: '\u542C\u4E66', order: 3, payloadKind: 'audio' },
    music: { icon: '\u{1F3B5}', label: '\u97F3\u4E50', order: 4, payloadKind: 'audio' },
    video: { icon: '\u{1F3AC}', label: '\u5F71\u89C6', order: 5, payloadKind: 'video' },
};

const fixtures = [
    {
        id: 'demo-novel', name: '\u672C\u5730\u89C4\u5219\u5C0F\u8BF4', category: 'novel', author: '\u533F\u540D\u6F14\u793A',
        title: '\u89C4\u5219\u5F15\u64CE\u624B\u8BB0', intro: '\u7528\u5408\u6210\u6587\u672C\u6F14\u793A\u8BE6\u60C5\u3001\u76EE\u5F55\u548C\u7EDF\u4E00 Payload \u9605\u8BFB\u94FE\u8DEF\u3002',
    },
    {
        id: 'demo-comic', name: '\u672C\u5730\u89C4\u5219\u6F2B\u753B', category: 'comic', author: '\u533F\u540D\u6F14\u793A',
        title: '\u89E3\u6790\u94FE\u8DEF\u56FE\u9274', intro: '\u4F7F\u7528\u4ED3\u5E93\u81EA\u6709\u56FE\u6807\u6F14\u793A\u56FE\u7247 Payload \u548C\u5A92\u4F53\u4EE3\u7406\u3002',
    },
    {
        id: 'demo-audio', name: '\u672C\u5730\u542C\u4E66 Fixture', category: 'audio', author: '\u533F\u540D\u64AD\u8BB2',
        title: '\u67B6\u6784\u8BBE\u8BA1\u968F\u7B14', intro: '\u4F7F\u7528\u672C\u5730\u9759\u97F3 WAV \u6F14\u793A\u8282\u76EE\u5217\u8868\u548C\u97F3\u9891 Payload\u3002',
    },
    {
        id: 'demo-music', name: '\u672C\u5730\u97F3\u4E50 Fixture', category: 'music', author: '\u5408\u6210\u97F3\u8F68',
        title: '\u7A7A\u767D\u8282\u62CD', intro: '\u4E0D\u5305\u542B\u7248\u6743\u97F3\u9891\u7684\u672C\u5730\u64AD\u653E\u5668\u6F14\u793A\u3002',
    },
    {
        id: 'demo-video', name: '\u672C\u5730\u89C6\u9891 Fixture', category: 'video', author: '\u7CFB\u7EDF\u6F14\u793A',
        title: '\u7EDF\u4E00\u5A92\u4F53\u5165\u53E3', intro: '\u672C\u5730 HTML \u64AD\u653E\u9875\u9762\uFF0C\u7528\u4E8E\u9A8C\u8BC1\u89C6\u9891 Payload \u548C\u5D4C\u5165\u5F0F\u6E32\u67D3\u3002',
    },
].map((item) => ({
    ...item,
    enabled: true,
    status: 'ok',
    group: '\u6C42\u804C\u6F14\u793A Fixture',
    url: `demo://${item.id}`,
    comment: '\u4EC5\u5728 DEMO_MODE \u4E2D\u542F\u7528\uFF0C\u4E0D\u8BF7\u6C42\u7B2C\u4E09\u65B9\u5185\u5BB9\u3002',
}));

function fixture(sourceId) {
    return fixtures.find((item) => item.id === sourceId);
}

function origin(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function searchItem(item, req) {
    return {
        name: item.title,
        author: item.author,
        intro: item.intro,
        sourceId: item.id,
        sourceName: item.name,
        category: item.category,
        itemUrl: `${origin(req)}/demo/item/${item.id}`,
        coverUrl: `${origin(req)}/api/content/image?fixture=cover`,
        raw: Buffer.from(JSON.stringify({ fixture: item.id })).toString('base64'),
    };
}

router.get('/api/sources/categories', (req, res) => {
    const items = Object.entries(categories).map(([key, value]) => ({ key, ...value, count: 1 }));
    res.json({
        total: fixtures.length,
        categories: [{ key: 'all', icon: '\u{1F3E0}', label: '\u5168\u90E8', order: 0, count: fixtures.length }, ...items],
    });
});

router.get('/api/sources', (req, res) => {
    const items = req.query.category && req.query.category !== 'all'
        ? fixtures.filter((item) => item.category === req.query.category)
        : fixtures;
    res.json({ total: items.length, page: 1, size: items.length, hasMore: false, items });
});

router.get('/api/sources/:id', (req, res, next) => {
    const item = fixture(req.params.id);
    if (!item) return next();
    res.json({
        ...item,
        source: {
            bookSourceName: item.name,
            bookSourceUrl: item.url,
            ruleSearch: { bookList: '$.fixtures[*]', name: '$.title', bookUrl: '$.url' },
            ruleBookInfo: { name: '$.title', intro: '$.intro', tocUrl: '$.toc' },
            ruleToc: { chapterList: '$.entries[*]', chapterName: '$.name', chapterUrl: '$.url' },
            ruleContent: { content: '$.payload' },
        },
    });
});

router.post('/api/content/search', (req, res) => {
    const category = req.body.category;
    const sourceIds = Array.isArray(req.body.sourceIds) ? new Set(req.body.sourceIds) : null;
    const selected = fixtures.filter((item) => (!category || category === 'all' || item.category === category)
        && (!sourceIds || sourceIds.has(item.id)));
    const results = selected.map((item) => ({
        sourceId: item.id,
        sourceName: item.name,
        category: item.category,
        count: 1,
        items: [searchItem(item, req)],
    }));
    res.json({
        keyword: String(req.body.keyword || ''),
        category: category || 'all',
        sourceLimit: selected.length,
        sourceOffset: 0,
        nextSourceOffset: selected.length,
        totalSources: selected.length,
        scannedSources: selected.length,
        hasMoreSources: false,
        totalResults: selected.length,
        sourceCount: selected.length,
        errors: [],
        sourceReports: selected.map((item) => ({ sourceId: item.id, name: item.name, category: item.category, status: 'ok', count: 1, error: '' })),
        results,
    });
});

router.post('/api/content/detail', (req, res, next) => {
    const item = fixture(req.body.sourceId);
    if (!item) return next();
    res.json({
        sourceId: item.id,
        sourceName: item.name,
        category: item.category,
        name: item.title,
        author: item.author,
        intro: item.intro,
        kind: '\u672C\u5730\u5408\u6210\u6F14\u793A',
        lastChapter: item.category === 'video' ? '\u7B2C 2 \u6BB5' : '\u7B2C 2 \u8282',
        coverUrl: `${origin(req)}/api/content/image?fixture=cover`,
        tocUrl: `${origin(req)}/demo/toc/${item.id}`,
        itemUrl: `${origin(req)}/demo/item/${item.id}`,
        downloadUrls: [],
        profile: { payloadKind: categories[item.category].payloadKind },
        session: Buffer.from(JSON.stringify({ fixture: item.id })).toString('base64url'),
    });
});

router.post('/api/content/entries', (req, res, next) => {
    const item = fixture(req.body.sourceId);
    if (!item) return next();
    const label = { novel: '\u7AE0', comic: '\u8BDD', audio: '\u6BB5', music: '\u9996', video: '\u96C6' }[item.category];
    const entries = [1, 2].map((number, index) => ({
        index,
        name: `\u7B2C ${number} ${label}\uFF1A${index ? '\u53D6\u820D\u4E0E\u8FB9\u754C' : '\u4ECE\u914D\u7F6E\u5230 Payload'}`,
        url: `${origin(req)}/demo/entry/${item.id}/${number}`,
        updateTime: '2026-08-10',
        isVip: false,
        isVolume: false,
        selectable: true,
    }));
    res.json({
        sourceId: item.id,
        category: item.category,
        profile: { payloadKind: categories[item.category].payloadKind },
        totalEntries: entries.length,
        entries,
        fetchedTocPages: 1,
        failedTocPages: 0,
        failedPages: [],
        partial: false,
        nextTocUrl: '',
        nextTocUrls: [],
        session: req.body.session || '',
    });
});

router.post('/api/content/payload', (req, res, next) => {
    const item = fixture(req.body.sourceId);
    if (!item) return next();
    const base = origin(req);
    const common = {
        sourceId: item.id,
        category: item.category,
        type: categories[item.category].payloadKind,
        title: req.body.title || item.title,
        entryUrl: req.body.entryUrl,
        mode: item.category === 'novel' ? 'text' : 'media',
        session: req.body.session || '',
        validation: { ok: true },
    };
    if (item.category === 'novel') {
        return res.json({
            ...common,
            content: '\u914D\u7F6E\u53EA\u63CF\u8FF0\u5982\u4F55\u5B9A\u4F4D\u6570\u636E\uFF0C\u6267\u884C\u5C42\u8D1F\u8D23 URL \u6784\u9020\u3001\u7F51\u7EDC\u7B56\u7565\u3001\u89C4\u5219\u89E3\u6790\u548C\u5B57\u6BB5\u5F52\u4E00\u5316\u3002\n\n\u8DE8\u6E90\u641C\u7D22\u5728\u6709\u754C\u5E76\u53D1\u4E2D\u6267\u884C\uFF0C\u5355\u4E2A\u6E90\u8D85\u65F6\u6216\u89E3\u6790\u5931\u8D25\u4E0D\u4F1A\u963B\u65AD\u5176\u4ED6\u7ED3\u679C\u3002\n\n\u6700\u7EC8\u8F93\u51FA\u7EDF\u4E00 Payload\uFF0C\u524D\u7AEF\u53EA\u9700\u6309 text\u3001images\u3001audio \u6216 video \u6E32\u67D3\u3002',
            text: '\u89C4\u5219\u89E3\u6790\u5408\u6210\u6B63\u6587',
            urls: [],
            rawLength: 0,
        });
    }
    if (item.category === 'comic') {
        const imageUrl = `${base}/demo/asset/page.png`;
        return res.json({ ...common, content: `<img src="${imageUrl}">`, text: '', urls: [imageUrl], mediaUrl: '' });
    }
    if (item.category === 'audio' || item.category === 'music') {
        const mediaUrl = `${base}/demo/silent.wav`;
        return res.json({ ...common, content: mediaUrl, text: '', urls: [mediaUrl], mediaUrl });
    }
    const mediaUrl = `${base}/demo/player`;
    return res.json({ ...common, content: mediaUrl, text: '', urls: [mediaUrl], mediaUrl });
});

router.get('/api/content/image', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', '..', 'src-tauri', 'icons', 'icon.png'));
});

router.get('/demo/silent.wav', (req, res) => {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(0, 40);
    res.type('audio/wav').send(header);
});

router.get('/demo/player', (req, res) => {
    res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#171a1f;color:#f5f1e8;font:16px system-ui}.stage{text-align:center}.mark{font-size:48px}.meta{color:#aeb5bd}</style></head><body><main class="stage"><div class="mark">TG</div><h1>TiangongBaoku</h1><p>\u672C\u5730\u5408\u6210\u89C6\u9891 Payload \u6F14\u793A</p><p class="meta">\u65E0\u7B2C\u4E09\u65B9\u5185\u5BB9</p></main></body></html>`);
});

router.get('/demo/asset/page.png', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'src-tauri', 'icons', 'icon.png'));
});

module.exports = router;
