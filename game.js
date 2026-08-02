/* ============================================================
   码上猜 CodePop — 好友对战猜图标密码
   纯静态实现：密码通过混淆链接在好友间传递，无需服务器
   ============================================================ */
'use strict';

/* ---------------- 常量 ---------------- */
const ICONS = [
  { id: 'apple',     name: t('苹果'),   emoji: '🍎', color: '#ff5a5f' },
  { id: 'cat',       name: t('猫咪'),   emoji: '🐱', color: '#ff922b' },
  { id: 'star',      name: t('星星'),   emoji: '⭐', color: '#f5b301' },
  { id: 'lightning', name: t('闪电'),   emoji: '⚡', color: '#9ec918' },
  { id: 'clover',    name: t('四叶草'), emoji: '🍀', color: '#40c057' },
  { id: 'fish',      name: t('小鱼'),   emoji: '🐟', color: '#22b8cf' },
  { id: 'diamond',   name: t('钻石'),   emoji: '💎', color: '#4dabf7' },
  { id: 'night',     name: t('月亮'),   emoji: '🌙', color: '#5c7cfa' },
  { id: 'flower',    name: t('花朵'),   emoji: '🌸', color: '#9775fa' },
  { id: 'heart',     name: t('爱心'),   emoji: '❤️', color: '#f06595' },
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
  right: 'right-guess',       // 猜中（有绿块）
  right2: 'right-guess2',     // 沾边（只有黄块）
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

// 所有普通按钮统一按键音（键盘图标键和道具键有自己的音效）
document.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || btn.classList.contains('key') || btn.classList.contains('item-btn')) return;
  sfx('button', 0.45);
}, true);

/* ---------------- 本地存档 ---------------- */
const STORE_KEY = 'codepop-v1';
const store = Object.assign({
  sound: true,
  lang: '',   // 空 = 跟随浏览器语言;用户在 🌐 里选过才落值
  name: '',
  played: 0, wins: 0, best: 0,
  duelPlayed: 0, duelWins: 0,
  streak: 0, maxStreak: 0, lastDailyWin: '',
  daily: {},          // { '2026-07-16': {steps, win, grid} } 只保留当天
  dailyRun: null,     // 进行中的每日局(刷新/崩溃可恢复,结算后清空)
  stats: {},          // 本地统计:{ mode: { plays, wins, stepsHist: {n:次数} } }
  ftue: {},           // 一次性引导标记:{ goal: 1, mark: 1 }
}, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }

/* ---------------- 链接负载（混淆编码） ---------------- */
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
/* 分享/对战链接的落地页:在 itch 等第三方镜像(iframe CDN,更新会换地址)上运行时,
   链接一律指向正式站,保证对战链条和战报永远可达 */
const CANONICAL_URL = 'https://jiulou0619.github.io/CodeGuesser/';
const MIRROR_HOSTS = /\.(itch\.zone|itch\.io|hwcdn\.net)$/;
const baseUrl = () => {
  if (MIRROR_HOSTS.test(location.hostname)) return CANONICAL_URL;
  return location.origin.startsWith('http')
    ? location.origin + location.pathname
    : location.href.split('#')[0];
};
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

/* ---------------- 反馈计算（a=位置也对 b=图标对但位置错） ----------------
   多重集版本：支持变体里图标重复出现的密码，经典局（全不重复）结果与旧算法一致 */
function judge(secret, guess) {
  let a = 0, b = 0;
  const sLeft = {}, gLeft = {};
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) a++;
    else {
      sLeft[secret[i]] = (sLeft[secret[i]] || 0) + 1;
      gLeft[guess[i]] = (gLeft[guess[i]] || 0) + 1;
    }
  }
  for (const k in gLeft) b += Math.min(gLeft[k], sLeft[k] || 0);
  return { a, b };
}

/* ---------------- 变奏模式:每局一条公开规则,重塑解题方式 ---------------- */
const VARIANTS = [
  {
    id: 'twin', name: t('双影日'), emoji: '👯', len: 5, allowDup: true,
    rule: t('有一对双胞胎图标混进了密码!5 个格子里,恰好有一个图标出现两次,而且双胞胎永远手拉手紧挨着;其余 3 个图标互不相同。'),
    tip: t('老开局今天会失灵——故意摆一对相同图标去"钓"双胞胎,才是今天的妙手。'),
    gen(rng = Math.random) {
      const twin = (rng() * ICONS.length) | 0;
      const pairPos = (rng() * 4) | 0; // 双影占据 pairPos 和 pairPos+1
      const rest = [...Array(ICONS.length).keys()].filter(i => i !== twin);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const code = [];
      let r = 0;
      for (let p = 0; p < 5; p++) {
        if (p === pairPos || p === pairPos + 1) code.push(twin);
        else code.push(rest[r++]);
      }
      return code.join('');
    },
  },
  {
    id: 'robot', name: t('对手日'), emoji: '🤖', len: 4, allowDup: false, robot: true,
    rule: t('一个机器人在和你抢同一个密码:你猜一行,它猜一行,先猜中的赢!它的每行猜测和反馈都完全公开。'),
    tip: t('它的情报你可以随便偷看——落后就大胆抢答,领先就稳稳收网,赢它一行的感觉好极了。'),
    gen(rng = Math.random) { return randomCode(rng); },
  },
  {
    id: 'honey', name: t('黏黏日'), emoji: '🍯', len: 4, allowDup: false, maxG: 9, honey: true,
    rule: t('猜对图标且位置也对的格子,会被蜜糖当场粘住:直接亮出正确图标,之后每一行自动帮你填好!代价是——只有 9 次机会。'),
    tip: t('让同一个图标在不同行换位置巡逻,是钓蜜糖的妙招;每粘住一格,棋盘就小一圈。'),
    gen(rng = Math.random) { return randomCode(rng); },
  },
  {
    id: 'tweak', name: t('锁匠日'), emoji: '🗝', len: 4, allowDup: false, tweak: true, maxG: 14,
    rule: t('像真锁匠一样细细开锁:从第 2 猜起,每次只能在上一行基础上「换掉 1 格」,或「交换 2 格」的位置。'),
    tip: t('每次只动一处,盯紧两颗胶囊的涨跌——那就是锁芯的咔哒声,每一下都在告诉你方向。'),
    gen(rng = Math.random) { return randomCode(rng); },
  },
  {
    id: 'chain', name: t('接龙日'), emoji: '🔗', len: 4, allowDup: false, chain: true,
    rule: t('今天不看位置,看牵手:「相邻」告诉你——你这行紧挨着的 3 对图标里,有几对在密码里也以同样的左右顺序紧挨着。'),
    tip: t('先用「图案」找齐 4 位成员,再交换顺序试探谁牵着谁——确认一对相邻,就同时锁死了两格的关系。'),
    gen(rng = Math.random) { return randomCode(rng); },
  },
];

/* 接龙日:数猜测的 3 个有序相邻对里,有几对也在密码里以同序紧挨 */
function chainPairs(secret, guess) {
  let m = 0;
  for (let i = 0; i < guess.length - 1; i++) {
    for (let j = 0; j < secret.length - 1; j++) {
      if (guess[i] === secret[j] && guess[i + 1] === secret[j + 1]) { m++; break; }
    }
  }
  return m;
}

/* 对手日:机器人只看自己的历史反馈,从相容候选里确定性抽取下一猜(种子随密码固定,全局无中途随机) */
let ALL_CODES = null;
function allCodes() {
  if (ALL_CODES) return ALL_CODES;
  ALL_CODES = [];
  for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) for (let c = 0; c < 10; c++) for (let d = 0; d < 10; d++) {
    if (a !== b && a !== c && a !== d && b !== c && b !== d && c !== d) ALL_CODES.push('' + a + b + c + d);
  }
  return ALL_CODES;
}
function robotNextGuess(robot) {
  const pool = robot.candidates || allCodes();
  return pool[(robot.rng() * pool.length) | 0];
}
function robotLearn(robot, code, a, b) {
  const pool = robot.candidates || allCodes();
  robot.candidates = pool.filter(c => { const r = judge(c, code); return r.a === a && r.b === b; });
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
  clearInterval(adTimerId); // 任何关闭路径都终止广告倒计时，防止奖励落到别的对局
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
  syncHelpHint();
}
/* 首玩引导:主页上用气泡指向 ?,打开过教程或点 ✕ 后不再出现 */
function syncHelpHint() {
  const on = document.body.dataset.screen === 'screen-home' && !store.ftue.help;
  $('#help-hint').hidden = !on;
  $('#btn-help').classList.toggle('help-glow', on);
}
function markHelpSeen() {
  if (store.ftue.help) return;
  store.ftue.help = 1;
  save();
  syncHelpHint();
}

/* ============================================================
   游戏引擎
   ============================================================ */
const game = {
  active: false,
  mode: 'free',        // free | daily | variant | duel1（破解好友题） | duel2（迎战反击）
  secret: '',
  len: CODE_LEN,       // 本局密码长度（变体可为 5)
  allowDup: false,     // 本局猜测是否允许重复图标（双影日）
  variant: null,       // 变奏规则对象
  guesses: [],         // [{code, a, b}]
  input: [],
  penalty: 0,
  items: { magnet: true, scope: true, ad: true },
  marks: {},           // idx -> '' | 'off' | 'yes'
  revealed: {},        // pos -> iconIdx （望远镜）
  locked: {},          // pos -> iconIdx （黏黏日蜜糖锁定）
  tweakSel: -1,        // 锁匠日:当前选中的输入格
  robot: null,         // 对手日:{ rows, candidates, rng }
  robotWin: false,     // 对手日:机器人抢先破解
  turnLock: false,     // 对手日:机器人回合中,禁玩家操作
  chainSeen: false,    // 接龙日:已强调过首个「相邻>0」
  nearWinShown: false, // 本局已提示过"图案全中"近胜时刻
  startTime: 0,
  timerId: 0,
  duelCtx: null,       // 对战上下文（收到的payload)
  finished: false,
  pendingEnd: false,   // 终局猜测已提交、正在播放揭示动画
  revived: false,      // 每日挑战本局是否已复活过
  dailyDate: '',       // 题目所属日期（跨零点结算不串天）
  dailyNum: 0,
  seq: 0,              // 对局序号，防止异步奖励落到后开的对局
};
let gameSeq = 0;
// 宣言可能带来负惩罚，步数至少为已猜次数存在感（不出现 0 步破解）
const stepCount = () => Math.max(game.guesses.length ? 1 : 0, game.guesses.length + game.penalty);
const maxGuesses = () => ((game.variant && game.variant.maxG) || MAX_GUESSES) + (game.revived ? 3 : 0);

function startGame(mode, secret, duelCtx = null, variant = null) {
  Object.assign(game, {
    active: true, finished: false, pendingEnd: false, revived: false, mode, secret,
    len: variant ? variant.len : CODE_LEN,
    allowDup: variant ? !!variant.allowDup : false,
    variant,
    guesses: [], input: [], penalty: 0,
    items: { magnet: true, scope: true, ad: true },
    marks: {}, revealed: {}, locked: {}, tweakSel: -1, robotWin: false, turnLock: false,
    chainSeen: false, nearWinShown: false,
    robot: variant && variant.robot ? { rows: [], candidates: null, rng: seededRng('robot-' + secret) } : null,
    duelCtx, startTime: Date.now(),
    dailyDate: todayStr(), dailyNum: dailyNumber(),
    seq: ++gameSeq,
  });
  clearInterval(game.timerId);
  game.timerId = setInterval(updateTimer, 500);

  const modeLabel = {
    free: '<img src="assets/icons/dice.png">' + t('无尽练习'),
    daily: `<img src="assets/icons/sun.png">${t("每日挑战")} #${game.dailyNum}`,
    variant: variant ? T`${variant.emoji} 变奏 · ${variant.name}` : t(t("变奏")),
    duel1: `<img src="assets/icons/sword.png">${t("破解 %1 的密码", esc(duelCtx?.n || t("好友")))}`,
    duel2: `<img src="assets/icons/shield.png">${t("迎战 %1 的反击", esc(duelCtx?.bn || t("好友")))}`,
  }[mode];
  $('#play-mode').innerHTML = modeLabel;
  $('#intel-bar').hidden = true;
  $('#intel-bar').innerHTML = '';
  ['magnet', 'scope', 'ad'].forEach(k => $('#item-' + k).classList.remove('used'));
  buildKeyboard();
  $('#board').innerHTML = '';
  $('#board').classList.toggle('len5', game.len === 5);
  if (variant) {
    // 规则钉在情报栏，全程可见
    addIntel(`${variant.emoji} ${variant.name}:${variantChipText(variant)}`, true);
    if (variant.honey) addIntel(`🍯 ${t("已粘住")} <b id="honey-count">0</b>/${game.len}`, true);
    if (variant.robot) addIntel(`🤖 ${t("它的反馈你也能用!")}`, true);
  }
  // 首次引导:目标一句话钉在情报栏(终生只出现一次)
  if (!store.ftue.goal) {
    addIntel('🎯 ' + T`目标:猜出 ${game.len} 个图标和它们的顺序,次数有限!`, true);
    store.ftue.goal = 1;
    save();
  }
  appendInputRow();
  updateCounters();
  showScreen('screen-play');
  sfx('start', 0.45);
}
function variantChipText(v) {
  return {
    twin: t('5 格 · 有一对紧挨的双影'),
    robot: t('和机器人轮流猜 · 先破解的赢'),
    honey: t('位置全对就粘住 · 只有 9 次机会'),
    tweak: t('每次只能改一处:换 1 格或交换 2 格'),
    chain: t('「位置」换成「相邻」· 拼出整条链'),
  }[v.id] || '';
}
function updateTimer() {
  if (!game.active) return;
  const s = ((Date.now() - game.startTime) / 1000) | 0;
  $('#counter-timer').innerHTML = `<img src="assets/icons/clock.png">${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
}
function updateCounters(bump = false) {
  const c = $('#counter-steps');
  c.innerHTML = `<img src="assets/icons/hit.png">${t("%1 步", stepCount())}`;
  if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  // 剩余次数:紧张感的来源必须可见
  const left = Math.max(0, maxGuesses() - game.guesses.length);
  const lc = $('#counter-left');
  lc.innerHTML = `<img src="assets/icons/heart.png">${left}/${maxGuesses()}`;
  lc.title = t('剩余猜测次数');
  lc.classList.toggle('danger', game.active && left <= 3);
  saveDailyRun();
}
/* 触觉(Android Chrome 等支持 vibrate 的环境;iOS Safari 自动跳过) */
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

/* ---------------- 每日挑战:进行中局面持久化(误刷新不再烧掉当天) ---------------- */
function saveDailyRun() {
  if (game.mode !== 'daily' || !game.active || game.finished) return;
  if (!game.guesses.length) return;
  store.dailyRun = {
    date: game.dailyDate,
    guesses: game.guesses,
    penalty: game.penalty,
    marks: game.marks,
    revealed: game.revealed,
    items: game.items,
    revived: game.revived,
    elapsed: Date.now() - game.startTime,
  };
  save();
}
function resumeDaily(run) {
  startGame('daily', dailyCode());
  game.guesses = run.guesses.map(g => ({ code: g.code, a: g.a, b: g.b }));
  game.penalty = run.penalty || 0;
  game.marks = run.marks || {};
  game.revealed = run.revealed || {};
  Object.assign(game.items, run.items || {});
  game.revived = !!run.revived;
  game.startTime = Date.now() - (run.elapsed || 0);
  // 静态重建历史行,再挂输入行
  $('#board').innerHTML = '';
  game.guesses.forEach((g, gi) => {
    const row = el('div', 'guess-row');
    row.innerHTML = `<span class="row-index">${gi + 1}</span><div class="tiles"></div><div class="row-feedback">${feedbackHTML(g.a, g.b)}</div>`;
    const tiles = row.querySelector('.tiles');
    [...g.code].forEach(c => { const tl = el('div', 'tile filled'); paintTile(tl, +c); tiles.appendChild(tl); });
    $('#board').appendChild(row);
  });
  ['magnet', 'scope', 'ad'].forEach(k => { if (!game.items[k]) $('#item-' + k).classList.add('used'); });
  syncKeyMarks();
  if (game.guesses.length >= maxGuesses()) {
    game.pendingEnd = true;
    if (!game.revived) offerRevive(); else finishGame(false);
  } else {
    appendInputRow();
  }
  updateCounters();
  toast(t('已恢复今天的进度,接着猜!'), ICON_PATH('sun'));
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
  const enter = el('button', 'key key-enter', `<img src="assets/icons/tick.png" alt=""><span>${t('猜！')}</span>`);
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
  saveDailyRun();
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
  const v = game.variant;
  if (v && v.tweak && game.guesses.length) {
    // 锁匠日:预填上一行;点一格选中后可用键盘替换,点两格交换
    game.input = [...game.guesses[game.guesses.length - 1].code].map(Number);
    game.tweakSel = -1;
    for (let i = 0; i < game.len; i++) {
      const tile = el('div', 'tile filled tweakable');
      paintTile(tile, game.input[i]);
      tile.addEventListener('click', () => tweakTapTile(i));
      tiles.appendChild(tile);
    }
  } else {
    game.input = [];
    for (let i = 0; i < game.len; i++) {
      if (v && v.honey && game.locked[i] !== undefined) {
        // 黏黏日:被蜜糖粘住的格子自动填好,不可修改
        const tile = el('div', 'tile filled honey-locked');
        paintTile(tile, game.locked[i]);
        tiles.appendChild(tile);
      } else {
        tiles.appendChild(el('div', 'tile empty'));
      }
    }
  }
  $('#board').appendChild(row);
  row.scrollIntoView({ block: 'nearest' });
}
function paintTile(tile, idx) {
  const ic = ICONS[idx];
  tile.style.background = ic.color;
  tile.innerHTML = `<img src="${ICON_PATH(ic.id)}" alt="${ic.name}">`;
}
function inputRowTiles() { return document.querySelectorAll('#board .input-row .tile'); }
function freeTiles() { return document.querySelectorAll('#board .input-row .tile:not(.honey-locked)'); }
/* 黏黏日:锁定格 + 依次填入的自由格,拼出完整猜测 */
function honeyCode() {
  const out = [];
  let p = 0;
  for (let i = 0; i < game.len; i++) out.push(game.locked[i] !== undefined ? game.locked[i] : game.input[p++]);
  return out.join('');
}

function inputIcon(idx) {
  if (!game.active || game.finished || game.turnLock) return;
  if (!inputRowTiles().length) return; // 揭示动画期间暂不接受输入
  const v = game.variant;
  if (v && v.tweak && game.guesses.length) {
    if (game.tweakSel < 0) { toast(t('先点选要换的格子;点两个格子可以交换')); shakeInputRow(); return; }
    if (game.input.includes(idx) && game.input[game.tweakSel] !== idx) {
      toast(t('这局密码不会重复图标哦')); shakeInputRow(); return;
    }
    game.input[game.tweakSel] = idx;
    const tile = inputRowTiles()[game.tweakSel];
    paintTile(tile, idx);
    tile.classList.remove('tweak-sel');
    game.tweakSel = -1;
    typePop();
    return;
  }
  const cap = v && v.honey ? game.len - Object.keys(game.locked).length : game.len;
  if (game.input.length >= cap) return;
  const inRow = v && v.honey ? game.input.concat(Object.values(game.locked)) : game.input;
  if (!game.allowDup && inRow.includes(idx)) {
    toast(t('这局密码不会重复图标哦')); shakeInputRow(); return;
  }
  if (game.allowDup && game.input.filter(i => i === idx).length >= 2) {
    toast(t('同一图标最多摆两个')); shakeInputRow(); return;
  }
  game.input.push(idx);
  const tile = (v && v.honey ? freeTiles() : inputRowTiles())[game.input.length - 1];
  tile.className = 'tile filled';
  paintTile(tile, idx);
  typePop();
}
function inputDelete() {
  if (!game.active || game.finished || game.turnLock) return;
  if (!inputRowTiles().length) return;
  const v = game.variant;
  if (v && v.tweak && game.guesses.length) {
    // 锁匠日:橡皮擦 = 撤销全部改动,恢复成上一行
    game.input = [...game.guesses[game.guesses.length - 1].code].map(Number);
    game.tweakSel = -1;
    inputRowTiles().forEach((tile, i) => { tile.className = 'tile filled tweakable'; paintTile(tile, game.input[i]); });
    sfx('ui', 0.3);
    return;
  }
  if (!game.input.length) return;
  const tiles = v && v.honey ? freeTiles() : inputRowTiles();
  const tile = tiles[game.input.length - 1];
  game.input.pop();
  tile.className = 'tile empty';
  tile.style.background = '';
  tile.innerHTML = '';
  sfx('ui', 0.3);
}
/* 锁匠日:点格子——单击选中,再点另一格交换,再点自己取消 */
function tweakTapTile(i) {
  if (!game.active || game.finished || game.pendingEnd || game.turnLock) return;
  const tiles = inputRowTiles();
  if (!tiles.length) return;
  if (game.tweakSel === i) {
    tiles[i].classList.remove('tweak-sel');
    game.tweakSel = -1;
  } else if (game.tweakSel < 0) {
    game.tweakSel = i;
    tiles[i].classList.add('tweak-sel');
    sfx('ui', 0.35);
  } else {
    const j = game.tweakSel;
    [game.input[i], game.input[j]] = [game.input[j], game.input[i]];
    paintTile(tiles[i], game.input[i]);
    paintTile(tiles[j], game.input[j]);
    tiles[j].classList.remove('tweak-sel');
    game.tweakSel = -1;
    typePop();
  }
}
/* 锁匠日:与上一行相比,恰好换掉 1 格,或恰好交换 2 格 */
function tweakDiffOk(prev, cur) {
  const d = [];
  for (let i = 0; i < cur.length; i++) if (prev[i] !== cur[i]) d.push(i);
  if (d.length === 1) return true;
  if (d.length === 2) return prev[d[0]] === cur[d[1]] && prev[d[1]] === cur[d[0]];
  return false;
}
function shakeInputRow() {
  inputRowTiles().forEach(t => {
    t.classList.remove('shake-row'); void t.offsetWidth; t.classList.add('shake-row');
  });
}

/* ---------------- 提交 ---------------- */
function submitGuess() {
  if (!game.active || game.finished || game.pendingEnd || game.turnLock) return;
  const v = game.variant;
  const isTweak = v && v.tweak && game.guesses.length > 0;
  let code;
  if (isTweak) {
    code = game.input.join('');
    const prev = game.guesses[game.guesses.length - 1].code;
    if (code === prev) {
      toast(t('先改一处再提交:换掉 1 格,或点两个格子交换')); shakeInputRow(); sfx('ui', 0.4); return;
    }
    if (!tweakDiffOk(prev, code)) {
      toast(t('一次只能改一处!用橡皮擦可以恢复原样')); shakeInputRow(); sfx('ui', 0.45); return;
    }
  } else if (v && v.honey) {
    if (game.input.length < game.len - Object.keys(game.locked).length) {
      toast(T`先摆满 ${game.len} 个图标`); shakeInputRow(); sfx('ui', 0.4); return;
    }
    code = honeyCode();
  } else {
    if (game.input.length < game.len) {
      toast(T`先摆满 ${game.len} 个图标`); shakeInputRow(); sfx('ui', 0.4); return;
    }
    code = game.input.join('');
  }
  if (game.guesses.some(g => g.code === code)) {
    toast(t('一模一样的组合已经猜过啦，再想想！'));
    shakeInputRow(); sfx('ui', 0.45);
    return; // 不消耗步数，保留当前输入让玩家修改
  }
  const { a, b } = judge(game.secret, code);
  const chain = v && v.chain ? chainPairs(game.secret, code) : -1;
  game.guesses.push({ code, a, b });
  game.input = [];
  game.tweakSel = -1;
  if (a === game.len || game.guesses.length >= maxGuesses()) game.pendingEnd = true; // 终局锁：揭示动画期间禁用道具/提交

  // 每日挑战：第一次猜测先记一笔「未破解」，防止中途刷新重开刷步数（正常完成会覆盖）
  if (game.mode === 'daily' && game.guesses.length === 1) {
    store.daily = { [game.dailyDate]: { steps: FAIL_STEPS, win: false, grid: [] } };
    save();
  }

  const row = $('#board .input-row');
  row.classList.remove('input-row');
  const tiles = row.querySelectorAll('.tile');
  tiles.forEach((t, i) => {
    setTimeout(() => { t.classList.add('reveal'); typePop(); }, i * 130);
  });
  buzz(12);
  const fb = row.querySelector('.row-feedback');
  setTimeout(() => {
    fb.innerHTML = feedbackHTML(a, b, chain);
    if (a === game.len) { /* 胜利音效在 finish 里 */ }
    else if (a > 0) sfx('right', 0.55);
    else if (b > 0) sfx('right2', 0.5);
    else sfx('completed', 0.4);
    if (a + b > 0) buzz(15);
    // 接龙日:第一次「相邻>0」是切换拼链思路的信号,强调一下
    if (chain > 0 && !game.chainSeen) {
      game.chainSeen = true;
      const chip = fb.querySelector('.fb-chain');
      if (chip) chip.classList.add('fb-pulse');
      sfx('right', 0.6);
    }
    // 近胜节拍:图案全中但顺序未齐——玩家最抓心的时刻(每局只提示一次)
    if (a + b === game.len && a < game.len && !game.nearWinShown) {
      game.nearWinShown = true;
      toast(t('图案全中!只差顺序了'), ICON_PATH('hit'));
      buzz([20, 50, 20]);
    }
  }, game.len * 130 + 120);

  updateCounters(true);

  setTimeout(() => {
    if (a === game.len) return finishGame(true);
    if (game.guesses.length >= maxGuesses()) {
      // 每日挑战：给一次看广告复活的机会
      if (game.mode === 'daily' && !game.revived) return offerRevive();
      return finishGame(false);
    }
    const left = maxGuesses() - game.guesses.length;
    if (left === 3) { toast(t('注意:只剩 3 次机会了!')); sfx('completed', 0.5); buzz(30); }
    // 首局第一猜后:曝光长按标记功能(终生一次)
    if (!store.ftue.mark && game.guesses.length === 1) {
      store.ftue.mark = 1;
      save();
      toast(t('小技巧:长按键盘图标,可以做「排除/锁定」标记'));
    }
    if (v && v.honey) applyHoneyLocks(code, row);
    if (v && v.robot) return robotTurn();
    appendInputRow();
  }, game.len * 130 + 350);
}
/* 黏黏日:位置全对的格子当场锁定,之后每行自动填好 */
function applyHoneyLocks(code, row) {
  let newLock = false;
  const tiles = row.querySelectorAll('.tile');
  for (let i = 0; i < game.len; i++) {
    if (code[i] === game.secret[i] && game.locked[i] === undefined) {
      game.locked[i] = +code[i];
      game.marks[+code[i]] = 'yes';
      tiles[i].classList.add('honey-locked', 'honey-pop');
      newLock = true;
    }
  }
  if (newLock) {
    syncKeyMarks();
    sfx('ability', 0.5);
    sfx('right', 0.5);
    buzz([20, 40, 20]);
    toast(T`🍯 粘住了!已锁定 ${Object.keys(game.locked).length}/${game.len} 格`);
  }
  const hc = $('#honey-count');
  if (hc) hc.textContent = Object.keys(game.locked).length;
}
/* 对手日:机器人回合——从与它历史反馈相容的候选里抽一手,公开摆上棋盘 */
function robotTurn() {
  game.turnLock = true;
  const seqAtStart = game.seq;
  const rb = game.robot;
  const code = robotNextGuess(rb);
  const { a, b } = judge(game.secret, code);
  const row = el('div', 'guess-row robot-row');
  row.innerHTML = `<span class="row-index">🤖</span><div class="tiles"></div><div class="row-feedback"><span class="robot-thinking">${t('思考中…')}</span></div>`;
  const tiles = row.querySelector('.tiles');
  for (let i = 0; i < game.len; i++) tiles.appendChild(el('div', 'tile empty'));
  $('#board').appendChild(row);
  row.scrollIntoView({ block: 'nearest' });
  setTimeout(() => {
    if (!game.active || game.finished || game.seq !== seqAtStart) return;
    const ts = row.querySelectorAll('.tile');
    [...code].forEach((c, i) => {
      setTimeout(() => {
        ts[i].className = 'tile filled reveal';
        paintTile(ts[i], +c);
        typePop();
      }, i * 130);
    });
    setTimeout(() => {
      if (!game.active || game.finished || game.seq !== seqAtStart) return;
      row.querySelector('.row-feedback').innerHTML = feedbackHTML(a, b, -1);
      rb.rows.push({ code, a, b });
      robotLearn(rb, code, a, b);
      if (a === game.len) {
        game.robotWin = true;
        game.pendingEnd = true;
        sfx('completed', 0.5);
        setTimeout(() => finishGame(false), 600);
        return;
      }
      game.turnLock = false;
      appendInputRow();
    }, game.len * 130 + 200);
  }, 700);
}
/* 反馈：两个带标签的计数胶囊——「图案」猜对的图标数（含位置对的）、「位置」其中位置也对的数。
   不用与格子对齐的点阵，避免玩家误以为点的位置对应哪一格。
   接龙日把「位置」换成「相邻」——同序紧挨的相邻对数 */
function feedbackHTML(a, b, chain = -1) {
  const icons = a + b, pos = a;
  const first = `<span class="fb-chip fb-icons${icons ? '' : ' zero'}">${t('图案')}<b>${icons}</b></span>`;
  if (chain >= 0) {
    return first + `<span class="fb-chip fb-chain${chain ? '' : ' zero'}" style="animation-delay:.1s">${t('相邻')}<b>${chain}</b></span>`;
  }
  return first + `<span class="fb-chip fb-pos${pos ? '' : ' zero'}" style="animation-delay:.1s">${t('位置')}<b>${pos}</b></span>`;
}

/* ---------------- 道具 ---------------- */
function addIntel(html, good) {
  const bar = $('#intel-bar');
  bar.hidden = false;
  bar.appendChild(el('span', 'intel-chip ' + (good ? 'good' : 'bad'), html));
}
$('#item-magnet').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || game.turnLock || !game.items.magnet) return;
  let grid = '';
  ICONS.forEach((ic, idx) => {
    grid += `<button class="key" data-pick="${idx}" style="background:${ic.color}"><span class="key-num">${idx}</span><img src="${ICON_PATH(ic.id)}"></button>`;
  });
  const box = openModal(`
    <h3>${t('🧲 磁铁探测')}</h3>
    <p>${t("选<b>两个</b>图标，磁铁会分别告诉你它们<b>在不在</b>密码里")}${t("（代价：+1 步）")}</p>
    <div class="pick-grid">${grid}</div>
    <div class="modal-actions"><button class="big-btn" id="m-cancel">${t('先不用')}</button></div>`);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  let first = -1;
  box.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
    const idx = +btn.dataset.pick;
    if (first < 0) {
      // 第一个:选中高亮,等第二个
      first = idx;
      btn.style.outline = '4px solid var(--green)';
      sfx('ui', 0.4);
      return;
    }
    if (idx === first) return;
    game.items.magnet = false;
    game.penalty += 1;
    $('#item-magnet').classList.add('used');
    closeModal();
    let hits = 0;
    [first, idx].forEach(k => {
      const inCode = game.secret.includes(String(k));
      if (inCode) hits++;
      game.marks[k] = inCode ? 'yes' : 'off';
      addIntel(`<img src="assets/icons/magnet.png">${chipIconHTML(k)}${inCode ? t("在密码里！") : t("不在")}`, inCode);
    });
    syncKeyMarks();
    updateCounters(true);
    sfx('ability', 0.55);
    buzz(15);
    toast(T`磁铁报告:两个里有 ${hits} 个在密码里,详情看情报栏`, ICON_PATH('magnet'));
  }));
});
$('#item-scope').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || game.turnLock || !game.items.scope) return;
  let picks = '';
  for (let i = 0; i < game.len; i++) {
    picks += `<div class="tile" data-pos="${i}">${i + 1}</div>`;
  }
  const box = openModal(`
    <h3>${t('🔭 望远镜偷看')}</h3>
    <p>${t("选一个位置，直接看到那里的图标")}${t("（代价：+3 步，慎用！）")}</p>
    <div class="pos-pick">${picks}</div>
    <div class="modal-actions"><button class="big-btn" id="m-cancel">${t('先不用')}</button></div>`);
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
    addIntel(`<img src="assets/icons/binoculars.png">${t("第%1位", pos + 1)} = ${chipIconHTML(idx)}`, true);
    updateCounters(true);
    closeModal();
    sfx('ability', 0.5);
    toast(T`第 ${pos + 1} 位是 ${ICONS[idx].name}!`, ICON_PATH('binoculars'));
  }));
});

/* ---------------- 假广告：看 15 秒，3 秒后可跳过（跳过没奖励） ---------------- */
let adTimerId = 0;
$('#item-ad').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd || game.turnLock || !game.items.ad) return;
  const candidates = ICONS.map((_, i) => i)
    .filter(i => !game.secret.includes(String(i)) && game.marks[i] !== 'off');
  if (!candidates.length) { toast(t("没有可排除的图标啦，广告小猫也帮不上忙"), ICON_PATH('video')); return; }
  const seqAtOpen = game.seq;
  const gif = Math.random() < 0.5 ? 'cat_add.gif' : 'dance.gif';
  openModal(`
    <h3>${t('📺 广告时间')}</h3>
    <div class="ad-stage">
      <img class="ad-gif" src="assets/ads/${gif}" alt="广告">
      <span class="ad-tag">${t('广告 · AD')}</span>
      <span class="ad-count" id="ad-count">15</span>
    </div>
    <p style="text-align:center">${t('看完广告，小猫帮你')}<b>${t('排除一个不在密码里的图标')}</b></p>
    <div class="ad-actions" id="ad-actions"></div>`);
  $('#modal-mask').dataset.lock = '1';
  let left = 15;
  clearInterval(adTimerId);
  const closeAd = reward => {
    closeModal(); // closeModal 会清倒计时和锁
    if (!reward) { toast(t("广告没看完，小猫抱着线索走了…"), ICON_PATH('cat')); return; }
    // 对局已结束/已切换时，奖励作废
    if (!game.active || game.finished || game.pendingEnd || game.seq !== seqAtOpen) return;
    const idx = candidates[(Math.random() * candidates.length) | 0];
    game.items.ad = false;
    $('#item-ad').classList.add('used');
    game.marks[idx] = 'off';
    syncKeyMarks();
    addIntel(`<img src="assets/icons/video.png">${chipIconHTML(idx)}${t("不在（喵）")}`, false);
    sfx('ability', 0.55);
    sfx('meow', 0.6);
    toast(T`广告小猫说：${ICONS[idx].name} 不在密码里！`, ICON_PATH('cat'));
  };
  adTimerId = setInterval(() => {
    left--;
    const cnt = $('#ad-count');
    if (!cnt) { clearInterval(adTimerId); return; } // 弹窗已被别处关闭
    cnt.textContent = left;
    if (left === 12) {
      const skip = el('button', 'big-btn', t('跳过广告（放弃奖励）'));
      skip.addEventListener('click', () => closeAd(false));
      $('#ad-actions').appendChild(skip);
    }
    if (left <= 0) closeAd(true);
  }, 1000);
});

/* ---------------- 每日挑战：看广告复活（+3 次机会，步数 −2，限一次） ---------------- */
function offerRevive() {
  const box = openModal(`
    <img class="card-icon" src="assets/icons/heart.png" style="display:block;margin:0 auto 8px">
    <h3>${t('差一点点！')}</h3>
    <p style="text-align:center">${t('机会用完了，但还有救——看 15 秒小广告立即复活：')}<br><b>${t('🎁 +3 次猜测机会，步数还能 −2')}</b></p>
    <div class="modal-actions"><button class="big-btn green" id="rv-watch">${t('看广告复活')}</button></div>
    <div class="modal-actions"><button class="big-btn" id="rv-no">${t('放弃，认命了')}</button></div>`);
  $('#modal-mask').dataset.lock = '1';
  box.querySelector('#rv-no').addEventListener('click', () => { closeModal(); finishGame(false); });
  box.querySelector('#rv-watch').addEventListener('click', () => playReviveAd());
}
function playReviveAd() {
  const seqAtOpen = game.seq;
  const gif = Math.random() < 0.5 ? 'cat_add.gif' : 'dance.gif';
  openModal(`
    <h3>${t('📺 复活广告')}</h3>
    <div class="ad-stage">
      <img class="ad-gif" src="assets/ads/${gif}" alt="广告">
      <span class="ad-tag">${t('广告 · AD')}</span>
      <span class="ad-count" id="ad-count">15</span>
    </div>
    <p style="text-align:center">${t('看完立即复活：+3 次机会，步数 −2')}</p>
    <div class="ad-actions" id="ad-actions"></div>`);
  $('#modal-mask').dataset.lock = '1';
  let left = 15;
  clearInterval(adTimerId);
  adTimerId = setInterval(() => {
    left--;
    const cnt = $('#ad-count');
    if (!cnt) { clearInterval(adTimerId); return; }
    cnt.textContent = left;
    if (left === 12) {
      const skip = el('button', 'big-btn', t('跳过（放弃复活）'));
      skip.addEventListener('click', () => { closeModal(); finishGame(false); });
      $('#ad-actions').appendChild(skip);
    }
    if (left <= 0) {
      closeModal();
      if (game.finished || game.seq !== seqAtOpen) return;
      doRevive();
    }
  }, 1000);
}
function doRevive() {
  game.revived = true;
  game.pendingEnd = false;
  game.penalty -= 2;
  appendInputRow();
  updateCounters(true);
  confetti(50);
  sfx('win', 0.5);
  toast(t("复活成功！+3 次机会，步数 −2"), ICON_PATH('heart'));
}

$('#btn-giveup').addEventListener('click', () => {
  if (!game.active || game.finished || game.pendingEnd) return;
  const box = openModal(`
    <h3>${t('👻 确定认输？')}</h3>
    <p>${t("会直接揭晓答案")}${game.mode === 'daily' ? t('，并中断每日连胜') : ''}${game.mode.startsWith('duel') ? t('，对战将记为「未破解」') : ''}。</p>
    <div class="modal-actions">
      <button class="big-btn" id="m-cancel">${t('再挣扎一下')}</button>
      <button class="big-btn primary" id="m-yes">${t('认输')}</button>
    </div>`);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-yes').addEventListener('click', () => { closeModal(); finishGame(false, true); });
});

/* ---------------- 结束 ---------------- */
function finishGame(win, surrendered = false) {
  if (game.finished) return;
  game.finished = true;
  game.active = false;
  closeModal(); // 关掉还开着的弹窗（含广告），对局结束一切归零
  clearInterval(game.timerId);
  const steps = win ? stepCount() : FAIL_STEPS;
  const timeSec = ((Date.now() - game.startTime) / 1000) | 0;
  const grid = game.guesses.map(g => g.a + ',' + g.b);

  if (win) {
    sfx(game.mode === 'daily' ? 'daily' : 'win', 0.6);
    buzz([40, 60, 40]);
    confetti();
    document.querySelectorAll('#board .guess-row:last-child .tile').forEach((t, i) => {
      setTimeout(() => t.classList.add('win-dance'), i * 90);
    });
  } else {
    sfx('completed', 0.45);
  }

  // 本地统计:胜率/步数分布(按模式与变体分桶,为日后调平衡收集事实)
  const bucket = game.mode === 'variant' && game.variant ? 'variant:' + game.variant.id : game.mode;
  if (!store.stats[bucket]) store.stats[bucket] = { plays: 0, wins: 0, stepsHist: {} };
  const sb = store.stats[bucket];
  sb.plays++;
  if (win) { sb.wins++; sb.stepsHist[steps] = (sb.stepsHist[steps] || 0) + 1; }
  store.dailyRun = null; // 对局已结算,清掉恢复现场

  // 存档统计
  store.played++;
  if (win) {
    store.wins++;
    // 最佳步数只统计经典 4 格玩法，变体步数没有可比性
    if (game.mode !== 'variant' && (!store.best || steps < store.best)) {
      store.best = steps;
      if (store.played > 1) setTimeout(() => toast(t("新纪录！"), ICON_PATH('ranking')), 1200);
    }
  }
  if (game.mode === 'daily') {
    // 用题目所属日期结算（跨零点也记在开局那天）
    const day = game.dailyDate;
    store.daily = { [day]: { steps: win ? steps : FAIL_STEPS, win, grid } };
    if (win) {
      const p = day.split('-');
      const yest = new Date(+p[0], +p[1] - 1, +p[2] - 1);
      const yestStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
      store.streak = (store.lastDailyWin === yestStr) ? store.streak + 1 : 1;
      store.maxStreak = Math.max(store.maxStreak, store.streak);
      store.lastDailyWin = day;
    } else {
      store.streak = 0;
    }
  }
  save();

  setTimeout(() => renderResult({ win, steps, timeSec, surrendered }), win ? 1400 : 700);
}

/* ---------------- 战报文本 ---------------- */
const emojiRow = (g, len = CODE_LEN) => {
  const [a, b] = g.split(',').map(Number);
  return '🟢'.repeat(a) + '🟡'.repeat(b) + '⚪'.repeat(Math.max(0, len - a - b));
};
function shareGrid(grid, len = CODE_LEN) { return grid.map(g => emojiRow(g, len)).join('\n'); }
/* 最优策略平均也要 ~5.2 步，所以 5 步以内就是三星水准 */
function starCount(steps) { return steps <= 5 ? 3 : steps <= 8 ? 2 : 1; }
function starsHTML(n) {
  let h = '';
  for (let i = 0; i < 3; i++) h += `<img src="assets/icons/star5.png" class="${i < n ? '' : 'dim'}">`;
  return `<div class="result-stars">${h}</div>`;
}
function stepsLabel(s) { return s >= FAIL_STEPS ? t('未破解') : t('%1 步', s); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function copyText(text, okMsg = t("已复制，快去粘贴给好友！")) {
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
  const timeStr = t("%1分%2秒", (timeSec / 60) | 0, timeSec % 60);
  const grid = game.guesses.map(g => g.a + ',' + g.b);
  let html = '';

  if (game.mode === 'daily' || game.mode === 'free' || game.mode === 'variant') {
    const v = game.variant;
    const title = game.robotWin ? t("被机器人抢先了!") : win ? [t("密码破解！"), t("全部猜中！"), t("解码天才！")][(Math.random() * 3) | 0] : (surrendered ? t("下次再战") : t("密码逃走了…"));
    const shareText = game.mode === 'daily'
      ? T`码上猜 CodePop 每日挑战 #${game.dailyNum}\n${win ? T`${steps} 步破解 ${'⭐'.repeat(starCount(steps))}` : t("未能破解 💦")}\n${shareGrid(grid)}\n${baseUrl()}`
      : game.mode === 'variant'
        ? T`码上猜 · 变奏挑战【${v.emoji}${v.name}】\n${win ? T`${steps} 步破解！` : game.robotWin ? t("被机器人抢先破解了 🤖") : t("把我难住了 💦")}\n${shareGrid(grid, game.len)}\n你也来试试：${baseUrl()}`
        : (win
          ? T`我在「码上猜」用 ${steps} 步破解了随机密码！\n${shareGrid(grid)}\n你也来试试：${baseUrl()}`
          : T`随机密码把我难住了 💦 你来试试？\n${shareGrid(grid)}\n${baseUrl()}`);
    html = `
      <img class="card-icon" src="assets/icons/${win ? 'crown' : 'ghost'}.png">
      <div class="card-title">${title}</div>
      ${win && game.mode !== 'variant' ? starsHTML(starCount(steps)) : ''}
      ${game.mode === 'variant' ? `<div class="card-sub">${v.emoji} ${v.name} · ${win ? t("%1 步", steps) : t("未破解")}</div>` : ''}
      ${game.mode === 'variant' && game.robot ? `<div class="card-sub">${win ? t("🤖 你抢先了!机器人只猜到第 %1 行", game.robot.rows.length) : game.robotWin ? t("🤖 机器人第 %1 行就破解了", game.robot.rows.length) : t("🤖 机器人也没能破解")}</div>` : ''}
      <div class="card-sub">${win ? t("%1 步 · 用时 %2", steps, timeStr) : t("答案是——")}</div>
      ${answerStripHTML(game.secret)}
      ${game.mode === 'daily' ? `<div class="card-sub">${t("🔥 连胜 %1 天（最高 %2）", store.streak, store.maxStreak)}</div>` : ''}
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">${t("分享战报")}</button>
        ${game.mode === 'free' ? `<button class="big-btn blue" id="r-again"><img src="assets/icons/dice.png">${t("再来一局")}</button>` : ''}
        ${game.mode === 'variant' ? `<button class="big-btn blue" id="r-again-variant">${t("🎲 换个变奏再来")}</button>` : ''}
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
      </div>`;
    card.innerHTML = html;
    $('#r-share').addEventListener('click', () => shareOrCopy(shareText));
    if ($('#r-again')) $('#r-again').addEventListener('click', () => startGame('free', randomCode()));
    if ($('#r-again-variant')) $('#r-again-variant').addEventListener('click', () => openVariantIntro());
    $('#r-home').addEventListener('click', goHome);
  }

  else if (game.mode === 'duel1') {
    // 我（B)刚破解完好友（A)的密码 → 反击 or 只发战报
    const p = game.duelCtx;
    store.duelPlayed++; save();
    const myResult = { steps: win ? steps : FAIL_STEPS, grid };
    html = `
      <img class="card-icon" src="assets/icons/${win ? 'sword' : 'heart-break'}.png">
      <div class="card-title">${win ? t("破解了 %1 的密码！", esc(p.n)) : t("没能破解 %1 的密码", esc(p.n))}</div>
      <div class="card-sub">${win ? t("%1 步 · 用时 %2", steps, timeStr) : t("答案是——")}</div>
      ${win ? '' : answerStripHTML(game.secret)}
      <div class="card-sub">${t("现在<b>布置你的密码反击</b>，把链接发回去，步数少的人获胜！")}</div>
      <div class="card-actions">
        <button class="big-btn primary" id="r-counter"><img src="assets/icons/sword.png">${t("出题反击")}</button>
        <button class="big-btn" id="r-report"><img src="assets/icons/paper-plane.png">${t("不反击，只发战报")}</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
      </div>`;
    card.innerHTML = html;
    $('#r-counter').addEventListener('click', () => openSetup('counter', { orig: p, myResult }));
    $('#r-report').addEventListener('click', () => {
      const link = duelLink({ t: 'c2f', an: p.n, bn: myName(), ac: p.c, bs: myResult.steps, bg: grid });
      showShareModal(t("战报链接已生成"), t("把链接发给 %1，TA 就能看到你的战绩", esc(p.n)), link,
        T`我${win ? T`只用 ${steps} 步就` : t("没能")}破解了你的图标密码！\n${shareGrid(grid)}\n${link}`);
    });
    $('#r-home').addEventListener('click', goHome);
  }

  else if (game.mode === 'duel2') {
    // 我（A)刚打完好友（B)的反击题 → 直接判决 + 生成判决链接
    const p = game.duelCtx;
    const as = win ? steps : FAIL_STEPS;
    const bs = p.bs;
    store.duelPlayed++;
    const verdict = verdictOf(as, bs);
    if (verdict === 'me') store.duelWins++;
    save();
    const link = duelLink({ t: 'c3', an: p.an, bn: p.bn, as, bs });
    const shareText = T`「码上猜」对决判决书 ⚖️\n${esc(p.an)}:${stepsLabel(as)} vs ${esc(p.bn)}:${stepsLabel(bs)}\n${verdictText(verdict, p.an, p.bn)}\n${link}`;
    card.innerHTML = `
      ${verdictHTML(verdict, { name: p.an, steps: as }, { name: p.bn, steps: bs })}
      <div class="card-sub">${t("把判决书发给 %1，让 TA 心服口服！", esc(p.bn))}</div>
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">${t("发送判决书")}</button>
        <button class="big-btn blue" id="r-rematch"><img src="assets/icons/sword.png">${t("再战一局")}</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
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
  return v === 'me' ? t('👑 %1 获胜！', an) : v === 'them' ? t('👑 %1 获胜！', bn) : t('🤝 平局，棋逢对手！');
}
function verdictHTML(v, me, them) {
  // me = 当前视角（A);them = 对手（B)
  const crown = `<img class="vs-crown" src="assets/icons/crown.png">`;
  return `
    <img class="card-icon" src="assets/icons/${v === 'me' ? 'crown' : v === 'them' ? 'heart-break' : 'friends'}.png">
    <div class="card-title">${v === 'me' ? t("你赢了！") : v === 'them' ? t("惜败！") : t("平局！")}</div>
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
   出题（新对战 / 反击）
   ============================================================ */
const setup = { picks: [], mode: 'c1', ctx: null };
function myName() { return store.name || t("神秘玩家"); }

function openSetup(mode, ctx = null) {
  setup.picks = [];
  setup.mode = mode;
  setup.ctx = ctx;
  $('#setup-title').textContent = mode === 'counter' ? t('布置反击密码！') : t('布置你的图标密码');
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
      t.title = t('点击移除');
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
    showShareModal(t("反击链接已生成！"), t("发给 %1：TA 会先看到你的战绩（%2），再挑战你的密码，一决胜负！", esc(orig.n), bsLabel), link,
      T`我${myResult.steps >= FAIL_STEPS ? t("没能破解") : T`用 ${myResult.steps} 步破解了`}你的图标密码，现在轮到你了！敢接招吗？\n${link}`);
  } else {
    const link = duelLink({ t: 'c1', n: myName(), c: code, m: msg });
    showShareModal(t("挑战链接已生成！"), t("发给好友，TA 打开就能开猜。你自己可别点开偷看哦~"), link,
      T`我在「码上猜」藏了一组图标密码，敢来破译吗？码上猜，马上猜！\n${link}`);
  }
});
function showShareModal(title, sub, link, shareText) {
  const box = openModal(`
    <h3>${title}</h3>
    <p style="text-align:center">${sub}</p>
    <div class="share-box">${esc(shareText)}</div>
    <div class="modal-actions">
      <button class="big-btn green" id="s-copy"><img src="assets/icons/copy.png">${t("复制")}</button>
      ${navigator.share ? '<button class="big-btn blue" id="s-share"><img src="assets/icons/share.png">${t("分享")}</button>' : ''}
    </div>
    <div class="modal-actions"><button class="big-btn" id="s-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button></div>`);
  sfx('ability', 0.45);
  box.querySelector('#s-copy').addEventListener('click', () => copyText(shareText));
  if (box.querySelector('#s-share')) box.querySelector('#s-share').addEventListener('click', () => navigator.share({ text: shareText }).catch(() => {}));
  box.querySelector('#s-home').addEventListener('click', () => { closeModal(); goHome(); });
}

/* ============================================================
   收件箱：打开好友链接
   ============================================================ */
function handleIncoming(p) {
  const card = $('#inbox-card');
  if (p.t === 'c1') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/sword.png">
      <div class="card-title">${t("%1 向你发起挑战！", esc(p.n))}</div>
      ${p.m ? `<div class="card-msg">“${esc(p.m)}”</div>` : ''}
      <div class="card-sub">${t("TA 藏了一组 4 个图标的密码。")}<br>${t("每猜一次会告诉你：")}<br><span class="fb-chip fb-icons">${t("图案")}</span> ${t("猜对了几个图标")}&nbsp;&nbsp;<span class="fb-chip fb-pos">${t("位置")}</span> ${t("其中几个连位置都对")}<br>${t("用最少的步数破解它！")}</div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-go"><img src="assets/icons/sword.png">${t("开始破解")}</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">${t("先不了")}</button>
      </div>`;
    $('#i-go').addEventListener('click', () => startGame('duel1', p.c, p));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c2') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/shield.png">
      <div class="card-title">${t("%1 应战了！", esc(p.bn))}</div>
      ${p.m ? `<div class="card-msg">“${esc(p.m)}”</div>` : ''}
      <div class="card-sub">${p.bs >= FAIL_STEPS ? t("TA <b>没能破解</b>你的密码 💥") : t("TA 用 <b>%1 步</b>破解了你的密码", p.bs)}${t("，并布下了反击密码。")}<br>${t("轮到你了——用更少的步数赢下对决！")}</div>
      <div class="vs-table">
        <div class="vs-side"><div class="vs-name">${esc(p.an)}${t("（你）")}</div><div class="vs-steps">?</div><div class="vs-label">${t("等你出手")}</div></div>
        <div class="vs-side"><div class="vs-name">${esc(p.bn)}</div><div class="vs-steps">${p.bs >= FAIL_STEPS ? '💥' : p.bs}</div><div class="vs-label">${stepsLabel(p.bs)}</div></div>
      </div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-go"><img src="assets/icons/shield.png">${t("迎战！")}</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">${t("先不了")}</button>
      </div>`;
    $('#i-go').addEventListener('click', () => startGame('duel2', p.c, p));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c2f') {
    card.innerHTML = `
      <img class="card-icon" src="assets/icons/paper-plane.png">
      <div class="card-title">${t("来自 %1 的战报", esc(p.bn))}</div>
      <div class="card-sub">${p.bs >= FAIL_STEPS ? t("你的密码被 %1 <b>挑战失败</b> 💥 没猜出来！", esc(p.bn)) : t("你的密码被 %1 用 <b>%2 步</b>破解了！", esc(p.bn), p.bs)}</div>
      ${p.bg ? `<div class="share-box" style="text-align:center">${shareGrid(p.bg)}</div>` : ''}
      <div class="card-actions">
        <button class="big-btn primary" id="i-rematch"><img src="assets/icons/sword.png">${t("回敬一题")}</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
      </div>`;
    $('#i-rematch').addEventListener('click', () => openSetup('c1'));
    $('#i-home').addEventListener('click', goHome);
  }
  else if (p.t === 'c3') {
    // B 查看最终判决（视角：bn)
    const v = verdictOf(p.bs, p.as); // 从 B 视角
    // 记录 B 方的对战场次/胜场（同一张判决书只记一次）
    const c3key = [p.an, p.bn, p.as, p.bs].join('|');
    if (store.lastC3 !== c3key) {
      store.lastC3 = c3key;
      store.duelPlayed++;
      if (v === 'me') store.duelWins++;
      save();
    }
    card.innerHTML = `
      ${verdictHTML(v, { name: p.bn, steps: p.bs }, { name: p.an, steps: p.as })}
      <div class="card-sub">${v === 'me' ? t('实至名归，解码之王！') : v === 'them' ? t('差一点点，报仇雪恨走起！') : t('棋逢对手，将遇良才！')}</div>
      <div class="card-actions">
        <button class="big-btn primary" id="i-rematch"><img src="assets/icons/sword.png">${t("再来一局")}</button>
        <button class="big-btn" id="i-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
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
  // 连胜只在链条未断时展示（最后一次每日获胜是今天或昨天）
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yest = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const streakAlive = store.lastDailyWin === todayStr() || store.lastDailyWin === yest;
  if (store.streak > 0 && streakAlive) chips.push(`<span class="stat-chip"><img src="assets/icons/sun.png">${t("连胜 <b>%1</b> 天", store.streak)}</span>`);
  if (store.wins > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/tick.png">${t("破解 <b>%1</b> 次", store.wins)}</span>`);
  if (store.best > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/ranking.png">${t("最佳 <b>%1</b> 步", store.best)}</span>`);
  if (store.duelWins > 0) chips.push(`<span class="stat-chip"><img src="assets/icons/crown.png">${t("对战赢 <b>%1</b> 场", store.duelWins)}</span>`);
  s.innerHTML = chips.join('') || `<span class="stat-chip">${t("✨ 第一次玩？点右上角 <b>?</b> 看玩法")}</span>`;
}
function renderHeroTiles() {
  const wrap = $('#hero-tiles');
  wrap.innerHTML = randomCode().split('').map(c => iconTileHTML(+c)).join('');
}

/* ---------------- 每日挑战：完成绶带 + 刷新倒计时 ---------------- */
let homeTickId = 0;
function dailyCountdownText() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let s = Math.max(0, ((midnight - now) / 1000) | 0);
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function syncDailyMenu() {
  const done = !!store.daily[todayStr()];
  $('#daily-ribbon').hidden = !done;
  $('#daily-desc').innerHTML = done
    ? t('新密码 %1 后刷新', '<b>' + dailyCountdownText() + '</b>')
    : t("全球同题 · 连胜打卡");
}
function goHome() {
  closeModal();
  clearInterval(game.timerId);
  game.active = false;
  if (location.hash) history.replaceState(null, '', baseUrl());
  renderHomeStats();
  renderHeroTiles();
  syncDailyMenu();
  clearInterval(homeTickId);
  homeTickId = setInterval(() => {
    if ($('#screen-home').hidden) { clearInterval(homeTickId); return; }
    syncDailyMenu();
  }, 1000);
  showScreen('screen-home');
}

// 每日挑战进行中:关闭/刷新页面前弹原生确认(第一猜后离开=当天记为未破解)
window.addEventListener('beforeunload', e => {
  if (game.active && !game.finished && game.mode === 'daily' && game.guesses.length > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

$('#btn-back').addEventListener('click', () => {
  if (game.active && !game.finished && game.mode === 'daily') {
    const guessed = game.guesses.length > 0;
    const box = openModal(`
      <h3>${t("☀️ 确定退出每日挑战？")}</h3>
      <p>${guessed
        ? t('你已经开始猜了——现在退出，<b>今天会记为未破解</b>，连胜也会中断，零点前不能重来哦。')
        : t('还没开始猜，现在退出不影响今天的挑战，稍后可以再来。')}</p>
      <div class="modal-actions">
        <button class="big-btn primary" id="m-stay">${t("继续挑战")}</button>
        <button class="big-btn" id="m-leave">${guessed ? t("狠心退出") : t("退出")}</button>
      </div>`);
    box.querySelector('#m-stay').addEventListener('click', closeModal);
    box.querySelector('#m-leave').addEventListener('click', () => { closeModal(); goHome(); });
    return;
  }
  if (game.active && game.guesses.length > 0 && !game.finished) {
    const box = openModal(`
      <h3>${t("要离开对局吗？")}</h3>
      <p>${t("当前进度不会保存哦。")}</p>
      <div class="modal-actions">
        <button class="big-btn" id="m-stay">${t("继续玩")}</button>
        <button class="big-btn primary" id="m-leave">${t("离开")}</button>
      </div>`);
    box.querySelector('#m-stay').addEventListener('click', closeModal);
    box.querySelector('#m-leave').addEventListener('click', () => { closeModal(); goHome(); });
  } else {
    goHome();
  }
});

$('#btn-duel').addEventListener('click', () => openSetup('c1'));
$('#btn-free').addEventListener('click', () => startGame('free', randomCode()));

/* ---------------- 变奏挑战:默认按日期轮换「今日变奏」,也可随机换 ---------------- */
function todaysVariant() {
  const rng = seededRng('variant-' + todayStr());
  return VARIANTS[(rng() * VARIANTS.length) | 0];
}
function openVariantIntro(forced = null) {
  const v = forced || todaysVariant();
  const box = openModal(`
    ${!forced ? `<div class="variant-today">📅 ${t('今日变奏')}</div>` : ''}
    <div class="variant-flip">${v.emoji}</div>
    <h3>${v.name}</h3>
    <p class="variant-rule">${v.rule}</p>
    <p class="variant-tip">💡 ${v.tip}</p>
    <div class="modal-actions"><button class="big-btn primary" id="v-go">${t("开猜！")}</button></div>
    <div class="modal-actions"><button class="big-btn" id="v-other">${t("🎲 换一条规则")}</button></div>`);
  sfx('ability', 0.45);
  box.querySelector('#v-go').addEventListener('click', () => {
    closeModal();
    startGame('variant', v.gen(), null, v);
  });
  box.querySelector('#v-other').addEventListener('click', () => {
    const others = VARIANTS.filter(x => x.id !== v.id);
    openVariantIntro(others[(Math.random() * others.length) | 0]);
  });
}
$('#btn-variant').addEventListener('click', () => openVariantIntro());
$('#btn-daily').addEventListener('click', () => {
  const today = todayStr();
  // 进行中的今日局优先恢复(比"已完成"判定更早:首猜防刷记录不算完成)
  const run = store.dailyRun;
  if (run && run.date === today && run.guesses && run.guesses.length) return resumeDaily(run);
  if (run && run.date !== today) { store.dailyRun = null; save(); }
  const done = store.daily[today];
  if (done) {
    // 已完成：直接展示战报
    const shareText = T`码上猜 CodePop 每日挑战 #${dailyNumber()}\n${done.win ? T`${done.steps} 步破解 ${'⭐'.repeat(starCount(done.steps))}` : t("未能破解 💦")}\n${shareGrid(done.grid)}\n${baseUrl()}`;
    $('#result-card').innerHTML = `
      <img class="card-icon" src="assets/icons/sun.png">
      <div class="card-title">${t("今日挑战已完成")}</div>
      <div class="card-sub">${done.win ? t("%1 步破解 · 🔥 连胜 %2 天", done.steps, store.streak) : t("今天没能破解，明天再战！")}<br>${t("新密码 %1 后刷新", "<b>" + dailyCountdownText() + "</b>")}</div>
      <div class="share-box">${esc(shareText)}</div>
      <div class="card-actions">
        <button class="big-btn green" id="r-share"><img src="assets/icons/share.png">${t("分享战报")}</button>
        <button class="big-btn" id="r-home"><img src="assets/icons/arrow-left.png">${t("回主页")}</button>
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

$('#help-hint').addEventListener('click', () => $('#btn-help').click());
$('#help-hint-close').addEventListener('click', e => {
  e.stopPropagation();
  markHelpSeen();
  sfx('ui', 0.3);
});
$('#btn-help').addEventListener('click', () => {
  markHelpSeen();
  openModal(`
    <h3>${t("🎯 怎么玩")}</h3>
    <p>${t("<b>目标：</b>密码是 <b>4 个不重复</b>的图标。用最少的步数，猜出<b>是哪 4 个</b>、<b>按什么顺序</b>排的。")}</p>
    <p>${t("<b>每猜一次，右边给你两个数：</b>")}<br>
    <span class="fb-chip fb-icons">${t("图案")} <b>2</b></span> ${t("你摆的图标里，有 2 个确实在密码里")}<br>
    <span class="fb-chip fb-pos">${t("位置")} <b>1</b></span> ${t("这 2 个里面，只有 1 个站对了地方")}</p>
    <div class="help-example">
      ${iconTileHTML(0)}${iconTileHTML(2)}${iconTileHTML(4)}${iconTileHTML(7)}
      <div class="help-fb">${feedbackHTML(1, 1)}</div>
    </div>
    <p style="text-align:center;font-size:12.5px">${t("例：密码是 🍎🐱⭐⚡，你猜 🍎⭐🍀🌙")}<br>${t("🍎⭐ 都在密码里 → 图案 2；但只有 🍎 站对了地方 → 位置 1")}</p>
    <p>${t("注意：它<b>不会告诉你对的是哪几个</b>——推理出来才过瘾！")}</p>
    <p>${t("<b>道具：</b>🧲 磁铁问两个图标在不在（+1步） · 🔭 望远镜偷看一个位置（+3步） · 📺 看 15 秒小广告，免费排除一个不在的图标")}</p>
    <p>${t("<b>次数：</b>普通局有 12 次机会，右上角随时看剩余次数。")}</p>
    <p>${t("<b>小技巧：</b>长按或右键键盘图标，可以标记「排除/锁定」帮助推理。")}</p>
    <p>${t("<b>好友对战：</b>布置密码 → 发链接给好友 → TA 破解后出题反击 → 你迎战 → 步数少者赢！不用同时在线，随时接招。")}</p>
    <div class="modal-actions"><button class="big-btn primary" id="m-ok">${t("明白了！")}</button></div>`)
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

/* ---------------- 背景：飞行的小图标 ---------------- */
(function spawnFloaters() {
  const zone = $('#bg-zone');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // 减弱动效：静态散布，不飞
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

/* ---------------- 语言切换 ---------------- */
applyStaticLang(); // 词典已随 i18n-data.js 就绪,翻译静态界面
$('#btn-lang').addEventListener('click', () => {
  const rows = LANGS.map(l =>
    `<button class="big-btn lang-row${l.code === currentLang() ? ' primary' : ''}" data-lang="${l.code}">${l.native}</button>`
  ).join('');
  const warn = (game.active && game.guesses.length > 0 && !game.finished)
    ? `<p style="text-align:center">${t('当前进度不会保存哦。')}</p>` : '';
  const box = openModal(`
    <h3>🌐 Language</h3>
    ${warn}
    <div class="lang-grid">${rows}</div>`);
  box.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
    store.lang = btn.dataset.lang;
    save();
    location.reload();
  }));
});

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
  syncHelpHint();
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
