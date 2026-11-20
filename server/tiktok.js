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
};
const clean = u => String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').split(/[/?#\s]/)[0].slice(0, 40);

module.exports = function setupTikTok(app, d) {
  const { auth, q, getSettings, saveSettings, userById, userByToken, emit, baseUrl } = d;
  const conns = new Map(); // user_id -> { c, state, retry, since, user, err }

  const cfg = u => { const s = getSettings(u); const t = s.tiktok || {}; const o = { ...DEF, ...t }; for (const k of EV) o[k] = { ...DEF[k], ...(t[k] || {}) }; return o; };
  const status = uid => { const x = conns.get(uid); return x ? { state: x.state, user: x.user, err: x.err || '', since: x.since || 0 } : { state: 'off' }; };
  const setState = (uid, state, err) => { const x = conns.get(uid); if (!x) return; x.state = state; x.err = err || ''; if (state === 'live') x.since = Date.now(); emit(uid, 'tt_status', status(uid)); };

  // анти-спам: одна подписка от человека — один звук за эфир
  function fire(uid, type, data) {
    const u = userById(uid); if (!u) return;
    const c = cfg(u), e = c[type]; if (!e || !e.on) return;
    const x = conns.get(uid);
    if (type === 'follow' && x) { x.seen = x.seen || new Set(); if (x.seen.has(data.id)) return; x.seen.add(data.id); }
    emit(uid, 'tt', { type, user: data.name, id: data.id, avatar: data.avatar || '', gift: data.gift || '', count: data.count || 1, cfg: e, popup: c.popup });
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
        x.tries = 0; setState(uid, 'live');
      } catch (e) {
        try { c && c.disconnect(); } catch { }
        if (conns.get(uid) !== x) return;
        const msg = String((e && (e.message || e.exception?.message)) || e);
        const offline = /offline|not.*live|isn't online|LIVE has ended|status 4|UserOfflineError/i.test(msg) || (e && /Offline/i.test(e.name || ''));
        const nouser = /not found|doesn't exist|user.*invalid|InvalidUniqueId/i.test(msg);
        if (nouser) return setState(uid, 'error', `Аккаунт @${user} не найден — проверьте юзернейм`);
        setState(uid, 'waiting', offline ? 'Эфир не запущен — запустите LIVE, подключусь сам' : 'TikTok не ответил — пробую ещё раз…');
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

  const pub = (u, req) => ({ settings: cfg(u), status: status(u.id), widget: `${baseUrl(req)}/w/tiktok.html?t=${u.token}` });
  app.get('/api/tiktok', auth, (req, res) => res.json(pub(req.user, req)));
  app.put('/api/tiktok', auth, (req, res) => {
    const u = req.user, s = getSettings(u), b = req.body || {}, c = cfg(u);
    if (b.user !== undefined) c.user = clean(b.user);
    if (b.popup !== undefined) c.popup = !!b.popup;
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
  // проверка звука без эфира
  app.post('/api/tiktok/test', auth, (req, res) => {
    const type = EV.includes(req.body && req.body.type) ? req.body.type : 'follow';
    const u = req.user, c = cfg(u), e = c[type];
    emit(u.id, 'tt', { type, user: 'Тестовый зритель', id: 'test' + Date.now(), avatar: '', gift: 'Роза', count: 1, cfg: { ...e, on: true }, popup: c.popup, test: true });
    res.json({ ok: true });
  });
  app.get('/api/w/:token/tiktok', (req, res) => {
    const u = userByToken(req.params.token); if (!u) return res.status(404).json({ error: 'Неверный токен' });
    res.json({ settings: cfg(u), status: status(u.id) });
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
