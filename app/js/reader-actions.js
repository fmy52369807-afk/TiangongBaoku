// Reader panel action dispatcher.

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
  if (action === 'close-reader') {
    closeReaderPanel();
    setMode('books');
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
    if (book?.info?.category === 'video') return;
    document.body.classList.toggle('reader-fullscreen');
    document.body.classList.remove('reader-tools-open');
    if (state.activeTab === 'chapter') renderChapter();
    if (state.activeTab === 'detail') renderReaderDetail();
  }
  if (action === 'toggle-reader-toc') {
    if (typeof supportsReaderModes === 'function' && !supportsReaderModes()) return;
    document.body.classList.toggle('reader-toc-open');
    document.body.classList.remove('reader-tools-open');
    return;
  }
  if (action === 'toggle-reader-tools') {
    if (typeof supportsReaderModes === 'function' && !supportsReaderModes()) return;
    const shouldOpen = !document.body.classList.contains('reader-tools-open');
    document.body.classList.toggle('reader-tools-open', shouldOpen);
    if (shouldOpen) document.body.classList.remove('reader-toc-open');
    return;
  }
  if (action === 'set-reader-scroll' || action === 'set-reader-paged') {
    if (typeof supportsReaderModes === 'function' && !supportsReaderModes()) return;
    state.readerMode = action === 'set-reader-paged' ? 'paged' : 'scroll';
    document.body.classList.toggle('reader-paged', state.readerMode === 'paged');
    state.readerPageIndex = 0;
    store.set('reader_mode', state.readerMode);
    renderChapter();
  }
  if (action === 'reader-page-prev') {
    if (typeof supportsReaderModes === 'function' && !supportsReaderModes()) return;
    turnReaderPage(-1);
  }
  if (action === 'reader-page-next') {
    if (typeof supportsReaderModes === 'function' && !supportsReaderModes()) return;
    turnReaderPage(1);
  }
  if (action === 'open-audio-player') openAudioPlayer();
  if (action === 'add-current-audio-to-playlist') addAudioToPlaylist();
  if (action === 'prev-chapter') loadChapter(Math.max(0, state.currentChapterIndex - 1));
  if (action === 'next-chapter') loadChapter(Math.min((book?.toc?.length || 1) - 1, state.currentChapterIndex + 1));
  if (action === 'font-down') {
    state.readerFont = Math.max(14, state.readerFont - 1);
    store.set('reader_font', String(state.readerFont));
    renderChapter();
  }
  if (action === 'font-up') {
    state.readerFont = Math.min(24, state.readerFont + 1);
    store.set('reader_font', String(state.readerFont));
    renderChapter();
  }
}
