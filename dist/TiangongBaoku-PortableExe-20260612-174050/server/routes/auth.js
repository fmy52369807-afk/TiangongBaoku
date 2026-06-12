/**
 * Auth routes — register, login, me
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAuth, generateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        if (username.length < 2 || username.length > 30) {
            return res.status(400).json({ error: '用户名长度需要2-30个字符' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: '密码至少需要4个字符' });
        }

        const db = getDb();
        const passwordHash = bcrypt.hashSync(password, 10);

        try {
            const result = db.prepare(
                'INSERT INTO users (username, password_hash) VALUES (?, ?)'
            ).run(username, passwordHash);

            const user = { id: result.lastInsertRowid, username };
            const token = generateToken(user);
            res.status(201).json({ token, user });
        } catch (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: '用户名已存在' });
            }
            throw err;
        }
    } catch (err) {
        console.error('[Auth] Register error:', err);
        res.status(500).json({ error: '注册失败' });
    }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }

        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const token = generateToken({ id: user.id, username: user.username });
        res.json({
            token,
            user: { id: user.id, username: user.username },
        });
    } catch (err) {
        console.error('[Auth] Login error:', err);
        res.status(500).json({ error: '登录失败' });
    }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
