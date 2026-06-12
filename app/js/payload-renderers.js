function renderPayloadBody(payload) {
  const type = payload.type || state.currentBook?.info?.profile?.payloadKind || 'text';
  const urls = cleanMediaUrls(payload.urls || [], type);
  if (type === 'images') return renderImagePayload(payload, urls);
  if (type === 'audio') return renderAudioPayload(payload, urls);
  if (type === 'video') return renderVideoPayload(payload, urls);
  if (type === 'link') return renderLinkPayload(payload, urls);
  if (payload.mode === 'raw' && /<[^>]+>/.test(payload.content || '')) {
    return `<article class="reader-article">${sanitizeBasicHtml(payload.content)}</article>`;
  }
  return '';
}

function renderImagePayload(payload, urls) {
  const imageUrls = urls.filter(url => /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url));
  if (imageUrls.length) {
    const referer = payload.entryUrl || state.currentBook?.toc?.[state.currentChapterIndex]?.url || '';
    return `<div class="comic-pages">${imageUrls.map((url, index) => renderComicImage(url, referer, payload.title, index)).join('')}</div>`;
  }
  return '<div class="empty">没有解析到漫画图片</div>';
}

function renderComicImage(url, referer, title, index = 0) {
  const label = title ? `${title} ${index + 1}` : `漫画页 ${index + 1}`;
  return `<img class="comic-page-image" src="${esc(proxyImageUrl(url, referer))}" data-original-src="${esc(url)}" data-referer="${esc(referer || '')}" data-page-index="${index}" data-retry-count="0" alt="${esc(label)}" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.remove('is-retrying')" onerror="retryComicImage(this)">`;
}

function renderAudioPayload(payload, urls) {
  const mediaUrl = cleanMediaUrls([payload.mediaUrl, ...urls], 'audio')[0];
  const title = payload.title || payload.name || state.currentBook?.toc?.[state.currentChapterIndex]?.name || state.currentBook?.info?.name || '音频节目';
  const album = state.currentBook?.info?.name || state.currentBook?.item?.name || '听书';
  const cover = state.currentBook?.info?.coverUrl || state.currentBook?.item?.coverUrl || '';
  const links = urls.length ? urls : (mediaUrl ? [mediaUrl] : []);
  state.audioPlayer = { mediaUrl, title, album, cover, links, kind: state.currentBook?.item?.category || 'audio' };
  return `
    <section class="audio-card">
      ${cover ? `<img class="audio-art" src="${esc(cover)}" alt="${esc(album || title)}" onerror="this.replaceWith(audioCoverFallback())">` : '<div class="audio-art placeholder">听</div>'}
      <div class="audio-info">
        <span class="type-badge">${state.currentBook?.item?.category === 'music' ? '音乐' : '听书'}</span>
        <h3>${esc(title)}</h3>
        <p>${esc(album)}</p>
      </div>
      <div class="audio-actions">
        ${mediaUrl ? `<button class="btn primary" data-action="open-audio-player" type="button">打开播放浮窗</button><button class="btn" data-action="add-current-audio-to-playlist" type="button">加入歌单</button>` : '<div class="empty compact">没有解析到可播放音频</div>'}
        ${renderResourceActions(links, '音频')}
      </div>
    </section>
  `;
}

function renderVideoPayload(payload, urls) {
  const mediaUrl = cleanMediaUrls([payload.mediaUrl, ...urls], 'video')[0];
  const title = payload.title || state.currentBook?.toc?.[state.currentChapterIndex]?.name || '视频';
  if (!mediaUrl) return '<div class="empty">没有解析到可播放视频</div>';
  if (payload.validation && payload.validation.ok === false) {
    return `
      <div class="error">视频资源不可达：${esc(payload.validation.reason || 'media_unreachable')}</div>
      ${renderResourceActions([mediaUrl], '视频')}
    `;
  }
  const direct = isDirectVideoUrl(mediaUrl);
  const hls = isHlsVideoUrl(mediaUrl);
  const playUrl = hls ? proxyHlsUrl(mediaUrl, payload.entryUrl || mediaUrl) : mediaUrl;
  return `
    <section class="video-card">
      <div class="video-stage">
        ${direct
          ? `<video controls playsinline ${hls ? `data-hls-src="${esc(playUrl)}"` : `src="${esc(playUrl)}"`}></video>`
          : `<iframe src="${esc(mediaUrl)}" title="${esc(title)}" referrerpolicy="no-referrer" allowfullscreen></iframe>`}
      </div>
      <div class="video-info">
        <div>
          <span class="type-badge">${direct ? '直链播放' : '解析播放'}</span>
          <h3>${esc(title)}</h3>
        </div>
        ${renderResourceActions([mediaUrl], '视频')}
      </div>
    </section>
  `;
}

function renderLinkPayload(payload, urls) {
  const links = urls.length ? urls : (payload.mediaUrl ? [payload.mediaUrl] : []);
  const category = payload.category || state.currentBook?.info?.category || state.currentBook?.item?.category || '';
  if (category === 'game') return renderGameLinkPayload(payload, links);
  if (category === 'special') return renderToolLinkPayload(payload, links);
  return `
    <div class="media-box">
      <div class="chapter-meta">${esc(payload.text || '可打开以下资源继续操作。')}</div>
      ${renderResourceActions(links, '资源')}
    </div>
  `;
}

function renderGameLinkPayload(payload, links) {
  const url = links[0] || payload.mediaUrl || payload.entryUrl || '';
  const title = payload.title || state.currentBook?.info?.name || state.currentBook?.item?.name || '游戏';
  if (!url) return '<div class="empty">没有可启动的游戏入口</div>';
  const canEmbed = isEmbeddableGameUrl(url);
  return `
    <section class="service-card game-service">
      <div class="service-card-head">
        <div>
          <span class="type-badge">游戏入口</span>
          <h3>${esc(title)}</h3>
        </div>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">新窗口打开</a>
      </div>
      ${canEmbed ? `
        <div class="service-frame">
          <iframe src="${esc(url)}" title="${esc(title)}" referrerpolicy="no-referrer" allowfullscreen></iframe>
        </div>
      ` : `
        <div class="service-launch-panel">
          <div>
            <strong>该游戏站点禁止嵌入显示</strong>
            <p>浏览器会拦截右侧面板预览，请使用新窗口打开进行游玩。</p>
          </div>
          <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">开始游戏</a>
        </div>
      `}
      ${renderResourceActions([url], '游戏')}
    </section>
  `;
}

function isEmbeddableGameUrl(url) {
  const text = String(url || '');
  if (/\/\/(?:www\.)?yikm\.net\//i.test(text)) return false;
  return true;
}

function renderToolLinkPayload(payload, links) {
  const title = payload.title || state.currentBook?.info?.name || state.currentBook?.item?.name || '工具';
  const text = payload.text || payload.content || '可打开以下资源继续操作。';
  return `
    <section class="service-card tool-service">
      <div class="service-card-head">
        <div>
          <span class="type-badge">工具资源</span>
          <h3>${esc(title)}</h3>
        </div>
      </div>
      <div class="chapter-meta">${esc(text)}</div>
      ${renderResourceActions(links, '资源')}
    </section>
  `;
}

function cleanMediaUrls(urls, type) {
  const list = [...new Set((urls || []).filter(Boolean).map(url => String(url).split(',{')[0].trim()))];
  return list.filter(url => {
    if (!/^https?:\/\//i.test(url)) return false;
    if (type === 'images') return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url);
    if (type === 'audio') return /\.(mp3|m4a|aac|flac|wav|ogg)(\?|$)/i.test(url) || /(audio|music|stream|media|cdn|oss|cos)/i.test(url);
    if (type === 'video') return isDirectVideoUrl(url) || isVideoPageUrl(url);
    return !/(search|detail|rank|comment|module|novel|api\/|\/api)/i.test(url);
  });
}

function isDirectVideoUrl(url) {
  return /\.(mp4|m3u8|webm|mov)(\?|$)/i.test(String(url || ''));
}

function isHlsVideoUrl(url) {
  return /\.m3u8(?:[?#].*)?$/i.test(String(url || ''));
}

function isVideoPageUrl(url) {
  const text = String(url || '');
  if (!/^https?:\/\//i.test(text)) return false;
  if (/(search|detail|voddetail|comment|rank|module|novel)\b/i.test(text)) return false;
  return /(player|play|m3u8|video|stream|media|vod|jx\.|\/jx\/|iframe|pframe)/i.test(text);
}

function proxyImageUrl(url, referer = '', retryKey = '') {
  const clean = String(url || '').split(',{')[0].trim();
  return '/api/content/image?url=' + encodeURIComponent(clean)
    + (referer ? '&referer=' + encodeURIComponent(referer) : '')
    + (retryKey ? '&retry=' + encodeURIComponent(retryKey) : '');
}

function proxyHlsUrl(url, referer = '') {
  const clean = String(url || '').split(',{')[0].trim();
  return '/api/content/hls?url=' + encodeURIComponent(clean) + (referer ? '&referer=' + encodeURIComponent(referer) : '');
}

function mountHlsPlayers(root = document) {
  const videos = root.querySelectorAll('video[data-hls-src]');
  videos.forEach(video => {
    const src = video.dataset.hlsSrc;
    if (!src || video.dataset.hlsMounted === '1') return;
    video.dataset.hlsMounted = '1';
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return;
    }
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(src);
      hls.attachMedia(video);
      video._hls = hls;
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data || !data.fatal) return;
        const error = document.createElement('div');
        error.className = 'error';
        error.textContent = '视频播放失败：' + (data.details || data.type || 'hls_error');
        video.insertAdjacentElement('afterend', error);
        hls.destroy();
      });
      return;
    }
    const error = document.createElement('div');
    error.className = 'error';
    error.textContent = '当前浏览器缺少 HLS 播放支持';
    video.insertAdjacentElement('afterend', error);
  });
}

function retryComicImage(img) {
  if (!img || img.dataset.retrying === '1') return;
  const original = img.dataset.originalSrc || img.src || '';
  const referer = img.dataset.referer || '';
  const retry = Number(img.dataset.retryCount || 0);
  const retrySources = [
    proxyImageUrl(original, referer, `r${retry + 1}-${Date.now()}`),
    proxyImageUrl(original, '', `noref-${retry + 1}-${Date.now()}`),
    original,
    proxyImageUrl(original, referer || original, `final-${retry + 1}-${Date.now()}`),
  ].filter(Boolean);
  const nextSrc = retrySources[retry];

  if (nextSrc && retry < retrySources.length) {
    img.dataset.retrying = '1';
    img.dataset.retryCount = String(retry + 1);
    img.classList.add('is-retrying');
    setTimeout(() => {
      img.dataset.retrying = '0';
      img.src = nextSrc;
    }, Math.min(400 + retry * 700, 2500));
    return;
  }

  img.replaceWith(imageLoadFallback(img));
}

function retryComicImageFromButton(button) {
  const box = button.closest('.comic-image-fallback');
  if (!box) return;
  const original = box.dataset.originalSrc || '';
  const referer = box.dataset.referer || '';
  const index = Number(box.dataset.pageIndex || 0);
  const img = document.createElement('img');
  img.className = 'comic-page-image';
  img.src = proxyImageUrl(original, referer, `manual-${Date.now()}`);
  img.dataset.originalSrc = original;
  img.dataset.referer = referer;
  img.dataset.pageIndex = String(index);
  img.dataset.retryCount = '0';
  img.alt = `漫画页 ${index + 1}`;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.onload = function() { this.classList.remove('is-retrying'); };
  img.onerror = function() { retryComicImage(this); };
  box.replaceWith(img);
}

function imageLoadFallback(img) {
  const div = document.createElement('div');
  div.className = 'comic-image-fallback error';
  div.dataset.originalSrc = img.dataset.originalSrc || img.src || '';
  div.dataset.referer = img.dataset.referer || '';
  div.dataset.pageIndex = img.dataset.pageIndex || '0';
  div.innerHTML = `
    <strong>图片加载失败</strong>
    <span>已自动重试多次，可以手动再试一次。</span>
    <button class="btn" type="button" onclick="retryComicImageFromButton(this)">重新加载</button>
  `;
  return div;
}

function renderDownloadLinks(urls) {
  return renderResourceActions(urls, '资源');
}

function renderResourceActions(urls, label = '资源') {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return '';
  return `<div class="resource-actions">${list.map((url, index) => `
    <div class="resource-action">
      <span>${esc(label)} ${index + 1}</span>
      <button class="btn" data-action="copy-resource" data-url="${esc(url)}" type="button">复制地址</button>
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">打开</a>
    </div>
  `).join('')}</div>`;
}

function extractImageTags(html) {
  return [...String(html || '').matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]).filter(Boolean);
}

function sanitizeMediaHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+=["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

function sanitizeBasicHtml(html) {
  return sanitizeMediaHtml(html)
    .replace(/<(?!\/?(p|br|img|a|strong|em|span|div|pre|code)\b)[^>]+>/gi, '')
    .replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"');
}
