/**
 * Music routes — search and play music via source APIs and AppRhyme
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { fetchUrl } = require('../engine/httpClient');
const { extractValue, extractList, resolveUrl, applyTemplate } = require('../engine/ruleParser');

const router = express.Router();

// Load AppRhyme config
let apprhymeConfig = null;
function getAppRhymeConfig() {
    if (apprhymeConfig) return apprhymeConfig;
    const cfgPath = path.join(config.sourcesPath, 'music', 'apprhyme_api.json');
    if (fs.existsSync(cfgPath)) {
        apprhymeConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
    return apprhymeConfig;
}

// Load music sources from index
function getMusicSources() {
    const indexPath = path.join(config.sourcesPath, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return index.filter(e => e.category === 'music');
}

// GET /api/music/search?keyword=xxx
router.get('/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        if (!keyword) {
            return res.status(400).json({ error: '请输入搜索关键词' });
        }

        const musicSources = getMusicSources();
        const results = [];

        for (const entry of musicSources.slice(0, 5)) {
            try {
                const fullPath = path.join(config.sourcesPath, entry.file);
                const fileData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                const source = fileData[entry.index];
                if (!source || !source.searchUrl) continue;

                if (source.searchUrl.startsWith('@js:')) continue;

                let searchUrl = applyTemplate(source.searchUrl, { key: keyword });
                searchUrl = resolveUrl(searchUrl, source.bookSourceUrl || '');

                const resp = await fetchUrl(searchUrl, {}, config.requestTimeout);
                const rule = source.ruleSearch || {};

                const songList = extractList(resp, rule.bookList, searchUrl);
                if (songList && songList.length > 0) {
                    const songs = songList.slice(0, 10).map(item => {
                        return {
                            sourceId: entry.id,
                            sourceName: entry.name,
                            name: String(extractValue(item, rule.name) || ''),
                            artist: String(extractValue(item, rule.author) || ''),
                            album: String(extractValue(item, rule.intro) || ''),
                            songUrl: String(extractValue(item, rule.bookUrl) || ''),
                        };
                    });
                    results.push({ sourceId: entry.id, sourceName: entry.name, songs });
                }
            } catch (e) {
                // Skip failed sources
            }
        }

        res.json({ keyword, results });
    } catch (err) {
        console.error('[Music] Search error:', err);
        res.status(500).json({ error: '音乐搜索失败' });
    }
});

// GET /api/music/play?sourceId=xxx&songUrl=xxx
router.get('/play', async (req, res) => {
    try {
        const { sourceId, songUrl } = req.query;
        if (!sourceId || !songUrl) {
            return res.status(400).json({ error: '需要 sourceId 和 songUrl 参数' });
        }

        // For music sources, the "toc" rule extracts play URL with quality info
        const indexPath = path.join(config.sourcesPath, 'index.json');
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const entry = index.find(e => e.id === sourceId);
        if (!entry) return res.status(404).json({ error: '源不存在' });

        const fullPath = path.join(config.sourcesPath, entry.file);
        const fileData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const source = fileData[entry.index];
        if (!source) return res.status(404).json({ error: '源不存在' });

        const decodedUrl = decodeURIComponent(songUrl);

        if (source.ruleToc && source.ruleToc.chapterList) {
            // Music sources use ruleToc to list quality/formats
            const resp = await fetchUrl(decodedUrl, {}, config.requestTimeout);
            const formats = extractList(resp, source.ruleToc.chapterList, decodedUrl);
            const playOptions = formats.map(f => ({
                quality: String(extractValue(f, source.ruleToc.chapterName) || ''),
                url: String(extractValue(f, source.ruleToc.chapterUrl) || ''),
                info: String(extractValue(f, source.ruleToc.updateTime) || ''),
            }));
            res.json({ playOptions });
        } else {
            res.json({ playOptions: [{ url: decodedUrl, quality: '默认' }] });
        }
    } catch (err) {
        console.error('[Music] Play error:', err);
        res.status(500).json({ error: '获取播放链接失败' });
    }
});

// GET /api/music/kuwo?rid=xxx&br=xxx  (AppRhyme direct)
router.get('/kuwo', async (req, res) => {
    try {
        const { rid, br = '320' } = req.query;
        if (!rid) return res.status(400).json({ error: '需要音乐 rid' });

        const url = `https://mobi.kuwo.cn/mobi.s?f=web&prod=kwplayer_ar_10.3.3.0&type=convert_url&rid=${rid}&br=${br}`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };

        const resp = await fetchUrl(url, { headers }, config.requestTimeout);
        // Response should be plain text with the actual play URL
        res.json({ url: resp.trim(), source: 'kuwo' });
    } catch (err) {
        console.error('[Music] Kuwo error:', err);
        res.status(500).json({ error: '获取酷我播放链接失败' });
    }
});

// GET /api/music/wangyi?id=xxx&level=xxx  (AppRhyme direct)
router.get('/wangyi', async (req, res) => {
    try {
        const { id, level = 'standard' } = req.query;
        if (!id) return res.status(400).json({ error: '需要音乐 id' });

        const url = `https://csm.sayqz.com/api/rhyme/?id=${id}&level=${level}`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        };

        const resp = await fetchUrl(url, { headers }, config.requestTimeout);
        let data;
        try {
            data = JSON.parse(resp);
        } catch {
            data = { url: resp.trim() };
        }
        res.json({ ...data, source: 'wangyi' });
    } catch (err) {
        console.error('[Music] Wangyi error:', err);
        res.status(500).json({ error: '获取网易云播放链接失败' });
    }
});

module.exports = router;
