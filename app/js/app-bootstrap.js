// Application bootstrap.

async function init() {
  applyTheme(store.get('theme', 'light'));
  applyAppModeChrome();
  bindEvents();
  renderReaderEmpty();
  try {
    const [cats, sources] = await Promise.all([
      api('/api/sources/categories'),
      api('/api/sources?size=500')
    ]);
    state.categories = normalizeCategories(cats.categories || [], sources.total || 0);
    state.sources = sources.items || [];
    els.serverState.textContent = `\u5df2\u52a0\u8f7d ${sources.total || state.sources.length} \u4e2a\u6e90`;
    renderAll();
  } catch (error) {
    els.serverState.textContent = '\u670d\u52a1\u672a\u8fde\u63a5';
    els.summary.innerHTML = '';
    els.results.innerHTML = `<div class="error">\u65e0\u6cd5\u8fde\u63a5\u540e\u7aef\u670d\u52a1\uff1a${esc(error.message)}\u3002\u8bf7\u786e\u8ba4 server \u5df2\u542f\u52a8\u3002</div>`;
  }
}

init();
