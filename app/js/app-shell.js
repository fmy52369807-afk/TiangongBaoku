// Main workbench shell rendering and mode switching.
// Depends on state, els, category/status metadata, and filtering helpers.

function normalizeCategories(categories, total) {
  const fromApi = new Map(categories.map(item => [item.key, item.count]));
  const keys = ['all', 'novel', 'comic', 'audio', 'music', 'video', 'game', 'special', 'other'];
  return keys
    .map(key => ({ key, count: key === 'all' ? (fromApi.get('all') || total) : (fromApi.get(key) || 0), ...(categoryMeta[key] || categoryMeta.other) }))
    .filter(item => item.key === 'all' || item.count > 0);
}

function renderAll() {
  applyAppModeChrome();
  renderModeTabs();
  renderCategories();
  renderStatusFilters();
  renderSources();
  renderSummary();
  renderInitialResults();
  renderFilterText();
}

function applyAppModeChrome() {
  document.body.classList.remove('home-landing', 'recommend-landing');
  document.body.classList.add('workbench-mode');
}

function renderModeTabs() {
  $('#modeTabs').querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === state.mode);
  });
}

function renderCategories() {
  els.categoryList.innerHTML = state.categories.map(cat => `
    <button class="nav-btn ${state.category === cat.key ? 'active' : ''}" data-category="${esc(cat.key)}" type="button">
      <span class="nav-main"><span class="nav-dot"></span><span class="nav-label">${esc(cat.label)}</span></span>
      <span class="count">${cat.count}</span>
    </button>
  `).join('');
}

function renderStatusFilters() {
  const counts = countByStatus(filteredByCategory());
  els.statusList.innerHTML = Object.entries(statusMeta).map(([key, meta]) => `
    <button class="nav-btn ${state.status === key ? 'active' : ''}" data-status="${esc(key)}" type="button">
      <span class="nav-main"><span class="nav-dot ${meta.dot}"></span><span class="nav-label">${esc(meta.label)}</span></span>
      <span class="count">${key === 'all' ? filteredByCategory().length : (counts[key] || 0)}</span>
    </button>
  `).join('');
}

function renderSources() {
  const sources = filteredSources();
  if (!sources.some(item => item.id === state.selectedSourceId)) state.selectedSourceId = '';
  if (els.sourceManageHint) {
    els.sourceManageHint.textContent = `${sources.length} \u4e2a\u5339\u914d\u6e90\uff0c\u5df2\u7981\u7528 ${state.disabledSources.length} \u4e2a`;
  }
}

function renderSummary() {
  const visible = filteredSources();
  const ok = state.sources.filter(item => normalizeStatus(item.status).key === 'ok').length;
  const partial = state.sources.filter(item => normalizeStatus(item.status).key === 'partial').length;
  const disabled = state.disabledSources.length;
  els.summary.innerHTML = `
    <div class="stat"><b>${state.sources.length}</b><span>\u603b\u6e90\u6570\u91cf</span></div>
    <div class="stat"><b>${visible.length}</b><span>\u5f53\u524d\u7b5b\u9009</span></div>
    <div class="stat"><b>${ok}</b><span>\u6b63\u5e38\u6e90</span></div>
    <div class="stat"><b>${partial}</b><span>\u90e8\u5206\u53ef\u7528 / \u7981\u7528 ${disabled}</span></div>
  `;
}

function renderInitialResults() {
  if (state.mode === 'sources') {
    renderSourceSearchResults();
    return;
  }
  if (state.mode === 'history') {
    renderHistoryResults();
    return;
  }
  if (state.mode === 'favorites') {
    renderFavoriteResults();
    return;
  }
  const meta = categoryMeta[state.category] || categoryMeta.other;
  els.bookKeyword.placeholder = state.mode === 'books' ? meta.placeholder : '\u8f93\u5165\u6e90\u540d\u79f0\u3001\u5730\u5740\u6216\u5907\u6ce8';
  els.results.innerHTML = `
    <section class="launch-panel">
      <div class="launch-head">
        <p class="launch-kicker">${esc(meta.label)} / ${esc(meta.detail)} / ${esc(meta.list)} / ${esc(meta.content)}</p>
        <h2>\u4ece\u4e00\u4e2a\u5173\u952e\u8bcd\u5f00\u59cb\u6574\u7406\u4f60\u7684\u5185\u5bb9\u6e90</h2>
        <p>\u8f93\u5165\u4e66\u540d\u3001\u4f5c\u8005\u3001\u4e13\u8f91\u3001\u5f71\u89c6\u6216\u5de5\u5177\u540d\u79f0\uff0c\u7cfb\u7edf\u4f1a\u6309\u5f53\u524d\u5206\u7c7b\u805a\u5408\u53ef\u6253\u5f00\u7684\u7ed3\u679c\u3002\u4e5f\u53ef\u4ee5\u5148\u4ece\u5de6\u4fa7\u7f29\u5c0f\u5206\u7c7b\u3001\u72b6\u6001\u6216\u6307\u5b9a\u5355\u4e2a\u6e90\u3002</p>
      </div>
      <div class="launch-actions">
        <button class="launch-card" data-mode-shortcut="books" type="button">
          <strong>\u5168\u5e93\u641c\u7d22</strong>
          <span>\u8de8\u6e90\u67e5\u627e\u5f53\u524d\u5206\u7c7b\u5185\u5bb9\uff0c\u9002\u5408\u53d1\u73b0\u53ef\u7528\u5165\u53e3\u3002</span>
        </button>
        <button class="launch-card" data-mode-shortcut="history" type="button">
          <strong>\u7ee7\u7eed\u9605\u8bfb</strong>
          <span>\u56de\u5230\u6700\u8fd1\u6253\u5f00\u8fc7\u7684\u4f5c\u54c1\u548c\u7ae0\u8282\u3002</span>
        </button>
        <button class="launch-card" data-mode-shortcut="favorites" type="button">
          <strong>\u6211\u7684\u6536\u85cf</strong>
          <span>\u5feb\u901f\u67e5\u770b\u6536\u85cf\u4f5c\u54c1\u548c\u5e38\u7528\u6765\u6e90\u3002</span>
        </button>
      </div>
    </section>
  `;
}

function renderFilterText() {
  const category = categoryMeta[state.category]?.label || state.category;
  const status = statusMeta[state.status]?.label || state.status;
  const source = state.selectedSourceId ? state.sources.find(item => item.id === state.selectedSourceId)?.name : '';
  els.activeFilterText.textContent = `${category} / ${status}${source ? ' / ' + source : ''}`;
}

function setMode(mode) {
  state.mode = mode;
  applyAppModeChrome();
  renderModeTabs();
  els.bookKeyword.placeholder = state.mode === 'books'
    ? (categoryMeta[state.category]?.placeholder || '\u8f93\u5165\u5173\u952e\u8bcd')
    : (state.mode === 'sources' ? '\u8f93\u5165\u6e90\u540d\u79f0\u3001\u5730\u5740\u6216\u5907\u6ce8' : '\u7b5b\u9009\u540d\u79f0\u3001\u4f5c\u8005\u6216\u6765\u6e90');
  renderSummary();
  renderInitialResults();
  renderFilterText();
}
