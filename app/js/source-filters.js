// Source filtering, status normalization, and user-disabled source state.

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
  store.set('yuedu_disabled_sources', JSON.stringify(state.disabledSources));
  renderSources();
  renderSummary();
  if (state.mode === 'sources') renderSourceSearchResults();
}
