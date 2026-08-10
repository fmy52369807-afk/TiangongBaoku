/**
 * Server configuration.
 */
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const defaultJwtSecret = 'yuedu_jwt_secret_change_in_production';
const jwtSecret = process.env.JWT_SECRET || defaultJwtSecret;

if (isProduction && jwtSecret === defaultJwtSecret) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

module.exports = {
    port: process.env.PORT || 3456,
    host: process.env.HOST || '127.0.0.1',
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    dbPath: process.env.DB_PATH || path.join(__dirname, 'data', 'yuedu.db'),
    sourcesPath: process.env.SOURCES_PATH || path.join(__dirname, '..', 'sources'),
    requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS) || 15000,
    jsRuntimeTimeout: Number(process.env.JS_RUNTIME_TIMEOUT_MS) || 5000,
    maxSearchResults: Number(process.env.MAX_SEARCH_RESULTS) || 20,
    searchConcurrency: Number(process.env.SEARCH_CONCURRENCY) || 8,
    corsOrigin: process.env.CORS_ORIGIN || 'http://127.0.0.1:3456',
    demoMode: process.env.DEMO_MODE === 'true',
    allowPrivateNetworkFetch: process.env.ALLOW_PRIVATE_NETWORK_FETCH === 'true',
    rejectUnauthorized: process.env.REJECT_UNAUTHORIZED
        ? process.env.REJECT_UNAUTHORIZED !== 'false'
        : isProduction,
};
