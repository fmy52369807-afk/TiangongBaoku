// Reader mode rendering: continuous scroll, paged text, and paged comics.
// Depends on globals from main.js and payload-renderers.js.

function renderReaderContent(chapter, paragraphs, allowPaged = true) {
  const type = chapter.type || state.currentBook?.info?.profile?.payloadKind || 'text';
  if (allowPaged && state.readerMode === 'paged' && type === 'images') return renderPagedImageContent(chapter);
  if (allowPaged && state.readerMode === 'paged' && (type === 'text' || paragraphs.length)) return renderPagedTextContent(chapter, paragraphs);
  state.readerPageIndex = 0;
  const body = renderPayloadBody(chapter);
  return {
    html: body || `<article class="reader-article">${paragraphs.length ? paragraphs.map(p => `<p>${esc(p)}</p>`).join('') : '<p>暂无内容</p>'}</article>`,
    pageCount: 1
  };
}

function renderPagedTextContent(chapter, paragraphs) {
  const pages = paginateTextParagraphs(paragraphs);
  state.readerPageIndex = alignReaderPageIndex(state.readerPageIndex, pages.length);
  const spreadSize = readerSpreadSize();
  return {
    pageCount: pages.length,
    html: `
      <section class="reader-book-frame text-book ${readerTurnClass()}">
        <button class="page-hit left" data-action="reader-page-prev" type="button" aria-label="上一页"></button>
        <div class="reader-book-spread ${spreadSize > 1 ? 'is-two-page' : 'is-single-page'}">
          ${renderBookTextPage(pages[state.readerPageIndex] || [], 'left', state.readerPageIndex)}
          ${spreadSize > 1 ? renderBookTextPage(pages[state.readerPageIndex + 1] || [], 'right', state.readerPageIndex + 1, state.readerPageIndex + 1 >= pages.length) : ''}
          ${renderTurningSheet()}
        </div>
        <button class="page-hit right" data-action="reader-page-next" type="button" aria-label="下一页"></button>
      </section>
    `
  };
}

function renderPagedImageContent(payload) {
  const urls = cleanMediaUrls(payload.urls || [], 'images').filter(url => /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url));
  if (!urls.length) return { pageCount: 1, html: '<div class="empty">没有解析到漫画图片</div>' };
  state.readerPageIndex = alignReaderPageIndex(state.readerPageIndex, urls.length);
  const spreadSize = readerSpreadSize();
  const referer = payload.entryUrl || state.currentBook?.toc?.[state.currentChapterIndex]?.url || '';
  const title = payload.title || payload.name || state.currentBook?.toc?.[state.currentChapterIndex]?.name || '';
  return {
    pageCount: urls.length,
    html: `
      <section class="reader-book-frame comic-book ${readerTurnClass()}">
        <button class="page-hit left" data-action="reader-page-prev" type="button" aria-label="上一页"></button>
        <div class="reader-book-spread comic-spread ${spreadSize > 1 ? 'is-two-page' : 'is-single-page'}">
          ${renderBookImagePage(urls[state.readerPageIndex], referer, title, state.readerPageIndex, 'left')}
          ${spreadSize > 1 ? renderBookImagePage(urls[state.readerPageIndex + 1], referer, title, state.readerPageIndex + 1, 'right', state.readerPageIndex + 1 >= urls.length) : ''}
          ${renderTurningSheet()}
        </div>
        <button class="page-hit right" data-action="reader-page-next" type="button" aria-label="下一页"></button>
      </section>
    `
  };
}

function renderBookTextPage(paragraphs, side, index, empty = false) {
  const body = !empty && paragraphs.length ? paragraphs.map(p => `<p>${esc(p)}</p>`).join('') : '<p class="blank-page-note"> </p>';
  return `<article class="reader-article reader-book-page ${side}" data-page-number="${index + 1}">${body}</article>`;
}

function renderBookImagePage(url, referer, title, index, side, empty = false) {
  const body = !empty && url
    ? renderComicImage(url, referer, title, index)
    : '<div class="blank-comic-page"></div>';
  return `<article class="reader-book-page comic-book-page ${side}" data-page-number="${index + 1}">${body}</article>`;
}

function renderTurningSheet() {
  if (readerSpreadSize() < 2 || !state.readerTurnDirection) return '';
  const side = state.readerTurnDirection === 'next' ? 'right' : 'left';
  return `<div class="reader-turn-sheet ${side}" aria-hidden="true"></div>`;
}

function paginateTextParagraphs(paragraphs) {
  const list = paragraphs.length ? paragraphs : ['暂无内容'];
  const full = document.body.classList.contains('reader-fullscreen');
  const paged = document.body.classList.contains('reader-paged') || state.readerMode === 'paged';
  const spreadSize = readerSpreadSize();
  const availableWidth = els.readerBody?.clientWidth || window.innerWidth || 960;
  const width = full || paged
    ? Math.min((availableWidth - 38) / spreadSize, 760)
    : Math.min(560, Math.max(320, availableWidth / spreadSize));
  const availableHeight = els.readerBody?.clientHeight || window.innerHeight || 720;
  const height = paged
    ? Math.max(420, window.innerHeight - 210)
    : Math.max(420, availableHeight - 190);
  const lineHeight = state.readerFont * 2;
  const charsPerLine = Math.max(12, Math.floor((width - 76) / (state.readerFont * 1.05)));
  const maxLines = Math.max(8, Math.floor((height - 72) / lineHeight));
  const maxUnits = maxLines;
  const pages = [];
  let page = [];
  let used = 0;
  for (const paragraph of list) {
    const units = Math.max(1, Math.ceil(String(paragraph).length / charsPerLine) + 1);
    if (page.length && used + units > maxUnits) {
      pages.push(page);
      page = [];
      used = 0;
    }
    if (units > maxUnits) {
      const chunkSize = Math.max(charsPerLine * Math.max(4, maxLines - 2), 80);
      for (let i = 0; i < paragraph.length; i += chunkSize) {
        if (page.length) {
          pages.push(page);
          page = [];
          used = 0;
        }
        pages.push([paragraph.slice(i, i + chunkSize)]);
      }
      continue;
    }
    page.push(paragraph);
    used += units;
  }
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

function renderPageControls(pageCount) {
  if (state.readerMode !== 'paged') return '';
  const total = Math.max(1, pageCount || 1);
  const spreadSize = readerSpreadSize();
  state.readerPageIndex = alignReaderPageIndex(state.readerPageIndex, total);
  const start = Math.min(state.readerPageIndex + 1, total);
  const end = Math.min(state.readerPageIndex + spreadSize, total);
  const prevDisabled = state.readerPageIndex <= 0 ? 'disabled' : '';
  const nextDisabled = state.readerPageIndex >= total - spreadSize ? 'disabled' : '';
  return `
    <div class="page-controls">
      <button class="btn icon" data-action="reader-page-prev" ${prevDisabled} title="上一页" type="button">&lsaquo;</button>
      <span class="chapter-meta">${spreadSize > 1 && start !== end ? `${start}-${end}` : start} / ${total}</span>
      <button class="btn icon" data-action="reader-page-next" ${nextDisabled} title="下一页" type="button">&rsaquo;</button>
    </div>
  `;
}

function clampReaderPage(index, total) {
  const max = Math.max(0, Number(total || 1) - 1);
  return Math.min(Math.max(0, Number(index || 0)), max);
}

function turnReaderPage(direction) {
  if (state.readerMode !== 'paged') return;
  const before = state.readerPageIndex;
  const step = readerSpreadSize();
  const nextIndex = Math.max(0, state.readerPageIndex + direction * step);
  if (nextIndex === before) {
    state.readerTurnDirection = '';
    renderChapter();
    return;
  }
  state.readerTurnDirection = direction > 0 ? 'next' : 'prev';
  state.readerPageIndex = nextIndex;
  renderChapter();
  els.readerBody.scrollTop = 0;
  clearTimeout(state.readerTurnTimer);
  state.readerTurnTimer = setTimeout(() => {
    state.readerTurnDirection = '';
    if (state.readerMode === 'paged' && state.activeTab === 'chapter') renderChapter();
  }, 420);
}

function readerSpreadSize() {
  const width = els.readerBody?.clientWidth || window.innerWidth || 0;
  return width >= 860 ? 2 : 1;
}

function alignReaderPageIndex(index, total) {
  const clamped = clampReaderPage(index, total);
  return readerSpreadSize() > 1 ? clamped - (clamped % 2) : clamped;
}

function readerTurnClass() {
  if (state.readerTurnDirection === 'next') return 'reader-turn-next';
  if (state.readerTurnDirection === 'prev') return 'reader-turn-prev';
  return '';
}
