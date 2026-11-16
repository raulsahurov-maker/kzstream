(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = t => t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
let ME = null, FILES = [];

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 3200); }
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401) { location.href = '/#login'; throw new Error('Требуется вход'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Ошибка сервера');
  return j;
}
const val = (id, v) => { const el = $('#' + id); if (!el) return; if (v === undefined) return el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; };

// ---------- навигация ----------
function route() {
  const id = (location.hash || '#home').slice(1);
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + id));
  if (!$('#p-' + id)) $('#p-home').classList.add('on');
  $$('.menu a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
  $('aside').classList.remove('open');
  if (id === 'donations') loadDonations();
  if (id === 'devices') loadIngest();
  if (id === 'billing') loadPayments();
  if (id === 'files') loadFiles();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- загрузка профиля ----------
async function load() {
  ME = await api('/api/me');
  FILES = await api('/api/files');
  render();
}
function render() {
  const s = ME.settings, p = ME.plan;
  $('#nickH').textContent = ME.nick;
  $('#adminLink').style.display = ME.is_admin ? '' : 'none';
  $('#pageLinkBtn').href = ME.urls.page;
  val('homePage', ME.urls.page); val('ingestUrl', ME.urls.ingest);
  $('#stToday').textContent = fmt(ME.stats.today); $('#stMonth').textContent = fmt(ME.stats.month);
  $('#stTotal').textContent = fmt(ME.stats.total); $('#stCnt').textContent = ME.stats.cnt;
  const until = ME.plan.id !== 'free' ? `до ${new Date(ME.plan_until).toLocaleDateString('ru-RU')}` : 'бесплатно';
  $('#sidePlan').innerHTML = `<div class="muted">Тариф</div><b>${p.name}</b>${ME.vip ? ' <span class="tag ok">VIP</span>' : ''}<div class="muted">${until}</div><a href="#billing" class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%">${p.id === 'pro' ? 'Продлить' : 'Улучшить'}</a>`;
  // замки
  $$('[data-need]').forEach(l => l.style.display = p[l.dataset.need] ? 'none' : '');
  // темы
  $$('[data-themes]').forEach(sel => sel.innerHTML = ME.themes.map(t => `<option value="${t}">${t}</option>`).join(''));
  fillFileSelects();
  // алерты
  const a = s.alerts;
  $('#durMax').textContent = `(до ${p.maxDuration})`; $('#a_duration').max = p.maxDuration;
  ['duration', 'volume', 'min_alert', 'min_tts', 'tts_lang', 'tts_rate', 'theme'].forEach(k => val('a_' + k, a[k]));
  val('a_gif', a.gif); val('a_sound', a.sound);
  ['show_msg', 'tts', 'tts_read_name'].forEach(k => val('a_' + k, a[k]));
  val('c_words', s.censor.words); val('c_strip_links', s.censor.strip_links);
  listEdit('#nicksList', Object.entries(s.nicks || {}).map(([k, v]) => ({ k, v })), [['k', 'Имя в Kaspi'], ['v', 'Ник']]);
  listEdit('#varList', a.variations || [], [['amount', 'Сумма', 'number'], ['gif', 'Гифка (URL)', 'file:image,video'], ['sound', 'Звук (URL)', 'file:audio'], ['text', 'Подпись']]);
  // виджеты
  const names = { alerts: '🔔 Алерты', top: '🏆 ТОП донатеров', goal: '🎯 Цель сбора', roulette: '🎰 Рулетка', media: '🎵 Музыка и видео', info: 'ℹ️ Info-виджет', timer: '⏱ Таймер' };
  $('#wlinks').innerHTML = Object.entries(ME.urls.widgets).map(([k, u]) => `<div class="wlink"><h4>${names[k]}<a class="btn btn-ghost btn-sm" href="${u}" target="_blank">Открыть ↗</a></h4><div class="copy-row"><input readonly value="${u}" id="w_${k}"><button class="btn btn-ghost btn-sm" data-copy="w_${k}">Копировать</button></div></div>`).join('');
  val('t_period', s.top.period); val('t_count', s.top.count); val('t_theme', s.top.theme);
  val('g_title', s.goal.title); val('g_target', s.goal.target); val('g_base', s.goal.base); val('g_theme', s.goal.theme);
  listEdit('#infoList', (s.info.lines || []).map(v => ({ v })), [['v', 'Текст строки']]);
  val('i_interval', s.info.interval); val('i_theme', s.info.theme);
  val('tm_sec', s.timer.sec_per_100); val('tm_theme', s.timer.theme);
  // рулетка
  val('r_enabled', s.roulette.enabled); val('r_min', s.roulette.min); val('r_style', s.roulette.style);
  listEdit('#taskList', s.roulette.tasks.map(v => ({ v })), [['v', 'Задание']]);
  // медиа
  val('m_enabled', s.media.enabled); val('m_min', s.media.min); val('m_max', s.media.max_sec); val('m_volume', s.media.volume);
  // страница
  const pg = s.page;
  val('pg_title', pg.title); val('pg_description', pg.description); val('pg_kaspi', pg.kaspi); val('pg_receiver', pg.receiver); val('pg_min', pg.min_amount);
  Object.keys(pg.socials).forEach(k => val('s_' + k, pg.socials[k]));
  // pro
  listEdit('#hkList', s.hotkeys, [['min', 'От, ₸', 'number'], ['max', 'До, ₸ (0 = ∞)', 'number'], ['keys', 'Клавиши, напр. ctrl+shift+1']]);
  listEdit('#whList', s.webhooks.map(v => ({ v })), [['v', 'https://...']]);
  // тариф
  renderBilling();
  $('#accInfo').innerHTML = `Ник: <b>${esc(ME.nick)}</b><br>Email: ${esc(ME.email)}<br>Оплачено месяцев: ${ME.paid_months}${ME.vip ? ' · VIP' : ' (VIP с 10 месяцев)'}`;
  if (!pg.kaspi && !sessionStorage.kaspiHint) { sessionStorage.kaspiHint = 1; toast('Укажите номер Kaspi в разделе «Страница доната»'); }
}

function fillFileSelects() {
  $$('[data-files]').forEach(sel => {
    const types = sel.dataset.files.split(',');
    const cur = sel.value;
    sel.innerHTML = `<option value="">— стандартный —</option>` + FILES.filter(f => types.some(t => f.mime.startsWith(t))).map(f => `<option value="${f.url}">${esc(f.name)}</option>`).join('');
    sel.value = cur;
  });
}

// универсальный редактор списков
function listEdit(sel, items, cols) {
  const box = $(sel); box.innerHTML = ''; box._cols = cols;
  (items.length ? items : []).forEach(it => addRow(box, it));
}
function addRow(box, it = {}) {
  const row = document.createElement('div'); row.className = 'li';
  row.innerHTML = box._cols.map(([k, ph, type]) => {
    if (type && type.startsWith('file:')) {
      const types = type.slice(5).split(',');
      return `<select data-k="${k}"><option value="">${ph}</option>${FILES.filter(f => types.some(t => f.mime.startsWith(t))).map(f => `<option value="${f.url}" ${f.url === it[k] ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
    }
    return `<input data-k="${k}" placeholder="${ph}" ${type === 'number' ? 'type="number"' : ''} value="${esc(it[k] ?? '')}">`;
  }).join('') + `<button class="btn btn-ghost btn-sm" title="Удалить">✕</button>`;
  row.querySelector('button').onclick = () => row.remove();
  box.appendChild(row);
}
const readList = sel => [...$(sel).children].map(r => Object.fromEntries([...r.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.type === 'number' ? +i.value : i.value])));
[['#addNick', '#nicksList'], ['#addVar', '#varList'], ['#addInfo', '#infoList'], ['#addTask', '#taskList'], ['#addHk', '#hkList'], ['#addWh', '#whList']].forEach(([b, l]) => $(b).onclick = () => addRow($(l)));

// ---------- сохранение ----------
const collectors = {
  alerts: () => ({ alerts: { duration: val('a_duration'), gif: val('a_gif'), sound: val('a_sound'), volume: +val('a_volume'), min_alert: val('a_min_alert'), theme: val('a_theme'),
    show_msg: val('a_show_msg'), tts: val('a_tts'), min_tts: val('a_min_tts'), tts_lang: val('a_tts_lang'), tts_rate: +val('a_tts_rate'), tts_read_name: val('a_tts_read_name'),
    variations: readList('#varList') } }),
  censor: () => ({ censor: { words: val('c_words'), strip_links: val('c_strip_links') } }),
  nicks: () => ({ nicks: Object.fromEntries(readList('#nicksList').map(r => [r.k, r.v])) }),
  top: () => ({ top: { period: val('t_period'), count: val('t_count'), theme: val('t_theme') } }),
  goal: () => ({ goal: { title: val('g_title'), target: val('g_target'), base: val('g_base'), theme: val('g_theme') } }),
  info: () => ({ info: { lines: readList('#infoList').map(r => r.v), interval: val('i_interval'), theme: val('i_theme') } }),
  timer: () => ({ timer: { sec_per_100: val('tm_sec'), theme: val('tm_theme') } }),
  roulette: () => ({ roulette: { enabled: val('r_enabled'), min: val('r_min'), style: val('r_style'), tasks: readList('#taskList').map(r => r.v) } }),
  media: () => ({ media: { enabled: val('m_enabled'), min: val('m_min'), max_sec: val('m_max'), volume: +val('m_volume') } }),
  page: () => ({ page: { title: val('pg_title'), description: val('pg_description'), kaspi: val('pg_kaspi'), receiver: val('pg_receiver'), min_amount: val('pg_min'),
    socials: Object.fromEntries(['twitch', 'youtube', 'tiktok', 'instagram', 'telegram'].map(k => [k, val('s_' + k)])) } }),
  hotkeys: () => ({ hotkeys: readList('#hkList') }),
  webhooks: () => ({ webhooks: readList('#whList').map(r => r.v) }),
};
async function save(section, extra = {}) {
  try {
    const body = collectors[section](); Object.assign(body[section] || body, extra);
    const r = await api('/api/settings', { method: 'PUT', body });
    ME.settings = r.settings;
    if (r.warnings?.length) toast(r.warnings.join('. '), true); else toast('Сохранено ✓');
    render();
  } catch (e) { toast(e.message, true); }
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-save]'); if (s) save(s.dataset.save);
  const c = e.target.closest('[data-copy]');
  if (c) { const inp = $('#' + c.dataset.copy); inp.select(); navigator.clipboard?.writeText(inp.value).then(() => toast('Скопировано'), () => { document.execCommand('copy'); toast('Скопировано'); }); }
  const tm = e.target.closest('[data-timer]');
  if (tm) api('/api/timer', { method: 'POST', body: { action: tm.dataset.timer, minutes: +$('#tm_min').value } }).then(() => toast('Таймер обновлён')).catch(er => toast(er.message, true));
});
$('#goalReset').onclick = () => save('goal', { reset: true });

// ---------- тестовый донат ----------
$('#tSend').onclick = async () => {
  try { await api('/api/donations/test', { method: 'POST', body: { name: val('tName'), amount: +val('tAmount'), message: val('tMsg') } }); toast('Тестовый донат отправлен в OBS'); }
  catch (e) { toast(e.message, true); }
};

// ---------- лента (SSE) ----------
const feed = [];
function pushFeed(html) { feed.unshift(html); feed.length = Math.min(feed.length, 40); $('#feed').innerHTML = feed.map(h => `<div class="it">${h}</div>`).join(''); }
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('donation', e => { const d = JSON.parse(e.data); pushFeed(`<span>💸 <b>${esc(d.name)}</b> ${esc(d.message || '')}</span><b>${fmt(d.amount)}</b>`); ME.stats.today += d.amount; ME.stats.month += d.amount; ME.stats.total += d.amount; ME.stats.cnt++; $('#stToday').textContent = fmt(ME.stats.today); $('#stMonth').textContent = fmt(ME.stats.month); $('#stTotal').textContent = fmt(ME.stats.total); $('#stCnt').textContent = ME.stats.cnt; });
  es.addEventListener('ingest', e => { const d = JSON.parse(e.data); const r = { matched: '✅ донат', new: '✅ донат', ignored: '— пропущено' }[d.result]; pushFeed(`<span class="muted">📲 ${esc(d.text)}</span><span>${r}</span>`); });
  es.addEventListener('stats', e => { const d = JSON.parse(e.data); renderStats(d); });
}
function renderStats(d) {
  $('#goalNow').textContent = `Собрано: ${fmt(d.goal.sum)} из ${fmt(d.goal.target)}`;
  const t = d.timer; $('#timerNow').textContent = t.left ? new Date(t.left).toISOString().substr(11, 8) + (t.running ? ' (идёт)' : ' (пауза)') : '—';
  $('#mediaQueue').innerHTML = d.media.length ? d.media.map((m, i) => `<div class="it"><span>${i === 0 ? '▶️' : (i + 1) + '.'} ${esc(m.name)} — <a href="${esc(m.media_url)}" target="_blank" style="color:var(--accent)">ссылка</a></span><b>${fmt(m.amount)}</b></div>`).join('') : '<div class="muted">Очередь пуста</div>';
}
async function loadState() { try { const st = await api('/api/w/' + ME.token + '/state'); renderStats(st); } catch { } }

// ---------- донаты ----------
async function loadDonations() {
  const list = await api('/api/donations?limit=200');
  $('#donTable').innerHTML = list.map(d => `<tr><td class="muted">${time(d.done_at || d.created_at)}</td><td>${esc(d.name || d.sender || '—')}${d.sender && d.sender !== d.name ? `<div class="muted" style="font-size:12px">Kaspi: ${esc(d.sender)}</div>` : ''}</td><td><b>${fmt(d.amount)}</b></td><td style="max-width:320px">${esc(d.message)}${d.media_url ? ' 🎵' : ''}${d.voice_url ? ' 🎤' : ''}</td>
    <td>${d.status === 'done' ? `<span class="tag ok">${d.source === 'test' ? 'тест' : 'получен'}</span>` : '<span class="tag wait">ожидает перевода</span>'}</td>
    <td style="white-space:nowrap">${d.status === 'done' ? `<button class="btn btn-ghost btn-sm" data-replay="${d.id}">Повторить</button>` : `<button class="btn btn-ghost btn-sm" data-confirm="${d.id}">Подтвердить</button>`} <button class="btn btn-ghost btn-sm" data-del="${d.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Донатов пока нет</td></tr>';
}
$('#donTable').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.replay) { await api(`/api/donations/${b.dataset.replay}/replay`, { method: 'POST' }); toast('Алерт показан повторно'); }
    if (b.dataset.confirm) { await api('/api/donations/manual', { method: 'POST', body: { id: +b.dataset.confirm } }); toast('Донат подтверждён'); loadDonations(); }
    if (b.dataset.del) { await api('/api/donations/' + b.dataset.del, { method: 'DELETE' }); loadDonations(); }
  } catch (er) { toast(er.message, true); }
};
$('#skipAlert').onclick = () => api('/api/alerts/skip', { method: 'POST' }).then(() => toast('Алерт пропущен'));
$('#mediaSkip').onclick = () => api('/api/media/skip', { method: 'POST' }).then(() => toast('Пропущено'));

// ---------- подключение ----------
async function loadIngest() {
  const l = await api('/api/ingest-log');
  $('#ingestLog').innerHTML = l.map(x => `<tr><td class="muted">${time(x.created_at)}</td><td>${esc(x.text)}</td><td>${x.result === 'ignored' ? '<span class="tag">пропущено</span>' : '<span class="tag ok">донат</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Уведомлений ещё не было</td></tr>';
}
$('#devTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#devTabs button').forEach(x => x.classList.toggle('on', x === b)); $$('[data-dp]').forEach(p => p.style.display = p.dataset.dp === b.dataset.d ? '' : 'none'); };
$('#resetToken').onclick = async () => { if (!confirmBox()) return; await api('/api/token/reset', { method: 'POST' }); await load(); toast('Ссылка изменена. Обновите её в приложении и в OBS'); };
function confirmBox() { const b = $('#resetToken'); if (b.dataset.sure) { delete b.dataset.sure; b.textContent = 'Сменить'; return true; } b.dataset.sure = 1; b.textContent = 'Точно? Нажмите ещё раз'; setTimeout(() => { delete b.dataset.sure; b.textContent = 'Сменить'; }, 4000); return false; }

// ---------- файлы ----------
async function loadFiles() {
  FILES = await api('/api/files'); fillFileSelects();
  const used = ME.storage.used = FILES.reduce((a, f) => a + f.size, 0);
  $('#storageTxt').innerHTML = `Использовано <b>${(used / 1048576).toFixed(1)} МБ</b> из ${(ME.storage.limit / 1048576).toFixed(0)} МБ`;
  $('#storageBar').style.width = Math.min(100, used / ME.storage.limit * 100) + '%';
  $('#fileList').innerHTML = FILES.map(f => `<div class="file">${f.mime.startsWith('image') ? `<img src="${f.url}">` : `<div class="ph">${f.mime.startsWith('audio') ? '🎵' : '🎬'}</div>`}<div class="nm">${esc(f.name)}<div class="muted" style="font-size:12px">${(f.size / 1024).toFixed(0)} КБ</div></div>${f.mime.startsWith('audio') ? `<button class="btn btn-ghost btn-sm" data-play="${f.url}">▶</button>` : ''}<button class="btn btn-ghost btn-sm" data-fdel="${f.id}">✕</button></div>`).join('') || '<div class="muted">Загрузите свои гифки и звуки для алертов.</div>';
}
$('#fileList').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.play) new Audio(b.dataset.play).play();
  if (b.dataset.fdel) { await api('/api/files/' + b.dataset.fdel, { method: 'DELETE' }); loadFiles(); }
};
$('#upload').onchange = async e => {
  for (const f of e.target.files) {
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name) }, body: f });
      const j = await r.json(); if (!r.ok) throw new Error(j.error); toast('Загружено: ' + f.name);
    } catch (er) { toast(er.message, true); }
  }
  e.target.value = ''; loadFiles();
};

// ---------- тариф ----------
function renderBilling() {
  const p = ME.plan;
  $('#curPlan').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap"><div><div class="muted">Текущий тариф</div><div style="font-family:Unbounded;font-size:24px">${p.name} ${ME.vip ? '<span class="tag ok">VIP</span>' : ''}</div><div class="muted">${p.id === 'free' ? 'Бесплатно навсегда' : 'Активен до ' + new Date(ME.plan_until).toLocaleString('ru-RU')}</div></div>
    ${p.freezeDays ? `<button class="btn btn-ghost" id="freezeBtn" ${ME.freeze_available ? '' : 'disabled'}>❄️ Заморозить на ${p.freezeDays} дней</button>` : ''}</div>
    <p class="muted" style="margin-top:12px;font-size:13.5px">⭐ VIP: оплатите 10 месяцев — получите +10 дней Pro, ×1.5 хранилища и ранний доступ. Оплачено: ${ME.paid_months}/10.</p>`;
  const fb = $('#freezeBtn'); if (fb) fb.onclick = async () => { try { const r = await api('/api/freeze', { method: 'POST' }); toast(`Подписка продлена на ${r.days} дней`); load(); } catch (e) { toast(e.message, true); } };
  const feat = { free: ['Алерты (до 6 сек)', 'ТОП и цель с рекламой', 'Цензура, личная страница', '10 МБ'], lite: ['Озвучка, голосовые', 'Рулетка, таймер, info', 'Ники, темы, TikTok', 'Музыка/видео 50 раз', 'Заморозка 5 дней, 50 МБ'], pro: ['Всё из Lite без лимитов', 'Продвинутая озвучка', 'Хоткеи, вебхуки', 'Мем-алерты', 'Заморозка 10 дней, 100 МБ'] };
  $('#plansBox').innerHTML = ME.plans.map(pl => `<div class="plan ${pl.id === p.id ? 'cur' : ''}"><div class="muted">${pl.name}${pl.id === p.id ? ' · текущий' : ''}</div><b>${pl.price ? fmt(pl.price) + '<span class="muted" style="font-size:14px;font-family:Manrope"> /мес</span>' : '0 ₸'}</b><ul style="list-style:none;color:#cfd3e3;font-size:14px;display:flex;flex-direction:column;gap:6px">${feat[pl.id].map(f => `<li>✓ ${f}</li>`).join('')}</ul>${pl.price ? `<button class="btn ${pl.id === 'lite' ? 'btn-primary' : 'btn-ghost'}" style="width:100%;margin-top:16px" data-pick="${pl.id}">Выбрать ${pl.name}</button>` : ''}</div>`).join('');
  $$('[data-pick]').forEach(b => b.onclick = () => { val('payPlan', b.dataset.pick); calcPay(); $('#payBox').scrollIntoView({ behavior: 'smooth' }); });
  $('#payPhone').textContent = ME.pay.kaspi; $('#payName').textContent = 'получатель ' + ME.pay.name;
  $('#payTg').textContent = '@' + ME.pay.telegram; calcPay();
  $('#copyPayPhone').onclick = () => navigator.clipboard?.writeText(ME.pay.kaspi.replace(/\s/g, '')).then(() => toast('Номер скопирован'));
}
function calcPay() {
  const pl = ME.plans.find(x => x.id === val('payPlan')), sum = pl.price * +val('payMonths');
  $('#payAmount').textContent = fmt(sum);
  const msg = `Здравствуйте! Оплатил KZStream ${pl.name} на ${val('payMonths')} мес — ${fmt(sum)}. Мой ник: ${ME.nick}. Чек прикладываю.`;
  const tg = `https://t.me/${ME.pay.telegram}?text=${encodeURIComponent(msg)}`;
  $('#payTg').href = tg; $('#payTgBtn').href = tg;
}
$('#payPlan').onchange = calcPay; $('#payMonths').onchange = calcPay;
$('#paySend').onclick = async () => { try { await api('/api/pay', { method: 'POST', body: { plan: val('payPlan'), months: +val('payMonths'), comment: val('payComment') } }); toast('Заявка отправлена. Ожидайте подтверждения'); loadPayments(); } catch (e) { toast(e.message, true); } };
async function loadPayments() {
  const l = await api('/api/payments');
  $('#payHist').innerHTML = l.map(x => `<tr><td class="muted">${time(x.created_at)}</td><td>${x.plan.toUpperCase()} × ${x.months} мес</td><td>${fmt(x.amount)}</td><td>${{ pending: '<span class="tag wait">на проверке</span>', approved: '<span class="tag ok">подтверждена</span>', rejected: '<span class="tag no">отклонена</span>' }[x.status]}</td></tr>`).join('') || '<tr><td class="muted">Заявок нет</td></tr>';
}

// ---------- аккаунт ----------
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };
$('#pwSave').onclick = async () => { try { await api('/api/password', { method: 'POST', body: { old: val('pwOld'), new: val('pwNew') } }); toast('Пароль изменён'); val('pwOld', ''); val('pwNew', ''); } catch (e) { toast(e.message, true); } };

load().then(() => { route(); connectEvents(); loadState(); }).catch(e => toast(e.message, true));
})();
