// Shared layout controls and small rendering utilities.

function openReaderPanel() {
  document.body.classList.add('reader-open');
}

function openNavPanel() {
  document.body.classList.add('nav-open');
}

function closePanels() {
  closeReaderPanel();
  document.body.classList.remove('nav-open');
}

function closeReaderPanel() {
  document.body.classList.remove(
    'reader-open',
    'reader-fullscreen',
    'reader-tools-open',
    'reader-toc-open',
    'reader-reading',
    'reader-paged',
    'reader-media',
    'reader-video'
  );
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
  if (value && !/^(未知|unknown|暂无简介)/i.test(value)) return value;
  return String(fallback || '').trim() || emptyText;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  store.set('theme', document.documentElement.dataset.theme);
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
