(() => {
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const fmt = n => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = t => t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
let ME = null, FILES = [];
const THEME_COLORS = { default: ['rgba(14,15,26,.9)', '#fff', '#ff3b5c', '#ff7a45', 'Классика'], neon: ['rgba(8,4,24,.9)', '#e9e6ff', '#8b6cff', '#3ee6c4', 'Неон'], sunset: ['rgba(40,12,20,.9)', '#fff3ea', '#ff7a45', '#ffc84a', 'Закат'], mint: ['rgba(6,26,24,.9)', '#eafff9', '#3ee6c4', '#7dffb2', 'Мята'], royal: ['rgba(14,10,40,.9)', '#fff', '#5b7cff', '#c86bff', 'Роял'], mono: ['rgba(0,0,0,.9)', '#fff', '#ffffff', '#9a9a9a', 'Моно'], candy: ['rgba(40,10,36,.9)', '#fff', '#ff6bd6', '#ffb86b', 'Конфета'], steppe: ['rgba(6,24,40,.9)', '#fff', '#00b3e6', '#ffd23f', 'Степь'], ice: ['rgba(230,244,255,.95)', '#0b2a44', '#2f9bff', '#6ad7ff', 'Лёд'], gold: ['rgba(20,16,6,.92)', '#fff6dd', '#ffc84a', '#ff9d2e', 'Золото'] };
// ---------- конструктор ТОПа ----------
const TOP_DESIGNS = [
  { id: 'fire', name: 'Камин 🔥', desc: 'Живой огонь, искры', pv: `<div class="pv" style="background:linear-gradient(rgba(30,10,4,.9),rgba(30,10,4,.9)),repeating-linear-gradient(0deg,#5a2a18 0 8px,#2a120a 8px 9px);border:2px solid #6b3a22;position:relative;overflow:hidden"><b style="background:linear-gradient(#7a4524,#4a2512);color:#ffe2a8;border-radius:3px;font-size:10px;text-shadow:0 0 6px #ff9a2a;display:flex;align-items:center;justify-content:center;gap:4px"><img src="/img/top/flame.png" style="height:16px;margin:-4px 0">ТОП ДНЯ<img src="/img/top/flame.png" style="height:16px;margin:-4px 0"></b><i style="background:rgba(150,60,10,.9);border:1px solid #ffb547;box-shadow:0 0 6px #ff8a1f;color:#fff3c4;border-radius:4px"><img src="/img/top/crown.png" style="height:10px;vertical-align:-1px"> Әлихан <span style="color:#ffb547">15 000 ₸</span></i><i style="background:rgba(60,24,10,.85);border:1px solid rgba(255,140,50,.35);color:#ffe9c7;border-radius:4px">Dias <span style="color:#ffb547">8 500 ₸</span></i><u style="display:block;height:14px;margin:4px -8px -8px;background:radial-gradient(40% 100% at 50% 100%,#ffd23f,#ff6a1a 50%,transparent 75%),#1a0703;animation:pvf 1s ease-in-out infinite alternate"></u></div>` },
  { id: 'vice', name: 'Vice City (GTA 6)', desc: 'Неоновый закат, пальмы', pv: `<div class="pv" style="background:linear-gradient(#2a0a4a,#8b1d8f 55%,#ff6a6a 85%,#ffb35c);border:1.5px solid #ff7ac8"><b style="font-family:Oswald,sans-serif;font-style:italic;background:linear-gradient(#fff7a8,#ffc23a 50%,#ff3ea5);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:11px;filter:drop-shadow(0 1px 0 #ff3ea5)">ТОП ДНЯ</b><i style="background:rgba(60,14,60,.7);border:1px solid #ffd23f;box-shadow:0 0 5px #ffd23f;color:#ffd23f;border-radius:4px;font-style:italic">👑 ӘЛИХАН <span>15 000 ₸</span></i><i style="background:rgba(34,8,58,.7);border:1px solid #3ee8ff;box-shadow:0 0 5px #3ee8ff;color:#ff9be0;border-radius:4px;font-style:italic">DIAS_KZ <span style="color:#fff">8 500 ₸</span></i></div>` },
  { id: 'classic', name: 'Классика KZStream', desc: 'Фирменный стиль', pv: `<div class="pv" style="background:#0e0f1a;border:1px solid rgba(255,255,255,.12)"><b style="text-align:left;padding:0 2px;background:linear-gradient(120deg,#ff3b5c,#ff7a45);-webkit-background-clip:text;background-clip:text;color:transparent">ТОП ДНЯ</b><i style="color:#fff;border-bottom:1px solid rgba(255,255,255,.1)">Әлихан <span style="color:#ff7a45">15 000 ₸</span></i><i style="color:#fff">Dias <span style="color:#ff7a45">8 500 ₸</span></i></div>` },
  { id: 'glassneon', name: 'Cyberpunk Glass', desc: 'Неон и стекло', pv: `<div class="pv" style="background:#0d101b;border:1px solid rgba(236,72,153,.45)"><b style="background:linear-gradient(90deg,#ec4899,#8b5cf6,#06b6d4);color:#fff;border-radius:4px">ТОП ДНЯ</b><i style="background:linear-gradient(90deg,#ec4899,#8b5cf6);color:#fff;border-radius:4px">Әлихан <span>15 000 ₸</span></i><i style="background:rgba(255,255,255,.05);border:1px solid rgba(6,182,212,.35);color:#38bdf8;border-radius:4px">Dias <span>8 500 ₸</span></i></div>` },
  { id: 'esports', name: 'Esports Elite', desc: 'Острые углы', pv: `<div class="pv" style="background:#0a0a0c;border-left:3px solid #facc15;border-radius:0;clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)"><b style="background:#facc15;color:#000">ТОП ДНЯ</b><i style="background:linear-gradient(90deg,#facc15,#eab308);color:#000">Әлихан <span>15 000 ₸</span></i><i style="background:#18181b;border-left:2px solid #3f3f46;color:#f4f4f5">Dias <span>8 500 ₸</span></i></div>` },
  { id: 'darkgold', name: 'Dark & Gold', desc: 'Премиум золото', pv: `<div class="pv" style="background:#121214;border:1px solid rgba(212,175,55,.45)"><b style="background:linear-gradient(135deg,#bf953f,#fcf6ba,#b38728);color:#121214;border-radius:4px">ТОП ДНЯ</b><i style="background:linear-gradient(135deg,#d4af37,#fff2b2,#aa771c);color:#121214;border-radius:4px">Әлихан <span>15 000 ₸</span></i><i style="background:rgba(255,255,255,.04);border:1px solid rgba(212,175,55,.25);color:#e4e4e7;border-radius:4px">Dias <span>8 500 ₸</span></i></div>` },
  { id: 'hud', name: 'Futuristic HUD', desc: 'Игровой интерфейс', pv: `<div class="pv" style="background:#061818;border:2px solid #10b981"><b style="background:rgba(16,185,129,.15);border:1px solid #10b981;color:#10b981;border-radius:3px">ТОП ДНЯ</b><i style="background:rgba(16,185,129,.3);border:1px solid #34d399;color:#6ee7b7;border-radius:3px">Әлихан <span>15 000 ₸</span></i><i style="border:1px solid rgba(16,185,129,.35);color:#a7f3d0;border-radius:3px">Dias <span>8 500 ₸</span></i></div>` },
];
const TOP_FONTS = [['manrope', 'Manrope'], ['montserrat', 'Montserrat'], ['unbounded', 'Unbounded'], ['oswald', 'OSWALD'], ['rubik', 'Rubik'], ['inter', 'Inter']];
const FONT_CSS = { manrope: 'Manrope', montserrat: 'Montserrat', unbounded: 'Unbounded', oswald: 'Oswald', rubik: 'Rubik', inter: 'Inter' };
let TOPSEL = { style: 'classic', font: 'manrope' };
function topPickers() {
  const locked = !ME.plan.shop;
  $('#t_styles').innerHTML = TOP_DESIGNS.map(d => `<div class="dz ${TOPSEL.style === d.id ? 'on' : ''} ${locked && d.id !== 'classic' ? 'locked' : ''}" data-s="${d.id}">${d.pv}<div class="nm">${d.name}</div><div class="ds">${d.desc}</div></div>`).join('');
  $('#t_fonts').innerHTML = TOP_FONTS.map(([id, nm]) => `<button type="button" class="${TOPSEL.font === id ? 'on' : ''}" data-f="${id}" style="font-family:${FONT_CSS[id]},sans-serif">${nm}${locked && id !== 'manrope' ? ' 🔒' : ''}</button>`).join('');
  $('#t_theme_field').style.display = TOPSEL.style === 'classic' ? '' : 'none';
}
function postTop() { try { $('#topFrame').contentWindow.postMessage({ kzTop: collectors.top().top }, location.origin); } catch { } }

// ---------- цель сбора: стили ----------
const GOAL_DESIGNS = [
  { id: 'classic', name: 'Классика KZStream', desc: 'Фирменная красно-оранжевая полоса с бегущими линиями, название внутри.', pv: `<div style="width:100%;height:24px;border-radius:6px;border:1.5px solid #ff3b5c;background:#0e0f1a;position:relative;overflow:hidden;box-shadow:0 0 10px rgba(255,59,92,.4)"><div style="position:absolute;inset:0 35% 0 0;background:repeating-linear-gradient(-45deg,rgba(255,255,255,.18) 0 5px,transparent 5px 10px),linear-gradient(90deg,#ff3b5c,#ff7a45)"></div><div style="position:absolute;inset:0;display:flex;justify-content:space-between;align-items:center;padding:0 5px;font:800 7px Unbounded;color:#fff"><span>94 250</span><span>МИКРОФОН</span><span>145 000</span></div></div>` },
  { id: 'neon', name: 'Неон-трубка', desc: 'Тонкая светящаяся полоса, процент сверху.', pv: `<div style="width:100%"><div style="display:flex;justify-content:space-between;font:800 7px Unbounded;color:#e9e6ff"><span>МИКРОФОН</span><span style="color:#ff4fd8">65%</span></div><div style="height:8px;margin:5px 0;border-radius:8px;border:1.5px solid rgba(62,230,196,.6);box-shadow:0 0 8px rgba(62,230,196,.5);position:relative"><div style="position:absolute;inset:1px 35% 1px 1px;border-radius:8px;background:linear-gradient(90deg,#3ee6c4,#8b6cff,#ff4fd8);box-shadow:0 0 8px #8b6cff"></div></div><div style="display:flex;justify-content:space-between;font:800 6.5px Manrope;color:#bfe9ff"><span>94 250 ₸</span><span>145 000 ₸</span></div></div>` },
  { id: 'battery', name: 'Батарейка', desc: '10 делений, цвет меняется от красного к зелёному.', pv: `<div style="width:100%"><div style="display:flex;justify-content:space-between;font:800 7px Unbounded;color:#fff"><span>МИКРОФОН</span><span>65%</span></div><div style="display:flex;align-items:center;margin-top:5px"><div style="flex:1;display:grid;grid-template-columns:repeat(10,1fr);gap:2px;padding:2px;border:2px solid #ddd;border-radius:4px;height:20px">${[...Array(10)].map((_, i) => `<i style="border-radius:2px;background:${i < 7 ? 'hsl(78,90%,52%)' : 'rgba(255,255,255,.08)'}"></i>`).join('')}</div><div style="width:3px;height:9px;background:#ddd;border-radius:0 2px 2px 0"></div></div></div>` },
  { id: 'water', name: 'Вода', desc: 'Вертикальная колба: вода поднимается с волнами и пузырьками.', pv: `<div style="width:38px;height:62px;border:2px solid rgba(255,255,255,.75);border-radius:8px 8px 12px 12px;position:relative;overflow:hidden"><div style="position:absolute;left:0;right:0;bottom:0;height:65%;background:linear-gradient(#18c8ff,#0062e0)"></div><svg style="position:absolute;left:0;bottom:calc(65% - 2px);width:100%;height:6px" viewBox="0 0 40 6" preserveAspectRatio="none"><path d="M0 3 Q5 0 10 3 T20 3 T30 3 T40 3 V6 H0Z" fill="#18c8ff"/></svg><b style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 9px Unbounded;color:#fff">65%</b></div><div style="margin-left:8px;font:800 7px Unbounded;color:#fff">94 250 ₸<br><span style="opacity:.6;font-family:Manrope">из 145 000</span></div>` },
  { id: 'ring', name: 'Кольцо', desc: 'Круглый прогресс с процентом в центре.', pv: `<svg width="56" height="56" viewBox="0 0 130 130" style="transform:rotate(-90deg)"><circle cx="65" cy="65" r="54" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="14"/><circle cx="65" cy="65" r="54" fill="none" stroke="#ff3b5c" stroke-width="14" stroke-linecap="round" stroke-dasharray="339" stroke-dashoffset="119"/></svg><div style="margin-left:8px;font:800 7px Unbounded;color:#fff">МИКРОФОН<br><span style="color:#ff7a45">94 250 ₸</span></div>` },
  { id: 'thermo', name: 'Градусник', desc: 'Вертикальный термометр: чем больше донатов, тем «жарче».', pv: `<div style="display:flex;flex-direction:column;align-items:center"><div style="width:12px;height:44px;border:2px solid #ddd;border-bottom:0;border-radius:8px 8px 0 0;position:relative;overflow:hidden"><i style="position:absolute;left:2px;right:2px;bottom:0;height:65%;background:#ff3b5c;border-radius:4px 4px 0 0"></i></div><div style="width:22px;height:22px;border-radius:50%;background:#ff3b5c;border:2px solid #ddd;margin-top:-3px;box-shadow:0 0 8px #ff3b5c"></div></div><div style="margin-left:10px;font:800 7px Unbounded;color:#fff">МИКРОФОН<br>94 250 ₸</div>` },
  { id: 'gold', name: 'Золото', desc: 'Премиальная золотая полоса с бегущими линиями.', pv: `<div style="width:100%;height:24px;border-radius:5px;border:1.5px solid #d4af37;background:#0b0a08;position:relative;overflow:hidden"><div style="position:absolute;inset:0 35% 0 0;background:repeating-linear-gradient(-45deg,rgba(255,255,255,.2) 0 5px,transparent 5px 10px),linear-gradient(#fcf6ba,#d4af37 45%,#aa771c)"></div><div style="position:absolute;inset:0;display:flex;justify-content:space-between;align-items:center;padding:0 5px;font:800 7px Unbounded;color:#fff;text-shadow:0 1px 3px #000"><span>94 250</span><span>МИКРОФОН</span><span style="color:#fcf6ba">145 000</span></div></div>` },
  { id: 'minimal', name: 'Минимал', desc: 'Только текст и тонкая линия — без фона, не закрывает кадр.', pv: `<div style="width:100%;color:#fff"><div style="font:800 6.5px Unbounded;opacity:.85">МИКРОФОН</div><div style="font:800 11px Unbounded">94 250 ₸ <span style="font-size:7px;opacity:.6">/ 145 000 ₸</span></div><div style="height:3px;border-radius:3px;background:rgba(255,255,255,.2);margin-top:4px"><div style="width:65%;height:100%;border-radius:3px;background:linear-gradient(90deg,#ff3b5c,#ff7a45)"></div></div></div>` },
];
let GOALSEL = 'classic';
const goalFree = id => (ME.goal_free || ['classic', 'neon', 'battery']).includes(id);
function goalPickers() {
  const saved = ME.settings.goal.style || 'classic';
  $('#g_styles').innerHTML = GOAL_DESIGNS.map(d => { const locked = !ME.plan.shop && !goalFree(d.id);
    return `<div class="gs ${GOALSEL === d.id ? 'on' : ''}" data-g="${d.id}"><div class="gpv">${d.pv}</div><div><b>${d.name}</b>${saved === d.id ? '<span class="tg live">В ЭФИРЕ</span>' : ''}${locked ? '<span class="tg lk">🔒 Lite</span>' : ''}<p>${d.desc}</p></div></div>`; }).join('');
  $('#goalLive').textContent = (GOAL_DESIGNS.find(d => d.id === saved) || GOAL_DESIGNS[0]).name;
  $('#g_theme_field').style.display = ['classic', 'ring', 'minimal'].includes(GOALSEL) ? '' : 'none';
  goalDirty();
}
function goalDirty() {
  const g = ME.settings.goal, dirty = GOALSEL !== (g.style || 'classic') || val('g_title') !== g.title || +val('g_target') !== +g.target || +val('g_base') !== +g.base || val('g_theme') !== g.theme;
  const b = $('#goalSaved'); b.textContent = dirty ? '● Не сохранено' : '✓ Сохранено'; b.style.color = dirty ? '#ffc84a' : '#3ee6c4';
}
function postGoal(extra) { $('#goalFrame').style.height = ({ water: 430, thermo: 400, ring: 210, battery: 170 }[GOALSEL] || 150) + 'px'; setTimeout(fitPreviews, 30); try { $('#goalFrame').contentWindow.postMessage(extra || { kzGoal: { style: GOALSEL, title: val('g_title') || 'Цель сбора', target: Math.min(2000000, +val('g_target') || 1), theme: val('g_theme') } }, location.origin); } catch { } }

// ---------- голоса озвучки ----------
const VOICE_LIST = [
  ['dmitry', 'Дмитрий', 'мужской · русский'], ['svetlana', 'Светлана', 'женский · русский'],
  ['bass', 'Бас', 'низкий мужской'], ['chipmunk', 'Бурундук', 'писклявый, смешной'],
  ['daulet', 'Дәулет', 'мужской · қазақша'], ['aigul', 'Айгүл', 'женский · қазақша'],
  ['andrew', 'Эндрю', 'американский акцент'], ['ava', 'Ава', 'американский акцент'],
  ['emma', 'Эмма', 'английский акцент'], ['remy', 'Реми', 'французский акцент'], ['giuseppe', 'Джузеппе', 'итальянский акцент'],
];
let VOICESEL = 'dmitry', voiceAudio = null;
function voicePicker() {
  $('#a_voices').innerHTML = VOICE_LIST.map(([id, nm, ds]) => `<div class="vc ${VOICESEL === id ? 'on' : ''}" data-v="${id}"><button type="button" class="play" data-play="${id}" title="Прослушать">▶</button><b>${nm}</b><span>${ds}</span></div>`).join('');
}

// ---------- стиль алерта и «Мои алерты» (главная) ----------
const ALERT_STYLES = [
  { id: 'classic', name: 'Классика KZStream', desc: 'Гифка + карточка с именем', free: true, pv: `<div style="padding:6px 10px;border-radius:8px;border:1.5px solid #ff3b5c;background:#0e0f1a;font:800 9px Unbounded;color:#fff">Әлихан — <span style="color:#ff7a45">1 000 ₸</span></div>` },
  { id: 'meme', name: 'Мем-алерт', desc: 'Ваше видео, снизу имя и текст', free: true, pv: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px"><div style="width:62px;height:34px;border-radius:5px;background:linear-gradient(135deg,#333,#111);display:grid;place-items:center;font-size:14px">🎬</div><div style="font:800 7px Unbounded;color:#fff;padding:2px 6px;border-radius:4px;border:1px solid #ff3b5c">Әлихан — 1 000 ₸</div></div>` },
  { id: 'money', name: 'Денежный дождь', desc: 'Сыплются купюры тенге', free: false, pv: `<div style="position:absolute;inset:0">${[[8, 6, -20, '#2f8fd6'], [40, 30, 15, '#c79a2d'], [70, 4, 30, '#3a9c6a'], [20, 40, 50, '#c06a3a'], [86, 38, -10, '#2f8fd6'], [56, 50, -35, '#3a9c6a']].map(([x, y, r, c]) => `<i style="position:absolute;left:${x}%;top:${y}%;width:30px;height:15px;border-radius:2px;background:${c};transform:rotate(${r}deg);font:800 8px Unbounded;color:#fff;display:grid;place-items:center;font-style:normal">₸</i>`).join('')}</div><b style="position:relative;font:800 15px Unbounded;color:#ffc84a;text-shadow:0 2px 0 #7a4a00">+1 000 ₸</b>` },
  { id: 'coin', name: 'Монетка — Орёл!', desc: 'Монета летит и падает орлом', free: false, pv: `<div style="width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff7c2,#ffc84a 40%,#d48a00 75%,#9a5c00);display:grid;place-items:center;font:800 9px Unbounded;color:#7a4300;box-shadow:inset 0 0 0 4px rgba(154,92,0,.5)">ОРЁЛ</div>` },
];
const poolObjs = () => (ME.settings.alerts.pool || []).map(x => typeof x === 'string' ? { url: x, min: 0 } : x);
const poolUrls = () => poolObjs().map(x => x.url);
const ALERT_LIB = [
  ['money-rain', 'Дождь из денег'], ['champion', 'Чемпион'], ['psycho', 'Психопат'], ['mentalist', 'Ментал'],
];
function alertStyles() {
  const a = ME.settings.alerts, L = a.layout || 'classic', pool = poolUrls();
  const mine = FILES.filter(f => /^(video|image)\//.test(f.mime));
  $('#myAlerts').innerHTML = mine.map(f => `<div class="ma ${pool.includes(f.url) ? 'on' : ''}" data-ma="${f.url}">${f.mime.startsWith('video') ? `<video src="${f.url}#t=0.5" muted preload="metadata"></video>` : `<img src="${f.url}">`}<span class="ck">${pool.includes(f.url) ? '✓' : ''}</span><span class="nmm">${esc(f.name)}</span></div>`).join('') || '<div class="muted" style="font-size:13px;grid-column:1/-1">Загрузите своё видео или гифку — например, мем. При донате оно появится, снизу будет имя донатера и его текст, а голос прочитает сообщение.</div>';
  $('#libAlerts').innerHTML = ALERT_LIB.map(([id, nm]) => { const url = `/alerts-lib/${id}.mp4`, on = pool.includes(url);
    return `<div class="ma ${on ? 'on' : ''}" data-ma="${url}"><video src="${url}" poster="/alerts-lib/${id}.jpg" muted loop playsinline preload="none"></video><span class="ck">${on ? '✓' : ''}</span><span class="nmm">${nm}</span></div>`; }).join('');
  $('#asGrid').innerHTML = ALERT_STYLES.map(st => `<div class="as ${L === st.id ? 'on' : ''}" data-as="${st.id}"><div class="ap">${st.pv}</div>${!st.free && !ME.plan.shop ? '<span class="tg">🔒 Lite</span>' : ''}<b>${st.name}</b><span>${st.desc}</span></div>`).join('');
}
function vidAmounts() {
  const P = poolObjs(), byUrl = Object.fromEntries(P.map(x => [x.url, x]));
  const items = [...ALERT_LIB.map(([id, nm]) => ({ url: `/alerts-lib/${id}.mp4`, poster: `/alerts-lib/${id}.jpg`, nm, lib: true })),
    ...FILES.filter(f => /^(video|image)\//.test(f.mime)).map(f => ({ url: f.url, nm: f.name, img: !f.mime.startsWith('video') }))];
  $('#vaList').innerHTML = items.map(it => { const on = !!byUrl[it.url], min = on ? byUrl[it.url].min || 0 : '';
    return `<div class="va ${on ? 'on' : ''}" data-va="${esc(it.url)}"><div class="vth">${it.img ? `<img src="${esc(it.url)}">` : `<video src="${esc(it.url)}" ${it.poster ? `poster="${it.poster}"` : ''} muted loop playsinline preload="${it.poster ? 'none' : 'metadata'}"></video>`}</div>
      <div class="vnm"><b>${esc(it.nm)}</b><span>${it.lib ? 'Готовый алерт KZStream' : 'Ваш файл'}</span></div>
      <label class="vmin">от <input type="number" min="0" step="100" value="${min}" placeholder="0"> ₸</label>
      <label class="sw2"><input type="checkbox" ${on ? 'checked' : ''}><i></i></label></div>`; }).join('');
}
async function saveAlerts(part, msg) {
  try { const r = await api('/api/settings', { method: 'PUT', body: { alerts: part } }); ME.settings = r.settings; if (r.warnings?.length) toast(r.warnings.join('. '), true); else toast(msg || 'Сохранено ✓'); alertStyles(); vidAmounts(); }
  catch (e) { toast(e.message, true); }
}

// ---------- страница доната: картинки и «Поделиться» ----------
function pagePreviews() {
  const a = val('pg_avatar'), b = val('pg_banner');
  $('#avPrev').style.backgroundImage = a ? `url("${a}")` : ''; $('#avPrev').classList.toggle('has', !!a);
  $('#bnPrev').style.backgroundImage = b ? `url("${b}")` : ''; $('#bnPrev').classList.toggle('has', !!b);
}
function shareBlock() {
  const url = ME.urls.page, text = `Поддержать меня донатом через Kaspi: ${url}`;
  val('shareUrl', url); $('#shareOpen').href = url;
  $('#shareTg').href = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent('Поддержать меня донатом через Kaspi');
  $('#shareWa').href = 'https://wa.me/?text=' + encodeURIComponent(text);
  try {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const n = qr.getModuleCount(), cv = $('#shareQr'), c = cv.getContext('2d'), sz = 180, cell = sz / (n + 2);
    c.fillStyle = '#fff'; c.fillRect(0, 0, sz, sz); c.fillStyle = '#0e0f1a';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) c.fillRect(Math.floor((k + 1) * cell), Math.floor((r + 1) * cell), Math.ceil(cell), Math.ceil(cell));
    // логотип KZStream в центре
    const m = sz / 2, lw = 34; c.fillStyle = '#fff'; c.fillRect(m - lw / 2 - 3, m - lw / 2 - 3, lw + 6, lw + 6);
    const g = c.createLinearGradient(m - lw / 2, m - lw / 2, m + lw / 2, m + lw / 2); g.addColorStop(0, '#ff3b5c'); g.addColorStop(1, '#ff7a45');
    c.fillStyle = g; c.beginPath(); c.roundRect(m - lw / 2, m - lw / 2, lw, lw, 8); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(m - 6, m - 9); c.lineTo(m - 6, m + 9); c.lineTo(m + 9, m); c.closePath(); c.fill();
  } catch { }
}

// ---------- телефон: превью виджетов показываем уменьшенной копией «как на компьютере» ----------
// На компьютере ничего не меняется: функция работает только на узких экранах.
const MOB = matchMedia('(max-width:760px)');
const PREVIEW_W = { prevFrame: [760, 428], rFrame: [760, 428], mHereFrame: [760, 428], goalFrame: [680, 0], infoFrame: [560, 0], faceitFrame: [860, 0] };
function fitPreviews() {
  Object.entries(PREVIEW_W).forEach(([id, [vw0, vh]]) => { let vw = vw0;
    const f = document.getElementById(id); if (!f) return;
    if (id === 'goalFrame') vw = ['water', 'thermo'].includes(GOALSEL) ? 300 : GOALSEL === 'ring' ? 520 : 680;
    const box = f.parentElement, abs = vh > 0;
    if (!MOB.matches) { f.classList.remove('mob-scale'); f.style.transform = ''; f.style.width = ''; f.style.marginBottom = ''; f.style.marginRight = ''; if (abs) f.style.height = ''; return; }
    const cw = box.clientWidth - (abs ? 0 : parseFloat(getComputedStyle(box).paddingLeft) + parseFloat(getComputedStyle(box).paddingRight));
    if (!cw) return;
    const k = Math.min(1, cw / vw);
    f.classList.add('mob-scale'); f.style.width = vw + 'px'; f.style.transform = `scale(${k})`;
    if (abs) f.style.height = vh + 'px';
    else { const h = parseFloat(f.style.height) || f.offsetHeight; f.style.marginBottom = -(h * (1 - k)) + 'px'; f.style.marginRight = -(vw * (1 - k)) + 'px'; }
  });
}
addEventListener('resize', () => requestAnimationFrame(fitPreviews));
MOB.addEventListener?.('change', fitPreviews);
addEventListener('hashchange', () => setTimeout(fitPreviews, 60));
setInterval(() => { if (MOB.matches) fitPreviews(); }, 1500);

// ---------- FACEIT ----------
const FC_OPTS = [['level', 'Уровень FACEIT'], ['elo', 'ELO'], ['today', 'Сегодня: ELO и W-L'], ['kd', 'K/D'], ['wr', 'Winrate'], ['hs', 'HS %'], ['adr', 'ADR'], ['matches', 'Матчей'], ['streak', 'Серия побед'], ['last', 'Последние 5 матчей'], ['flag', 'Флаг страны']];
const FC_COL = l => l >= 10 ? '#fe1f00' : l >= 8 ? '#ff6309' : l >= 4 ? '#ffc800' : l >= 2 ? '#1ce400' : '#9aa0b0';
let FCP = null;
function fcShow() { const o = {}; document.querySelectorAll('#fcOpts input').forEach(i => o[i.dataset.k] = i.checked); return o; }
function fcPost() { try { $('#faceitFrame').contentWindow.postMessage({ kzFaceitShow: fcShow(), kzFaceit: FCP }, location.origin); } catch { } }
function fcAccount(p) {
  FCP = p; $('#fcLink').classList.toggle('hide', !!p); $('#fcAcc').classList.toggle('hide', !p);
  if (p) { $('#fcAva').src = p.avatar || '/favicon.svg'; $('#fcName').textContent = p.nick; $('#fcSub').textContent = `CS2 · ELO ${p.elo}`; $('#fcLv').textContent = p.level; $('#fcLv').style.background = FC_COL(p.level); }
  fcPost();
}
function fcInit() {
  const F = (ME.settings.faceit || {}).show || {};
  $('#fcOpts').innerHTML = FC_OPTS.map(([k, nm]) => `<label class="fc-opt">${nm}<span class="sw2"><input type="checkbox" data-k="${k}" ${F[k] ? 'checked' : ''}><i></i></span></label>`).join('');
  val('fcUrl', ME.urls.widgets.faceit || '');
  if (!$('#faceitFrame').src) { $('#faceitFrame').onload = () => setTimeout(fcPost, 300); $('#faceitFrame').src = (ME.urls.widgets.faceit || '') + '&demo'; }
  if ((ME.settings.faceit || {}).nick) api('/api/faceit/me').then(r => fcAccount(r.player)).catch(() => { fcAccount(null); val('fcNick', ME.settings.faceit.nick); });
  else fcAccount(null);
}

// ---------- карточки: банки и соцсети ----------
const CARD_DEF = [
  ['kaspi', 'Kaspi', '<img src="/img/logo/kaspi.png">', 'Номер телефона или карты Kaspi', 'Получатель, напр. Алибек Т.'],
  ['halyk', 'Halyk Bank', '<img src="/img/logo/halyk.png">', 'Номер карты или телефона Halyk', 'Получатель'],
  ['freedom', 'Freedom Bank', '<img src="/img/logo/freedom.png">', 'Номер карты или телефона Freedom', 'Получатель'],
  ['twitch', 'Twitch', '<span style="background:#9146ff;width:100%;height:100%;display:grid;place-items:center"><svg viewBox="0 0 24 24" fill="#fff"><path d="M4 2 2.5 6v14h5v3h3l3-3h4l5-5V2H4zm16 12-3 3h-5l-3 3v-3H5V4h15v10z"/></svg></span>', 'Ник на Twitch', 'Подпись, напр. «стримы каждый день»'],
  ['instagram', 'Instagram', '<span style="background:linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf);width:100%;height:100%;display:grid;place-items:center"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg></span>', '@ник в Instagram', 'Подпись'],
  ['youtube', 'YouTube', '<span style="background:#ff0000;width:100%;height:100%;display:grid;place-items:center"><svg viewBox="0 0 24 24"><path d="M9 7v10l8-5z" fill="#fff"/></svg></span>', 'Название канала', 'Подпись'],
  ['blackrussia', 'Black Russia', '<img src="/img/logo/blackrussia.png">', 'Ник_Нейм', 'Сервер, напр. RED'],
];
function cardsInit() {
  const C = ME.settings.cards || {}, base = ME.urls.widgets.card;
  $('#cardsGrid').innerHTML = CARD_DEF.map(([k, nm, ic, ph, ph2]) => `<div class="ck2" data-ck="${k}"><div class="hd2"><i>${ic}</i>${nm}</div>
    <input data-f="value" maxlength="60" placeholder="${ph}" value="${esc((C[k] || {}).value || '')}"><input data-f="name" maxlength="40" placeholder="${ph2}" value="${esc((C[k] || {}).name || '')}">${k === 'blackrussia' ? `<input data-f="promo" maxlength="30" placeholder="Промокод (если есть)" value="${esc((C[k] || {}).promo || '')}">` : ''}
    <iframe data-pv="${k}" src="${base}&k=${k}&demo"></iframe>
    <div class="shape2" data-shape="${k}"><button type="button" data-l="wide">▬ В ширину</button><button type="button" data-l="tall">▮ В толщину</button></div>
    <div class="copy-row"><input readonly value="${base}&k=${k}" id="cardUrl_${k}"><button class="btn btn-ghost btn-sm" data-copy="cardUrl_${k}">Копировать</button></div></div>`).join('');
  CARD_DEF.forEach(([k]) => { let l = 'wide'; try { l = localStorage['kzShape_' + k] || 'wide'; } catch { } cardShape(k, l, true); });
  $('#cardsGrid').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; const k = b.parentNode.dataset.shape; cardShape(k, b.dataset.l); toast((b.dataset.l === 'tall' ? 'Форма «в толщину»' : 'Форма «в ширину»') + ' — скопируйте ссылку заново'); });
  document.querySelectorAll('#cardsGrid iframe').forEach(f => f.onload = () => setTimeout(() => cardPost(f.dataset.pv), 200));
}
function cardShape(k, l, init) {
  try { localStorage['kzShape_' + k] = l; } catch { }
  document.querySelectorAll(`[data-shape="${k}"] [data-l]`).forEach(b => b.classList.toggle('on', b.dataset.l === l));
  const inp = $('#cardUrl_' + k), f = document.querySelector(`[data-pv="${k}"]`);
  inp.value = inp.value.replace(/&l=\w+/, '') + (l === 'tall' ? '&l=tall' : '');
  const src = f.src.replace(/&l=\w+/, '') + (l === 'tall' ? '&l=tall' : ''); if (f.src !== src) f.src = src;
}
function cardVal(k) { const r = document.querySelector(`[data-ck="${k}"]`), pr = r.querySelector('[data-f=promo]'); return { value: r.querySelector('[data-f=value]').value.trim(), name: r.querySelector('[data-f=name]').value.trim(), ...(pr ? { promo: pr.value.trim() } : {}) }; }
function cardPost(k) { try { document.querySelector(`[data-pv="${k}"]`).contentWindow.postMessage({ kzCard: cardVal(k).value ? cardVal(k) : { value: 'Пример', name: '' } }, location.origin); } catch { } }

function themePickers() {
  $$('select[data-themes]').forEach(sel => {
    sel.style.display = 'none';
    let grid = sel.nextElementSibling;
    if (!grid || !grid.classList.contains('themes')) { grid = document.createElement('div'); grid.className = 'themes'; sel.after(grid); }
    const draw = () => {
      grid.innerHTML = ME.themes.map(t => { const c = THEME_COLORS[t] || THEME_COLORS.default; const locked = !ME.plan.shop && t !== 'default';
        return `<div class="th ${sel.value === t ? 'on' : ''} ${locked ? 'locked' : ''}" data-t="${t}"><div class="pv"><i style="background:${c[0]};color:${c[1]};border:1px solid ${c[2]}">Донат <span style="color:${c[3]}">1 000 ₸</span></i><u style="background:linear-gradient(90deg,${c[2]},${c[3]})"></u></div><div class="nm">${c[4]}</div></div>`; }).join('');
    };
    draw();
    grid.onclick = e => { const th = e.target.closest('.th'); if (!th) return; if (th.classList.contains('locked')) return toast('Темы доступны с тарифа Lite — раздел «Тариф»', true); sel.value = th.dataset.t; draw(); sel.dispatchEvent(new Event('change', { bubbles: true })); };
    sel._draw = draw;
  });
}

function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 3200); }
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401) { location.href = '/#login'; throw new Error('Требуется вход'); }
  if (r.status === 403) { const j = await r.clone().json().catch(() => ({})); if (j.verify) { location.href = '/#verify'; throw new Error('Подтвердите email'); } }
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
  val('ingestUrl', ME.urls.ingest); val('iosUrl', ME.urls.ingest);
  $('#stToday').textContent = fmt(ME.stats.today); $('#stMonth').textContent = fmt(ME.stats.month);
  renderStatsTiles();
  const until = ME.is_admin ? 'владелец · без срока' : ME.plan.id !== 'free' ? `до ${new Date(ME.plan_until).toLocaleDateString('ru-RU')}` : 'бесплатно';
  $('#sidePlan').innerHTML = `<div class="muted">Тариф</div><b>${p.name}</b>${ME.vip ? ' <span class="tag ok">VIP</span>' : ''}<div class="muted">${until}</div><a href="#billing" class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%">${p.id === 'pro' ? 'Продлить' : 'Улучшить'}</a>`;
  // замки
  $$('[data-need]').forEach(l => l.style.display = p[l.dataset.need] ? 'none' : '');
  // темы
  $$('[data-themes]').forEach(sel => sel.innerHTML = ME.themes.map(t => `<option value="${t}">${t}</option>`).join(''));
  fillFileSelects();
  // алерты
  const a = s.alerts;
  $('#durMax').textContent = `(до ${p.maxDuration})`; $('#a_duration').max = p.maxDuration;
  ['duration', 'volume', 'min_alert', 'min_tts', 'tts_rate', 'theme'].forEach(k => val('a_' + k, a[k]));
  val('a_gif', a.gif); val('a_sound', a.sound);
  ['show_msg', 'tts'].forEach(k => val('a_' + k, a[k]));
  VOICESEL = a.tts_voice || 'dmitry'; voicePicker(); vidAmounts(); fcInit(); cardsInit();
  if (!$('#tVoice').options.length) $('#tVoice').innerHTML = VOICE_LIST.map(([id, nm, ds]) => `<option value="${id}">${nm} — ${ds}</option>`).join('');
  val('tVoice', VOICESEL); alertStyles();
  val('c_words', s.censor.words); val('c_strip_links', s.censor.strip_links);
  listEdit('#nicksList', Object.entries(s.nicks || {}).map(([k, v]) => ({ k, v })), [['k', 'Имя в Kaspi'], ['v', 'Ник']]);
  listEdit('#varList', a.variations || [], [['amount', 'Сумма', 'number'], ['gif', 'Гифка (URL)', 'file:image,video'], ['sound', 'Звук (URL)', 'file:audio'], ['text', 'Подпись']]);
  // виджеты
  const names = { alerts: '🔔 Алерты', top: '🏆 ТОП донатеров', goal: '🎯 Цель сбора', roulette: '🎰 Рулетка', media: '🎵 Музыка и видео', info: 'ℹ️ Info-виджет', timer: '⏱ Таймер', faceit: '🎮 FACEIT', card: '🏦 Виджет банка (Kaspi)' };
  const need = { alerts: null, top: null, goal: null, roulette: 'roulette', media: 'media', info: 'info', timer: 'timer' };
  const badge = k => !need[k] ? '<span class="wb free">Бесплатно</span>' : `<span class="wb lite">Lite</span>`;
  $('#wlinks').innerHTML = Object.entries(ME.urls.widgets).filter(([k]) => names[k]).map(([k, u]) => { if (k === 'card') u += '&k=kaspi'; const locked = need[k] && !p[need[k]];
    return `<div class="wlink ${locked ? 'locked' : ''}"><h4><span>${names[k]} ${badge(k)}</span>${locked ? '<a class="btn btn-ghost btn-sm" href="#billing">🔒 Подключить Lite</a>' : `<a class="btn btn-ghost btn-sm" href="${u}" target="_blank">Открыть ↗</a>`}</h4><div class="copy-row"><input readonly value="${u}" id="w_${k}"><button class="btn btn-ghost btn-sm" data-copy="w_${k}">Копировать</button></div></div>`; }).join('');
  val('t_period', s.top.period); val('t_count', s.top.count); val('t_theme', s.top.theme);
  val('t_title', s.top.title); val('t_size', s.top.size); val('t_radius', s.top.radius); val('t_opacity', s.top.opacity);
  TOPSEL = { style: s.top.style || 'classic', font: s.top.font || 'manrope' }; topPickers();
  if (!$('#topFrame').src) { $('#topFrame').onload = () => setTimeout(postTop, 400); $('#topFrame').src = ME.urls.widgets.top + '&demo'; } else postTop();
  val('g_title', s.goal.title); val('g_target', s.goal.target); val('g_base', s.goal.base); val('g_theme', s.goal.theme);
  GOALSEL = s.goal.style || 'classic'; goalPickers();
  if (!$('#goalFrame').src) { $('#goalFrame').onload = () => setTimeout(postGoal, 400); $('#goalFrame').src = ME.urls.widgets.goal + '&demo'; } else postGoal();
  listEdit('#infoList', (s.info.lines || []).map(v => ({ v })), [['v', 'Текст строки']]);
  val('i_label', s.info.label || 'INFO'); val('i_dir', s.info.dir || 'right'); val('i_speed', s.info.speed || 'normal'); val('i_show_last', s.info.show_last !== false); val('i_theme', s.info.theme);
  if (!$('#infoFrame').src) { $('#infoFrame').onload = () => setTimeout(postInfo, 300); $('#infoFrame').src = ME.urls.widgets.info + '&demo'; } else postInfo();
  val('tm_sec', s.timer.sec_per_100); val('tm_theme', s.timer.theme);
  // рулетка
  val('r_enabled', s.roulette.enabled); val('r_sound', s.roulette.sound !== false); val('r_min', s.roulette.min); val('r_style', s.roulette.style);
  listEdit('#taskList', s.roulette.tasks.map(v => ({ v })), [['v', 'Задание']]);
  // медиа
  val('m_enabled', s.media.enabled); val('m_min', s.media.min); val('m_max', s.media.max_sec); val('m_volume', s.media.volume);
  // страница
  const pg = s.page;
  val('pg_title', pg.title); val('pg_description', pg.description); val('pg_kaspi', pg.kaspi); val('pg_receiver', pg.receiver); val('pg_min', pg.min_amount); val('pg_cards', pg.cards); val('pg_avatar', pg.avatar); val('pg_banner', pg.banner); val('pg_color', pg.color || '#ff3b5c');
  pagePreviews(); shareBlock();
  Object.keys(pg.socials).forEach(k => val('s_' + k, pg.socials[k]));
  // pro
  listEdit('#hkList', s.hotkeys, [['min', 'От, ₸', 'number'], ['max', 'До, ₸ (0 = ∞)', 'number'], ['keys', 'Клавиши, напр. ctrl+shift+1']]);
  listEdit('#whList', s.webhooks.map(v => ({ v })), [['v', 'https://...']]);
  // превью и тесты
  if (!$('#prevFrame').src) { let hid = false; try { hid = localStorage.kzPvHide === '1'; } catch { } if (hid) pvShow(false); else $('#prevFrame').src = ME.urls.widgets.alerts + '&preview'; }
  if (!$('#rFrame').src) $('#rFrame').src = ME.urls.widgets.roulette + '&preview';
  $('#rOpen').href = ME.urls.widgets.roulette; $('#mOpen').href = ME.urls.widgets.media; val('mPlayerUrl', ME.urls.widgets.media);
  themePickers();
  // сотрудничество: рекламный виджет
  val('w_promo', ME.urls.widgets.promo); if (!$('#promoFrame').src) $('#promoFrame').src = ME.urls.widgets.promo;
  // тариф
  renderBilling();
  $('#accInfo').innerHTML = `Ник: <b>${esc(ME.nick)}</b><br>Email: ${esc(ME.email)}<br>Баланс: <b>${fmt(ME.balance)}</b> · <a href="#billing" style="color:var(--accent)">пополнить</a><br>Ваш промокод: <b>${esc(ME.promo.mine)}</b> (−20% другу)<br>Оплачено месяцев: ${ME.paid_months}${ME.vip ? ' · VIP' : ' (VIP с 10 месяцев)'}`;
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
    show_msg: val('a_show_msg'), tts: val('a_tts'), min_tts: val('a_min_tts'), tts_voice: VOICESEL, tts_rate: +val('a_tts_rate'),
    variations: readList('#varList') } }),
  censor: () => ({ censor: { words: val('c_words'), strip_links: val('c_strip_links') } }),
  nicks: () => ({ nicks: Object.fromEntries(readList('#nicksList').map(r => [r.k, r.v])) }),
  top: () => ({ top: { period: val('t_period'), count: val('t_count'), theme: val('t_theme'), style: TOPSEL.style, font: TOPSEL.font, title: val('t_title'), size: val('t_size'), radius: +val('t_radius'), opacity: +val('t_opacity') } }),
  goal: () => {
    const t = +val('g_target');
    if (!t || t < 1 || t > 2000000) throw new Error('Цель сбора — от 1 до 2 000 000 ₸');
    if (!ME.plan.shop && !goalFree(GOALSEL)) throw new Error('Стиль «' + GOAL_DESIGNS.find(d => d.id === GOALSEL).name + '» доступен с тарифа Lite. Бесплатно: Классика, Неон, Батарейка');
    return { goal: { title: val('g_title'), target: t, base: val('g_base'), theme: val('g_theme'), style: GOALSEL } };
  },
  info: () => ({ info: { lines: readList('#infoList').map(r => r.v), interval: 8, label: val('i_label') || 'INFO', dir: val('i_dir'), speed: val('i_speed'), show_last: val('i_show_last'), theme: val('i_theme') } }),
  timer: () => ({ timer: { sec_per_100: val('tm_sec'), theme: val('tm_theme') } }),
  roulette: () => ({ roulette: { enabled: val('r_enabled'), sound: val('r_sound'), min: val('r_min'), style: val('r_style'), tasks: readList('#taskList').map(r => r.v) } }),
  media: () => ({ media: { enabled: val('m_enabled'), min: val('m_min'), max_sec: val('m_max'), volume: +val('m_volume') } }),
  page: () => ({ page: { title: val('pg_title'), description: val('pg_description'), kaspi: val('pg_kaspi'), receiver: val('pg_receiver'), min_amount: val('pg_min'), cards: val('pg_cards'), avatar: val('pg_avatar'), banner: val('pg_banner'), color: val('pg_color'),
    socials: Object.fromEntries(['tiktok', 'instagram', 'telegram'].map(k => [k, val('s_' + k)])) } }),
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
// конструктор ТОПа: выбор дизайна и шрифта, живое превью
$('#t_styles').onclick = e => { const d = e.target.closest('.dz'); if (!d) return; TOPSEL.style = d.dataset.s; topPickers(); postTop(); if (d.classList.contains('locked')) toast('Это предпросмотр. Чтобы включить дизайн в эфире, подключите Lite', true); };
$('#t_fonts').onclick = e => { const b = e.target.closest('button'); if (!b) return; TOPSEL.font = b.dataset.f; topPickers(); postTop(); if (!ME.plan.shop && b.dataset.f !== 'manrope') toast('Это предпросмотр. Шрифты доступны с тарифа Lite', true); };
['input', 'change'].forEach(ev => $('.topcfg').addEventListener(ev, postTop));
function postInfo() { try { $('#infoFrame').contentWindow.postMessage({ kzInfo: collectors.info().info }, location.origin); } catch { } }
['input', 'change', 'click'].forEach(ev => $('.infocfg').addEventListener(ev, () => setTimeout(postInfo, 50)));
$('#tVoicePlay').onclick = () => { try { voiceAudio?.pause(); } catch { } voiceAudio = new Audio('/api/tts/sample?voice=' + val('tVoice')); voiceAudio.play().catch(() => toast('Не удалось воспроизвести', true)); };
$('#asGrid').onclick = e => { const c = e.target.closest('.as'); if (!c) return; const st = ALERT_STYLES.find(x => x.id === c.dataset.as);
  if (!st.free && !ME.plan.shop) return toast('«' + st.name + '» — с тарифа Lite. Раздел «Тариф»', true);
  if (st.id === 'meme' && !poolUrls().length) toast('Выберите или загрузите своё видео в «Мои алерты»', true);
  saveAlerts({ layout: st.id }, 'Стиль «' + st.name + '» включён — отправьте тестовый донат'); };
// готовые алерты: при наведении проигрываются без звука
$('#libAlerts').addEventListener('mouseover', e => { const v = e.target.closest('.ma')?.querySelector('video'); if (v) v.play().catch(() => {}); });
$('#libAlerts').addEventListener('mouseout', e => { const v = e.target.closest('.ma')?.querySelector('video'); if (v) { v.pause(); v.currentTime = 0; } });
$('#libAlerts').onclick = e => $('#myAlerts').onclick(e);
$('#fcCheck').onclick = async () => {
  const nick = val('fcNick').trim(); if (!nick) return toast('Введите ник FACEIT', true);
  const b = $('#fcCheck'); b.disabled = true; b.textContent = 'Ищем…';
  try { const r = await api('/api/faceit/link', { method: 'POST', body: { nick } }); ME.settings.faceit.nick = r.player.nick; fcAccount(r.player); toast(`Найден ${r.player.nick} — ELO ${r.player.elo} ✓`); }
  catch (e) { toast(e.message, true); }
  b.disabled = false; b.textContent = 'Проверить';
};
$('#fcNick').addEventListener('keydown', e => { if (e.key === 'Enter') $('#fcCheck').click(); });
$('#fcRefresh').onclick = async () => { try { const r = await api('/api/faceit/me?fresh=1'); fcAccount(r.player); toast('Статистика обновлена ✓'); } catch (e) { toast(e.message, true); } };
$('#fcUnlink').onclick = async () => { if (!confirm('Отвязать аккаунт FACEIT? Виджет перестанет показывать статистику.')) return; await api('/api/faceit/unlink', { method: 'POST', body: {} }); ME.settings.faceit.nick = ''; val('fcNick', ''); fcAccount(null); toast('Отвязано'); };
$('#fcOpts').addEventListener('change', fcPost);
$('#cardsGrid').addEventListener('input', e => { const r = e.target.closest('[data-ck]'); if (r) cardPost(r.dataset.ck); });
$('#cardsSave').onclick = async () => { const cards = Object.fromEntries(CARD_DEF.map(([k]) => [k, cardVal(k)])); try { const r = await api('/api/settings', { method: 'PUT', body: { cards } }); ME.settings = r.settings; toast('Карточки сохранены — виджеты обновятся сами ✓'); } catch (e) { toast(e.message, true); } };
$('#fcSave').onclick = async () => { try { const r = await api('/api/settings', { method: 'PUT', body: { faceit: { show: fcShow() } } }); ME.settings = r.settings; toast('Сохранено — виджет обновится сам ✓'); } catch (e) { toast(e.message, true); } };
$('#vaList').addEventListener('mouseover', e => { const v = e.target.closest('.va')?.querySelector('video'); if (v) v.play().catch(() => {}); });
$('#vaList').addEventListener('mouseout', e => { const v = e.target.closest('.va')?.querySelector('video'); if (v) { v.pause(); } });
$('#vaList').addEventListener('change', e => { const r = e.target.closest('.va'); if (!r) return; if (e.target.type === 'number' && e.target.value !== '') r.querySelector('[type=checkbox]').checked = true; r.classList.toggle('on', r.querySelector('[type=checkbox]').checked); });
$('#vaSave').onclick = () => {
  const pool = [...document.querySelectorAll('#vaList .va')].filter(r => r.querySelector('[type=checkbox]').checked).map(r => ({ url: r.dataset.va, min: +r.querySelector('[type=number]').value || 0 }));
  if (!ME.plan.shop && pool.length > 1) return toast('На Free можно включить 1 видео-алерт. На Lite — сколько угодно, каждое со своей суммой', true);
  saveAlerts({ pool, layout: pool.length ? 'meme' : (ME.settings.alerts.layout === 'meme' ? 'classic' : ME.settings.alerts.layout) }, pool.length ? `Видео-алерты сохранены: ${pool.length} шт.` : 'Видео-алерты выключены');
};
$('#myAlerts').onclick = e => { const m = e.target.closest('.ma'); if (!m) return; let pool = poolObjs();
  pool = pool.some(x => x.url === m.dataset.ma) ? pool.filter(x => x.url !== m.dataset.ma) : (ME.plan.shop ? [...pool, { url: m.dataset.ma, min: 0 }] : [{ url: m.dataset.ma, min: 0 }]);
  saveAlerts({ pool, layout: pool.length ? 'meme' : (ME.settings.alerts.layout === 'meme' ? 'classic' : ME.settings.alerts.layout) }, pool.length ? (pool.length > 1 ? `Мем-алерт: ${pool.length} видео, при донате выпадет случайное` : 'Мем-алерт включён') : 'Убрано'); };
$('#myAlertUp').onchange = async e => { const added = [];
  for (const f of e.target.files) { if (f.size > 8 * 1048576) { toast(f.name + ': больше 8 МБ', true); continue; }
    try { const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name) }, body: f }).then(r => r.json()); if (r.error) throw new Error(r.error); added.push(r.url); } catch (er) { toast(er.message, true); } }
  e.target.value = ''; if (!added.length) return;
  FILES = await api('/api/files'); fillFileSelects();
  const pool = ME.plan.shop ? [...poolObjs(), ...added.map(url => ({ url, min: 0 }))].slice(0, 30) : [{ url: added[0], min: 0 }];
  saveAlerts({ pool, layout: 'meme' }, 'Загружено и включено как мем-алерт ✓'); };
$('#shareNative').onclick = async () => { const url = ME.urls.page;
  if (navigator.share) { try { await navigator.share({ title: 'Донат через Kaspi', text: 'Поддержать меня донатом через Kaspi', url }); } catch { } }
  else { navigator.clipboard?.writeText(url); toast('Ссылка скопирована — вставьте её куда нужно'); } };
$('#shareQrDl').onclick = () => { const a = document.createElement('a'); a.download = `KZStream-QR-${ME.nick}.png`; a.href = $('#shareQr').toDataURL('image/png'); a.click(); };
document.addEventListener('change', async e => {
  const inp = e.target.closest('[data-up]'); if (!inp || !inp.files[0]) return;
  const f = inp.files[0]; inp.value = '';
  if (!/^image\//.test(f.type)) return toast('Нужна картинка: JPG, PNG, GIF или WEBP', true);
  if (f.size > 8 * 1048576) return toast('Картинка больше 8 МБ', true);
  try {
    toast('Загружаем…');
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name) }, body: f }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    FILES = await api('/api/files'); fillFileSelects();
    const keep = { pg_avatar: val('pg_avatar'), pg_banner: val('pg_banner') }; keep[inp.dataset.up] = r.url;
    Object.entries(keep).forEach(([k, v]) => val(k, v)); pagePreviews(); save('page');
  } catch (er) { toast(er.message, true); }
});
document.addEventListener('click', e => { const u = e.target.closest('[data-unset]'); if (!u) return; val(u.dataset.unset, ''); pagePreviews(); save('page'); });
$('#goalReset').onclick = () => { if (!confirm('Сбросить прогресс цели? Собранная сумма начнётся с нуля (донаты не удаляются).')) return; save('goal', { reset: true }); postGoal({ kzGoalReset: 1 }); };
$('#g_styles').onclick = e => { const d = e.target.closest('.gs'); if (!d) return; GOALSEL = d.dataset.g; goalPickers(); postGoal(); if (!ME.plan.shop && !goalFree(GOALSEL)) toast('Это предпросмотр. Стиль включится в эфире с тарифом Lite', true); };
['g_title', 'g_target', 'g_base', 'g_theme'].forEach(id => ['input', 'change'].forEach(ev => $('#' + id).addEventListener(ev, () => { postGoal(); goalDirty(); })));
$('#goalTest').onclick = () => { const a = [500, 1000, 2000, 5000, 10000][Math.floor(Math.random() * 5)]; postGoal({ kzGoalBump: a }); toast('Превью: +' + fmt(a) + ' (в эфир не отправляется)'); };
// голоса: выбор и прослушивание
$('#a_voices').onclick = e => {
  const pl = e.target.closest('[data-play]');
  if (pl) { e.stopPropagation(); try { voiceAudio?.pause(); } catch { } pl.textContent = '…'; voiceAudio = new Audio('/api/tts/sample?voice=' + pl.dataset.play); voiceAudio.onended = voiceAudio.onerror = () => { pl.textContent = '▶'; }; voiceAudio.onplaying = () => { pl.textContent = '■'; }; voiceAudio.play().catch(() => { pl.textContent = '▶'; toast('Не удалось воспроизвести', true); }); return; }
  const v = e.target.closest('.vc'); if (!v) return;
  if (!ME.plan.tts && v.dataset.v !== 'dmitry') return toast('Озвучка и выбор голоса — с тарифа Lite. Прослушать можно кнопкой ▶', true);
  VOICESEL = v.dataset.v; voicePicker(); toast('Голос выбран — нажмите «Сохранить» вверху страницы');
};

// ---------- тестовый донат ----------
$('#tSend').onclick = async () => {
  try { await api('/api/donations/test', { method: 'POST', body: { name: val('tName'), amount: +val('tAmount'), message: val('tMsg'), voice: val('tVoice') } }); toast('Тестовый донат отправлен в эфир'); }
  catch (e) { toast(e.message, true); }
};

// звук превью — только на сайте; выбор запоминается
let pvOn = (() => { try { return localStorage.kzPvSound === '1'; } catch { return false; } })();
function pvSound(on, user) {
  pvOn = on; try { localStorage.kzPvSound = on ? '1' : '0'; } catch { }
  const w = $('#prevFrame').contentWindow;
  try { if (on && user) w.KZunlock?.(); w.postMessage({ kzMute: !on }, location.origin); } catch { }
  $('#pvSound').textContent = on ? '🔊 Звук включён' : '🔇 Звук выключен';
  $('#tSound').textContent = on ? '🔇 Выключить звук в превью' : '🔊 Включить звук в превью';
  $('#pvSound').classList.toggle('on', on);
}
$('#tSound').onclick = $('#pvSound').onclick = () => { pvSound(!pvOn, true); toast(pvOn ? 'Звук в превью включён (только на сайте)' : 'Звук в превью выключен — в эфире звук остаётся'); };
// скрыть превью — только на сайте (в эфире ничего не меняется)
function pvShow(show) {
  try { localStorage.kzPvHide = show ? '0' : '1'; } catch { }
  $('#pvBox').classList.toggle('hide', !show); $('#pvOff').classList.toggle('hide', show);
  $('#pvHide').textContent = show ? '🙈 Скрыть превью' : '👁 Показать превью';
  const f = $('#prevFrame');
  if (!show) f.src = 'about:blank'; else if (!f.src || f.src === 'about:blank') f.src = ME.urls.widgets.alerts + '&preview';
}
$('#pvHide').onclick = () => { const show = $('#pvBox').classList.contains('hide'); pvShow(show); toast(show ? 'Превью включено' : 'Превью скрыто — только на сайте'); };
$('#prevFrame').addEventListener('load', () => setTimeout(() => pvSound(pvOn, false), 300));
$('#rTest').onclick = async () => { try { const r = await api('/api/test/roulette', { method: 'POST' }); toast('Крутим! Выпадет: ' + r.task); } catch (e) { toast(e.message, true); } };
$('#mTest').onclick = async () => { try { await api('/api/test/media', { method: 'POST', body: { url: val('mTestUrl') } }); toast('Видео добавлено в очередь — откройте плеер'); } catch (e) { toast(e.message, true); } };

// ---------- статистика и сброс тестовых донатов ----------
function renderStatsTiles() {
  const st = ME.stats;
  $('#stToday').textContent = fmt(st.today); $('#stMonth').textContent = fmt(st.month); $('#stYear').textContent = fmt(st.year); $('#stCnt').textContent = st.cnt;
  $('#testInfo').innerHTML = st.tests ? `В статистике <b style="color:var(--text)">${st.tests}</b> тестовых донатов на <b style="color:var(--text)">${fmt(st.tests_sum)}</b>. Настоящие донаты из Kaspi сброс не затронет.` : 'Тестовых донатов нет — в статистике только настоящие донаты.';
  $('#resetTests').disabled = !st.tests;
}
async function reloadStats() { try { const me = await api('/api/me'); ME.stats = me.stats; renderStatsTiles(); } catch { } }
$('#resetTests').onclick = async () => {
  const b = $('#resetTests');
  if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Точно удалить тестовые? Нажмите ещё раз'; setTimeout(() => { delete b.dataset.sure; b.textContent = '🧹 Сбросить тестовые донаты'; }, 4000); return; }
  delete b.dataset.sure; b.textContent = '🧹 Сбросить тестовые донаты';
  try { const r = await api('/api/donations/reset-tests', { method: 'POST' }); toast(`Удалено тестовых донатов: ${r.deleted}`); feed.length = 0; $('#feed').innerHTML = '<div class="muted">Пока пусто.</div>'; await reloadStats(); if (location.hash === '#donations') loadDonations(); }
  catch (e) { toast(e.message, true); }
};

// ---------- лента (SSE) ----------
const feed = [];
function pushFeed(html) { feed.unshift(html); feed.length = Math.min(feed.length, 40); $('#feed').innerHTML = feed.map(h => `<div class="it">${h}</div>`).join(''); }
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('donation', e => { const d = JSON.parse(e.data); pushFeed(`<span>💸 <b>${esc(d.name)}</b> ${esc(d.message || '')}</span><b>${fmt(d.amount)}</b>`); clearTimeout(window._st); window._st = setTimeout(reloadStats, 600); });
  es.addEventListener('ingest', e => { const d = JSON.parse(e.data); const r = { matched: '✅ донат', new: '✅ донат', ignored: '— пропущено' }[d.result]; pushFeed(`<span class="muted">📲 ${esc(d.text)}</span><span>${r}</span>`); });
  es.addEventListener('stats', e => { const d = JSON.parse(e.data); renderStats(d); });
}
function renderStats(d) {
  $('#goalNow').textContent = `Собрано: ${fmt(d.goal.sum)} из ${fmt(d.goal.target)}`;
  const t = d.timer; $('#timerNow').textContent = t.left ? new Date(t.left).toISOString().substr(11, 8) + (t.running ? ' (идёт)' : ' (пауза)') : '—';
  const c0 = d.media[0];
  $('#nowPl').classList.toggle('on', !!c0);
  if (c0) $('#nowPl').innerHTML = `<span class="eq"><i></i><i></i><i></i></span><div style="flex:1;min-width:0"><div class="muted" style="font-size:12px">Сейчас играет · заказал(а) ${esc(c0.name)} · ${fmt(c0.amount)}</div><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c0.title || c0.media_url)}</b></div>`;
  const rest = d.media.slice(1);
  $('#mediaQueue').innerHTML = rest.length ? rest.map((m, i) => `<div class="it" style="align-items:center"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 2}. ${esc(m.name)} — <a href="${esc(m.media_url)}" target="_blank" style="color:var(--accent)">${esc(m.title || 'ссылка')}</a></span><span style="display:flex;gap:8px;align-items:center"><b>${fmt(m.amount)}</b><button class="mq-x" data-mrm="${m.id}" title="Убрать из очереди">✕</button></span></div>`).join('') : `<div class="muted">${c0 ? 'Дальше ничего нет' : 'Очередь пуста'}</div>`;
  $('#mediaSkip').disabled = !c0;
}
async function loadState() { try { const st = await api('/api/w/' + ME.token + '/state'); renderStats(st); } catch { } }

// ---------- донаты ----------
async function loadDonations() {
  const list = await api('/api/donations?limit=200');
  $('#donTable').innerHTML = list.map(d => `<tr><td class="muted">${time(d.done_at || d.created_at)}</td><td>${esc(d.name || d.sender || '—')}${d.sender && d.sender !== d.name ? `<div class="muted" style="font-size:12px">Kaspi: ${esc(d.sender)}</div>` : ''}</td><td><b>${fmt(d.amount)}</b></td><td style="max-width:320px">${esc(d.message)}${d.media_url ? ' 🎵' : ''}</td>
    <td>${d.status === 'done' ? `<span class="tag ok">${d.source === 'test' ? 'тест' : 'получен'}</span>` : '<span class="tag">тест</span>'}</td>
    <td style="white-space:nowrap">${d.status === 'done' ? `<button class="btn btn-ghost btn-sm" data-replay="${d.id}">Повторить</button>` : ''} <button class="btn btn-ghost btn-sm" data-del="${d.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Донатов пока нет</td></tr>';
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
$('#mediaSkip').onclick = () => api('/api/media/skip', { method: 'POST', body: {} }).then(r => toast(r.skipped ? 'Пропущено — включается следующее' : 'Очередь пуста')).catch(e => toast(e.message, true));
document.addEventListener('click', e => { const b = e.target.closest('[data-mrm]'); if (!b) return; api('/api/media/skip', { method: 'POST', body: { id: +b.dataset.mrm } }).then(() => toast('Убрано из очереди')).catch(er => toast(er.message, true)); });
$('#mHere').onclick = () => { const box = $('#mHereBox'), on = box.style.display === 'none'; box.style.display = on ? '' : 'none'; $('#mHereFrame').src = on ? ME.urls.widgets.media : 'about:blank'; $('#mHere').textContent = on ? '■ Выключить плеер здесь' : '▶ Включить плеер здесь'; };

// ---------- подключение ----------
async function loadIngest() {
  const l = await api('/api/ingest-log');
  $('#ingestLog').innerHTML = l.map(x => `<tr><td class="muted">${time(x.created_at)}</td><td>${esc(x.text)}</td><td>${x.result === 'ignored' ? '<span class="tag">пропущено</span>' : '<span class="tag ok">донат</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Уведомлений ещё не было</td></tr>';
}
$('#devTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('#devTabs button').forEach(x => x.classList.toggle('on', x === b)); $$('[data-dp]').forEach(p => p.style.display = p.dataset.dp === b.dataset.d ? '' : 'none'); };
$('#resetToken').onclick = async () => { if (!confirmBox()) return; await api('/api/token/reset', { method: 'POST' }); await load(); toast('Ссылка изменена. Обновите её в приложении и в TikTok Live Studio'); };
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
  $('#curPlan').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap"><div><div class="muted">Текущий тариф</div><div style="font-family:Unbounded;font-size:24px">${p.name} ${ME.vip ? '<span class="tag ok">VIP</span>' : ''}</div><div class="muted">${ME.is_admin ? 'Вы владелец сервиса — все функции Pro без срока' : p.id === 'free' ? 'Бесплатно навсегда' : 'Активен до ' + new Date(ME.plan_until).toLocaleString('ru-RU')}</div></div>
    ${p.freezeDays ? `<button class="btn btn-ghost" id="freezeBtn" ${ME.freeze_available ? '' : 'disabled'}>❄️ Заморозить на ${p.freezeDays} дней</button>` : ''}</div>
    <p class="muted" style="margin-top:12px;font-size:13.5px">⭐ VIP: оплатите 10 месяцев — получите +10 дней Pro, ×1.5 хранилища и ранний доступ. Оплачено: ${ME.paid_months}/10.</p>`;
  const fb = $('#freezeBtn'); if (fb) fb.onclick = async () => { try { const r = await api('/api/freeze', { method: 'POST' }); toast(`Подписка продлена на ${r.days} дней`); load(); } catch (e) { toast(e.message, true); } };
  const feat = { free: ['Алерты донатов (до 8 сек)', 'Цель сбора', 'ТОП донатеров', 'Цензура, личная страница, 10 МБ'], lite: ['Озвучка, темы, ник донатеру', 'Рулетка, таймер, info', 'Ники и темы', 'Музыка/видео 50 раз', 'Заморозка 5 дней, 50 МБ'], pro: ['Всё из Lite без лимитов', 'Продвинутая озвучка', 'Хоткеи, вебхуки', 'Мем-алерты', 'Заморозка 10 дней, 100 МБ'] };
  $('#plansBox').innerHTML = ME.plans.map(pl => `<div class="plan ${pl.id === p.id ? 'cur' : ''}"><div class="muted">${pl.name}${pl.id === p.id ? ' · текущий' : ''}</div><b>${pl.price ? fmt(pl.price) + '<span class="muted" style="font-size:14px;font-family:Manrope"> /мес</span>' : '0 ₸'}</b><ul style="list-style:none;color:#cfd3e3;font-size:14px;display:flex;flex-direction:column;gap:6px">${feat[pl.id].map(f => `<li>✓ ${f}</li>`).join('')}</ul>${pl.price ? `<button class="btn ${pl.id === 'lite' ? 'btn-primary' : 'btn-ghost'}" style="width:100%;margin-top:16px" data-pick="${pl.id}">Выбрать ${pl.name}</button>` : ''}</div>`).join('');
  $$('[data-pick]').forEach(b => b.onclick = () => { val('payPlan', b.dataset.pick); calcPay(); $('#payBox').scrollIntoView({ behavior: 'smooth' }); });
  $('#payPhone').textContent = ME.pay.kaspi; $('#payName').textContent = 'получатель ' + ME.pay.name;
  $('#payTg').textContent = '@' + ME.pay.telegram; calcPay();
  // баланс и промокоды
  $('#balNow').textContent = fmt(ME.balance); calcBal();
  val('promoMine', ME.promo.mine); $('#promoCount').textContent = ME.promo.activations;
  $('#promoUse').innerHTML = ME.promo.used
    ? `<div class="tag ${ME.promo.active ? 'ok' : ''}">Активирован код ${esc(ME.promo.used)} — ${ME.promo.active ? 'скидка 20% на следующую оплату тарифа' : 'скидка уже использована'}</div>`
    : `<div class="field"><label>Есть промокод друга?</label><div class="copy-row"><input id="promoIn" placeholder="Ник стримера"><button class="btn btn-primary btn-sm" id="promoGo">Активировать</button></div></div>`;
  const pg = $('#promoGo'); if (pg) pg.onclick = async () => { try { const r = await api('/api/promo', { method: 'POST', body: { code: val('promoIn') } }); toast(`Промокод ${r.code} активирован: −${r.discount}%`); load(); } catch (e) { toast(e.message, true); } };
  $('#copyPayPhone').onclick = () => navigator.clipboard?.writeText(ME.pay.kaspi.replace(/\s/g, '')).then(() => toast('Номер карты скопирован'));
}
function calcBal() {
  const a = +val('balAmount') || 0;
  const msg = `Здравствуйте! Пополняю баланс KZStream на ${fmt(a)}. Мой ник: ${ME.nick}. Чек прикладываю.`;
  $('#balTg').href = `https://t.me/${ME.pay.telegram}?text=${encodeURIComponent(msg)}`;
}
$('#balAmount').oninput = calcBal;
$('#balSend').onclick = async () => { try { await api('/api/pay', { method: 'POST', body: { kind: 'balance', amount: +val('balAmount') } }); toast('Заявка на пополнение отправлена. Ожидайте подтверждения'); loadPayments(); } catch (e) { toast(e.message, true); } };
$('#payBal').onclick = async () => { try { const r = await api('/api/pay/balance', { method: 'POST', body: { plan: val('payPlan'), months: +val('payMonths') } }); toast('Тариф оплачен с баланса! Остаток: ' + fmt(r.balance)); load(); } catch (e) { toast(e.message, true); } };
function calcPay() {
  const pl = ME.plans.find(x => x.id === val('payPlan')), full = pl.price * +val('payMonths');
  const sum = ME.promo.active ? Math.round(full * (100 - ME.promo.discount) / 100) : full;
  $('#payAmount').innerHTML = ME.promo.active ? `${fmt(sum)} <s class="muted" style="font-size:16px">${fmt(full)}</s>` : fmt(sum);
  $('#payPromo').textContent = ME.promo.active ? `🎟 Промокод ${ME.promo.used}: −${ME.promo.discount}%` : '';
  $('#payBal').textContent = `💰 Оплатить с баланса (${fmt(ME.balance)})`;
  const msg = `Здравствуйте! Оплатил KZStream ${pl.name} на ${val('payMonths')} мес — ${fmt(sum)}. Мой ник: ${ME.nick}. Чек прикладываю.`;
  const tg = `https://t.me/${ME.pay.telegram}?text=${encodeURIComponent(msg)}`;
  $('#payTg').href = tg; $('#payTgBtn').href = tg;
}
$('#payPlan').onchange = calcPay; $('#payMonths').onchange = calcPay;
$('#paySend').onclick = async () => { try { await api('/api/pay', { method: 'POST', body: { plan: val('payPlan'), months: +val('payMonths'), comment: val('payComment') } }); toast('Заявка отправлена. Ожидайте подтверждения'); loadPayments(); } catch (e) { toast(e.message, true); } };
async function loadPayments() {
  const l = await api('/api/payments');
  $('#payHist').innerHTML = l.map(x => `<tr><td class="muted">${time(x.created_at)}</td><td>${x.kind === 'balance' ? '💰 Пополнение баланса' : x.plan.toUpperCase() + ' × ' + x.months + ' мес' + (x.promo ? ' · −20% ' + esc(x.promo) : '')}</td><td>${fmt(x.amount)}</td><td>${{ pending: '<span class="tag wait">на проверке</span>', approved: '<span class="tag ok">подтверждена</span>', rejected: '<span class="tag no">отклонена</span>' }[x.status]}</td></tr>`).join('') || '<tr><td class="muted">Заявок нет</td></tr>';
}

// ---------- аккаунт ----------
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };
$('#pwSave').onclick = async () => { try { await api('/api/password', { method: 'POST', body: { old: val('pwOld'), new: val('pwNew') } }); toast('Пароль изменён'); val('pwOld', ''); val('pwNew', ''); } catch (e) { toast(e.message, true); } };

load().then(() => { route(); connectEvents(); loadState(); }).catch(e => toast(e.message, true));
// ---------- размер каждого виджета: выбор рядом с его ссылкой (хранится в ссылке &s=) ----------
const SIZES = [50, 75, 100, 125, 150, 200];
function sizePickers() {
  document.querySelectorAll('input[readonly]').forEach(inp => {
    if (!/\/w\/[\w-]+\.html\?t=/.test(inp.value) || inp.dataset.sz) return;
    inp.dataset.sz = 1;
    let saved = 100; try { saved = +localStorage['kzSz_' + inp.id] || 100; } catch { }
    const sel = document.createElement('select'); sel.className = 'sz-pick'; sel.title = 'Размер виджета';
    sel.innerHTML = SIZES.map(v => `<option value="${v}" ${v === saved ? 'selected' : ''}>${v}%</option>`).join('');
    const apply = () => { const v = +sel.value, base = inp.value.replace(/&s=\d+/, ''); inp.value = v === 100 ? base : base + '&s=' + v; try { localStorage['kzSz_' + inp.id] = v; } catch { } };
    sel.onchange = () => { apply(); toast(`Размер ${sel.value}% — скопируйте ссылку заново и вставьте в TikTok Live Studio`); };
    inp.after(sel); apply();
  });
}
setInterval(sizePickers, 1500);
})();
