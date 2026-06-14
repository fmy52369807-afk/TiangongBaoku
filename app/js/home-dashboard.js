// Home and recommendation dashboards.

const homeCategories = ['novel', 'comic', 'music', 'video'];

function categoryLabel(category) {
  return categoryMeta[category]?.label || category || '\u5185\u5bb9';
}

function libraryItemFromRow(row) {
  return row?.item || row || {};
}

function libraryRowsByCategory(category, limit = 6) {
  return (state.history || [])
    .concat(state.bookFav || [])
    .filter(row => category === 'all' || libraryItemFromRow(row).category === category)
    .slice(0, limit);
}

function stableHomeKey(prefix, item, index) {
  return `${prefix}_${index}_${Math.abs(String(item?.sourceId || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0))}`;
}

function onlineHotEntries(category, limit = 12) {
  return (state.hotRecommendations?.categories?.[category] || [])
    .filter(item => item && item.sourceId && !isSourceDisabled(item.sourceId))
    .slice(0, limit);
}

function recommendSummaryCount(category) {
  return onlineHotEntries(category, 99).length;
}

function hotRecommendationsReady() {
  return Boolean(state.hotRecommendations?.generatedAt);
}

function hotReasonLabel(entry) {
  const reason = String(entry?.reason || '').replace(/[\u21e6\u21e8\u2190\u2192\u21a9\u21aa]/g, '').trim();
  if (!reason || /^\u63a8\u8350$|^\u4eba\u6c14$|^\u539f\u521b$|^\u6700\u65b0$|^\u70ed\u8840$|^\u90fd\u5e02|\u90fd\u5e02\u751f\u6d3b|\u5206\u7c7b|\u5168\u90e8|\u9ed8\u8ba4/.test(reason)) return '\u6e90\u7ad9\u6392\u884c';
  return reason;
}

function renderHomeSummary() {
  const videos = libraryRowsByCategory('video', 99).length;
  els.summary.innerHTML = `
    <button class="stat home-stat" data-home-action="open-mode" data-mode-target="favorites" type="button"><b>${state.bookFav.length}</b><span>\u4e66\u67b6\u6536\u85cf</span></button>
    <button class="stat home-stat" data-home-action="open-playlist" type="button"><b>${(state.audioPlaylist || []).length}</b><span>\u6b4c\u5355\u66f2\u76ee</span></button>
    <button class="stat home-stat" data-home-action="open-mode" data-mode-target="history" data-category-target="video" type="button"><b>${videos}</b><span>\u653e\u6620\u8bb0\u5f55</span></button>
    <button class="stat home-stat" data-home-action="open-mode" data-mode-target="history" type="button"><b>${state.history.length}</b><span>\u6700\u8fd1\u5386\u53f2</span></button>
  `;
}
function renderRecommendSummary() {
  els.summary.innerHTML = homeCategories.map(category => {
    const count = recommendSummaryCount(category);
    return `<button class="stat home-stat" data-home-action="recommend-category" data-category-target="${esc(category)}" type="button"><b>${count}</b><span>${esc(categoryLabel(category))}\u7ebf\u4e0a\u699c</span></button>`;
  }).join('');
}

function renderMiniLibrary(rows, emptyText) {
  if (!rows.length) return `<div class="home-empty">${esc(emptyText)}</div>`;
  return rows.slice(0, 4).map((row, index) => {
    const item = libraryItemFromRow(row);
    const key = row.key || stableHomeKey('home', item, index);
    state.searchItems[key] = item;
    return `
      <button class="home-list-item" data-book-key="${esc(key)}" type="button">
        ${renderCover(item.coverUrl, item.name, 'home-thumb')}
        <span>
          <strong>${esc(item.name || '\u672a\u547d\u540d')}</strong>
          <em>${esc([item.author || item.kind, item.sourceName, row.chapterName].filter(Boolean).join(' / ') || categoryLabel(item.category))}</em>
        </span>
      </button>
    `;
  }).join('');
}

function renderPlaylistPreview() {
  const playlist = state.audioPlaylist || [];
  if (!playlist.length) return `<div class="home-empty">\u8fd8\u6ca1\u6709\u6b4c\u5355\u3002\u6253\u5f00\u97f3\u4e50\u6216\u542c\u4e66\u540e\uff0c\u628a\u559c\u6b22\u7684\u97f3\u9891\u52a0\u5165\u6b4c\u5355\u3002</div>`;
  return playlist.slice(0, 5).map((item, index) => `
    <button class="home-list-item" data-home-action="play-audio-index" data-index="${index}" type="button">
      <span class="home-audio-dot"></span>
      <span>
        <strong>${esc(item.title || '\u97f3\u9891\u8282\u76ee')}</strong>
        <em>${esc(item.album || (item.kind === 'music' ? '\u97f3\u4e50' : '\u542c\u4e66'))}</em>
      </span>
    </button>
  `).join('');
}
function renderHomePortalCard(title, text, action, meta = '') {
  return `
    <button class="home-portal-card" data-home-action="${esc(action.type)}" ${action.mode ? `data-mode-target="${esc(action.mode)}"` : ''} ${action.category ? `data-category-target="${esc(action.category)}"` : ''} type="button">
      <span>${esc(meta)}</span>
      <strong>${esc(title)}</strong>
      <em>${esc(text)}</em>
    </button>
  `;
}

function renderHomeCommand(title, text, action, meta = '') {
  return `
    <button class="home-command-card" data-home-action="${esc(action.type)}" ${action.mode ? `data-mode-target="${esc(action.mode)}"` : ''} ${action.category ? `data-category-target="${esc(action.category)}"` : ''} type="button">
      <span>${esc(meta)}</span>
      <strong>${esc(title)}</strong>
      <em>${esc(text)}</em>
    </button>
  `;
}

function renderHomeDashboard() {
  state.searchItems = {};
  const continueRows = state.history.slice(0, 4);
  const shelfRows = (state.bookFav || []).filter(row => ['novel', 'comic', 'audio'].includes(libraryItemFromRow(row).category)).slice(0, 4);
  const videoRows = libraryRowsByCategory('video', 4);
  const hotCount = hotRecommendationsReady() ? homeCategories.reduce((sum, category) => sum + recommendSummaryCount(category), 0) : '...';
  els.results.innerHTML = `
    <section class="home-command app-home-hero">
      <div class="home-command-copy">
        <p class="home-kicker">\u5929\u5de5\u5b9d\u5e93</p>
        <h2>\u5148\u56de\u5230\u4f60\u7684\u5185\u5bb9</h2>
        <p>\u4e66\u67b6\u3001\u6b4c\u5355\u548c\u653e\u6620\u5ba4\u4f5c\u4e3a\u9996\u5c4f\uff0c\u627e\u65b0\u4f5c\u54c1\u65f6\u518d\u8fdb\u805a\u5408\u641c\u7d22\u3002</p>
      </div>
      <div class="home-command-actions">
        <button class="btn primary" data-home-action="open-mode" data-mode-target="books" type="button">\u805a\u5408\u641c\u7d22</button>
        <button class="btn" data-home-action="open-mode" data-mode-target="recommend" type="button">\u6e90\u7ad9\u699c\u5355</button>
      </div>
    </section>
    <section class="home-command-grid" aria-label="\u9996\u9875\u5165\u53e3">
      ${renderHomeCommand('\u4e66\u67b6', '\u7ee7\u7eed\u9605\u8bfb\u548c\u6536\u85cf', { type: 'open-mode', mode: 'favorites' }, `${state.bookFav.length}`)}
      ${renderHomeCommand('\u6b4c\u5355', '\u6309\u6b4c\u5355\u987a\u5e8f\u64ad\u653e', { type: 'open-playlist' }, `${(state.audioPlaylist || []).length}`)}
      ${renderHomeCommand('\u653e\u6620\u5ba4', '\u6700\u8fd1\u770b\u8fc7\u7684\u5f71\u89c6', { type: 'open-mode', mode: 'history', category: 'video' }, `${videoRows.length}`)}
      ${renderHomeCommand('\u5386\u53f2', '\u6240\u6709\u9605\u8bfb\u4e0e\u64ad\u653e\u8bb0\u5f55', { type: 'open-mode', mode: 'history' }, `${state.history.length}`)}
      ${renderHomeCommand('\u63a8\u8350', '\u53ea\u770b\u53ef\u8ffd\u6eaf\u7684\u6e90\u7ad9\u699c', { type: 'open-mode', mode: 'recommend' }, `${hotCount}`)}
    </section>
    <section class="home-grid">
      <article class="home-panel home-panel-wide">
        <div class="home-panel-head">
          <div><span>\u4e66\u67b6</span><strong>\u7ee7\u7eed\u9605\u8bfb</strong></div>
          <button class="btn ghost" data-home-action="open-mode" data-mode-target="history" type="button">\u5168\u90e8\u5386\u53f2</button>
        </div>
        <div class="home-list">${renderMiniLibrary(continueRows, '\u8fd8\u6ca1\u6709\u9605\u8bfb\u8bb0\u5f55\u3002\u5148\u8fdb\u5165\u805a\u5408\u641c\u7d22\u5e76\u6253\u5f00\u4e00\u4e2a\u4f5c\u54c1\u3002')}</div>
      </article>
      <article class="home-panel">
        <div class="home-panel-head">
          <div><span>\u6b4c\u5355</span><strong>\u987a\u5e8f\u64ad\u653e</strong></div>
          <button class="btn ghost" data-home-action="open-playlist" type="button">\u6253\u5f00</button>
        </div>
        <div class="home-list">${renderPlaylistPreview()}</div>
      </article>
      <article class="home-panel">
        <div class="home-panel-head">
          <div><span>\u653e\u6620\u5ba4</span><strong>\u6700\u8fd1\u5f71\u89c6</strong></div>
          <button class="btn ghost" data-home-action="open-mode" data-mode-target="history" data-category-target="video" type="button">\u8fdb\u5165</button>
        </div>
        <div class="home-list">${renderMiniLibrary(videoRows, '\u8fd8\u6ca1\u6709\u5f71\u89c6\u8bb0\u5f55\u3002')}</div>
      </article>
      <article class="home-panel">
        <div class="home-panel-head">
          <div><span>\u79c1\u85cf</span><strong>\u4e66\u67b6\u6536\u85cf</strong></div>
          <button class="btn ghost" data-home-action="open-mode" data-mode-target="favorites" type="button">\u67e5\u770b</button>
        </div>
        <div class="home-list">${renderMiniLibrary(shelfRows, '\u8fd8\u6ca1\u6709\u6536\u85cf\u4f5c\u54c1\u3002')}</div>
      </article>
    </section>
  `;
}

function renderRecommendEntries(category) {
  const entries = onlineHotEntries(category, 5);
  if (!entries.length) {
    return '<div class="home-empty">\u6682\u65f6\u6ca1\u6709\u53ef\u7528\u7684\u7ebf\u4e0a\u70ed\u699c\u3002\u53ef\u4ee5\u5148\u8fdb\u5165\u805a\u5408\u641c\u7d22\uff0c\u6216\u5728\u6e90\u7ba1\u7406\u4e2d\u542f\u7528\u66f4\u591a\u6e90\u3002</div>';
  }
  return entries.map((entry, index) => {
    const isWork = entry.kind === 'work';
    const reason = hotReasonLabel(entry);
    const meta = isWork ? [entry.author, entry.sourceName, reason].filter(Boolean).join(' / ') : [entry.sourceName, reason || '\u6e90\u7ad9\u699c\u5355\u5165\u53e3'].filter(Boolean).join(' / ');
    return `
    <button class="recommend-item" data-home-action="recommend-hot-entry" data-source-id="${esc(entry.sourceId)}" data-category-target="${esc(category)}" data-hot-title="${esc(entry.title)}" data-hot-kind="${esc(entry.kind || 'entry')}" type="button">
      <span class="recommend-rank">${index + 1}</span>
      <span>
        <strong>${esc(entry.title || (isWork ? '\u70ed\u699c\u4f5c\u54c1' : '\u699c\u5355\u5165\u53e3'))}</strong>
        <em>${esc(meta)}</em>
      </span>
      <b class="recommend-kind">${isWork ? '\u4f5c\u54c1' : '\u5165\u53e3'}</b>
      <i class="status-pill ${normalizeStatus(entry.status).className}">${esc(normalizeStatus(entry.status).label)}</i>
    </button>
  `;
  }).join('');
}

function renderRecommendDashboard() {
  state.searchItems = {};
  const hotCount = homeCategories.reduce((sum, category) => sum + recommendSummaryCount(category), 0);
  const hotReady = hotRecommendationsReady();
  els.results.innerHTML = `
    <section class="home-command app-home-hero recommend-hero">
      <div class="home-command-copy">
        <p class="home-kicker">\u6e90\u7ad9\u699c\u5355</p>
        <h2>\u6e90\u7ad9\u70ed\u699c</h2>
        <p>\u4ec5\u4fdd\u7559\u80fd\u4ece\u699c\u5355\u9875\u6293\u5230\u7684\u4f5c\u54c1\uff0c\u5206\u7c7b\u3001\u5bfc\u822a\u548c\u5de5\u5177\u9875\u4e0d\u8fdb\u699c\u3002</p>
      </div>
      <div class="home-command-actions">
        <button class="btn primary" data-home-action="recommend-category" data-category-target="novel" type="button">\u770b\u5c0f\u8bf4\u699c</button>
        <button class="btn" data-home-action="open-mode" data-mode-target="books" type="button">\u8fdb\u5165\u641c\u7d22</button>
        <button class="btn" data-home-action="open-mode" data-mode-target="home" type="button">\u56de\u5230\u9996\u9875</button>
      </div>
      <span class="home-command-count">${hotReady ? hotCount : '...'}</span>
    </section>
    <section class="recommend-grid">
      ${homeCategories.map(category => `
        <article class="home-panel recommend-panel">
          <div class="home-panel-head">
            <div><span>${esc(categoryLabel(category))}</span><strong>\u7ebf\u4e0a\u70ed\u699c</strong></div>
            <button class="btn ghost" data-home-action="recommend-category" data-category-target="${esc(category)}" type="button">\u67e5\u770b</button>
          </div>
          <div class="recommend-list">
            ${renderRecommendEntries(category)}
          </div>
        </article>
      `).join('')}
    </section>
  `;
}

function openModeFromHome(element) {
  if (element.dataset.categoryTarget) state.category = element.dataset.categoryTarget;
  renderCategories();
  setMode(element.dataset.modeTarget || 'books');
}

function openOnlineHotEntry(element) {
  const category = element.dataset.categoryTarget || state.category;
  state.category = category;
  renderCategories();
  if (element.dataset.sourceId) selectSource(element.dataset.sourceId, false);
  setMode('books');
  const title = element.dataset.hotTitle || '';
  const kind = element.dataset.hotKind || 'entry';
  if (els.bookKeyword) els.bookKeyword.value = kind === 'work' ? title : '';
  els.bookKeyword.focus();
}

function handleHomeAction(action, element) {
  if (action === 'open-mode') {
    openModeFromHome(element);
    return;
  }
  if (action === 'open-playlist') {
    openAudioPlaylist();
    return;
  }
  if (action === 'play-audio-index') {
    playAudioTrack(Number(element.dataset.index || 0));
    return;
  }
  if (action === 'recommend-hot-entry') {
    openOnlineHotEntry(element);
    return;
  }
  if (action === 'recommend-category') {
    state.category = element.dataset.categoryTarget || state.category;
    renderCategories();
    setMode('books');
    els.bookKeyword.focus();
  }
}

