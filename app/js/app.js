/**
 * 阅读+音乐 源管理器 — Main App (SPA Router)
 */
const App = {
    currentCategory: 'all',
    searchQuery: '',
    currentRoute: 'home',

    categoryConfig: {
        all:       { icon: '🏠', label: '全部',   order: 0 },
        favorites: { icon: '⭐', label: '收藏',   order: 99 },
        novel:     { icon: '📖', label: '小说',   order: 1 },
        comic:     { icon: '🎨', label: '漫画',   order: 2 },
        audio:     { icon: '🎧', label: '听书',   order: 3 },
        music:     { icon: '🎵', label: '音乐',   order: 4 },
        video:     { icon: '🎬', label: '影视',   order: 5 },
        game:      { icon: '🎮', label: '游戏',   order: 6 },
        special:   { icon: '🔧', label: '工具',   order: 7 },
    },

    // ── Init ────────────────────────────────────────
    init() {
        if (!window.SOURCE_DATA && !API.isLoggedIn()) {
            // No local data and not logged in — still works with server
            console.log('[App] No local data, using server API');
        }
        this.bindGlobalEvents();
        this.updateAuthState();
        this.route();
        window.addEventListener('hashchange', () => this.route());
    },

    // ── Router ──────────────────────────────────────
    route() {
        const hash = location.hash || '#/';
        const [path, queryStr] = hash.split('?');
        const params = new URLSearchParams(queryStr || '');

        switch (true) {
            case path === '#/login':
                this.currentRoute = 'login';
                AuthUI.render();
                break;
            case path === '#/reader':
                this.currentRoute = 'reader';
                const sourceId = params.get('sourceId');
                const bookUrl = params.get('bookUrl');
                if (sourceId && bookUrl) {
                    ReaderUI.open(sourceId, bookUrl, params.get('name') || '');
                } else {
                    this.navigate('home');
                }
                break;
            case path === '#/player':
                this.currentRoute = 'player';
                document.getElementById('app').innerHTML = '<div class="page-message">🎵 音乐播放器加载中...</div>';
                break;
            default:
                this.currentRoute = 'home';
                this.renderHome();
                break;
        }
    },

    navigate(route, params) {
        if (route === 'home') {
            location.hash = '#/';
        } else if (route === 'login') {
            location.hash = '#/login';
        } else if (route === 'reader') {
            const qs = new URLSearchParams(params).toString();
            location.hash = '#/reader?' + qs;
        } else if (route === 'player') {
            const qs = new URLSearchParams(params).toString();
            location.hash = '#/player?' + qs;
        }
    },

    // ── Home View ───────────────────────────────────
    renderHome() {
        const app = document.getElementById('app');

        // Build category tab HTML directly (no dynamic DOM manipulation)
        const cats = Object.values(this.categoryConfig)
            .filter(c => c.order > 0 && c.order < 99)
            .sort((a, b) => a.order - b.order);

        const data = window.SOURCE_DATA;
        const catTabsHtml = cats.map(cat => {
            const count = data ? data.index.filter(e => e.category === cat.key).length : '?';
            return `<button class="tab-btn" data-category="${cat.key}">
                <span class="tab-icon">${cat.icon}</span><span class="tab-label">${cat.label}</span>
                <span class="tab-badge" id="badge-${cat.key}">${count}</span>
            </button>`;
        }).join('');

        app.innerHTML = `
            <header class="app-header">
                <div class="header-top">
                    <div>
                        <h1 class="app-title">📚 阅读+音乐</h1>
                        <p class="app-subtitle">源管理器 v2 — <span id="headerCount">${this.getSourceCount()}</span> 条源</p>
                    </div>
                    <div id="authArea"></div>
                </div>
            </header>

            <div class="search-container">
                <div class="search-wrapper">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="searchInput" class="search-input"
                           placeholder="搜索源名称 / URL / 注释...（回车搜索书籍）" autocomplete="off">
                    <button id="searchClear" class="search-clear" style="display:none">✕</button>
                    <button id="searchBtn" class="btn btn-primary btn-sm" style="display:none">搜索</button>
                </div>
                <div id="searchResults" class="search-results" style="display:none"></div>
            </div>

            <nav class="tab-nav" id="tabNav">
                <button class="tab-btn active" data-category="all">
                    <span class="tab-icon">🏠</span><span class="tab-label">全部</span>
                    <span class="tab-badge" id="badge-all">${this.getSourceCount()}</span>
                </button>
                ${catTabsHtml}
                <button class="tab-btn" data-category="favorites">
                    <span class="tab-icon">⭐</span><span class="tab-label">收藏</span>
                    <span class="tab-badge" id="badge-favorites">0</span>
                </button>
            </nav>

            <div class="stats-bar">
                <span>共 <strong id="statTotal">${this.getSourceCount()}</strong> 条</span>
                <span>显示 <strong id="statShowing">0</strong> 条</span>
                <span id="statStatus"></span>
            </div>

            <main class="source-list" id="sourceList"></main>
            <div class="empty-state" id="emptyState" style="display:none">
                <div class="empty-icon">📭</div>
                <p class="empty-title">没有找到匹配的源</p>
                <p class="empty-desc">试试更换搜索词或切换分类</p>
            </div>

            <div class="overlay" id="detailOverlay" style="display:none">
                <div class="detail-panel" id="detailPanel"></div>
            </div>
            <div class="toast" id="toast" style="display:none"></div>
        `;

        this.bindHomeEvents();
        this.renderSourceList();
        this.updateFavBadge();
        this.updateAuthState();
    },

    buildTabs() {
        const nav = document.getElementById('tabNav');
        const cats = Object.values(this.categoryConfig)
            .filter(c => c.order > 0 && c.order < 99)
            .sort((a, b) => a.order - b.order);

        // Add from local data or server
        const data = window.SOURCE_DATA;
        cats.forEach(cat => {
            const count = data
                ? data.index.filter(e => e.category === cat.key).length
                : cat.key;
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.dataset.category = cat.key;
            btn.innerHTML = `
                <span class="tab-icon">${cat.icon}</span>
                <span class="tab-label">${cat.label}</span>
                <span class="tab-badge" id="badge-${cat.key}">${count}</span>
            `;
            nav.appendChild(btn);
        });
    },

    bindHomeEvents() {
        const nav = document.getElementById('tabNav');
        nav.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            if (btn.dataset.category === this.currentCategory && !this.searchQuery) return;
            this.currentCategory = btn.dataset.category;
            this.searchQuery = '';
            document.getElementById('searchInput').value = '';
            document.getElementById('searchClear').style.display = 'none';
            document.getElementById('searchBtn').style.display = 'none';
            document.getElementById('searchResults').style.display = 'none';
            this.updateActiveTab();
            this.renderSourceList();
        });

        const searchInput = document.getElementById('searchInput');
        const searchClear = document.getElementById('searchClear');
        const searchBtn = document.getElementById('searchBtn');

        searchInput.addEventListener('input', () => {
            const val = searchInput.value.trim();
            searchClear.style.display = val ? 'block' : 'none';
            searchBtn.style.display = val ? 'block' : 'none';
            if (!val) {
                document.getElementById('searchResults').style.display = 'none';
            }
            this.searchQuery = val.toLowerCase();
            if (val) {
                this.renderSourceList();
            }
        });

        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            this.searchQuery = '';
            searchClear.style.display = 'none';
            searchBtn.style.display = 'none';
            document.getElementById('searchResults').style.display = 'none';
            searchInput.focus();
            this.renderSourceList();
        });

        // Search button — cross-source search via server
        searchBtn.addEventListener('click', () => this.doServerSearch());

        // Enter key in search
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.doServerSearch();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
            if (e.key === 'Escape') {
                if (document.getElementById('detailOverlay').style.display !== 'none') {
                    this.closeDetail();
                }
            }
        });

        // Overlay close
        document.getElementById('detailOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeDetail();
        });
    },

    async doServerSearch() {
        const keyword = document.getElementById('searchInput').value.trim();
        if (!keyword || keyword.length < 1) return;

        const resultsEl = document.getElementById('searchResults');
        resultsEl.style.display = 'block';
        resultsEl.innerHTML = '<div class="loading">🔍 正在跨源搜索...</div>';

        try {
            const data = await API.search(keyword, this.currentCategory === 'all' ? undefined : this.currentCategory);
            this.renderSearchResults(data);
        } catch (err) {
            resultsEl.innerHTML = `<div class="error">搜索失败: ${err.message}</div>`;
        }
    },

    renderSearchResults(data) {
        const el = document.getElementById('searchResults');
        if (!data.results || data.results.length === 0) {
            el.innerHTML = '<div class="empty-message">未找到相关书籍/歌曲</div>';
            return;
        }

        let html = `<div class="search-header">找到 ${data.totalResults} 个结果，来自 ${data.sourceCount} 个源</div>`;
        data.results.forEach(source => {
            html += `<div class="search-source-group">
                <div class="search-source-name">📚 ${this.esc(source.sourceName)} (${source.items.length})</div>`;
            source.items.forEach(item => {
                html += `
                <div class="search-result-item" onclick="App.openReader('${this.esc(item.sourceId)}','${this.esc(item.bookUrl)}','${this.esc(item.name)}')">
                    <div class="result-name">${this.esc(item.name)}</div>
                    <div class="result-author">${this.esc(item.author)}</div>
                    ${item.intro ? `<div class="result-intro">${this.esc(item.intro).substring(0, 100)}</div>` : ''}
                </div>`;
            });
            html += '</div>';
        });

        if (data.errors && data.errors.length > 0) {
            html += `<div class="search-errors">⚠️ ${data.errors.length} 个源搜索失败</div>`;
        }

        el.innerHTML = html;
    },

    openReader(sourceId, bookUrl, name) {
        this.navigate('reader', { sourceId, bookUrl, name });
    },

    // ── Source List ─────────────────────────────────
    renderSourceList() {
        const entries = this.getFilteredEntries();
        const listEl = document.getElementById('sourceList');
        const emptyEl = document.getElementById('emptyState');

        if (entries.length === 0) {
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
        } else {
            emptyEl.style.display = 'none';
            listEl.innerHTML = entries.map(e => this.buildCard(e)).join('');
            this.bindCardEvents(listEl);
        }

        document.getElementById('statShowing').textContent = entries.length;
    },

    getFilteredEntries() {
        const data = window.SOURCE_DATA;
        if (!data) return [];

        let entries;
        if (this.currentCategory === 'favorites') {
            const favIds = JSON.parse(localStorage.getItem('yuedu_favorites') || '[]');
            entries = data.index.filter(e => favIds.includes(e.id));
        } else if (this.currentCategory === 'all') {
            entries = data.index;
        } else {
            entries = data.index.filter(e => e.category === this.currentCategory);
        }

        if (this.searchQuery) {
            const q = this.searchQuery;
            entries = entries.filter(e =>
                (e.name || '').toLowerCase().includes(q) ||
                (e.url || '').toLowerCase().includes(q) ||
                (e.comment || '').toLowerCase().includes(q) ||
                (e.group || '').toLowerCase().includes(q)
            );
        }

        return entries;
    },

    buildCard(entry) {
        const id = entry.id || '';
        const name = entry.name || '未知';
        const url = entry.url || '';
        const comment = (entry.comment || '').substring(0, 80);
        const status = entry.status || 'ok';
        const isFav = JSON.parse(localStorage.getItem('yuedu_favorites') || '[]').includes(id);

        let statusClass = 'ok', tagHtml = '';
        if (status === 'partial') { statusClass = 'partial'; tagHtml = '<span class="card-tag partial">部分可用</span>'; }
        if (status === 'vpn_needed') { statusClass = 'vpn_needed'; tagHtml = '<span class="card-tag vpn">需特殊网络</span>'; }

        return `
            <div class="source-card" data-id="${this.esc(id)}">
                <div class="card-status ${statusClass}"></div>
                <div class="card-body">
                    <div class="card-title">
                        <span class="card-title-text">${this.esc(name)}</span>${tagHtml}
                    </div>
                    ${url ? `<div class="card-url">${this.esc(url.length > 60 ? url.substring(0,60)+'…' : url)}</div>` : ''}
                    ${comment ? `<div class="card-comment">${this.esc(comment.length > 60 ? comment.substring(0,60)+'…' : comment)}</div>` : ''}
                </div>
                <button class="card-star ${isFav ? 'active' : ''}" data-id="${this.esc(id)}">${isFav ? '⭐' : '☆'}</button>
            </div>
        `;
    },

    bindCardEvents(listEl) {
        listEl.querySelectorAll('.source-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.card-star')) return;
                this.openDetail(card.dataset.id);
            });
        });
        listEl.querySelectorAll('.card-star').forEach(star => {
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = star.dataset.id;
                let favs = JSON.parse(localStorage.getItem('yuedu_favorites') || '[]');
                if (favs.includes(id)) {
                    favs = favs.filter(x => x !== id);
                    star.classList.remove('active');
                    star.textContent = '☆';
                    this.showToast('已取消收藏');
                    // Also remove from server
                    API.favorites.remove(id).catch(() => {});
                } else {
                    favs.push(id);
                    star.classList.add('active');
                    star.textContent = '⭐';
                    this.showToast('已收藏 ✨');
                    // Sync to server
                    const entry = (window.SOURCE_DATA?.index || []).find(e => e.id === id);
                    if (entry && API.isLoggedIn()) {
                        API.favorites.add(id, entry.name, entry.url, entry.category).catch(() => {});
                    }
                }
                localStorage.setItem('yuedu_favorites', JSON.stringify(favs));
                this.updateFavBadge();
                if (this.currentCategory === 'favorites') this.renderSourceList();
            });
        });
    },

    // ── Detail Panel ────────────────────────────────
    async openDetail(id) {
        // Show loading
        const overlay = document.getElementById('detailOverlay');
        const panel = document.getElementById('detailPanel');
        panel.innerHTML = `<div class="detail-handle"></div><div class="loading" style="padding:40px">加载源详情...</div>`;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        try {
            // Fetch full source from API
            const detail = await API.sources.detail(id);
            const src = detail.source || detail;
            const entry = detail;

            const fields = [
                ['源名称', entry.name || src.bookSourceName],
                ['URL', entry.url || src.bookSourceUrl],
                ['分类', entry.group || src.bookSourceGroup],
                ['类型', {0:'📝 文本',1:'🎧 音频',2:'🖼️ 图片'}[src.bookSourceType] || '未知'],
                ['注释', (src.bookSourceComment || entry.comment || '-').replace(/\\n/g, '<br>')],
                ['状态', {ok:'✅ 正常',partial:'⚠️ 部分可用',vpn_needed:'🔒 需特殊网络'}[entry.status] || '✅ 正常'],
            ];

            const rulesHtml = ['ruleBookInfo','ruleContent','ruleSearch','ruleToc','ruleExplore']
                .filter(k => src[k] && Object.keys(src[k]).length > 0)
                .map(k => `
                    <div class="rule-section" data-rule="${k}">
                        <div class="rule-section-header" onclick="this.parentElement.classList.toggle('open')">
                            <span>${{ruleBookInfo:'📖 书籍详情',ruleContent:'📄 正文',ruleSearch:'🔍 搜索',ruleToc:'📑 目录',ruleExplore:'🧭 发现'}[k]||k}</span>
                            <span class="rule-section-arrow">▼</span>
                        </div>
                        <div class="rule-section-body">${this.esc(JSON.stringify(src[k], null, 2))}</div>
                    </div>`).join('');

            panel.innerHTML = `
                <div class="detail-handle"></div>
                <div class="detail-header">
                    <div class="detail-name">${this.esc(entry.name || src.bookSourceName)}</div>
                    <button class="detail-close" onclick="App.closeDetail()">✕</button>
                </div>
                <div class="detail-body">
                    ${fields.map(([l,v]) => `<div class="detail-field"><div class="detail-field-label">${l}</div><div class="detail-field-value${l==='URL'?' url':''}">${v||'-'}</div></div>`).join('')}
                    <div class="detail-url-actions">
                        <button class="btn btn-primary" onclick="App.copyUrl('${this.esc(entry.url||'')}')">📋 复制URL</button>
                        <button class="btn btn-secondary" id="detailFavBtn" onclick="App.toggleDetailFav('${this.esc(id)}')">${JSON.parse(localStorage.getItem('yuedu_favorites')||'[]').includes(id)?'⭐ 取消收藏':'☆ 收藏'}</button>
                    </div>
                    <div class="detail-rules">${rulesHtml}</div>
                </div>
            `;
        } catch (err) {
            panel.innerHTML = `<div class="detail-handle"></div><div class="error" style="padding:40px">加载失败: ${err.message}</div>`;
        }
    },

    closeDetail() {
        document.getElementById('detailOverlay').style.display = 'none';
        document.body.style.overflow = '';
    },

    toggleDetailFav(id) {
        let favs = JSON.parse(localStorage.getItem('yuedu_favorites') || '[]');
        if (favs.includes(id)) {
            favs = favs.filter(x => x !== id);
            API.favorites.remove(id).catch(() => {});
        } else {
            favs.push(id);
            const entry = (window.SOURCE_DATA?.index || []).find(e => e.id === id);
            if (entry && API.isLoggedIn()) {
                API.favorites.add(id, entry.name, entry.url, entry.category).catch(() => {});
            }
        }
        localStorage.setItem('yuedu_favorites', JSON.stringify(favs));
        document.getElementById('detailFavBtn').innerHTML = favs.includes(id) ? '⭐ 取消收藏' : '☆ 收藏';
        this.updateFavBadge();
    },

    copyUrl(url) {
        if (!url) { this.showToast('没有可复制的 URL'); return; }
        navigator.clipboard.writeText(url).then(() => this.showToast('✅ URL 已复制'));
    },

    // ── Auth State ──────────────────────────────────
    updateAuthState() {
        const area = document.getElementById('authArea');
        if (!area) return;
        if (API.isLoggedIn()) {
            area.innerHTML = `
                <span class="user-badge">👤 ${this.esc(JSON.parse(atob(API.getToken().split('.')[1])).username)}</span>
                <button class="btn btn-sm btn-secondary" onclick="App.logout()">退出</button>
            `;
        } else {
            area.innerHTML = `<button class="btn btn-sm btn-primary" onclick="App.navigate('login')">登录</button>`;
        }
    },

    logout() {
        API.clearToken();
        this.updateAuthState();
        this.showToast('已退出登录');
    },

    // ── Helpers ─────────────────────────────────────
    getSourceCount() {
        return window.SOURCE_DATA?.totalSources || '?';
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.style.display = 'none', 2000);
    },

    updateFavBadge() {
        const badge = document.getElementById('badge-favorites');
        if (badge) badge.textContent = JSON.parse(localStorage.getItem('yuedu_favorites') || '[]').length;
    },

    bindGlobalEvents() {
        // Handle ESC globally for overlays
    },

    esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
