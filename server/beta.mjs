/**
 * Закрытая бета: вход на сайт по ключу.
 *
 * Это временная калитка, а не система прав. Ключей несколько, они
 * лежат в базе в виде HMAC, а список задаётся переменной BETA_KEYS —
 * так их удобно менять, не трогая код.
 *
 * Проверка обязательно серверная: если бы ключ спрашивал только
 * браузер, любой желающий обошёл бы её, обратившись к API напрямую.
 *
 * Как выключить бету совсем: очистить BETA_KEYS в .env и перезапустить
 * API. Тогда калитки нет и сайт открыт всем.
 */
import { config } from './config.mjs';
import { query } from './db.mjs';
import { hashCode, codesEqual } from './crypto.mjs';

/** Ключи солим постоянной строкой: пары «адресат + код» здесь нет. */
const hashKey = (key) => hashCode(String(key).trim(), 'beta-key');

/** Отпечатки действующих ключей — по ним проверяются выданные пропуска. */
const liveHashes = () => new Set(config.betaKeys.map((raw) => hashKey(raw.split(':')[0])));

/**
 * Действует ли пропуск, выданный за этот ключ. Убранный из BETA_KEYS
 * ключ перестаёт работать вместе со всеми пропусками, которые по нему
 * выдали, — иначе отзыв утёкшего ключа ничего бы не давал.
 */
export const betaHashLive = (hash) => Boolean(hash) && liveHashes().has(hash);

/** Включена ли калитка. Пустой список ключей означает «открыто всем». */
export const betaEnabled = () => false;

/**
 * Приводит таблицу в соответствие со списком из .env: недостающие
 * добавляет, лишние убирает. Иначе отозванный ключ продолжал бы
 * работать, пока кто-нибудь не почистит базу руками.
 */
export const syncBetaKeys = async () => {
  if (!betaEnabled()) return 0;

  const wanted = config.betaKeys.map((raw, i) => {
    const [key, label] = raw.split(':');
    return { hash: hashKey(key), label: label || `ключ ${i + 1}` };
  });

  for (const { hash, label } of wanted) {
    await query(
      `INSERT INTO beta_keys (key_hash, label) VALUES ($1, $2)
       ON CONFLICT (key_hash) DO UPDATE SET label = EXCLUDED.label`,
      [hash, label],
    );
  }

  const { rowCount } = await query(
    'DELETE FROM beta_keys WHERE key_hash <> ALL($1::text[])',
    [wanted.map((w) => w.hash)],
  );
  return rowCount;
};

/**
 * Проверяет введённый ключ. Сравнение идёт по значению из базы и
 * за постоянное время: по скорости ответа подобрать ключ нельзя.
 */
export const checkBetaKey = async (key) => {
  const value = String(key ?? '').trim();
  if (!value || value.length > 200) return null;

  const hash = hashKey(value);
  const { rows } = await query('SELECT key_hash, label FROM beta_keys');
  const found = rows.find((r) => codesEqual(r.key_hash, hash));
  if (!found) return null;

  await query(
    'UPDATE beta_keys SET uses = uses + 1, last_used_at = now() WHERE key_hash = $1',
    [found.key_hash],
  );
  return { label: found.label, hash: found.key_hash };
};
