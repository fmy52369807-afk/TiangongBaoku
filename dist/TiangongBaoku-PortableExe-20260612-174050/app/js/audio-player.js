function audioCoverFallback() {
  const div = document.createElement('div');
  div.className = 'audio-art placeholder';
  div.textContent = '听';
  return div;
}

function openAudioPlayer() {
  const player = state.audioPlayer;
  if (!player || !player.mediaUrl) {
    toast('没有可播放的音频');
    return;
  }
  const kind = player.kind === 'music' ? '音乐' : '听书';
  els.audioFloat.innerHTML = `
    <div class="audio-float-shell">
      <div class="audio-float-head">
        <div class="audio-float-title">
          <span>${esc(kind)}</span>
          <strong>${esc(player.title || '音频节目')}</strong>
        </div>
        <button class="btn icon" data-audio-action="close" type="button" title="关闭">×</button>
      </div>
      <div class="audio-float-body">
        ${player.cover ? `<img class="audio-float-cover" src="${esc(player.cover)}" alt="${esc(player.album || player.title)}" onerror="this.replaceWith(audioFloatCoverFallback())">` : '<div class="audio-float-cover placeholder">听</div>'}
        <div class="audio-float-main">
          <div class="audio-float-meta">
            <strong>${esc(player.title || '音频节目')}</strong>
            <span>${esc(player.album || kind)}</span>
          </div>
          <audio controls autoplay src="${esc(player.mediaUrl)}"></audio>
          ${renderResourceActions(player.links || [player.mediaUrl], '音频')}
        </div>
      </div>
    </div>
  `;
  els.audioFloat.classList.add('show');
}

function audioFloatCoverFallback() {
  const div = document.createElement('div');
  div.className = 'audio-float-cover placeholder';
  div.textContent = '听';
  return div;
}

function closeAudioPlayer() {
  els.audioFloat.classList.remove('show');
  els.audioFloat.innerHTML = '';
}
