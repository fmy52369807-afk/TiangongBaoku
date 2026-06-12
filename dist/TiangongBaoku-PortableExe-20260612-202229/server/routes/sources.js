/**
 * Sources routes — list, detail, categories
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const router = express.Router();

// Load index data lazily
let _index = null;
let _sourcesCache = {};

function loadIndex() {
    if (_index) return _index;
    const indexPath = path.join(config.sourcesPath, 'index.json');
    if (!fs.existsSync(indexPath)) {
        throw new Error('sources/index.json not found. Run node scripts/build.js');
    }
    _index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return _index;
}

function loadSourceFile(filePath) {
    if (_sourcesCache[filePath]) return _sourcesCache[filePath];
    const fullPath = path.join(config.sourcesPath, filePath);
    if (!fs.existsSync(fullPath)) return [];
    _sourcesCache[filePath] = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    return _sourcesCache[filePath];
}

// GET /api/sources/categories
router.get('/categories', (req, res) => {
    const index = loadIndex();
    const categoryCounts = {};
    index.forEach(entry => {
        const cat = entry.category || 'other';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const catConfig = {
        novel:   { icon: '📖', label: '小说',   order: 1 },
        comic:   { icon: '🎨', label: '漫画',   order: 2 },
        audio:   { icon: '🎧', label: '听书',   order: 3 },
        music:   { icon: '🎵', label: '音乐',   order: 4 },
        video:   { icon: '🎬', label: '影视',   order: 5 },
        game:    { icon: '🎮', label: '游戏',   order: 6 },
        special: { icon: '🔧', label: '工具',   order: 7 },
    };

    const categories = Object.entries(categoryCounts).map(([key, count]) => ({
        key,
        icon: catConfig[key]?.icon || '📁',
        label: catConfig[key]?.label || key,
        order: catConfig[key]?.order || 99,
        count,
    }));
    categories.sort((a, b) => a.order - b.order);

    // Add "all" pseudo-category
    categories.unshift({
        key: 'all',
        icon: '🏠',
        label: '全部',
        order: 0,
        count: index.length,
    });

    res.json({ categories, total: index.length });
});

// GET /api/sources
router.get('/', (req, res) => {
    try {
        const index = loadIndex();
        let entries = [...index];

        // Filter by category
        const { category, page = 1, size = 50 } = req.query;
        if (category && category !== 'all') {
            entries = entries.filter(e => e.category === category);
        }

        // Pagination
        const p = parseInt(page);
        const s = Math.min(parseInt(size), 500);
        const total = entries.length;
        const start = (p - 1) * s;
        const items = entries.slice(start, start + s);

        res.json({
            total,
            page: p,
            size: s,
            hasMore: start + s < total,
            items,
        });
    } catch (err) {
        console.error('[Sources] Error:', err);
        res.status(500).json({ error: '加载源列表失败' });
    }
});

// GET /api/sources/:id
router.get('/:id', (req, res) => {
    try {
        const index = loadIndex();
        const entry = index.find(e => e.id === req.params.id);
        if (!entry) {
            return res.status(404).json({ error: '源不存在' });
        }

        // Load full source data
        const fileData = loadSourceFile(entry.file);
        const fullSource = fileData[entry.index];
        if (!fullSource) {
            return res.status(404).json({ error: '源数据丢失' });
        }

        res.json({
            ...entry,
            source: fullSource,
        });
    } catch (err) {
        console.error('[Sources] Detail error:', err);
        res.status(500).json({ error: '加载源详情失败' });
    }
});

module.exports = router;
