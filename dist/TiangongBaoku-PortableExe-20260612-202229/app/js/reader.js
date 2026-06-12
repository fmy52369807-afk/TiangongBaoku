/**
 * Reader UI — book info, table of contents, chapter reading
 */
const ReaderUI = {
    state: {
        sourceId: '',
        bookUrl: '',
        bookName: '',
        tocUrl: '',
        chapters: [],
    },

    async open(sourceId, bookUrl, bookName) {
        this.state.sourceId = sourceId;
        this.state.bookUrl = bookUrl;
        this.state.bookName = bookName || '加载中...';

        App.navigate('reader');
        this.renderLoading();

        try {
            const data = await API.reader.book(sourceId, bookUrl);
            this.state.bookName = data.name;
            this.state.tocUrl = data.tocUrl;
            this.renderBookInfo(data);

            if (data.tocUrl) {
                this.loadToc(data.tocUrl);
            }
        } catch (err) {
            this.renderError(err.message);
        }

        // Record history
        if (API.isLoggedIn()) {
            API.history.add(this.state.bookName, bookUrl, '', '', sourceId).catch(() => {});
        }
    },

    async loadToc(tocUrl) {
        const el = document.getElementById('readerToc');
        if (el) el.innerHTML = '<div class="loading">加载目录中...</div>';

        try {
            const data = await API.reader.toc(this.state.sourceId, tocUrl);
            this.state.chapters = data.chapters;
            this.renderToc(data.chapters);
        } catch (err) {
            if (el) el.innerHTML = `<div class="error">目录加载失败: ${err.message}</div>`;
        }
    },

    async loadChapter(chapterUrl, chapterName) {
        const contentEl = document.getElementById('readerContent');
        if (contentEl) {
            contentEl.innerHTML = '<div class="loading">加载正文中...</div>';
        }
        document.getElementById('readerChapterTitle').textContent = chapterName || '正文';

        // Switch to content tab
        document.querySelectorAll('.reader-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.reader-tab[data-tab="content"]')?.classList.add('active');
        document.getElementById('readerTocView').style.display = 'none';
        document.getElementById('readerContentView').style.display = '';

        try {
            const data = await API.reader.chapter(this.state.sourceId, chapterUrl);
            this.renderContent(data.content, chapterName);

            // Record reading history
            if (API.isLoggedIn()) {
                API.history.add(
                    this.state.bookName, this.state.bookUrl,
                    chapterName, chapterUrl, this.state.sourceId
                ).catch(() => {});
            }
        } catch (err) {
            if (contentEl) contentEl.innerHTML = `<div class="error">加载失败: ${err.message}</div>`;
        }
    },

    // ── Render ────────────────────────────────────────
    renderLoading() {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="reader-container">
                <div class="reader-header">
                    <button class="btn btn-secondary" onclick="App.navigate('home')">← 返回</button>
                    <span class="reader-title">${this.esc(this.state.bookName)}</span>
                </div>
                <div class="loading">加载中...</div>
            </div>
        `;
    },

    renderBookInfo(data) {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="reader-container">
                <div class="reader-header">
                    <button class="btn btn-secondary" onclick="App.navigate('home')">← 返回</button>
                    <span class="reader-title">${this.esc(data.name)}</span>
                    <div class="reader-header-actions">
                        <button class="btn btn-secondary" onclick="ReaderUI.toggleFontSize(-1)">A-</button>
                        <button class="btn btn-secondary" onclick="ReaderUI.toggleFontSize(1)">A+</button>
                    </div>
                </div>
                <div class="reader-tabs">
                    <button class="reader-tab active" data-tab="info">📖 详情</button>
                    <button class="reader-tab" data-tab="toc">📑 目录</button>
                    <button class="reader-tab" data-tab="content">📄 阅读</button>
                </div>
                <!-- Info View -->
                <div class="reader-view" id="readerInfoView">
                    <div class="book-info">
                        ${data.coverUrl ? `<img class="book-cover" src="${this.esc(data.coverUrl)}" alt="封面" onerror="this.style.display='none'">` : ''}
                        <div class="book-meta">
                            <div class="book-name">${this.esc(data.name)}</div>
                            <div class="book-author">${this.esc(data.author)}</div>
                            <div class="book-stats">
                                <span>${this.esc(data.kind)}</span>
                                <span>${this.esc(data.wordCount)}</span>
                            </div>
                            <div class="book-last">最新: ${this.esc(data.lastChapter)}</div>
                        </div>
                    </div>
                    <div class="book-intro">${this.esc(data.intro).replace(/\\n/g, '<br>')}</div>
                </div>
                <!-- TOC View -->
                <div class="reader-view" id="readerTocView" style="display:none">
                    <div id="readerToc" class="toc-list">加载中...</div>
                </div>
                <!-- Content View -->
                <div class="reader-view" id="readerContentView" style="display:none">
                    <div class="chapter-title" id="readerChapterTitle">正文</div>
                    <div class="chapter-nav">
                        <button class="btn btn-secondary" id="btnPrevChapter" onclick="ReaderUI.navChapter(-1)">上一章</button>
                        <span class="chapter-progress" id="chapterProgress"></span>
                        <button class="btn btn-secondary" id="btnNextChapter" onclick="ReaderUI.navChapter(1)">下一章</button>
                    </div>
                    <div class="chapter-content" id="readerContent"></div>
                    <div class="chapter-nav bottom">
                        <button class="btn btn-secondary" onclick="ReaderUI.navChapter(-1)">上一章</button>
                        <button class="btn btn-secondary" onclick="ReaderUI.navChapter(1)">下一章</button>
                    </div>
                </div>
            </div>
        `;

        // Tab switching
        app.querySelectorAll('.reader-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                app.querySelectorAll('.reader-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const view = tab.dataset.tab;
                document.getElementById('readerInfoView').style.display = view === 'info' ? '' : 'none';
                document.getElementById('readerTocView').style.display = view === 'toc' ? '' : 'none';
                document.getElementById('readerContentView').style.display = view === 'content' ? '' : 'none';
            });
        });

        // Restore font size
        const savedSize = localStorage.getItem('reader_fontSize') || '18';
        document.querySelector('.reader-container').style.setProperty('--reader-font-size', savedSize + 'px');
    },

    renderToc(chapters) {
        const el = document.getElementById('readerToc');
        if (!el) return;
        if (!chapters || chapters.length === 0) {
            el.innerHTML = '<div class="empty-message">暂无目录</div>';
            return;
        }
        el.innerHTML = chapters.map((ch, i) => `
            <div class="toc-item" onclick="ReaderUI.loadChapter('${this.esc(ch.url)}','${this.esc(ch.name)}');ReaderUI.state.currentIndex=${i}">
                <span class="toc-index">${i + 1}</span>
                <span class="toc-name">${this.esc(ch.name)}</span>
                ${ch.updateTime ? `<span class="toc-time">${this.esc(ch.updateTime)}</span>` : ''}
                ${ch.isVip ? '<span class="toc-vip">🔒</span>' : ''}
            </div>
        `).join('');
    },

    renderContent(content, title) {
        const el = document.getElementById('readerContent');
        if (!el) return;
        // Format paragraphs
        const paragraphs = content.split('\n').filter(p => p.trim());
        el.innerHTML = paragraphs.map(p => `<p>${this.esc(p)}</p>`).join('');
        document.getElementById('readerChapterTitle').textContent = title || '正文';
        this.updateChapterNav();
    },

    navChapter(direction) {
        const idx = (this.state.currentIndex || 0) + direction;
        if (idx < 0 || idx >= this.state.chapters.length) {
            App.showToast(direction > 0 ? '已是最后一章' : '已是第一章');
            return;
        }
        const ch = this.state.chapters[idx];
        this.state.currentIndex = idx;
        this.loadChapter(ch.url, ch.name);
    },

    updateChapterNav() {
        const idx = this.state.currentIndex || 0;
        const total = this.state.chapters.length;
        document.getElementById('chapterProgress').textContent = total ? `${idx + 1} / ${total}` : '';
        document.getElementById('btnPrevChapter').style.visibility = idx <= 0 ? 'hidden' : '';
        document.getElementById('btnNextChapter').style.visibility = idx >= total - 1 ? 'hidden' : '';
    },

    renderError(msg) {
        const app = document.getElementById('app');
        app.innerHTML = `
            <div class="reader-container">
                <div class="reader-header">
                    <button class="btn btn-secondary" onclick="App.navigate('home')">← 返回</button>
                </div>
                <div class="error-message">❌ ${this.esc(msg)}</div>
            </div>
        `;
    },

    toggleFontSize(delta) {
        const el = document.querySelector('.reader-container');
        if (!el) return;
        let size = parseInt(getComputedStyle(el).getPropertyValue('--reader-font-size')) || 18;
        size = Math.max(14, Math.min(28, size + delta * 2));
        el.style.setProperty('--reader-font-size', size + 'px');
        localStorage.setItem('reader_fontSize', size);
    },

    esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
};
