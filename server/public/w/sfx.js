// Встроенные звуки KZStream (синтез в браузере, без файлов) — для событий TikTok.
(function () {
  const LIST = [
    ['tada', '🎉 Та-да!'], ['coin', '🪙 Монетка'], ['fanfare', '🎺 Фанфары'], ['airhorn', '📯 Гудок MLG'],
    ['fail', '🎷 Грустный тромбон'], ['boing', '🤸 Боинг'], ['laser', '🔫 Пиу-пиу'], ['bubble', '🫧 Бульк'],
    ['ding', '🔔 Дзынь'], ['levelup', '⬆️ Новый уровень'], ['wow', '😮 Вау-вау'], ['drum', '🥁 Ба-дум-тсс'],
  ];
  let ctx;
  const AC = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());
  function tone(a, out, f, t, dur, type = 'sine', vol = .3, f2) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .05);
  }
  function noise(a, out, t, dur, vol = .3, hp = 1000) {
    const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'highpass'; f.frequency.value = hp; s.buffer = b;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t);
  }
  const FX = {
    tada: (a, o, t) => { [523, 659, 784].forEach((f, i) => tone(a, o, f, t + i * .07, .18, 'triangle', .25)); tone(a, o, 1047, t + .24, .7, 'triangle', .3); tone(a, o, 784, t + .24, .7, 'sine', .15); },
    coin: (a, o, t) => { tone(a, o, 988, t, .08, 'square', .15); tone(a, o, 1319, t + .08, .45, 'square', .15); },
    fanfare: (a, o, t) => { [[392, .12], [392, .12], [392, .12], [523, .6]].reduce((tt, [f, d]) => { tone(a, o, f, tt, d, 'sawtooth', .12); tone(a, o, f * 2, tt, d, 'triangle', .1); return tt + d * .9; }, t); },
    airhorn: (a, o, t) => { for (let k = 0; k < 3; k++) { const s = t + k * .32, d = k === 2 ? .7 : .26; [311, 415, 466].forEach(f => tone(a, o, f, s, d, 'sawtooth', .09)); } },
    fail: (a, o, t) => { [[392, .3], [370, .3], [349, .3], [330, 1]].reduce((tt, [f, d]) => { tone(a, o, f, tt, d, 'sawtooth', .12, d > .5 ? f * .94 : 0); return tt + d * .95; }, t); },
    boing: (a, o, t) => { tone(a, o, 150, t, .5, 'sine', .4, 600); tone(a, o, 300, t + .05, .4, 'triangle', .12, 900); },
    laser: (a, o, t) => { for (let k = 0; k < 3; k++) tone(a, o, 1800, t + k * .14, .13, 'square', .1, 200); },
    bubble: (a, o, t) => { tone(a, o, 300, t, .12, 'sine', .4, 1200); tone(a, o, 500, t + .12, .1, 'sine', .3, 1500); },
    ding: (a, o, t) => { tone(a, o, 1568, t, 1.2, 'sine', .3); tone(a, o, 3136, t, .6, 'sine', .08); },
    levelup: (a, o, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, o, f, t + i * .07, .14, 'square', .1)); tone(a, o, 1568, t + .36, .4, 'square', .1); },
    wow: (a, o, t) => { tone(a, o, 220, t, .45, 'sawtooth', .12, 440); tone(a, o, 440, t + .45, .6, 'sawtooth', .12, 220); },
    drum: (a, o, t) => { tone(a, o, 160, t, .15, 'sine', .5, 60); tone(a, o, 140, t + .2, .15, 'sine', .5, 55); noise(a, o, t + .42, .5, .25, 6000); },
  };
  let cur;
  window.KZSfx = {
    list: LIST,
    // name — встроенный звук или ссылка на свой файл (mp3/wav)
    play(name, vol = 80) {
      const v = Math.max(0, Math.min(100, +vol)) / 100;
      if (!name || v === 0) return;
      if (/^(https?:)?\/|^\/u\//.test(name)) { try { cur && cur.pause(); cur = new Audio(name); cur.volume = v; cur.play().catch(() => { }); } catch { } return; }
      const fx = FX[name]; if (!fx) return;
      const a = AC(); if (a.state === 'suspended') a.resume();
      const g = a.createGain(); g.gain.value = v * 1.4; g.connect(a.destination);
      fx(a, g, a.currentTime + .03);
    },
  };
})();
