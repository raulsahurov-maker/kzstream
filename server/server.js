// KZStream — сервер: регистрация, кабинет, приём уведомлений, виджеты OBS
'use strict';
process.removeAllListeners('warning');
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('libsql');
const { PLANS, effectivePlan } = require('./lib/plans');
const { parseNotification } = require('./lib/parse');

// ---------- конфиг ----------
const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PAY_KASPI = process.env.PAY_KASPI || '+7 775 884 27 91';
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
CREATE TABLE IF NOT EXISTS donations(
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, amount INTEGER, message TEXT DEFAULT '',
  media_url TEXT DEFAULT '', voice_url TEXT DEFAULT '', source TEXT, status TEXT, sender TEXT DEFAULT '',
  media_status TEXT DEFAULT '', created_at INTEGER, done_at INTEGER, hidden INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS d_user ON donations(user_id, status, created_at);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, user_id INTEGER, plan TEXT, months INTEGER, amount INTEGER,
  status TEXT DEFAULT 'pending', created_at INTEGER, comment TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, mime TEXT, size INTEGER, file TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS file_data(file TEXT PRIMARY KEY, data BLOB);
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
const TABLES = ['users', 'sessions', 'donations', 'payments', 'files', 'file_data', 'ingest_log'];
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
  let total = 0;
  for (const t of TABLES) {
    const r = await client.execute(`SELECT * FROM ${t}`);
    if (!r.rows.length) continue;
    const cols = r.columns, ins = db.prepare(`INSERT OR REPLACE INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
    db.exec('BEGIN');
    for (const row of r.rows) ins.run(...cols.map(c => { const v = row[c]; return v instanceof ArrayBuffer ? Buffer.from(v) : (typeof v === 'bigint' ? Number(v) : v); }));
    db.exec('COMMIT');
    total += r.rows.length;
  }
  remote = client;
  console.log(`База Turso подключена, загружено строк: ${total}`);
}
// при остановке сервера — дописываем очередь в Turso
async function flushAndExit() { const t = Date.now(); while ((outbox.length || pushing) && Date.now() - t < 8000) { pushLoop(); await new Promise(r => setTimeout(r, 200)); } process.exit(0); }
process.on('SIGTERM', flushAndExit); process.on('SIGINT', flushAndExit);

// ---------- настройки по умолчанию ----------
const TOP_STYLES = ['classic', 'glassneon', 'esports', 'darkgold', 'hud'], TOP_FONTS = ['manrope', 'montserrat', 'unbounded', 'oswald', 'rubik', 'inter'];
const THEMES = ['default', 'neon', 'sunset', 'mint', 'royal', 'mono', 'candy', 'steppe', 'ice', 'gold'];
function defaults(nick) {
  return {
    page: { title: nick, description: 'Спасибо за поддержку стрима!', kaspi: '', receiver: '', min_amount: 100, cards: '', avatar: '', banner: '', color: '#ff3b5c',
      socials: { twitch: '', youtube: '', tiktok: '', instagram: '', telegram: '' } },
    alerts: { duration: 6, gif: '', sound: '', volume: 0.8, min_alert: 0, show_msg: true, theme: 'default',
      tts: true, min_tts: 0, tts_lang: 'ru', tts_rate: 1, tts_read_name: true, variations: [] },
    censor: { words: '', strip_links: true },
    nicks: {},
    goal: { title: 'Цель сбора', target: 100000, base: 0, start_at: Date.now(), theme: 'default' },
    top: { period: 'month', count: 5, theme: 'default', style: 'classic', font: 'manrope', title: '', size: 'md', radius: 16, opacity: 0.9 },
    roulette: { enabled: false, min: 1000, style: 'wheel',
      tasks: ['Спеть песню', 'Катка без прицела', '10 отжиманий', 'Говорить с акцентом', 'Ответить на 3 вопроса', 'Танец 15 сек'] },
    media: { enabled: false, min: 500, max_sec: 180, volume: 0.6 },
    info: { lines: ['Донаты через Kaspi — ссылка в описании!'], interval: 8, theme: 'default' },
    timer: { end_at: 0, paused_left: 0, running: false, sec_per_100: 30, theme: 'default' },
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
const getSettings = (u) => deepMerge(defaults(u.nick), JSON.parse(u.settings || '{}'));
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
function subscribe(uid, res) {
  if (!channels.has(uid)) channels.set(uid, new Set());
  channels.get(uid).add(res);
  res.on('close', () => channels.get(uid)?.delete(res));
}
function emit(uid, event, data) {
  const set = channels.get(uid); if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of set) r.write(msg);
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
function widgetState(u) {
  const s = getSettings(u);
  const p = effectivePlan(u);
  const lastDon = q(`SELECT name, amount, message FROM donations WHERE user_id=? AND status='done' AND hidden=0 ORDER BY done_at DESC LIMIT 1`).get(u.id);
  return {
    nick: u.nick, plan: publicPlan(u), settings: { alerts: s.alerts, goal: s.goal, top: p.shop ? s.top : { ...s.top, style: 'classic', font: 'manrope', theme: 'default' }, roulette: s.roulette, media: s.media, info: s.info, timer: s.timer, hotkeys: p.hotkeys ? s.hotkeys : [] },
    top: topList(u, s), goal: { sum: goalSum(u, s), target: s.goal.target, title: s.goal.title },
    timer: timerState(s), last: lastDon || null, media: mediaQueue(u),
  };
}
function mediaQueue(u) {
  return q(`SELECT id, name, amount, media_url FROM donations WHERE user_id=? AND media_status='queued' ORDER BY done_at ASC LIMIT 20`).all(u.id);
}
function pushStats(u) {
  const s = getSettings(u);
  emit(u.id, 'stats', { top: topList(u, s), goal: { sum: goalSum(u, s), target: s.goal.target, title: s.goal.title }, timer: timerState(s), media: mediaQueue(u) });
}

// ---------- завершение доната ----------
function ytId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : '';
}
function finalizeDonation(u, d) {
  const s = getSettings(u);
  const p = effectivePlan(u);
  // ник донатеру (Lite+): сопоставление имени отправителя Kaspi -> ник
  let name = d.name || d.sender || 'Аноним';
  if (p.nicks && d.sender) {
    const alias = Object.entries(s.nicks || {}).find(([k]) => k.toLowerCase() === d.sender.toLowerCase());
    if (alias && !d.name) name = alias[1];
  }
  name = clampStr(name, 32) || 'Аноним';
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
  const event = {
    id: d.id, name, amount: d.amount, message: s.alerts.show_msg ? message : '',
    voice_url: p.voice ? d.voice_url : '', variation, roulette,
    tts: p.tts && s.alerts.tts && d.amount >= (s.alerts.min_tts || 0),
    show: d.amount >= (s.alerts.min_alert || 0), at: now(),
  };
  emit(u.id, 'donation', event);
  if (roulette) emit(u.id, 'roulette', { ...roulette, name, amount: d.amount });
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
  res.json({
    id: u.id, nick: u.nick, email: u.email, is_admin: !!u.is_admin, token: u.token,
    plan: publicPlan(u), plan_raw: u.plan, plan_until: u.plan_until, vip: u.paid_months >= 10, paid_months: u.paid_months,
    freeze_available: effectivePlan(u).freezeDays > 0 && now() - u.freeze_used_at > 30 * 864e5,
    storage: { used: storageUsed(u.id), limit: effectivePlan(u).storageMB * 1048576 },
    settings: s, themes: THEMES, plans: Object.values(PLANS).map(p => ({ ...p, media: p.media === Infinity ? -1 : p.media })),
    stats: { ...stats, today, month },
    urls: {
      page: `${b}/d/${u.nick}`, ingest: `${b}/api/ingest/${u.token}`,
      widgets: Object.fromEntries(['alerts', 'top', 'goal', 'roulette', 'media', 'info', 'timer'].map(w => [w, `${b}/w/${w}.html?t=${u.token}`])),
    },
    pay: { kaspi: PAY_KASPI, name: PAY_NAME, telegram: PAY_TELEGRAM },
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
    for (const k of ['avatar', 'banner']) if (pg[k] !== undefined) s.page[k] = /^(\/u\/\d+\/[\w.-]+|)$/.test(pg[k]) ? pg[k] : s.page[k];
    if (/^#[0-9a-f]{6}$/i.test(pg.color || '')) s.page.color = pg.color;
    if (pg.socials) for (const k of Object.keys(s.page.socials)) s.page.socials[k] = clampStr(pg.socials[k] ?? s.page.socials[k], 200);
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
    if (a.tts_lang !== undefined) { if (!p.ttsAdvanced && a.tts_lang !== 'ru') errors.push('Выбор языка озвучки — тариф Pro'); else if (['ru', 'kk', 'en', 'tr', 'uk'].includes(a.tts_lang)) A.tts_lang = a.tts_lang; }
    if (a.tts_rate !== undefined) A.tts_rate = p.ttsAdvanced ? Math.min(2, Math.max(0.5, +a.tts_rate || 1)) : 1;
    if (a.tts_read_name !== undefined) A.tts_read_name = p.ttsAdvanced ? !!a.tts_read_name : true;
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
    s.goal.target = int(b.goal.target, 1, 1e9, s.goal.target);
    s.goal.base = int(b.goal.base, 0, 1e9, s.goal.base);
    if (b.goal.reset) s.goal.start_at = now();
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
  }
  if (b.roulette) {
    if (!p.roulette && b.roulette.enabled) errors.push('Рулетка доступна с тарифа Lite');
    s.roulette.enabled = p.roulette && !!b.roulette.enabled;
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
    else { s.info.lines = (b.info.lines || []).map(l => clampStr(l, 140)).filter(Boolean).slice(0, 10); s.info.interval = int(b.info.interval, 3, 120, 8);
      if (b.info.theme && THEMES.includes(b.info.theme)) s.info.theme = b.info.theme; }
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
app.get('/api/files', auth, (req, res) => res.json(q('SELECT id,name,mime,size,file,created_at FROM files WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(f => ({ ...f, url: '/u/' + f.file }))));
app.delete('/api/files/:id', auth, (req, res) => {
  const f = q('SELECT * FROM files WHERE id=? AND user_id=?').get(+req.params.id, req.user.id);
  if (f) { q('DELETE FROM file_data WHERE file=?').run(f.file); q('DELETE FROM files WHERE id=?').run(f.id); }
  res.json({ ok: true });
});
app.get('/u/:uid/:file', (req, res) => {
  const key = `${req.params.uid}/${req.params.file}`;
  const f = q('SELECT mime FROM files WHERE file=?').get(key), d = f && q('SELECT data FROM file_data WHERE file=?').get(key);
  if (!d) return res.status(404).end();
  res.set({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=604800' }).send(Buffer.from(d.data));
});

// --- донаты в кабинете ---
app.get('/api/donations', auth, (req, res) => {
  const lim = int(req.query.limit, 1, 500, 100);
  res.json(q(`SELECT id,name,sender,amount,message,media_url,voice_url,source,status,created_at,done_at FROM donations WHERE user_id=? AND hidden=0 ORDER BY COALESCE(done_at,created_at) DESC LIMIT ?`).all(req.user.id, lim));
});
app.post('/api/donations/test', auth, (req, res) => {
  const u = req.user;
  const r = q(`INSERT INTO donations(user_id,name,amount,message,media_url,source,status,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(u.id, clampStr(req.body.name || 'Тестовый донатер', 32), int(req.body.amount, 1, 1e7, 1000), clampStr(req.body.message ?? 'Это тестовый донат от KZStream!', 300), clampStr(req.body.media_url, 300), 'test', 'pending', now());
  const d = q('SELECT * FROM donations WHERE id=?').get(Number(r.lastInsertRowid));
  res.json({ ok: true, event: finalizeDonation(u, d) });
});
app.post('/api/test/roulette', auth, (req, res) => {
  const u = req.user, s = getSettings(u);
  if (!effectivePlan(u).roulette) return res.status(403).json({ error: 'Рулетка доступна с тарифа Lite' });
  if (!s.roulette.tasks.length) return res.status(400).json({ error: 'Добавьте задания' });
  const idx = crypto.randomInt(s.roulette.tasks.length);
  emit(u.id, 'roulette', { index: idx, task: s.roulette.tasks[idx], tasks: s.roulette.tasks, style: s.roulette.style, name: 'Тест', amount: s.roulette.min, test: true });
  res.json({ ok: true, task: s.roulette.tasks[idx] });
});
app.post('/api/test/media', auth, (req, res) => {
  const u = req.user; if (!effectivePlan(u).media) return res.status(403).json({ error: 'Музыка и видео доступны с тарифа Lite' });
  const url = clampStr(req.body.url, 300); if (!ytId(url)) return res.status(400).json({ error: 'Вставьте ссылку YouTube' });
  q(`INSERT INTO donations(user_id,name,amount,message,media_url,source,status,media_status,created_at,done_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(u.id, 'Тест музыки', 0, '', url, 'test', 'test', 'queued', now(), now());
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
app.post('/api/media/skip', auth, (req, res) => {
  const cur = mediaQueue(req.user)[0];
  if (cur) q(`UPDATE donations SET media_status='skipped' WHERE id=?`).run(cur.id);
  emit(req.user.id, 'media_skip', { id: cur?.id }); pushStats(req.user); res.json({ ok: true });
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
app.post('/api/pay', auth, (req, res) => {
  const plan = PLANS[req.body.plan]; const months = int(req.body.months, 1, 12, 1);
  if (!plan || plan.id === 'free') return res.status(400).json({ error: 'Выберите тариф' });
  const pending = q(`SELECT id FROM payments WHERE user_id=? AND status='pending'`).get(req.user.id);
  if (pending) return res.status(409).json({ error: 'У вас уже есть заявка на проверке' });
  q('INSERT INTO payments(user_id,plan,months,amount,created_at,comment) VALUES(?,?,?,?,?,?)').run(req.user.id, plan.id, months, plan.price * months, now(), clampStr(req.body.comment, 200));
  res.json({ ok: true });
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
    users: q(`SELECT u.id,u.nick,u.email,u.plan,u.plan_until,u.paid_months,u.created_at,u.is_admin,
      (SELECT COUNT(*) FROM donations d WHERE d.user_id=u.id AND d.status='done') dons,
      (SELECT COALESCE(SUM(amount),0) FROM donations d WHERE d.user_id=u.id AND d.status='done') total FROM users u ORDER BY u.id DESC LIMIT 500`).all(),
    payments: q(`SELECT p.*, u.nick, u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY (p.status='pending') DESC, p.id DESC LIMIT 200`).all(),
    totals: q(`SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM donations WHERE status='done') dons, (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='approved') revenue`).get(),
  });
});
function grantPlan(uid, plan, days) {
  const u = userById(uid);
  const from = (u.plan === plan && u.plan_until > now()) ? u.plan_until : now();
  q('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(plan, from + days * 864e5, uid);
}
app.post('/api/admin/payments/:id', admin, (req, res) => {
  const p = q(`SELECT * FROM payments WHERE id=? AND status='pending'`).get(+req.params.id);
  if (!p) return res.status(404).json({ error: 'Заявка не найдена' });
  if (req.body.action === 'approve') {
    grantPlan(p.user_id, p.plan, 30 * p.months);
    q('UPDATE users SET paid_months=paid_months+? WHERE id=?').run(p.months, p.user_id);
    const u = userById(p.user_id);
    if (u.paid_months >= 10 && !u.vip_bonus) { grantPlan(u.id, 'pro', 10); q('UPDATE users SET vip_bonus=1 WHERE id=?').run(u.id); }
    q(`UPDATE payments SET status='approved' WHERE id=?`).run(p.id);
  } else q(`UPDATE payments SET status='rejected' WHERE id=?`).run(p.id);
  res.json({ ok: true });
});
app.post('/api/admin/users/:id', admin, (req, res) => {
  const u = userById(+req.params.id); if (!u) return res.status(404).json({ error: 'Нет пользователя' });
  if (req.body.plan === 'free') q(`UPDATE users SET plan='free', plan_until=0 WHERE id=?`).run(u.id);
  else if (PLANS[req.body.plan]) grantPlan(u.id, req.body.plan, int(req.body.days, 1, 3650, 30));
  if (req.body.is_admin !== undefined) q('UPDATE users SET is_admin=? WHERE id=?').run(req.body.is_admin ? 1 : 0, u.id);
  res.json({ ok: true });
});

// --- публичная страница доната ---
app.get('/api/page/:nick', (req, res) => {
  const u = userByNick(req.params.nick); if (!u) return res.status(404).json({ error: 'Стример не найден' });
  const s = getSettings(u), p = effectivePlan(u);
  res.json({ nick: u.nick, page: s.page, ads: p.ads,
    goal: { title: s.goal.title, sum: goalSum(u, s), target: s.goal.target },
    top: topList(u, { ...s, top: { period: 'month', count: 5 } }),
    media: s.media.enabled ? { min: s.media.min } : null, roulette: s.roulette.enabled ? { min: s.roulette.min } : null,
    tts: p.tts && s.alerts.tts ? { min: s.alerts.min_tts || 0 } : null });
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
app.get('/api/app/me/:token', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Сессия устарела, войдите снова' });
  const s = getSettings(u);
  const today = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM donations WHERE user_id=? AND status='done' AND hidden=0 AND done_at>=?`).get(u.id, periodStart('day'));
  res.json({ nick: u.nick, plan: effectivePlan(u).name, today: today.s, today_count: today.c, hotkeys: effectivePlan(u).hotkeys ? s.hotkeys : [],
    last: q(`SELECT name, amount, message, done_at FROM donations WHERE user_id=? AND status='done' AND hidden=0 ORDER BY done_at DESC LIMIT 10`).all(u.id) });
});

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
      .run(u.id, '', parsed.sender, parsed.amount, parsed.message, parsed.media_url, 'kaspi', 'pending', now());
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
  sse(res); subscribe(u.id, res);
});
app.get('/api/events', auth, (req, res) => { sse(res); subscribe(req.user.id, res); });
app.post('/api/w/:token/media/done', (req, res) => {
  const u = userByToken(req.params.token); if (!u) return res.status(404).end();
  q(`UPDATE donations SET media_status='played' WHERE id=? AND user_id=? AND media_status='queued'`).run(+req.body.id, u.id);
  pushStats(u); res.json({ ok: true });
});

// --- озвучка (TTS-прокси) ---
const ttsCache = new Map();
app.get('/api/tts', async (req, res) => {
  const u = userByToken(req.query.t); if (!u || !effectivePlan(u).tts) return res.status(403).end();
  const text = clampStr(req.query.text, 200); const lang = ['ru', 'kk', 'en', 'tr', 'uk'].includes(req.query.lang) ? req.query.lang : 'ru';
  if (!text) return res.status(400).end();
  const key = lang + '|' + text;
  try {
    let buf = ttsCache.get(key);
    if (!buf) {
      const hosts = [`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=`,
        `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${lang}&q=`];
      for (const h of hosts) {
        try {
          const r = await fetch(h + encodeURIComponent(text), { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Referer: 'https://translate.google.com/' }, signal: AbortSignal.timeout(8000) });
          if (r.ok && /audio/.test(r.headers.get('content-type') || '')) { buf = Buffer.from(await r.arrayBuffer()); break; }
        } catch { }
      }
      if (!buf) throw new Error('tts');
      ttsCache.set(key, buf); if (ttsCache.size > 300) ttsCache.delete(ttsCache.keys().next().value);
    }
    res.set('Content-Type', 'audio/mpeg').send(buf);
  } catch { res.status(502).end(); }
});

// --- SEO: robots.txt и карта сайта для Google ---
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /api/\nDisallow: /w/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req), d = new Date().toISOString().slice(0, 10);
  const pages = ['/', '/download', '/rules', '/policy', ...q('SELECT nick FROM users ORDER BY id DESC LIMIT 5000').all().map(u => '/d/' + encodeURIComponent(u.nick))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(p => `<url><loc>${b}${p}</loc><lastmod>${d}</lastmod></url>`).join('')}</urlset>`);
});
app.get('/healthz', (req, res) => res.send('ok'));

// --- страницы ---
const PUB = path.join(__dirname, 'public');
app.get('/d/:nick', (req, res) => res.sendFile(path.join(PUB, 'donate.html')));
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
  app.get(prefix + '/:file(KZStream.apk|KZStream.exe)', async (req, res) => {
    const f = await ensureFile(req.params.file);
    if (!f) return res.status(503).send('Приложение обновляется, попробуйте через минуту.');
    res.setHeader('Content-Type', req.params.file.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream');
    res.download(f, req.params.file);
  });
}
app.use(express.static(PUB, { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(PUB, '404.html')));

const listen = () => app.listen(PORT, () => console.log(`KZStream запущен: http://localhost:${PORT}`));
initStorage().then(listen).catch(e => {
  console.error('Не удалось подключиться к Turso:', e.message, e.code || '', e.cause?.message || '');
  console.error('ВНИМАНИЕ: сайт запущен БЕЗ сохранения данных в Turso. Проверьте TURSO_URL и TURSO_TOKEN.');
  remote = null; listen();
});
