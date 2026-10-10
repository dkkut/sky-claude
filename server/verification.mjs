/**
 * Одноразовые коды подтверждения для телефона и почты.
 *
 * Здесь собраны все ограничения, без которых код по SMS превращается
 * в способ перебирать аккаунты и разорять владельца на рассылке:
 *
 *   • пауза между отправками на один и тот же адрес;
 *   • потолок числа кодов за час;
 *   • срок жизни кода;
 *   • ограничение числа попыток ввода;
 *   • код одноразовый — после успешной проверки гасится.
 *
 * Сам код в базе не лежит: хранится HMAC (см. server/crypto.mjs).
 */
import { L } from './lang.mjs';
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { generateNumericCode, hashCode, codesEqual } from './crypto.mjs';
import { sendSms, sendEmail } from './notify.mjs';

/** Сколько живёт код. */
const TTL_SEC = 5 * 60;
/** Пауза до повторной отправки — она же таймер на экране. */
export const RESEND_COOLDOWN_SEC = 60;
/**
 * Потолок отправок на один адрес за час.
 *
 * У SMS он ниже: каждое сообщение стоит денег, а чужой телефон, звенящий
 * без спроса, — это уже травля. Письма дешевле и никого не будят, а на
 * почту в обычной жизни кодов уходит больше: подтвердить адрес, включить
 * второй фактор, войти пару раз.
 */
const MAX_PER_HOUR = { phone: 5, email: 12 };
const hourlyLimit = (channel) => MAX_PER_HOUR[channel] ?? 5;
/** Сколько раз можно ошибиться, прежде чем код сгорит. */
const MAX_ATTEMPTS = 5;


/**
 * Выдаёт новый код.
 *
 * Возвращает { ok, retryAfter, expiresIn } либо { error }. Наружу
 * никогда не отдаёт сам код: в режиме отладки он уходит в лог сервера.
 */
export const issueCode = async (channel, destination, purpose) => {
  // Сколько секунд назад отправляли последний код.
  const { rows: recent } = await query(
    `SELECT created_at FROM verification_codes
      WHERE channel = $1 AND destination = $2 AND purpose = $3
      ORDER BY created_at DESC LIMIT 1`,
    [channel, destination, purpose],
  );
  if (recent[0]) {
    const elapsed = (Date.now() - recent[0].created_at.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SEC) {
      return { error: 'too_soon', retryAfter: Math.ceil(RESEND_COOLDOWN_SEC - elapsed) };
    }
  }

  const { rows: hourly } = await query(
    `SELECT count(*)::int AS n FROM verification_codes
      WHERE channel = $1 AND destination = $2 AND created_at > now() - interval '1 hour'`,
    [channel, destination],
  );
  if (hourly[0].n >= hourlyLimit(channel)) {
    return { error: 'too_many_requests' };
  }

  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + TTL_SEC * 1000);

  const codeId = `vc-${generateId()}`;
  await query(
    `INSERT INTO verification_codes (id, channel, destination, code_hash, purpose, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [codeId, channel, destination, hashCode(code, destination), purpose, expiresAt],
  );

  const delivery = channel === 'phone'
    ? await sendSms(destination, L(`Код Sky ID: ${code}. Никому его не сообщайте.`, `Sky ID code: ${code}. Do not share it with anyone.`))
    : await sendEmail(destination, L('Код Sky ID', 'Sky ID code'),
        L(
          `Ваш код подтверждения: ${code}\n\n` +
          `Код действует ${Math.round(TTL_SEC / 60)} минут. Никому его не сообщайте — ` +
          `сотрудники Sky никогда не спрашивают код.\n` +
          `Если вы ничего не запрашивали, просто не отвечайте на это письмо.`,
          `Your confirmation code: ${code}\n\n` +
          `The code is valid for ${Math.round(TTL_SEC / 60)} minutes. Do not share it with anyone — ` +
          `Sky staff never ask for the code.\n` +
          `If you did not request anything, just do not reply to this email.`,
        ));

  if (!delivery.ok) {
    // Провайдер не настроен — это наша поломка, а не поведение человека.
    // Запись удаляем, иначе он ещё и в паузу упрётся из-за кода, который
    // никуда не ушёл. Настоящий сбой доставки запись оставляет: иначе
    // сломанный провайдер превращается в бесплатный усилитель рассылки.
    if (String(delivery.error ?? '').endsWith('_not_configured')) {
      await query('DELETE FROM verification_codes WHERE id = $1', [codeId]);
    }
    return { error: delivery.error ?? 'delivery_failed' };
  }

  return { ok: true, retryAfter: RESEND_COOLDOWN_SEC, expiresIn: TTL_SEC };
};

/**
 * Проверяет код.
 *
 * Ошибку не детализируем сверх нужного: «неверный код» и «код истёк» —
 * разные подсказки, а вот отличать «такого адреса не было» отдельным
 * ответом не стоит, иначе по ответам собирают список номеров.
 */
export const verifyCode = async (channel, destination, purpose, code) => {
  const { rows } = await query(
    `SELECT * FROM verification_codes
      WHERE channel = $1 AND destination = $2 AND purpose = $3 AND NOT consumed
      ORDER BY created_at DESC LIMIT 1`,
    [channel, destination, purpose],
  );
  const record = rows[0];
  if (!record) return { error: 'invalid_code' };

  if (record.expires_at.getTime() < Date.now()) return { error: 'code_expired' };

  if (record.attempts >= MAX_ATTEMPTS) {
    return { error: 'too_many_attempts' };
  }

  const matches = codesEqual(record.code_hash, hashCode(String(code ?? ''), destination));
  if (!matches) {
    const { rows: upd } = await query(
      'UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
      [record.id],
    );
    const left = Math.max(0, MAX_ATTEMPTS - upd[0].attempts);
    return { error: 'invalid_code', attemptsLeft: left };
  }

  // Код одноразовый: гасим сразу, чтобы одним кодом нельзя было
  // подтвердить два действия.
  await query('UPDATE verification_codes SET consumed = TRUE WHERE id = $1', [record.id]);
  return { ok: true };
};

/** Сколько секунд осталось до возможности запросить код повторно. */
export const cooldownLeft = async (channel, destination, purpose) => {
  const { rows } = await query(
    `SELECT created_at FROM verification_codes
      WHERE channel = $1 AND destination = $2 AND purpose = $3
      ORDER BY created_at DESC LIMIT 1`,
    [channel, destination, purpose],
  );
  if (!rows[0]) return 0;
  const elapsed = (Date.now() - rows[0].created_at.getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SEC - elapsed));
};

/** Чистка отработавших записей — вызывается по расписанию из server.mjs. */
export const purgeExpiredCodes = async () => {
  const { rowCount } = await query(
    `DELETE FROM verification_codes
      WHERE expires_at < now() - interval '1 day'`,
  );
  return rowCount;
};

export const VERIFICATION_LIMITS = { TTL_SEC, RESEND_COOLDOWN_SEC, MAX_PER_HOUR, MAX_ATTEMPTS };
