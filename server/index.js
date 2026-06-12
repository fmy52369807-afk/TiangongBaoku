/**
 * 阅读+音乐 源管理器 — Express Server
 *
 * Start: node index.js
 * Dev:   node --watch index.js
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { getDb } = require('./db/database');

// Initialize database
getDb();

const app = express();

// ── Middleware ───────────────────────────────────────
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
});

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        if (req.path !== '/api/sources') { // Don't log noisy endpoints
            console.log(`[${res.statusCode}] ${req.method} ${req.path} (${ms}ms)`);
        }
    });
    next();
});

// ── Static Files (frontend) ──────────────────────────
app.use(express.static(path.join(__dirname, '..', 'app'), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

// ── API Routes ───────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/search', require('./routes/search'));
app.use('/api/reader', require('./routes/reader'));
app.use('/api/content', require('./routes/content'));
app.use('/api/music', require('./routes/music'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/history', require('./routes/history'));

// Version endpoint for cache verification
app.get('/api/version', (req, res) => {
    res.json({ version: '3.2', built: new Date().toISOString(), engine: 'ruleParser v2-css-fix' });
});

// ── SPA Fallback ─────────────────────────────────────
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'app', 'index.html'));
    }
});

// ── Error Handler ────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// ── Start ────────────────────────────────────────────
app.listen(config.port, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  📚 阅读+音乐 源管理器 服务端已启动 v3.2');
    console.log(`  🌐 http://localhost:${config.port}`);
    console.log(`  📡 API: http://localhost:${config.port}/api`);
    console.log('═══════════════════════════════════════════');
    console.log('');
});
