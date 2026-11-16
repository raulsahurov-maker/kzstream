// Разбор текста банковских уведомлений (Kaspi и другие банки Казахстана).
// Возвращает { amount, sender } для входящего перевода или null.

const OUTGOING = /(вы\s+перевели|покупка|оплата|списан|снятие|платёж|платеж|отправлен|аударымыңыз|сатып\s+алу|төлем)/i;
const INCOMING = /(перевод|пополнен|поступ|зачислен|получен|вам\s+перевели|вам\s+отправил|аударым|түсті|келді|\+\s*\d)/i;

// "2 000 ₸", "2000,00 ₸", "+2 000 тг", "2 000 KZT", "₸ 2 000"
const AMOUNT_RES = [
  /\+?\s*(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:₸|тг\.?|тенге|kzt)/i,
  /(?:₸|kzt)\s*(\d{1,3}(?:[\s  ]\d{3})+|\d+)(?:[.,]\d{1,2})?/i,
];

const NAME = '([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі\\-]+(?:\\s+[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі\\-]*\\.?)?)';
const SENDER_RES = [
  new RegExp('(?:от|from|[Оо]тправитель:?|[Жж]іберуші:?)\\s+' + NAME, 'u'),
  new RegExp(NAME + '\\s+(?:перевел|перевела|перевёл|отправил|отправила|аударды)', 'u'),
  new RegExp('^' + NAME + '\\s*$', 'mu'), // заголовок уведомления = имя
];

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
    const m = all.match(re);
    if (m && !/^(Kaspi|Перевод|Пополнение|Вам|Поступление|Каспи)/i.test(m[1])) return m[1].trim();
  }
  return '';
}

function parseNotification({ title = '', text = '' }) {
  const full = `${title}\n${text}`.trim();
  if (!full) return null;
  if (OUTGOING.test(full) && !/вам\s+перевели|вам\s+отправил/i.test(full)) return null;
  const amount = parseAmount(full);
  if (!amount) return null;
  if (!INCOMING.test(full) && !/^\s*\+/.test(text)) return null;
  return { amount, sender: parseSender(title, text) };
}

module.exports = { parseNotification, parseAmount, parseSender };
