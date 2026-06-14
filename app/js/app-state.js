// Shared application state and DOM references.

const categoryMeta = window.categoryMeta || {};
const statusMeta = window.statusMeta || {};
const store = window.uiStorage || {
  get(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  json(key, fallback) {
    try {
      return JSON.parse(this.get(key, JSON.stringify(fallback)));
    } catch {
      return fallback;
    }
  }
};

const state = {
  categories: [],
  sources: [],
  hotRecommendations: { categories: {} },
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
  audioPlaylist: store.json('yuedu_audio_playlist', []),
  readerFont: Number(store.get('reader_font', '17')) || 17,
  readerMode: store.get('reader_mode', 'scroll') === 'paged' ? 'paged' : 'scroll',
  readerPageIndex: 0,
  readerTurnDirection: '',
  readerTurnTimer: null,
  fav: store.json('yuedu_fav', []),
  disabledSources: store.json('yuedu_disabled_sources', []),
  bookFav: store.json('yuedu_book_fav', []),
  history: store.json('yuedu_history', [])
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
  playlistButton: $('#playlistButton'),
  backHomeButton: $('#backHomeButton'),
  currentSourceOnly: $('#currentSourceOnly'),
  activeFilterText: $('#activeFilterText'),
  summary: $('#summary'),
  results: $('#results'),
  readerTitle: $('#readerTitle'),
  readerSubTitle: $('#readerSubTitle'),
  readerTabs: $('#readerTabs'),
  reader: $('#reader'),
  readerBody: $('#readerBody'),
  sidebar: $('#sidebar'),
  audioFloat: $('#audioFloat'),
  toast: $('#toast')
};
