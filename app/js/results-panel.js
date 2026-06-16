// Workbench result rendering and search interactions.
// Depends on globals initialized in main.js.

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
    const scanText = `已扫描 ${data.nextSourceOffset || data.scannedSources || 0}/${data.totalSources || 0} 个源`;
    const extra = data.errors?.length ? `<br><small>部分源返回错误：${esc(data.errors.map(e => e.name || e.sourceId).join('、'))}</small>` : '';
    const status = data.sourceReports?.length
      ? `<div class="chapter-meta">${esc(scanText)}</div><div class="chapter-meta">命中 ${data.sourceReports.filter(item => item.status === 'ok').length} / 失败 ${data.sourceReports.filter(item => item.status === 'failed' || item.status === 'skipped').length}</div>`
      : '';
    const more = data.hasMoreSources
      ? `<div class="action-row"><button class="btn primary" data-action="load-more-search" type="button">继续搜索下一批源</button><span class="chapter-meta">已扫描 ${data.nextSourceOffset || 0}/${data.totalSources || 0} 个源</span></div>`
      : '';
    els.results.innerHTML = `<div class="empty">当前批次没有搜索到可打开的内容。${extra}</div>${status}${renderSourceReports(data.sourceReports || [])}${more}`;
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
