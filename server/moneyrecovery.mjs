/**
 * Восстановление доступа к SkyMoney по 12 словам и «13-е слово».
 *  • Фраза создаётся на сервере, показывается ОДИН раз; в базе — только scrypt-хеш (соль + перец от JWT_SECRET). Слова нигде не пишутся.
 *  • Устройство не доверенное и фраза задана → вместо кода на почту нужна фраза (moneyguard.moneyState: deviceProof 'phrase').
 *  • «13-е слово» (необязательно, задаёт владелец в настройках): фраза без него открывает ПУСТОЙ кошелёк (режим decoy) — сервер сам отвечает
 *    нулями и пустой историей; с 13-м словом — настоящие данные. Если 13-е слово не задано, фраза сразу открывает настоящие данные.
 *  • На доверенном устройстве режим всегда настоящий. Решает сервер, клиент режим не получает.
 * Перебор: 5 неверных подряд — пауза 15 минут, дальше ×2 (до суток); плюс пределы по запросам.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { logEvent } from './skylog.mjs';

const scrypt = promisify(crypto.scrypt);
const WORDS = readFileSync(new URL('./moneywords.txt', import.meta.url), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);

const normPhrase = (v) => String(Array.isArray(v) ? v.join(' ') : v ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
const normExtra = (v) => String(v ?? '').normalize('NFKC').trim();
const hashOf = async (value, saltHex) => (await scrypt(`${value}:${config.jwtSecret}`, Buffer.from(saltHex, 'hex'), 32)).toString('hex');
const same = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export const generatePhrase = () => Array.from({ length: 12 }, () => WORDS[crypto.randomInt(WORDS.length)]);

const row = async (skyId) => (await query(`SELECT * FROM money_recovery WHERE sky_id = $1`, [skyId])).rows[0] ?? null;

export const recoveryInfo = async (skyId) => {
  const r = await row(skyId);
  return { hasPhrase: Boolean(r), hasExtra: Boolean(r?.extra_hash) };
};

/** Создать (или заменить) фразу. Вызывающий обязан убедиться, что сессия открыта на доверенном устройстве в настоящем режиме. */
export const createPhrase = async (skyId) => {
  const words = generatePhrase();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashOf(normPhrase(words), salt);
  // Новая фраза сбрасывает и 13-е слово: прежнее слово было привязано к прежней фразе.
  await query(
    `INSERT INTO money_recovery (sky_id, phrase_hash, phrase_salt) VALUES ($1,$2,$3)
     ON CONFLICT (sky_id) DO UPDATE SET phrase_hash = $2, phrase_salt = $3, extra_hash = NULL, extra_salt = NULL, fails = 0, locked_until = NULL, updated_at = now()`,
    [skyId, hash, salt]);
  try { logEvent({ category: 'security', service: 'money', type: 'money_phrase_created', targetId: skyId }); } catch { /* журнал */ }
  return { ok: true, words };
};

/** Задать или убрать 13-е слово (word=null — убрать). */
export const setExtra = async (skyId, word) => {
  const r = await row(skyId); if (!r) return { ok: false, error: 'no_phrase' };
  if (word == null || word === '') {
    await query(`UPDATE money_recovery SET extra_hash = NULL, extra_salt = NULL, updated_at = now() WHERE sky_id = $1`, [skyId]);
    try { logEvent({ category: 'security', service: 'money', type: 'money_extra_removed', targetId: skyId }); } catch { /* журнал */ }
    return { ok: true, hasExtra: false };
  }
  const w = normExtra(word);
  if (w.length < 6 || w.length > 64) return { ok: false, error: 'bad_extra' };
  const salt = crypto.randomBytes(16).toString('hex');
  await query(`UPDATE money_recovery SET extra_hash = $2, extra_salt = $3, updated_at = now() WHERE sky_id = $1`, [skyId, await hashOf(w, salt), salt]);
  try { logEvent({ category: 'security', service: 'money', type: 'money_extra_set', targetId: skyId }); } catch { /* журнал */ }
  return { ok: true, hasExtra: true };
};

const penalty = (fails) => Math.min(24 * 3600, 900 * 2 ** Math.max(0, Math.floor(fails / 5) - 1));

/** Проверить фразу (и 13-е слово). Успех → { ok, mode: 'real' | 'decoy' }. */
export const checkPhrase = async (skyId, words, extra) => {
  const r = await row(skyId); if (!r) return { ok: false, error: 'no_phrase' };
  if (r.locked_until && new Date(r.locked_until).getTime() > Date.now()) {
    return { ok: false, error: 'too_many_attempts', retryAfter: Math.ceil((new Date(r.locked_until).getTime() - Date.now()) / 1000) };
  }
  const phrase = normPhrase(words);
  const phraseOk = phrase.split(' ').length === 12 && same(await hashOf(phrase, r.phrase_salt), r.phrase_hash);
  let mode = null;
  if (phraseOk) {
    if (!r.extra_hash) mode = 'real';
    else if (!normExtra(extra)) mode = 'decoy';
    else if (same(await hashOf(normExtra(extra), r.extra_salt), r.extra_hash)) mode = 'real';
  }
  if (!mode) {
    const fails = r.fails + 1;
    const lock = fails % 5 === 0 ? new Date(Date.now() + penalty(fails) * 1000) : null;
    await query(`UPDATE money_recovery SET fails = $2, locked_until = $3 WHERE sky_id = $1`, [skyId, fails, lock]);
    try { logEvent({ category: 'security', service: 'money', type: 'money_phrase_failed', targetId: skyId, detail: { fails } }); } catch { /* журнал */ }
    return { ok: false, error: lock ? 'too_many_attempts' : 'invalid_phrase' };
  }
  await query(`UPDATE money_recovery SET fails = 0, locked_until = NULL WHERE sky_id = $1`, [skyId]);
  // Событие не различает режимы: по журналу нельзя понять, показан ли настоящий кошелёк.
  try { logEvent({ category: 'security', service: 'money', type: 'money_phrase_ok', targetId: skyId }); } catch { /* журнал */ }
  return { ok: true, mode };
};

/** Ответ вместо настоящих данных в режиме «пустой кошелёк»: GET состояния и баланса — нули, остальное — «временно недоступно». */
export const decoyReply = (method, pathname) => {
  if (method === 'GET' && (pathname === '/api/wallet' || pathname === '/api/wallet/balance')) {
    return { status: 200, body: pathname === '/api/wallet' ? { balance: 0, points: 0, transactions: [] } : { balance: 0, points: 0 } };
  }
  if (method === 'GET' && pathname === '/api/wallet/fx') return { status: 200, body: { max: 5, minRub: 10, maxRub: 1000000, currencies: [], accounts: [], history: [], analytics: {} } };
  return { status: 503, body: { error: 'service_unavailable' } };
};
