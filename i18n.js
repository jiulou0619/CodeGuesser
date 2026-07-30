/* ============================================================
   码上猜 CodePop — 多语言运行时
   词典键 = 简体中文原文(zh 恒等,无需词典);其余语种词典在 i18n-data.js 注入。
   ============================================================ */
'use strict';

const LANGS = [
  { code: 'en', native: 'English' },
  { code: 'zh', native: '简体中文' },
  { code: 'zht', native: '繁體中文' },
  { code: 'es', native: 'Español' },
  { code: 'pt', native: 'Português' },
  { code: 'it', native: 'Italiano' },
  { code: 'fr', native: 'Français' },
  { code: 'ja', native: '日本語' },
  { code: 'ko', native: '한국어' },
  { code: 'ar', native: 'العربية' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'vi', native: 'Tiếng Việt' },
];

const I18N = {}; // i18n-data.js 里 Object.assign 注入

let CUR_LANG = 'en';
function setCurrentLang(code) {
  CUR_LANG = LANGS.some(l => l.code === code) ? code : 'en';
}
function currentLang() { return CUR_LANG; }

function i18nLookup(key) {
  if (CUR_LANG === 'zh') return key;
  const d = I18N[CUR_LANG];
  if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
  const en = I18N.en;
  if (en && Object.prototype.hasOwnProperty.call(en, key)) return en[key];
  return key; // 兜底:显示简中原文
}
function i18nFmt(s, args) {
  return s.replace(/%(\d+)/g, (m, n) => (args[n - 1] !== undefined ? String(args[n - 1]) : m));
}
/* 普通取词:t('原文', 参数...) —— 原文里 %1 %2 为占位符 */
function t(key, ...args) { return i18nFmt(i18nLookup(key), args); }
/* 标签模板取词:T`原文 ${x} 原文` —— 插值自动映射为 %1 %2 */
function T(strings, ...vals) {
  let key = strings[0];
  for (let i = 1; i < strings.length; i++) key += '%' + i + strings[i];
  return i18nFmt(i18nLookup(key), vals);
}

/* 静态 DOM 翻译:遍历文本节点与常见属性,按词典替换(键=简中原文) */
function applyStaticLang() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const raw = n.textContent, txt = raw.trim();
    if (!txt || !/[一-鿿]/.test(txt)) continue;
    const tr = i18nLookup(txt);
    if (tr !== txt) n.textContent = raw.replace(txt, tr);
  }
  document.querySelectorAll('[placeholder],[title],[alt]').forEach(el => {
    for (const a of ['placeholder', 'title', 'alt']) {
      const v = el.getAttribute(a);
      if (v && /[一-鿿]/.test(v)) {
        const tr = i18nLookup(v);
        if (tr !== v) el.setAttribute(a, tr);
      }
    }
  });
  // 标题与描述:用 DOM 现值(简中原文)作为键自查,避免硬编码键的标点不一致
  const trTitle = i18nLookup(document.title);
  if (trTitle !== document.title) document.title = trTitle;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    const trDesc = i18nLookup(meta.content);
    if (trDesc !== meta.content) meta.content = trDesc;
  }
}

/* 初始化:直接读 localStorage(先于 game.js 的常量求值) */
(function initI18n() {
  let lang = 'en';
  try {
    const s = JSON.parse(localStorage.getItem('codepop-v1') || '{}');
    if (s.lang) lang = s.lang;
  } catch (e) { /* ignore */ }
  setCurrentLang(lang);
  document.documentElement.lang = { zh: 'zh-CN', zht: 'zh-TW' }[CUR_LANG] || CUR_LANG;
  document.documentElement.dir = CUR_LANG === 'ar' ? 'rtl' : 'ltr';
})();
