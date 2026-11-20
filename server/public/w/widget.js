// Общий код виджетов KZStream: состояние + realtime-события
// Виджет сам подстраивается под рамку источника в TikTok Live Studio / OBS:
// тянете рамку — виджет масштабируется и заполняет её без пустого места.
// &s=150 в ссылке — дополнительный множитель размера.
(() => {
  const mult = (() => { const z = +new URLSearchParams(location.search).get('s'); return z >= 30 && z <= 300 ? z / 100 : 1; })();
  const demo = /[?&](demo|preview)/.test(location.search);
  function fit() {
    const el = document.querySelector('[data-fit]'); if (!el) return;
    const cur = parseFloat(el.style.zoom) || 1;
    const tr = el.style.transition; el.style.transition = 'opacity .4s, transform .4s';
    el.style.zoom = 1; const r = el.getBoundingClientRect(); const nw = r.width, nh = r.height;
    const cs = getComputedStyle(document.body), px = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), py = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    if (!nw || !nh) { el.style.zoom = cur; return; }
    const fitK = Math.min((innerWidth - px) * 0.95 / nw, (innerHeight - py) * 0.92 / nh, 6);
    // превью в кабинете: только уменьшаем, чтобы виджет целиком помещался в окошко
    const k = demo ? Math.max(0.2, Math.min(1, fitK)) : Math.max(0.2, fitK) * mult;
    el.style.zoom = k;
  }
  addEventListener('resize', fit);
  addEventListener('load', () => {
    fit();
    const el = document.querySelector('[data-fit]');
    if (el && window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fit)).observe(el);
    if (el && window.MutationObserver) new MutationObserver(() => requestAnimationFrame(fit)).observe(el, { childList: true, subtree: true, characterData: true });
  });
  setInterval(fit, 2000);
})();
window.KZ = (() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const handlers = {};
  const THEMES = {
    default: ['rgba(14,15,26,.82)', '#fff', '#ff3b5c', '#ff7a45'],
    neon: ['rgba(8,4,24,.85)', '#e9e6ff', '#8b6cff', '#3ee6c4'],
    sunset: ['rgba(40,12,20,.82)', '#fff3ea', '#ff7a45', '#ffc84a'],
    mint: ['rgba(6,26,24,.82)', '#eafff9', '#3ee6c4', '#7dffb2'],
    royal: ['rgba(14,10,40,.85)', '#fff', '#5b7cff', '#c86bff'],
    mono: ['rgba(0,0,0,.8)', '#fff', '#ffffff', '#9a9a9a'],
    candy: ['rgba(40,10,36,.82)', '#fff', '#ff6bd6', '#ffb86b'],
    steppe: ['rgba(6,24,40,.85)', '#fff', '#00b3e6', '#ffd23f'],
    ice: ['rgba(230,244,255,.9)', '#0b2a44', '#2f9bff', '#6ad7ff'],
    gold: ['rgba(20,16,6,.88)', '#fff6dd', '#ffc84a', '#ff9d2e'],
  };
  function theme(name) {
    const t = THEMES[name] || THEMES.default, r = document.documentElement.style;
    r.setProperty('--w-bg', t[0]); r.setProperty('--w-fg', t[1]); r.setProperty('--w-a', t[2]); r.setProperty('--w-b', t[3]);
  }
  const on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  const fire = (ev, d) => (handlers[ev] || []).forEach(f => f(d));
  async function start() {
    if (!token) { document.body.innerHTML = '<p style="color:#fff;font:16px sans-serif;padding:20px">Нет токена в ссылке. Скопируйте ссылку виджета из кабинета KZStream.</p>'; return; }
    try {
      const st = await fetch('/api/w/' + token + '/state').then(r => { if (!r.ok) throw 0; return r.json(); });
      fire('state', st);
    } catch { document.body.innerHTML = '<p style="color:#fff;font:16px sans-serif;padding:20px">Неверная ссылка виджета. Скопируйте новую из кабинета KZStream.</p>'; return; }
    const es = new EventSource('/api/w/' + token + '/stream');
    ['donation', 'roulette', 'stats', 'settings', 'skip', 'media_skip', 'faceit', 'tt'].forEach(ev => es.addEventListener(ev, e => fire(ev, JSON.parse(e.data))));
    es.onerror = () => {}; // EventSource переподключается сам
    // раз в 5 минут — полная синхронизация
    setInterval(() => fetch('/api/w/' + token + '/state').then(r => r.json()).then(st => fire('state', st)).catch(() => {}), 300000);
  }
  const fmt = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debug = new URLSearchParams(location.search).has('preview');
  if (debug) document.documentElement.style.background = '#1a1d2b';
  return { token, on, start, theme, fmt, esc };
})();
