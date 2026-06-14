// Source detail and book-opening flows.

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
