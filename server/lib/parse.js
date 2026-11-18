// Разбор текста банковских уведомлений (Kaspi и другие банки Казахстана).
// Зритель переводит деньги напрямую через Kaspi и пишет сообщение в комментарии к переводу.
// Возвращает { amount, sender, message, media_url } для входящего перевода или null.

const OUTGOING = /(вы\s+перевели|покупка|оплата\s|списан|снятие|платёж|платеж|отправлен[оа]?\s+вами|аударымыңыз|сатып\s+алу|төлем|код\s+подтверждения|одноразовый\s+код)/i;
const INCOMING = /(перевод|пополнен|поступ|зачислен|получен|перевел|перевела|перевёл|вам\s+отправил|аударым|аударды|түсті|келді|\+\s*\d)/i;

const NUM = '(\\d{1,3}(?:[\\s\\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
const AMOUNT_RES = [
  new RegExp('\\+?\\s*' + NUM + '\\s*(?:₸|тг\\.?|тенге|kzt)', 'i'),
  new RegExp('(?:₸|kzt)\\s*' + NUM, 'i'),
];
const L = 'A-ZА-ЯЁӘҒҚҢӨҰҮҺІ', l = 'a-zа-яёәғқңөұүһі';
const NAME = `([${L}][${l}\\-]+(?:\\s+[${L}][${l}\\-]*\\.?)?)`;
const CUR = '(?:₸|тг\\.?|тенге|kzt)';
const SENDER_RES = [
  new RegExp(`(?:от|from|[Оо]тправитель:?|[Жж]іберуші:?)\\s+${NAME}`, 'gu'),
  // Kaspi: «Пополнение: 100 ₸ Арысланбек Т.» — имя сразу после суммы (в одну строку)
  new RegExp(`\\d\\s*${CUR}\\s+${NAME}\\s*$`, 'gimu'),
  new RegExp(`${NAME}\\s+(?:перевел|перевела|перевёл|отправил|отправила|аударды)`, 'gu'),
  // Kaspi: имя отправителя отдельной строкой («Арысланбек Т.»)
  new RegExp(`^${NAME}\\s*$`, 'gmu'),
];
const NOT_NAME = /^(Kaspi|Перевод|Пополнение|Вам|Поступление|Каспи|Сообщение|Комментарий|Зачисление|Подтвердить|Halyk|Jusan|Freedom|Сейчас|Gold)/i;
const MSG_LABEL = /(?:сообщение|комментарий|коммент|назначение|хабарлама|пікір|message)\s*[:\-—]\s*([\s\S]+)/i;
const SERVICE_LINE = /^(kaspi(\.kz)?|kaspi\s*gold|kaspi\s*bank|каспи|halyk|homebank|jusan|freedom|bcc|forte|перевод|переводы|пополнение|поступление|зачисление|входящий\s+перевод|аударым)\.?$/i;
const JUNK_LINE = /(баланс|доступно|остаток|қалдық|карта\s*\*|\*{2,}\d{2,}|\d{2}:\d{2}|подробнее|нажмите|подтвердить\s+получение|^сейчас$)/i;
const W = (list) => new RegExp(`(?<!\\p{L})(?:${list})(?!\\p{L})`, 'giu');
const SERVICE_WORDS = W('вам\\s+перевели|перевел\\(а\\)|перевела|перевёл|перевел|отправила|отправил|входящий\\s+перевод|перевод|пополнение|поступление|зачисление|на\\s+kaspi\\s*gold|kaspi\\s*gold|на\\s+карту|отправитель:?|от|from|вам');
const YT = /(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w\-]{11}[^\s]*/i;

function parseAmount(text) {
  for (const re of AMOUNT_RES) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/[\s  ]/g, ''), 10);
      if (n > 0 && n < 100000000) return n;
    }
  }
  return 0;
}

function parseSender(title, text) {
  const all = [text, title].filter(Boolean).join('\n');
  for (const re of SENDER_RES) {
    for (const m of all.matchAll(re)) {
      const n = m[1].trim();
      if (!NOT_NAME.test(n) && !SERVICE_LINE.test(n)) return n;
    }
  }
  return '';
}

function parseMessage(title, text, sender) {
  const full = `${title}\n${text}`;
  const labeled = full.match(MSG_LABEL);
  let msg = '';
  if (labeled) msg = labeled[1];
  else {
    // убираем служебное: сумму, отправителя, слова «перевод», баланс и т. п. — остаётся комментарий зрителя
    msg = text.split(/\n+/).map(line => {
      let s = line.trim();
      if (!s || SERVICE_LINE.test(s) || JUNK_LINE.test(s)) return '';
      if (sender && s.replace(/[.\s]/g, '') === sender.replace(/[.\s]/g, '')) return '';
      const bankLine = AMOUNT_RES[0].test(s) || AMOUNT_RES[1].test(s) || (sender && s.includes(sender));
      if (!bankLine) return s; // отдельная строка — это комментарий зрителя, оставляем как есть
      s = s.replace(AMOUNT_RES[0], ' ').replace(AMOUNT_RES[1], ' ');
      if (sender) s = s.split(sender).join(' ');
      s = s.replace(SERVICE_WORDS, ' ')
        .replace(/^[\s.,:;—\-+]+|[\s.,:;—\-]+$/g, '').replace(/\s{2,}/g, ' ');
      return s.length > 1 ? s : '';
    }).filter(Boolean).join(' ');
  }
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 300);
  const yt = msg.match(YT);
  return { message: msg, media_url: yt ? (yt[0].startsWith('http') ? yt[0] : 'https://' + yt[0]) : '' };
}

function parseNotification({ title = '', text = '' }) {
  const full = `${title}\n${text}`.trim();
  if (!full) return null;
  if (OUTGOING.test(full) && !/вам\s+перевели|вам\s+отправил|перевел\(а\)\s+вам|перевела?\s+вам/i.test(full)) return null;
  const amount = parseAmount(full);
  if (!amount) return null;
  if (!INCOMING.test(full) && !/^\s*\+/.test(text)) return null;
  const sender = parseSender(title, text);
  return { amount, sender, ...parseMessage(title, text, sender) };
}

module.exports = { parseNotification, parseAmount, parseSender };
