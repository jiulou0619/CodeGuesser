/* ============================================================
   CodePop 解码对决 — 异步好友对战猜图标密码
   纯静态实现:密码通过混淆链接在好友间传递,无需服务器
   ============================================================ */
'use strict';

/* ---------------- 常量 ---------------- */
const ICONS = [
  { id: 'apple',     name: '苹果',   emoji: '🍎', color: '#ff5a5f' },
  { id: 'cat',       name: '猫咪',   emoji: '🐱', color: '#ff922b' },
  { id: 'star',      name: '星星',   emoji: '⭐', color: '#f5b301' },
  { id: 'lightning', name: '闪电',   emoji: '⚡', color: '#9ec918' },
  { id: 'clover',    name: '四叶草', emoji: '🍀', color: '#40c057' },
  { id: 'fish',      name: '小鱼',   emoji: '🐟', color: '#22b8cf' },
  { id: 'diamond',   name: '钻石',   emoji: '💎', color: '#4dabf7' },
  { id: 'night',     name: '月亮',   emoji: '🌙', color: '#5c7cfa' },
  { id: 'flower',    name: '花朵',   emoji: '🌸', color: '#9775fa' },
  { id: 'heart',     name: '爱心',   emoji: '❤️', color: '#f06595' },
];
const CODE_LEN = 4;
const MAX_GUESSES = 12;
const FAIL_STEPS = 99;
const DAILY_EPOCH = new Date(2026, 0, 1);
const ICON_PATH = id => `assets/icons/${id}.png`;

/* ---------------- 音效 ---------------- */
const SFX_FILES = {
  start: 'game-start',        // 开局
  ui: 'ui-interact',          // 键盘输入/轻交互
  button: 'button',           // 按钮
  completed: 'completed',     // 一无所获的猜测 / 失败收尾
  ability: 'ability',         // 道具
  right: 'right-guess',       // 猜中(有绿块)
  right2: 'right-guess2',     // 沾边(只有黄块)
  daily: 'daily-completed',   // 每日挑战通关
  win: 'game-complete',       // 通关/获胜
  meow: 'meow',               // 彩蛋
};
const SFX = {};
for (const [k, f] of Object.entries(SFX_FILES)) {
  const a = new Audio(`assets/sfx/${f}.mp3`);
  a.preload = 'auto';
  SFX[k] = a;
}
function sfx(name, vol = 0.55) {
  if (!store.sound) return;
  try {
    const a = SFX[name].cloneNode();
    a.volume = vol;
    a.play().catch(() => {});
  } catch (e) { /* 忽略自动播放限制 */ }
}
const typePop = () => sfx('ui', 0.4);

// 所有普通按钮统一按键音(键盘图标键和道具键有自己的音效)
document.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || btn.classList.contains('key') || btn.classList.contains('item-btn')) return;
  sfx('button', 0.45);
}, true);

/* ---------------- 本地存档 ---------------- */
const STORE_KEY = 'codepop-v1';
const store = Object.assign({
  sound: true,
  name: '',
  played: 0, wins: 0, best: 0,
  duelPlayed: 0, duelWins: 0,
  streak: 0, maxStreak: 0, lastDailyWin: '',
  daily: {},          // { '2026-07-16': {steps, win, grid} } 只保留当天
}, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }

/* ---------------- 链接负载(混淆编码) ---------------- */
function b64u(bytes) {
  let s = '';
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
function encodePayload(obj) {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const salt = (Math.random() * 256) | 0;
  const out = new Uint8Array(data.length + 1);
  out[0] = salt;
  for (let i = 0; i < data.length; i++) out[i + 1] = data[i] ^ ((salt * 31 + i * 7) & 0xff);
  return b64u(out);
}
function decodePayload(str) {
  try {
    const raw = unb64u(str);
    const salt = raw[0];
    const data = new Uint8Array(raw.length - 1);
    for (let i = 0; i < data.length; i++) data[i] = raw[i + 1] ^ ((salt * 31 + i * 7) & 0xff);
    const obj = JSON.parse(new TextDecoder().decode(data));
    return (obj && obj.t) ? obj : null;
  } catch (e) { return null; }
}
const baseUrl = () => location.origin.startsWith('http')
  ? location.origin + location.pathname
  : location.href.split('#')[0];
const duelLink = payload => `${baseUrl()}#d=${encodePayload(payload)}`;

/* ---------------- 随机 & 每日密码 ---------------- */
function seededRng(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () {
    h |= 0; h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randomCode(rng = Math.random) {
  const pool = [...Array(ICONS.length).keys()];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, CODE_LEN).join('');
}
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dailyNumber = () => {
  const d = new Date();
  const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((mid - DAILY_EPOCH) / 864e5) + 1;
};
const dailyCode = () => randomCode(seededRng('codepop-' + todayStr()));

/* ---------------- 反馈计算(a=绿块:图标位置全对 b=黄块:图标对位置错) ---------------- */
function judge(secret, guess) {
  let a = 0, b = 0;
  for (let i = 0; i < CODE_LEN; i++) {
    if (guess[i] === secret[i]) a++;
    else if (secret.includes(guess[i])) b++;
  }
  return { a, b };
}

/* ---------------- DOM 快捷 ---------------- */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
function iconTileHTML(idx, cls = 'tile', extra = '') {
  const ic = ICONS[idx];
  return `<div class="${cls}" style="background:${ic.color}" ${extra}><img src="${ICON_PATH(ic.id)}" alt="${ic.name}"></div>`;
}
function chipIconHTML(idx) {
  const ic = ICONS[idx];
  return `<span class="chip-icon" style="background:${ic.color};display:inline-grid;place-items:center;border:1.5px solid var(--ink)"><img src="${ICON_PATH(ic.id)}" style="width:11px;height:11px" alt="${ic.name}"></span>`;
}

/* ---------------- Toast / 弹窗 / 彩带 ---------------- */
function toast(text, icon) {
  const t = el('div', 'toast', (icon ? `<img src="${icon}">` : '') + text);
  $('#toast-zone').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2100);
}
function openModal(html) {
  const mask = $('#modal-mask'), box = $('#modal-box');
  box.innerHTML = html;
  mask.hidden = false;
  return box;
}
function closeModal() {
  const mask = $('#modal-mask');
  mask.hidden = true;
  delete mask.dataset.lock;
  $('#modal-box').innerHTML = '';
  clearInterval(adTimerId); // 任何关闭路径都终止广告倒计时,防止奖励落到别的对局
}
$('#modal-mask').addEventListener('click', e => {
  if (e.target.id === 'modal-mask' && !e.target.dataset.lock) closeModal();
});

function confetti(n = 90) {
  const zone = $('#confetti-zone');
  const colors = ICONS.map(i => i.color);
  for (let i = 0; i < n; i++) {
    const c = el('div', 'confetti');
    const size = 6 + Math.random() * 9;
    c.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size * (0.6 + Math.random())}px;` +
      `background:${colors[(Math.random() * colors.length) | 0]};` +
      `animation-duration:${1.6 + Math.random() * 1.8}s;animation-delay:${Math.random() * .5}s;` +
      `--drift:${(Math.random() * 160 - 80) | 0}px;`;
    zone.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

/* ---------------- 屏幕切换 ---------------- */
const SCREENS = ['screen-home', 'screen-setup', 'screen-play', 'screen-inbox', 'screen-result'];
function showScreen(id) {
  SCREENS.forEach(s => $('#' + s).hidden = (s !== id));
  $('#btn-back').hidden = (id === 'screen-home');
  document.body.dataset.screen = id;
  window.scrollTo(0, 0);
}

/* ============================================================
   游戏引擎
   ============================================================ */
const game = {
  active: false,
  mode: 'free',        // free | daily | duel1(破解好友题) | duel2(迎战反击)
  secret: '',
  guesses: [],         // [{code, a, b}]
  input: [],
  penalty: 0,
  items: { magnet: true, scope: true, ad: true },
  marks: {},           // idx -> '' | 'off' | 'yes'
  revealed: {},        // pos -> iconIdx (望远镜)
  startTime: 0,
  timerId: 0,
  duelCtx: null,       // 对战上下文(收到的payload)
  finished: false,
  pendingEnd: false,   // 终局猜测已提交、正在播放揭示动画
  seq: 0,              // 对局序号,防止异步奖励落到后开的对局
};
let gameSeq = 0;
const stepCount = () => game.guesses.length + game.penalty;

function startGame(mode, secret, duelCtx = null) {
  Object.assign(game, {
    active: true, finished: false, pendingEnd: false, mode, secret,
    guesses: [], input: [], penalty: 0,
    items: { magnet: true, scope: true, ad: true },
    marks: {}, revealed: {},
    duelCtx, startTime: Date.now(),
    seq: ++gameSeq,
  });
  clearInterval(game.timerId);
  game.timerId = setInterval(updateTimer, 500);

  const modeLabel = {
    free: '<img src="assets/icons/dice.png">无尽练习',
    daily: `<img src="assets/icons/sun.png">每日挑战 #${dailyNumber()}`,
    duel1: `<img src="assets/icons/sword.png">破解 ${esc(duelCtx?.n || '好友')} 的密码`,
    duel2: `<img src="assets/icons/shield.png">迎战 ${esc(duelCtx?.bn || '好友')} 的反击`,
  }[mode];
  $('#play-mode').innerHTML = modeLabel;
  $('#intel-bar').hidden = true;
  $('#intel-bar').innerHTML = '';
  ['magnet', 'scope', 'ad'].forEach(k => $('#item-' + k).classList.remove('used'));
  buildKeyboard();
  $('#board').innerHTML = '';
  appendInputRow();
  updateCounters();
  showScreen('screen-play');
  sfx('start', 0.45);
}

function updateTimer() {
  if (!game.active) return;
  const s = ((Date.now() - game.startTime) / 1000) | 0;
  $('#counter-timer').innerHTML = `<img src="assets/icons/clock.png">${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
}
function updateCounters(bump = false) {
  const c = $('#counter-steps');
  c.innerHTML = `<img src="assets/icons/hit.png">${stepCount()} 步`;
  if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
}

/* ---------------- 键盘 ---------------- */
function buildKeyboard() {
  const kb = $('#keyboard');
  kb.innerHTML = '';
  ICONS.forEach((ic, idx) => {
    const k = el('button', 'key');
    k.style.background = ic.color;
    k.dataset.idx = idx;
    k.innerHTML = `<span class="key-num">${idx}</span><img src="${ICON_PATH(ic.id)}" alt="${ic.name}">`;
    attachKeyBehavior(k, idx);
    kb.appendChild(k);
  });
  const del = el('button', 'key key-wide', `<img src="assets/icons/eraser.png" alt="删除">`);
  del.addEventListener('click', () => { inputDelete(); });
  kb.appendChild(del);
  const enter = el('button', 'key key-enter', `<img src="assets/icons/tick.png" alt=""><span>猜!</span>`);
  enter.addEventListener('click', submitGuess);
  kb.appendChild(enter);
  syncKeyMarks();
}
function attachKeyBehavior(k, idx) {
  let lpTimer = 0, longPressed = false;
  const startLP = () => {
    longPressed = false;
    lpTimer = setTimeout(() => { longPressed = true; cycleMark(idx); }, 420);
  };
  const cancelLP = () => clearTimeout(lpTimer);
  k.addEventListener('pointerdown', startLP);
  k.addEventListener('pointerup', cancelLP);
  k.addEventListener('pointerleave', cancelLP);
  k.addEventListener('contextmenu', e => { e.preventDefault(); if (!longPressed) cycleMark(idx); });
  k.addEventListener('click', () => {
    if (longPressed) { longPressed = false; return; }
    inputIcon(idx);
  });
}
function cycleMark(idx) {
  const cur = game.marks[idx] || '';
  game.marks[idx] = cur === '' ? 'off' : cur === 'off' ? 'yes' : '';
  sfx('ui', 0.35);
  syncKeyMarks();
}
function syncKeyMarks() {
  document.querySelectorAll('#keyboard .key[data-idx]').forEach(k => {
    const m = game.marks[k.dataset.idx] || '';
    k.classList.toggle('mark-off', m === 'off');
    k.classList.toggle('mark-yes', m === 'yes');
  });
}

/* ---------------- 输入行 ---------------- */
function appendInputRow() {
  const row = el('div', 'guess-row input-row');
  row.innerHTML = `<span class="row-index">${game.guesses.length + 1}</span><div class="tiles"></div><div class="row-feedback"></div>`;
  const tiles = row.querySelector('.tiles');
  for (let i = 0; i < CODE_LEN; i++) tiles.appendChild(el('div', 'tile empty'));
  $('#board').appendChild(row);
  row.scrollIntoView({ block: 'nearest' });
}
function inputRowTiles() { return document.querySelectorAll('#board .input-row .tile'); }

function inputIcon(idx) {
  if (!game.active || game.finished) return;
  if (!inputRowTiles().length) return; // 揭示动画期间暂不接受输入
  if (game.input.length >= CODE_LEN) return;
  if (game.input.includes(idx)) {
    toast('这局密码不会重复图标哦'); shakeInputRow(); return;
  }
  game.input.push(idx);
  const t = inputRowTiles()[game.input.length - 1];
  const ic = ICONS[idx];
  t.className = 'tile filled';
  t.style.background = ic.color;
  t.innerHTML = `<img src="${ICON_PATH(ic.id)}" alt="${ic.name}">`;
  typePop();
}
function inputDelete() {
  if (!game.active || game.finished || !game.input.length) return;
  if (!inputRowTiles().length) return;
  const t = inputRowTiles()[game.input.length - 1];
  game.input.pop();
  t.className = 'tile empty';
  t.style.background = '';
  t.innerHTML = '';
  sfx('ui', 0.3);
}
function shakeInputRow() {
  inputRowTiles().forEach(t => {
    t.classList.remove('shake-row'); void t.offsetWidth; t.classList.add('shake-row');
  });
}

/* ---------------- 提交 ---------------- */
function submitGuess() {
  if (!game.active || game.finished || game.pendingEnd) return;
  if (game.input.length < CODE_LEN) {
    toast('先摆满 4 个图标'); shakeInputRow(); sfx('ui', 0.4); return;
  }
  const code = game.input.join('');
  if (game.guesses.some(g => g.code === code)) {
    toast('一模一样的组合已经猜过啦,再想想!');
    shakeInputRow(); sfx('ui', 0.45);
    return; // 不消耗步数,保留当前输入让玩家修改
  }
  const { a, b } = judge(game.secret, code);
  game.guesses.push({ code, a, b });
  game.input = [];
  if (a === CODE_LEN || game.guesses.length >= MAX_GUESSES) game.pendingEnd = true; // 终局锁:揭示动画期间禁用道具/提交

  const row = $('#board .input-row');
  row.classList.remove('input-row');
  const tiles = row.querySelectorAll('.tile');
  tiles.forEach((t, i) => {
    setTimeout(() => { t.classList.add('reveal'); typePop(); }, i * 130);
  });
  const fb = row.querySelector('.row-feedback');
  setTimeout(() => {
    fb.innerHTML = feedbackHTML(a, b);
    if (a === CODE_LEN) { /* 胜利音效在 finish 里 */ }
    else if (a > 0) sfx('right', 0.55);
    else if (b > 0) sfx('right2', 0.5);
    else sfx('completed', 0.4);
  }, CODE_LEN * 130 + 120);

  updateCounters(true);

  setTimeout(() => {
    if (a === CODE_LEN) return finishGame(true);
    if (game.guesses.length >= MAX_GUESSES) return finishGame(false);
    appendInputRow();
  }, CODE_LEN * 130 + 350);
}
/* 反馈:4 个小方块,绿=图标位置全对,黄=图标对位置错,灰=没中 */
function feedbackHTML(a, b) {
  let h = '';
  for (let i = 0; i < CODE_LEN; i++) {
    const cls = i < a ? ' peg-hit' : i < a + b ? ' peg-near' : '';
    h += `<span class="peg${cls}" style="animation-delay:${(i * .07).toFixed(2)}s"></span>`;
  }
  return h;
}

/* ---------------- 道具 ---------------- */
function addIntel(html, good) {
  const bar = $('#intel-bar');
  bar.hidden = false;
  bar.appendChild(el('span', 'intel-chip ' + (good ? 'good' : 'bad'), html));
}
$('#item-magnet').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || !game.items.magnet) return;
  let grid = '';
  ICONS.forEach((ic, idx) => {
    grid += `<button class="key" data-pick="${idx}" style="background:${ic.color}"><span class="key-num">${idx}</span><img src="${ICON_PATH(ic.id)}"></button>`;
  });
  const box = openModal(`
    <h3>🧲 磁铁探测</h3>
    <p>选一个图标,磁铁会告诉你它<b>在不在</b>密码里(代价:+1 步)</p>
    <div class="pick-grid">${grid}</div>
    <div class="modal-actions"><button class="big-btn" id="m-cancel">先不用</button></div>`);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
    const idx = +btn.dataset.pick;
    const inCode = game.secret.includes(String(idx));
    game.items.magnet = false;
    game.penalty += 1;
    $('#item-magnet').classList.add('used');
    game.marks[idx] = inCode ? 'yes' : 'off';
    syncKeyMarks();
    addIntel(`<img src="assets/icons/magnet.png">${chipIconHTML(idx)}${inCode ? '在密码里!' : '不在'}`, inCode);
    updateCounters(true);
    closeModal();
    sfx('ability', 0.55);
    toast(inCode ? `${ICONS[idx].name} 在密码里!` : `${ICONS[idx].name} 不在密码里`, ICON_PATH('magnet'));
  }));
});
$('#item-scope').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || !game.items.scope) return;
  let picks = '';
  for (let i = 0; i < CODE_LEN; i++) {
    picks += `<div class="tile" data-pos="${i}">${i + 1}</div>`;
  }
  const box = openModal(`
    <h3>🔭 望远镜偷看</h3>
    <p>选一个位置,直接看到那里的图标(代价:+3 步,慎用!)</p>
    <div class="pos-pick">${picks}</div>
    <div class="modal-actions"><button class="big-btn" id="m-cancel">先不用</button></div>`);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelectorAll('[data-pos]').forEach(t => t.addEventListener('click', () => {
    const pos = +t.dataset.pos;
    const idx = +game.secret[pos];
    game.items.scope = false;
    game.penalty += 3;
    $('#item-scope').classList.add('used');
    game.revealed[pos] = idx;
    game.marks[idx] = 'yes';
    syncKeyMarks();
    addIntel(`<img src="assets/icons/binoculars.png">第${pos + 1}位 = ${chipIconHTML(idx)}`, true);
    updateCounters(true);
    closeModal();
    sfx('ability', 0.5);
    toast(`第 ${pos + 1} 位是 ${ICONS[idx].name}!`, ICON_PATH('binoculars'));
  }));
});

/* ---------------- 假广告:看 15 秒,3 秒后可跳过(跳过没奖励) ---------------- */
let adTimerId = 0;
$('#item-ad').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || !game.items.ad) return;
  const candidates = ICONS.map((_, i) => i)
    .filter(i => !game.secret.includes(String(i)) && game.marks[i] !== 'off');
  if (!candidates.length) { toast('没有可排除的图标啦,广告小猫也帮不上忙', ICON_PATH('video')); return; }
  const seqAtOpen = game.seq;
  const gif = Math.random() < 0.5 ? 'cat_add.gif' : 'dance.gif';
  openModal(`
    <h3>📺 广告时间</h3>
    <div class="ad-stage">
      <img class="ad-gif" src="assets/ads/${gif}" alt="广告">
      <span class="ad-tag">广告 · AD</span>
      <span class="ad-count" id="ad-count">15</span>
    </div>
    <p style="text-align:center">看完广告,小猫帮你<b>排除一个不在密码里的图标</b></p>
    <div class="ad-actions" id="ad-actions"></div>`);
  $('#modal-mask').dataset.lock = '1';
  let left = 15;
  clearInterval(adTimerId);
  const closeAd = reward => {
    closeModal(); // closeModal 会清倒计时和锁
    if (!reward) { toast('广告没看完,小猫抱着线索走了…', ICON_PATH('cat')); return; }
    // 对局已结束/已切换时,奖励作废
    if (!game.active || game.finished || game.pendingEnd || game.seq !== seqAtOpen) return;
    const idx = candidates[(Math.random() * candidates.length) | 0];
    game.items.ad = false;
    $('#item-ad').classList.add('used');
    game.marks[idx] = 'off';
    syncKeyMarks();
    addIntel(`<img src="assets/icons/video.png">${chipIconHTML(idx)}不在(喵)`, false);
    sfx('ability', 0.55);
    sfx('meow', 0.6);
    toast(`广告小猫说:${ICONS[idx].name} 不在密码里!`, ICON_PATH('cat'));
  };
  adTimerId = setInterval(() => {
    left--;
    const cnt = $('#ad-count');
    if (!cnt) { clearInterval(adTimerId); return; } // 弹窗已被别处关闭
    cnt.textContent = left;
    if (left === 12) {
      const skip = el('button', 'big-btn', '跳过广告(放弃奖励)');
      skip.addEventListener('click', () => closeAd(false));
      $('#ad-actions').appendChild(skip);
    }
    if (left <= 0) closeAd(true);
  }, 1000);
});

$('#btn-giveup').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd) return;
  const box = openModal(`
    <h3>👻 确定认输?</h3>
    <p>会直接揭晓答案${game.mode === 'daily' ? ',并中断每日连胜' : ''}${game.mode.startsWith('duel') ? ',对战将记为「未破解」' : ''}。</p>
    <div class="modal-actions">
      <button class="big-btn" id="m-cancel">再挣扎一下</button>
      <button class="big-btn primary" id="m-yes">认输</button>
    </div>`);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-yes').addEventListener('click', () => { closeModal(); finishGame(false, true); });
});

/* ---------------- 结束 ---------------- */
function finishGame(win, surrendered = false) {
  if (game.finished) return;
  game.finished = true;
  game.active = false;
  closeModal(); // 关掉还开着的弹窗(含广告),对局结束一切归零
  clearInterval(game.timerId);
  const steps = win ? stepCount() : FAIL_STEPS;
  const timeSec = ((Date.now() - game.startTime) / 1000) | 0;
  const grid = game.guesses.map(g => g.a + ',' + g.b);

  if (win) {
    sfx(game.mode === 'daily' ? 'daily' : 'win', 0.6);
    confetti();
    document.querySelectorAll('#board .guess-row:last-child .tile').forEach((t, i) => {
      setTimeout(() => t.classList.add('win-dance'), i * 90);
    });
  } else {
    sfx('completed', 0.45);
  }

  // 存档统计
  store.played++;
  if (win) {
    store.wins++;
    if (!store.best || steps < store.best) {
      store.best = steps;
      if (store.played > 1) setTimeout(() => toast('新纪录!', ICON_PATH('ranking')), 1200);
    }
  }
  if (game.mode === 'daily') {
    const today = todayStr();
    store.daily = { [today]: { steps: win ? steps : FAIL_STEPS, win, grid } };
    if (win) {
      const yest = new Date(); yest.setDate(yest.getDate() - 1);
      const yestStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
      store.streak = (store.lastDailyWin === yestStr) ? store.streak + 1 : 1;
      store.maxStreak = Math.max(store.maxStreak, store.streak);
      store.lastDailyWin = today;
    } else {
      store.streak = 0;
    }
  }
  save();

  setTimeout(() => renderResult({ win, steps, timeSec, surrendered }), win ? 1400 : 700);
}

/* ---------------- 战报文本 ---------------- */
const emojiRow = g => {
  const [a, b] = g.split(',').map(Number);
  return '🟢'.repeat(a) + '🟡'.repeat(b) + '⚪'.repeat(CODE_LEN - a - b);
};
function shareGrid(grid) { return grid.map(emojiRow).join('\n'); }
function starCount(steps) { return steps <= 4 ? 3 : steps <= 7 ? 2 : 1; }
function starsHTML(n) {
  let h = '';
  for (let i = 0; i < 3; i++) h += `<img src="assets/icons/star5.png" class="${i < n ? '' : 'dim'}">`;
  return `<div class="result-stars">${h}</div>`;
}
function stepsLabel(s) { return s >= FAIL_STEPS ? '未破解' : s + ' 步'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function copyText(text, okMsg = '已复制,快去粘贴给好友!') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, ICON_PATH('copy'));
  } catch (e) {
    const ta = el('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
    toast(okMsg, ICON_PATH('copy'));
  }
}
function shareOrCopy(text) {
  if (navigator.share) navigator.share({ text }).catch(() => copyText(text));
  else copyText(text);
}

/* ---------------- 结算界面 ---------------- */
function answerStripHTML(code) {
  return `<div class="answer-strip">${[...code].map(c => iconTileHTML(+c)).join('')}</div>`;
}
function renderResult({ win, steps, timeSec, surrendered }) {
  const card = $('#result-card');
  const timeStr = `${(timeSec / 60) | 0}分${timeSec % 60}秒`;
  const grid = game.guesses.map(g => g.a + ',' + g.b);
  let html = '';

  if (game.mode === 'daily' || game.mode === 'free') {
    const title = win ? ['密码破解!', '全部猜中!', '解码天才!'][(Math.random() * 3) | 0] : (surrendered ? '下次再战' : '密码逃走了…');
    const shareText = game.mode === 'daily'
      ? `CodePop 解码对决 每日挑战 #${dailyNumber()}\n${win ? `${steps} 步破解 ${'⭐'.repeat(starCount(steps))}` : '未能破解 💦'}\n${shareGrid(grid)}\n${baseUrl()}`
      : `我在 CodePop 用 ${stepsLabel(steps)} 破解了随机密码!\n${shareGrid(grid)}\n你也来试试:${baseUrl()}`;
    html = `
      <img class="card-icon" src="assets/icons/${win ? 'crown' : 'ghost'}.png">
      <div class="card-title">${title}</div>
      ${win ? starsHTML(starCount(steps)) : ''}
      <div class="card-sub">${win ? `${steps} 步 · 用时 ${timeStr}` : '答案是——'}</div>
      ${answerStripHTML(game.secret)}
      ${game.mode === 'daily' ? `<div class="card-sub">🔥 连胜 ${store.streak} 天(最高 ${store.maxStreak})</div>` : ''}
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">分享战报</button>
        ${game.mode === 'free' ? `<button class="big-btn blue" id="r-again"><img src="assets/icons/dice.png">再来一局</button>` : ''}
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    card.innerHTML = html;
    $('#r-share').addEventListener('click', () => shareOrCopy(shareText));
    if ($('#r-again')) $('#r-again').addEventListener('click', () => startGame('free', randomCode()));
    $('#r-home').addEventListener('click', goHome);
  }

  else if (game.mode === 'duel1') {
    // 我(B)刚破解完好友(A)的密码 → 反击 or 只发战报
    const p = game.duelCtx;
    store.duelPlayed++; save();
    const myResult = { steps: win ? steps : FAIL_STEPS, grid };
    html = `
      <img class="card-icon" src="assets/icons/${win ? 'sword' : 'heart-break'}.png">
      <div class="card-title">${win ? `破解了 ${esc(p.n)} 的密码!` : `没能破解 ${esc(p.n)} 的密码`}</div>
      <div class="card-sub">${win ? `${steps} 步 · 用时 ${timeStr}` : '答案是——'}</div>
      ${win ? '' : answerStripHTML(game.secret)}
      <div class="card-sub">现在<b>布置你的密码反击</b>,把链接发回去,步数少的人获胜!</div>
      <div class="card-actions">
        <button class="big-btn primary" id="r-counter"><img src="assets/icons/sword.png">出题反击</button>
        <button class="big-btn" id="r-report"><img src="assets/icons/paper-plane.png">不反击,只发战报</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    card.innerHTML = html;
    $('#r-counter').addEventListener('click', () => openSetup('counter', { orig: p, myResult }));
    $('#r-report').addEventListener('click', () => {
      const link = duelLink({ t: 'c2f', an: p.n, bn: myName(), ac: p.c, bs: myResult.steps, bg: grid });
      showShareModal('战报链接已生成', `把链接发给 ${esc(p.n)},TA 就能看到你的战绩`, link,
        `我${win ? `只用 ${steps} 步就` : '没能'}破解了你的图标密码!\n${shareGrid(grid)}\n${link}`);
    });
    $('#r-home').addEventListener('click', goHome);
  }

  else if (game.mode === 'duel2') {
    // 我(A)刚打完好友(B)的反击题 → 直接判决 + 生成判决链接
    const p = game.duelCtx;
    const as = win ? steps : FAIL_STEPS;
    const bs = p.bs;
    store.duelPlayed++;
    const verdict = verdictOf(as, bs);
    if (verdict === 'me') store.duelWins++;
    save();
    const link = duelLink({ t: 'c3', an: p.an, bn: p.bn, as, bs });
    const shareText = `CodePop 对决判决书 ⚖️\n${esc(p.an)}:${stepsLabel(as)} vs ${esc(p.bn)}:${stepsLabel(bs)}\n${verdictText(verdict, p.an, p.bn)}\n${link}`;
    card.innerHTML = `
      ${verdictHTML(verdict, { name: p.an, steps: as }, { name: p.bn, steps: bs })}
      <div class="card-sub">把判决书发给 ${esc(p.bn)},让 TA 心服口服!</div>
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">发送判决书</button>
        <button class="big-btn blue" id="r-rematch"><img src="assets/icons/sword.png">再战一局</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    if (verdict === 'me') { sfx('win', 0.5); confetti(60); }
    $('#r-share').addEventListener('click', () => shareOrCopy(shareText));
    $('#r-rematch').addEventListener('click', () => openSetup('c1'));
    $('#r-home').addEventListener('click', goHome);
  }

  showScreen('screen-result');
}
function verdictOf(as, bs) { return as < bs ? 'me' : bs < as ? 'them' : 'tie'; }
function verdictText(v, an, bn) {
  return v === 'me' ? `👑 ${an} 获胜!` : v === 'them' ? `👑 ${bn} 获胜!` : '🤝 平局,棋逢对手!';
}
function verdictHTML(v, me, them) {
  // me = 当前视角(A);them = 对手(B)
  const crown = `<img class="vs-crown" src="assets/icons/crown.png">`;
  return `
    <img class="card-icon" src="assets/icons/${v === 'me' ? 'crown' : v === 'them' ? 'heart-break' : 'friends'}.png">
    <div class="card-title">${v === 'me' ? '你赢了!' : v === 'them' ? '惜败!' : '平局!'}</div>
    <div class="vs-table">
      <div class="vs-side ${v === 'me' ? 'winner' : ''}">${v === 'me' ? crown : ''}
        <div class="vs-name">${esc(me.name)}</div><div class="vs-steps">${me.steps >= FAIL_STEPS ? '💥' : me.steps}</div><div class="vs-label">${stepsLabel(me.steps)}</div>
      </div>
      <div class="vs-side ${v === 'them' ? 'winner' : ''}">${v === 'them' ? crown : ''}
        <div class="vs-name">${esc(them.name)}</div><div class="vs-steps">${them.steps >= FAIL_STEPS ? '💥' : them.steps}</div><div class="vs-label">${stepsLabel(them.steps)}</div>
      </div>
    </div>`;
}

/* ============================================================
   出题(新对战 / 反击)
   ============================================================ */
const setup = { picks: [], mode: 'c1', ctx: null };
function myName() { return store.name || '神秘玩家'; }

function openSetup(mode, ctx = null) {
  setup.picks = [];
  setup.mode = mode;
  setup.ctx = ctx;
  $('#setup-title').textContent = mode === 'counter' ? '布置反击密码!' : '布置你的图标密码';
  $('#setup-name').value = store.name;
  $('#setup-msg').value = '';
  renderSetupSlots();
  buildSetupKeyboard();
  showScreen('screen-setup');
}
function renderSetupSlots() {
  const wrap = $('#setup-slots');
  wrap.innerHTML = '';
  for (let i = 0; i < CODE_LEN; i++) {
    const idx = setup.picks[i];
    if (idx === undefined) {
      wrap.appendChild(el('div', 'tile empty'));
    } else {
      const t = el('div', 'tile filled');
      t.style.background = ICONS[idx].color;
      t.innerHTML = `<img src="${ICON_PATH(ICONS[idx].id)}">`;
      t.title = '点击移除';
      t.addEventListener('click', () => { setup.picks.splice(i, 1); sfx('ui', 0.35); renderSetupSlots(); syncSetupKeys(); });
      wrap.appendChild(t);
    }
  }
}
function buildSetupKeyboard() {
  const kb = $('#setup-keyboard');
  kb.innerHTML = '';
  ICONS.forEach((ic, idx) => {
    const k = el('button', 'key');
    k.style.background = ic.color;
    k.dataset.sidx = idx;
    k.innerHTML = `<span class="key-num">${idx}</span><img src="${ICON_PATH(ic.id)}">`;
    k.addEventListener('click', () => {
      if (setup.picks.includes(idx)) {
        setup.picks = setup.picks.filter(p => p !== idx);
      } else {
        if (setup.picks.length >= CODE_LEN) { toast('已经挑满 4 个啦'); return; }
        setup.picks.push(idx);
      }
      typePop();
      renderSetupSlots();
      syncSetupKeys();
    });
    kb.appendChild(k);
  });
  syncSetupKeys();
}
function syncSetupKeys() {
  document.querySelectorAll('#setup-keyboard .key').forEach(k => {
    k.classList.toggle('mark-yes', setup.picks.includes(+k.dataset.sidx));
  });
}
$('#btn-setup-random').addEventListener('click', () => {
  setup.picks = randomCode().split('').map(Number);
  renderSetupSlots();
  syncSetupKeys();
});
$('#btn-setup-go').addEventListener('click', () => {
  if (setup.picks.length < CODE_LEN) { toast('先挑满 4 个图标'); return; }
  store.name = $('#setup-name').value.trim().slice(0, 8);
  save();
  const code = setup.picks.join('');
  const msg = $('#setup-msg').value.trim().slice(0, 20);

  if (setup.mode === 'counter') {
    const { orig, myResult } = setup.ctx;
    const link = duelLink({ t: 'c2', an: orig.n, bn: myName(), ac: orig.c, c: code, bs: myResult.steps, m: msg });
    const bsLabel = stepsLabel(myResult.steps);
    showShareModal('反击链接已生成!', `发给 ${esc(orig.n)}:TA 会先看到你的战绩(${bsLabel}),再挑战你的密码,一决胜负!`, link,
      `我${myResult.steps >= FAIL_STEPS ? '没能破解' : `用 ${myResult.steps} 步破解了`}你的图标密码,现在轮到你了!敢接招吗?\n${link}`);
  } else {
    const link = duelLink({ t: 'c1', n: myName(), c: code, m: msg });
    showShareModal('挑战链接已生成!', '发给好友,TA 打开就能开猜。你自己可别点开偷看哦~', link,
      `我在「CodePop」藏了一组图标密码,敢来破译吗?\n${link}`);
  }
});
function showShareModal(title, sub, link, shareText) {
  const box = openModal(`
    <h3>${title}</h3>
    <p style="text-align:center">${sub}</p>
    <div class="share-box">${esc(shareText)}</div>
    <div class="modal-actions">
      <button class="big-btn green" id="s-copy"><img src="assets/icons/copy.png">复制</button>
      ${navigator.share ? '<button class="big-btn blue" id="s-share"><img src="assets/icons/share.png">分享</button>' : ''}
    </div>
    <div class="modal-actions"><button class="big-btn" id="s-home"><img src="assets/icons/arrow-left.png">回主页</button></div>`);
  sfx('ability', 0.45);
  box.querySelector('#s-copy').addEventListener('click', () => copyText(shareText));
  if (box.querySelector('#s-share')) box.querySelector('#s-share').addEventListener('click', () => navigator.share({ text: shareText }).catch(() => {}));
  box.querySelector('#s-home').addEventListener('click', () => { closeModal(); goHome(); });
}

/* ============================================================
   收件箱:打开好友链接
   ============================================================ */
function handleIncoming(p) {
  const card = $('#inbox-card');
  if (p.t === 'c1') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/sword.png">
      <div class="card-title">${esc(p.n)} 向你发起挑战!</div>
      ${p.m ? `<div class="card-msg">“${esc(p.m)}”</div>` : ''}
      <div class="card-sub">TA 藏了一组 4 个图标的密码。<br>每猜一次,小方块帮你打分:<br><span class="peg peg-hit" style="vertical-align:-2px"></span> 图标对,位置也对&nbsp;&nbsp;<span class="peg peg-near" style="vertical-align:-2px"></span> 图标对,位置不对<br>用最少的步数破解它!</div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-go"><img src="assets/icons/sword.png">开始破解</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">先不了</button>
      </div>`;
    $('#i-go').addEventListener('click', () => startGame('duel1', p.c, p));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c2') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/shield.png">
      <div class="card-title">${esc(p.bn)} 应战了!</div>
      ${p.m ? `<div class="card-msg">“${esc(p.m)}”</div>` : ''}
      <div class="card-sub">TA ${p.bs >= FAIL_STEPS ? '<b>没能破解</b>你的密码 💥' : `用 <b>${p.bs} 步</b>破解了你的密码`},并布下了反击密码。<br>轮到你了——用更少的步数赢下对决!</div>
      <div class="vs-table">
        <div class="vs-side"><div class="vs-name">${esc(p.an)}(你)</div><div class="vs-steps">?</div><div class="vs-label">等你出手</div></div>
        <div class="vs-side"><div class="vs-name">${esc(p.bn)}</div><div class="vs-steps">${p.bs >= FAIL_STEPS ? '💥' : p.bs}</div><div class="vs-label">${stepsLabel(p.bs)}</div></div>
      </div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-go"><img src="assets/icons/shield.png">迎战!</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">先不了</button>
      </div>`;
    $('#i-go').addEventListener('click', () => startGame('duel2', p.c, p));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c2f') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/paper-plane.png">
      <div class="card-title">来自 ${esc(p.bn)} 的战报</div>
      <div class="card-sub">你的密码被 ${esc(p.bn)} ${p.bs >= FAIL_STEPS ? '<b>挑战失败</b> 💥 没猜出来!' : `用 <b>${p.bs} 步</b>破解了!`}</div>
      ${p.bg ? `<div class="share-box" style="text-align:center">${shareGrid(p.bg)}</div>` : ''}
      <div class="card-actions">
        <button class="big-btn primary" id="i-rematch"><img src="assets/icons/sword.png">回敬一题</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    $('#i-rematch').addEventListener('click', () => openSetup('c1'));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c3') {
    // B 查看最终判决(视角:bn)
    const v = verdictOf(p.bs, p.as); // 从 B 视角
    card.innerHTML = `
      ${verdictHTML(v, { name: p.bn, steps: p.bs }, { name: p.an, steps: p.as })}
      <div class="card-sub">${v === 'me' ? '实至名归,解码之王!' : v === 'them' ? '差一点点,报仇雪恨走起!' : '棋逢对手,将遇良才!'}</div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-rematch"><img src="assets/icons/sword.png">再来一局</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    if (v === 'me') { setTimeout(() => { confetti(70); sfx('win', 0.5); }, 400); }
    $('#i-rematch').addEventListener('click', () => openSetup('c1'));
    $('#i-home').addEventListener('click', goHome);
  }
  else {
    goHome();
    return;
  }
  showScreen('screen-inbox');
}

/* ============================================================
   主页 & 导航
   ============================================================ */
function renderHomeStats() {
  const s = $('#home-stats');
  const chips = [];
  if (store.streak > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/sun.png">连胜 <b>${store.streak}</b> 天</span>`);
  if (store.wins > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/tick.png">破解 <b>${store.wins}</b> 次</span>`);
  if (store.best > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/ranking.png">最佳 <b>${store.best}</b> 步</span>`);
  if (store.duelWins > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/crown.png">对战赢 <b>${store.duelWins}</b> 场</span>`);
  s.innerHTML = chips.join('') || `<span class="stat-chip">✨ 第一次玩?点右上角 <b>?</b> 看玩法</span>`;
}
function renderHeroTiles() {
  const wrap = $('#hero-tiles');
  wrap.innerHTML = randomCode().split('').map(c => iconTileHTML(+c)).join('');
}
function goHome() {
  closeModal();
  clearInterval(game.timerId);
  game.active = false;
  if (location.hash) history.replaceState(null, '', baseUrl());
  renderHomeStats();
  renderHeroTiles();
  showScreen('screen-home');
}

$('#btn-back').addEventListener('click', () => {
  if (game.active && game.guesses.length > 0 && !game.finished) {
    const box = openModal(`
      <h3>要离开对局吗?</h3>
      <p>当前进度不会保存哦。</p>
      <div class="modal-actions">
        <button class="big-btn" id="m-stay">继续玩</button>
        <button class="big-btn primary" id="m-leave">离开</button>
      </div>`);
    box.querySelector('#m-stay').addEventListener('click', closeModal);
    box.querySelector('#m-leave').addEventListener('click', () => { closeModal(); goHome(); });
  } else {
    goHome();
  }
});

$('#btn-duel').addEventListener('click', () => openSetup('c1'));
$('#btn-free').addEventListener('click', () => startGame('free', randomCode()));
$('#btn-daily').addEventListener('click', () => {
  const today = todayStr();
  const done = store.daily[today];
  if (done) {
    // 已完成:直接展示战报
    const shareText = `CodePop 解码对决 每日挑战 #${dailyNumber()}\n${done.win ? `${done.steps} 步破解 ${'⭐'.repeat(starCount(done.steps))}` : '未能破解 💦'}\n${shareGrid(done.grid)}\n${baseUrl()}`;
    $('#result-card').innerHTML = `
      <img class="card-icon" src="assets/icons/sun.png">
      <div class="card-title">今日挑战已完成</div>
      <div class="card-sub">${done.win ? `${done.steps} 步破解 · 🔥 连胜 ${store.streak} 天` : '今天没能破解,明天再战!'}<br>明天 0 点刷新新密码</div>
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">分享战报</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">回主页</button>
      </div>`;
    $('#r-share').addEventListener('click', () => shareOrCopy(shareText));
    $('#r-home').addEventListener('click', goHome);
    showScreen('screen-result');
    return;
  }
  startGame('daily', dailyCode());
});

/* ---------------- 声音 / 帮助 / 彩蛋 ---------------- */
function syncSoundBtn() {
  $('#btn-sound').classList.toggle('muted', !store.sound);
  $('#btn-sound img').src = store.sound ? 'assets/icons/volume.png' : 'assets/icons/no-music.png';
}
$('#btn-sound').addEventListener('click', () => {
  store.sound = !store.sound;
  save();
  syncSoundBtn();
  if (store.sound) sfx('button', 0.5);
});
$('#logo').addEventListener('click', () => { sfx('meow', 0.6); });

$('#btn-help').addEventListener('click', () => {
  openModal(`
    <h3>🎯 怎么玩</h3>
    <p><b>目标:</b>密码是 <b>4 个不重复</b>的图标。用最少的步数,猜出<b>是哪 4 个</b>、<b>按什么顺序</b>排的。</p>
    <p><b>每猜一次,右边的 4 个小方块给你打分:</b><br>
    <span class="peg peg-hit" style="vertical-align:-2px"></span> <b>绿块</b>:有 1 个图标猜对了,位置也对<br>
    <span class="peg peg-near" style="vertical-align:-2px"></span> <b>黄块</b>:有 1 个图标在密码里,但位置放错了<br>
    <span class="peg" style="vertical-align:-2px"></span> <b>灰块</b>:什么都没中</p>
    <div class="help-example">
      ${iconTileHTML(0)}${iconTileHTML(2)}${iconTileHTML(4)}${iconTileHTML(7)}
      <div class="help-fb">${feedbackHTML(2, 0)}</div>
    </div>
    <p style="text-align:center;font-size:12.5px">例:密码是 🍎⭐🐱🌸,你猜 🍎⭐🍀🌙 → 两个绿块(🍎⭐位置全对)</p>
    <p>注意:方块<b>不会告诉你对的是哪一个</b>——推理出来才过瘾!</p>
    <p><b>道具:</b>🧲 磁铁问一个图标在不在(+1步) · 🔭 望远镜偷看一个位置(+3步) · 📺 看 15 秒小广告,免费排除一个不在的图标</p>
    <p><b>小技巧:</b>长按或右键键盘图标,可以标记「排除/锁定」帮助推理。</p>
    <p><b>好友对战:</b>布置密码 → 发链接给好友 → TA 破解后出题反击 → 你迎战 → 步数少者赢!全程异步,随时接招。</p>
    <div class="modal-actions"><button class="big-btn primary" id="m-ok">明白了!</button></div>`)
    .querySelector('#m-ok').addEventListener('click', closeModal);
});

/* ---------------- 物理键盘 ---------------- */
document.addEventListener('keydown', e => {
  if (!$('#modal-mask').hidden) return; // 弹窗打开时不接受棋盘输入
  if (!$('#screen-play').hidden && game.active && !game.finished) {
    if (/^[0-9]$/.test(e.key)) inputIcon(+e.key);
    else if (e.key === 'Backspace') inputDelete();
    else if (e.key === 'Enter') submitGuess();
  }
});

/* ---------------- 背景:飞行的小图标 ---------------- */
(function spawnFloaters() {
  const zone = $('#bg-zone');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // 减弱动效:静态散布,不飞
  const count = innerWidth < 480 ? 9 : 13;
  for (let i = 0; i < count; i++) {
    const ic = ICONS[(Math.random() * ICONS.length) | 0];
    const f = el('div', 'bg-float', `<img src="${ICON_PATH(ic.id)}" alt="">`);
    const size = 26 + Math.random() * 28;
    const op = (0.16 + Math.random() * 0.2).toFixed(2);
    f.style.cssText = `left:${(Math.random() * 94) | 0}vw;width:${size | 0}px;height:${size | 0}px;` +
      `background:${ic.color};` +
      `--drift:${(Math.random() * 140 - 70) | 0}px;` +
      `--r0:${(Math.random() * 26 - 13) | 0}deg;--r1:${(Math.random() * 26 - 13) | 0}deg;` +
      `--op:${op};` +
      `animation-duration:${(14 + Math.random() * 16) | 0}s;animation-delay:${-(Math.random() * 30) | 0}s;`;
    if (calm) {
      f.style.animation = 'none';
      f.style.bottom = `${(4 + Math.random() * 88) | 0}vh`;
      f.style.opacity = op;
      f.style.transform = `rotate(${(Math.random() * 26 - 13) | 0}deg)`;
    }
    zone.appendChild(f);
  }
})();

/* ---------------- 启动 ---------------- */
window.addEventListener('hashchange', () => {
  const m = location.hash.match(/#d=([A-Za-z0-9_-]+)/);
  if (m) {
    const p = decodePayload(m[1]);
    if (p) { closeModal(); clearInterval(game.timerId); game.active = false; handleIncoming(p); }
  }
});

(function boot() {
  syncSoundBtn();
  // 清理过期的每日记录
  const today = todayStr();
  for (const k of Object.keys(store.daily)) if (k !== today) delete store.daily[k];
  save();

  const m = location.hash.match(/#d=([A-Za-z0-9_-]+)/);
  if (m) {
    const p = decodePayload(m[1]);
    if (p) { renderHomeStats(); renderHeroTiles(); handleIncoming(p); return; }
    toast('链接好像坏掉了…');
  }
  goHome();
})();
