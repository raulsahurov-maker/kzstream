// KZStream — сервер: регистрация, кабинет, приём уведомлений, виджеты OBS
'use strict';
process.env.TZ = process.env.TZ || 'Asia/Almaty'; // «сегодня/месяц/год» по времени Казахстана
process.removeAllListeners('warning');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('libsql');
const { PLANS, effectivePlan } = require('./lib/plans');
const { parseNotification } = require('./lib/parse');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// ---------- конфиг ----------
const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
// оплата тарифов — на карту Kaspi (номер телефона больше не используется)
const PAY_KASPI = process.env.PAY_CARD || '4400 4303 5638 4575';
const PAY_NAME = process.env.PAY_NAME || 'Алибек Т.';
const PAY_TELEGRAM = (process.env.PAY_TELEGRAM || 'raulanrip').replace(/^@/, '');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const MATCH_WINDOW_MS = 30 * 60 * 1000;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- база ----------
// Если заданы TURSO_URL и TURSO_TOKEN — данные хранятся в облачной базе Turso (не пропадают при обновлениях).
// Иначе — локальный файл (для запуска на своём компьютере или VPS).
const TURSO_URL = (process.env.TURSO_URL || '').trim(), TURSO_TOKEN = (process.env.TURSO_TOKEN || '').trim();
const USE_TURSO = !!(TURSO_URL && TURSO_TOKEN);
// Сайт работает с быстрой локальной копией базы. Если подключён Turso — при запуске копия
// заполняется данными из Turso, а каждое изменение по очереди отправляется в Turso.
const LOCAL_DB = path.join(DATA_DIR, USE_TURSO ? 'mirror.db' : 'kzstream.db');
if (USE_TURSO) for (const ext of ['', '-wal', '-shm']) fs.rmSync(LOCAL_DB + ext, { force: true });
const db = new Database(LOCAL_DB);
db.exec('PRAGMA journal_mode=WAL;');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, nick TEXT UNIQUE COLLATE NOCASE, email TEXT UNIQUE COLLATE NOCASE,
  pass TEXT, salt TEXT, created_at INTEGER, is_admin INTEGER DEFAULT 0,
  plan TEXT DEFAULT 'free', plan_until INTEGER DEFAULT 0, token TEXT UNIQUE,
  settings TEXT DEFAULT '{}', paid_months INTEGER DEFAULT 0, freeze_used_at INTEGER DEFAULT 0, vip_bonus INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS faceit_track(nick TEXT, at INTEGER, elo INTEGER, PRIMARY KEY(nick, at));
CREATE TABLE IF NOT EXISTS donations(
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, amount INTEGER, message TEXT DEFAULT '',
  media_url TEXT DEFAULT '', voice_url TEXT DEFAULT '', source TEXT, status TEXT, sender TEXT DEFAULT '',
  media_status TEXT DEFAULT '', created_at INTEGER, done_at INTEGER, hidden INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS d_user ON donations(user_id, status, created_at);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, user_id INTEGER, plan TEXT, months INTEGER, amount INTEGER,
  status TEXT DEFAULT 'pending', created_at INTEGER, comment TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, mime TEXT, size INTEGER, file TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS file_data(file TEXT PRIMARY KEY, data BLOB);
CREATE TABLE IF NOT EXISTS page_files(file TEXT PRIMARY KEY, user_id INTEGER, kind TEXT, mime TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS bt_diag(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, t INTEGER, m TEXT, v TEXT);
CREATE TABLE IF NOT EXISTS ingest_log(id INTEGER PRIMARY KEY, user_id INTEGER, hash TEXT, text TEXT, result TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS il_user ON ingest_log(user_id, hash);
`;
db.exec(SCHEMA);

// миграции: новые поля для подтверждения email (старые аккаунты считаются подтверждёнными)
const MIGRATIONS = [
  ['ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0', 'UPDATE users SET email_verified=1'],
  ['ALTER TABLE users ADD COLUMN verify_code TEXT', null],
  ['ALTER TABLE users ADD COLUMN verify_sent_at INTEGER DEFAULT 0', null],
  ['ALTER TABLE users ADD COLUMN verify_tries INTEGER DEFAULT 0', null],
  ['ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0', null],
  ['ALTER TABLE users ADD COLUMN promo_used TEXT DEFAULT \'\'', null],
  ['ALTER TABLE users ADD COLUMN promo_spent INTEGER DEFAULT 0', null],
  ['ALTER TABLE payments ADD COLUMN kind TEXT DEFAULT \'plan\'', null],
  ['ALTER TABLE payments ADD COLUMN promo TEXT DEFAULT \'\'', null],
  ['ALTER TABLE users ADD COLUMN badges TEXT DEFAULT \'\'', null],
  ['ALTER TABLE users ADD COLUMN ref_by INTEGER DEFAULT 0', null],
  ['ALTER TABLE donations ADD COLUMN orig_name TEXT DEFAULT \'\'', null],
  ['ALTER TABLE users ADD COLUMN ref_earned INTEGER DEFAULT 0', null],
];
for (const [alter, after] of MIGRATIONS) { try { db.exec(alter); if (after) db.exec(after); } catch { /* поле уже есть */ } }
// обёртка: убираем служебное поле _metadata, которое добавляет libsql
const clean = (r) => { if (r && typeof r === 'object') delete r._metadata; return r; };
// ---- зеркалирование в Turso ----
let remote = null;
const outbox = []; let pushing = false;
const toRemoteArg = (v) => Buffer.isBuffer(v) ? new Uint8Array(v) : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
async function pushLoop() {
  if (pushing || !remote) return; pushing = true;
  while (outbox.length) {
    const job = outbox[0];
    try { await remote.execute({ sql: job.sql, args: job.args.map(toRemoteArg) }); outbox.shift(); }
    catch (e) { console.error('Turso: не удалось записать, повтор через 3 сек:', e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
  pushing = false;
}
const q = (sql) => { const st = db.prepare(sql); return {
  get: (...a) => clean(st.get(...a)), all: (...a) => st.all(...a).map(clean),
  run: (...a) => { const r = st.run(...a); if (remote) { outbox.push({ sql, args: a }); pushLoop(); } return r; } }; };
const TABLES = ['users', 'sessions', 'donations', 'payments', 'files', 'file_data', 'ingest_log', 'faceit_track', 'page_files', 'bt_diag'];
async function initStorage() {
  if (!USE_TURSO) { console.log('Локальная база: ' + LOCAL_DB); return; }
  const { createClient } = require('@libsql/client');
  const url = TURSO_URL.replace(/^libsql:\/\//, 'https://');
  // диагностика без раскрытия ключа
  const parts = TURSO_TOKEN.split('.');
  console.log(`Turso: адрес ${url}, ключ: длина ${TURSO_TOKEN.length}, частей ${parts.length}, начинается с "${TURSO_TOKEN.slice(0, 3)}"`);
  try {
    const r = await fetch(url + '/v2/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }, { type: 'close' }] }), signal: AbortSignal.timeout(15000) });
    console.log('Turso: проверка связи →', r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.log('Turso: проверка связи не удалась:', e.message); }
  const client = createClient({ url, authToken: TURSO_TOKEN });
  const stmts = SCHEMA.split(';').map(x => x.trim()).filter(Boolean);
  for (const st of stmts) {
    try { await client.execute(st); }
    catch (e) { console.error('Turso: ошибка в запросе:', st.slice(0, 80).replace(/\s+/g, ' '), '→', e.message, e.cause?.message || ''); throw e; }
  }
  for (const [alter, after] of MIGRATIONS) { try { await client.execute(alter); if (after) await client.execute(after); } catch { /* поле уже есть */ } }
  // загружаем таблицы частями (большой ответ Turso обрывает соединение); видео/картинки (file_data) — не грузим,
  // они подтягиваются по одному при первом запросе файла
  let total = 0;
  for (const t of TABLES) {
    if (t === 'file_data') continue;
    for (let off = 0; ; off += 500) {
      const r = await client.execute({ sql: `SELECT * FROM ${t} ORDER BY rowid LIMIT 500 OFFSET ?`, args: [off] });
      if (!r.rows.length) break;
      const cols = r.columns, ins = db.prepare(`INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
      db.exec('BEGIN');
      for (const row of r.rows) ins.run(...cols.map(c => { const v = row[c]; return v instanceof ArrayBuffer ? Buffer.from(v) : (typeof v === 'bigint' ? Number(v) : v); }));
      db.exec('COMMIT');
      total += r.rows.length;
      if (r.rows.length < 500) break;
    }
  }
  remote = client;
  console.log(`База Turso подключена, загружено строк: ${total}`);
}
// при остановке сервера — дописываем очередь в Turso
async function flushAndExit() { const t = Date.now(); while ((outbox.length || pushing) && Date.now() - t < 8000) { pushLoop(); await new Promise(r => setTimeout(r, 200)); } process.exit(0); }
process.on('SIGTERM', flushAndExit); process.on('SIGINT', flushAndExit);

// ---------- настройки по умолчанию ----------
const INFO_STYLES = ['plate', 'plain', 'neon', 'gold', 'glass', 'outline', 'gradient', 'fire'];
const TOP_STYLES = ['classic', 'glassneon', 'esports', 'darkgold', 'hud', 'vice', 'fire', 'cs2', 'xmas'], TOP_FONTS = ['manrope', 'montserrat', 'unbounded', 'oswald', 'rubik', 'inter'];
// стили цели сбора: первые три — бесплатно, остальные с тарифа Lite
const GOAL_STYLES = ['classic', 'neon', 'battery', 'dream', 'water', 'ring', 'thermo', 'gold', 'minimal'], GOAL_FREE = ['classic', 'neon', 'battery', 'dream'];
const DREAMS = ['pc', 'phone', 'car', 'house', 'travel', 'game', 'mic', 'mouse', 'headphones', 'event'];
const GOAL_MAX = 2000000;
// стили алертов: classic и meme (свои видео/гифки) — бесплатно, денежный дождь и монетка — с Lite
const ALERT_LAYOUTS = ['classic', 'meme', 'money', 'coin', 'card'], ALERT_FREE = ['classic', 'meme', 'card'];
const CARD_FONTS = ['unbounded', 'manrope', 'montserrat', 'russo', 'rubik', 'comfortaa', 'oswald', 'lobster', 'caveat', 'pixel'];
// голоса озвучки (Microsoft Neural — те же, что на FreeTTS). [голос, название, высота, скорость, язык для запасного варианта]
const VOICES = {
  dmitry: ['ru-RU-DmitryNeural', 'Дмитрий', '', '', 'ru'],
  svetlana: ['ru-RU-SvetlanaNeural', 'Светлана', '', '', 'ru'],
  daulet: ['kk-KZ-DauletNeural', 'Дәулет', '', '', 'kk'],
  aigul: ['kk-KZ-AigulNeural', 'Айгүл', '', '', 'kk'],
  andrew: ['en-US-AndrewMultilingualNeural', 'Эндрю', '', '', 'ru'],
  emma: ['en-US-EmmaMultilingualNeural', 'Эмма', '', '', 'ru'],
  ava: ['en-US-AvaMultilingualNeural', 'Ава', '', '', 'ru'],
  brian: ['en-US-BrianMultilingualNeural', 'Брайан', '', '', 'ru'],
};
const THEMES = ['default', 'neon', 'sunset', 'mint', 'royal', 'mono', 'candy', 'steppe', 'ice', 'gold'];
function defaults(nick) {
  return {
    page: { title: nick, description: 'Спасибо за поддержку стрима!', kaspi: '', receiver: '', min_amount: 100, cards: '', avatar: '', banner: '', color: '#ff3b5c',
      socials: { twitch: '', youtube: '', tiktok: '', instagram: '', telegram: '', discord: '', donationalerts: '' },
      tiktok: '', extra: '', wall: false, wall_count: 10, wall_msg: true, bg: '', design: 'classic', effect: 'none', effect_layer: 'over',
      devices: { type: 'pc', items: {}, custom: [] }, schedule: { days: [], start: '', end: '' }, cards2: [], blocks: { texts: [], links: [] } },
    alerts: { duration: 6, gif: '', sound: '', volume: 0.8, min_alert: 0, show_msg: true, theme: 'default',
      tts: true, min_tts: 0, tts_lang: 'ru', tts_voice: 'dmitry', tts_rate: 1, tts_read_name: false, variations: [], layout: 'classic', pool: [], pool_min: 0,
      card: { img: '', bg: '#0f3b3a', bg2: '#4b2a7a', op: 0.75, grad: true, border: '#ffffff', name: '#ffffff', sum: '#5ef2e6', text: '#ffffff', font: 'unbounded', radius: 28, pos: 'center' } },
    censor: { words: '', strip_links: true },
    nicks: {},
    goal: { title: 'Цель сбора', target: 100000, base: 0, start_at: Date.now(), theme: 'default', style: 'classic' },
    top: { period: 'month', count: 5, theme: 'default', style: 'classic', font: 'manrope', title: '', size: 'md', radius: 16, opacity: 0.9, bg: '', bgall: false, row: '', rowtx: '' },
    roulette: { enabled: true, min: 500, style: 'wheel',
      tasks: ['Спеть песню', 'Катка без прицела', '10 отжиманий', 'Говорить с акцентом', 'Ответить на 3 вопроса', 'Танец 15 сек'] },
    media: { enabled: true, min: 100, max_sec: 180, volume: 0.6 },
    info: { lines: ['Донаты через Kaspi — ссылка в описании!'], interval: 8, theme: 'default', label: 'INFO', speed: 'normal', dir: 'right', show_last: true },
    timer: { end_at: 0, paused_left: 0, running: false, sec_per_100: 30, theme: 'default' },
    cards: { kaspi: { value: '', name: '' }, halyk: { value: '', name: '' }, freedom: { value: '', name: '' }, twitch: { value: '', name: '' }, instagram: { value: '', name: '' }, youtube: { value: '', name: '' }, telegram: { value: '', name: '' }, blackrussia: { value: '', name: '', promo: '' } },
    faceit: { nick: '', show: { level: true, elo: true, today: true, kd: true, wr: true, hs: true, adr: false, matches: true, streak: false, last: true, flag: true } },
    hotkeys: [], webhooks: [],
  };
}
function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]))
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}
const getSettings = (u) => {
  const s = deepMerge(defaults(u.nick), JSON.parse(u.settings || '{}'));
  // разово (ноябрь 2026): включаем «Принимать заказы музыки и видео» всем, у кого не было отметки — дальше стример решает сам
  // разово: включаем рулетку всем (минимум 500 ₸) — дальше стример решает сам
  // разово: звук рулетки выключен у всех, пока стример сам не включит
  if (!s.roulette.snd_v3) { s.roulette.sound = false; s.roulette.snd_v3 = 1; }
  if (!s.roulette.auto_v2) { s.roulette.enabled = true; if (s.roulette.min > 500) s.roulette.min = 500; s.roulette.auto_v2 = 1; }
  if (!s.media.auto_v2) { s.media.enabled = true; if (s.media.min > 100) s.media.min = 100; s.media.auto_v2 = 1; }
  return s;
};
const saveSettings = (u, s) => q('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(s), u.id);

// ---------- утилиты ----------
const rnd = (n = 24) => crypto.randomBytes(n).toString('base64url');
const hashPass = (p, salt) => crypto.scryptSync(p, salt, 64).toString('hex');
const clampStr = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const int = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const now = () => Date.now();
const userById = (id) => q('SELECT * FROM users WHERE id=?').get(id);
const userByToken = (t) => t ? q('SELECT * FROM users WHERE token=?').get(String(t)) : null;
const userByNick = (n) => q('SELECT * FROM users WHERE nick=?').get(String(n));
const baseUrl = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
const storageUsed = (uid) => q('SELECT COALESCE(SUM(size),0) s FROM files WHERE user_id=?').get(uid).s;

function censor(text, s) {
  let t = String(text || '');
  if (s.censor.strip_links) t = t.replace(/(https?:\/\/|www\.)\S+/gi, '[ссылка]');
  const words = String(s.censor.words || '').split(/[,\n]/).map(w => w.trim()).filter(Boolean);
  for (const w of words) t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
  return t;
}

// простой лимитер запросов
const hits = new Map();
function limited(key, max, windowMs) {
  const t = now(); const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t); hits.set(key, arr); return arr.length > max;
}
setInterval(() => { const t = now(); for (const [k, v] of hits) if (!v.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

// ---------- realtime (SSE) ----------
const channels = new Map(); // user_id -> Set(res)
const watchHooks = [];
function subscribe(uid, res) {
  if (!channels.has(uid)) channels.set(uid, new Set());
  const first = channels.get(uid).size === 0;
  channels.get(uid).add(res);
  if (first) for (const f of watchHooks) { try { f(uid); } catch { } }
  res.on('close', () => channels.get(uid)?.delete(res));
}
function emit(uid, event, data) {
  const set = channels.get(uid); if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of set) r.write(msg);
}
// озвучка чата — ровно одному виджету TikTok (если в Live Studio их несколько, голос не двоится)
function emitSpeaker(uid, event, data) {
  const set = channels.get(uid); if (!set) return;
  const L = [...set].filter(r => r.kzRole === 'tts');
  const pick = L.filter(r => r.kzEv.split(',').includes('chat')).sort((a, b) => a.kzAt - b.kzAt)[0]
    || L.filter(r => !r.kzEv).sort((a, b) => a.kzAt - b.kzAt)[0];
  if (pick) pick.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
setInterval(() => { for (const set of channels.values()) for (const r of set) r.write(': ping\n\n'); }, 20000).unref();
function sse(res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 3000\n\n');
}

// ---------- расчёты для виджетов ----------
function periodStart(period) {
  const d = new Date();
  if (period === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === 'week') return now() - 7 * 864e5;
  if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (period === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
  return 0;
}
function topList(u, s) {
  return q(`SELECT name, SUM(amount) total, COUNT(*) cnt FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?
    GROUP BY lower(name) ORDER BY total DESC LIMIT ?`).all(u.id, periodStart(s.top.period), int(s.top.count, 1, 20, 5));
}
function goalSum(u, s) {
  const r = q(`SELECT COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, s.goal.start_at || 0);
  return r.s + (+s.goal.base || 0);
}
function timerState(s) {
  const t = s.timer;
  return { running: !!t.running, end_at: t.end_at, left: t.running ? Math.max(0, t.end_at - now()) : t.paused_left };
}
function publicPlan(u) {
  const p = effectivePlan(u);
  return { ...p, media: p.media === Infinity ? -1 : p.media };
}
// последний донат — для виджета «Последний донат» (с цензурой и временем)
function lastDonation(u, s) {
  const d = q(`SELECT id, name, amount, message, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 ORDER BY done_at DESC LIMIT 1`).get(u.id);
  if (!d) return null;
  s = s || getSettings(u);
  return { id: d.id, name: (s.nicks && s.nicks[d.name]) || d.name, amount: d.amount, message: s.alerts.show_msg ? censor(d.message || '', s) : '', at: d.done_at };
}
function widgetState(u) {
  const s = getSettings(u);
  const p = effectivePlan(u);
  const lastDon = lastDonation(u, s);
  return {
    nick: u.nick, plan: publicPlan(u), settings: { alerts: { ...s.alerts, layout: p.shop || ALERT_FREE.includes(s.alerts.layout || 'classic') ? (s.alerts.layout || 'classic') : 'classic' }, goal: { ...s.goal, style: p.shop || GOAL_FREE.includes(s.goal.style || 'classic') ? (s.goal.style || 'classic') : 'classic' }, top: p.shop ? s.top : { ...s.top, style: 'classic', font: 'manrope', theme: 'default' }, roulette: s.roulette, media: s.media, info: s.info, timer: s.timer, faceit: s.faceit, cards: s.cards, hotkeys: p.hotkeys ? s.hotkeys : [] },
    top: topList(u, s), goal: { sum: goalSum(u, s), target: s.goal.target, title: s.goal.title },
    timer: timerState(s), last: lastDon || null, last_locked: !p.shop, media: mediaQueue(u),
  };
}
const mediaTitles = new Map(); // id доната -> название видео (сообщает плеер)
function mediaQueue(u) {
  return q(`SELECT id, name, amount, media_url FROM donations WHERE user_id=? AND media_status='queued' ORDER BY done_at ASC, id ASC LIMIT 20`).all(u.id).map(m => ({ ...m, title: mediaTitles.get(m.id) || '' }));
}
function pushStats(u) {
  const s = getSettings(u);
  emit(u.id, 'stats', { top: topList(u, s), goal: { sum: goalSum(u, s), target: s.goal.target, title: s.goal.title }, timer: timerState(s), media: mediaQueue(u), last: lastDonation(u, s), last_locked: !effectivePlan(u).shop });
}

// ---------- завершение доната ----------
function ytId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : '';
}
function finalizeDonation(u, d, opts = {}) {
  const s = getSettings(u);
  const p = effectivePlan(u);
  // ник донатеру (Lite+): сопоставление имени отправителя Kaspi -> ник
  let name = d.name || d.sender || 'Аноним';
  if (p.nicks && d.sender) {
    const alias = Object.entries(s.nicks || {}).find(([k]) => k.toLowerCase() === d.sender.toLowerCase());
    if (alias && !d.name) name = alias[1];
  }
  name = clampStr(name, 32) || 'Аноним';
  // если в «сообщении» оказалось только имя отправителя — это не сообщение (не показываем и не озвучиваем)
  { const nm = x => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); if (d.message && (nm(d.message) === nm(d.sender) || nm(d.message) === nm(name))) d.message = ''; }
  const message = censor(String(d.message || '').replace(/(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\S*/gi, '🎵').trim(), s);
  // медиа
  let media_status = '';
  if (d.media_url && s.media.enabled && p.media !== 0 && d.amount >= s.media.min && ytId(d.media_url)) {
    const monthStart = periodStart('month');
    const used = q(`SELECT COUNT(*) c FROM donations WHERE user_id=? AND media_status!='' AND done_at>=?`).get(u.id, monthStart).c;
    if (p.media === Infinity || used < p.media) media_status = 'queued';
  }
  q(`UPDATE donations SET status='done', name=?, message=?, done_at=?, media_status=? WHERE id=?`).run(name, message, now(), media_status, d.id);

  // таймер сабатона
  if (p.timer && s.timer.running && s.timer.sec_per_100 > 0) {
    s.timer.end_at += Math.floor(d.amount / 100) * s.timer.sec_per_100 * 1000;
    saveSettings(u, s);
  }
  // мем-алерт (Pro) — вариация по точной сумме
  let variation = null;
  if (p.memes) variation = (s.alerts.variations || []).find(v => +v.amount === d.amount) || null;
  // рулетка
  let roulette = null;
  if (p.roulette && s.roulette.enabled && d.amount >= s.roulette.min && s.roulette.tasks.length) {
    const idx = crypto.randomInt(s.roulette.tasks.length);
    roulette = { index: idx, task: s.roulette.tasks[idx], tasks: s.roulette.tasks, style: s.roulette.style };
  }
  // случайная мем-гифка из своего набора (Lite) — если нет мем-алерта на точную сумму
  let meme = '';
  // видео-алерты по сумме: подходят те, у кого «от N ₸» ≤ суммы; берём самый «дорогой» уровень, среди равных — случайное
  const pool = (s.alerts.pool || []).filter(x => x && !String(x.url || x).startsWith('/alerts-lib/meme-')).map(x => typeof x === 'string' ? { url: x, min: 0 } : x).slice(0, p.shop ? 30 : 1);
  const fit = pool.filter(x => d.amount >= (+x.min || 0));
  if (!variation && s.alerts.layout === 'meme' && fit.length && d.amount >= (s.alerts.pool_min || 0)) {
    const top = Math.max(...fit.map(x => +x.min || 0)), best = fit.filter(x => (+x.min || 0) === top);
    meme = best[crypto.randomInt(best.length)].url;
  }
  const event = {
    id: d.id, name, amount: d.amount, message: s.alerts.show_msg ? message : '', meme, tts_voice: VOICES[opts.voice] ? opts.voice : '',
    voice_url: p.voice ? d.voice_url : '', variation, roulette,
    tts: p.tts && s.alerts.tts && d.amount >= (s.alerts.min_tts || 0),
    show: d.amount >= (s.alerts.min_alert || 0), at: now(),
  };
  emit(u.id, 'donation', event);
  if (roulette) emit(u.id, 'roulette', { ...roulette, name, amount: d.amount, sound: s.roulette.sound === true });
  pushStats(u);
  // вебхуки (Pro)
  if (p.webhooks) for (const url of (s.webhooks || []).slice(0, 5)) {
    if (!/^https?:\/\//.test(url)) continue;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'donation', ...event, nick: u.nick }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  return event;
}

// ---------- почта: подтверждение email кодом ----------
// Письма отправляются через Brevo (бесплатно 300 писем/день): BREVO_API_KEY и MAIL_FROM (подтверждённый в Brevo адрес).
// Если почта не настроена — подтверждение выключено, чтобы сайт продолжал работать.
const BREVO_API_KEY = (process.env.BREVO_API_KEY || '').trim();
const MAIL_FROM = (process.env.MAIL_FROM || '').trim();
const VERIFY_ON = !!(BREVO_API_KEY && MAIL_FROM);
if (!VERIFY_ON) console.log('Почта не настроена (BREVO_API_KEY, MAIL_FROM) — подтверждение email выключено');
async function sendMail(to, subject, html) {
  const r = await fetch((process.env.BREVO_URL || 'https://api.brevo.com') + '/v3/smtp/email', { method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'KZStream', email: MAIL_FROM }, to: [{ email: to }], subject, htmlContent: html }),
    signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Brevo ' + r.status + ': ' + (await r.text()).slice(0, 200));
}
function codeMail(code, nick) {
  return `<div style="font-family:Arial,sans-serif;background:#07080d;padding:32px 16px"><div style="max-width:440px;margin:0 auto;background:#12141f;border:1px solid #232739;border-radius:18px;padding:28px;color:#eef0f7">
  <div style="font-size:22px;font-weight:800;margin-bottom:6px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:#ff3b5c;color:#fff;margin-right:8px">▶</span>KZStream</div>
  <p style="color:#9097ad;font-size:15px">Привет, ${nick}! Ваш код подтверждения email:</p>
  <div style="font-size:38px;font-weight:800;letter-spacing:10px;text-align:center;background:#0d0f18;border-radius:14px;padding:18px;margin:18px 0;color:#ff7a45">${code}</div>
  <p style="color:#9097ad;font-size:13px">Код действует 30 минут. Если вы не регистрировались на KZStream — просто проигнорируйте это письмо.</p></div></div>`;
}
const dns = require('dns').promises;
async function emailDomainOk(email) {
  const domain = email.split('@')[1];
  try { const mx = await dns.resolveMx(domain); return mx.length > 0; }
  catch (e) {
    if (e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') return true;
    // если не работает сам DNS (проверяем на gmail.com) — не блокируем регистрацию
    try { await dns.resolveMx('gmail.com'); return false; } catch { return true; }
  }
}
async function sendVerifyCode(u) {
  const code = String(crypto.randomInt(100000, 1000000));
  q('UPDATE users SET verify_code=?, verify_sent_at=?, verify_tries=0 WHERE id=?').run(code, now(), u.id);
  await sendMail(u.email, `Код KZStream: ${code}`, codeMail(code, u.nick));
}
const needsVerify = (u) => VERIFY_ON && !u.email_verified;

// ---------- приложение ----------
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function auth(req, res, next) {
  const sid = readCookie(req, 'sid');
  const s = sid && q('SELECT * FROM sessions WHERE id=?').get(sid);
  const u = s && userById(s.user_id);
  if (!u) return res.status(401).json({ error: 'Требуется вход' });
  if (needsVerify(u)) return res.status(403).json({ error: 'Подтвердите email', verify: true, email: u.email });
  req.user = u; next();
}
// вход без проверки подтверждения — только для страниц подтверждения email
function authAny(req, res, next) {
  const sid = readCookie(req, 'sid');
  const s = sid && q('SELECT * FROM sessions WHERE id=?').get(sid);
  const u = s && userById(s.user_id);
  if (!u) return res.status(401).json({ error: 'Требуется вход' });
  req.user = u; next();
}
function admin(req, res, next) { auth(req, res, () => req.user.is_admin ? next() : res.status(403).json({ error: 'Нет доступа' })); }
function startSession(res, uid) {
  const sid = rnd(32);
  q('INSERT INTO sessions(id,user_id,created_at) VALUES(?,?,?)').run(sid, uid, now());
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 60}`);
}

// --- регистрация / вход ---
app.post('/api/register', async (req, res) => {
  if (limited('reg:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Слишком много попыток, попробуйте позже' });
  const nick = clampStr(req.body.nick, 24);
  const email = clampStr(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(nick)) return res.status(400).json({ error: 'Ник: 3–24 символа, латиница, цифры, _ . -' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (userByNick(nick)) return res.status(409).json({ error: 'Такой ник уже занят' });
  if (q('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  if (VERIFY_ON && !(await emailDomainOk(email))) return res.status(400).json({ error: 'Такой почты не существует — проверьте адрес' });
  const salt = rnd(16);
  const isFirst = q('SELECT COUNT(*) c FROM users').get().c === 0;
  const isAdmin = isFirst || ADMIN_EMAILS.includes(email) ? 1 : 0;
  const settings = defaults(nick);
  const platform = clampStr(req.body.platform, 20);
  const r = q(`INSERT INTO users(nick,email,pass,salt,created_at,is_admin,token,settings) VALUES(?,?,?,?,?,?,?,?)`)
    .run(nick, email, hashPass(password, salt), salt, now(), isAdmin, rnd(18), JSON.stringify({ page: settings.page, platform }));
  const uid = Number(r.lastInsertRowid);
  // реферальная ссылка: запоминаем, кто пригласил, и сразу даём новичку скидку по его промокоду
  const refOwner = userByNick(clampStr(req.body.ref, 24).replace(/^@/, ''));
  if (refOwner && refOwner.id !== uid) q('UPDATE users SET ref_by=?, promo_used=?, promo_spent=0 WHERE id=?').run(refOwner.id, refOwner.nick.toUpperCase(), uid);
  startSession(res, uid);
  if (!VERIFY_ON) { q('UPDATE users SET email_verified=1 WHERE id=?').run(uid); return res.json({ ok: true }); }
  try { await sendVerifyCode(userById(uid)); res.json({ ok: true, verify: true, email }); }
  catch (e) { console.error('Почта:', e.message); res.json({ ok: true, verify: true, email, mail_error: 'Не удалось отправить письмо, нажмите «Отправить код ещё раз»' }); }
});
app.post('/api/verify/resend', authAny, async (req, res) => {
  const u = req.user;
  if (!needsVerify(u)) return res.json({ ok: true, verified: true });
  const wait = 60e3 - (now() - (u.verify_sent_at || 0));
  if (wait > 0) return res.status(429).json({ error: `Подождите ${Math.ceil(wait / 1000)} сек. перед повторной отправкой` });
  if (limited('vres:' + u.id, 6, 3600e3)) return res.status(429).json({ error: 'Слишком много писем, попробуйте через час' });
  try { await sendVerifyCode(u); res.json({ ok: true, email: u.email }); }
  catch (e) { console.error('Почта:', e.message); res.status(502).json({ error: 'Не удалось отправить письмо, попробуйте позже' }); }
});
app.post('/api/verify', authAny, (req, res) => {
  const u = req.user;
  if (!needsVerify(u)) return res.json({ ok: true });
  if ((u.verify_tries || 0) >= 8) return res.status(429).json({ error: 'Слишком много попыток. Отправьте новый код' });
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (!u.verify_code || now() - (u.verify_sent_at || 0) > 30 * 60e3) return res.status(400).json({ error: 'Код устарел — отправьте новый' });
  if (code !== u.verify_code) { q('UPDATE users SET verify_tries=verify_tries+1 WHERE id=?').run(u.id); return res.status(400).json({ error: 'Неверный код' }); }
  q("UPDATE users SET email_verified=1, verify_code=NULL WHERE id=?").run(u.id);
  res.json({ ok: true });
});
app.post('/api/verify/change-email', authAny, async (req, res) => {
  const u = req.user; if (!needsVerify(u)) return res.json({ ok: true });
  const email = clampStr(req.body.email, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
  if (q('SELECT id FROM users WHERE email=? AND id!=?').get(email, u.id)) return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  if (!(await emailDomainOk(email))) return res.status(400).json({ error: 'Такой почты не существует — проверьте адрес' });
  q('UPDATE users SET email=?, verify_sent_at=0 WHERE id=?').run(email, u.id);
  try { await sendVerifyCode(userById(u.id)); res.json({ ok: true, email }); }
  catch (e) { console.error('Почта:', e.message); res.status(502).json({ error: 'Не удалось отправить письмо' }); }
});
app.post('/api/login', (req, res) => {
  if (limited('login:' + req.ip, 20, 600e3)) return res.status(429).json({ error: 'Слишком много попыток, подождите 10 минут' });
  const login = clampStr(req.body.email, 120);
  const u = q('SELECT * FROM users WHERE email=? OR nick=?').get(login.toLowerCase(), login);
  if (!u || hashPass(String(req.body.password || ''), u.salt) !== u.pass) return res.status(401).json({ error: 'Неверный email или пароль' });
  startSession(res, u.id);
  res.json({ ok: true, verify: needsVerify(u), email: u.email });
});
app.post('/api/logout', (req, res) => {
  const sid = readCookie(req, 'sid'); if (sid) q('DELETE FROM sessions WHERE id=?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true });
});
app.post('/api/password', auth, (req, res) => {
  const u = req.user;
  if (hashPass(String(req.body.old || ''), u.salt) !== u.pass) return res.status(400).json({ error: 'Текущий пароль неверный' });
  if (String(req.body.new || '').length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  const salt = rnd(16);
  q('UPDATE users SET pass=?, salt=? WHERE id=?').run(hashPass(req.body.new, salt), salt, u.id);
  res.json({ ok: true });
});

// --- профиль ---
app.get('/api/me', auth, (req, res) => {
  const u = req.user, s = getSettings(u), b = baseUrl(req);
  const stats = q(`SELECT COUNT(*) cnt, COALESCE(SUM(amount),0) total FROM donations WHERE user_id=? AND status='done' AND hidden=0`).get(u.id);
  const today = q(`SELECT COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, periodStart('day')).s;
  const month = q(`SELECT COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, periodStart('month')).s;
  const year = q(`SELECT COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, periodStart('year')).s;
  const tests = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND source='test'`).get(u.id);
  res.json({
    id: u.id, nick: u.nick, email: u.email, is_admin: !!u.is_admin, token: u.token,
    plan: publicPlan(u), plan_raw: u.plan, plan_until: u.plan_until, vip: u.paid_months >= 10, paid_months: u.paid_months,
    freeze_available: effectivePlan(u).freezeDays > 0 && now() - u.freeze_used_at > 30 * 864e5,
    storage: { used: storageUsed(u.id), limit: effectivePlan(u).storageMB * 1048576 },
    settings: s, themes: THEMES, goal_styles: GOAL_STYLES, goal_free: GOAL_FREE, goal_max: GOAL_MAX, voices: Object.keys(VOICES), plans: Object.values(PLANS).map(p => ({ ...p, media: p.media === Infinity ? -1 : p.media, ttHours: p.ttHours === Infinity ? -1 : p.ttHours })),
    stats: { ...stats, today, month, year, tests: tests.c, tests_sum: tests.s },
    urls: {
      page: `${b}/d/${u.nick}`, ingest: `${b}/api/ingest/${u.token}`,
      widgets: Object.fromEntries(['alerts', 'top', 'goal', 'roulette', 'media', 'info', 'timer', 'faceit', 'card', 'promo', 'mprice', 'tiktok', 'lastdon'].map(w => [w, `${b}/w/${w}.html?t=${u.token}`])),
    },
    pay: { kaspi: PAY_KASPI, name: PAY_NAME, telegram: PAY_TELEGRAM },
    referral: (() => { const L = q('SELECT nick, created_at, paid_months FROM users WHERE ref_by=? ORDER BY id DESC LIMIT 50').all(u.id); return { pct: REF_PCT, off: PROMO_OFF, earned: u.ref_earned || 0, count: q('SELECT COUNT(*) c FROM users WHERE ref_by=?').get(u.id).c, paid: L.filter(x => x.paid_months > 0).length, list: L.map(x => ({ nick: x.nick, at: x.created_at, paid: x.paid_months > 0 })) }; })(),
    balance: u.balance || 0, promo: { mine: u.nick.toUpperCase(), used: u.promo_used || '', active: !!u.promo_used && !u.promo_spent, discount: PROMO_OFF,
      activations: q(`SELECT COUNT(*) c FROM users WHERE promo_used=? COLLATE NOCASE`).get(u.nick.toUpperCase()).c },
  });
});
app.post('/api/token/reset', auth, (req, res) => { q('UPDATE users SET token=? WHERE id=?').run(rnd(18), req.user.id); res.json({ ok: true }); });

// --- сохранение настроек с учётом тарифа ---
app.put('/api/settings', auth, (req, res) => {
  const u = req.user, p = effectivePlan(u), s = getSettings(u), b = req.body || {};
  const errors = [];
  if (b.page) {
    const pg = b.page;
    s.page.title = clampStr(pg.title ?? s.page.title, 60);
    s.page.description = clampStr(pg.description ?? s.page.description, 500);
    s.page.kaspi = clampStr(pg.kaspi ?? s.page.kaspi, 40);
    s.page.receiver = clampStr(pg.receiver ?? s.page.receiver, 60);
    s.page.min_amount = int(pg.min_amount, 1, 1e6, s.page.min_amount);
    s.page.cards = clampStr(pg.cards ?? s.page.cards, 300);
    for (const k of ['avatar', 'banner', 'bg']) if (pg[k] !== undefined) s.page[k] = /^(\/u\/\d+\/[\w.-]+|\/pf\/\d+\/[\w.-]+|)$/.test(pg[k]) ? pg[k] : (s.page[k] || '');
    // личная страница: TikTok, доп. инфо, девайсы, расписание, карты, свои блоки, оформление
    if (pg.tiktok !== undefined) s.page.tiktok = clampStr(String(pg.tiktok).replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').replace(/^@/, '').split(/[/?#\s]/)[0], 40);
    if (pg.extra !== undefined) s.page.extra = clampStr(pg.extra, 500);
    if (pg.wall !== undefined) s.page.wall = !!pg.wall;
    if (pg.wall_msg !== undefined) s.page.wall_msg = !!pg.wall_msg;
    if (pg.wall_count !== undefined) s.page.wall_count = Math.max(3, Math.min(20, Math.round(+pg.wall_count) || 10));
    const DEV = ['cpu', 'gpu', 'ram', 'mb', 'storage', 'monitor', 'mouse', 'keyboard', 'headphones', 'mic', 'camera', 'pad'];
    if (pg.devices) {
      const dv = pg.devices, items = {};
      for (const k of DEV) if (dv.items && dv.items[k]) items[k] = clampStr(dv.items[k], 60);
      const custom = (Array.isArray(dv.custom) ? dv.custom : []).slice(0, 6).map(r => ({ k: clampStr(r && r.k, 30), v: clampStr(r && r.v, 60) })).filter(r => r.k && r.v);
      s.page.devices = { type: dv.type === 'laptop' ? 'laptop' : 'pc', items, custom };
    }
    if (pg.schedule) {
      const sc = pg.schedule, tm = x => /^\d{2}:\d{2}$/.test(x || '') ? x : '';
      s.page.schedule = { days: (Array.isArray(sc.days) ? sc.days : []).map(Number).filter(d => d >= 0 && d <= 6).filter((d, i, a) => a.indexOf(d) === i).sort(), start: tm(sc.start), end: tm(sc.end) };
    }
    if (Array.isArray(pg.cards2)) s.page.cards2 = pg.cards2.slice(0, 5).map(c => ({ bank: clampStr(c && c.bank, 30), number: clampStr(c && c.number, 40) })).filter(c => c.bank && c.number);
    if (pg.blocks) {
      const okUrl = u => /^https?:\/\/[^\s]+$/i.test(u || '');
      s.page.blocks = {
        texts: (pg.blocks.texts || []).slice(0, 5).map(t => ({ title: clampStr(t && t.title, 60), text: clampStr(t && t.text, 1000) })).filter(t => t.title || t.text),
        links: (pg.blocks.links || []).slice(0, 5).map(l => ({ title: clampStr(l && l.title, 60), items: ((l && l.items) || []).slice(0, 6).map(i => ({ label: clampStr(i && i.label, 40), url: clampStr(i && i.url, 300) })).filter(i => i.label && okUrl(i.url)) })).filter(l => l.items.length),
      };
    }
    const PAGE_DESIGNS = ['classic', 'hud', 'minimal', 'pastel', 'amethyst'], PAGE_FX = ['none', 'rain', 'snow', 'leaves', 'confetti', 'fireflies', 'stars'];
    if (pg.design !== undefined) { if (!PAGE_DESIGNS.includes(pg.design)) errors.push('Неизвестный дизайн'); else if (pg.design !== 'classic' && !p.shop) errors.push('Этот дизайн страницы — с тарифа Lite'); else s.page.design = pg.design; }
    if (pg.effect !== undefined) { if (!PAGE_FX.includes(pg.effect)) errors.push('Неизвестный эффект'); else if (pg.effect !== 'none' && !p.shop) errors.push('Эффекты на странице — с тарифа Lite'); else s.page.effect = pg.effect; }
    if (pg.effect_layer !== undefined) s.page.effect_layer = pg.effect_layer === 'under' ? 'under' : 'over';
    if (/^#[0-9a-f]{6}$/i.test(pg.color || '')) s.page.color = pg.color;
    if (pg.socials) {
      // ссылка принимается только с правильного домена — иначе иконка не появится
      const DOM = { youtube: /(youtube\.com|youtu\.be)$/, twitch: /twitch\.tv$/, telegram: /(t\.me|telegram\.me)$/, instagram: /instagram\.com$/, tiktok: /tiktok\.com$/, discord: /(discord\.gg|discord\.com)$/, donationalerts: /(donationalerts\.com|donationalerts\.ru|dalink\.to)$/ };
      s.page.socials = { ...{ twitch: '', youtube: '', tiktok: '', instagram: '', telegram: '', discord: '', donationalerts: '' }, ...(s.page.socials || {}) };
      for (const k of Object.keys(DOM)) if (pg.socials[k] !== undefined) {
        const v = clampStr(pg.socials[k], 200).trim();
        if (!v) { s.page.socials[k] = ''; continue; }
        const TPL = { youtube: 'https://www.youtube.com/@', twitch: 'https://www.twitch.tv/', telegram: 'https://t.me/', instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/@', discord: 'https://discord.gg/', donationalerts: 'https://www.donationalerts.com/r/' };
        const bare = v.replace(/^@/, ''), url = /^[\w.\-]{1,60}$/.test(bare) && !/\.(com|tv|me|gg|ru|be|to)$/i.test(bare) ? TPL[k] + bare : /^https?:\/\//i.test(v) ? v : 'https://' + v;
        let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { }
        if (DOM[k].test(host)) s.page.socials[k] = url; else errors.push(`Ссылка ${k}: нужен адрес ${String(DOM[k]).replace(/[\/\\$()]/g, '').replace(/\|/g, ' или ')}`);
      }
    }
  }
  if (b.alerts) {
    const a = b.alerts, A = s.alerts;
    A.duration = int(a.duration, 2, p.maxDuration, Math.min(A.duration, p.maxDuration));
    if (a.duration > p.maxDuration) errors.push(`Время показа на вашем тарифе — до ${p.maxDuration} сек`);
    for (const k of ['gif', 'sound']) if (a[k] !== undefined) A[k] = clampStr(a[k], 300);
    if (a.volume !== undefined) A.volume = Math.min(1, Math.max(0, +a.volume || 0));
    for (const k of ['min_alert', 'min_tts']) if (a[k] !== undefined) A[k] = int(a[k], 0, 1e7, 0);
    if (a.show_msg !== undefined) A.show_msg = !!a.show_msg;
    if (a.theme !== undefined) { if (!p.shop && a.theme !== 'default') errors.push('Магазин тем доступен с тарифа Lite'); else if (THEMES.includes(a.theme)) A.theme = a.theme; }
    if (a.tts !== undefined) A.tts = !!a.tts;
    if (a.tts_voice !== undefined) { if (!VOICES[a.tts_voice]) errors.push('Неизвестный голос'); else if (!p.tts && a.tts_voice !== 'dmitry') errors.push('Выбор голоса — с тарифа Lite'); else { A.tts_voice = a.tts_voice; A.tts_lang = VOICES[a.tts_voice][4]; } }
    if (a.tts_lang !== undefined && a.tts_voice === undefined) { if (!p.ttsAdvanced && a.tts_lang !== 'ru') errors.push('Выбор языка озвучки — тариф Pro'); else if (['ru', 'kk', 'en', 'tr', 'uk'].includes(a.tts_lang)) A.tts_lang = a.tts_lang; }
    if (a.tts_rate !== undefined) A.tts_rate = p.ttsAdvanced ? Math.min(2, Math.max(0.5, +a.tts_rate || 1)) : 1;
    if (a.card && typeof a.card === 'object') {
      const c = a.card, C = { ...(A.card || {}) }, col = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : null;
      if (c.img !== undefined) C.img = /^\/u\/\d+\/[\w.-]+$/.test(c.img || '') || /^\/pf\/\d+\/[\w.-]+$/.test(c.img || '') ? c.img : '';
      for (const k of ['bg', 'bg2', 'border', 'name', 'sum', 'text']) if (c[k] !== undefined && col(c[k])) C[k] = c[k];
      if (c.op !== undefined) C.op = Math.max(0, Math.min(1, +c.op || 0));
      if (c.grad !== undefined) C.grad = !!c.grad;
      if (c.font !== undefined && CARD_FONTS.includes(c.font)) C.font = c.font;
      if (c.radius !== undefined) C.radius = Math.max(0, Math.min(60, Math.round(+c.radius) || 0));
      if (c.pos !== undefined && ['center', 'top', 'bottom'].includes(c.pos)) C.pos = c.pos;
      A.card = C;
    }
    if (a.layout !== undefined) { if (!ALERT_LAYOUTS.includes(a.layout)) errors.push('Неизвестный стиль алерта'); else if (!p.shop && !ALERT_FREE.includes(a.layout)) errors.push('Этот стиль алерта доступен с тарифа Lite'); else A.layout = a.layout; }
    if (Array.isArray(a.pool)) {
      // каждое видео: { url, min } — «от скольки тенге» показывать
      const okUrl = x => /^\/u\/\d+\//.test(x) || /^\/alerts-lib\/[\w-]+\.mp4$/.test(x) || /^https?:\/\//.test(x);
      const pool = a.pool.map(x => typeof x === 'string' ? { url: x, min: 0 } : { url: clampStr(x && x.url, 300), min: int(x && x.min, 0, 1e7, 0) })
        .map(x => ({ ...x, url: clampStr(x.url, 300) })).filter(x => okUrl(x.url));
      if (!p.shop && pool.length > 1) errors.push('На Free — 1 видео-алерт, на Lite — до 30. Оставлен первый');
      A.pool = pool.slice(0, p.shop ? 30 : 1);
    }
    if (a.pool_min !== undefined) A.pool_min = int(a.pool_min, 0, 1e7, 0);
    if (Array.isArray(a.variations)) {
      if (!p.memes && a.variations.length) errors.push('Мем-алерты доступны на тарифе Pro');
      else A.variations = a.variations.slice(0, 30).map(v => ({ amount: int(v.amount, 1, 1e7, 0), gif: clampStr(v.gif, 300), sound: clampStr(v.sound, 300), text: clampStr(v.text, 80) })).filter(v => v.amount);
    }
  }
  if (b.censor) { s.censor.words = clampStr(b.censor.words, 3000); s.censor.strip_links = !!b.censor.strip_links; }
  if (b.nicks) {
    if (!p.nicks) errors.push('Ники донатерам — с тарифа Lite');
    else s.nicks = Object.fromEntries(Object.entries(b.nicks).slice(0, 200).map(([k, v]) => [clampStr(k, 60), clampStr(v, 32)]).filter(([k, v]) => k && v));
  }
  if (b.goal) {
    s.goal.title = clampStr(b.goal.title ?? s.goal.title, 80);
    if (b.goal.target !== undefined && (+b.goal.target > GOAL_MAX || +b.goal.target < 1)) errors.push('Цель — от 1 до 2 000 000 ₸');
    s.goal.target = int(b.goal.target, 1, GOAL_MAX, Math.min(GOAL_MAX, s.goal.target));
    s.goal.base = int(b.goal.base, 0, GOAL_MAX, s.goal.base);
    if (b.goal.style !== undefined) { if (!GOAL_STYLES.includes(b.goal.style)) errors.push('Неизвестный стиль цели'); else if (!p.shop && !GOAL_FREE.includes(b.goal.style)) errors.push('Этот стиль цели доступен с тарифа Lite'); else s.goal.style = b.goal.style; }
    if (b.goal.reset) s.goal.start_at = now();
    if (DREAMS.includes(b.goal.dream)) s.goal.dream = b.goal.dream;
    if (b.goal.theme && THEMES.includes(b.goal.theme)) s.goal.theme = p.shop ? b.goal.theme : 'default';
  }
  if (b.top) {
    if (['day', 'week', 'month', 'all'].includes(b.top.period)) s.top.period = b.top.period;
    s.top.count = int(b.top.count, 1, 10, s.top.count);
    if (b.top.theme && THEMES.includes(b.top.theme)) s.top.theme = p.shop ? b.top.theme : 'default';
    // конструктор ТОПа: дизайн и шрифт — с тарифа Lite, остальное бесплатно
    if (TOP_STYLES.includes(b.top.style)) { if (!p.shop && b.top.style !== 'classic') errors.push('Дизайны ТОПа доступны с тарифа Lite'); else s.top.style = b.top.style; }
    if (TOP_FONTS.includes(b.top.font)) { if (!p.shop && b.top.font !== 'manrope') errors.push('Шрифты ТОПа доступны с тарифа Lite'); else s.top.font = b.top.font; }
    if (b.top.title !== undefined) s.top.title = clampStr(b.top.title, 40);
    if (['sm', 'md', 'lg'].includes(b.top.size)) s.top.size = b.top.size;
    if (b.top.radius !== undefined) s.top.radius = int(b.top.radius, 0, 32, s.top.radius);
    if (b.top.opacity !== undefined) s.top.opacity = Math.min(1, Math.max(0.3, +b.top.opacity || 0.9));
    // свой фон (фото) и цвет строк
    if (b.top.bg !== undefined) { const v = clampStr(b.top.bg, 500); s.top.bg = /^(https?:\/\/|\/u\/)/.test(v) ? v : ''; }
    if (b.top.bgall !== undefined) s.top.bgall = !!b.top.bgall;
    if (b.top.row !== undefined) s.top.row = /^#[0-9a-f]{6}$/i.test(b.top.row) ? b.top.row : '';
    if (b.top.rowtx !== undefined) s.top.rowtx = /^#[0-9a-f]{6}$/i.test(b.top.rowtx) ? b.top.rowtx : '';
  }
  if (b.roulette) {
    if (!p.roulette && b.roulette.enabled) errors.push('Рулетка доступна с тарифа Lite');
    if (b.roulette.sound !== undefined) s.roulette.sound = !!b.roulette.sound;
    if (b.roulette.enabled !== undefined) s.roulette.enabled = p.roulette && !!b.roulette.enabled;
    s.roulette.min = int(b.roulette.min, 1, 1e7, s.roulette.min);
    if (['wheel', 'slots', 'cards', 'box', 'case'].includes(b.roulette.style)) s.roulette.style = b.roulette.style;
    if (Array.isArray(b.roulette.tasks)) s.roulette.tasks = b.roulette.tasks.map(t => clampStr(t, 60)).filter(Boolean).slice(0, 24);
  }
  if (b.media) {
    if (!p.media && b.media.enabled) errors.push('Заказ музыки/видео доступен с тарифа Lite');
    s.media.enabled = !!p.media && !!b.media.enabled;
    s.media.min = int(b.media.min, 1, 1e7, s.media.min);
    s.media.max_sec = int(b.media.max_sec, 10, 1200, s.media.max_sec);
    if (b.media.volume !== undefined) s.media.volume = Math.min(1, Math.max(0, +b.media.volume || 0));
  }
  if (b.info) {
    if (!p.info) errors.push('Info-виджет доступен с тарифа Lite');
    else { s.info.lines = (b.info.lines || []).map(l => clampStr(l, 300)).filter(Boolean).slice(0, 10); s.info.interval = int(b.info.interval, 3, 120, 8);
      if (b.info.theme && THEMES.includes(b.info.theme)) s.info.theme = b.info.theme;
      if (b.info.label !== undefined) s.info.label = clampStr(b.info.label, 20);
      if (['slow', 'normal', 'fast'].includes(b.info.speed)) s.info.speed = b.info.speed;
      if (['right', 'left'].includes(b.info.dir)) s.info.dir = b.info.dir;
      if (b.info.show_last !== undefined) s.info.show_last = !!b.info.show_last;
      if (['marquee', 'static'].includes(b.info.mode)) s.info.mode = b.info.mode;
      if (INFO_STYLES.includes(b.info.tstyle)) s.info.tstyle = b.info.tstyle;
      if (['left', 'center', 'right'].includes(b.info.align)) s.info.align = b.info.align;
      if (TOP_FONTS.includes(b.info.font)) s.info.font = b.info.font; }
  }
  if (b.cards) for (const k of ['kaspi', 'halyk', 'freedom', 'twitch', 'instagram', 'youtube', 'telegram', 'blackrussia']) if (b.cards[k]) {
    s.cards[k] = { value: clampStr(b.cards[k].value, 60), name: clampStr(b.cards[k].name, 40) };
    if (k === 'blackrussia') s.cards[k].promo = clampStr(b.cards[k].promo, 30);
  }
  if (b.faceit && b.faceit.show) {
    const F = s.faceit.show;
    for (const k of Object.keys(F)) if (b.faceit.show[k] !== undefined) F[k] = !!b.faceit.show[k];
  }
  if (b.timer) {
    if (!p.timer) errors.push('Таймер доступен с тарифа Lite');
    else { s.timer.sec_per_100 = int(b.timer.sec_per_100, 0, 3600, s.timer.sec_per_100); if (b.timer.theme && THEMES.includes(b.timer.theme)) s.timer.theme = b.timer.theme; }
  }
  if (b.hotkeys) {
    if (!p.hotkeys) errors.push('Хоткеи доступны на тарифе Pro');
    else s.hotkeys = b.hotkeys.slice(0, 30).map(h => ({ min: int(h.min, 1, 1e7, 0), max: int(h.max, 0, 1e9, 0), keys: clampStr(h.keys, 40) })).filter(h => h.min && h.keys);
  }
  if (b.webhooks) {
    if (!p.webhooks) errors.push('Вебхуки доступны на тарифе Pro');
    else s.webhooks = b.webhooks.map(w => clampStr(w, 300)).filter(w => /^https?:\/\//.test(w)).slice(0, 5);
  }
  saveSettings(u, s);
  emit(u.id, 'settings', widgetState(userById(u.id)).settings);
  pushStats(userById(u.id));
  res.json({ ok: true, settings: s, warnings: errors });
});

// --- файлы (гифки, звуки) ---
const MIME_OK = /^(image\/(gif|png|jpeg|webp)|audio\/(mpeg|mp3|wav|ogg|webm|x-wav|mp4|aac)|video\/(webm|mp4))$/;
app.post('/api/upload', auth, express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const u = req.user, mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!MIME_OK.test(mime)) return res.status(400).json({ error: 'Поддерживаются GIF/PNG/JPG/WEBP, MP3/WAV/OGG, MP4/WEBM' });
  const size = req.body?.length || 0;
  if (!size) return res.status(400).json({ error: 'Пустой файл' });
  const limit = effectivePlan(u).storageMB * 1048576 * (u.paid_months >= 10 ? 1.5 : 1);
  if (storageUsed(u.id) + size > limit) return res.status(413).json({ error: `Не хватает места в хранилище (${effectivePlan(u).storageMB} МБ на вашем тарифе)` });
  const ext = mime.split('/')[1].replace('mpeg', 'mp3').replace('x-wav', 'wav').replace('jpeg', 'jpg');
  if (size > 8 * 1048576) return res.status(413).json({ error: 'Файл больше 8 МБ — сожмите гифку или звук' });
  const file = `${rnd(9)}.${ext}`;
  q('INSERT INTO file_data(file,data) VALUES(?,?)').run(`${u.id}/${file}`, req.body);
  const name = clampStr(decodeURIComponent(req.headers['x-filename'] || file), 100);
  const r = q('INSERT INTO files(user_id,name,mime,size,file,created_at) VALUES(?,?,?,?,?,?)').run(u.id, name, mime, size, `${u.id}/${file}`, now());
  res.json({ ok: true, id: Number(r.lastInsertRowid), url: `/u/${u.id}/${file}` });
});
// файлы личной страницы (аватарка, баннер, фон) — отдельно от «Хранилища» и не занимают место
app.post('/api/page/upload', auth, express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const u = req.user, mime = String(req.headers['content-type'] || '').split(';')[0], kind = String(req.query.kind || '');
  if (!['avatar', 'banner', 'bg'].includes(kind)) return res.status(400).json({ error: 'Неизвестный тип' });
  if (!/^image\/(gif|png|jpeg|webp)$/.test(mime)) return res.status(400).json({ error: 'Только картинки: JPG, PNG, GIF, WEBP' });
  const size = req.body?.length || 0;
  if (!size) return res.status(400).json({ error: 'Пустой файл' });
  if (size > 8 * 1048576) return res.status(413).json({ error: 'Картинка больше 8 МБ — сожмите её' });
  for (const old of q('SELECT file FROM page_files WHERE user_id=? AND kind=?').all(u.id, kind)) { q('DELETE FROM file_data WHERE file=?').run('pf:' + old.file); q('DELETE FROM page_files WHERE file=?').run(old.file); }
  const file = `${u.id}/${kind}-${rnd(8)}.${mime.split('/')[1].replace('jpeg', 'jpg')}`;
  q('INSERT INTO file_data(file,data) VALUES(?,?)').run('pf:' + file, req.body);
  q('INSERT INTO page_files(file,user_id,kind,mime,created_at) VALUES(?,?,?,?,?)').run(file, u.id, kind, mime, now());
  res.json({ ok: true, url: '/pf/' + file });
});
app.get('/pf/:uid/:file', async (req, res) => {
  const key = `${req.params.uid}/${req.params.file}`;
  const f = q('SELECT mime FROM page_files WHERE file=?').get(key);
  let d = f && q('SELECT data FROM file_data WHERE file=?').get('pf:' + key);
  if (f && !d && remote) { try { const r = await remote.execute({ sql: 'SELECT data FROM file_data WHERE file=?', args: ['pf:' + key] }); const v = r.rows[0]?.data; if (v) d = { data: Buffer.from(v) }; } catch { } }
  if (!d) return res.status(404).end();
  res.set({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=604800' }).send(Buffer.from(d.data));
});
// обзор на главной кабинета: суммы за периоды, график дохода, последние донаты, топ месяца
app.get('/api/overview', auth, (req, res) => {
  const u = req.user, s = getSettings(u), T = Date.now(), tz = 5 * 3600e3; // время Казахстана
  const dayStart = Math.floor((T + tz) / 864e5) * 864e5 - tz;
  const d0 = new Date(T + tz), monthStart = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) - tz, prevMonthStart = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, 1) - tz;
  const sum = (from, to = T + 1) => q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=? AND done_at<?`).get(u.id, from, to);
  const cards = { today: sum(dayStart), week: sum(dayStart - 6 * 864e5), month: sum(monthStart), prev: sum(prevMonthStart, monthStart), all: sum(0) };
  const range = ['today', '7d', '30d', 'year'].includes(req.query.range) ? req.query.range : 'today';
  const rows = q(`SELECT amount, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).all(u.id, range === 'today' ? dayStart : range === '7d' ? dayStart - 6 * 864e5 : range === '30d' ? dayStart - 29 * 864e5 : Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 11, 1) - tz);
  let series = [];
  if (range === 'today') { series = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + ':00', sum: 0, cnt: 0 })); for (const r of rows) { const b = series[Math.floor((r.done_at - dayStart) / 3600e3)]; if (b) { b.sum += r.amount; b.cnt++; } } }
  else if (range === 'year') { series = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 11 + i, 1)); return { label: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getUTCMonth()], y: d.getUTCFullYear(), m: d.getUTCMonth(), sum: 0, cnt: 0 }; }); for (const r of rows) { const d = new Date(r.done_at + tz), b = series.find(x => x.y === d.getUTCFullYear() && x.m === d.getUTCMonth()); if (b) { b.sum += r.amount; b.cnt++; } } }
  else { const n = range === '7d' ? 7 : 30; series = Array.from({ length: n }, (_, i) => { const d = new Date(dayStart + tz - (n - 1 - i) * 864e5); return { label: String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0'), sum: 0, cnt: 0 }; }); for (const r of rows) { const b = series[n - 1 - Math.floor((dayStart + 864e5 - 1 - r.done_at) / 864e5)]; if (b) { b.sum += r.amount; b.cnt++; } } }
  const recent = q(`SELECT name, amount, message, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 ORDER BY done_at DESC LIMIT 6`).all(u.id);
  const top = q(`SELECT name, SUM(amount) total FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=? GROUP BY lower(name) ORDER BY total DESC LIMIT 5`).all(u.id, monthStart);
  const seen = APP_SEEN.get(u.id), alive = !!(seen && now() - seen.t < 50e3);
  const lastIn = q('SELECT MAX(created_at) t FROM ingest_log WHERE user_id=?').get(u.id).t || 0;
  res.json({ app: { windows: alive && seen.running, windows_idle: alive && !seen.running, last_ingest: lastIn }, cards, range, series: series.map(({ label, sum, cnt }) => ({ label, sum, cnt })), recent, top, since: u.created_at, avatar: s.page.avatar || '', title: s.page.title || u.nick });
});
app.get('/api/files', auth, (req, res) => res.json(q('SELECT id,name,mime,size,file,created_at FROM files WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(f => ({ ...f, url: '/u/' + f.file }))));
app.delete('/api/files/:id', auth, (req, res) => {
  const f = q('SELECT * FROM files WHERE id=? AND user_id=?').get(+req.params.id, req.user.id);
  if (f) { q('DELETE FROM file_data WHERE file=?').run(f.file); q('DELETE FROM files WHERE id=?').run(f.id); }
  res.json({ ok: true });
});
app.get('/u/:uid/:file', async (req, res) => {
  const key = `${req.params.uid}/${req.params.file}`;
  const f = q('SELECT mime FROM files WHERE file=?').get(key);
  let d = f && q('SELECT data FROM file_data WHERE file=?').get(key);
  if (f && !d && remote) {
    try {
      const r = await remote.execute({ sql: 'SELECT data FROM file_data WHERE file=?', args: [key] });
      const v = r.rows[0]?.data;
      if (v) { d = { data: v instanceof ArrayBuffer ? Buffer.from(v) : Buffer.from(v) }; db.prepare('INSERT OR REPLACE INTO file_data(file,data) VALUES(?,?)').run(key, d.data); }
    } catch (e) { console.error('Turso: файл', key, e.message); }
  }
  if (!d) return res.status(404).end();
  res.set({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=604800' }).send(Buffer.from(d.data));
});

// --- донаты в кабинете ---
// переименовать донатера: меняется имя во всех его донатах (ТОП объединяется под новым именем)
app.post('/api/donations/rename', auth, (req, res) => {
  const u = req.user, d = q('SELECT * FROM donations WHERE id=? AND user_id=?').get(+req.body.id, u.id);
  if (!d) return res.status(404).json({ error: 'Донат не найден' });
  const old = d.name || '', nn = clampStr(String(req.body.name || '').replace(/\s+/g, ' ').trim(), 32);
  const rows = q('SELECT id, name, orig_name FROM donations WHERE user_id=? AND lower(name)=lower(?)').all(u.id, old);
  let n = 0;
  for (const r of rows) {
    const orig = r.orig_name || r.name;
    const target = nn || orig; // пустое имя — вернуть исходное
    q('UPDATE donations SET name=?, orig_name=? WHERE id=?').run(target, target === orig ? '' : orig, r.id); n++;
  }
  pushStats(u);
  res.json({ ok: true, updated: n, name: nn || (d.orig_name || d.name) });
});
app.get('/api/donations', auth, (req, res) => {
  const lim = int(req.query.limit, 1, 500, 100);
  res.json(q(`SELECT id,name,orig_name,sender,amount,message,media_url,voice_url,source,status,created_at,done_at FROM donations WHERE user_id=? AND hidden=0 ORDER BY COALESCE(done_at,created_at) DESC LIMIT ?`).all(req.user.id, lim));
});
app.post('/api/donations/test', auth, (req, res) => {
  const u = req.user;
  const r = q(`INSERT INTO donations(user_id,name,amount,message,media_url,source,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(u.id, clampStr(req.body.name || 'Тестовый донатер', 32), int(req.body.amount, 1, 1e7, 1000), clampStr(req.body.message ?? 'Это тестовый донат от KZStream!', 300), clampStr(req.body.media_url, 300), 'test', 'pending', now());
  const d = q('SELECT * FROM donations WHERE id=?').get(Number(r.lastInsertRowid));
  res.json({ ok: true, event: finalizeDonation(u, d, { voice: req.body.voice }) });
});
// сброс статистики: удаляются ТОЛЬКО тестовые донаты, настоящие (из Kaspi) не трогаются
app.post('/api/donations/reset-tests', auth, (req, res) => {
  const u = req.user;
  const r = q(`DELETE FROM donations WHERE user_id=? AND source='test'`).run(u.id);
  pushStats(u);
  res.json({ ok: true, deleted: Number(r.changes || 0) });
});
app.post('/api/test/roulette', auth, (req, res) => {
  const u = req.user, s = getSettings(u);
  if (!effectivePlan(u).roulette) return res.status(403).json({ error: 'Рулетка доступна с тарифа Lite' });
  if (!s.roulette.tasks.length) return res.status(400).json({ error: 'Добавьте задания' });
  const idx = crypto.randomInt(s.roulette.tasks.length);
  emit(u.id, 'roulette', { index: idx, task: s.roulette.tasks[idx], tasks: s.roulette.tasks, style: s.roulette.style, name: 'Тест', amount: s.roulette.min, test: true, sound: s.roulette.sound === true });
  res.json({ ok: true, task: s.roulette.tasks[idx] });
});
app.post('/api/test/media', auth, (req, res) => {
  const u = req.user; if (!effectivePlan(u).media) return res.status(403).json({ error: 'Музыка и видео доступны с тарифа Lite' });
  const url = clampStr(req.body.url, 300); if (!ytId(url)) return res.status(400).json({ error: 'Вставьте ссылку YouTube' });
  q(`INSERT INTO donations(user_id,name,amount,message,media_url,source,status,media_status,created_at,done_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(u.id, 'Алибек Т.', 1000, '', url, 'test', 'test', 'queued', now(), now());
  pushStats(u); res.json({ ok: true });
});
app.post('/api/donations/manual', auth, (req, res) => { // ручное подтверждение ожидающего доната
  const u = req.user; const d = q(`SELECT * FROM donations WHERE id=? AND user_id=? AND status='pending'`).get(+req.body.id, u.id);
  if (!d) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true, event: finalizeDonation(u, d) });
});
app.post('/api/donations/:id/replay', auth, (req, res) => {
  const u = req.user; const d = q(`SELECT * FROM donations WHERE id=? AND user_id=? AND status='done'`).get(+req.params.id, u.id);
  if (!d) return res.status(404).json({ error: 'Не найден' });
  const p = effectivePlan(u), s = getSettings(u);
  emit(u.id, 'donation', { id: d.id, name: d.name, amount: d.amount, message: s.alerts.show_msg ? d.message : '', voice_url: p.voice ? d.voice_url : '', variation: p.memes ? (s.alerts.variations || []).find(v => +v.amount === d.amount) || null : null, roulette: null, tts: p.tts && s.alerts.tts, show: true, at: now() });
  res.json({ ok: true });
});
app.delete('/api/donations/:id', auth, (req, res) => { q('UPDATE donations SET hidden=1 WHERE id=? AND user_id=?').run(+req.params.id, req.user.id); pushStats(req.user); res.json({ ok: true }); });
app.post('/api/alerts/skip', auth, (req, res) => { emit(req.user.id, 'skip', {}); res.json({ ok: true }); });
// пропустить текущее (или конкретное видео по id) — оно удаляется из очереди, плеер включает следующее
app.post('/api/media/skip', auth, (req, res) => {
  const list = mediaQueue(req.user);
  const cur = req.body?.id ? list.find(m => m.id === +req.body.id) : list[0];
  if (cur) q(`UPDATE donations SET media_status='skipped' WHERE id=? AND user_id=?`).run(cur.id, req.user.id);
  emit(req.user.id, 'media_skip', { id: cur?.id }); pushStats(req.user); res.json({ ok: true, skipped: cur?.id || null });
});
app.post('/api/timer', auth, (req, res) => {
  const u = req.user; if (!effectivePlan(u).timer) return res.status(403).json({ error: 'Таймер доступен с тарифа Lite' });
  const s = getSettings(u), t = s.timer, a = req.body.action;
  const left = t.running ? Math.max(0, t.end_at - now()) : t.paused_left;
  if (a === 'start') { t.end_at = now() + left; t.running = true; }
  else if (a === 'pause') { t.paused_left = left; t.running = false; }
  else if (a === 'add') { const ms = int(req.body.minutes, -6000, 6000, 0) * 60000; if (t.running) t.end_at += ms; else t.paused_left = Math.max(0, left + ms); }
  else if (a === 'set') { const ms = int(req.body.minutes, 0, 60000, 60) * 60000; t.paused_left = ms; t.end_at = now() + ms; }
  saveSettings(u, s); pushStats(u); res.json({ ok: true, timer: timerState(s) });
});

// --- тарифы и оплата ---
const PROMO_OFF = 20; // скидка по промокоду, %
// цена тарифа с учётом активного промокода (скидка действует на одну оплату тарифа)
function planPrice(u, plan, months) { const full = plan.price * months; const promo = u.promo_used && !u.promo_spent ? u.promo_used : '';
  return { full, sum: promo ? Math.round(full * (100 - PROMO_OFF) / 100) : full, promo }; }
// публичная статистика для главной: стримеры и настоящие донаты (без тестовых)
let PUB_STATS = null, PUB_AT = 0;
app.get('/api/stats/public', (req, res) => {
  if (!PUB_STATS || Date.now() - PUB_AT > 60000) {
    const u = q(`SELECT COUNT(*) c FROM users`).get().c;
    const d = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE status='done' AND source<>'test'`).get();
    PUB_STATS = { streamers: u, donations: d.c, sum: d.s }; PUB_AT = Date.now();
  }
  res.set('Cache-Control', 'public, max-age=60').json(PUB_STATS);
});
app.post('/api/pay', auth, (req, res) => {
  const pending = q(`SELECT id FROM payments WHERE user_id=? AND status='pending'`).get(req.user.id);
  if (pending) return res.status(409).json({ error: 'У вас уже есть заявка на проверке' });
  if (req.body.kind === 'balance') { // пополнение баланса
    const amount = int(req.body.amount, 500, 1000000, 0); if (!amount) return res.status(400).json({ error: 'Сумма от 500 до 1 000 000 ₸' });
    q(`INSERT INTO payments(user_id,plan,months,amount,created_at,comment,kind) VALUES(?,?,?,?,?,?,?)`).run(req.user.id, 'balance', 0, amount, now(), clampStr(req.body.comment, 200), 'balance');
    return res.json({ ok: true });
  }
  const plan = PLANS[req.body.plan]; const months = int(req.body.months, 1, 12, 1);
  if (!plan || plan.id === 'free') return res.status(400).json({ error: 'Выберите тариф' });
  const pr = planPrice(req.user, plan, months);
  q('INSERT INTO payments(user_id,plan,months,amount,created_at,comment,kind,promo) VALUES(?,?,?,?,?,?,?,?)').run(req.user.id, plan.id, months, pr.sum, now(), clampStr(req.body.comment, 200), 'plan', pr.promo);
  res.json({ ok: true });
});
// оплата тарифа с баланса — сразу, без проверки
app.post('/api/pay/balance', auth, (req, res) => {
  const u = req.user, plan = PLANS[req.body.plan], months = int(req.body.months, 1, 12, 1);
  if (!plan || plan.id === 'free') return res.status(400).json({ error: 'Выберите тариф' });
  const pr = planPrice(u, plan, months);
  if ((u.balance || 0) < pr.sum) return res.status(402).json({ error: `Не хватает ${pr.sum - (u.balance || 0)} ₸ на балансе` });
  q('UPDATE users SET balance=balance-? WHERE id=?').run(pr.sum, u.id);
  q(`INSERT INTO payments(user_id,plan,months,amount,created_at,comment,kind,promo,status) VALUES(?,?,?,?,?,?,?,?,?)`).run(u.id, plan.id, months, pr.sum, now(), 'с баланса', 'plan', pr.promo, 'approved');
  applyPlanPayment(u.id, plan.id, months, pr.promo); refBonus(u.id, pr.sum);
  res.json({ ok: true, balance: userById(u.id).balance });
});
// активация чужого промокода (ник другого стримера)
app.post('/api/promo', auth, (req, res) => {
  const u = req.user, code = String(req.body.code || '').trim().replace(/^@/, '');
  if (u.promo_used) return res.status(409).json({ error: 'Промокод уже активирован: ' + u.promo_used });
  const owner = userByNick(code);
  if (!owner) return res.status(404).json({ error: 'Такого промокода нет' });
  if (owner.id === u.id) return res.status(400).json({ error: 'Свой промокод активировать нельзя' });
  q('UPDATE users SET promo_used=?, promo_spent=0 WHERE id=?').run(owner.nick.toUpperCase(), u.id);
  res.json({ ok: true, code: owner.nick.toUpperCase(), discount: PROMO_OFF });
});
app.get('/api/payments', auth, (req, res) => res.json(q('SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20').all(req.user.id)));
app.post('/api/freeze', auth, (req, res) => {
  const u = req.user, p = effectivePlan(u);
  if (!p.freezeDays) return res.status(403).json({ error: 'Заморозка доступна на платных тарифах' });
  if (now() - u.freeze_used_at < 30 * 864e5) return res.status(409).json({ error: 'Заморозку можно использовать раз в 30 дней' });
  q('UPDATE users SET plan_until=plan_until+?, freeze_used_at=? WHERE id=?').run(p.freezeDays * 864e5, now(), u.id);
  res.json({ ok: true, days: p.freezeDays });
});

// --- админка ---
app.get('/api/admin/overview', admin, (req, res) => {
  res.json({
    users: q(`SELECT u.id,u.nick,u.email,u.plan,u.plan_until,u.paid_months,u.created_at,u.is_admin,u.balance,u.promo_used,u.badges,
      (SELECT COUNT(*) FROM donations d WHERE d.user_id=u.id AND d.status='done') dons,
      (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.user_id=u.id AND d.status='done') total FROM users u ORDER BY u.id DESC LIMIT 500`).all(),
    payments: q(`SELECT p.*, u.nick, u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY (p.status='pending') DESC, p.id DESC LIMIT 200`).all(),
    totals: q(`SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM donations WHERE status='done') dons, (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='approved' AND comment<>'с баланса') revenue`).get(),
  });
});
function grantPlan(uid, plan, days) {
  const u = userById(uid);
  const from = (u.plan === plan && u.plan_until > now()) ? u.plan_until : now();
  q('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(plan, from + days * 864e5, uid);
}
// реферальный бонус: пригласивший получает REF_PCT% от каждой оплаты тарифа приглашённым
const REF_PCT = 10;
function refBonus(uid, amount) {
  const u = userById(uid); if (!u || !u.ref_by || !(amount > 0)) return;
  const b = Math.floor(amount * REF_PCT / 100); if (!b) return;
  q('UPDATE users SET balance=balance+?, ref_earned=ref_earned+? WHERE id=?').run(b, b, u.ref_by);
}
function applyPlanPayment(uid, plan, months, promo) {
  grantPlan(uid, plan, 30 * months);
  q('UPDATE users SET paid_months=paid_months+? WHERE id=?').run(months, uid);
  if (promo) q('UPDATE users SET promo_spent=1 WHERE id=?').run(uid);
  const u = userById(uid);
  if (u.paid_months >= 10 && !u.vip_bonus) { grantPlan(u.id, 'pro', 10); q('UPDATE users SET vip_bonus=1 WHERE id=?').run(u.id); }
}
app.post('/api/admin/payments/:id', admin, (req, res) => {
  const p = q(`SELECT * FROM payments WHERE id=? AND status='pending'`).get(+req.params.id);
  if (!p) return res.status(404).json({ error: 'Заявка не найдена' });
  if (req.body.action === 'approve') {
    if (p.kind === 'balance') q('UPDATE users SET balance=balance+? WHERE id=?').run(p.amount, p.user_id);
    else { applyPlanPayment(p.user_id, p.plan, p.months, p.promo); refBonus(p.user_id, p.amount); }
    q(`UPDATE payments SET status='approved' WHERE id=?`).run(p.id);
  } else q(`UPDATE payments SET status='rejected' WHERE id=?`).run(p.id);
  res.json({ ok: true });
});
// админ: выдать пользователю новый пароль (старый узнать нельзя — хранится только хеш)
app.post('/api/admin/users/:id/password', admin, (req, res) => {
  const u = userById(+req.params.id); if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const pw = String(req.body.password || '').trim() || Array.from(crypto.randomBytes(8), b => 'abcdefghkmnpqrstuvwxyz23456789'[b % 30]).join('');
  if (pw.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const salt = rnd(16);
  q('UPDATE users SET pass=?, salt=? WHERE id=?').run(hashPass(pw, salt), salt, u.id);
  q('DELETE FROM sessions WHERE user_id=?').run(u.id); // выходим со всех устройств
  res.json({ ok: true, password: pw, nick: u.nick, email: u.email });
});
app.post('/api/admin/users/:id', admin, (req, res) => {
  const u = userById(+req.params.id); if (!u) return res.status(404).json({ error: 'Нет пользователя' });
  if (req.body.plan === 'free') q(`UPDATE users SET plan='free', plan_until=0 WHERE id=?`).run(u.id);
  else if (PLANS[req.body.plan]) grantPlan(u.id, req.body.plan, int(req.body.days, 1, 3650, 30));
  if (req.body.balance_add) q('UPDATE users SET balance=MAX(0, balance+?) WHERE id=?').run(int(req.body.balance_add, -1e7, 1e7, 0), u.id);
  if (Array.isArray(req.body.badges)) q('UPDATE users SET badges=? WHERE id=?').run(req.body.badges.filter(b => BADGES[b]).join(','), u.id);
  if (req.body.is_admin !== undefined) q('UPDATE users SET is_admin=? WHERE id=?').run(req.body.is_admin ? 1 : 0, u.id);
  res.json({ ok: true });
});

// --- публичная страница доната ---
// галочки, которые выдаёт администратор (видны всем на странице стримера)
const BADGES = { partner: ['🤝', 'Партнёр KZStream', '#2f8cff'], verified: ['✔', 'Проверенный стример', '#2bd67b'], team: ['⭐', 'Команда KZStream', '#ff3b5c'], top: ['👑', 'Топ-стример', '#ffc531'] };
const userBadges = u => String(u.badges || '').split(',').filter(b => BADGES[b]).map(b => ({ id: b, icon: BADGES[b][0], name: BADGES[b][1], color: BADGES[b][2] }));
app.get('/api/badges', (req, res) => res.json(Object.entries(BADGES).map(([id, [icon, name, color]]) => ({ id, icon, name, color }))));
app.get('/api/page/:nick', (req, res) => {
  const u = userByNick(req.params.nick); if (!u) return res.status(404).json({ error: 'Стример не найден' });
  const s = getSettings(u), p = effectivePlan(u);
  res.json({ nick: u.nick, page: s.page, ads: p.ads, badges: userBadges(u),
    goal: { title: s.goal.title, sum: goalSum(u, s), target: s.goal.target },
    top: topList(u, { ...s, top: { period: 'month', count: 5 } }),
    media: s.media.enabled ? { min: s.media.min } : null, roulette: s.roulette.enabled ? { min: s.roulette.min } : null,
    tts: p.tts && s.alerts.tts ? { min: s.alerts.min_tts || 0 } : null,
    // стена донатов — только если стример включил её сам
    wall: s.page.wall ? q(`SELECT name, amount, message, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND source!='test' ORDER BY done_at DESC LIMIT ?`).all(u.id, s.page.wall_count || 10)
      .map(d => ({ name: d.name, amount: d.amount, at: d.done_at, message: s.page.wall_msg === false ? '' : censor(String(d.message || '').replace(/https?:\/\/\S+/g, '🎵').slice(0, 160), s) })) : null });
});
app.get('/api/donate/status/:id', (req, res) => {
  const d = q('SELECT status FROM donations WHERE id=?').get(+req.params.id);
  res.json({ status: d?.status || 'unknown' });
});

// --- вход из приложений (Android / Windows): email + пароль -> ссылка подключения ---
app.post('/api/app/login', (req, res) => {
  if (limited('applogin:' + req.ip, 20, 600e3)) return res.status(429).json({ error: 'Слишком много попыток, подождите 10 минут' });
  const login = clampStr(req.body.email, 120);
  const u = q('SELECT * FROM users WHERE email=? OR nick=?').get(login.toLowerCase(), login);
  if (!u || hashPass(String(req.body.password || ''), u.salt) !== u.pass) return res.status(401).json({ error: 'Неверный email или пароль' });
  if (needsVerify(u)) return res.status(403).json({ error: 'Сначала подтвердите email: войдите на сайте и введите код из письма' });
  const b = baseUrl(req);
  res.json({ ok: true, nick: u.nick, token: u.token, ingest: `${b}/api/ingest/${u.token}`, plan: effectivePlan(u).name,
    widgets: { alerts: `${b}/w/alerts.html?t=${u.token}` } });
});
// команды из программы для Windows: пропустить озвучку / весь алерт / видео
app.post('/api/app/:token/skip', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Сессия устарела' });
  const what = req.body?.what;
  if (what === 'media') {
    const cur = mediaQueue(u)[0];
    if (cur) q(`UPDATE donations SET media_status='skipped' WHERE id=? AND user_id=?`).run(cur.id, u.id);
    emit(u.id, 'media_skip', { id: cur?.id }); pushStats(u); return res.json({ ok: true, skipped: !!cur });
  }
  emit(u.id, 'skip', { all: what === 'alert' }); res.json({ ok: true });
});
// диагностика iPhone-Bluetooth из программы для Windows: последние шаги подключения у каждого стримера (видно в админке)
const DIAG = new Map();
// программа для Windows шлёт «я работаю» каждые 15 сек; нет сигнала 50 сек — значит закрыта
const APP_SEEN = new Map();
app.post('/api/app/ping/:token', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'нет' });
  if (req.body && req.body.closing) APP_SEEN.delete(u.id); else APP_SEEN.set(u.id, { t: now(), running: !!(req.body && req.body.running), v: String((req.body || {}).version || '').slice(0, 12) });
  res.json({ ok: true });
});
app.post('/api/app/diag/:token', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'нет' });
  const L = DIAG.get(u.id) || [], b = req.body || {};
  for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 50)) {
    const row = { t: now(), m: String(l).slice(0, 400), v: String(b.version || '').slice(0, 12), os: String(b.os || '').slice(0, 60) };
    L.push(row); q('INSERT INTO bt_diag(user_id,t,m,v) VALUES(?,?,?,?)').run(u.id, row.t, row.m, row.v + ' · ' + row.os);
  }
  DIAG.set(u.id, L.slice(-300));
  q('DELETE FROM bt_diag WHERE user_id=? AND id NOT IN (SELECT id FROM bt_diag WHERE user_id=? ORDER BY id DESC LIMIT 400)').run(u.id, u.id);
  res.json({ ok: true });
});
// журнал подключения iPhone — стример видит свой, админ видит всех (переживает перезапуск сайта)
app.get('/api/my/btlog', auth, (req, res) => res.json({ lines: q('SELECT t, m, v FROM bt_diag WHERE user_id=? ORDER BY id DESC LIMIT 150').all(req.user.id).reverse() }));
// ежедневная резервная копия базы: шифруется открытым ключом (server/backup-public.pem) —
// открыть копию можно только закрытым ключом, который хранится у владельца. Забирает GitHub Actions.
let lastBackup = 0;
app.get('/api/backup', (req, res) => {
  if (now() - lastBackup < 20 * 60e3) return res.status(429).json({ error: 'не чаще раза в 20 минут' });
  lastBackup = now();
  const out = { at: now(), tables: {} };
  for (const t of TABLES) {
    try { out.tables[t] = t === 'file_data' ? q(`SELECT file, length(data) size FROM file_data`).all() : q(`SELECT * FROM ${t}`).all(); } catch (e) { out.tables[t] = { error: e.message }; }
  }
  const zlib = require('zlib'), pub = fs.readFileSync(path.join(__dirname, 'backup-public.pem'));
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(out)))), c.final()]);
  const ek = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  const len = Buffer.alloc(2); len.writeUInt16BE(ek.length);
  res.set('Content-Type', 'application/octet-stream').send(Buffer.concat([Buffer.from('KZB1'), len, ek, iv, c.getAuthTag(), enc]));
});
app.get('/api/admin/diag', admin, (req, res) => {
  const rows = q('SELECT user_id, t, m, v FROM bt_diag ORDER BY id DESC LIMIT 2000').all(), by = new Map();
  for (const r of rows) { if (!by.has(r.user_id)) by.set(r.user_id, []); by.get(r.user_id).push({ t: r.t, m: r.m, v: r.v }); }
  if (by.size) return res.json([...by.entries()].map(([id, L]) => ({ nick: (userById(id) || {}).nick || id, last: L[0].t, lines: L.slice(0, 120).reverse() })));
  const out = [...DIAG.entries()].map(([id, L]) => ({ nick: (userById(id) || {}).nick || id, last: L.length ? L[L.length - 1].t : 0, lines: L.slice(-80) }));
  res.json(out.sort((a, b) => b.last - a.last));
});
app.get('/api/app/me/:token', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Сессия устарела, войдите снова' });
  const s = getSettings(u);
  const since = Math.max(0, +req.query.since || 0);
  const topSince = from => q(`SELECT name, SUM(amount) total, COUNT(*) cnt FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?
    GROUP BY lower(name) ORDER BY total DESC LIMIT 100`).all(u.id, from);
  const today = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, periodStart('day'));
  const b = baseUrl(req);
  res.json({ nick: u.nick, plan: effectivePlan(u).name, today: today.s, today_count: today.c, hotkeys: effectivePlan(u).hotkeys ? s.hotkeys : [],
    top_month: topSince(periodStart('month')).slice(0, 5), top_stream: since ? topSince(since) : [],
    hotkeys_allowed: !!effectivePlan(u).hotkeys, page: `${b}/d/${encodeURIComponent(u.nick)}`, ingest: `${b}/api/ingest/${u.token}`,
    widgets: Object.fromEntries(['alerts', 'top', 'goal', 'roulette', 'media', 'info', 'timer', 'faceit', 'card'].map(w => [w, `${b}/w/${w}.html?t=${u.token}`])),
    last: q(`SELECT name, amount, message, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 ORDER BY done_at DESC LIMIT 10`).all(u.id) });
});

// ---------- FACEIT CS2 ----------
const faceit = require('./lib/faceit');
// История матчей без ключа: сервер запоминает ELO; рост ELO = победа (W), падение = поражение (L)
function trackElo(d) {
  const nick = d.nick.toLowerCase(), last = q('SELECT elo FROM faceit_track WHERE nick=? ORDER BY at DESC LIMIT 1').get(nick);
  if (!last || last.elo !== d.elo) q('INSERT OR IGNORE INTO faceit_track(nick, at, elo) VALUES(?,?,?)').run(nick, now(), d.elo);
}
function withTrack(d) {
  if (!d) return d;
  try { trackElo(d); } catch { }
  const pts = q('SELECT at, elo FROM faceit_track WHERE nick=? ORDER BY at DESC LIMIT 60').all(d.nick.toLowerCase());
  const games = []; for (let i = 0; i < pts.length - 1; i++) { const diff = pts[i].elo - pts[i + 1].elo; if (diff) games.push({ at: pts[i].at, diff }); }
  const day = periodStart('day'), today = games.filter(g => g.at >= day);
  const out = { ...d, today_w: today.filter(g => g.diff > 0).length, today_l: today.filter(g => g.diff < 0).length, today_elo: today.reduce((s, g) => s + g.diff, 0), tracked: games.length };
  if (!(d.last || []).length && games.length) out.last = games.slice(0, 5).map(g => g.diff > 0 ? 'W' : 'L');
  return out;
}
// раз в 3 минуты обновляем ELO всех привязанных игроков, чтобы не пропускать матчи
setInterval(async () => {
  const nicks = new Set(); for (const u of q('SELECT settings FROM users').all()) { try { const n = JSON.parse(u.settings || '{}').faceit?.nick; if (n) nicks.add(n); } catch { } }
  for (const n of nicks) { try { trackElo(await faceit.getPlayer(n, true)); } catch { } await new Promise(r => setTimeout(r, 1500)); }
}, 3 * 60e3);
app.post('/api/faceit/link', auth, async (req, res) => {
  try {
    const d = await faceit.getPlayer(req.body?.nick, true);
    const s = getSettings(req.user); s.faceit.nick = d.nick; saveSettings(req.user, s);
    emit(req.user.id, 'faceit', withTrack(d));
    res.json({ ok: true, player: withTrack(d) });
  } catch (e) { res.status(e.code === 404 || e.code === 400 ? 400 : 502).json({ error: e.message }); }
});
app.post('/api/faceit/unlink', auth, (req, res) => { const s = getSettings(req.user); s.faceit.nick = ''; saveSettings(req.user, s); emit(req.user.id, 'faceit', null); res.json({ ok: true }); });
app.get('/api/faceit/me', auth, async (req, res) => {
  const s = getSettings(req.user); if (!s.faceit.nick) return res.json({ player: null });
  try { res.json({ player: withTrack(await faceit.getPlayer(s.faceit.nick, req.query.fresh === '1')) }); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/w/:token/faceit', async (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Неверная ссылка' });
  const s = getSettings(u);
  if (!s.faceit.nick) return res.json({ player: null, show: s.faceit.show });
  try { res.json({ player: withTrack(await faceit.getPlayer(s.faceit.nick)), show: s.faceit.show }); } catch (e) { res.status(502).json({ error: e.message, show: s.faceit.show }); }
});
// диагностика доступа к FACEIT (без личных данных)
app.get('/api/faceit/check', async (req, res) => { try { const d = await faceit.getPlayer(req.query.nick || 'donk', true); res.json({ ok: true, key: faceit.hasKey(), ...d, id: undefined, avatar: undefined, debug: faceit.debug() }); } catch (e) { res.json({ ok: false, key: faceit.hasKey(), error: e.message }); } });

// версия программы для Windows — по ней программа предлагает обновиться
const WIN_APP_VERSION = '2.3.7';
app.get('/api/app/version', (req, res) => res.json({ windows: WIN_APP_VERSION, url: `${baseUrl(req)}/update/KZStream-Setup.exe`, setup: `${baseUrl(req)}/update/KZStream-Setup.exe`,
  notes: 'Окно «iPhone по Bluetooth» теперь прокручивается и помещается на любом экране' }));

// --- приём уведомлений от приложений (Android / Windows / iPhone) ---
function ingest(req, res) {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Неверная ссылка подключения' });
  const src = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
  const title = clampStr(src.title, 300), text = clampStr(src.text ?? src.body ?? src.message, 1000);
  if (src.ping) return res.json({ ok: true, nick: u.nick, message: 'Подключено' });
  if (!title && !text) return res.status(400).json({ error: 'Пустое уведомление' });
  // защита от повторов (одно уведомление может прийти дважды)
  const hash = crypto.createHash('sha1').update(`${src.key || ''}|${title}|${text}`).digest('hex');
  if (q('SELECT id FROM ingest_log WHERE user_id=? AND hash=? AND created_at>?').get(u.id, hash, now() - 120e3))
    return res.json({ ok: true, duplicate: true });
  const parsed = parseNotification({ title, text });
  let result = 'ignored', event = null;
  if (parsed) {
    const r = q(`INSERT INTO donations(user_id,name,sender,amount,message,media_url,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(u.id, '', parsed.sender, parsed.amount, parsed.message, parsed.media_url, /^w?test-/.test(String(src.key || '')) ? 'test' : 'kaspi', 'pending', now());
    event = finalizeDonation(u, q('SELECT * FROM donations WHERE id=?').get(Number(r.lastInsertRowid)));
    result = 'new';
  }
  q('INSERT INTO ingest_log(user_id,hash,text,result,created_at) VALUES(?,?,?,?,?)').run(u.id, hash, `${title} | ${text}`.slice(0, 500), result, now());
  emit(u.id, 'ingest', { text: `${title} | ${text}`.slice(0, 200), result, at: now() });
  res.json({ ok: true, result, parsed, donation: event && { name: event.name, amount: event.amount, message: event.message } });
}
app.post('/api/ingest/:token', express.text({ type: 'text/*', limit: '64kb' }), (req, res, next) => {
  if (typeof req.body === 'string') req.body = { text: req.body };
  next();
}, ingest);
app.get('/api/ingest/:token', ingest);
app.get('/api/ingest-log', auth, (req, res) => res.json(q('SELECT text,result,created_at FROM ingest_log WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id)));

// --- виджеты ---
app.get('/api/w/:token/state', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Неверный токен' });
  res.json(widgetState(u));
});
app.get('/api/w/:token/stream', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).end();
  res.kzApp = /python-requests|KZStream/i.test(req.get('user-agent') || ''); res.kzRole = String(req.query.role || ''); res.kzEv = String(req.query.ev || ''); res.kzAt = Date.now();
  sse(res); subscribe(u.id, res);
});
app.get('/api/events', auth, (req, res) => { sse(res); subscribe(req.user.id, res); });
app.post('/api/w/:token/media/playing', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).end();
  const id = +req.body.id; if (id) { mediaTitles.set(id, clampStr(req.body.title, 120)); if (mediaTitles.size > 2000) mediaTitles.delete(mediaTitles.keys().next().value); }
  pushStats(u); res.json({ ok: true });
});
app.post('/api/w/:token/media/done', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).end();
  q(`UPDATE donations SET media_status='played' WHERE id=? AND user_id=? AND media_status='queued'`).run(+req.body.id, u.id);
  pushStats(u); res.json({ ok: true });
});

// --- озвучка (TTS-прокси) ---
// Голоса Microsoft Neural (бесплатно, без ключа — тот же движок, что у FreeTTS). Если недоступно — запасной вариант Google.
const pct = r => { const v = Math.round((r - 1) * 100); return (v >= 0 ? '+' : '') + v + '%'; };
function addPct(a, b) { const v = (parseInt(a) || 0) + (parseInt(b) || 0); return (v >= 0 ? '+' : '') + v + '%'; }
// у Microsoft иногда «залипает» конкретный голос с настройками по умолчанию — пробуем несколько вариантов
async function edgeTts(text, voiceId, rate) {
  const tries = [[], [], ['-10%', ''], ['-6%', '-5%'], ['-14%', '-6%']];
  let err;
  for (const [pitch, r2] of tries) {
    try { return await edgeTtsOnce(text, voiceId, rate, pitch, r2); } catch (e) { err = e; await new Promise(r => setTimeout(r, 250)); }
  }
  throw err;
}
async function edgeTtsOnce(text, voiceId, rate, pitchOverride, rateAdd) {
  const v = VOICES[voiceId] || VOICES.dmitry;
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(v[0], OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const opts = { rate: addPct(addPct(pct(rate), v[3]), rateAdd || '') };
    if (pitchOverride || v[2]) opts.pitch = pitchOverride || v[2];
    const { audioStream } = tts.toStream(text, opts);
    const chunks = [];
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 12000);
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('end', () => { clearTimeout(t); resolve(); });
      audioStream.on('error', e => { clearTimeout(t); reject(e); });
    });
    const buf = Buffer.concat(chunks);
    if (buf.length < 500) throw new Error('empty audio');
    return buf;
  } finally { try { tts.close(); } catch { } }
}
// проверка озвучки: какие голоса сейчас работают (без звука)
let ttsStatus = null;
app.get('/api/tts/status', async (req, res) => {
  if (!ttsStatus || now() - ttsStatus.at > 600e3 || 'fresh' in req.query) {
    const voices = {};
    for (const id of Object.keys(VOICES)) voices[id] = await edgeTts('Проверка связи', id, 1).then(b => b.length).catch(e => 'ошибка: ' + e.message);
    ttsStatus = { at: now(), voices };
  }
  res.json(ttsStatus);
});
const ttsCache = new Map();
async function ttsAudio(text, voiceId, rate) {
  const key = voiceId + '|' + rate + '|' + text;
  let buf = ttsCache.get(key);
  if (buf) return buf;
  buf = await edgeTts(text, voiceId, rate).catch(e => { console.error('Edge TTS:', e.message); return null; });
  if (!buf) {
    const lang = (VOICES[voiceId] || VOICES.dmitry)[4];
    const hosts = [`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=`,
      `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${lang}&q=`];
    for (const h of hosts) {
      try {
        const r = await fetch(h + encodeURIComponent(text), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Referer: 'https://translate.google.com/' }, signal: AbortSignal.timeout(8000) });
        if (r.ok && /audio/.test(r.headers.get('content-type') || '')) { buf = Buffer.from(await r.arrayBuffer()); break; }
      } catch { }
    }
  }
  if (!buf) throw new Error('tts');
  ttsCache.set(key, buf); if (ttsCache.size > 400) ttsCache.delete(ttsCache.keys().next().value);
  return buf;
}
app.get('/api/tts', async (req, res) => {
  const u = userByToken(req.query.t); if (!u || !effectivePlan(u).tts) return res.status(403).end();
  const text = clampStr(req.query.text, 300);
  const s = getSettings(u);
  const voice = VOICES[req.query.voice] ? req.query.voice : (s.alerts.tts_voice || 'dmitry');
  const rate = Math.min(2, Math.max(0.5, +req.query.rate || 1));
  if (!text) return res.status(400).end();
  try { res.set('Content-Type', 'audio/mpeg').send(await ttsAudio(text, voice, rate)); } catch { res.status(502).end(); }
});
// прослушать голос в кабинете (короткая фраза, доступно всем)
app.get('/api/tts/sample', auth, async (req, res) => {
  const voice = VOICES[req.query.voice] ? req.query.voice : 'dmitry';
  const text = VOICES[voice][4] === 'kk' ? 'Сәлем! Донат үшін рахмет, керемет стрим!' : 'Привет! Спасибо за донат, ты лучший!';
  try { res.set('Content-Type', 'audio/mpeg').send(await ttsAudio(text, voice, 1)); } catch { res.status(502).end(); }
});

// --- SEO: robots.txt и карта сайта для Google ---
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /api/\nDisallow: /w/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req), d = new Date().toISOString().slice(0, 10);
  const pages = ['/', '/download', '/rules', '/policy', ...q('SELECT * FROM users ORDER BY id DESC LIMIT 5000').all().filter(u => { try { return !!getSettings(u).page.kaspi; } catch { return false; } }).map(u => '/d/' + encodeURIComponent(u.nick))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(p => `<url><loc>${b}${p}</loc><lastmod>${d}</lastmod></url>`).join('')}</urlset>`);
});
app.get('/healthz', (req, res) => res.send('ok'));

// --- страницы ---
const PUB = path.join(__dirname, 'public');
let DONATE_HTML = null;
const escH = v => String(v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/d/:nick', (req, res) => {
  // заголовок и описание прямо в HTML — Google видит их без JavaScript
  if (!DONATE_HTML) DONATE_HTML = fs.readFileSync(path.join(PUB, 'donate.html'), 'utf8');
  const u = q('SELECT * FROM users WHERE lower(nick)=lower(?)').get(String(req.params.nick || '').slice(0, 40));
  let seo = '<meta name="robots" content="noindex">';
  if (u) {
    const pg = getSettings(u).page, name = pg.title || u.nick, b = baseUrl(req), url = `${b}/d/${encodeURIComponent(u.nick)}`;
    const desc = (pg.description ? pg.description.slice(0, 120) + ' · ' : '') + `Задонатить ${name} через Kaspi — сообщение появится в эфире TikTok Live.`;
    seo = `<title>Донат для ${escH(name)} — Kaspi · KZStream</title><meta name="description" content="${escH(desc)}"><link rel="canonical" href="${url}">`
      + `<meta property="og:title" content="Донат для ${escH(name)}"><meta property="og:description" content="${escH(desc)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${pg.avatar ? b + escH(pg.avatar) : b + '/og.jpg'}">`
      + (pg.kaspi ? '' : '<meta name="robots" content="noindex">');
  }
  res.type('html').send((seo.includes('<title>') ? DONATE_HTML.replace(/<title>[^<]*<\/title>/, '').replace(/<meta name="description"[^>]*>/, '') : DONATE_HTML).replace('<!--SEO-->', seo));
});
app.get('/app', (req, res) => res.sendFile(path.join(PUB, 'app.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUB, 'admin.html')));
app.get('/download', (req, res) => res.sendFile(path.join(PUB, 'download.html')));
// скачивание приложений с нашего адреса: /update/KZStream.exe и /update/KZStream.apk
// файлы берутся из server/downloads, иначе подтягиваются из GitHub Releases и кэшируются
const REL = process.env.RELEASE_URL || 'https://github.com/raulsahurov-maker/kzstream/releases/download/latest/';
const CACHE_DIR = path.join(DATA_DIR, 'downloads'); fs.mkdirSync(CACHE_DIR, { recursive: true });
const fetching = new Map();
async function ensureFile(name) {
  const local = path.join(__dirname, 'downloads', name);
  if (fs.existsSync(local)) return local;
  const cached = path.join(CACHE_DIR, name);
  if (fs.existsSync(cached) && now() - fs.statSync(cached).mtimeMs < 3600e3) return cached;
  if (!fetching.has(name)) fetching.set(name, (async () => {
    const r = await fetch(REL + name, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error('release ' + r.status);
    const tmp = cached + '.part'; fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer())); fs.renameSync(tmp, cached);
    return cached;
  })().finally(() => setTimeout(() => fetching.delete(name), 1000)));
  try { return await fetching.get(name); } catch { return fs.existsSync(cached) ? cached : null; }
}
for (const prefix of ['/update', '/downloads']) {
  app.get(prefix + '/:file(KZStream.apk|KZStream.exe|KZStream-Setup.exe|KZStream-Windows.zip)', async (req, res) => {
    const f = await ensureFile(req.params.file);
    if (!f) return res.status(503).send('Приложение обновляется, попробуйте через минуту.');
    const ext = req.params.file.split('.').pop();
    res.setHeader('Content-Type', { apk: 'application/vnd.android.package-archive', zip: 'application/zip' }[ext] || 'application/vnd.microsoft.portable-executable');
    res.download(f, req.params.file);
  });
}
app.use(express.static(PUB, { extensions: ['html'] }));
// TikTok LIVE: подписки, подарки, репосты → звуки (вкладка «TikTok» в кабинете)
require('./tiktok')(app, { auth, q, getSettings, saveSettings, userById, userByToken, emit, emitSpeaker, baseUrl, censor, canTts: u => !!effectivePlan(u).tts, isLite: u => !!effectivePlan(u).shop, ttHours: u => effectivePlan(u).ttHours ?? 1, watched: uid => [...(channels.get(uid) || [])].length > 0, onWatch: f => { watchHooks.push(f); }, admin});
app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));

const listen = () => app.listen(PORT, () => console.log(`KZStream запущен: http://localhost:${PORT}`));

// Не даём бесплатному серверу Render «засыпать»: каждые 10 минут обращаемся к своему публичному адресу.
// (Render усыпляет сервис после 15 минут без входящих запросов, и первый вход потом грузится ~1 минуту.)
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
if (SELF_URL) {
  setInterval(() => { fetch(SELF_URL + '/healthz', { signal: AbortSignal.timeout(20000) }).catch(() => {}); }, 10 * 60 * 1000);
  console.log('Защита от сна включена: ' + SELF_URL);
}
// база обязательна: без неё новые донаты и аккаунты пропали бы при обновлении сайта.
// Пробуем подключиться несколько раз; если не вышло — выходим с ошибкой (Render оставит работать прошлую версию и перезапустит).
(async () => {
  for (let i = 1; i <= 8; i++) {
    try { await initStorage(); return listen(); }
    catch (e) {
      console.error(`Не удалось подключиться к Turso (попытка ${i}/8):`, e.message, e.cause?.message || '');
      db.exec('BEGIN'); for (const t of TABLES) db.exec(`DELETE FROM ${t}`); db.exec('COMMIT');
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  console.error('ВНИМАНИЕ: Turso недоступен — сервер не запускается без базы, чтобы не потерять данные.');
  process.exit(1);
})();
