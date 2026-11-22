// Иконки соцсетей (белый знак на фирменном фоне) и приведение ника к ссылке
window.KZSOC = {
  list: [
    ['youtube', 'YouTube', '#ff0000', 'youtube.com/@канал или просто ник'],
    ['twitch', 'Twitch', '#9146ff', 'twitch.tv/ник или просто ник'],
    ['telegram', 'Telegram', '#229ed9', 't.me/канал или @канал'],
    ['instagram', 'Instagram', 'radial-gradient(circle at 30% 107%,#fdf497 0,#fd5949 45%,#d6249f 60%,#285aeb 90%)', 'instagram.com/ник или просто ник'],
    ['tiktok', 'TikTok', '#000', 'tiktok.com/@ник или просто ник'],
    ['discord', 'Discord', '#5865f2', 'discord.gg/приглашение'],
    ['donationalerts', 'DonationAlerts', '#f57c00', 'donationalerts.com/r/ник или просто ник'],
  ],
  rx: { youtube: /(youtube\.com|youtu\.be)$/, twitch: /twitch\.tv$/, telegram: /(t\.me|telegram\.me)$/, instagram: /instagram\.com$/, tiktok: /tiktok\.com$/, discord: /(discord\.gg|discord\.com)$/, donationalerts: /(donationalerts\.com|donationalerts\.ru|dalink\.to)$/ },
  tpl: { youtube: 'https://www.youtube.com/@', twitch: 'https://www.twitch.tv/', telegram: 'https://t.me/', instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/@', discord: 'https://discord.gg/', donationalerts: 'https://www.donationalerts.com/r/' },
  // «kumishich», «@kumishich» → полная ссылка; ссылку оставляем как есть
  norm(k, v) {
    v = String(v || '').trim(); if (!v) return '';
    const nick = v.replace(/^@/, '');
    if (/^[\w.\-]{1,60}$/.test(nick) && !/\.(com|tv|me|gg|ru|be|to)$/i.test(nick)) return this.tpl[k] + nick;
    return /^https?:\/\//i.test(v) ? v : 'https://' + v;
  },
  ok(k, v) { if (!v) return true; try { return this.rx[k].test(new URL(this.norm(k, v)).hostname.replace(/^www\./, '')); } catch { return false; } },
  svg: {
    youtube: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8z" fill="#fff"/><path d="M10 15.2V8.8l5.3 3.2z" fill="#ff0000"/>',
    twitch: '<path d="M5 3 3.5 6.5V19h4.2v2.3h2.4l2.3-2.3h3.4l4.7-4.7V3zm14 10.6-2.7 2.7h-4.2l-2.3 2.3v-2.3H6.3V4.7H19z"/><path d="M15.4 7.6h1.7v4.8h-1.7zm-4.6 0h1.7v4.8h-1.7z"/>',
    telegram: '<path d="M20.7 4.4 3.4 11.1c-1.2.5-1.1 1.1-.2 1.4l4.4 1.4 1.7 5.2c.2.6.4.8.8.8s.6-.2.9-.4l2.1-2 4.4 3.2c.8.5 1.4.2 1.6-.8l2.9-13.6c.3-1.2-.4-1.8-1.3-1.4zM8.9 13.9l8.9-5.6c.4-.3.8-.1.5.2l-7.5 6.8-.3 3.1z"/>',
    instagram: '<path d="M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/><circle cx="17" cy="7" r="1.1"/><path d="M16.2 2.5H7.8A5.3 5.3 0 0 0 2.5 7.8v8.4a5.3 5.3 0 0 0 5.3 5.3h8.4a5.3 5.3 0 0 0 5.3-5.3V7.8a5.3 5.3 0 0 0-5.3-5.3zm3.6 13.7a3.6 3.6 0 0 1-3.6 3.6H7.8a3.6 3.6 0 0 1-3.6-3.6V7.8a3.6 3.6 0 0 1 3.6-3.6h8.4a3.6 3.6 0 0 1 3.6 3.6z"/>',
    tiktok: '<path d="M16.8 5.6A4.4 4.4 0 0 1 15.7 2.7h-3.2v12.7a2.7 2.7 0 1 1-2.7-2.7c.3 0 .6 0 .8.1V9.5a6 6 0 1 0 5.1 5.9V9a7.6 7.6 0 0 0 4.4 1.4V7.2a4.4 4.4 0 0 1-3.3-1.6z" fill="#25f4ee" transform="translate(-.6 -.4)"/><path d="M16.8 5.6A4.4 4.4 0 0 1 15.7 2.7h-3.2v12.7a2.7 2.7 0 1 1-2.7-2.7c.3 0 .6 0 .8.1V9.5a6 6 0 1 0 5.1 5.9V9a7.6 7.6 0 0 0 4.4 1.4V7.2a4.4 4.4 0 0 1-3.3-1.6z" fill="#fe2c55" transform="translate(.6 .4)"/><path d="M16.8 5.6A4.4 4.4 0 0 1 15.7 2.7h-3.2v12.7a2.7 2.7 0 1 1-2.7-2.7c.3 0 .6 0 .8.1V9.5a6 6 0 1 0 5.1 5.9V9a7.6 7.6 0 0 0 4.4 1.4V7.2a4.4 4.4 0 0 1-3.3-1.6z" fill="#fff"/>',
    discord: '<path d="M19.3 5.3A16.5 16.5 0 0 0 15.2 4l-.5 1a15 15 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.6 16.6 0 0 0 5 2.6l1.1-1.8a10.7 10.7 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 11 0l.4.3-1.7.8 1.1 1.8a16.6 16.6 0 0 0 5-2.6c.4-4.3-.7-8-3-11.4zM8.7 14.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/>',
    donationalerts: '<path d="M12 2.5 4 6v5.5c0 4.7 3.4 9 8 10 4.6-1 8-5.3 8-10V6zm0 4.3a2 2 0 0 1 2 2v3.3a2 2 0 0 1-4 0V8.8a2 2 0 0 1 2-2zm-4.2 5h1.4a2.8 2.8 0 0 0 5.6 0h1.4a4.2 4.2 0 0 1-3.5 4.1v1.8h-1.4v-1.8a4.2 4.2 0 0 1-3.5-4.1z"/>',
  },
  icon(k, size = 20) { return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="#fff" aria-hidden="true">${this.svg[k] || ''}</svg>`; },
};
