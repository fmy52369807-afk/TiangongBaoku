/**
 * API Client — communicates with the Express backend
 */
const API = {
    baseUrl: '',  // Empty = same origin (served by Express)

    _token: localStorage.getItem('yuedu_token') || '',

    setToken(token) {
        this._token = token;
        localStorage.setItem('yuedu_token', token);
    },

    clearToken() {
        this._token = '';
        localStorage.removeItem('yuedu_token');
    },

    getToken() {
        return this._token;
    },

    isLoggedIn() {
        return !!this._token;
    },

    async _fetch(path, options = {}) {
        const url = this.baseUrl + path;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        if (this._token) {
            headers['Authorization'] = `Bearer ${this._token}`;
        }
        const res = await fetch(url, { ...options, headers });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        return data;
    },

    // ── Auth ──────────────────────────────────────
    auth: {
        register(username, password) {
            return API._fetch('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
        },
        login(username, password) {
            return API._fetch('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
        },
        me() {
            return API._fetch('/api/auth/me');
        },
    },

    // ── Sources ───────────────────────────────────
    sources: {
        list(category, page = 1, size = 50) {
            const params = new URLSearchParams({ category, page, size });
            return API._fetch(`/api/sources?${params}`);
        },
        detail(id) {
            return API._fetch(`/api/sources/${id}`);
        },
        categories() {
            return API._fetch('/api/sources/categories');
        },
    },

    // ── Search ────────────────────────────────────
    search(keyword, category) {
        return API._fetch('/api/search', {
            method: 'POST',
            body: JSON.stringify({ keyword, category }),
        });
    },

    // ── Reader ────────────────────────────────────
    reader: {
        book(sourceId, bookUrl) {
            return API._fetch(`/api/reader/book?sourceId=${sourceId}&bookUrl=${encodeURIComponent(bookUrl)}`);
        },
        toc(sourceId, tocUrl) {
            return API._fetch(`/api/reader/toc?sourceId=${sourceId}&tocUrl=${encodeURIComponent(tocUrl)}`);
        },
        chapter(sourceId, chapterUrl) {
            return API._fetch(`/api/reader/chapter?sourceId=${sourceId}&chapterUrl=${encodeURIComponent(chapterUrl)}`);
        },
    },

    // ── Music ─────────────────────────────────────
    music: {
        search(keyword) {
            return API._fetch(`/api/music/search?keyword=${encodeURIComponent(keyword)}`);
        },
        play(sourceId, songUrl) {
            return API._fetch(`/api/music/play?sourceId=${sourceId}&songUrl=${encodeURIComponent(songUrl)}`);
        },
        kuwo(rid, br) {
            return API._fetch(`/api/music/kuwo?rid=${rid}&br=${br || '320'}`);
        },
        wangyi(id, level) {
            return API._fetch(`/api/music/wangyi?id=${id}&level=${level || 'standard'}`);
        },
    },

    // ── Favorites ─────────────────────────────────
    favorites: {
        list() {
            return API._fetch('/api/favorites');
        },
        add(sourceId, sourceName, sourceUrl, category) {
            return API._fetch('/api/favorites', {
                method: 'POST',
                body: JSON.stringify({ sourceId, sourceName, sourceUrl, category }),
            });
        },
        remove(sourceId) {
            return API._fetch(`/api/favorites/${sourceId}`, { method: 'DELETE' });
        },
    },

    // ── History ───────────────────────────────────
    history: {
        list() {
            return API._fetch('/api/history');
        },
        add(bookName, bookUrl, chapterName, chapterUrl, sourceId) {
            return API._fetch('/api/history', {
                method: 'POST',
                body: JSON.stringify({ sourceId, bookName, bookUrl, chapterName, chapterUrl }),
            });
        },
    },
};
