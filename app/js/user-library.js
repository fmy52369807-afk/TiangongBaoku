// User library state: reading history, book favorites, and source favorites.

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
  store.set('yuedu_history', JSON.stringify(state.history));
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
  store.set('yuedu_book_fav', JSON.stringify(state.bookFav.slice(0, 200)));
  if (state.mode === 'favorites') renderFavoriteResults();
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
  store.set('yuedu_fav', JSON.stringify(state.fav));
}
