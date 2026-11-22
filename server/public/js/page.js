// Личная страница (редактор с вкладками и превью в телефоне), обзор на главной и боковое меню
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
  const toast = (m, e) => window.kzToast ? window.kzToast(m, e) : alert(m);
  const api = (u, o) => window.kzApi(u, o);
  const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? c : d > 1 && d < 5 ? b : d === 1 ? a : c; };
  const dons = n => n + ' ' + plural(n, 'донат', 'доната', 'донатов');

  // ---------- боковое меню: свёртываемые группы ----------
  let shut = {}; try { shut = JSON.parse(localStorage.kzSb || '{}'); } catch { }
  $$('.sb-grp').forEach(g => {
    if (shut[g.dataset.g]) g.classList.add('shut');
    g.querySelector('.sb-h').onclick = () => { g.classList.toggle('shut'); shut[g.dataset.g] = g.classList.contains('shut'); try { localStorage.kzSb = JSON.stringify(shut); } catch { } };
  });
  // открыть группу, если в ней активный пункт
  const openActive = () => { const a = $('.menu a.on'); const g = a && a.closest('.sb-grp'); if (g) g.classList.remove('shut'); };
  addEventListener('hashchange', () => setTimeout(openActive, 30));

  // ---------- данные ----------
  const DEV = [['cpu', 'Процессор', 'Ryzen 7 7800X3D'], ['gpu', 'Видеокарта', 'RTX 4070 Super'], ['ram', 'Память', '32 ГБ DDR5'], ['mb', 'Материнская плата', 'MSI B650'], ['storage', 'Накопитель', 'SSD 1 ТБ'], ['monitor', 'Монитор', '27" 240 Гц'], ['mouse', 'Мышь', 'Logitech G Pro'], ['keyboard', 'Клавиатура', 'HyperX Alloy'], ['headphones', 'Наушники', 'HyperX Cloud II'], ['mic', 'Микрофон', 'Fifine K669'], ['camera', 'Камера', 'Logitech C920'], ['pad', 'Коврик', 'SteelSeries QcK']];
  const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const DESIGNS = [
    { id: 'classic', name: 'Классика', bg: 'linear-gradient(160deg,#1a0f1c,#0b0c12)', a: '#ff3b5c', b: 'rgba(255,255,255,.12)' },
    { id: 'hud', name: 'HUD', bg: 'linear-gradient(160deg,#04121a,#020609)', a: '#00e5ff', b: 'rgba(0,229,255,.18)' },
    { id: 'minimal', name: 'Минимал', bg: '#111214', a: '#ffffff', b: 'rgba(255,255,255,.08)' },
    { id: 'pastel', name: 'Пастель', bg: 'linear-gradient(160deg,#ffd9e8,#d9e4ff)', a: '#ff7aa8', b: 'rgba(255,255,255,.7)' },
    { id: 'amethyst', name: 'Аметист', bg: 'linear-gradient(160deg,#2a0f4a,#0d0620)', a: '#b47cff', b: 'rgba(180,124,255,.2)' },
  ];
  const FX = [['none', '🚫', 'Нет'], ['rain', '🌧', 'Дождь'], ['snow', '❄️', 'Снег'], ['leaves', '🍂', 'Листопад'], ['confetti', '🎉', 'Конфетти'], ['fireflies', '✨', 'Светлячки'], ['stars', '⭐', 'Звёзды']];
  const COLORS = ['#ff3b5c', '#ff7a45', '#ffc531', '#2bd67b', '#3ee6c4', '#2f9bff', '#8b6cff', '#ff6bd6', '#ffffff'];
  const SOC = [['youtube', 'YouTube', '#ff0000', 'youtube.com/@канал'], ['twitch', 'Twitch', '#9146ff', 'twitch.tv/ник'], ['telegram', 'Telegram', '#229ed9', 't.me/канал'], ['instagram', 'Instagram', 'linear-gradient(45deg,#f9a825,#e91e63,#7b1fa2)', 'instagram.com/ник'], ['tiktok', 'TikTok', '#000', 'tiktok.com/@ник'], ['discord', 'Discord', '#5865f2', 'discord.gg/приглашение'], ['donationalerts', 'DonationAlerts', '#f57c00', 'donationalerts.com/r/ник']];
  const SOCRX = { youtube: /(youtube\.com|youtu\.be)$/, twitch: /twitch\.tv$/, telegram: /(t\.me|telegram\.me)$/, instagram: /instagram\.com$/, tiktok: /tiktok\.com$/, discord: /(discord\.gg|discord\.com)$/, donationalerts: /(donationalerts\.com|donationalerts\.ru|dalink\.to)$/ };

  const S = { design: 'classic', effect: 'none', layer: 'over', devType: 'pc', days: [], avatar: '', banner: '', bg: '' };
  let loaded = false, dirty = false;
  const ME = () => window.KZME;
  const lite = () => !!(ME() && ME().plan && ME().plan.shop);

  // ---------- вкладки ----------
  $('#lpTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#lpTabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.lp-pane').forEach(p => p.classList.toggle('on', p.dataset.p === b.dataset.t)); };

  // ---------- строки-списки ----------
  function rows(box, list, fields, max, addBtn) {
    const el = $(box); el.innerHTML = '';
    const add = (v = {}) => {
      if (el.children.length >= max) return toast('Максимум ' + max, true);
      const r = document.createElement('div'); r.className = 'lp-row';
      r.innerHTML = fields.map(([k, ph, w]) => `<input data-k="${k}" placeholder="${esc(ph)}" maxlength="${w || 60}" value="${esc(v[k] || '')}">`).join('') + '<button class="x" type="button" title="Удалить">✕</button>';
      r.querySelector('.x').onclick = () => { r.remove(); mark(); };
      el.appendChild(r);
    };
    list.forEach(add);
    $(addBtn).onclick = () => { add(); mark(); };
  }
  const readRows = box => $$(box + ' > .lp-row').map(r => Object.fromEntries([...r.querySelectorAll('input')].map(i => [i.dataset.k, i.value.trim()])));

  function textBlocks(list) {
    const el = $('#lpTexts'); el.innerHTML = '';
    const add = (v = {}) => {
      if (el.children.length >= 5) return toast('Максимум 5 блоков', true);
      const d = document.createElement('div'); d.className = 'lp-blk';
      d.innerHTML = `<div class="lp-row"><input data-k="title" maxlength="60" placeholder="Заголовок" value="${esc(v.title || '')}"><button class="x" type="button">✕</button></div><textarea data-k="text" maxlength="1000" rows="3" placeholder="Текст блока">${esc(v.text || '')}</textarea>`;
      d.querySelector('.x').onclick = () => { d.remove(); mark(); };
      el.appendChild(d);
    };
    list.forEach(add); $('#lpTextAdd').onclick = () => { add(); mark(); };
  }
  function linkBlocks(list) {
    const el = $('#lpLinks'); el.innerHTML = '';
    const add = (v = { items: [{}] }) => {
      if (el.children.length >= 5) return toast('Максимум 5 блоков', true);
      const d = document.createElement('div'); d.className = 'lp-blk';
      d.innerHTML = `<div class="lp-row"><input data-k="title" maxlength="60" placeholder="Заголовок блока, напр. «Мой мерч»" value="${esc(v.title || '')}"><button class="x" type="button">✕</button></div><div class="li"></div><button class="btn btn-ghost btn-sm" type="button" data-a>+ Кнопка</button>`;
      const li = d.querySelector('.li');
      const addI = (it = {}) => {
        if (li.children.length >= 6) return toast('Максимум 6 кнопок', true);
        const r = document.createElement('div'); r.className = 'lp-row';
        r.innerHTML = `<input data-k="label" maxlength="40" placeholder="Текст кнопки" value="${esc(it.label || '')}"><input data-k="url" maxlength="300" placeholder="https://…" value="${esc(it.url || '')}"><button class="x" type="button">✕</button>`;
        r.querySelector('.x').onclick = () => { r.remove(); mark(); };
        li.appendChild(r);
      };
      (v.items && v.items.length ? v.items : [{}]).forEach(addI);
      d.querySelector('.x').onclick = () => { d.remove(); mark(); };
      d.querySelector('[data-a]').onclick = () => { addI(); mark(); };
      el.appendChild(d);
    };
    list.forEach(add); $('#lpLinkAdd').onclick = () => { add(); mark(); };
  }

  // ---------- выборы ----------
  function pick(box, v) { $$(box + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
  $('#lpDevType').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.devType = b.dataset.v; pick('#lpDevType', S.devType); mark(); };
  $('#lpLayer').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.layer = b.dataset.v; pick('#lpLayer', S.layer); mark(); };
  $('#lpDays').innerHTML = DAYS.map((d, i) => `<button type="button" data-d="${i}">${d}</button>`).join('');
  $('#lpDays').onclick = e => { const b = e.target.closest('button'); if (!b) return; const d = +b.dataset.d; S.days = S.days.includes(d) ? S.days.filter(x => x !== d) : [...S.days, d]; days(); mark(); };
  const days = () => $$('#lpDays button').forEach(b => b.classList.toggle('on', S.days.includes(+b.dataset.d)));
  $('#lpDevs').innerHTML = DEV.map(([k, l, ph]) => `<div><label>${l}</label><input data-dev="${k}" maxlength="60" placeholder="${ph}"></div>`).join('');

  function designs() {
    $('#lpDesigns').innerHTML = DESIGNS.map(d => `<button type="button" data-v="${d.id}" class="${S.design === d.id ? 'on' : ''}"><i style="background:${d.bg}"><style>[data-v="${d.id}"] i::before{background:${d.a}}[data-v="${d.id}"] i::after{background:${d.b}}</style></i>${d.name}${d.id !== 'classic' && !lite() ? '<em>Lite</em>' : ''}</button>`).join('');
  }
  $('#lpDesigns').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v !== 'classic' && !lite()) return toast('Этот дизайн — с тарифа Lite', true); S.design = b.dataset.v; designs(); mark(); };
  function fx() { $('#lpFx').innerHTML = FX.map(([id, ic, n]) => `<button type="button" data-v="${id}" class="${S.effect === id ? 'on' : ''}"><b>${ic}</b>${n}${id !== 'none' && !lite() ? '<em>Lite</em>' : ''}</button>`).join(''); }
  $('#lpFx').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v !== 'none' && !lite()) return toast('Эффекты — с тарифа Lite', true); S.effect = b.dataset.v; fx(); mark(); };
  $('#lpColors').innerHTML = COLORS.map(c => `<button type="button" style="background:${c}" data-c="${c}"></button>`).join('');
  $('#lpColors').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#pg_color').value = b.dataset.c; colors(); mark(); };
  const colors = () => $$('#lpColors button').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === $('#pg_color').value.toLowerCase()));
  $('#pg_color').oninput = () => { colors(); mark(); };

  $('#lpSoc').innerHTML = SOC.map(([k, n, c, ph]) => `<div class="lp-soc"><i style="background:${c}">${n.slice(0, 2)}</i><input data-soc="${k}" maxlength="200" placeholder="${n}: ${ph}"><span class="ok" data-ok="${k}"></span></div>`).join('');
  const socCheck = () => $$('[data-soc]').forEach(i => {
    const v = i.value.trim(), o = $(`[data-ok="${i.dataset.soc}"]`); if (!v) { o.textContent = ''; return; }
    let h = ''; try { h = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, ''); } catch { }
    const ok = SOCRX[i.dataset.soc].test(h); o.textContent = ok ? '✓' : '✕'; o.style.color = ok ? '#2bd67b' : '#ff6b81';
  });

  function counters() { $$('.lp-cnt').forEach(c => { const t = $('#' + c.dataset.for); c.textContent = (t.value || '').length + ' / ' + t.maxLength; }); }
  function pv() {
    for (const k of ['avatar', 'banner', 'bg']) { const el = $(`[data-pv="${k}"]`); el.style.backgroundImage = S[k] ? `url("${S[k]}")` : ''; el.classList.toggle('has', !!S[k]); }
  }
  function mark() { dirty = true; $('#lpSave').textContent = 'Сохранить •'; }
  $('#p-page').addEventListener('input', e => { if (e.target.closest('.lp-ed')) { mark(); if (e.target.dataset.soc) socCheck(); if (e.target.tagName === 'TEXTAREA') counters(); } });

  // ---------- загрузка в форму ----------
  function fill() {
    const me = ME(); if (!me) return; const pg = me.settings.page;
    const v = (id, x) => { const el = $('#' + id); if (el) el.value = x ?? ''; };
    v('lpLink', me.urls.page); $('#lpOpen').href = me.urls.page;
    v('pg_title', pg.title); v('pg_tiktok', pg.tiktok); v('pg_description', pg.description); v('pg_extra', pg.extra); v('pg_min', pg.min_amount);
    v('pg_kaspi', pg.kaspi); v('pg_receiver', pg.receiver);
    let cards2 = pg.cards2 || []; if (!cards2.length && pg.cards) cards2 = [{ bank: 'Карта', number: pg.cards }];
    rows('#lpCards', cards2, [['bank', 'Банк: Halyk, Freedom…', 30], ['number', 'Номер карты или IBAN', 40]], 5, '#lpCardAdd');
    const dv = pg.devices || {}; S.devType = dv.type || 'pc'; pick('#lpDevType', S.devType);
    $$('[data-dev]').forEach(i => i.value = (dv.items || {})[i.dataset.dev] || '');
    rows('#lpCustom', dv.custom || [], [['k', 'Название', 30], ['v', 'Модель', 60]], 6, '#lpCustomAdd');
    const sc = pg.schedule || {}; S.days = sc.days || []; days(); v('lpStart', sc.start); v('lpEnd', sc.end);
    S.avatar = pg.avatar || ''; S.banner = pg.banner || ''; S.bg = pg.bg || ''; pv();
    S.design = pg.design || 'classic'; S.effect = pg.effect || 'none'; S.layer = pg.effect_layer || 'over'; designs(); fx(); pick('#lpLayer', S.layer);
    v('pg_color', pg.color || '#ff3b5c'); colors();
    const bl = pg.blocks || {}; textBlocks(bl.texts || []); linkBlocks(bl.links || []);
    $$('[data-soc]').forEach(i => i.value = (pg.socials || {})[i.dataset.soc] || ''); socCheck();
    counters(); dirty = false; $('#lpSave').textContent = 'Сохранить';
    frame();
  }
  let fr = false;
  function frame(force) { const me = ME(); if (!me) return; if (location.hash !== '#page' && !fr) return; fr = true; $('#lpFrame').src = me.urls.page + '?pv=' + Date.now(); }
  addEventListener('hashchange', () => { if (location.hash === '#page' && !fr) frame(); });

  window.pageCollect = () => ({ page: {
    title: $('#pg_title').value, tiktok: $('#pg_tiktok').value, description: $('#pg_description').value, extra: $('#pg_extra').value, min_amount: +$('#pg_min').value,
    kaspi: $('#pg_kaspi').value, receiver: $('#pg_receiver').value,
    cards2: readRows('#lpCards').filter(c => c.bank || c.number).map(c => ({ bank: c.bank || 'Карта', number: c.number })), cards: '',
    devices: { type: S.devType, items: Object.fromEntries($$('[data-dev]').map(i => [i.dataset.dev, i.value.trim()]).filter(x => x[1])), custom: readRows('#lpCustom').filter(r => r.k && r.v) },
    schedule: { days: S.days, start: $('#lpStart').value, end: $('#lpEnd').value },
    avatar: S.avatar, banner: S.banner, bg: S.bg, design: S.design, effect: S.effect, effect_layer: S.layer, color: $('#pg_color').value,
    blocks: {
      texts: $$('#lpTexts > .lp-blk').map(d => ({ title: d.querySelector('[data-k=title]').value.trim(), text: d.querySelector('[data-k=text]').value.trim() })).filter(t => t.title || t.text),
      links: $$('#lpLinks > .lp-blk').map(d => ({ title: d.querySelector('[data-k=title]').value.trim(), items: [...d.querySelectorAll('.li .lp-row')].map(r => ({ label: r.querySelector('[data-k=label]').value.trim(), url: r.querySelector('[data-k=url]').value.trim() })).filter(i => i.label || i.url) })).filter(l => l.items.length),
    },
    socials: Object.fromEntries($$('[data-soc]').map(i => [i.dataset.soc, i.value.trim()])),
  } });

  async function save(quiet) {
    const body = window.pageCollect();
    for (const l of body.page.blocks.links) for (const i of l.items) if (!/^https?:\/\/\S+$/i.test(i.url) || !i.label) { toast(`Кнопка «${i.label || i.url}»: нужен текст и ссылка, начинающаяся с https://`, true); return false; }
    const bad = $$('[data-ok]').find(o => o.textContent === '✕'); if (bad) { toast('Проверьте ссылку ' + SOC.find(s => s[0] === bad.dataset.ok)[1] + ' — она с другого сайта', true); return false; }
    try {
      const r = await api('/api/settings', { method: 'PUT', body });
      window.KZME.settings = r.settings; dirty = false; $('#lpSave').textContent = 'Сохранить';
      if (!quiet) { if (r.warnings && r.warnings.length) toast(r.warnings.join('. '), true); else toast('Страница сохранена ✓'); }
      frame(); return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  $('#lpSave').onclick = () => save();

  // ---------- аватар / баннер / фон: отдельное хранение, не в «Хранилище» ----------
  document.addEventListener('change', async e => {
    const inp = e.target.closest('[data-pf]'); if (!inp || !inp.files[0]) return;
    const f = inp.files[0], kind = inp.dataset.pf; inp.value = '';
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return toast('Нужна картинка: JPG, PNG, GIF или WEBP', true);
    if (f.size > 8 * 1048576) return toast('Картинка больше 8 МБ', true);
    try {
      toast('Загружаем…');
      const r = await fetch('/api/page/upload?kind=' + kind, { method: 'POST', headers: { 'Content-Type': f.type }, body: f }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      S[kind] = r.url; pv(); await save(true); toast({ avatar: 'Аватар', banner: 'Баннер', bg: 'Фон' }[kind] + ' обновлён ✓');
    } catch (er) { toast(er.message, true); }
  });
  document.addEventListener('click', e => { const u = e.target.closest('[data-pfunset]'); if (!u) return; S[u.dataset.pfunset] = ''; pv(); save(true); });

  // ---------- обзор на главной ----------
  let range = 'today';
  $('#ovRng').onclick = e => { const b = e.target.closest('button'); if (!b) return; range = b.dataset.r; $$('#ovRng button').forEach(x => x.classList.toggle('on', x === b)); overview(); };
  function profile() {
    const me = ME(); if (!me) return; const pg = me.settings.page, p = me.plan;
    const name = pg.title || me.nick, ava = pg.avatar;
    for (const [a, n] of [['#ovAva', '#ovNick'], ['#sbAva', '#sbNick']]) { const el = $(a); el.style.backgroundImage = ava ? `url("${ava}")` : ''; el.textContent = ava ? '' : name[0].toUpperCase(); $(n).textContent = name; }
    const pid = p.id || 'free', badge = pid === 'free' ? 'FREE' : p.name.toUpperCase();
    $('#sbPlan').textContent = badge; $('#sbPlan').className = 'sb-plan ' + pid;
    const until = me.is_admin ? 'владелец' : pid !== 'free' ? 'до ' + new Date(me.plan_until).toLocaleDateString('ru-RU') : 'бесплатно';
    $('#sbUntil').textContent = p.name + ' · ' + until; $('#sbBal').textContent = fmt(me.balance); $('#ovBal').textContent = fmt(me.balance);
    $('#sbTariff').textContent = pid === 'free' ? 'free' : p.name;
    $('#ovTags').innerHTML = `<span class="pl">${esc(p.name)}</span>${me.vip ? '<span>VIP</span>' : ''}<span>@${esc(me.nick)}</span>${pg.tiktok ? `<span>TikTok: @${esc(pg.tiktok)}</span>` : ''}<span>${esc(until)}</span>`;
  }
  async function overview() {
    if (!ME()) return;
    try {
      const o = await api('/api/overview?range=' + range), c = o.cards;
      $('#stToday').textContent = fmt(c.today.s); $('#ovTodayC').textContent = dons(c.today.c);
      $('#ovWeek').textContent = fmt(c.week.s); $('#ovWeekC').textContent = dons(c.week.c);
      $('#stMonth').textContent = fmt(c.month.s);
      const d = $('#ovMonthD');
      if (c.prev.s) { const pc = Math.round((c.month.s - c.prev.s) / c.prev.s * 100); d.textContent = (pc >= 0 ? '▲ +' : '▼ ') + pc + '% к прошлому'; d.className = pc >= 0 ? 'up' : 'dn'; } else { d.textContent = dons(c.month.c); d.className = ''; }
      $('#ovAll').textContent = fmt(c.all.s); $('#stCnt').textContent = dons(c.all.c);
      const max = Math.max(1, ...o.series.map(x => x.sum)), every = o.series.length > 12 ? Math.ceil(o.series.length / 8) : o.series.length > 8 ? 2 : 1, tot = o.series.reduce((a, x) => a + x.sum, 0), cnt = o.series.reduce((a, x) => a + x.cnt, 0);
      $('#ovChart').innerHTML = o.series.map((x, i) => `<div title="${esc(x.label)}: ${fmt(x.sum)} · ${dons(x.cnt)}"><i class="${x.sum ? '' : 'z'}" style="height:${x.sum ? Math.max(4, x.sum / max * 100) : 2}%"></i><u>${i % every === 0 ? esc(x.label) : '&nbsp;'}</u></div>`).join('');
      $('#ovSum').textContent = `За период: ${fmt(tot)} · ${dons(cnt)}`;
      $('#ovTop').innerHTML = o.top.length ? o.top.map((t, i) => `<div class="ov-l"><span class="p t">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="n">${esc(t.name)}</span><span class="s">${fmt(t.total)}</span></div>`).join('') : '<div class="muted">Пока нет донатов в этом месяце</div>';
      $('#ovRecent').innerHTML = o.recent.length ? o.recent.map(r => `<div class="ov-l"><span class="p">💸</span><span class="n">${esc(r.name)}<small>${esc(r.message || '—')}</small></span><span class="muted" style="font-size:12px;white-space:nowrap">${new Date(r.done_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span class="s">${fmt(r.amount)}</span></div>`).join('') : '<div class="muted">Пока нет донатов</div>';
      const on = o.app.windows || (o.app.last_ingest && Date.now() - o.app.last_ingest < 30 * 60e3);
      $('#sbApp').classList.toggle('on', !!on);
      $('#sbApp span').textContent = o.app.windows ? 'Программа активна' : on ? 'Телефон передаёт донаты' : 'Программа не активна';
    } catch { }
  }
  let ovT = 0; const ovSoon = () => { clearTimeout(ovT); ovT = setTimeout(overview, 400); };
  addEventListener('kz:stats', ovSoon);
  addEventListener('kz:me', () => { profile(); ovSoon(); openActive(); if (!loaded) { fill(); loaded = true; } });
  setInterval(() => { if (!document.hidden) overview(); }, 30000);
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  if (window.KZME) dispatchEvent(new Event('kz:me'));
})();
