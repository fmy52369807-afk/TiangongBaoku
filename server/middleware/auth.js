/**
 * JWT Authentication middleware
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Required auth — returns 401 if no valid token
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '请先登录' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, config.jwtSecret);
        req.user = payload; // { id, username }
        next();
    } catch (err) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
}

/**
 * Optional auth — sets req.user if token present, continues regardless
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            req.user = jwt.verify(token, config.jwtSecret);
        } catch (e) {
            // Ignore invalid token for optional auth
        }
    }
    next();
}

/**
 * Generate JWT token for a user
 */
function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
    );
}

module.exports = { requireAuth, optionalAuth, generateToken };
