// Reader panel rendering and content loading.
// Depends on globals from main.js plus reader-modes.js.

function renderReaderDetail() {
  setReaderReadingChrome(false);
  setReaderMediaChrome(false);
  const book = state.currentBook;
  if (!book || !book.info) {
    renderReaderEmpty();
    return;
  }
  const info = book.info;
  const meta = categoryMeta[info.category] || categoryMeta.other;
  updateReaderTabs(meta);
  setActiveTab('detail', false);
  if (isServiceCategory(info.category)) {
    renderServiceDetail();
    return;
  }
  els.readerBody.innerHTML = `
    <div class="book-detail">
      ${renderCover(info.coverUrl, info.name, 'detail-cover')}
      <div>
        <div class="detail-title">${esc(info.name)}</div>
        <p class="meta-line">${esc(info.author || info.kind || '')}</p>
        <p class="meta-line">${esc([info.kind, info.wordCount].filter(Boolean).join(' · ') || book.item.sourceName || '')}</p>
        <p class="meta-line">${esc(info.lastChapter ? '最新：' + info.lastChapter : '')}</p>
        <div class="action-row">
          <button class="btn primary" data-action="load-toc" type="button">查看${esc(meta.list)}</button>
          ${info.category === 'video' ? '' : `<button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenButtonLabel()}</button>`}
          <button class="btn" data-action="open-site" type="button">源网页</button>
          <button class="btn" data-action="favorite-book" type="button">${isBookFavorited(book.item) ? '取消收藏' : '收藏作品'}</button>
        </div>
      </div>
    </div>
    <div class="intro-box">${esc(info.intro || '暂无简介')}</div>
    ${renderDownloadLinks(info.downloadUrls || [])}
  `;
}

function isServiceCategory(category) {
  return category === 'game' || category === 'special';
}

function supportsReaderModes(book = state.currentBook) {
  const category = book?.info?.category;
  return category === 'novel' || category === 'comic';
}

function isMediaCategory(category = state.currentBook?.info?.category) {
  return category === 'audio' || category === 'music' || category === 'video';
}

function serviceUrl(book = state.currentBook) {
  return book?.info?.tocUrl || book?.item?.itemUrl || '';
}

function renderServiceDetail() {
  const book = state.currentBook;
  if (!book || !book.info) {
    renderReaderEmpty();
    return;
  }
  const info = book.info;
  const isGame = info.category === 'game';
  const url = serviceUrl(book);
  const title = info.name || book.item?.name || (isGame ? '游戏' : '工具');
  const intro = info.intro || book.item?.intro || (isGame
    ? '可在右侧面板中试玩，也可以在浏览器中单独打开。'
    : '可在右侧面板中预览，也可以在浏览器中单独打开。');
  els.readerBody.innerHTML = `
    <div class="service-detail">
      ${renderCover(info.coverUrl || book.item?.coverUrl, title, 'detail-cover')}
      <div class="service-main">
        <div class="detail-title">${esc(title)}</div>
        <p class="meta-line">${esc([info.author || book.item?.author, info.kind || book.item?.kind, book.item?.sourceName].filter(Boolean).join(' · '))}</p>
        <div class="service-actions">
          ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${isGame ? '开始游戏' : '打开工具'}</a>` : ''}
          <button class="btn" data-action="preview-service" type="button">${isGame ? '面板试玩' : '面板预览'}</button>
          ${url ? `<button class="btn" data-action="copy-resource" data-url="${esc(url)}" type="button">复制地址</button>` : ''}
          <button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenButtonLabel()}</button>
        </div>
      </div>
    </div>
    <div class="intro-box">${esc(intro || '暂无说明')}</div>
    ${url ? `<div class="service-url-box"><span>${esc(isGame ? '游戏入口' : '资源入口')}</span><code>${esc(url)}</code></div>` : '<div class="empty">没有可打开的入口地址</div>'}
  `;
}

async function previewService() {
  const book = state.currentBook;
  if (!book?.info) {
    toast('请先打开一个游戏或工具');
    return;
  }
  const url = serviceUrl(book);
  if (!url) {
    toast('没有可预览的入口地址');
    return;
  }
  setActiveTab('chapter', false);
  setReaderHeader(book.info.name || book.item.name, book.info.category === 'game' ? '游戏入口' : '工具入口');
  renderReaderLoading(book.info.category === 'game' ? '正在准备游戏入口...' : '正在准备工具入口...');
  try {
    const data = await apiPost('/api/content/payload', {
      sourceId: book.item.sourceId,
      entryUrl: url,
      index: 0,
      title: book.info.name || book.item.name || '',
      session: book.session || ''
    });
    bookSessionSet(data.session);
    book.chapter = { ...data, name: book.info.name || book.item.name, index: 0 };
    state.currentChapterIndex = 0;
    renderChapter();
  } catch (error) {
    els.readerBody.innerHTML = `<div class="error">入口加载失败：${esc(error.message)}</div>`;
  }
}

async function loadToc(force = false) {
  const book = state.currentBook;
  if (!book || !book.info) {
    toast('请先打开详情');
    return;
  }
  setActiveTab('toc', false);
  if (book.tocLoaded && !force) {
    renderToc();
    return;
  }
  book.toc = [];
  book.tocLoaded = false;
  state.chapters = {};
  const meta = categoryMeta[book.info.category] || categoryMeta.other;
  renderReaderLoading('正在获取' + meta.list + '...');
  try {
    const maxPages = { novel: 6, comic: 4, audio: 6, video: 4 }[book.info.category] || 4;
    const startUrl = book.info.tocUrl || book.item.itemUrl;
    const data = await apiPost('/api/content/entries', {
      sourceId: book.item.sourceId,
      tocUrl: startUrl,
      maxPages,
      budgetMs: 30000,
      session: book.session || ''
    });
    bookSessionSet(data.session);
    const incoming = (data.entries || []).map((ch, index) => ({ ...ch, index: book.toc.length + index }));
    book.toc = incoming;
    normalizeComicTocOrder(book);
    book.nextTocUrl = data.nextTocUrl || '';
    book.tocPartial = !!data.partial || !!data.nextTocUrl;
    book.failedPages = data.failedPages || [];
    book.tocLoaded = true;
    renderToc();
  } catch (error) {
    els.readerBody.innerHTML = `<div class="error">目录加载失败：${esc(error.message)}</div>`;
  }
}

async function loadMoreToc() {
  const book = state.currentBook;
  if (!book?.nextTocUrl) {
    toast('没有后续目录页');
    return;
  }
  setActiveTab('toc', false);
  const meta = categoryMeta[book.info.category] || categoryMeta.other;
  renderReaderLoading('正在继续获取' + meta.list + '...');
  try {
    const maxPages = { novel: 12, comic: 10, audio: 12, video: 8 }[book.info.category] || 8;
    const data = await apiPost('/api/content/entries', {
      sourceId: book.item.sourceId,
      tocUrl: book.nextTocUrl,
      maxPages,
      budgetMs: 30000,
      session: book.session || ''
    });
    bookSessionSet(data.session);
    const seen = new Set(book.toc.map(item => item.url || item.name));
    (data.entries || []).forEach(ch => {
      const key = ch.url || ch.name;
      if (!seen.has(key)) {
        book.toc.push({ ...ch, index: book.toc.length });
        seen.add(key);
      }
    });
    normalizeComicTocOrder(book);
    book.nextTocUrl = data.nextTocUrl || '';
    book.tocPartial = !!data.partial || !!data.nextTocUrl;
    book.failedPages = [...(book.failedPages || []), ...(data.failedPages || [])];
    book.tocLoaded = true;
    renderToc();
  } catch (error) {
    els.readerBody.innerHTML = `<div class="error">继续加载目录失败：${esc(error.message)}</div>`;
  }
}

function renderToc() {
  const book = state.currentBook;
  if (!book) return;
  setReaderReadingChrome(false);
  setReaderMediaChrome(false);
  const meta = categoryMeta[book.info?.category] || categoryMeta.other;
  const query = state.tocQuery.trim().toLowerCase();
  const chapters = query ? book.toc.filter(ch => String(ch.name || '').toLowerCase().includes(query)) : book.toc;
  const partialTip = book.tocPartial
    ? `<div class="error">部分目录页加载超时，已显示 ${book.toc.length} 条可用内容。${book.failedPages?.length ? '失败页：' + esc(book.failedPages.map(item => item.url).join('、')) : ''}</div>`
    : '';
  state.chapters = {};
  els.readerBody.innerHTML = `
    <div class="toc-tools">
      <div class="field"><input id="tocSearch" value="${esc(state.tocQuery)}" placeholder="筛选${esc(meta.list)}"></div>
      <button class="btn" data-action="reload-toc" type="button">刷新</button>
      ${book.nextTocUrl ? '<button class="btn primary" data-action="load-more-toc" type="button">加载更多</button>' : ''}
    </div>
    <div class="chapter-meta">共 ${book.toc.length} 项${book.nextTocUrl ? '，仍存在后续列表页' : ''}</div>
    ${partialTip}
    <div class="toc-list">
      ${chapters.length ? chapters.map(ch => {
        const key = 'chapter_' + ch.index;
        state.chapters[key] = ch;
        return `
          <button class="chapter-item ${state.currentChapterIndex === ch.index ? 'active' : ''}" data-chapter-key="${key}" type="button">
            <span class="chapter-index">${ch.index + 1}</span>
            <span class="chapter-name">${esc(ch.name || '未命名')}</span>
            ${ch.line ? `<span class="chapter-vip">${esc(ch.line)}</span>` : ''}
            ${ch.isVip ? '<span class="chapter-vip">VIP</span>' : ''}
          </button>
        `;
      }).join('') : '<div class="empty">没有匹配条目</div>'}
    </div>
  `;
  const input = $('#tocSearch');
  if (input) input.addEventListener('input', event => {
    state.tocQuery = event.target.value;
    renderToc();
    const nextInput = $('#tocSearch');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
    }
  });
}

function normalizeComicTocOrder(book) {
  if (book?.info?.category !== 'comic' || !Array.isArray(book.toc) || book.toc.length < 2) return;
  const currentKey = book.toc[state.currentChapterIndex]?.url || book.toc[state.currentChapterIndex]?.name || '';
  const numbered = book.toc
    .map((item, position) => ({ item, position, order: comicChapterOrder(item) }))
    .filter(row => Number.isFinite(row.order));
  if (numbered.length < 2) {
    reindexToc(book, currentKey);
    return;
  }
  let asc = 0;
  let desc = 0;
  for (let index = 1; index < numbered.length; index += 1) {
    if (numbered[index].order > numbered[index - 1].order) asc += 1;
    if (numbered[index].order < numbered[index - 1].order) desc += 1;
  }
  if (desc > asc && numbered[0].order > numbered[numbered.length - 1].order) {
    book.toc.reverse();
  }
  reindexToc(book, currentKey);
}

function comicChapterOrder(chapter) {
  const text = String([chapter?.name, chapter?.title, chapter?.line].filter(Boolean).join(' '));
  const patterns = [
    /第\s*0*(\d+(?:\.\d+)?)\s*(?:话|話|回|章|卷|集|节|節|篇)/i,
    /(?:^|[^\d])0*(\d+(?:\.\d+)?)\s*(?:话|話|回|章|卷|集|节|節|篇)/i,
    /(?:chapter|chap|ch|vol|volume)\s*0*(\d+(?:\.\d+)?)/i,
    /(?:^|[^\d])0*(\d{1,5})(?:[^\d]|$)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return Number.NaN;
}

function reindexToc(book, currentKey = '') {
  if (!Array.isArray(book?.toc)) return;
  book.toc = book.toc.map((chapter, index) => ({ ...chapter, index }));
  if (!currentKey) return;
  const nextIndex = book.toc.findIndex(chapter => (chapter.url || chapter.name || '') === currentKey);
  if (nextIndex >= 0) state.currentChapterIndex = nextIndex;
}

async function loadChapter(chapterIndex) {
  const book = state.currentBook;
  if (!book || !book.toc[chapterIndex]) {
    toast('条目信息不存在');
    return;
  }
  const chapter = book.toc[chapterIndex];
  if (chapter.selectable === false || !chapter.url) {
    toast('这是分组标题，请选择具体条目');
    return;
  }
  state.currentChapterIndex = chapterIndex;
  setActiveTab('chapter', false);
  setReaderHeader(book.info?.name || book.item.name, chapter.name || '内容');
  renderReaderLoading('正在加载内容...');
  try {
    const data = await apiPost('/api/content/payload', {
      sourceId: book.item.sourceId,
      entryUrl: chapter.url,
      index: chapterIndex,
      title: chapter.name || '',
      session: book.session || ''
    });
    bookSessionSet(data.session);
    book.chapter = { ...data, name: chapter.name, index: chapterIndex };
    state.readerPageIndex = 0;
    recordHistory(book.item, chapter);
    renderChapter();
  } catch (error) {
    els.readerBody.innerHTML = `<div class="error">内容加载失败：${esc(error.message)}</div>`;
  }
}

function renderChapter() {
  const book = state.currentBook;
  const chapter = book?.chapter;
  if (!chapter) {
    setReaderReadingChrome(false);
    setReaderMediaChrome(false);
    els.readerBody.innerHTML = '<div class="empty">还没有加载内容</div>';
    return;
  }
  const hasReaderModes = supportsReaderModes(book);
  setReaderReadingChrome(hasReaderModes);
  setReaderMediaChrome(!hasReaderModes && isMediaCategory(book.info?.category));
  const paragraphs = String(chapter.content || '').split(/\n+/).map(p => p.trim()).filter(Boolean);
  const prevDisabled = state.currentChapterIndex <= 0 ? 'disabled' : '';
  const nextDisabled = state.currentChapterIndex >= book.toc.length - 1 ? 'disabled' : '';
  const fullscreenLabel = fullscreenButtonLabel();
  document.documentElement.style.setProperty('--reader-font', state.readerFont + 'px');
  const rendered = renderReaderContent(chapter, paragraphs, hasReaderModes);
  const contentLength = String(chapter.text || chapter.content || '').replace(/\s+/g, '').length || chapter.length || 0;
  const pageCount = rendered.pageCount || chapter.pageCount || 1;
  els.readerBody.innerHTML = `
    ${hasReaderModes ? renderReaderModeChrome(rendered.pageCount, fullscreenLabel) : renderBasicChapterChrome(book, fullscreenLabel)}
    <div class="chapter-meta">
      ${esc(chapter.name || '')} · ${contentLength} 字 · ${pageCount} 页${chapter.truncatedByPageLimit ? ' · 已触及分页上限' : ''}
    </div>
    ${rendered.html}
    ${renderChapterBottomNav(book, prevDisabled, nextDisabled)}
  `;
  if (typeof mountHlsPlayers === 'function') mountHlsPlayers(els.readerBody);
}

function setReaderReadingChrome(isReading) {
  document.body.classList.toggle('reader-reading', !!isReading);
  document.body.classList.toggle('reader-paged', !!isReading && state.readerMode === 'paged');
  if (!isReading) document.body.classList.remove('reader-paged', 'reader-toc-open', 'reader-tools-open');
}

function setReaderMediaChrome(isMedia) {
  document.body.classList.toggle('reader-media', !!isMedia);
  document.body.classList.toggle('reader-video', !!isMedia && state.currentBook?.info?.category === 'video');
  if (!isMedia) document.body.classList.remove('reader-video');
}

function renderReaderModeChrome(pageCount, fullscreenLabel) {
  return `
    <div class="reader-toc-drawer" id="readerTocDrawer" aria-hidden="true">
      ${renderTocDrawerContent()}
    </div>
    <button class="reader-close-fab" data-action="close-reader" type="button" title="返回搜索">×</button>
    <button class="reader-settings-fab" data-action="toggle-reader-tools" type="button" title="阅读设置">&#9881;</button>
    <div class="chapter-bar reader-tool-panel">
      <div class="seg reader-mode-switch" role="group" aria-label="阅读模式">
        <button class="${state.readerMode === 'scroll' ? 'active' : ''}" data-action="set-reader-scroll" type="button">滑动式</button>
        <button class="${state.readerMode === 'paged' ? 'active' : ''}" data-action="set-reader-paged" type="button">翻页式</button>
      </div>
      ${renderPageControls(pageCount)}
      <span class="spacer"></span>
      <button class="btn" data-action="toggle-reader-toc" type="button">目录</button>
      <button class="btn icon" data-action="font-down" title="减小字号" type="button">A-</button>
      <button class="btn icon" data-action="font-up" title="增大字号" type="button">A+</button>
      <button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenLabel}</button>
    </div>
  `;
}

function renderBasicChapterChrome(book, fullscreenLabel) {
  if (book?.info?.category === 'video') return '';
  return `
    <div class="chapter-bar">
      <span class="spacer"></span>
      <button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenLabel}</button>
    </div>
  `;
}

function renderChapterBottomNav(book, prevDisabled, nextDisabled) {
  const category = book?.info?.category;
  if (category === 'video') {
    return `
      <div class="chapter-bottom-nav media-nav">
        <button class="btn" data-action="prev-chapter" ${prevDisabled} type="button">上一集</button>
        <button class="btn primary" data-action="next-chapter" ${nextDisabled} type="button">下一集</button>
      </div>
    `;
  }
  if (category === 'audio') {
    return `
      <div class="chapter-bottom-nav media-nav">
        <button class="btn" data-action="prev-chapter" ${prevDisabled} type="button">上一段</button>
        <button class="btn primary" data-action="next-chapter" ${nextDisabled} type="button">下一段</button>
      </div>
    `;
  }
  if (category === 'music') {
    return `
      <div class="chapter-bottom-nav media-nav">
        <button class="btn" data-action="prev-chapter" ${prevDisabled} type="button">上一首</button>
        <button class="btn primary" data-action="next-chapter" ${nextDisabled} type="button">下一首</button>
      </div>
    `;
  }
  if (!supportsReaderModes(book)) return '';
  return `
    <div class="chapter-bottom-nav">
      <button class="btn" data-action="prev-chapter" ${prevDisabled} type="button">上一章</button>
      <button class="btn primary" data-action="next-chapter" ${nextDisabled} type="button">下一章</button>
    </div>
  `;
}

function renderTocDrawerContent() {
  const book = state.currentBook;
  if (!book?.toc?.length) {
    return '<div class="reader-toc-empty">目录还没有加载</div>';
  }
  const chapters = book.toc.slice(0, 600);
  state.chapters = state.chapters || {};
  return `
    <div class="reader-toc-head">
      <strong>目录</strong>
      <button class="btn icon" data-action="toggle-reader-toc" type="button" title="关闭目录">×</button>
    </div>
    <div class="reader-toc-list">
      ${chapters.map(ch => {
        const key = 'chapter_' + ch.index;
        state.chapters[key] = ch;
        return `
          <button class="chapter-item ${state.currentChapterIndex === ch.index ? 'active' : ''}" data-chapter-key="${key}" type="button">
            <span class="chapter-index">${ch.index + 1}</span>
            <span class="chapter-name">${esc(ch.name || '未命名')}</span>
            ${ch.isVip ? '<span class="chapter-vip">VIP</span>' : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function bookSessionSet(session) {
  if (session && state.currentBook) state.currentBook.session = session;
}

function fullscreenButtonLabel() {
  return document.body.classList.contains('reader-fullscreen') ? '退出全屏' : '全屏';
}

function updateReaderTabs(meta) {
  const tabs = els.readerTabs.querySelectorAll('button');
  tabs.forEach(btn => {
    if (btn.dataset.tab === 'detail') btn.textContent = meta.detail || '详情';
    if (btn.dataset.tab === 'toc') btn.textContent = meta.list || '列表';
    if (btn.dataset.tab === 'chapter') btn.textContent = meta.content || '内容';
  });
}

function renderReaderEmpty() {
  setReaderReadingChrome(false);
  setReaderMediaChrome(false);
  setReaderHeader('选择内容开始', '按分类打开详情、列表、阅读、播放或下载。');
  els.readerBody.innerHTML = '<div class="hint">右侧会根据小说、漫画、音乐、听书、影视、游戏或工具显示不同操作。</div>';
}

function renderReaderLoading(text) {
  els.readerBody.innerHTML = `<div class="loading">${esc(text)}</div>`;
}

function renderReaderError(message, item) {
  els.readerBody.innerHTML = `
    <div class="error">${esc(message)}</div>
    <div class="action-row">
      <button class="btn" data-action="open-site" type="button">打开源网页</button>
    </div>
  `;
  state.currentBook = state.currentBook || { item };
}

function setReaderHeader(title, subtitle) {
  els.readerTitle.textContent = title || '阅读';
  els.readerSubTitle.textContent = subtitle || '';
}

function setActiveTab(tab, runAction = true) {
  state.activeTab = tab;
  els.readerTabs.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  if (!runAction) return;
  if (isServiceCategory(state.currentBook?.info?.category)) {
    if (tab === 'detail') renderServiceDetail();
    if (tab === 'toc' || tab === 'chapter') previewService();
    return;
  }
  if (tab === 'detail') renderReaderDetail();
  if (tab === 'toc') loadToc();
  if (tab === 'chapter') {
    const book = state.currentBook;
    if (book?.chapter) renderChapter();
    else if (book?.tocLoaded && book.toc.length) loadChapter(Math.max(0, state.currentChapterIndex));
    else if (book) loadToc().then(() => {
      if (book.toc.length) loadChapter(0);
    });
    else renderChapter();
  }
}
