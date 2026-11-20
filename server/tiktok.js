// TikTok LIVE: подключение к эфиру по юзернейму (как TikFinity) — подписки, подарки, репосты → звук в виджете.
// Подключение идёт с сервера KZStream, ничего устанавливать стримеру не нужно.
let Lib = null;
try { Lib = require('tiktok-live-connector'); } catch (e) { console.error('tiktok-live-connector не загружен:', e.message); }

const EV = ['follow', 'gift', 'share'];
const DEF = {
  user: '', enabled: false,
  follow: { on: true, sound: 'tada', vol: 80, tts: false, text: '{user} подписался!' },
  gift: { on: true, sound: 'coin', vol: 70, tts: false, text: '{user} отправил {gift}!' },
  share: { on: false, sound: 'boing', vol: 70, tts: false, text: '{user} поделился эфиром!' },
  popup: true,
  likes: { count: 5, title: 'ТОП ЛАЙКЕРОВ' },
  tts: { on: true, voice: 'dmitry', vol: 90 },
  chat: { on: false, name: true, max: 150, prefix: '', links: false },
};
const clean = u => String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').split(/[/?#\s]/)[0].slice(0, 40);

module.exports = function setupTikTok(app, d) {
  const { auth, q, getSettings, saveSettings, userById, userByToken, emit, baseUrl, censor, canTts } = d;
  const conns = new Map(); // user_id -> { c, state, retry, since, user, err }

  const cfg = u => { const s = getSettings(u); const t = s.tiktok || {}; const o = { ...DEF, ...t }; for (const k of EV) o[k] = { ...DEF[k], ...(t[k] || {}) }; o.likes = { ...DEF.likes, ...(t.likes || {}) }; o.tts = { ...DEF.tts, ...(t.tts || {}) }; o.chat = { ...DEF.chat, ...(t.chat || {}) }; return o; };
  const status = uid => { const x = conns.get(uid); return x ? { state: x.state, user: x.user, err: x.err || '', since: x.since || 0 } : { state: 'off' }; };
  const setState = (uid, state, err) => { const x = conns.get(uid); if (!x) return; x.state = state; x.err = err || ''; if (state === 'live') x.since = Date.now(); emit(uid, 'tt_status', status(uid)); };

  // анти-спам: одна подписка от человека — один звук за эфир
  function fire(uid, type, data) {
    const u = userById(uid); if (!u) return;
    const c = cfg(u), e = c[type]; if (!e || !e.on) return;
    const x = conns.get(uid);
    if (type === 'follow' && x) { x.seen = x.seen || new Set(); if (x.seen.has(data.id)) return; x.seen.add(data.id); }
    emit(uid, 'tt', { type, user: data.name, id: data.id, avatar: data.avatar || '', gift: data.gift || '', count: data.count || 1, cfg: { ...e, tts: !!(e.tts && c.tts.on && canTts(u)) }, voice: c.tts.voice, tvol: c.tts.vol, popup: c.popup });
  }
  // топ лайкеров текущего эфира (обнуляется, когда начинается новый эфир)
  const likes = new Map(); // uid -> Map(id -> {name, avatar, n})
  const likeTimers = new Map();
  function likeTop(uid, n = 10) { const m = likes.get(uid); return m ? [...m.values()].sort((a, b) => b.n - a.n).slice(0, n) : []; }
  function addLike(uid, w, cnt) {
    if (!likes.has(uid)) likes.set(uid, new Map());
    const m = likes.get(uid), k = w.id || w.name, o = m.get(k) || { name: w.name, avatar: w.avatar, n: 0 };
    o.n += Math.max(1, cnt || 1); o.name = w.name; m.set(k, o);
    if (!likeTimers.has(uid)) likeTimers.set(uid, setTimeout(() => { likeTimers.delete(uid); emit(uid, 'tt_likes', likeTop(uid)); }, 1500));
  }
  // озвучка чата: каждое сообщение зрителя читается голосом (очередь в виджете)
  function chat(uid, w, text) {
    const u = userById(uid); if (!u) return;
    const c = cfg(u), ch = c.chat; if (!ch.on || !c.tts.on || !canTts(u)) return;
    let t = String(text || '').trim();
    if (ch.prefix) { if (!t.startsWith(ch.prefix)) return; t = t.slice(ch.prefix.length).trim(); }
    if (!ch.links) t = t.replace(/(https?:\/\/|www\.)\S+/gi, '').trim();
    t = censor(t, getSettings(u)).slice(0, ch.max || 150);
    if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
    emit(uid, 'tt_chat', { user: w.name, text: t, say: (ch.name ? w.name + ' пишет: ' : '') + t, voice: c.tts.voice, vol: c.tts.vol });
  }
  const who = m => { const us = m.user || {}; return { id: us.uniqueId || us.userId || '', name: us.nickname || us.uniqueId || 'Зритель', avatar: (us.profilePicture && us.profilePicture.url && us.profilePicture.url[0]) || '' }; };

  async function start(uid, user) {
    stop(uid, true);
    const x = { user, state: 'connecting', retry: null, tries: 0 }; conns.set(uid, x);
    emit(uid, 'tt_status', status(uid));
    if (!Lib) return setState(uid, 'error', 'Модуль TikTok не установлен на сервере');
    const go = async () => {
      if (conns.get(uid) !== x) return;
      x.tries++;
      let c;
      try {
        c = new Lib.TikTokLiveConnection(user, { processInitialData: false, enableExtendedGiftInfo: false, fetchRoomInfoOnConnect: true });
        x.c = c;
        c.on(Lib.WebcastEvent.FOLLOW, m => fire(uid, 'follow', who(m)));
        c.on(Lib.WebcastEvent.CHAT, m => chat(uid, who(m), m.comment));
        c.on(Lib.WebcastEvent.LIKE, m => addLike(uid, who(m), m.likeCount));
        c.on(Lib.WebcastEvent.SHARE, m => fire(uid, 'share', who(m)));
        c.on(Lib.WebcastEvent.GIFT, m => {
          // серийные подарки (розы и т.п.) — звук один раз, в конце серии
          if (m.giftType === 1 && !m.repeatEnd) return;
          fire(uid, 'gift', { ...who(m), gift: (m.giftDetails && m.giftDetails.giftName) || 'подарок', count: m.repeatCount || 1 });
        });
        c.on(Lib.ControlEvent.DISCONNECTED, () => { if (conns.get(uid) === x && x.state === 'live') { setState(uid, 'connecting', 'Связь с эфиром прервалась — переподключаюсь…'); later(15); } });
        c.on(Lib.WebcastEvent.STREAM_END, () => { if (conns.get(uid) === x) { setState(uid, 'waiting', 'Эфир завершён — жду следующий'); later(60); } });
        await c.connect();
        if (conns.get(uid) !== x) { try { c.disconnect(); } catch { } return; }
        const rid = c.roomId || (c.roomInfo && c.roomInfo.id) || '';
        if (rid !== x.room) { likes.delete(uid); x.room = rid; emit(uid, 'tt_likes', []); }
        x.tries = 0; setState(uid, 'live');
      } catch (e) {
        try { c && c.disconnect(); } catch { }
        if (conns.get(uid) !== x) return;
        const msg = String((e && (e.message || e.exception?.message)) || e);
        console.error(`TikTok @${user}:`, (e && e.name) || '', msg.slice(0, 400), e && e.exception ? String(e.exception.message || e.exception).slice(0, 300) : '');
        x.lastErr = msg.slice(0, 200);
        for (const sub of (e && e.errors) || []) console.error('   ↳', String(sub && (sub.message || sub)).slice(0, 300), sub && sub.response && sub.response.status || '');
        const offline = /offline|not.*live|isn't online|LIVE has ended|status 4|UserOfflineError/i.test(msg) || (e && /Offline/i.test(e.name || ''));
        const nouser = /not found|doesn't exist|user.*invalid|InvalidUniqueId/i.test(msg);
        if (nouser) return setState(uid, 'error', `Аккаунт @${user} не найден — проверьте юзернейм`);
        setState(uid, 'waiting', offline ? 'Эфир не запущен — запустите LIVE, подключусь сам' : 'TikTok не ответил — пробую ещё раз… (' + msg.slice(0, 90) + ')');
        later(offline ? 45 : Math.min(120, 20 * x.tries));
      }
    };
    const later = sec => { clearTimeout(x.retry); x.retry = setTimeout(go, sec * 1000); };
    go();
  }
  function stop(uid, quiet) {
    const x = conns.get(uid); if (!x) return;
    clearTimeout(x.retry); try { x.c && x.c.disconnect(); } catch { }
    conns.delete(uid); if (!quiet) emit(uid, 'tt_status', { state: 'off' });
  }

  const pub = (u, req) => ({ tts_ok: canTts(u), settings: cfg(u), status: status(u.id), widget: `${baseUrl(req)}/w/tiktok.html?t=${u.token}`, likes_widget: `${baseUrl(req)}/w/likes.html?t=${u.token}` });
  app.get('/api/tiktok', auth, (req, res) => res.json(pub(req.user, req)));
  app.put('/api/tiktok', auth, (req, res) => {
    const u = req.user, s = getSettings(u), b = req.body || {}, c = cfg(u);
    if (b.user !== undefined) c.user = clean(b.user);
    if (b.popup !== undefined) c.popup = !!b.popup;
    if (b.tts) { const t = b.tts; if (t.on !== undefined) c.tts.on = !!t.on; if (typeof t.voice === 'string') c.tts.voice = t.voice.slice(0, 30); if (t.vol !== undefined) c.tts.vol = Math.max(0, Math.min(100, +t.vol || 0)); }
    if (b.chat) { const t = b.chat; if (t.on !== undefined) c.chat.on = !!t.on; if (t.name !== undefined) c.chat.name = !!t.name; if (t.links !== undefined) c.chat.links = !!t.links; if (t.max !== undefined) c.chat.max = Math.max(20, Math.min(300, +t.max || 150)); if (typeof t.prefix === 'string') c.chat.prefix = t.prefix.trim().slice(0, 5); }
    if (b.likes) { c.likes.count = Math.max(1, Math.min(10, +b.likes.count || 5)); if (typeof b.likes.title === 'string') c.likes.title = b.likes.title.slice(0, 40); emit(u.id, 'tt_likes_cfg', c.likes); }
    for (const k of EV) if (b[k]) {
      const e = b[k], o = c[k];
      if (e.on !== undefined) o.on = !!e.on;
      if (typeof e.sound === 'string') o.sound = e.sound.slice(0, 300);
      if (e.vol !== undefined) o.vol = Math.max(0, Math.min(100, +e.vol || 0));
      if (e.tts !== undefined) o.tts = !!e.tts;
      if (typeof e.text === 'string') o.text = e.text.slice(0, 120);
    }
    s.tiktok = c; saveSettings(u, s);
    res.json({ ok: true, ...pub(userById(u.id), req) });
  });
  app.post('/api/tiktok/start', auth, (req, res) => {
    const u = req.user, s = getSettings(u), c = cfg(u);
    if (req.body && req.body.user !== undefined) c.user = clean(req.body.user);
    if (!c.user) return res.status(400).json({ error: 'Впишите свой юзернейм TikTok' });
    c.enabled = true; s.tiktok = c; saveSettings(u, s);
    start(u.id, c.user);
    res.json({ ok: true, ...pub(userById(u.id), req) });
  });
  app.post('/api/tiktok/stop', auth, (req, res) => {
    const u = req.user, s = getSettings(u), c = cfg(u);
    c.enabled = false; s.tiktok = c; saveSettings(u, s); stop(u.id);
    res.json({ ok: true, ...pub(userById(u.id), req) });
  });
  app.post('/api/tiktok/chat/test', auth, (req, res) => {
    const u = req.user, c = cfg(u);
    if (!canTts(u)) return res.status(403).json({ error: 'Озвучка доступна на тарифах Lite и Pro' });
    emit(u.id, 'tt_chat', { user: 'aruzhan_kz', text: 'Привет! Классный эфир', say: (c.chat.name ? 'aruzhan_kz пишет: ' : '') + 'Привет! Классный эфир', voice: c.tts.voice, vol: c.tts.vol });
    res.json({ ok: true });
  });
  app.post('/api/tiktok/likes/test', auth, (req, res) => {
    const N = ['aruzhan_kz', 'Dias', 'Ерлан', 'Mira', 'Нурсултан', 'Aigerim', 'Bek'];
    for (let i = 0; i < 12; i++) { const k = N[Math.floor(Math.random() * N.length)]; addLike(req.user.id, { id: 'test_' + k, name: k }, 5 + Math.floor(Math.random() * 60)); }
    res.json({ ok: true });
  });
  app.post('/api/tiktok/likes/reset', auth, (req, res) => { likes.delete(req.user.id); emit(req.user.id, 'tt_likes', []); res.json({ ok: true }); });
  // проверка звука без эфира
  app.post('/api/tiktok/test', auth, (req, res) => {
    const type = EV.includes(req.body && req.body.type) ? req.body.type : 'follow';
    const u = req.user, c = cfg(u), e = c[type];
    emit(u.id, 'tt', { type, user: 'Тестовый зритель', id: 'test' + Date.now(), avatar: '', gift: 'Роза', count: 1, cfg: { ...e, on: true, tts: !!(e.tts && c.tts.on && canTts(u)) }, voice: c.tts.voice, tvol: c.tts.vol, popup: c.popup, test: true });
    res.json({ ok: true });
  });
  app.get('/api/w/:token/tiktok', (req, res) => {
    const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Неверный токен' });
    res.json({ settings: cfg(u), status: status(u.id), likes: likeTop(u.id) });
  });

  // после перезапуска сервера — снова подключаем тех, у кого было включено
  setTimeout(() => {
    try {
      for (const r of q(`SELECT id, settings FROM users WHERE settings LIKE '%"tiktok"%'`).all()) {
        let t; try { t = JSON.parse(r.settings || '{}').tiktok; } catch { }
        if (t && t.enabled && t.user) start(r.id, t.user);
      }
    } catch (e) { console.error('TikTok автоподключение:', e.message); }
  }, 8000).unref();
};
