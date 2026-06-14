// Application event wiring.

let readerResizeTimer = 0;

function bindEvents() {
  els.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    performSearch();
  });
  $('#modeTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    setMode(button.dataset.mode);
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
      setMode('sources');
      document.body.classList.remove('nav-open');
    });
  }
  if (els.playlistButton) {
    els.playlistButton.addEventListener('click', openAudioPlaylist);
  }
  if (els.backHomeButton) {
    els.backHomeButton.addEventListener('click', () => {
      closeReaderPanel();
      document.body.classList.remove('nav-open');
      setMode('books');
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
    const shortcut = event.target.closest('[data-mode-shortcut]');
    if (shortcut) {
      setMode(shortcut.dataset.modeShortcut);
      return;
    }
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
      if (chapter) {
        document.body.classList.remove('reader-toc-open');
        loadChapter(chapter.index);
      }
    }
  });
  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-action="close-reader"]');
    if (!closeButton) return;
    event.preventDefault();
    event.stopPropagation();
    closeReaderPanel();
    setMode('books');
  }, true);
  els.audioFloat.addEventListener('click', event => {
    const button = event.target.closest('[data-audio-action]');
    const action = button?.dataset.audioAction;
    if (action === 'close') closeAudioPlayer();
    if (action === 'add-current') addAudioToPlaylist();
    if (action === 'toggle-fullscreen') toggleAudioFullscreen();
    if (action === 'clear-playlist') clearAudioPlaylist();
    if (action === 'play-playlist') playAudioPlaylist();
    if (action === 'play-index') playAudioTrack(Number(button?.dataset.index || 0));
    if (action === 'remove-index') removeAudioFromPlaylist(Number(button?.dataset.index || 0));
  });
  $('#openNav').addEventListener('click', openNavPanel);
  $('#closeReader').addEventListener('click', closeReaderPanel);
  $('#drawerMask').addEventListener('click', closePanels);
  $('#themeButton').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName || '';
    if (event.key === 'Escape') closePanels();
    if (state.activeTab === 'chapter' && state.readerMode === 'paged' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        turnReaderPage(-1);
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        turnReaderPage(1);
      }
    }
    if (event.key === '/' && tag !== 'INPUT') {
      event.preventDefault();
      els.bookKeyword.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (state.activeTab !== 'chapter' || state.readerMode !== 'paged') return;
    clearTimeout(readerResizeTimer);
    readerResizeTimer = setTimeout(() => {
      state.readerPageIndex = clampReaderPage(state.readerPageIndex, 9999);
      renderChapter();
    }, 120);
  });
}
