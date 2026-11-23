// TikTok LIVE: подключение к эфиру по юзернейму (как TikFinity) — подписки, подарки, репосты → звук в виджете.
// Подключение идёт с сервера KZStream, ничего устанавливать стримеру не нужно.
let Lib = null, WS = null;
try { WS = require('ws'); } catch { }
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
  chat: { on: false, name: true, max: 150, prefix: '', links: false, who: 'all' },
};
const clean = u => String(u || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, '').split(/[/?#\s]/)[0].slice(0, 40);

module.exports = function setupTikTok(app, d) {
  const { auth, q, getSettings, saveSettings, userById, userByToken, emit, emitSpeaker, baseUrl, censor, canTts, isLite } = d;
  const watched = d.watched || (() => true);
  // Квота Euler Stream общая на всех стримеров (бесплатно ~1000 подключений в сутки).
  // Поэтому: 1) не стучимся, пока у стримера не открыт ни виджет, ни кабинет, ни программа;
  // 2) сначала бесплатно спрашиваем у TikTok, идёт ли эфир; 3) после «лимита» все ждут вместе.
  let eulerPauseUntil = 0, probeWorks = null;
  const EULER_LOG = []; // время каждого подключения к Euler за сутки — видно в админке
  async function probeLive(user) {
    try {
      const r = await fetch('https://www.tiktok.com/api-live/user/room/?' + new URLSearchParams({ aid: '1988', app_name: 'tiktok_web', device_platform: 'web_pc', uniqueId: user, sourceType: '54' }),
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', Accept: 'application/json', Referer: 'https://www.tiktok.com/' }, signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const room = j && j.data && (j.data.liveRoom || j.data.user && j.data.user);
      if (!j || !j.data) { if (j && (j.statusCode === 19881007 || /not exist/i.test(j.message || ''))) return 'nouser'; return null; }
      probeWorks = true;
      const st = j.data.liveRoom && j.data.liveRoom.status, rid = j.data.user && j.data.user.roomId;
      return st === 2 || (st == null && rid && rid !== '0') ? 'live' : 'off';
    } catch { return null; }
  }
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
  const seenMsg = new Map(); // uid -> Set(msgId) — одно сообщение читается один раз
  const seenTxt = new Map(); // uid -> Map(ник+текст -> время): повтор того же сообщения в течение 10 минут не читаем
  function chat(uid, w, text, msgId, created) {
    // после переподключения TikTok присылает старые сообщения заново — их пропускаем
    const x = conns.get(uid); if (created && x && x.since && +created < x.since - 5000) return;
    const kt = (w.id || w.name) + '|' + String(text || '').trim().toLowerCase(); let mt = seenTxt.get(uid); if (!mt) seenTxt.set(uid, mt = new Map());
    const nowt = Date.now(); if (mt.has(kt) && nowt - mt.get(kt) < 600e3) return; mt.set(kt, nowt); if (mt.size > 400) mt.delete(mt.keys().next().value);
    const u = userById(uid); if (!u) return;
    const c = cfg(u), ch = c.chat; if (!ch.on || !c.tts.on || !canTts(u)) return;
    if (msgId) { let st = seenMsg.get(uid); if (!st) seenMsg.set(uid, st = new Set()); if (st.has(msgId)) return; st.add(msgId); if (st.size > 500) st.delete(st.values().next().value); }
    if (ch.who === 'followers' && !(w.follow >= 1)) return;
    let t = String(text || '').trim();
    if (ch.prefix) { if (!t.startsWith(ch.prefix)) return; t = t.slice(ch.prefix.length).trim(); }
    if (!ch.links) t = t.replace(/(https?:\/\/|www\.)\S+/gi, '').trim();
    t = censor(t, getSettings(u)).slice(0, ch.max || 150);
    if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
    emitSpeaker(uid, 'tt_chat', { id: msgId || (w.id + ':' + t), user: w.name, text: t, say: (ch.name ? w.name + ' пишет: ' : '') + t, voice: c.tts.voice, vol: c.tts.vol });
  }
  const who = m => { const us = m.user || {}, pp = us.profilePicture || {}; return { id: us.uniqueId || us.userId || '', name: us.nickname || us.uniqueId || 'Зритель', avatar: (pp.url && pp.url[0]) || (pp.urls && pp.urls[0]) || '', follow: (m.userIdentity && (m.userIdentity.isFollowerOfAnchor || m.userIdentity.isMutualFollowingWithAnchor || m.userIdentity.isModeratorOfAnchor || m.userIdentity.isAnchor)) ? 1 : 0 }; };

  async function start(uid, user) {
    stop(uid, true);
    const x = { user, state: 'connecting', retry: null, tries: 0 }; conns.set(uid, x);
    emit(uid, 'tt_status', status(uid));
    if (!Lib) return setState(uid, 'error', 'Модуль TikTok не установлен на сервере');
    const KEY = process.env.SIGN_API_KEY || process.env.EULER_API_KEY;
    // облачное подключение Euler Stream: эфир находит и держит их сервер (TikTok не пускает дата-центры напрямую)
    const cloud = async () => {
      if (conns.get(uid) !== x) return;
      if (!watched(uid)) { setState(uid, 'waiting', 'Жду, когда откроете виджет в TikTok Live Studio, кабинет или программу KZStream'); return later(30); }
      if (Date.now() < eulerPauseUntil) { setState(uid, 'waiting', 'Сервис TikTok перегружен — подключусь через минуту сам'); return later(Math.ceil((eulerPauseUntil - Date.now()) / 1000) + 5 + Math.random() * 20); }
      const pr = await probeLive(user);
      if (conns.get(uid) !== x) return;
      if (pr === 'nouser') { setState(uid, 'error', `Аккаунт @${user} не найден — проверьте юзернейм`); return later(600); }
      if (pr === 'off' && ((x.off = (x.off || 0) + 1) % 10 !== 0)) { setState(uid, 'waiting', 'Эфир не запущен — запустите LIVE на @' + user + ', подключусь сам за ~30 сек'); return later(30); }
      x.tries++;
      EULER_LOG.push(Date.now()); while (EULER_LOG.length && Date.now() - EULER_LOG[0] > 864e5) EULER_LOG.shift();
      const url = 'wss://ws.eulerstream.com?' + new URLSearchParams({ uniqueId: user, apiKey: KEY }).toString();
      let ws; try { ws = new WS(url); } catch (e) { setState(uid, 'error', 'Не удалось открыть подключение: ' + e.message); return later(60); }
      x.c = { disconnect: () => { try { ws.close(); } catch { } } };
      let opened = false;
      ws.on('open', () => { opened = true; });
      ws.on('message', (buf, isBin) => {
        let j; try { j = JSON.parse(buf.toString()); } catch { return; }
        if (conns.get(uid) !== x) return;
        if (x.state !== 'live') { x.tries = 0; x.off = 0; setState(uid, 'live'); }
        for (const it of (j.messages || [j])) {
          const t = it.type || '', m = it.data || {};
          if (t === 'roomInfo' || t === 'RoomInfoEvent') { const rid = m.roomInfo?.id || m.id || ''; if (rid && rid !== x.room) { likes.delete(uid); x.room = rid; emit(uid, 'tt_likes', []); } }
          else if (t === 'WebcastChatMessage') chat(uid, who(m), m.comment, m.common && String(m.common.msgId || ''), m.common && m.common.createTime);
          else if (t === 'WebcastLikeMessage') { const u = userById(uid); if (u && isLite(u)) addLike(uid, who(m), m.likeCount); }
          else if (t === 'WebcastGiftMessage') {
            const gt = m.giftType ?? m.giftDetails?.giftType;
            if (gt === 1 && !m.repeatEnd) continue;
            fire(uid, 'gift', { ...who(m), gift: m.giftDetails?.giftName || m.gift?.name || 'подарок', count: m.repeatCount || 1 });
          }
          else if (t === 'WebcastSocialMessage') {
            const k = m.common?.displayText?.key || '';
            if (k.includes('follow')) fire(uid, 'follow', who(m)); else if (k.includes('share')) fire(uid, 'share', who(m));
          }
        }
      });
      ws.on('close', (code, reason) => {
        if (conns.get(uid) !== x) return;
        const r = String(reason || '');
        console.error(`TikTok(cloud) @${user}: закрыто ${code} ${r.slice(0, 200)}`);
        if (code === 4404) { x.off = (x.off || 0) + 1; setState(uid, 'waiting', 'TikTok не видит эфир @' + user + ' — запустите LIVE с этого аккаунта, подключусь сам'); return later(probeWorks ? 30 : Math.min(600, 60 * x.off)); }
        if (code === 4005) { setState(uid, 'waiting', 'Эфир завершён — жду следующий'); return later(60); }
        if (code === 4401 || code === 4403) { setState(uid, 'error', 'Ключ Euler Stream не подошёл или тариф не даёт подключение (' + code + ')'); return later(300); }
        if (code === 4429) { eulerPauseUntil = Date.now() + 180e3; setState(uid, 'waiting', 'Сервис TikTok перегружен — подключусь через пару минут сам'); return later(200 + Math.random() * 60); }
        if (code === 4400 && /unique|user/i.test(r)) { setState(uid, 'error', `Аккаунт @${user} не найден — проверьте юзернейм`); return later(300); }
        setState(uid, opened && x.state === 'live' ? 'connecting' : 'waiting', (opened ? 'Связь с эфиром прервалась — переподключаюсь…' : 'Подключаюсь…') + (r ? ' (' + r.slice(0, 80) + ')' : ''));
        later(Math.min(90, 10 * x.tries));
      });
      ws.on('error', e => console.error(`TikTok(cloud) @${user}: ошибка`, e.message));
    };
    const go = async () => {
      if (KEY && WS) return cloud();
      if (conns.get(uid) !== x) return;
      x.tries++;
      let c;
      try {
        c = new Lib.TikTokLiveConnection(user, { processInitialData: false, enableExtendedGiftInfo: false, fetchRoomInfoOnConnect: true });
        x.c = c;
        c.on(Lib.WebcastEvent.FOLLOW, m => fire(uid, 'follow', who(m)));
        c.on(Lib.WebcastEvent.CHAT, m => chat(uid, who(m), m.comment, m.common && m.common.msgId, m.common && m.common.createTime));
        c.on(Lib.WebcastEvent.LIKE, m => { const u = userById(uid); if (u && isLite(u)) addLike(uid, who(m), m.likeCount); });
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
        for (const sub of (e && (e.errors || (e.config && e.config.requestErrs))) || []) console.error('   ↳', String(sub && (sub.message || sub)).slice(0, 300), sub && sub.response && sub.response.status || '');
        const offline = /offline|not.*live|isn't online|LIVE has ended|status 4|UserOfflineError/i.test(msg) || (e && /Offline/i.test(e.name || ''));
        const nouser = /not found|doesn't exist|user.*invalid|InvalidUniqueId/i.test(msg);
        const subs = ((e && (e.errors || (e.config && e.config.requestErrs))) || []).map(x => String(x && x.message || x)).join(' | ');
        if (/lack of permission/i.test(subs) && /user_not_found|SIGI_STATE/i.test(subs)) {
          setState(uid, 'waiting', 'TikTok не отдаёт эфир серверу KZStream — нужен ключ Euler Stream в настройках сервера (сообщите администратору). Пробую ещё раз…');
          return later(120);
        }
        if (nouser) return setState(uid, 'error', `Аккаунт @${user} не найден — проверьте юзернейм`);
        setState(uid, 'waiting', offline ? 'Эфир не запущен — запустите LIVE, подключусь сам' : 'TikTok не ответил — пробую ещё раз… (' + msg.slice(0, 90) + ')');
        later(offline ? 45 : Math.min(120, 20 * x.tries));
      }
    };
    const later = sec => { clearTimeout(x.retry); x.retry = setTimeout(go, sec * 1000); };
    goers.set(uid, go);
    go();
  }
  // открыли виджет/кабинет/программу — если ждём эфир, проверяем сразу
  d.onWatch && d.onWatch(uid => { const x = conns.get(uid); if (x && x.state === 'waiting' && x.retry && !(Date.now() < eulerPauseUntil)) { clearTimeout(x.retry); x.retry = setTimeout(() => go2(uid), 1500); } });
  const goers = new Map();
  function go2(uid) { const f = goers.get(uid); if (f) f(); }
  // проверка, видит ли сервер эфир без Euler (для поддержки): не чаще раза в 5 сек
  let lastProbe = 0;
  app.get('/api/tiktok/probe', async (req, res) => { if (Date.now() - lastProbe < 5000) return res.status(429).json({ error: 'подождите' }); lastProbe = Date.now(); res.json({ user: clean(req.query.u), result: await probeLive(clean(req.query.u) || 'tiktok'), probe_works: probeWorks }); });
  app.get('/api/admin/tiktok', (req, res, next) => d.admin(req, res, () => res.json({ euler_24h: EULER_LOG.length, pause_s: Math.max(0, Math.round((eulerPauseUntil - Date.now()) / 1000)), probe_works: probeWorks,
    conns: [...conns.entries()].map(([id, x]) => ({ id, user: x.user, state: x.state, err: x.err, tries: x.tries, watched: watched(id) })) })));
  function stop(uid, quiet) {
    const x = conns.get(uid); if (!x) return;
    clearTimeout(x.retry); try { x.c && x.c.disconnect(); } catch { }
    conns.delete(uid); goers.delete(uid); if (!quiet) emit(uid, 'tt_status', { state: 'off' });
  }

  const pub = (u, req) => ({ tts_ok: canTts(u), lite: isLite(u), settings: cfg(u), status: status(u.id), widget: `${baseUrl(req)}/w/tiktok.html?t=${u.token}`, likes_widget: `${baseUrl(req)}/w/likes.html?t=${u.token}` });
  app.get('/api/tiktok', auth, (req, res) => res.json(pub(req.user, req)));
  app.put('/api/tiktok', auth, (req, res) => {
    const u = req.user, s = getSettings(u), b = req.body || {}, c = cfg(u);
    if (b.user !== undefined) c.user = clean(b.user);
    if (b.popup !== undefined) c.popup = !!b.popup;
    if (b.tts) { const t = b.tts; if (t.on !== undefined) c.tts.on = !!t.on; if (typeof t.voice === 'string') c.tts.voice = t.voice.slice(0, 30); if (t.vol !== undefined) c.tts.vol = Math.max(0, Math.min(100, +t.vol || 0)); }
    if (b.chat) { const t = b.chat; if (t.on !== undefined) c.chat.on = !!t.on; if (t.name !== undefined) c.chat.name = !!t.name; if (t.links !== undefined) c.chat.links = !!t.links; if (t.max !== undefined) c.chat.max = Math.max(20, Math.min(300, +t.max || 150)); if (typeof t.prefix === 'string') c.chat.prefix = t.prefix.trim().slice(0, 5); if (['all', 'followers'].includes(t.who)) c.chat.who = t.who; }
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
    emitSpeaker(u.id, 'tt_chat', { id: 'test' + Date.now(), user: 'aruzhan_kz', text: 'Привет! Классный эфир', say: (c.chat.name ? 'aruzhan_kz пишет: ' : '') + 'Привет! Классный эфир', voice: c.tts.voice, vol: c.tts.vol });
    res.json({ ok: true });
  });
  app.post('/api/tiktok/likes/test', auth, (req, res) => {
    if (!isLite(req.user)) return res.status(403).json({ error: 'Топ лайкеров доступен с тарифа Lite' });
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
    res.json({ settings: cfg(u), status: status(u.id), likes: isLite(u) ? likeTop(u.id) : [], locked: !isLite(u) });
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
