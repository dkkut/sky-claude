/**
 * Шифрование секретов и хеширование одноразовых кодов.
 *
 * Два разных механизма под две разные задачи:
 *
 *   • Секрет двухэтапной защиты нужно уметь ПРОЧИТАТЬ, чтобы посчитать
 *     по нему текущий TOTP-код, поэтому он шифруется (AES-256-GCM), а не
 *     хешируется. Из дампа базы без ключа его не достать.
 *
 *   • Код из SMS или письма читать обратно не нужно — достаточно сверить.
 *     Поэтому хранится HMAC, а не сам код. Обычный хеш здесь не годится:
 *     шестизначный код перебирается мгновенно, а HMAC без серверного
 *     ключа перебрать по дампу нельзя.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';

/**
 * Ключ шифрования. Отдельная переменная предпочтительнее: если вывести
 * его из JWT_SECRET, то смена подписи токенов сделает нечитаемыми все
 * сохранённые секреты. Вывод оставлен запасным вариантом, чтобы уже
 * работающий сервер не перестал стартовать после обновления.
 */
const keyMaterial = () => {
  if (config.encryptionKey) return Buffer.from(config.encryptionKey, 'utf8');
  console.warn('[crypto] ENCRYPTION_KEY не задан — ключ выводится из JWT_SECRET. '
             + 'Задайте отдельный ключ: смена JWT_SECRET иначе сделает нечитаемыми секреты 2FA.');
  return Buffer.from(config.jwtSecret, 'utf8');
};

// HKDF разводит один секрет на два независимых ключа: даже зная один,
// второй вычислить нельзя.
const derive = (info) =>
  Buffer.from(crypto.hkdfSync('sha256', keyMaterial(), Buffer.alloc(0), Buffer.from(info), 32));

let _encKey = null;
let _macKey = null;
let _contentKey = null;
const encKey = () => (_encKey ??= derive('sky:secret-encryption:v1'));
const macKey = () => (_macKey ??= derive('sky:code-hmac:v1'));
// Отдельный ключ для содержимого переписки: он используется на каждое
// сообщение, а ключ секретов 2FA — изредка. Разводить их стоит хотя бы
// потому, что объём данных под одним ключом лучше не смешивать.
const contentKey = () => (_contentKey ??= derive('sky:message-content:v1'));

/* ─── Секреты двухэтапной защиты ───────────────────────────────────────── */

/** Возвращает строку вида v1.<nonce>.<tag>.<ciphertext> в base64url. */
export const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
          enc.toString('base64url')].join('.');
};

/** Возвращает null на любом повреждённом или подменённом значении. */
export const decryptSecret = (blob) => {
  if (typeof blob !== 'string') return null;
  const [version, ivB64, tagB64, dataB64] = blob.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Неверный тег — значение испорчено или подменено.
    return null;
  }
};

/**
 * Прочитать секрет, который мог быть записан ДО перехода на шифрование (открытым текстом) или уже зашифрован (v1.…).
 * Открытые значения у нас — base64url без точки, поэтому «v1.<…>.<…>.<…>» однозначно отличает зашифрованное.
 * Возвращает null для повреждённого зашифрованного значения. Нужен для безопасной поэтапной миграции (scripts/seal-secrets.mjs).
 */
export const openSecret = (stored) => {
  if (stored == null) return null;
  const s = String(stored);
  return s.startsWith('v1.') && s.split('.').length === 4 ? decryptSecret(s) : s;
};

/** Зашифрована ли уже запись (для миграции). */
export const isSealed = (stored) => typeof stored === 'string' && stored.startsWith('v1.') && stored.split('.').length === 4;

/* ─── Одноразовые коды ─────────────────────────────────────────────────── */

/**
 * HMAC кода вместе с адресатом: один и тот же код на разные номера даёт
 * разные значения, поэтому совпадения по базе ничего не подскажут.
 */
export const hashCode = (code, destination) =>
  crypto.createHmac('sha256', macKey())
        .update(`${destination} ${code}`)
        .digest('base64url');

export const codesEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

/** Числовой код фиксированной длины из криптостойкого источника. */
export const generateNumericCode = (digits = 6) => {
  const max = 10 ** digits;
  // rejection sampling: остаток от деления смещает распределение,
  // поэтому значения выше кратного порога отбрасываем.
  const limit = Math.floor(0xffffffff / max) * max;
  let value;
  do {
    value = crypto.randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return String(value % max).padStart(digits, '0');
};

/* ─── Содержимое переписки ─────────────────────────────────────────────── */
/**
 * Текст сообщений и названия чатов в базе лежат зашифрованными.
 *
 * Это не сквозное шифрование: ключ у сервера, и сервер способен
 * прочитать переписку. Оно защищает от другого — от утечки дампа базы,
 * попавшего не туда бэкапа, украденного диска и от доступа к базе в
 * обход приложения. Называть это E2EE нельзя.
 *
 * Формат тот же, что у секретов: v1.<nonce>.<tag>.<шифротекст>. Номер
 * версии впереди позволяет сменить ключ, не останавливая сервис:
 * старые записи читаются прежним ключом, новые пишутся новым.
 */
export const encryptContent = (plain) => {
  const text = String(plain ?? '');
  if (text === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
          enc.toString('base64url')].join('.');
};

/**
 * Обратное преобразование.
 *
 * Значение, не похожее на шифротекст, возвращается как есть: так читаются
 * записи, сделанные до перехода на шифрование. Подделать шифротекст, не
 * зная ключа, нельзя — GCM проверяет метку целостности, — поэтому
 * «непохоже на шифротекст» здесь безопасно означает «старая запись».
 */
export const decryptContent = (blob) => {
  if (typeof blob !== 'string' || blob === '') return '';
  if (!blob.startsWith('v1.')) return blob;
  const [, ivB64, tagB64, dataB64] = blob.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return blob;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Ключ сменили без перешифровки, или запись повреждена. Отдать
    // мусор нельзя, «потерять» молча — тоже: возвращаем пометку.
    return null;
  }
};

/** Шифрование двоичных данных — для вложений. */
export const encryptBytes = (buf) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey(), iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  // Один буфер: версия, nonce, метка, данные — чтобы файл на диске был
  // самодостаточным и не требовал отдельной таблицы с параметрами.
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), enc]);
};

export const decryptBytes = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 29 || buf[0] !== 1) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey(), buf.subarray(1, 13));
    decipher.setAuthTag(buf.subarray(13, 29));
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]);
  } catch {
    return null;
  }
};
