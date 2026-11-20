'use strict';
/* ================= helpers ================= */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const AV_COLORS = ['#ef476f', '#f78c6b', '#e9a13b', '#06d6a0', '#118ab2', '#7b61c9', '#e23b4e', '#3a9ad9'];
function avColor(key) { let h = 0; const s = String(key || '?'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
function avatarHTML(name, username, size) { return `<span class="avatar ${size || 'md'}" style="background:${avColor(username || name)}">${esc(initials(name))}</span>`; }
function timeAgo(iso) {
  const t = new Date(String(iso).replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z')).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.7C6.4 17 3 13.6 3 9.9 3 7.2 5 5 7.6 5c1.7 0 3.4 1 4.4 2.4C13 6 14.7 5 16.4 5 19 5 21 7.2 21 9.9c0 3.7-3.4 7.1-9 10.8z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.7C6.4 17 3 13.6 3 9.9 3 7.2 5 5 7.6 5c1.7 0 3.4 1 4.4 2.4C13 6 14.7 5 16.4 5 19 5 21 7.2 21 9.9c0 3.7-3.4 7.1-9 10.8z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5.5 20 12l-7 6.5v-4C7 14.5 4.5 16 3 18c0-6 3.5-9.5 10-10z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v11.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>',
};

/* ================= state ================= */
let me = null;
let songsCache = null;
let videosCache = [];
let soundOn = localStorage.getItem('solkin_sound') === '1';
let clipSongOverrides = {};
try { clipSongOverrides = JSON.parse(localStorage.getItem('solkin_clip_songs') || '{}'); } catch (e) { clipSongOverrides = {}; }

/* ================= auth ================= */
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('#tabLogin').classList.toggle('on', mode === 'login');
  $('#tabSignup').classList.toggle('on', mode === 'signup');
  $('#fName').classList.toggle('hidden', mode === 'login');
  $('#fYoung').classList.toggle('hidden', mode === 'login');
  $('#authSubmit').textContent = mode === 'login' ? 'Log in' : 'Sign up 🎉';
  $('#inPass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('#authErr').classList.add('hidden');
}
$('#tabLogin').addEventListener('click', () => setAuthMode('login'));
$('#tabSignup').addEventListener('click', () => setAuthMode('signup'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#authErr'); err.classList.add('hidden');
  const btn = $('#authSubmit'); btn.disabled = true;
  try {
    let data;
    if (authMode === 'signup') {
      data = await api('/api/signup', { method: 'POST', body: JSON.stringify({ displayName: $('#inName').value, username: $('#inUser').value, password: $('#inPass').value, under18: $('#inYoung').checked }) });
    } else {
      data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#inUser').value, password: $('#inPass').value }) });
    }
    me = data.user;
    enterApp();
    toast(authMode === 'signup' ? 'Welcome to Solkin Chat! 🎉' : 'Welcome back! 👋');
  } catch (ex) {
    err.textContent = ex.message; err.classList.remove('hidden');
  } finally { btn.disabled = false; }
});

/* ================= nav ================= */
function showView(name) {
  ['feed', 'videos', 'people', 'friends', 'profile'].forEach((v) => $('#view-' + v).classList.toggle('hidden', v !== name));
  $$('.bottomnav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === name));
  if (name === 'videos') { ensureVideos(); resumeCurrentSlide(); }
  else pauseAllSlides();
  if (name === 'people') loadPeople();
  if (name === 'friends') loadFriends();
  if (name === 'profile') loadProfile();
  window.scrollTo(0, 0);
}
$$('.bottomnav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.nav)));

function enterApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#meAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'sm');
  $('#meName').textContent = me.displayName.split(' ')[0];
  $('#composerAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'md');
  loadFeed();
  showView('feed');
}

/* ================= feed ================= */
function songForPost(p) { return p.song || null; }
function postCardHTML(p) {
  const a = p.author || {};
  const badge = a.isProtected ? '<span class="badge">🛡️ Protected</span>' : '';
  let media = '';
  if (p.mediaUrl && p.mediaType === 'image') media = `<div class="post-media"><img src="${esc(p.mediaUrl)}" alt="photo" loading="lazy"></div>`;
  else if (p.mediaUrl && p.mediaType === 'video') {
    const song = songForPost(p);
    media = `<div class="post-media"><video src="${esc(p.mediaUrl)}" playsinline loop controls preload="metadata" ${song ? 'muted' : ''} data-post-video="${p.id}"></video></div>` +
      (song ? `<div class="post-song"><span class="pill">🎵 ${esc(song.title)} — ${esc(song.artist)}</span></div><audio data-post-audio="${p.id}" src="${esc(song.src)}" loop preload="none"></audio>` : '');
  }
  return `<article class="card" id="post-${p.id}">
    <div class="post-head">${avatarHTML(a.displayName, a.username, 'md')}
      <div><div class="nm">${esc(a.displayName)}${badge}</div><div class="sub">@${esc(a.username)} · ${timeAgo(p.createdAt)}</div></div>
    </div>
    ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ''}
    ${media}
    <div class="post-actions">
      <button data-act="like" data-id="${p.id}" class="${p.likedByMe ? 'liked' : ''}">${p.likedByMe ? ICON.heartFill : ICON.heart}<span>Like${p.likeCount ? ' · ' + p.likeCount : ''}</span></button>
      <button data-act="comment" data-id="${p.id}">${ICON.comment}<span>Comment${p.commentCount ? ' · ' + p.commentCount : ''}</span></button>
      <button data-act="share" data-id="${p.id}">${ICON.share}<span>Share</span></button>
      <button data-act="report" data-id="${p.id}">${ICON.flag}<span>Report</span></button>
    </div>
    <div class="comments hidden" id="comments-${p.id}"></div>
  </article>`;
}
function wirePostMedia(container) {
  $$('video[data-post-video]', container).forEach((v) => {
    const audio = container.querySelector(`audio[data-post-audio="${v.dataset.postVideo}"]`);
    if (!audio) return;
    v.addEventListener('play', () => { audio.play().catch(() => {}); });
    v.addEventListener('pause', () => audio.pause());
    v.addEventListener('seeked', () => { if (audio.duration) audio.currentTime = v.currentTime % audio.duration; });
  });
}
async function loadFeed() {
  try {
    const data = await api('/api/posts');
    const list = $('#feedList');
    list.innerHTML = data.posts.length ? data.posts.map(postCardHTML).join('') : '<div class="card empty">Nothing here yet — be the first to post! 🎈</div>';
    wirePostMedia(list);
  } catch (e) { toast(e.message); }
}

/* feed actions (event delegation) */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = +btn.dataset.id, act = btn.dataset.act;
  try {
    if (act === 'like') {
      const r = await api(`/api/posts/${id}/like`, { method: 'POST', body: '{}' });
      $$(`[data-act="like"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('liked', r.liked); b.innerHTML = `${r.liked ? ICON.heartFill : ICON.heart}<span>Like${r.likeCount ? ' · ' + r.likeCount : ''}</span>`; });
    } else if (act === 'comment') {
      openCommentsSheet({ kind: 'post', id });
    } else if (act === 'share') {
      const link = location.origin + '/#post-' + id;
      try { await navigator.clipboard.writeText(link); toast('Link copied — send it to a friend! 🔗'); }
      catch (ex) { window.prompt('Copy this link:', link); }
    } else if (act === 'report') {
      openReportSheet(id);
    }
  } catch (ex) { toast(ex.message); }
});

/* ================= composer ================= */
let pendingFile = null; // {file, kind:'image'|'video', url}
let composerSong = null;
function setPendingFile(file, kind) {
  clearPendingFile();
  pendingFile = { file, kind, url: URL.createObjectURL(file) };
  const pv = $('#mediaPreview');
  pv.innerHTML = (kind === 'image' ? `<img src="${pendingFile.url}">` : `<video src="${pendingFile.url}" controls playsinline></video>`) + '<button class="rm" id="rmMedia" type="button" aria-label="Remove">✕</button>';
  pv.classList.remove('hidden');
  $('#rmMedia').addEventListener('click', clearPendingFile);
}
function clearPendingFile() {
  if (pendingFile) URL.revokeObjectURL(pendingFile.url);
  pendingFile = null;
  $('#mediaPreview').innerHTML = '';
  $('#mediaPreview').classList.add('hidden');
}
function renderComposerSong() {
  $('#composerSong').innerHTML = composerSong ? `<span class="song-tag">🎵 ${esc(composerSong.title)} <button id="rmSong" type="button" aria-label="Remove song">✕</button></span>` : '';
  const rm = $('#rmSong'); if (rm) rm.addEventListener('click', () => { composerSong = null; renderComposerSong(); });
}
$('#btnPhoto').addEventListener('click', () => $('#filePhoto').click());
$('#btnVideoFile').addEventListener('click', () => $('#fileVideo').click());
$('#filePhoto').addEventListener('change', (e) => { if (e.target.files[0]) setPendingFile(e.target.files[0], 'image'); e.target.value = ''; });
$('#fileVideo').addEventListener('change', (e) => { if (e.target.files[0]) setPendingFile(e.target.files[0], 'video'); e.target.value = ''; });
$('#btnMusic').addEventListener('click', () => {
  if (pendingFile && pendingFile.kind !== 'video') { toast('Pick a video first, then add music 🎬'); return; }
  openMusicPicker({ type: 'composer' });
});
$('#btnPost').addEventListener('click', async () => {
  const text = $('#composerText').value.trim();
  if (!text && !pendingFile) { toast("Write something or add a picture first 🙂"); return; }
  const btn = $('#btnPost'); btn.disabled = true; btn.textContent = 'Posting…';
  try {
    let data;
    if (pendingFile) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('media', pendingFile.file);
      if (composerSong && pendingFile.kind === 'video') fd.append('songId', composerSong.id);
      const res = await fetch('/api/posts', { method: 'POST', body: fd });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Post failed.');
    } else {
      data = await api('/api/posts', { method: 'POST', body: JSON.stringify({ text, songId: null }) });
    }
    $('#composerText').value = '';
    clearPendingFile(); composerSong = null; renderComposerSong();
    const list = $('#feedList');
    const empty = list.querySelector('.empty'); if (empty) empty.remove();
    list.insertAdjacentHTML('afterbegin', postCardHTML(data.post));
    wirePostMedia(list);
    toast('Posted! 🎉');
  } catch (ex) { toast(ex.message); }
  finally { btn.disabled = false; btn.textContent = 'Post'; }
});

/* ================= videos ================= */
let videosLoaded = false;
let currentSlide = 0;
function clipSong(v) {
  const override = clipSongOverrides[v.id];
  if (override && songsCache) { const s = songsCache.find((x) => x.id === override); if (s) return s; }
  return v.song || null;
}
function slideHTML(v, i) {
  const song = clipSong(v);
  return `<div class="slide" data-slide="${i}">
    <div class="vid">
      <video src="${esc(v.src)}" playsinline loop muted preload="metadata" data-vid="${v.id}"></video>
      ${song ? `<audio data-clip-audio="${v.id}" src="${esc(song.src)}" loop preload="none"></audio>` : ''}
      <div class="cap"><span class="cat">${esc(v.cat)}</span><br>${esc(v.caption)}</div>
    </div>
    <div class="side-col">
      <div class="who">${avatarHTML(v.creator, v.creator, 'md')}<span class="nm">${esc(v.creator.split(' ')[0])}</span>
      <button class="follow-btn ${v.following ? 'following' : ''}" data-vfollow="${v.id}" type="button">${v.following ? 'Following' : 'Follow'}</button></div>
      <button class="side-act ${v.likedByMe ? 'liked' : ''}" data-vlike="${v.id}" type="button">${v.likedByMe ? ICON.heartFill : ICON.heart}<span class="cnt">${fmtCount(v.likeCount)}</span></button>
      <button class="side-act" data-vcomment="${v.id}" type="button">${ICON.comment}<span class="cnt">${v.commentCount || ''}</span></button>
      <button class="side-act" data-vmusic="${v.id}" type="button">${ICON.note}<span class="cnt">${song ? esc(shortTitle(song.title)) : 'Add'}</span></button>
    </div>
  </div>`;
}
function fmtCount(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n || 0); }
function shortTitle(t) { return t.length > 9 ? t.slice(0, 8) + '…' : t; }

async function ensureVideos() {
  if (videosLoaded) return;
  videosLoaded = true;
  try {
    if (!songsCache) { const s = await api('/api/songs'); songsCache = s.songs; }
    const data = await api('/api/videos');
    videosCache = data.videos;
    renderPager();
  } catch (e) { toast(e.message); }
}
function renderPager() {
  const pager = $('#pager');
  pager.innerHTML = videosCache.map(slideHTML).join('');
  updatePagerUI();
  requestAnimationFrame(() => setSlide(0, false));
}
function slideEls() { return $$('#pager .slide'); }
function slideVideo(i) { const s = slideEls()[i]; return s ? s.querySelector('video') : null; }
function slideAudio(i) { const s = slideEls()[i]; return s ? s.querySelector('audio') : null; }

function applySoundToSlide(i) {
  const v = videosCache[i]; if (!v) return;
  const vid = slideVideo(i), aud = slideAudio(i);
  if (!vid) return;
  const song = clipSong(v);
  if (!soundOn) { vid.muted = true; if (aud) aud.pause(); return; }
  if (song) { // a song IS this clip's sound
    vid.muted = true;
    if (aud) { aud.muted = false; aud.volume = 1; if (!vid.paused) { syncAudio(vid, aud); aud.play().catch(() => {}); } }
  } else if (v.hasOwnAudio) {
    vid.muted = false; vid.volume = 1; if (aud) aud.pause();
  } else { vid.muted = true; if (aud) aud.pause(); }
}
function syncAudio(vid, aud) {
  if (aud.duration && Math.abs(aud.currentTime - (vid.currentTime % aud.duration)) > 0.6) {
    aud.currentTime = vid.currentTime % aud.duration;
  }
}
function playSlide(i) {
  const vid = slideVideo(i); if (!vid) return;
  vid.play().then(() => applySoundToSlide(i)).catch(() => { vid.muted = true; vid.play().catch(() => {}); });
  applySoundToSlide(i);
}
function pauseSlide(i) {
  const vid = slideVideo(i), aud = slideAudio(i);
  if (vid) vid.pause();
  if (aud) aud.pause();
}
function pauseAllSlides() { slideEls().forEach((_, i) => pauseSlide(i)); }
function resumeCurrentSlide() { if (videosLoaded && !$('#view-videos').classList.contains('hidden')) playSlide(currentSlide); }
function setSlide(i, scroll) {
  const n = videosCache.length; if (!n) return;
  i = Math.max(0, Math.min(n - 1, i));
  if (i !== currentSlide) pauseSlide(currentSlide);
  currentSlide = i;
  if (scroll !== false) { const pager = $('#pager'); pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' }); }
  updatePagerUI();
  playSlide(i);
}
function updatePagerUI() {
  $('#pgCount').textContent = (currentSlide + 1) + ' / ' + Math.max(1, videosCache.length);
  $('#pgPrev').disabled = currentSlide <= 0;
  $('#pgNext').disabled = currentSlide >= videosCache.length - 1;
  renderSoundPills();
}
function renderSoundPills() {
  const label = soundOn ? '🔊 Sound ON' : '🔇 Sound OFF';
  const pill = $('#soundPill'); pill.textContent = label; pill.classList.toggle('on', soundOn);
  const vp = $('#viewerSound'); vp.textContent = label; vp.classList.toggle('on', soundOn);
}
function setSound(on) {
  soundOn = on;
  localStorage.setItem('solkin_sound', on ? '1' : '0');
  renderSoundPills();
  applySoundToSlide(currentSlide);
  if (!$('#viewer').classList.contains('hidden')) applyViewerSound();
  toast(on ? 'Sound on 🔊' : 'Sound off 🔇');
}
$('#soundPill').addEventListener('click', () => setSound(!soundOn));
$('#viewerSound').addEventListener('click', () => setSound(!soundOn));
$('#pgPrev').addEventListener('click', () => setSlide(currentSlide - 1));
$('#pgNext').addEventListener('click', () => setSlide(currentSlide + 1));
let scrollTick = null;
$('#pager').addEventListener('scroll', () => {
  clearTimeout(scrollTick);
  scrollTick = setTimeout(() => {
    const pager = $('#pager');
    const i = Math.round(pager.scrollLeft / pager.clientWidth);
    if (i !== currentSlide && videosCache[i]) { pauseSlide(currentSlide); currentSlide = i; updatePagerUI(); playSlide(i); }
  }, 90);
});
/* tap a slide video -> full-screen viewer; side-column actions */
$('#pager').addEventListener('click', async (e) => {
  const vid = e.target.closest('video[data-vid]');
  if (vid) { openViewer(currentSlide); return; }
  const like = e.target.closest('[data-vlike]');
  const follow = e.target.closest('[data-vfollow]');
  const comment = e.target.closest('[data-vcomment]');
  const music = e.target.closest('[data-vmusic]');
  try {
    if (like) {
      const id = like.dataset.vlike;
      const r = await api(`/api/videos/${id}/like`, { method: 'POST', body: '{}' });
      const v = videosCache.find((x) => x.id === id); if (v) { v.likedByMe = r.liked; v.likeCount = r.likeCount; }
      like.classList.toggle('liked', r.liked);
      like.innerHTML = `${r.liked ? ICON.heartFill : ICON.heart}<span class="cnt">${fmtCount(r.likeCount)}</span>`;
    } else if (follow) {
      const id = follow.dataset.vfollow;
      const r = await api(`/api/videos/${id}/follow`, { method: 'POST', body: '{}' });
      videosCache.forEach((v) => { if (v.creator === r.creator) v.following = r.following; });
      $$(`[data-vfollow]`).forEach((b) => {
        const v = videosCache.find((x) => x.id === b.dataset.vfollow);
        if (v && v.creator === r.creator) { b.classList.toggle('following', r.following); b.textContent = r.following ? 'Following' : 'Follow'; }
      });
      toast(r.following ? 'Following ' + r.creator + ' ⭐' : 'Unfollowed');
    } else if (comment) {
      openCommentsSheet({ kind: 'video', id: comment.dataset.vcomment });
    } else if (music) {
      openMusicPicker({ type: 'video', id: music.dataset.vmusic });
    }
  } catch (ex) { toast(ex.message); }
});

/* ================= full-screen viewer ================= */
let viewerIdx = 0;
function openViewer(i) {
  viewerIdx = i;
  pauseAllSlides();
  $('#viewer').classList.remove('hidden');
  loadViewerClip();
}
function closeViewer() {
  const vv = $('#viewerVideo'); vv.pause(); $('#viewerAudio').pause();
  $('#viewer').classList.add('hidden');
  resumeCurrentSlide();
}
function loadViewerClip() {
  const v = videosCache[viewerIdx]; if (!v) return;
  const vv = $('#viewerVideo'), va = $('#viewerAudio');
  $('#viewerTitle').textContent = v.creator + ' · ' + v.cat;
  vv.src = v.src;
  const song = clipSong(v);
  if (song) { va.src = song.src; } else { va.removeAttribute('src'); va.load(); }
  vv.loop = true;
  vv.play().then(() => applyViewerSound()).catch(() => { vv.muted = true; vv.play().catch(() => {}); applyViewerSound(); });
  $('#viewerPrev').style.visibility = viewerIdx > 0 ? 'visible' : 'hidden';
  $('#viewerNext').style.visibility = viewerIdx < videosCache.length - 1 ? 'visible' : 'hidden';
}
function applyViewerSound() {
  const v = videosCache[viewerIdx]; if (!v) return;
  const vv = $('#viewerVideo'), va = $('#viewerAudio');
  const song = clipSong(v);
  if (!soundOn) { vv.muted = true; va.pause(); return; }
  if (song) { vv.muted = true; va.muted = false; va.volume = 1; if (!vv.paused) { syncAudio(vv, va); va.play().catch(() => {}); } }
  else if (v.hasOwnAudio) { vv.muted = false; vv.volume = 1; va.pause(); }
  else { vv.muted = true; va.pause(); }
}
function viewerGo(d) {
  const n = viewerIdx + d;
  if (n < 0 || n >= videosCache.length) return;
  $('#viewerVideo').pause(); $('#viewerAudio').pause();
  viewerIdx = n;
  loadViewerClip();
}
$('#viewerClose').addEventListener('click', closeViewer);
$('#viewerPrev').addEventListener('click', () => viewerGo(-1));
$('#viewerNext').addEventListener('click', () => viewerGo(1));
$('#viewerVideo').addEventListener('click', () => {
  const vv = $('#viewerVideo');
  if (vv.paused) { vv.play().catch(() => {}); applyViewerSound(); } else { vv.pause(); $('#viewerAudio').pause(); }
});
let touchX = null;
$('#viewer').addEventListener('touchstart', (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
$('#viewer').addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 48) viewerGo(dx < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if ($('#viewer').classList.contains('hidden')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') viewerGo(1);
  if (e.key === 'ArrowLeft') viewerGo(-1);
});

/* ================= sheet (comments / music / report) ================= */
function openSheet(title) { $('#sheetTitle').textContent = title; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); stopPreview(); }
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target === $('#sheet')) closeSheet(); });

async function openCommentsSheet({ kind, id }) {
  openSheet('Comments 💬');
  const body = $('#sheetBody');
  body.innerHTML = '<p class="empty">Loading…</p>';
  const path = kind === 'post' ? `/api/posts/${id}/comments` : `/api/videos/${id}/comments`;
  try {
    const data = await api(path);
    body.innerHTML = `<div id="sheetComments">${data.comments.length ? data.comments.map(commentHTML).join('') : '<p class="empty">No comments yet — say something nice! 🙂</p>'}</div>
      <form class="comment-form" id="sheetCommentForm"><input id="sheetCommentText" maxlength="500" placeholder="Write a comment…"><button type="submit">Send</button></form>`;
    $('#sheetCommentForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = $('#sheetCommentText');
      const text = input.value.trim(); if (!text) return;
      try {
        const r = await api(path, { method: 'POST', body: JSON.stringify({ text }) });
        const box = $('#sheetComments');
        const empty = box.querySelector('.empty'); if (empty) empty.remove();
        box.insertAdjacentHTML('beforeend', commentHTML(r.comment));
        input.value = '';
        if (kind === 'post') loadFeed();
        else { const v = videosCache.find((x) => x.id === id); if (v) v.commentCount = (v.commentCount || 0) + 1; renderPagerSoft(); }
      } catch (ex) { toast(ex.message); }
    });
  } catch (e) { body.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; }
}
function commentHTML(c) {
  const a = c.author || {};
  return `<div class="comment">${avatarHTML(a.displayName, a.username, 'sm')}<div class="bubble"><b>${esc(a.displayName)}</b> ${esc(c.text)}<br><span style="color:var(--muted); font-size:12px">${timeAgo(c.createdAt)}</span></div></div>`;
}
function renderPagerSoft() {
  // refresh side-column counts without losing scroll position
  const pager = $('#pager'); const left = pager.scrollLeft;
  pager.innerHTML = videosCache.map(slideHTML).join('');
  pager.scrollLeft = left;
  playSlide(currentSlide);
}
function openReportSheet(postId) {
  openSheet('Report this post');
  const reasons = ['Spam', 'Mean or hurtful', 'Scam', 'Something else'];
  $('#sheetBody').innerHTML = '<p style="color:var(--muted); margin-top:0">What is wrong with it? We will take a look.</p>' +
    reasons.map((r) => `<button class="btn ghost block" style="margin-bottom:8px" data-reason="${esc(r)}" type="button">${esc(r)}</button>`).join('');
  $$('#sheetBody [data-reason]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason: b.dataset.reason }) });
      closeSheet();
      toast('Thanks — we will take a look. 🛡️');
    } catch (ex) { toast(ex.message); }
  }));
}

/* ================= music picker ================= */
const previewAudio = new Audio();
let previewingId = null;
function stopPreview() { previewAudio.pause(); previewingId = null; $$('.song-row .prev').forEach((b) => (b.textContent = '▶ Hear')); }
const CAT_COLORS = { 'Pop': '#ef476f', 'Hip-Hop': '#7b61c9', 'Chill': '#118ab2', 'Party': '#e23b4e', 'Country': '#e9a13b', 'Rock': '#3a4a6b', 'Feel-good': '#06d6a0' };
let musicTarget = null; // {type:'composer'} | {type:'video', id}
let musicCat = 'All', musicQuery = '';
async function openMusicPicker(target) {
  musicTarget = target;
  if (!songsCache) { const s = await api('/api/songs'); songsCache = s.songs; }
  openSheet(target.type === 'composer' ? 'Add music to your video 🎵' : 'Pick a song for this video 🎵');
  renderMusicPicker();
}
function renderMusicPicker() {
  const cats = ['All'].concat(Array.from(new Set(songsCache.map((s) => s.cat))));
  const list = songsCache.filter((s) => (musicCat === 'All' || s.cat === musicCat) && (s.title + ' ' + s.artist).toLowerCase().includes(musicQuery.toLowerCase()));
  $('#sheetBody').innerHTML = `<input class="search-in" id="musicSearch" placeholder="Search songs…" value="${esc(musicQuery)}">
    <div class="cat-chips">${cats.map((c) => `<button type="button" data-mcat="${esc(c)}" class="${c === musicCat ? 'on' : ''}">${esc(c)}</button>`).join('')}</div>
    <div>${list.length ? list.map((s) => `<div class="song-row">
        <span class="note" style="background:${CAT_COLORS[s.cat] || '#16305e'}">♪</span>
        <span class="grow"><span class="ttl">${esc(s.title)}</span><br><span class="sub">${esc(s.artist)} · ${esc(s.genre)}</span></span>
        <button class="prev" data-prev="${s.id}" type="button">${previewingId === s.id ? '⏸ Stop' : '▶ Hear'}</button>
        <button class="use" data-use="${s.id}" type="button">Use</button>
      </div>`).join('') : '<p class="empty">No songs match that search.</p>'}</div>
    <p style="color:var(--muted); font-size:12px; text-align:center">Free-license music by Kevin MacLeod (incompetech.com)</p>`;
  $('#musicSearch').addEventListener('input', (e) => { musicQuery = e.target.value; renderMusicPicker(); const el = $('#musicSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  $$('#sheetBody [data-mcat]').forEach((b) => b.addEventListener('click', () => { musicCat = b.dataset.mcat; renderMusicPicker(); }));
  $$('#sheetBody [data-prev]').forEach((b) => b.addEventListener('click', () => {
    const s = songsCache.find((x) => x.id === b.dataset.prev);
    if (previewingId === s.id) { stopPreview(); b.textContent = '▶ Hear'; return; }
    stopPreview();
    previewAudio.src = s.src; previewAudio.play().catch(() => toast('Could not play that preview.'));
    previewingId = s.id; b.textContent = '⏸ Stop';
  }));
  $$('#sheetBody [data-use]').forEach((b) => b.addEventListener('click', () => {
    const s = songsCache.find((x) => x.id === b.dataset.use);
    stopPreview(); closeSheet();
    if (!musicTarget) return;
    if (musicTarget.type === 'composer') { composerSong = s; renderComposerSong(); toast('Music added 🎵'); }
    else if (musicTarget.type === 'video') {
      clipSongOverrides[musicTarget.id] = s.id;
      localStorage.setItem('solkin_clip_songs', JSON.stringify(clipSongOverrides));
      const idx = videosCache.findIndex((x) => x.id === musicTarget.id);
      renderPagerSoft();
      if (idx >= 0) { currentSlide = idx; applySoundToSlide(idx); }
      toast('Song set: ' + s.title + ' 🎵');
    }
    musicTarget = null;
  }));
}

/* ================= people & friends ================= */
function personRowHTML(p, actionHTML) {
  const posts = p.postCount != null ? ` · ${p.postCount} post${p.postCount === 1 ? '' : 's'}` : '';
  return `<div class="card person">${avatarHTML(p.displayName, p.username, 'md')}
    <div class="grow"><div class="nm">${esc(p.displayName)}${p.isProtected ? '<span class="badge">🛡️ Protected</span>' : ''}</div><div class="sub">@${esc(p.username)}${posts}</div></div>
    ${actionHTML || ''}</div>`;
}
function friendBtnHTML(p) {
  if (!me || p.id === me.id || p.relationship === 'self') return '<span class="friend-state">You</span>';
  if (p.relationship === 'friends') return '<span class="friend-state ok">Friends ✓</span>';
  if (p.relationship === 'pending_out') return '<span class="friend-state">Requested</span>';
  if (p.relationship === 'pending_in') return `<span class="friend-btns"><button class="btn sm" data-friend="accept" data-req="${p.friendRequestId}" type="button">Accept</button><button class="btn ghost sm" data-friend="decline" data-req="${p.friendRequestId}" type="button">Decline</button></span>`;
  return `<button class="btn red sm" data-friend="add" data-id="${p.id}" type="button">Add Friend</button>`;
}
async function loadPeople() {
  try {
    const data = await api('/api/people');
    $('#peopleList').innerHTML = data.people.map((p) => personRowHTML(p, friendBtnHTML(p))).join('') || '<div class="card empty">No people yet.</div>';
  } catch (e) { toast(e.message); }
}
async function loadFriends() {
  try {
    const data = await api('/api/friends');
    $('#friendRequests').innerHTML = data.incoming.length
      ? data.incoming.map((p) => personRowHTML(p, `<span class="friend-btns"><button class="btn sm" data-friend="accept" data-req="${p.requestId}" type="button">Accept</button><button class="btn ghost sm" data-friend="decline" data-req="${p.requestId}" type="button">Decline</button></span>`)).join('')
      : '<div class="card empty">No new requests right now.</div>';
    $('#friendList').innerHTML = data.friends.length
      ? data.friends.map((p) => personRowHTML(p, `<button class="btn ghost sm" data-friend="remove" data-id="${p.id}" type="button">Unfriend</button>`)).join('')
      : '<div class="card empty">No friends yet — add some from the People page! 🙂</div>';
    $('#friendOutgoing').innerHTML = data.outgoing.length
      ? data.outgoing.map((p) => personRowHTML(p, '<span class="friend-state">Requested</span>')).join('')
      : '<div class="card empty">None waiting.</div>';
  } catch (e) { toast(e.message); }
}
/* friend actions (event delegation) */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-friend]');
  if (!btn) return;
  const act = btn.dataset.friend;
  btn.disabled = true;
  try {
    if (act === 'add') { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ userId: +btn.dataset.id }) }); toast('Friend request sent! 📨'); }
    else if (act === 'accept') { await api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ requestId: +btn.dataset.req }) }); toast('You are friends now! 🎉'); }
    else if (act === 'decline') { await api('/api/friends/decline', { method: 'POST', body: JSON.stringify({ requestId: +btn.dataset.req }) }); toast('Request declined.'); }
    else if (act === 'remove') { await api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ userId: +btn.dataset.id }) }); toast('Unfriended.'); }
    if (!$('#view-people').classList.contains('hidden')) loadPeople();
    if (!$('#view-friends').classList.contains('hidden')) loadFriends();
  } catch (ex) { toast(ex.message); btn.disabled = false; }
});

/* ================= profile ================= */
async function loadProfile() {
  try {
    const data = await api('/api/me');
    me = data.user;
    $('#profAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'lg');
    $('#profName').innerHTML = esc(me.displayName) + (me.isProtected ? '<span class="badge">🛡️ Protected account</span>' : '');
    $('#profSub').textContent = '@' + me.username;
    $('#stPosts').textContent = data.stats.posts;
    $('#stLikes').textContent = data.stats.likesReceived;
    $('#stComments').textContent = data.stats.comments;
    if (!$('#editName').value) $('#editName').placeholder = me.displayName;
    const mine = await api('/api/my/posts');
    const box = $('#myPosts');
    box.innerHTML = mine.posts.length ? mine.posts.map(postCardHTML).join('') : '<div class="card empty">You have not posted yet — say hi! 👋</div>';
    wirePostMedia(box);
  } catch (e) { toast(e.message); }
}
$('#btnSaveName').addEventListener('click', async () => {
  const name = $('#editName').value.trim();
  if (!name) { toast('Type a new name first 🙂'); return; }
  try {
    const r = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: name }) });
    me = r.user; $('#editName').value = '';
    $('#meName').textContent = me.displayName.split(' ')[0];
    $('#meAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'sm');
    $('#composerAvatar').innerHTML = avatarHTML(me.displayName, me.username, 'md');
    loadProfile(); loadFeed();
    toast('Name saved ✅');
  } catch (e) { toast(e.message); }
});
$('#btnLogout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  location.reload();
});

/* ================= init ================= */
(async function init() {
  renderSoundPills();
  try {
    const data = await api('/api/me');
    me = data.user;
    enterApp();
  } catch (e) {
    $('#authView').classList.remove('hidden');
    setAuthMode('login');
  }
})();
