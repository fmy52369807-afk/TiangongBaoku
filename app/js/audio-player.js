function audioCoverFallback() {
  const div = document.createElement('div');
  div.className = 'audio-art placeholder';
  div.textContent = '听';
  return div;
}

function audioFloatCoverFallback() {
  const div = document.createElement('div');
  div.className = 'audio-disc-cover placeholder';
  div.textContent = '听';
  return div;
}

function normalizeAudioTrack(track = {}) {
  const mediaUrl = String(track.mediaUrl || '').trim();
  return {
    mediaUrl,
    originalUrl: track.originalUrl || mediaUrl,
    title: track.title || '音频节目',
    album: track.album || (track.kind === 'music' ? '音乐' : '听书'),
    cover: track.cover || '',
    links: track.links && track.links.length ? track.links : (mediaUrl ? [mediaUrl] : []),
    kind: track.kind || 'audio',
    hls: Boolean(track.hls) || /\.m3u8(?:[?#].*)?$/i.test(mediaUrl),
  };
}

function saveAudioPlaylist() {
  localStorage.setItem('yuedu_audio_playlist', JSON.stringify(state.audioPlaylist || []));
}

function findAudioTrackIndex(track) {
  const mediaUrl = track?.mediaUrl;
  if (!mediaUrl) return -1;
  return (state.audioPlaylist || []).findIndex(item => item.mediaUrl === mediaUrl);
}

function addAudioToPlaylist(track = state.audioPlayer) {
  const item = normalizeAudioTrack(track);
  if (!item.mediaUrl) {
    toast('没有可加入歌单的音频');
    return;
  }
  const existing = findAudioTrackIndex(item);
  if (existing >= 0) {
    toast('已在歌单中');
  } else {
    state.audioPlaylist = [item, ...(state.audioPlaylist || [])].slice(0, 100);
    saveAudioPlaylist();
    toast('已加入歌单');
  }
  if (els.audioFloat.classList.contains('show')) renderAudioFloat(true);
}

function removeAudioFromPlaylist(index) {
  if (!Number.isInteger(index) || index < 0) return;
  state.audioPlaylist.splice(index, 1);
  saveAudioPlaylist();
  renderAudioFloat(true);
}

function clearAudioPlaylist() {
  state.audioPlaylist = [];
  saveAudioPlaylist();
  renderAudioFloat(true);
  toast('歌单已清空');
}

function getPlayablePlaylistIndex(preferredIndex = 0) {
  const playlist = state.audioPlaylist || [];
  if (!playlist.length) return -1;
  const currentIndex = findAudioTrackIndex(normalizeAudioTrack(state.audioPlayer));
  if (currentIndex >= 0) return currentIndex;
  return Math.min(Math.max(preferredIndex, 0), playlist.length - 1);
}

function openAudioPlaylist() {
  if (!(state.audioPlaylist || []).length) {
    toast('歌单为空，先在音频详情里加入歌单');
    return;
  }
  const index = getPlayablePlaylistIndex(0);
  state.audioPlayer = normalizeAudioTrack(state.audioPlaylist[index]);
  updateMediaSession(state.audioPlayer);
  renderAudioFloat();
  els.audioFloat.classList.add('show');
  els.audioFloat.classList.add('audio-playlist-opened');
  if (!els.audioFloat.classList.contains('audio-fullscreen')) restoreAudioFloatPosition();
}

function playAudioPlaylist() {
  const index = getPlayablePlaylistIndex(0);
  if (index < 0) {
    toast('歌单为空，先加入音频');
    return;
  }
  playAudioTrack(index);
}

function playAudioTrack(index) {
  const track = state.audioPlaylist[index];
  if (!track) return;
  state.audioPlayer = normalizeAudioTrack(track);
  openAudioPlayer(state.audioPlayer);
}

function playNextAudioTrack() {
  const current = normalizeAudioTrack(state.audioPlayer);
  const index = findAudioTrackIndex(current);
  const next = index >= 0 ? state.audioPlaylist[index + 1] : null;
  if (next) playAudioTrack(index + 1);
}

function openAudioPlayer(track = state.audioPlayer) {
  const player = normalizeAudioTrack(track);
  if (!player.mediaUrl) {
    toast('没有可播放的音频');
    return;
  }
  state.audioPlayer = player;
  updateMediaSession(player);
  renderAudioFloat();
  els.audioFloat.classList.add('show');
  if (!els.audioFloat.classList.contains('audio-fullscreen')) restoreAudioFloatPosition();
}

function renderAudioFloat(preservePlayback = false) {
  const player = normalizeAudioTrack(state.audioPlayer);
  const currentAudio = preservePlayback ? els.audioFloat.querySelector('audio') : null;
  const previousSrc = currentAudio?.currentSrc || currentAudio?.src || '';
  const previousTime = currentAudio?.currentTime || 0;
  const wasPaused = currentAudio ? currentAudio.paused : false;
  const kind = player.kind === 'music' ? '音乐' : '听书';
  const playlist = state.audioPlaylist || [];
  const activeIndex = findAudioTrackIndex(player);
  const full = els.audioFloat.classList.contains('audio-fullscreen');
  els.audioFloat.innerHTML = `
    <div class="audio-float-shell">
      <div class="audio-aura" aria-hidden="true"></div>
      <div class="audio-float-head" data-audio-drag-handle="1">
        <div class="audio-float-title">
          <span>${esc(kind)} · 后台播放</span>
          <strong>${esc(player.title)}</strong>
        </div>
        <button class="btn" data-audio-action="add-current" type="button">加入歌单</button>
        <button class="btn icon" data-audio-action="toggle-fullscreen" type="button" title="${full ? '退出全屏' : '全屏'}">${full ? '↙' : '⛶'}</button>
        <button class="btn icon" data-audio-action="close" type="button" title="关闭">×</button>
      </div>
      <div class="audio-float-body">
        <div class="audio-disc-wrap">
          <div class="audio-disc">
            <div class="audio-disc-ring"></div>
            ${player.cover ? `<img class="audio-disc-cover" src="${esc(player.cover)}" alt="${esc(player.album || player.title)}" onerror="this.replaceWith(audioFloatCoverFallback())">` : '<div class="audio-disc-cover placeholder">听</div>'}
          </div>
        </div>
        <div class="audio-float-main">
          <div class="audio-float-meta">
            <span>${esc(kind)}</span>
            <strong>${esc(player.title)}</strong>
            <em>${esc(player.album || kind)}</em>
          </div>
          <audio class="audio-float-control" controls autoplay ${player.hls ? `data-hls-src="${esc(player.mediaUrl)}"` : `src="${esc(player.mediaUrl)}"`} onplay="this.closest('.audio-float-shell')?.classList.add('is-playing')" onpause="this.closest('.audio-float-shell')?.classList.remove('is-playing')" onended="playNextAudioTrack()"></audio>
          <div class="audio-float-actions">
            ${renderResourceActions(player.links || [player.mediaUrl], '音频')}
          </div>
        </div>
        <aside class="audio-playlist">
          <div class="audio-playlist-head">
            <strong>歌单</strong>
            <div class="audio-playlist-tools">
              <button class="btn ghost" data-audio-action="play-playlist" type="button" ${playlist.length ? '' : 'disabled'}>播放歌单</button>
              <button class="btn ghost" data-audio-action="clear-playlist" type="button" ${playlist.length ? '' : 'disabled'}>清空</button>
            </div>
          </div>
          <div class="audio-playlist-list">
            ${playlist.length ? playlist.map((item, index) => `
              <div class="audio-playlist-item ${index === activeIndex ? 'active' : ''}">
                <button class="audio-playlist-main" data-audio-action="play-index" data-index="${index}" type="button">
                  <span>${esc(item.title || '音频节目')}</span>
                  <em>${esc(item.album || (item.kind === 'music' ? '音乐' : '听书'))}</em>
                </button>
                <button class="btn icon" data-audio-action="remove-index" data-index="${index}" type="button" title="移除">×</button>
              </div>
            `).join('') : '<div class="empty compact">暂无曲目，点击“加入歌单”保存当前音频。</div>'}
          </div>
        </aside>
      </div>
    </div>
  `;
  mountAudioDragHandle();
  if (typeof mountHlsPlayers === 'function') mountHlsPlayers(els.audioFloat);
  const nextAudio = els.audioFloat.querySelector('audio');
  if (nextAudio && previousSrc && previousSrc === nextAudio.src) {
    nextAudio.currentTime = previousTime;
    if (wasPaused) nextAudio.pause();
    else nextAudio.play().catch(() => {});
  }
}

function toggleAudioFullscreen() {
  const isFull = els.audioFloat.classList.toggle('audio-fullscreen');
  if (isFull) {
    els.audioFloat.dataset.prevLeft = els.audioFloat.style.left || '';
    els.audioFloat.dataset.prevTop = els.audioFloat.style.top || '';
    els.audioFloat.dataset.prevRight = els.audioFloat.style.right || '';
    els.audioFloat.dataset.prevBottom = els.audioFloat.style.bottom || '';
    els.audioFloat.style.left = '';
    els.audioFloat.style.top = '';
    els.audioFloat.style.right = '';
    els.audioFloat.style.bottom = '';
  } else {
    restoreAudioFloatPosition();
  }
  renderAudioFloat(true);
}

function restoreAudioFloatPosition() {
  if (els.audioFloat.dataset.prevLeft || els.audioFloat.dataset.prevTop) {
    els.audioFloat.style.left = els.audioFloat.dataset.prevLeft || '';
    els.audioFloat.style.top = els.audioFloat.dataset.prevTop || '';
    els.audioFloat.style.right = els.audioFloat.dataset.prevRight || '';
    els.audioFloat.style.bottom = els.audioFloat.dataset.prevBottom || '';
  }
}

function mountAudioDragHandle() {
  const handle = els.audioFloat.querySelector('[data-audio-drag-handle]');
  if (!handle) return;
  handle.onpointerdown = event => {
    if (event.target.closest('button,a,input,select,audio')) return;
    if (els.audioFloat.classList.contains('audio-fullscreen')) return;
    const rect = els.audioFloat.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    handle.setPointerCapture?.(event.pointerId);
    els.audioFloat.classList.add('dragging');

    const move = moveEvent => {
      const width = els.audioFloat.offsetWidth;
      const height = els.audioFloat.offsetHeight;
      const left = Math.min(Math.max(8, moveEvent.clientX - offsetX), window.innerWidth - width - 8);
      const top = Math.min(Math.max(8, moveEvent.clientY - offsetY), window.innerHeight - height - 8);
      els.audioFloat.style.left = `${left}px`;
      els.audioFloat.style.top = `${top}px`;
      els.audioFloat.style.right = 'auto';
      els.audioFloat.style.bottom = 'auto';
      els.audioFloat.dataset.prevLeft = els.audioFloat.style.left;
      els.audioFloat.dataset.prevTop = els.audioFloat.style.top;
      els.audioFloat.dataset.prevRight = els.audioFloat.style.right;
      els.audioFloat.dataset.prevBottom = els.audioFloat.style.bottom;
    };

    const up = () => {
      els.audioFloat.classList.remove('dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
}

function updateMediaSession(player) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: player.title || '音频节目',
    artist: player.album || (player.kind === 'music' ? '音乐' : '听书'),
    album: player.kind === 'music' ? '天工宝库' : '天工宝库听书',
    artwork: player.cover ? [{ src: player.cover, sizes: '512x512', type: 'image/png' }] : [],
  });
}

function closeAudioPlayer() {
  const audio = els.audioFloat.querySelector('audio');
  if (audio) audio.pause();
  els.audioFloat.classList.remove('show', 'audio-fullscreen', 'dragging', 'audio-playlist-opened');
  els.audioFloat.innerHTML = '';
}
