/**
 * Reading history routes.
 */
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// POST /api/history
router.post('/', (req, res) => {
    try {
        const { sourceId, bookName, bookUrl, chapterName, chapterUrl } = req.body;
        const db = getDb();

        db.prepare(
            `INSERT INTO history (user_id, source_id, book_name, book_url, chapter_name, chapter_url)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(req.user.id, sourceId || '', bookName || '', bookUrl || '', chapterName || '', chapterUrl || '');

        res.status(201).json({ success: true });
    } catch (err) {
        console.error('[History] Add error:', err);
        res.status(500).json({ error: 'Failed to record history' });
    }
});

// GET /api/history
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const history = db.prepare(
            `SELECT book_name, book_url, source_id, MAX(read_at) AS last_read
             FROM history
             WHERE user_id = ?
             GROUP BY book_url
             ORDER BY last_read DESC
             LIMIT 50`
        ).all(req.user.id);

        res.json({ history });
    } catch (err) {
        console.error('[History] List error:', err);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

module.exports = router;
