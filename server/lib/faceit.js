// FACEIT CS2: данные игрока по нику.
// Если задан FACEIT_API_KEY — официальный Data API v4 (надёжно). Иначе — открытые запросы сайта faceit.com.
const KEY = (process.env.FACEIT_API_KEY || '').trim();
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Accept: 'application/json' };
const cache = new Map(); // ник -> { at, data }
let lastKeys = [], lastStatsErr = '';

async function j(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(12000) });
  if (r.status === 404) { const e = new Error('Игрок не найден на FACEIT'); e.code = 404; throw e; }
  if (!r.ok) throw new Error('FACEIT ответил ' + r.status);
  return r.json();
}
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') return o[k]; return undefined; };

async function viaOfficial(nick) {
  const H = { Authorization: 'Bearer ' + KEY };
  const p = await j(`https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nick)}&game=cs2`, H);
  const g = (p.games || {}).cs2 || {};
  if (!g.faceit_elo) { const e = new Error('У игрока нет матчей в CS2 на FACEIT'); e.code = 404; throw e; }
  let L = {};
  try { L = (await j(`https://open.faceit.com/data/v4/players/${p.player_id}/stats/cs2`, H)).lifetime || {}; } catch { }
  let adr = null;
  try {
    const m = await j(`https://open.faceit.com/data/v4/players/${p.player_id}/games/cs2/stats?limit=20`, H);
    const a = (m.items || []).map(x => num((x.stats || {}).ADR)).filter(x => x != null);
    if (a.length) adr = Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10;
  } catch { }
  return {
    id: p.player_id, nick: p.nickname, avatar: p.avatar || '', country: (p.country || '').toLowerCase(),
    level: g.skill_level || 0, elo: g.faceit_elo || 0,
    kd: num(pick(L, 'Average K/D Ratio')), wr: num(pick(L, 'Win Rate %')), hs: num(pick(L, 'Average Headshots %')),
    matches: num(pick(L, 'Matches')), streak: num(pick(L, 'Current Win Streak')), adr: adr ?? num(pick(L, 'ADR')),
    last: (pick(L, 'Recent Results') || []).map(x => String(x) === '1' ? 'W' : 'L').slice(0, 5),
  };
}

async function viaPublic(nick) {
  const u = (await j(`https://www.faceit.com/api/users/v1/nicknames/${encodeURIComponent(nick)}`)).payload || {};
  const g = (u.games || {}).cs2 || {};
  if (!u.id) { const e = new Error('Игрок не найден на FACEIT'); e.code = 404; throw e; }
  if (!g.faceit_elo) { const e = new Error('У игрока нет матчей в CS2 на FACEIT'); e.code = 404; throw e; }
  let L = {}, statsErr = '';
  for (const url of [`https://www.faceit.com/api/stats/v1/stats/users/${u.id}/games/cs2`, `https://api.faceit.com/stats/v1/stats/users/${u.id}/games/cs2`,
    `https://www.faceit.com/api/stats/v1/stats/users/${u.id}/games/cs2`]) {
    try { const r = await j(url); L = r.lifetime || {}; lastKeys = Object.keys(L).slice(0, 40); if (Object.keys(L).length) break; }
    catch (e) { statsErr = e.message; await new Promise(r => setTimeout(r, 400)); }
  }
  lastStatsErr = statsErr;
  const recent = pick(L, 's0', 'Recent Results') || [];
  return {
    id: u.id, nick: u.nickname, avatar: u.avatar || '', country: (u.country || '').toLowerCase(),
    level: g.skill_level || 0, elo: g.faceit_elo || 0,
    kd: num(pick(L, 'k5', 'Average K/D Ratio')), wr: num(pick(L, 'k6', 'Win Rate %')), hs: num(pick(L, 'k8', 'Average Headshots %')),
    matches: num(pick(L, 'm1', 'Matches')), streak: num(pick(L, 's1', 'Current Win Streak')), adr: num(pick(L, 'adr', 'ADR')),
    last: recent.map(x => String(x) === '1' ? 'W' : 'L').slice(0, 5),
  };
}

async function getPlayer(nick, fresh = false) {
  nick = String(nick || '').trim();
  if (!nick || !/^[\w.\-]{2,32}$/.test(nick)) { const e = new Error('Неверный ник FACEIT'); e.code = 400; throw e; }
  const key = nick.toLowerCase(), c = cache.get(key);
  if (c && !fresh && Date.now() - c.at < 5 * 60e3) return c.data;
  let data, errs = [];
  for (const fn of KEY ? [viaOfficial, viaPublic] : [viaPublic]) {
    try { data = await fn(nick); break; } catch (e) { if (e.code === 404) throw e; errs.push(e.message); }
  }
  if (!data) { if (c) return c.data; throw new Error('FACEIT сейчас недоступен: ' + errs.join('; ')); }
  if (c && data.kd == null && c.data.kd != null) for (const k of ['kd', 'wr', 'hs', 'matches', 'streak', 'adr', 'last']) data[k] = c.data[k];
  if (data.kd == null && !(data.last || []).length) { data.at = Date.now(); cache.set(key, { at: Date.now() - 4 * 60e3, data }); return data; } // повторим через минуту
  data.at = Date.now();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return data;
}
module.exports = { getPlayer, hasKey: () => !!KEY, debug: () => ({ keys: lastKeys, statsErr: lastStatsErr }) };
