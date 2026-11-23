// Расшифровать резервную копию KZStream:  node decrypt-backup.js kzstream-backup-private.pem kzstream-db.kzb
// На выходе — kzstream-db.json (все аккаунты, донаты и настройки).
const fs = require('fs'), crypto = require('crypto'), zlib = require('zlib');
const [, , keyFile, inFile] = process.argv;
if (!keyFile || !inFile) { console.log('Использование: node decrypt-backup.js <закрытый ключ .pem> <файл .kzb>'); process.exit(1); }
const b = fs.readFileSync(inFile);
if (b.slice(0, 4).toString() !== 'KZB1') throw new Error('Это не резервная копия KZStream');
const n = b.readUInt16BE(4); let o = 6;
const ek = b.slice(o, o += n), iv = b.slice(o, o += 12), tag = b.slice(o, o += 16), enc = b.slice(o);
const key = crypto.privateDecrypt({ key: fs.readFileSync(keyFile), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ek);
const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
const out = zlib.gunzipSync(Buffer.concat([d.update(enc), d.final()]));
fs.writeFileSync(inFile.replace(/\.kzb$/, '') + '.json', out);
console.log('Готово:', inFile.replace(/\.kzb$/, '') + '.json');
