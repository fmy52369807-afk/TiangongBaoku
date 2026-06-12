/**
 * Favorites routes - CRUD for user favorites.
 */
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/favorites
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const favorites = db.prepare(
            'SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
        ).all(req.user.id);
        res.json({ favorites });
    } catch (err) {
        console.error('[Favorites] List error:', err);
        res.status(500).json({ error: 'Failed to load favorites' });
    }
});

// POST /api/favorites
router.post('/', (req, res) => {
    try {
        const { sourceId, sourceName, sourceUrl, category } = req.body;
        if (!sourceId) {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const db = getDb();
        try {
            const result = db.prepare(
                `INSERT INTO favorites (user_id, source_id, source_name, source_url, category)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(req.user.id, sourceId, sourceName || '', sourceUrl || '', category || '');

            res.status(201).json({
                id: result.lastInsertRowid,
                sourceId,
                sourceName,
            });
        } catch (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Source already favorited' });
            }
            throw err;
        }
    } catch (err) {
        console.error('[Favorites] Add error:', err);
        res.status(500).json({ error: 'Failed to add favorite' });
    }
});

// DELETE /api/favorites/:sourceId
router.delete('/:sourceId', (req, res) => {
    try {
        const db = getDb();
        const result = db.prepare(
            'DELETE FROM favorites WHERE user_id = ? AND source_id = ?'
        ).run(req.user.id, req.params.sourceId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Favorite not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Favorites] Delete error:', err);
        res.status(500).json({ error: 'Failed to remove favorite' });
    }
});

module.exports = router;
