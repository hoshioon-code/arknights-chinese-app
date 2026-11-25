'use strict';
/* アークナイツで学ぶ中国語 — static PWA (client-side only) */

// ---------------- store ----------------
const LS_KEY = 'akcn_pwa_v1';
// IndexedDB mirror of the store JSON (survives localStorage/container resets
// more often than localStorage alone on iOS). DB 'akcn-store', store 'kv', key 'state'.
let _idbP = null;
function idbOpen() {
  if (_idbP) return _idbP;
  _idbP = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('akcn-store', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return _idbP;
}
async function idbGetState() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const rq = db.transaction('kv', 'readonly').objectStore('kv').get('state');
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}
function idbSetState(json) {
  // fire-and-forget mirror write; failures must never break saving
  idbOpen().then(db => {
    try { db.transaction('kv', 'readwrite').objectStore('kv').put(json, 'state'); } catch (e) {}
  }).catch(() => {});
}
const store = {
  data: null,
  hadLS: false,
  load() {
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); this.data = JSON.parse(raw) || null; } catch (e) { this.data = null; }
    this.hadLS = !!raw;
    if (!this.data) this.data = { xp: 0, streakLast: '', streakCount: 0, done: {}, mistakes: [], settings: { pinyin: true, pos: true } };
    if (!this.data.settings) this.data.settings = { pinyin: true, pos: true };
  },
  save() {
    this.data.updatedAt = Date.now();
    let json = null;
    try { json = JSON.stringify(this.data); localStorage.setItem(LS_KEY, json); } catch (e) {}
    if (json) idbSetState(json);
    scheduleSyncPush();
  },
  touchStreak() {
    const today = new Date(); const key = today.toISOString().slice(0, 10);
    if (this.data.streakLast === key) return;
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    this.data.streakCount = (this.data.streakLast === y) ? this.data.streakCount + 1 : 1;
    this.data.streakLast = key; this.save();
  }
};
store.load();

// ---------------- utils ----------------
const $view = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(a, n) { return shuffle(a).slice(0, n); }
const KIND_BADGE = { general: ['一般語', 'badge-general'], proper: ['固有名詞', 'badge-proper'], term: ['専門用語', 'badge-term'] };
const POS_LABEL = { noun: '名詞', verb: '動詞', adj: '形容詞', adv: '副詞', pron: '代名詞', other: 'その他' };

// ---------------- data ----------------
const cache = {};
function loadJSON(url) { if (!cache[url]) cache[url] = fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json(); }); return cache[url]; }
let META = null, TERMS = null, VOCAB = null, AUDIO_MAP = null, AUDIO_CH = null;
const epDataCache = {}; // chapterId -> data
const wordKindMap = {};  // word -> kind
const vocabMap = {};     // word -> vocab entry

async function loadCore() {
  if (!META) {
    [META, TERMS, VOCAB, AUDIO_MAP, AUDIO_CH] = await Promise.all([
      loadJSON('data/meta.json'), loadJSON('data/terms.json'),
      loadJSON('data/vocab.json'), loadJSON('data/audio_map.json'),
      loadJSON('data/audio_chapters.json').catch(() => null)]);
    for (const v of VOCAB) { vocabMap[v.w] = v; wordKindMap[v.w] = v.kind; }
    for (const c of TERMS.categories) for (const s of c.sections) for (const t of s.terms)
      if (!(t.zh in wordKindMap)) wordKindMap[t.zh] = t.kind;
  }
}
async function loadChapter(chId) {
  if (!epDataCache[chId]) {
    const ch = META.chapters.find(c => c.id === chId);
    epDataCache[chId] = await loadJSON(ch.file);
  }
  return epDataCache[chId];
}
function findEpMeta(epId) {
  for (const ch of META.chapters) { const e = ch.episodes.find(x => x.id === epId); if (e) return { ch, e }; }
  return null;
}
async function loadEpisode(epId) {
  const f = findEpMeta(epId); if (!f) return null;
  const data = await loadChapter(f.ch.id);
  return data.episodes.find(x => x.id === epId);
}

// ---------------- audio ----------------
const audioEl = new Audio();
function hasAudio(text) { return !!(AUDIO_MAP && AUDIO_MAP[text]); }
// Playback word highlighting: MP3s carry no word timestamps, so the current
// word is estimated from elapsed time weighted by segment length.
let hlState = null;
function clearHL() {
  if (!hlState) return;
  hlState.spans.forEach(s => s.el.classList.remove('hl'));
  if (hlState.btn) hlState.btn.classList.remove('playing');
  hlState = null;
}
function findSentenceEl(fromEl) {
  let el = fromEl;
  for (let i = 0; i < 8 && el; i++) {
    if (el.matches && el.matches('.q-zh, .r-zh')) return el;
    if (el.querySelector) {
      const t = el.querySelector('.q-zh, .r-zh');
      if (t) return t;
    }
    el = el.parentElement;
  }
  return null;
}
function playText(text, btn) {
  if (!hasAudio(text)) return;
  clearHL();
  audioEl.src = AUDIO_MAP[text];
  audioEl.play().catch(() => {});
  const box = btn ? findSentenceEl(btn) : null;
  const spans = box ? [...box.querySelectorAll('span')].map(el => ({ el, w: Math.max(1, el.textContent.length) })) : [];
  hlState = { spans, btn: btn || null, total: spans.reduce((a, s) => a + s.w, 0) };
  if (btn) btn.classList.add('playing');
}
audioEl.addEventListener('timeupdate', () => {
  if (!hlState || !hlState.spans.length || !audioEl.duration) return;
  let target = (audioEl.currentTime / audioEl.duration) * hlState.total;
  let cur = hlState.spans[hlState.spans.length - 1];
  for (const s of hlState.spans) { target -= s.w; if (target < 0) { cur = s; break; } }
  hlState.spans.forEach(s => s.el.classList.toggle('hl', s === cur));
});
audioEl.addEventListener('ended', clearHL);
function speakBtn(text, big) {
  if (!hasAudio(text)) return '';
  return `<button class="${big ? 'speak-big' : 'speak-btn'}" data-speak="${esc(text)}" aria-label="音声を再生">🔊${big ? '' : ' 音声'}</button>`;
}

// ---------------- segmented text ----------------
const SEG_REG = []; // segments rendered on the current screen, for word taps
function segHTML(line, hlWord) {
  return (line.seg || []).map(s => {
    const cls = store.data.settings.pos && s[2] !== 'other' ? ` pos-${s[2]}` : '';
    if (!s[1]) return `<span>${esc(s[0])}</span>`;
    const gi = SEG_REG.length; SEG_REG.push(s);
    const tgt = hlWord && s[0] === hlWord ? ' target' : '';
    return `<span class="seg${cls}${tgt}" data-seg="${gi}">${esc(s[0])}</span>`;
  }).join('');
}
function openWordSheet(seg) {
  const [w, py, cls, gloss] = seg;
  const kind = wordKindMap[w];
  const vb = vocabMap[w];
  let ex = '';
  if (vb) {
    const epMeta = findEpMeta(vb.exEp);
    ex = `<div class="ws-ex">出典エピソードの台詞は物語リーダーで確認できます</div>`;
  }
  document.getElementById('word-sheet-body').innerHTML = `
    <div><span class="ws-word">${esc(w)}</span><span class="ws-py">${esc(py)}</span></div>
    <span class="ws-pos lg lg-${cls}">${POS_LABEL[cls] || 'その他'}</span>
    ${kind ? `<span class="badge ${KIND_BADGE[kind][1]}">${KIND_BADGE[kind][0]}</span>` : ''}
    ${gloss ? `<div class="ws-gloss">${esc(gloss)}</div>` : ''}
    ${ex}
    <div class="ws-actions">
      ${hasAudio(w) ? `<button class="btn" data-speak="${esc(w)}">🔊 音声を聞く</button>` : ''}
      <button class="btn btn-ghost" data-close-sheet>閉じる</button>
    </div>
    <button class="btn btn-ghost" id="ws-report" style="width:100%;margin-top:8px">⚠ この単語を報告する</button>`;
  showSheet('word-sheet');
  if (hasAudio(w)) playText(w);
  document.getElementById('ws-report').addEventListener('click', () => {
    reportCtx = `単語の報告\n単語: ${w}（${py}）\n品詞: ${POS_LABEL[cls] || 'その他'}\n意味: ${gloss || '（なし）'}${L ? '\n表示中の問題: ' + questionSummary().split('\n')[0] : ''}`;
    openReport();
  });
}

// ---------------- sheets ----------------
function showSheet(id) {
  document.getElementById('sheet-backdrop').classList.remove('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function hideSheets() {
  document.getElementById('sheet-backdrop').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach(s => s.classList.add('hidden'));
}
document.getElementById('sheet-backdrop').addEventListener('click', hideSheets);
document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('set-pinyin').checked = store.data.settings.pinyin;
  document.getElementById('set-pos').checked = store.data.settings.pos;
  document.getElementById('report-count').textContent = loadReports().filter(r => !r.resolved).length;
  setSyncStatus(syncCfg().token ? '同期は有効です（開くたび・記録の保存のたびに自動同期します）' : '同期は未設定です');
  showSheet('settings-sheet');
});
document.getElementById('settings-close').addEventListener('click', hideSheets);
document.getElementById('set-pinyin').addEventListener('change', e => { store.data.settings.pinyin = e.target.checked; store.save(); rerender(); });
document.getElementById('set-pos').addEventListener('change', e => { store.data.settings.pos = e.target.checked; store.save(); rerender(); });

// ---- problem reports (saved on this device) ----
const REPORTS_KEY = 'akcn-reports-v1';
function loadReports() { try { return JSON.parse(localStorage.getItem(REPORTS_KEY)) || []; } catch (e) { return []; } }
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function questionSummary() {
  if (!L) return '';
  const q = L.qs[L.idx];
  const head = `${L.title} ・ ${L.idx + 1}問目`;
  if (q.type === 'sentence') return `${head}\n文章問題（${q.dir === 'z2j' ? '中国語→日本語' : '日本語→中国語'}）\n中国語: ${q.line.zh}\n日本語: ${q.line.jp}`;
  if (q.type === 'word') return `${head}\n単語問題（${q.dir}）\n単語: ${q.word.w}（${q.word.py}）= ${q.word.gloss}`;
  return `${head}\n用語問題（${q.dir}）\n用語: ${q.term.zh}（${q.term.py}）= ${q.term.jp}`;
}
let reportCat = '';
let reportCtx = null; // set when reporting a single word from the word sheet
function currentReportTarget() { return reportCtx || questionSummary(); }
function openReport() {
  reportCat = '';
  document.querySelectorAll('#report-cats button').forEach(b => b.classList.remove('sel'));
  document.getElementById('report-comment').value = '';
  document.getElementById('report-msg').textContent = '';
  document.getElementById('report-target').textContent = currentReportTarget();
  hideSheets();
  showSheet('report-sheet');
}
document.querySelectorAll('#report-cats button').forEach(b => b.addEventListener('click', () => {
  reportCat = b.getAttribute('data-cat');
  document.querySelectorAll('#report-cats button').forEach(x => x.classList.toggle('sel', x === b));
}));
document.getElementById('report-send').addEventListener('click', () => {
  if (!reportCat) { document.getElementById('report-msg').textContent = 'カテゴリを選んでください。'; return; }
  const reports = loadReports();
  reports.push({ ts: new Date().toISOString(), category: reportCat, comment: document.getElementById('report-comment').value.trim(), question: currentReportTarget(), resolved: false });
  reportCtx = null;
  try { localStorage.setItem(REPORTS_KEY, JSON.stringify(reports)); } catch (e) {}
  scheduleSyncPush();
  hideSheets();
  toast('報告を保存しました。ありがとうございます！');
});
function saveReports(arr) {
  try { localStorage.setItem(REPORTS_KEY, JSON.stringify(arr)); } catch (e) {}
  scheduleSyncPush();
}
function reportKey(r) { return r.ts + '|' + r.question; }
function renderReportsList() {
  const reports = loadReports().slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const el = document.getElementById('reports-list');
  if (!reports.length) { el.innerHTML = '<p class="sheet-note">まだ報告はありません。</p>'; return; }
  el.innerHTML = reports.map(r => `
    <div class="report-row ${r.resolved ? 'resolved' : ''}">
      <div class="rr-head"><span class="rr-cat">${esc(r.category)}</span><span class="rr-date">${esc(r.ts.slice(0, 10))}</span></div>
      <div class="rr-q">${esc(r.question.split('\n').slice(0, 2).join(' / '))}</div>
      ${r.comment ? `<div class="rr-c">コメント: ${esc(r.comment)}</div>` : ''}
      <button class="btn ${r.resolved ? 'btn-ghost' : ''} rr-toggle" data-resolve="${esc(reportKey(r))}">${r.resolved ? '解決済み ✓（戻す）' : '解決済みにする'}</button>
    </div>`).join('');
  el.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', () => {
    const key = b.getAttribute('data-resolve');
    const arr = loadReports();
    const r = arr.find(x => reportKey(x) === key);
    if (r) { r.resolved = !r.resolved; saveReports(arr); }
    renderReportsList();
    document.getElementById('report-count').textContent = loadReports().filter(x => !x.resolved).length;
  }));
}
document.getElementById('btn-reports-open').addEventListener('click', () => { renderReportsList(); showSheet('reports-sheet'); });
document.getElementById('btn-copy-reports').addEventListener('click', async () => {
  const n = loadReports().filter(r => !r.resolved).length;
  const msgEl = document.getElementById('report-copy-msg');
  if (!n) { msgEl.textContent = '未解決の報告はありません。'; return; }
  const text = `中国語アプリの問題報告を確認してほしいな。未解決の報告が${n}件あるよ。私の非公開GitHubリポジトリ「arknights-chinese-data」の reports.json に入ってるから、未解決のものの内容を確認して、直せるものは直してほしい。直したものと、直せなかったものは教えてね。`;
  try { await navigator.clipboard.writeText(text); msgEl.textContent = '確認メッセージをコピーしました。Museとのチャットに貼って送ってください。'; }
  catch (e) { msgEl.textContent = 'コピーできませんでした。'; }
});

// ---- personal cloud sync: progress + reports in the user's private GitHub repo.
// The token lives only in this device's localStorage; it is never in the app code.
const SYNC_KEY = 'akcn-sync-v1';
const SYNC_REPO = 'hoshioon-code/arknights-chinese-data';
function syncCfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); }
function b64dec(b64) { const bin = atob(String(b64).replace(/\s/g, '')); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
async function ghContents(path, method, body) {
  const { token } = syncCfg();
  if (!token) throw new Error('トークン未設定');
  const res = await fetch(`https://api.github.com/repos/${SYNC_REPO}/contents/${path}`, {
    method: method || 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('GitHub ' + res.status);
  return res.json();
}
async function syncGet(path) {
  const r = await ghContents(path);
  if (!r) return null;
  return { sha: r.sha, obj: JSON.parse(b64dec(r.content)) };
}
async function syncPut(path, obj, sha, msg) {
  const body = { message: msg, content: b64enc(JSON.stringify(obj, null, 1)) };
  if (sha) body.sha = sha;
  return ghContents(path, 'PUT', body);
}
let syncTimer = null, syncBusy = false, syncQueued = false;
function scheduleSyncPush() {
  try {
    if (!syncCfg().token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(false); }, 3000);
  } catch (e) {}
}
function setSyncStatus(txt) { const el = document.getElementById('sync-status'); if (el) el.textContent = txt; }
async function syncNow(manual) {
  if (!syncCfg().token) { if (manual) setSyncStatus('トークンが未設定です。'); return; }
  if (syncBusy) { syncQueued = true; return; }
  syncBusy = true;
  setSyncStatus('同期中…');
  try {
    // progress: the newer side (by updatedAt) wins
    const remoteP = await syncGet('progress.json');
    const localAt = store.data.updatedAt || 0;
    if (remoteP && remoteP.obj && typeof remoteP.obj.updatedAt === 'number' && remoteP.obj.updatedAt > localAt
      && typeof remoteP.obj.xp === 'number' && remoteP.obj.done && typeof remoteP.obj.done === 'object') {
      store.data = { xp: 0, streakLast: '', streakCount: 0, done: {}, mistakes: [], settings: { pinyin: true, pos: true }, ...remoteP.obj };
      try { const j = JSON.stringify(store.data); localStorage.setItem(LS_KEY, j); idbSetState(j); } catch (e) {}
      rerender();
    }
    await syncPut('progress.json', store.data, remoteP ? remoteP.sha : undefined, 'Sync progress');
    // reports: union merge (append-only on both sides); 'resolved' is sticky (OR)
    const remoteR = await syncGet('reports.json');
    const localReports = loadReports();
    const byKey = new Map(localReports.map(r => [reportKey(r), r]));
    if (remoteR && Array.isArray(remoteR.obj)) for (const r of remoteR.obj) {
      const k = reportKey(r);
      if (byKey.has(k)) { const cur = byKey.get(k); cur.resolved = !!(cur.resolved || r.resolved); }
      else byKey.set(k, r);
    }
    const merged = [...byKey.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    if (JSON.stringify(merged) !== JSON.stringify(localReports)) { try { localStorage.setItem(REPORTS_KEY, JSON.stringify(merged)); } catch (e) {} }
    await syncPut('reports.json', merged, remoteR ? remoteR.sha : undefined, 'Sync reports');
    setSyncStatus('同期済み：' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    setSyncStatus('同期エラー（' + e.message + '）。トークンとネット接続を確認してください。');
  }
  syncBusy = false;
  if (syncQueued) { syncQueued = false; scheduleSyncPush(); }
}
document.getElementById('btn-sync-save').addEventListener('click', () => {
  const tok = document.getElementById('sync-token').value.trim();
  if (!tok) { setSyncStatus('トークンを入力してください。'); return; }
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ token: tok })); } catch (e) {}
  document.getElementById('sync-token').value = '';
  syncNow(true);
});
document.getElementById('btn-sync-now').addEventListener('click', () => syncNow(true));

// ---- backup: export / import learning records ----
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'arknights-cn-backup.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  document.getElementById('backup-msg').textContent = '記録をファイルに書き出しました。';
});
const importFileEl = document.getElementById('import-file');
document.getElementById('btn-import').addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', async () => {
  const f = importFileEl.files && importFileEl.files[0];
  if (!f) return;
  const msg = document.getElementById('backup-msg');
  try {
    const obj = JSON.parse(await f.text());
    if (!obj || typeof obj !== 'object' || typeof obj.xp !== 'number' || !obj.done || typeof obj.done !== 'object') throw new Error('invalid backup');
    store.data = obj;
    if (!store.data.settings) store.data.settings = { pinyin: true, pos: true };
    if (!Array.isArray(store.data.mistakes)) store.data.mistakes = [];
    store.save();
    document.getElementById('set-pinyin').checked = !!store.data.settings.pinyin;
    document.getElementById('set-pos').checked = !!store.data.settings.pos;
    msg.textContent = '記録を読み込みました。';
    rerender();
  } catch (e) {
    msg.textContent = '読み込みに失敗しました。バックアップファイルを確認してください。';
  }
  importFileEl.value = '';
});

// global click delegation for speak buttons / segment taps / sheet close
document.addEventListener('click', e => {
  const sp = e.target.closest('[data-speak]');
  if (sp) { playText(sp.getAttribute('data-speak'), sp); return; }
  const ss = e.target.closest('[data-speak-sentence]');
  if (ss && !e.target.closest('[data-seg]')) { playText(ss.getAttribute('data-speak-sentence'), ss); return; }
  const sg = e.target.closest('[data-seg]');
  if (sg && SEG_REG[+sg.getAttribute('data-seg')]) { openWordSheet(SEG_REG[+sg.getAttribute('data-seg')]); return; }
  if (e.target.closest('[data-close-sheet]')) hideSheets();
});

// ---------------- per-chapter audio download (Cache Storage) ----------------
const fmtMB = b => (b / 1048576).toFixed(1) + ' MB';
const audioCacheName = id => 'akcn-audio-' + id;
function audioBoxHTML(id) {
  const info = AUDIO_CH && AUDIO_CH.chapters[id];
  if (!info) return '';
  return `<div class="audio-box" data-audio-box="${id}">
    <div class="ab-main">
      <div class="ab-title">🔊 ${esc(info.label)}</div>
      <div class="ab-sub">${info.files} ファイル ・ ${fmtMB(info.bytes)}</div>
      <div class="ab-state muted small">状態を確認中…</div>
    </div>
    <div class="ab-btns">
      <button class="ab-btn" data-dl="${id}">端末に保存</button>
      <button class="ab-btn ab-del hidden" data-del="${id}">削除</button>
    </div>
  </div>`;
}
async function refreshAudioBox(id) {
  const box = $view.querySelector(`[data-audio-box="${id}"]`);
  if (!box) return;
  const info = AUDIO_CH.chapters[id];
  const state = box.querySelector('.ab-state');
  const dl = box.querySelector('[data-dl]');
  const del = box.querySelector('[data-del]');
  if (!('caches' in window)) { state.textContent = 'この環境では端末保存できません（オンライン再生のみ）'; dl.disabled = true; return; }
  let n = 0;
  if (await caches.has(audioCacheName(id))) {
    const c = await caches.open(audioCacheName(id));
    n = (await c.keys()).length;
  }
  if (n >= info.files) {
    state.textContent = `保存済み（${n}/${info.files}）— オフライン再生できます`;
    dl.classList.add('hidden'); del.classList.remove('hidden');
  } else if (n > 0) {
    state.textContent = `一部保存済み（${n}/${info.files}）`;
    dl.textContent = '続きを保存'; dl.classList.remove('hidden'); del.classList.remove('hidden');
  } else {
    state.textContent = '未保存（再生時は通信します）';
    dl.textContent = '端末に保存'; dl.classList.remove('hidden'); del.classList.add('hidden');
  }
}
async function downloadChapterAudio(id, btn) {
  const info = AUDIO_CH.chapters[id];
  const box = $view.querySelector(`[data-audio-box="${id}"]`);
  const state = box.querySelector('.ab-state');
  btn.disabled = true;
  try {
    const c = await caches.open(audioCacheName(id));
    const have = new Set((await c.keys()).map(r => r.url));
    const urls = info.urls.map(u => new URL(u, location.href).href).filter(u => !have.has(u));
    let done = info.files - urls.length, ok = 0;
    const queue = urls.slice();
    async function worker() {
      while (queue.length) {
        const u = queue.shift();
        try {
          const r = await fetch(u);
          if (r.ok) { await c.put(u, r.clone()); ok++; }
        } catch (e) { /* skip, retryable next time */ }
        done++;
        if (done % 8 === 0 || done >= info.files) state.textContent = `保存中… ${done}/${info.files}`;
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    state.textContent = ok + (info.files - urls.length) >= info.files ? '保存が完了しました ✓' : `保存しました（${ok}件追加）`;
  } catch (e) {
    state.textContent = '保存に失敗しました。通信環境を確認してください';
  }
  btn.disabled = false;
  refreshAudioBox(id);
}
async function deleteChapterAudio(id) {
  await caches.delete(audioCacheName(id));
  refreshAudioBox(id);
}
function wireAudioBoxes() {
  $view.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => downloadChapterAudio(b.getAttribute('data-dl'), b)));
  $view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteChapterAudio(b.getAttribute('data-del'))));
  $view.querySelectorAll('[data-audio-box]').forEach(b => refreshAudioBox(b.getAttribute('data-audio-box')));
}

// ---------------- header stats ----------------
function renderStats() {
  document.getElementById('stat-xp').textContent = store.data.xp;
  document.getElementById('stat-streak').textContent = store.data.streakCount + '日';
}

// ---------------- views ----------------
const UI = { view: 'home', tab: 'story' };
function rerender() {
  if (UI.view === 'home') renderHome();
  else if (UI.view === 'lesson') renderQuestion();
  else if (UI.view === 'reader') renderReader(UI.readerEp);
}

async function renderHome() {
  UI.view = 'home';
  renderStats();
  $view.innerHTML = '<div class="loading">読み込み中…</div>';
  await loadCore();
  const mistakes = store.data.mistakes.length;
  let html = `
    <div class="hero">
      <span class="hero-tag">OPERATION</span>
      <h1>物語で学ぶ中国語</h1>
      <p>アークナイツ本編の台詞（中国語／日本語）から作ったレッスンです。文章ステージと単語ステージを交互に進めましょう。</p>
    </div>
    ${mistakes ? `<div class="review-banner"><span>間違えた問題が ${mistakes} 件あります</span><button data-act="review">復習する</button></div>` : ''}
    <div class="tabs">
      <button class="tab ${UI.tab === 'story' ? 'active' : ''}" data-tab="story">ストーリー</button>
      <button class="tab ${UI.tab === 'terms' ? 'active' : ''}" data-tab="terms">用語ステージ</button>
    </div>`;
  if (UI.tab === 'story') {
    // accordion: which chapters are open (persisted per device; default = the
    // first chapter that still has an uncleared stage)
    let openSet = null;
    try { const raw = localStorage.getItem('akcn-open-chapters'); if (raw) openSet = new Set(JSON.parse(raw)); } catch (e) {}
    if (!openSet) {
      let cur = null;
      for (const ch of META.chapters) {
        const hasOpen = ch.episodes.some(ep => {
          const s = store.data.done['s:' + ep.id], w = store.data.done['w:' + ep.id];
          return !(s && s.cleared) || !(w && w.cleared);
        });
        if (hasOpen) { cur = ch; break; }
      }
      openSet = new Set([(cur || META.chapters[META.chapters.length - 1]).id]);
    }
    for (const ch of META.chapters) {
      const totalStages = ch.episodes.length * 2;
      let clearedStages = 0;
      for (const ep of ch.episodes) for (const k of ['s', 'w']) {
        const d = store.data.done[k + ':' + ep.id];
        if (d && d.cleared) clearedStages++;
      }
      const open = openSet.has(ch.id);
      html += `<div class="chapter">
        <button class="chapter-head" data-ch-toggle="${ch.id}" aria-expanded="${open}">
          <span class="ch-chev">▾</span>
          <span class="ch-name">${esc(ch.name)}</span><span class="ch-name-jp">${esc(ch.nameJp)}</span>
          <span class="ch-prog">${clearedStages}/${totalStages} クリア</span>
        </button>
        <div class="chapter-body ${open ? 'open' : ''}"><div class="chapter-inner"><div class="path">`;
      let nodeIdx = 0;
      ch.episodes.forEach((ep, i) => {
        const title = (ep.code ? ep.code + ' ' : '') + ep.name;
        for (const [kind, label, ico] of [['s', '文章', '文'], ['w', '単語', '語']]) {
          const stId = `${kind}:${ep.id}`;
          const done = store.data.done[stId];
          const dx = [0, -46, -68, -46, 0, 46, 68, 46][nodeIdx % 8]; nodeIdx++;
          html += `
            <div class="node-wrap" style="--dx:${dx}px">
              ${i > 0 || kind === 'w' ? '<div class="node-link"></div>' : ''}
              <button class="node ${kind === 's' ? 'sentence' : 'word'} ${done && done.cleared ? 'done' : ''}" data-stage="${stId}">
                <span class="n-ico">${ico}</span><span class="n-lab">${label}</span>
              </button>
              <div class="node-cap"><b>${esc(title)}</b> ${label}${done ? ` ・ ベスト ${done.best}/10` : ''}<br>
              ${kind === 's' ? `<a href="#" data-reader="${ep.id}" class="small">物語を読む</a>` : ''}</div>
            </div>`;
        }
      });
      html += '</div>' + audioBoxHTML(ch.id) + '</div></div></div>';
    }
  } else {
    html += audioBoxHTML('common');
    for (const cat of TERMS.categories) {
      html += `<div class="term-cat"><h2 class="sec-title">${esc(cat.label)}</h2><div class="term-grid">`;
      for (const sec of cat.sections) {
        const stId = `t:${sec.id}`;
        const done = store.data.done[stId];
        html += `
          <button class="term-sec" data-stage="${stId}">
            <div class="ts-name">${esc(sec.nameJp || sec.name)}</div>
            <div class="ts-sub">${esc(sec.name)} ・ ${sec.terms.length}語</div>
            ${done ? `<div class="ts-best">ベスト ${done.best}/10${done.cleared ? ' ・ クリア' : ''}</div>` : ''}
          </button>`;
      }
      html += '</div></div>';
    }
  }
  $view.innerHTML = html;
  $view.querySelectorAll('[data-ch-toggle]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-ch-toggle');
    const body = b.parentElement.querySelector('.chapter-body');
    const nowOpen = !body.classList.contains('open');
    body.classList.toggle('open', nowOpen);
    b.setAttribute('aria-expanded', String(nowOpen));
    let set = new Set();
    try { set = new Set(JSON.parse(localStorage.getItem('akcn-open-chapters') || '[]')); } catch (e) {}
    if (nowOpen) set.add(id); else set.delete(id);
    try { localStorage.setItem('akcn-open-chapters', JSON.stringify([...set])); } catch (e) {}
  }));
  $view.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { UI.tab = b.getAttribute('data-tab'); renderHome(); }));
  $view.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => startStage(b.getAttribute('data-stage'))));
  $view.querySelectorAll('[data-reader]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openReader(a.getAttribute('data-reader')); }));
  const rv = $view.querySelector('[data-act="review"]');
  if (rv) rv.addEventListener('click', startReview);
  wireAudioBoxes();
}

// ---------------- lesson building ----------------
function linePool(ep) {
  return ep.lines.map((l, i) => ({ ...l, idx: i, key: ep.id + ':' + i }))
    .filter(l => l.jp && l.jp.trim().length >= 2 && l.zh.length >= 3 && l.zh.length <= 70);
}
function buildSentenceQuestions(ep, chapterPool) {
  let pool = linePool(ep);
  if (pool.length < 4) pool = chapterPool;
  const picks = sample(pool, Math.min(10, pool.length));
  return picks.map((l, i) => {
    const dir = i % 2 === 0 ? 'z2j' : 'j2z';
    const others = sample(pool.filter(x => x.key !== l.key), 3);
    const choices = shuffle([l, ...others].map(o => ({
      label: dir === 'z2j' ? o.jp : o.zh, ok: o.key === l.key
    })));
    return { type: 'sentence', dir, line: l, epId: ep.id, choices, mistake: { t: 's', ep: ep.id, line: l.idx } };
  });
}
function epWordPool(ep) {
  const map = {};
  for (const l of ep.lines) for (const s of l.seg || []) {
    const [w, py, cls, gloss] = s;
    if (w.length >= 2 && gloss && !map[w]) map[w] = { w, py, cls, gloss, kind: wordKindMap[w] || 'general', exZh: l.zh, exJp: l.jp, exLine: l };
  }
  return Object.values(map);
}
function wordQuestions(pool, makeMistake) {
  const qs = [];
  const usable = pool.filter(p => p.gloss);
  if (usable.length < 4) return qs;
  const picks = sample(usable, Math.min(10, usable.length));
  const formats = ['listen', 'w2m', 'm2w'];
  picks.forEach((p, i) => {
    let fmt = formats[i % 3];
    if (fmt === 'listen' && !hasAudio(p.w)) fmt = 'w2m';
    const others = sample(usable.filter(x => x.w !== p.w), 3);
    let choices;
    if (fmt === 'w2m') choices = shuffle([p, ...others].map(o => ({ label: o.gloss, ok: o.w === p.w })));
    else choices = shuffle([p, ...others].map(o => ({ label: o.w, ok: o.w === p.w })));
    qs.push({ type: 'word', dir: fmt, word: p, choices, mistake: makeMistake(p) });
  });
  return qs;
}
function buildWordQuestions(ep) {
  let pool = epWordPool(ep);
  if (pool.length < 8) { // fall back to global vocab with examples resolved later
    pool = VOCAB.map(v => ({ w: v.w, py: v.py, cls: 'other', gloss: v.gloss, kind: v.kind, exZh: '', exJp: '', exEp: v.exEp, exLine: v.exLine }));
  }
  return wordQuestions(pool, p => ({ t: 'w', w: p.w }));
}
function buildTermQuestions(cat, sec) {
  const pool = sec.terms;
  const catPool = cat.sections.flatMap(s => s.terms);
  const qs = [];
  const formats = ['z2j', 'j2z', 'listen'];
  let guard = 0;
  while (qs.length < 10 && guard++ < 60) {
    const t = pool[Math.floor(Math.random() * pool.length)];
    const fmt = formats[qs.length % 3] === 'listen' && !hasAudio(t.zh) ? 'z2j' : formats[qs.length % 3];
    if (qs.some(q => q.term.zh === t.zh && q.dir === fmt)) continue;
    const src = pool.length >= 4 ? pool : catPool;
    const others = sample(src.filter(x => x.zh !== t.zh), 3);
    if (others.length < 3) break;
    const choices = fmt === 'z2j'
      ? shuffle([t, ...others].map(o => ({ label: o.jp, ok: o.zh === t.zh })))
      : shuffle([t, ...others].map(o => ({ label: o.zh, ok: o.zh === t.zh })));
    qs.push({ type: 'term', dir: fmt, term: t, choices, mistake: { t: 't', zh: t.zh, cat: cat.id } });
  }
  return qs;
}

// ---------------- lesson running ----------------
let L = null; // active lesson
async function startStage(stageId) {
  await loadCore();
  const [kind, rest] = [stageId.slice(0, 1), stageId.slice(2)];
  let qs = [], title = '';
  if (kind === 's' || kind === 'w') {
    const ep = await loadEpisode(rest);
    const f = findEpMeta(rest);
    const chData = await loadChapter(f.ch.id);
    const chapterPool = chData.episodes.flatMap(e => linePool(e));
    title = (f.e.code ? f.e.code + ' ' : '') + f.e.name + (kind === 's' ? '（文章）' : '（単語）');
    qs = kind === 's' ? buildSentenceQuestions(ep, chapterPool) : buildWordQuestions(ep);
  } else if (kind === 't') {
    for (const cat of TERMS.categories) {
      const sec = cat.sections.find(s => s.id === rest);
      if (sec) { title = `${cat.label}：${sec.nameJp || sec.name}`; qs = buildTermQuestions(cat, sec); break; }
    }
  }
  if (!qs.length) { alert('このステージの問題を生成できませんでした'); return; }
  L = { stageId, title, qs, idx: 0, hearts: 5, correct: 0, sel: -1, judged: false, review: false };
  UI.view = 'lesson';
  renderQuestion();
}
async function startReview() {
  await loadCore();
  const items = sample(store.data.mistakes, Math.min(10, store.data.mistakes.length));
  const qs = [];
  for (const m of items) {
    if (m.t === 's') {
      const ep = await loadEpisode(m.ep); if (!ep) continue;
      const chData = await loadChapter(findEpMeta(m.ep).ch.id);
      const pool = chData.episodes.flatMap(e => linePool(e));
      const line = { ...ep.lines[m.line], idx: m.line, key: m.ep + ':' + m.line };
      const others = sample(pool.filter(x => x.key !== line.key), 3);
      const dir = Math.random() < 0.5 ? 'z2j' : 'j2z';
      qs.push({ type: 'sentence', dir, line, epId: m.ep, choices: shuffle([line, ...others].map(o => ({ label: dir === 'z2j' ? o.jp : o.zh, ok: o.key === line.key }))), mistake: m });
    } else if (m.t === 'w') {
      const v = vocabMap[m.w]; if (!v) continue;
      const target = { w: v.w, py: v.py, cls: 'other', gloss: v.gloss, kind: v.kind, exZh: '', exJp: '' };
      const others = sample(VOCAB.filter(x => x.w !== m.w), 9)
        .map(x => ({ w: x.w, py: x.py, cls: 'other', gloss: x.gloss, kind: x.kind, exZh: '', exJp: '' }));
      const built = wordQuestions([target, ...others], () => m).filter(q => q.word.w === m.w);
      if (built.length) qs.push(built[0]);
    } else if (m.t === 't') {
      for (const cat of TERMS.categories) {
        const sec = cat.sections.find(s => s.terms.some(t => t.zh === m.zh));
        if (sec) { const q = buildTermQuestions(cat, sec).find(q => q.term.zh === m.zh); if (q) qs.push(q); break; }
      }
    }
  }
  if (!qs.length) { alert('復習できる問題がありませんでした'); return; }
  L = { stageId: 'review', title: 'ミス復習', qs: shuffle(qs), idx: 0, hearts: 99, correct: 0, sel: -1, judged: false, review: true };
  UI.view = 'lesson';
  renderQuestion();
}

function praiseFor(correct, total) {
  const r = total ? correct / total : 0;
  const perfect = ['アーミヤ|全問正解です、ドクター！本当にすごいです！', 'W|全部正解！退屈なくらい完璧だったね♪ 次も楽しませてよ。'];
  const great = ['ケルシー|上出来だ。この調子で続けなさい。', 'アーミヤ|あと少しで全問正解でした。とてもよくできています！'];
  const effort = ['クロージャ|おつかれさま！間違えた所は復習で回収しちゃお♪', 'エフイーター|大丈夫、練習あるのみ！次はもっと当てよう。'];
  const arr = r >= 1 ? perfect : r >= 0.8 ? great : effort;
  const [name, line] = arr[Math.floor(Math.random() * arr.length)].split('|');
  return { name, line };
}

function renderQuestion() {
  if (!L) return;
  SEG_REG.length = 0;
  const q = L.qs[L.idx];
  const total = L.qs.length;
  let prompt = '';
  if (q.type === 'sentence') {
    if (q.dir === 'z2j') {
      prompt = `<div class="q-kind">中国語 → 日本語</div>
        ${q.line.sp ? `<div class="q-speaker">${esc(q.line.sp)}</div>` : ''}
        <div class="q-zh">${segHTML(q.line)}</div>
        ${store.data.settings.pinyin ? `<div class="q-py">${esc(q.line.py)}</div>` : ''}
        <div style="margin-top:8px">${speakBtn(q.line.zh)}</div>`;
    } else {
      prompt = `<div class="q-kind">日本語 → 中国語</div>
        ${q.line.spJp ? `<div class="q-speaker">${esc(q.line.spJp)}</div>` : ''}
        <div class="q-jp-q">${esc(q.line.jp)}</div>`;
    }
  } else if (q.type === 'word') {
    const w = q.word;
    const badge = `<span class="badge ${KIND_BADGE[w.kind][1]}">${KIND_BADGE[w.kind][0]}</span>`;
    if (q.dir === 'listen') {
      prompt = `<div class="q-kind">聞き取り ・ この単語はどれ？</div>
        <div class="q-listen">${speakBtn(w.w, true)}<div>${badge}</div></div>`;
    } else if (q.dir === 'w2m') {
      prompt = `<div class="q-kind">単語 → 意味</div>
        <div class="q-zh">${esc(w.w)}</div>
        ${store.data.settings.pinyin ? `<div class="q-py">${esc(w.py)}</div>` : ''}
        <div style="margin-top:6px">${badge} ${speakBtn(w.w)}</div>`;
    } else {
      prompt = `<div class="q-kind">意味 → 単語</div>
        <div class="q-jp-q">${esc(w.gloss)}</div><div style="margin-top:6px">${badge}</div>`;
    }
  } else { // term
    const t = q.term;
    const badge = `<span class="badge ${KIND_BADGE[t.kind][1]}">${KIND_BADGE[t.kind][0]}</span>`;
    if (q.dir === 'listen') {
      prompt = `<div class="q-kind">聞き取り ・ 用語</div>
        <div class="q-listen">${speakBtn(t.zh, true)}<div>${badge}</div></div>`;
    } else if (q.dir === 'z2j') {
      prompt = `<div class="q-kind">用語：中国語 → 日本語</div>
        <div class="q-zh">${esc(t.zh)}</div>
        ${store.data.settings.pinyin ? `<div class="q-py">${esc(t.py)}</div>` : ''}
        <div style="margin-top:6px">${badge} ${speakBtn(t.zh)}</div>`;
    } else {
      prompt = `<div class="q-kind">用語：日本語 → 中国語</div>
        <div class="q-jp-q">${esc(t.jp)}</div><div style="margin-top:6px">${badge}</div>`;
    }
  }
  const hearts = L.review ? '' : `<div class="hearts">${'♥'.repeat(L.hearts)}${'♡'.repeat(Math.max(0, 5 - L.hearts))}</div>`;
  $view.innerHTML = `
    <div class="lesson-head">
      <button class="icon-btn" id="btn-quit" aria-label="やめる">✕</button>
      <div class="progressbar"><i style="width:${(L.idx / total) * 100}%"></i></div>
      ${hearts}
    </div>
    <div class="small muted" style="margin-bottom:8px">${esc(L.title)} ・ ${L.idx + 1} / ${total} 問</div>
    <div class="q-card">${prompt}
      <div class="choices">
        ${q.choices.map((c, i) => `<button class="choice" data-choice="${i}">${esc(c.label)}</button>`).join('')}
      </div>
      <div id="fb"></div>
    </div>
    <div class="lesson-foot">
      <button class="btn" id="btn-check" disabled>答え合わせ</button>
    </div>
    <div class="report-bar"><button id="btn-report" class="report-btn">⚠ この問題を報告する</button></div>`;
  $view.querySelector('#btn-report').addEventListener('click', () => { reportCtx = null; openReport(); });
  // when the prompt itself is Chinese, play its audio as the question starts
  const auto = q.type === 'sentence' ? (q.dir === 'z2j' ? q.line.zh : null)
    : q.type === 'word' ? (q.dir === 'm2w' ? null : q.word.w)
    : (q.dir === 'j2z' ? null : q.term.zh);
  if (auto && hasAudio(auto)) playText(auto);
  $view.querySelector('#btn-quit').addEventListener('click', () => { L = null; UI.view = 'home'; renderHome(); });
  $view.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => {
    if (L.judged) return;
    L.sel = +b.getAttribute('data-choice');
    $view.querySelectorAll('[data-choice]').forEach(x => x.classList.toggle('sel', +x.getAttribute('data-choice') === L.sel));
    document.getElementById('btn-check').disabled = false;
    const c = q.choices[L.sel];
    if (c && hasAudio(c.label)) playText(c.label);
  }));
  document.getElementById('btn-check').addEventListener('click', judge);
}

function judge() {
  if (!L || L.judged || L.sel < 0) return;
  L.judged = true;
  const q = L.qs[L.idx];
  const ok = q.choices[L.sel].ok;
  if (ok) {
    L.correct++;
    if (L.review) removeMistake(q.mistake);
  } else {
    if (!L.review) { L.hearts--; addMistake(q.mistake); }
  }
  store.save(); // persist progress/mistakes at every judgement, not only at lesson end
  $view.querySelectorAll('[data-choice]').forEach((b, i) => {
    b.classList.remove('sel');
    if (q.choices[i].ok) b.classList.add('right');
    else if (i === L.sel) b.classList.add('wrong');
    else b.classList.add('dim');
    b.disabled = true;
  });
  // feedback content
  let pair = '';
  if (q.type === 'sentence') {
    pair = `<div class="fb-pair"><div class="q-zh fb-sentence" data-speak-sentence="${esc(q.line.zh)}" style="font-size:19px" title="タップで音声再生">${segHTML(q.line)}</div>
      ${store.data.settings.pinyin ? `<div class="q-py">${esc(q.line.py)}</div>` : ''}
      <div class="jp">${esc(q.line.jp)}</div>
      <div style="margin-top:6px">${speakBtn(q.line.zh)}</div></div>`;
  } else if (q.type === 'word') {
    const w = q.word;
    const exHtml = !w.exZh ? '' : (w.exLine
      ? `<div class="ws-ex">例文：<div class="q-zh" style="font-size:16px">${segHTML(w.exLine, w.w)}</div><div class="muted" style="margin-top:4px">${esc(w.exJp)}</div><div style="margin-top:4px">${speakBtn(w.exZh)}</div></div>`
      : `<div class="ws-ex">例文：${esc(w.exZh)}<br><span class="muted">${esc(w.exJp)}</span><div style="margin-top:4px">${speakBtn(w.exZh)}</div></div>`);
    pair = `<div class="fb-pair"><b style="font-size:19px">${esc(w.w)}</b> <span class="q-py">${esc(w.py)}</span> — ${esc(w.gloss)}
      <div style="margin-top:6px">${speakBtn(w.w)}</div>
      ${exHtml}</div>`;
  } else {
    const t = q.term;
    pair = `<div class="fb-pair"><b style="font-size:19px">${esc(t.zh)}</b> <span class="q-py">${esc(t.py)}</span> — ${esc(t.jp)}
      <div style="margin-top:6px">${speakBtn(t.zh)}</div></div>`;
  }
  const praise = ok ? praiseFor(1, 1) : null;
  document.getElementById('fb').innerHTML = `
    <div class="feedback ${ok ? 'ok' : 'ng'}">
      <div class="fb-title">${ok ? '正解！' : '不正解…'}</div>
      ${pair}
      ${ok ? `<div class="praise"><b>${esc(praise.name)}</b>「${esc(praise.line)}」</div>` : ''}
    </div>`;
  const foot = $view.querySelector('.lesson-foot');
  const last = L.idx + 1 >= L.qs.length;
  foot.innerHTML = (!ok && !L.review && L.hearts <= 0)
    ? `<button class="btn" id="btn-next">結果を見る</button>`
    : `<button class="btn" id="btn-next">${last ? '結果を見る' : '次へ'}</button>`;
  document.getElementById('btn-next').addEventListener('click', () => {
    if (!ok && !L.review && L.hearts <= 0) return finishLesson(false);
    L.idx++; L.sel = -1; L.judged = false;
    if (L.idx >= L.qs.length) finishLesson(true); else renderQuestion();
  });
  renderStats();
}

function addMistake(m) {
  if (!m) return;
  const key = JSON.stringify(m);
  if (!store.data.mistakes.some(x => JSON.stringify(x) === key)) { store.data.mistakes.push(m); store.save(); }
}
function removeMistake(m) {
  if (!m) return;
  const key = JSON.stringify(m);
  store.data.mistakes = store.data.mistakes.filter(x => JSON.stringify(x) !== key);
  store.save();
}

function finishLesson(completed) {
  const total = L.qs.length, correct = L.correct;
  const xpGain = completed ? correct * 10 : correct * 5;
  if (!L.review) {
    store.data.xp += xpGain;
    const prev = store.data.done[L.stageId] || { best: 0, cleared: false };
    store.data.done[L.stageId] = { best: Math.max(prev.best, correct), cleared: prev.cleared || (completed && L.hearts > 0) };
    store.save();
  }
  if (completed) store.touchStreak();
  const praise = praiseFor(correct, total);
  const stageId = L.stageId;
  $view.innerHTML = `
    <div class="result-card">
      <span class="hero-tag">${L.review ? 'REVIEW' : 'RESULT'}</span>
      <h2>${completed ? 'レッスン完了！' : 'ハートがなくなりました…'}</h2>
      <div class="muted">${total}問中 ${correct}問 正解</div>
      <div class="praise" style="text-align:left"><b>${esc(praise.name)}</b>「${esc(praise.line)}」</div>
      <div class="result-stats">
        <div class="rstat"><div class="v">+${L.review ? 0 : xpGain}</div><div class="k">獲得XP</div></div>
        <div class="rstat"><div class="v">${store.data.streakCount}日</div><div class="k">連続学習</div></div>
      </div>
      <button class="btn" id="btn-home">ホームへ</button>
      ${!completed ? '<button class="btn btn-jade" id="btn-retry" style="margin-top:10px">もう一度挑戦</button>' : ''}
    </div>`;
  L = null;
  document.getElementById('btn-home').addEventListener('click', () => { UI.view = 'home'; renderHome(); });
  const rt = document.getElementById('btn-retry');
  if (rt) rt.addEventListener('click', () => startStage(stageId));
  renderStats();
}

// ---------------- reader ----------------
async function openReader(epId) {
  UI.view = 'reader'; UI.readerEp = epId;
  await loadCore();
  renderReader(epId);
}
async function renderReader(epId) {
  const ep = await loadEpisode(epId);
  SEG_REG.length = 0;
  const f = findEpMeta(epId);
  if (!ep) { $view.innerHTML = '<div class="loading">読み込めませんでした</div>'; return; }
  $view.innerHTML = `
    <button class="btn btn-ghost" id="btn-back" style="margin-bottom:12px">← 戻る</button>
    <h2 class="sec-title">${esc((f.e.code ? f.e.code + ' ' : '') + f.e.name)}（${esc(f.e.nameJp)}）</h2>
    ${ep.lines.map(l => `
      <div class="reader-line">
        ${l.sp ? `<div class="r-sp">${esc(l.sp)}${l.spJp && l.spJp !== l.sp ? ` / ${esc(l.spJp)}` : ''}</div>` : ''}
        <div class="r-zh">${segHTML(l)}</div>
        ${store.data.settings.pinyin ? `<div class="q-py">${esc(l.py)}</div>` : ''}
        <div class="r-jp">${esc(l.jp)}</div>
        <div class="r-tools">${speakBtn(l.zh)}</div>
      </div>`).join('')}`;
  document.getElementById('btn-back').addEventListener('click', () => { UI.view = 'home'; renderHome(); });
}

// ---------------- boot ----------------
(async () => {
  // ask the browser to keep this origin's storage persistent (best effort)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  // if localStorage was wiped but the IndexedDB mirror survived, restore from it
  if (!store.hadLS) {
    try {
      const raw = await idbGetState();
      if (raw) {
        try { localStorage.setItem(LS_KEY, raw); } catch (e) {}
        store.load();
      }
    } catch (e) {}
  }
  renderStats();
  renderHome();
  if (syncCfg().token) syncNow(false);
})();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
