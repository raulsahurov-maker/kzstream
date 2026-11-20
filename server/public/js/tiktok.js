// Вкладка «TikTok»: подключение к LIVE по юзернейму + звуки на подписку, подарок, репост
(() => {
  const $ = s => document.querySelector(s);
  const EV = [['follow', '❤️ Подписка', 'Звук, когда зритель подписался'], ['gift', '🎁 Подарок', 'Звук на каждый подарок (серия роз — один раз)'], ['share', '🔁 Репост эфира', 'Звук, когда зритель поделился эфиром']];
  const ST = { off: ['Не запущено', ''], connecting: ['Подключаюсь к эфиру…', 'wait'], waiting: ['Жду эфир', 'wait'], live: ['🔴 Подключено к LIVE — ловлю подписки', 'live'], error: ['Ошибка', 'err'] };
  let D = null, files = [], tmr;
  const req = (url, method = 'GET', body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Ошибка'); return j; });
  const toast = (m, bad) => { try { window.toast ? window.toast(m, bad) : alert(m); } catch { } };
  function opts(sel) {
    const b = KZSfx.list.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    const f = files.filter(x => /^audio\//.test(x.mime)).map(x => `<option value="${x.url}">🎧 ${x.name.replace(/</g, '')}</option>`).join('');
    return `<optgroup label="Встроенные">${b}</optgroup>` + (f ? `<optgroup label="Свои звуки">${f}</optgroup>` : `<optgroup label="Свои звуки"><option disabled>загрузите mp3 в «Хранилище»</option></optgroup>`) + `<option value="">🔇 Без звука</option>`;
  }
  function status(s) {
    s = s || { state: 'off' }; const [t, c] = ST[s.state] || ST.off;
    $('#ttDot').className = 'dot ' + c; $('#ttTxt').textContent = s.state === 'live' ? `${t} (@${s.user})` : (s.err || t);
    const on = s.state !== 'off'; $('#ttGo').style.display = on ? 'none' : ''; $('#ttStop').style.display = on ? '' : 'none';
  }
  function render() {
    const c = D.settings; $('#tt_user').value = c.user || ''; $('#tt_w').value = D.widget; $('#tt_popup').checked = c.popup !== false;
    if (!$('#ttPrev').src) $('#ttPrev').src = '/w/tiktok.html?demo&t=x';
    $('#ttEv').innerHTML = EV.map(([k, n, h]) => `<div class="card ttev" data-ev="${k}"><h3>${n}</h3><p class="hint">${h}</p>
      <label class="check"><input type="checkbox" data-f="on"> Включено</label>
      <div class="field"><label>Звук</label><div class="row2"><select data-f="sound">${opts()}</select><button class="btn btn-ghost btn-sm" data-play>▶</button></div></div>
      <div class="field"><label>Громкость <b data-vl></b></label><input type="range" min="0" max="100" step="5" data-f="vol"></div>
      <label class="check"><input type="checkbox" data-f="tts"> 🗣 Озвучить текст (Lite/Pro)</label>
      <div class="field"><label>Текст</label><input data-f="text" maxlength="120"></div>
      <div class="field"><label>Отдельная ссылка только для этого события</label><div class="copy-row"><input readonly id="tt_w_${k}" value="${D.widget}&ev=${k}"><button class="btn btn-ghost btn-sm" data-copy="tt_w_${k}">Копировать</button></div></div>
      <button class="btn btn-ghost btn-sm" data-test style="width:100%">🧪 Тест в эфире</button></div>`).join('');
    for (const [k] of EV) {
      const box = $(`[data-ev="${k}"]`), e = c[k];
      box.querySelector('[data-f=on]').checked = e.on; box.querySelector('[data-f=sound]').value = e.sound; box.querySelector('[data-f=vol]').value = e.vol;
      box.querySelector('[data-vl]').textContent = e.vol + '%'; box.querySelector('[data-f=tts]').checked = e.tts; box.querySelector('[data-f=text]').value = e.text;
      if (box.querySelector('[data-f=sound]').value !== e.sound && e.sound) box.querySelector('[data-f=sound]').insertAdjacentHTML('afterbegin', `<option value="${e.sound}">🎧 свой звук</option>`), box.querySelector('[data-f=sound]').value = e.sound;
    }
    $('#lk_w').value = D.likes_widget; $('#lk_title').value = c.likes.title; $('#lk_count').value = String(c.likes.count);
    if (!$('#lkPrev').src) $('#lkPrev').src = '/w/likes.html?demo&t=x';
    status(D.status);
  }
  function collect() {
    const b = { popup: $('#tt_popup').checked, likes: { title: $('#lk_title').value, count: +$('#lk_count').value } };
    for (const [k] of EV) { const x = $(`[data-ev="${k}"]`); b[k] = { on: x.querySelector('[data-f=on]').checked, sound: x.querySelector('[data-f=sound]').value, vol: +x.querySelector('[data-f=vol]').value, tts: x.querySelector('[data-f=tts]').checked, text: x.querySelector('[data-f=text]').value }; }
    return b;
  }
  const saveSoon = () => { clearTimeout(tmr); tmr = setTimeout(() => req('/api/tiktok', 'PUT', collect()).then(r => { D = { ...D, settings: r.settings }; }).catch(e => toast(e.message, true)), 500); };
  async function load() {
    try { [D, files] = await Promise.all([req('/api/tiktok'), req('/api/files').catch(() => [])]); render(); } catch { }
  }
  document.addEventListener('change', e => { if (e.target.closest('#p-tiktok') && e.target.id !== 'tt_user') saveSoon(); });
  document.addEventListener('input', e => {
    const r = e.target.closest('[data-ev] [data-f=vol]'); if (r) r.closest('[data-ev]').querySelector('[data-vl]').textContent = r.value + '%';
    if (e.target.closest('[data-ev] [data-f=text]') || e.target.id === 'lk_title') saveSoon();
  });
  document.addEventListener('click', async e => {
    const p = e.target.closest('[data-ev] [data-play]'); if (p) { const x = p.closest('[data-ev]'); KZSfx.play(x.querySelector('[data-f=sound]').value, x.querySelector('[data-f=vol]').value); return; }
    const t = e.target.closest('[data-ev] [data-test]'); if (t) { await req('/api/tiktok', 'PUT', collect()).catch(() => { }); await req('/api/tiktok/test', 'POST', { type: t.closest('[data-ev]').dataset.ev }); toast('Отправил тестовое событие в виджет — звук сыграет в TikTok Live Studio'); return; }
  });
  $('#lkTest').onclick = () => req('/api/tiktok/likes/test', 'POST').then(() => toast('Отправил тестовые лайки в виджет'));
  $('#lkReset').onclick = () => req('/api/tiktok/likes/reset', 'POST').then(() => toast('Топ лайкеров сброшен'));
  $('#ttGo').onclick = async () => { try { const r = await req('/api/tiktok/start', 'POST', { user: $('#tt_user').value }); D = r; render(); toast('Запущено — начните LIVE в TikTok, подключусь сам'); } catch (e) { toast(e.message, true); } };
  $('#ttStop').onclick = async () => { const r = await req('/api/tiktok/stop', 'POST'); D = r; render(); };
  // живой статус
  try { const es = new EventSource('/api/events'); es.addEventListener('tt_status', ev => { const s = JSON.parse(ev.data); if (D) D.status = s; status(s); }); } catch { }
  window.addEventListener('hashchange', () => { if (location.hash === '#tiktok') load(); });
  load();
})();
