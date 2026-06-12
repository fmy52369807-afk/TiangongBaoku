const categoryMeta = {
  all: { label: '全部', short: '全部', placeholder: '输入关键词搜索全部内容', detail: '详情', list: '列表', content: '内容' },
  novel: { label: '小说', short: '小说', placeholder: '输入书名或作者，例如 剑来', detail: '书籍详情', list: '目录', content: '正文' },
  comic: { label: '漫画', short: '漫画', placeholder: '输入漫画名或作者', detail: '漫画详情', list: '目录', content: '阅读' },
  audio: { label: '听书', short: '听书', placeholder: '输入有声书、主播或专辑', detail: '专辑详情', list: '节目', content: '播放' },
  music: { label: '音乐', short: '音乐', placeholder: '输入歌曲、歌手或专辑', detail: '歌曲详情', list: '音质/列表', content: '播放' },
  video: { label: '影视', short: '影视', placeholder: '输入电影、剧名或演员', detail: '影视详情', list: '线路/集数', content: '播放' },
  game: { label: '游戏', short: '游戏', placeholder: '输入游戏名称', detail: '游戏详情', list: '入口', content: '打开/下载' },
  special: { label: '工具', short: '工具', placeholder: '输入工具、资源或文件名', detail: '资源详情', list: '操作/下载', content: '内容' },
  other: { label: '其他', short: '其他', placeholder: '输入关键词', detail: '详情', list: '列表', content: '内容' }
};
const statusMeta = {
  all: { label: '全部状态', dot: '' },
  ok: { label: '正常', dot: 'ok' },
  partial: { label: '部分可用', dot: 'partial' },
  vpn_needed: { label: '需要特殊网络', dot: 'failed' },
  disabled: { label: '已禁用', dot: 'failed' },
  failed: { label: '不可用', dot: 'failed' }
};
const state = {
  categories: [],
  sources: [],
  selectedSourceId: '',
  category: 'novel',
  status: 'all',
  sourceQuery: '',
  sourceSort: 'status',
  mode: 'books',
  searchState: null,
  searchGroups: [],
  searchItems: {},
  chapters: {},
  currentBook: null,
  activeTab: 'detail',
  tocQuery: '',
  currentChapterIndex: -1,
  audioPlayer: null,
  audioPlaylist: JSON.parse(localStorage.getItem('yuedu_audio_playlist') || '[]'),
  readerFont: Number(localStorage.getItem('reader_font') || 17),
  fav: JSON.parse(localStorage.getItem('yuedu_fav') || '[]'),
  disabledSources: JSON.parse(localStorage.getItem('yuedu_disabled_sources') || '[]'),
  bookFav: JSON.parse(localStorage.getItem('yuedu_book_fav') || '[]'),
  history: JSON.parse(localStorage.getItem('yuedu_history') || '[]')
};

const $ = selector => document.querySelector(selector);
const els = {
  serverState: $('#serverState'),
  categoryList: $('#categoryList'),
  statusList: $('#statusList'),
  sourceList: $('#sourceList'),
  manageSourceButton: $('#manageSourceButton'),
  sourceManageHint: $('#sourceManageHint'),
  sourceKeyword: $('#sourceKeyword'),
  sourceSort: $('#sourceSort'),
  bookKeyword: $('#bookKeyword'),
  maxResults: $('#maxResults'),
  searchForm: $('#searchForm'),
  searchButton: $('#searchButton'),
  currentSourceOnly: $('#currentSourceOnly'),
  activeFilterText: $('#activeFilterText'),
  summary: $('#summary'),
  results: $('#results'),
  readerTitle: $('#readerTitle'),
  readerSubTitle: $('#readerSubTitle'),
  readerTabs: $('#readerTabs'),
  readerBody: $('#readerBody'),
  audioFloat: $('#audioFloat'),
  toast: $('#toast')
};

async function init() {
  applyTheme(localStorage.getItem('theme') || 'light');
  bindEvents();
  renderReaderEmpty();
  try {
    const [cats, sources] = await Promise.all([
      api('/api/sources/categories'),
      api('/api/sources?size=500')
    ]);
    state.categories = normalizeCategories(cats.categories || [], sources.total || 0);
    state.sources = sources.items || [];
    els.serverState.textContent = `已加载 ${sources.total || state.sources.length} 个源`;
    renderAll();
  } catch (error) {
    els.serverState.textContent = '服务未连接';
    els.summary.innerHTML = '';
    els.results.innerHTML = `<div class="error">无法连接后端服务：${esc(error.message)}。请确认 server 已启动。</div>`;
  }
}

function normalizeCategories(categories, total) {
  const fromApi = new Map(categories.map(item => [item.key, item.count]));
  const keys = ['all', 'novel', 'comic', 'audio', 'music', 'video', 'game', 'special', 'other'];
  return keys
    .map(key => ({ key, count: key === 'all' ? (fromApi.get('all') || total) : (fromApi.get(key) || 0), ...(categoryMeta[key] || categoryMeta.other) }))
    .filter(item => item.key === 'all' || item.count > 0);
}

function renderAll() {
  renderCategories();
  renderStatusFilters();
  renderSources();
  renderSummary();
  renderInitialResults();
  renderFilterText();
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
    els.sourceManageHint.textContent = `${sources.length} 个匹配源，已禁用 ${state.disabledSources.length} 个`;
  }
}

function renderSummary() {
  const visible = filteredSources();
  const ok = state.sources.filter(item => normalizeStatus(item.status).key === 'ok').length;
  const partial = state.sources.filter(item => normalizeStatus(item.status).key === 'partial').length;
  const disabled = state.disabledSources.length;
  els.summary.innerHTML = `
    <div class="stat"><b>${state.sources.length}</b><span>总源数量</span></div>
    <div class="stat"><b>${visible.length}</b><span>当前筛选</span></div>
    <div class="stat"><b>${ok}</b><span>正常源</span></div>
    <div class="stat"><b>${partial}</b><span>部分可用 · 禁用 ${disabled}</span></div>
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
  els.bookKeyword.placeholder = state.mode === 'books' ? meta.placeholder : '输入源名称、地址或备注';
  els.results.innerHTML = `
    <div class="hint">
      ${esc(meta.label)}会按自己的内容模型打开：${esc(meta.detail)}、${esc(meta.list)}、${esc(meta.content)}。选中左侧源并勾选“仅搜索选中源”，可以单独验证某个源。
    </div>
  `;
}

function renderFilterText() {
  const category = categoryMeta[state.category]?.label || state.category;
  const status = statusMeta[state.status]?.label || state.status;
  const source = state.selectedSourceId ? state.sources.find(item => item.id === state.selectedSourceId)?.name : '';
  els.activeFilterText.textContent = `${category} / ${status}${source ? ' / ' + source : ''}`;
}

function filteredByCategory() {
  return state.category === 'all' ? state.sources : state.sources.filter(item => item.category === state.category);
}

function filteredSources() {
  const query = state.sourceQuery.trim().toLowerCase();
  let list = filteredByCategory();
  if (state.status !== 'all') list = list.filter(item => normalizeStatus(item.status).key === state.status);
  if (query) {
    list = list.filter(item => [item.name, item.url, item.group, item.comment, item.id].some(value => String(value || '').toLowerCase().includes(query)));
  }
  const sorted = [...list];
  sorted.sort((a, b) => {
    if (state.sourceSort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    if (state.sourceSort === 'weight') return Number(b.weight || 0) - Number(a.weight || 0);
    return statusRank(a.status) - statusRank(b.status) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  });
  return sorted;
}

function countByStatus(list) {
  return list.reduce((acc, item) => {
    const key = normalizeStatus(item.status).key;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizeStatus(status) {
  const key = status === 'disabled' ? 'disabled' : (status === 'vpn_needed' ? 'vpn_needed' : (status === 'partial' ? 'partial' : (status === 'failed' ? 'failed' : 'ok')));
  const label = statusMeta[key]?.label || '正常';
  const className = key === 'ok' ? 'ok' : (key === 'partial' ? 'partial' : 'failed');
  return { key, label, className };
}

function statusRank(status) {
  return { ok: 0, partial: 1, vpn_needed: 2, failed: 3, disabled: 4 }[normalizeStatus(status).key] ?? 9;
}

function isSourceDisabled(sourceId) {
  return state.disabledSources.includes(sourceId);
}

function toggleSourceDisabled(sourceId) {
  if (!sourceId) return;
  if (isSourceDisabled(sourceId)) {
    state.disabledSources = state.disabledSources.filter(id => id !== sourceId);
    toast('已启用该源');
  } else {
    state.disabledSources.push(sourceId);
    toast('已禁用该源，搜索时会自动跳过');
  }
  localStorage.setItem('yuedu_disabled_sources', JSON.stringify(state.disabledSources));
  renderSources();
  renderSummary();
  if (state.mode === 'sources') renderSourceSearchResults();
}

async function performSearch() {
  const keyword = els.bookKeyword.value.trim();
  if (state.mode === 'sources') {
    state.sourceQuery = keyword;
    if (els.sourceKeyword) els.sourceKeyword.value = keyword;
    renderSources();
    renderSourceSearchResults();
    return;
  }
  if (state.mode === 'history') {
    state.sourceQuery = keyword;
    renderHistoryResults();
    return;
  }
  if (state.mode === 'favorites') {
    state.sourceQuery = keyword;
    renderFavoriteResults();
    return;
  }
  if (!keyword) {
    toast('请输入书名或作者');
    els.bookKeyword.focus();
    return;
  }
  els.searchButton.disabled = true;
  els.results.innerHTML = `<div class="loading">正在跨源搜索“${esc(keyword)}”...</div>`;
  state.searchState = null;
  state.searchGroups = [];
  state.searchItems = {};
  try {
    await loadSearchPage(0, false);
  } catch (error) {
    els.results.innerHTML = `<div class="error">搜索失败：${esc(error.message)}</div>`;
  } finally {
    els.searchButton.disabled = false;
  }
}

async function loadSearchPage(sourceOffset = 0, append = true) {
  const keyword = els.bookKeyword.value.trim();
  const body = {
    keyword,
    category: state.category === 'all' ? undefined : state.category,
    sourceOffset,
    sourceLimit: Number(els.maxResults.value || 20),
    perSourceLimit: 5,
    timeout: 4500,
    disabledSourceIds: state.disabledSources
  };
  if (els.currentSourceOnly.checked && state.selectedSourceId) body.sourceIds = [state.selectedSourceId];
  const data = await api('/api/content/search', { method: 'POST', body: JSON.stringify(body) });
  state.searchState = data;
  state.searchGroups = append ? mergeSearchGroups(state.searchGroups, data.results || []) : (data.results || []);
  renderSearchResults(data);
}

async function loadMoreSearchUntilResult() {
  let next = state.searchState?.nextSourceOffset || 0;
  const before = state.searchGroups.reduce((sum, group) => sum + (group.items || []).length, 0);
  for (let attempt = 0; attempt < 6 && state.searchState?.hasMoreSources; attempt++) {
    await loadSearchPage(next, true);
    const after = state.searchGroups.reduce((sum, group) => sum + (group.items || []).length, 0);
    if (after > before || !state.searchState?.hasMoreSources) return;
    next = state.searchState?.nextSourceOffset || 0;
  }
}

function mergeSearchGroups(existing, incoming) {
  const groups = [...existing];
  for (const group of incoming) {
    const prev = groups.find(item => item.sourceId === group.sourceId);
    if (!prev) {
      groups.push(group);
      continue;
    }
    const seen = new Set((prev.items || []).map(item => item.itemUrl || item.name));
    for (const item of group.items || []) {
      const key = item.itemUrl || item.name;
      if (!seen.has(key)) {
        prev.items.push(item);
        seen.add(key);
      }
    }
    prev.count = prev.items.length;
  }
  return groups;
}

function renderSearchResults(data) {
  const groups = state.searchGroups.length ? state.searchGroups : (data.results || []);
  if (!groups.length) {
    const extra = data.errors?.length ? `<br><small>部分源返回错误：${esc(data.errors.map(e => e.name || e.sourceId).join('、'))}</small>` : '';
    const more = data.hasMoreSources
      ? `<div class="action-row"><button class="btn primary" data-action="load-more-search" type="button">继续搜索下一批源</button><span class="chapter-meta">已扫描 ${data.nextSourceOffset || 0}/${data.totalSources || 0} 个源</span></div>`
      : '';
    els.results.innerHTML = `<div class="empty">当前批次没有搜索到可打开的内容。${extra}</div>${renderSourceReports(data.sourceReports || [])}${more}`;
    return;
  }
  let keyIndex = 0;
  const sections = groups.map(group => {
    const rows = (group.items || []).map(item => {
      const key = 'book_' + keyIndex++;
      state.searchItems[key] = item;
      return `
        <button class="book-row" data-book-key="${key}" type="button">
          ${renderCover(item.coverUrl, item.name, 'cover')}
          <span class="book-main">
            <span class="book-title">${esc(item.name || '未命名')}</span>
            <span class="book-sub">${esc(item.author || item.kind || '未知')} · ${esc(item.sourceName || group.sourceName || '')}</span>
            <span class="book-intro">${esc(item.intro || item.lastChapter || '暂无简介')}</span>
          </span>
          <span class="row-action"><span class="type-badge">${esc(categoryMeta[item.category]?.short || item.category || '内容')}</span></span>
        </button>
      `;
    }).join('');
    return `
      <section class="group">
        <div class="group-head">
          <strong>${esc(group.sourceName || group.sourceId)}</strong>
          <span class="count">${(group.items || []).length} 条</span>
        </div>
        ${rows}
      </section>
    `;
  }).join('');
  const more = data.hasMoreSources
    ? `<div class="action-row"><button class="btn primary" data-action="load-more-search" type="button">继续搜索下一批源</button><span class="chapter-meta">已扫描 ${data.nextSourceOffset || 0}/${data.totalSources || 0} 个源</span></div>`
    : `<div class="chapter-meta">已扫描 ${data.nextSourceOffset || data.scannedSources || 0}/${data.totalSources || groups.length} 个源</div>`;
  els.results.innerHTML = sections + renderSourceReports(data.sourceReports || []) + more;
}

function renderSourceReports(reports) {
  if (!reports.length) return '';
  const counts = reports.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const failed = reports
    .filter(item => item.status === 'failed' || item.status === 'skipped')
    .slice(0, 8)
    .map(item => item.name + (item.error ? '：' + item.error : ''));
  return `
    <section class="group">
      <div class="group-head">
        <strong>本批源状态</strong>
        <span class="count">命中 ${counts.ok || 0} / 空结果 ${counts.empty || 0} / 失败 ${(counts.failed || 0) + (counts.skipped || 0)}</span>
      </div>
      ${failed.length ? `<div class="chapter-meta" style="padding:10px 13px">${esc(failed.join('；'))}</div>` : ''}
    </section>
  `;
}

function renderSourceSearchResults() {
  const sources = filteredSources();
  els.results.innerHTML = `
    <section class="group source-manager">
      <div class="group-head"><strong>源管理</strong><span class="count">${sources.length} 个</span></div>
      ${sources.map(source => `
        <div class="source-manage-row ${isSourceDisabled(source.id) ? 'user-disabled' : ''}" data-source-key="${esc(source.id)}">
          <div class="source-manage-main">
            <div class="source-manage-title">
              <span class="status-pill ${isSourceDisabled(source.id) ? 'failed' : normalizeStatus(source.status).className}">${esc(isSourceDisabled(source.id) ? '已禁用' : normalizeStatus(source.status).label)}</span>
              <strong>${esc(source.name || source.id)}</strong>
            </div>
            <div class="source-manage-meta">${esc((categoryMeta[source.category]?.label || source.category || '其他') + ' · ' + (source.group || '未分组'))}</div>
            <div class="source-manage-url">${esc(source.url || source.comment || '')}</div>
          </div>
          <div class="source-manage-actions">
            <button class="btn" data-action="toggle-source" data-source-id="${esc(source.id)}" type="button">${isSourceDisabled(source.id) ? '启用' : '禁用'}</button>
            <button class="btn ghost" data-action="inspect-source" data-source-id="${esc(source.id)}" type="button">详情</button>
          </div>
        </div>
      `).join('')}
    </section>
  `;
}

function filteredLibraryItems(items) {
  const query = (els.bookKeyword.value || state.sourceQuery || '').trim().toLowerCase();
  return (items || [])
    .filter(row => state.category === 'all' || row.item?.category === state.category)
    .filter(row => {
      if (!query) return true;
      const item = row.item || {};
      return [item.name, item.author, item.kind, item.sourceName, row.chapterName]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
}

function renderLibraryRows(rows, emptyText) {
  state.searchItems = {};
  if (!rows.length) {
    els.results.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }
  const body = rows.map((row, index) => {
    const item = row.item || row;
    const key = 'library_' + index;
    state.searchItems[key] = item;
    return `
      <button class="book-row" data-book-key="${key}" type="button">
        ${renderCover(item.coverUrl, item.name, 'cover')}
        <span class="book-main">
          <span class="book-title">${esc(item.name || '未命名')}</span>
          <span class="book-sub">${esc([item.author || item.kind, item.sourceName, row.chapterName].filter(Boolean).join(' · ') || '无记录')}</span>
          <span class="book-intro">${esc(row.readAt ? '上次打开：' + new Date(row.readAt).toLocaleString() : (item.intro || item.lastChapter || ''))}</span>
        </span>
        <span class="row-action"><span class="type-badge">${esc(categoryMeta[item.category]?.short || item.category || '内容')}</span></span>
      </button>
    `;
  }).join('');
  els.results.innerHTML = `<section class="group"><div class="group-head"><strong>${state.mode === 'history' ? '浏览历史' : '我的收藏'}</strong><span class="count">${rows.length} 条</span></div>${body}</section>`;
}

function renderHistoryResults() {
  renderLibraryRows(filteredLibraryItems(state.history), '还没有浏览历史。打开一个作品后会自动记录在这里。');
}

function renderFavoriteResults() {
  renderLibraryRows(filteredLibraryItems(state.bookFav), '还没有收藏作品。打开详情后点击“收藏作品”即可加入。');
}

function normalizeStoredItem(item) {
  if (!item) return null;
  return {
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    category: item.category,
    type: item.type,
    name: item.name,
    author: item.author,
    kind: item.kind,
    itemUrl: item.itemUrl,
    coverUrl: item.coverUrl,
    intro: item.intro,
    lastChapter: item.lastChapter,
    raw: item.raw || '',
  };
}

function itemKey(item) {
  return `${item?.sourceId || ''}|${item?.itemUrl || item?.name || ''}`;
}

function recordHistory(item, chapter = null) {
  const stored = normalizeStoredItem(item);
  if (!stored || !stored.sourceId || !stored.itemUrl) return;
  const key = itemKey(stored);
  state.history = [
    { key, item: stored, chapterName: chapter?.name || '', chapterUrl: chapter?.url || '', readAt: Date.now() },
    ...state.history.filter(row => row.key !== key)
  ].slice(0, 80);
  localStorage.setItem('yuedu_history', JSON.stringify(state.history));
}

function isBookFavorited(item) {
  const key = itemKey(item);
  return state.bookFav.some(row => row.key === key);
}

function toggleBookFavorite(item) {
  const stored = normalizeStoredItem(item);
  if (!stored || !stored.sourceId || !stored.itemUrl) return toast('当前作品缺少详情地址，无法收藏');
  const key = itemKey(stored);
  if (state.bookFav.some(row => row.key === key)) {
    state.bookFav = state.bookFav.filter(row => row.key !== key);
    toast('已取消收藏作品');
  } else {
    state.bookFav.unshift({ key, item: stored, readAt: Date.now() });
    toast('已收藏作品');
  }
  localStorage.setItem('yuedu_book_fav', JSON.stringify(state.bookFav.slice(0, 200)));
  if (state.mode === 'favorites') renderFavoriteResults();
}

async function selectSource(sourceId, showDetail = true) {
  state.selectedSourceId = sourceId;
  renderSources();
  renderFilterText();
  if (showDetail) await openSourceDetail(sourceId);
}

async function openSourceDetail(sourceId) {
  const source = state.sources.find(item => item.id === sourceId);
  openReaderPanel();
  setReaderHeader(source?.name || '源详情', source?.url || '查看规则与状态');
  setActiveTab('detail', false);
  els.readerBody.innerHTML = '<div class="loading">正在加载源详情...</div>';
  try {
    const detail = await api('/api/sources/' + encodeURIComponent(sourceId));
    const src = detail.source || {};
    const rules = ['ruleSearch', 'ruleBookInfo', 'ruleToc', 'ruleContent', 'ruleExplore']
      .filter(key => src[key] && Object.keys(src[key]).length)
      .map(key => `<details><summary>${ruleLabel(key)}</summary><pre>${esc(JSON.stringify(src[key], null, 2))}</pre></details>`)
      .join('');
    els.readerBody.innerHTML = `
      <div class="source-detail">
        <div class="action-row">
          <button class="btn ${isSourceDisabled(sourceId) ? 'primary' : ''}" data-action="toggle-current-source" type="button">${isSourceDisabled(sourceId) ? '启用该源' : '禁用该源'}</button>
          <button class="btn" data-action="favorite-source" type="button">${state.fav.includes(sourceId) ? '取消收藏源' : '收藏源'}</button>
        </div>
        ${kv('源名称', detail.name)}
        ${kv('源地址', detail.url)}
        ${kv('分类', categoryMeta[detail.category]?.label || detail.category || '')}
        ${kv('状态', normalizeStatus(detail.status).label)}
        ${kv('备注', detail.comment || '')}
        ${rules || '<div class="empty">该源没有可展示的规则</div>'}
      </div>
    `;
  } catch (error) {
    els.readerBody.innerHTML = `<div class="error">源详情加载失败：${esc(error.message)}</div>`;
  }
}

async function openBook(key) {
  const item = state.searchItems[key];
  if (!item) {
    toast('搜索结果已失效，请重新搜索');
    return;
  }
  if (!item.itemUrl) {
    toast('该结果缺少详情链接');
    return;
  }
  state.currentBook = {
    item,
    info: null,
    toc: [],
    nextTocUrl: '',
    tocLoaded: false,
    chapter: null,
    session: ''
  };
  recordHistory(item);
  state.activeTab = 'detail';
  state.currentChapterIndex = -1;
  openReaderPanel();
  setReaderHeader(item.name || '详情', `${item.author || item.kind || ''} · ${item.sourceName || ''}`);
  renderReaderLoading('正在获取详情...');
  try {
    const info = await apiPost('/api/content/detail', {
      sourceId: item.sourceId,
      itemUrl: item.itemUrl,
      raw: item.raw || ''
    });
    info.name = chooseText(info.name, item.name, '未命名');
    info.author = chooseText(info.author, item.author, '');
    info.intro = chooseText(info.intro, item.intro, '暂无简介');
    info.coverUrl = info.coverUrl || item.coverUrl || '';
    info.tocUrl = info.tocUrl || item.itemUrl;
    bookSessionSet(info.session);
    state.currentBook.info = info;
    setReaderHeader(info.name, `${info.author} · ${item.sourceName || info.sourceId || ''}`);
    renderReaderDetail();
  } catch (error) {
    renderReaderError(`详情加载失败：${error.message}`, item);
  }
}

function renderReaderDetail() {
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
          <button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenButtonLabel()}</button>
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
  const intro = info.intro || book.item?.intro || (isGame ? '可在右侧面板中试玩，也可以在浏览器中单独打开。' : '可在右侧面板中预览，也可以在浏览器中单独打开。');
  els.readerBody.innerHTML = `
    <div class="service-detail">
      ${renderCover(info.coverUrl || book.item?.coverUrl, title, 'detail-cover')}
      <div class="service-main">
        <div class="detail-title">${esc(title)}</div>
        <p class="meta-line">${esc([info.author || book.item?.author, info.kind || book.item?.kind, book.item?.sourceName].filter(Boolean).join(' · '))}</p>
        <div class="service-actions">
          ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${isGame ? '开始游戏' : '打开工具'}</a>` : ''}
          <button class="btn" data-action="preview-service" type="button">${isGame ? '打开游玩' : '面板预览'}</button>
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
    els.readerBody.innerHTML = '<div class="empty">还没有加载内容</div>';
    return;
  }
  const paragraphs = String(chapter.content || '').split(/\n+/).map(p => p.trim()).filter(Boolean);
  const prevDisabled = state.currentChapterIndex <= 0 ? 'disabled' : '';
  const nextDisabled = state.currentChapterIndex >= book.toc.length - 1 ? 'disabled' : '';
  const fullscreenLabel = fullscreenButtonLabel();
  document.documentElement.style.setProperty('--reader-font', state.readerFont + 'px');
  const body = renderPayloadBody(chapter);
  els.readerBody.innerHTML = `
    <div class="chapter-bar">
      <span class="spacer"></span>
      <button class="btn icon" data-action="font-down" title="减小字号" type="button">A-</button>
      <button class="btn icon" data-action="font-up" title="增大字号" type="button">A+</button>
      <button class="btn" data-action="toggle-fullscreen" type="button">${fullscreenLabel}</button>
    </div>
    <div class="chapter-meta">
      ${esc(chapter.name || '')} · ${chapter.length || 0} 字 · ${chapter.pageCount || 1} 页${chapter.truncatedByPageLimit ? ' · 已触及分页上限' : ''}
    </div>
    ${body || `<article class="reader-article">${paragraphs.length ? paragraphs.map(p => `<p>${esc(p)}</p>`).join('') : '<p>暂无内容</p>'}</article>`}
    <div class="chapter-bottom-nav">
      <button class="btn" data-action="prev-chapter" ${prevDisabled} type="button">上一章</button>
      <button class="btn primary" data-action="next-chapter" ${nextDisabled} type="button">下一章</button>
    </div>
  `;
  if (typeof mountHlsPlayers === 'function') mountHlsPlayers(els.readerBody);
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

function openReaderPanel() {
  document.body.classList.add('reader-open');
}

function closePanels() {
  document.body.classList.remove('reader-open', 'nav-open', 'reader-fullscreen');
}

function renderCover(url, name, className) {
  if (url) return `<img class="${className}" src="${esc(url)}" alt="${esc(name || '封面')}" data-cover-name="${esc(name || '')}" onerror="this.replaceWith(coverFallbackFromImage(this))">`;
  return `<span class="${className} placeholder">${esc((name || '书').slice(0, 1))}</span>`;
}

function coverFallback(name, className) {
  const span = document.createElement('span');
  span.className = className + ' placeholder';
  span.textContent = (name || '书').slice(0, 1);
  return span;
}

function coverFallbackFromImage(img) {
  return coverFallback(img.dataset.coverName || img.alt || '', img.className || 'cover');
}

function kv(label, value) {
  return `<div class="kv"><span>${esc(label)}</span><div>${esc(value || '-')}</div></div>`;
}

function ruleLabel(key) {
  return { ruleSearch: '搜索规则', ruleBookInfo: '详情规则', ruleToc: '列表规则', ruleContent: '内容规则', ruleExplore: '发现规则' }[key] || key;
}

function chooseText(primary, fallback, emptyText) {
  const value = String(primary || '').trim();
  if (value && !/^(未知|unknown|暂无简介|鏈煡)/i.test(value)) return value;
  return String(fallback || '').trim() || emptyText;
}

function favoriteSource(sourceId) {
  if (!sourceId) return;
  if (state.fav.includes(sourceId)) {
    state.fav = state.fav.filter(id => id !== sourceId);
    toast('已取消收藏源');
  } else {
    state.fav.push(sourceId);
    toast('已收藏源');
  }
  localStorage.setItem('yuedu_fav', JSON.stringify(state.fav));
}

function bindEvents() {
  els.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    performSearch();
  });
  $('#modeTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    state.mode = button.dataset.mode;
    $('#modeTabs').querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn === button));
    els.bookKeyword.placeholder = state.mode === 'books'
      ? (categoryMeta[state.category]?.placeholder || '输入关键词')
      : (state.mode === 'sources' ? '输入源名称、地址或备注' : '筛选名称、作者或来源');
    renderInitialResults();
  });
  els.categoryList.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    renderAll();
    els.bookKeyword.placeholder = state.mode === 'books'
      ? (categoryMeta[state.category]?.placeholder || '输入关键词')
      : (state.mode === 'sources' ? '输入源名称、地址或备注' : '筛选名称、作者或来源');
  });
  els.statusList.addEventListener('click', event => {
    const button = event.target.closest('[data-status]');
    if (!button) return;
    state.status = button.dataset.status;
    renderStatusFilters();
    renderSources();
    renderSummary();
    renderFilterText();
    if (state.mode === 'sources') renderSourceSearchResults();
  });
  if (els.manageSourceButton) {
    els.manageSourceButton.addEventListener('click', () => {
      state.mode = 'sources';
      $('#modeTabs').querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'sources'));
      els.bookKeyword.placeholder = '筛选源名称、地址或备注';
      renderSourceSearchResults();
      document.body.classList.remove('nav-open');
    });
  }
  if (els.sourceList) {
    els.sourceList.addEventListener('click', event => {
      const card = event.target.closest('[data-source-id]');
      if (!card) return;
      selectSource(card.dataset.sourceId);
      document.body.classList.remove('nav-open');
    });
  }
  if (els.sourceKeyword) {
    els.sourceKeyword.addEventListener('input', event => {
      state.sourceQuery = event.target.value;
      renderSources();
      renderSummary();
      if (state.mode === 'sources') renderSourceSearchResults();
    });
  }
  if (els.sourceSort) {
    els.sourceSort.addEventListener('change', event => {
      state.sourceSort = event.target.value;
      renderSources();
    });
  }
  els.results.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle-source') {
      const button = event.target.closest('[data-source-id]');
      toggleSourceDisabled(button?.dataset.sourceId);
      return;
    }
    if (action === 'inspect-source') {
      const button = event.target.closest('[data-source-id]');
      if (button?.dataset.sourceId) selectSource(button.dataset.sourceId);
      return;
    }
    if (action === 'load-more-search') {
      event.target.disabled = true;
      event.target.textContent = '正在继续搜索...';
      loadMoreSearchUntilResult().catch(error => {
        toast('继续搜索失败：' + error.message);
        event.target.disabled = false;
        event.target.textContent = '继续搜索下一批源';
      });
      return;
    }
    const book = event.target.closest('[data-book-key]');
    if (book) {
      openBook(book.dataset.bookKey);
      return;
    }
    const source = event.target.closest('[data-source-key]');
    if (source) selectSource(source.dataset.sourceKey);
  });
  els.readerTabs.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) setActiveTab(tab.dataset.tab);
  });
  els.readerBody.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) handleReaderAction(action, event);
    const chapterButton = event.target.closest('[data-chapter-key]');
    if (chapterButton) {
      const chapter = state.chapters[chapterButton.dataset.chapterKey];
      if (chapter) loadChapter(chapter.index);
    }
  });
  els.audioFloat.addEventListener('click', event => {
    const button = event.target.closest('[data-audio-action]');
    const action = button?.dataset.audioAction;
    if (action === 'close') closeAudioPlayer();
    if (action === 'add-current') addAudioToPlaylist();
    if (action === 'toggle-fullscreen') toggleAudioFullscreen();
    if (action === 'clear-playlist') clearAudioPlaylist();
    if (action === 'play-index') playAudioTrack(Number(button?.dataset.index || 0));
    if (action === 'remove-index') removeAudioFromPlaylist(Number(button?.dataset.index || 0));
  });
  $('#openNav').addEventListener('click', () => document.body.classList.add('nav-open'));
  $('#closeReader').addEventListener('click', () => document.body.classList.remove('reader-open', 'reader-fullscreen'));
  $('#drawerMask').addEventListener('click', closePanels);
  $('#themeButton').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanels();
    if (event.key === '/' && document.activeElement.tagName !== 'INPUT') {
      event.preventDefault();
      els.bookKeyword.focus();
    }
  });
}

function handleReaderAction(action, event) {
  const book = state.currentBook;
  if (action === 'copy-resource') {
    const button = event?.target?.closest('[data-url]');
    const url = button?.dataset.url || '';
    if (url) {
      navigator.clipboard?.writeText(url).then(() => toast('已复制资源地址')).catch(() => toast('复制失败'));
    }
    return;
  }
  if (action === 'load-toc') loadToc();
  if (action === 'preview-service') previewService();
  if (action === 'reload-toc') loadToc(true);
  if (action === 'load-more-toc') loadMoreToc();
  if (action === 'toggle-current-source') {
    toggleSourceDisabled(state.selectedSourceId || book?.item?.sourceId);
    if (state.selectedSourceId) openSourceDetail(state.selectedSourceId);
  }
  if (action === 'favorite-source') {
    favoriteSource(state.selectedSourceId || book?.item?.sourceId);
    if (state.selectedSourceId) openSourceDetail(state.selectedSourceId);
  }
  if (action === 'open-site') {
    const url = book?.item?.itemUrl || book?.info?.tocUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
  if (action === 'favorite-book') {
    toggleBookFavorite(book?.item);
    if (state.activeTab === 'detail') renderReaderDetail();
  }
  if (action === 'toggle-fullscreen') {
    document.body.classList.toggle('reader-fullscreen');
    if (state.activeTab === 'chapter') renderChapter();
    if (state.activeTab === 'detail') renderReaderDetail();
  }
  if (action === 'open-audio-player') openAudioPlayer();
  if (action === 'add-current-audio-to-playlist') addAudioToPlaylist();
  if (action === 'prev-chapter') loadChapter(Math.max(0, state.currentChapterIndex - 1));
  if (action === 'next-chapter') loadChapter(Math.min((book?.toc?.length || 1) - 1, state.currentChapterIndex + 1));
  if (action === 'font-down') {
    state.readerFont = Math.max(14, state.readerFont - 1);
    localStorage.setItem('reader_font', String(state.readerFont));
    renderChapter();
  }
  if (action === 'font-up') {
    state.readerFont = Math.min(24, state.readerFont + 1);
    localStorage.setItem('reader_font', String(state.readerFont));
    renderChapter();
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('theme', document.documentElement.dataset.theme);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(els.toast._timer);
  els.toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

init();
