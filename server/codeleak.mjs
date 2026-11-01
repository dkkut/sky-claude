/**
 * Защита от передачи кода подтверждения в чате.
 *
 * Мошенники просят «скинуть код из SMS/письма» — это и есть вход в чужой аккаунт. Если человек отправляет в сообщении ЕГО ЖЕ действующий,
 * ещё не использованный код (вход, смена контакта и т. п.), сервер:
 *   1) НЕ доставляет сообщение (оно не сохраняется и не уходит собеседнику);
 *   2) гасит все действующие коды этого аккаунта;
 *   3) на срок `CODE_LEAK_FREEZE_HOURS` (1 ч) замораживает НОВЫЕ входы (открытые сессии работают; тот же механизм, что «Заморозка новых входов»);
 *   4) объясняет причину человеку: ответ сокета, запись в «Уведомления» и письмо;
 *   5) пишет событие в журнал безопасности (без текста сообщения и без самого кода).
 * Совпадение проверяется ТОЛЬКО с настоящими действующими кодами отправителя (HMAC от адресата), а не по «похожим на код цифрам» —
 * случайные шесть цифр в сообщении (номер заказа, время) ложных срабатываний не дают. Любой сбой проверки сообщение не блокирует.
 */
import { query } from './db.mjs';
import { hashCode, codesEqual } from './crypto.mjs';
import { logEvent } from './skylog.mjs';
import { freezeForCodeLeak } from './accountfreeze.mjs';
import { notifyGift } from './giftnotify.mjs';
import { botCodeShared } from './skybot.mjs';

const FREEZE_HOURS = Math.max(1, Math.min(72, Number(process.env.CODE_LEAK_FREEZE_HOURS) || 1));

/** Шестизначные кандидаты: «123456», «123 456», «123-456». */
export const candidates = (text) => {
  const s = String(text ?? '');
  const out = new Set();
  for (const m of s.matchAll(/(?<!\d)(\d{3})[\s\-.]?(\d{3})(?!\d)/g)) out.add(m[1] + m[2]);
  return [...out].slice(0, 6);
};

/** Возвращает { leak: true } и принимает меры, либо null. Никогда не бросает. */
export const guardOutgoingText = async (profileId, text) => {
  try {
    const cand = candidates(text);
    if (!cand.length) return null;
    const { rows } = await query(
      `SELECT s.id, s.email, s.phone FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [profileId]);
    const sky = rows[0]; if (!sky) return null;
    const dests = [sky.email, sky.phone].filter(Boolean);
    if (!dests.length) return null;
    const { rows: codes } = await query(
      `SELECT id, destination, code_hash, purpose FROM verification_codes
        WHERE destination = ANY($1) AND NOT consumed AND expires_at > now() AND created_at > now() - interval '15 minutes'`, [dests]);
    let hit = null;
    for (const c of codes) for (const k of cand) if (codesEqual(c.code_hash, hashCode(k, c.destination))) hit = c;
    if (!hit) return null;
    await query(`UPDATE verification_codes SET consumed = TRUE WHERE destination = ANY($1) AND NOT consumed`, [dests]);
    const until = await freezeForCodeLeak(sky.id, FREEZE_HOURS, { purpose: hit.purpose });
    try { logEvent({ category: 'security', service: 'messenger', type: 'login_code_shared', targetId: sky.id, detail: { purpose: hit.purpose, freezeHours: FREEZE_HOURS } }); } catch { /* журнал не мешает */ }
    try {
      await notifyGift(profileId, 'account_security', 'Код подтверждения нельзя передавать',
        `Вы отправили в чат действующий код подтверждения. Его просят именно ради входа в ваш аккаунт, поэтому сообщение не отправлено, код отменён, а новые входы заморожены на ${FREEZE_HOURS} ч. Уже открытые сессии работают. Сотрудники Sky никогда не спрашивают код.`);
    } catch { /* уведомление не критично */ }
    void botCodeShared(profileId, FREEZE_HOURS).catch(() => {});
    return { leak: true, until, hours: FREEZE_HOURS };
  } catch (e) {
    console.error('[codeleak]', e?.message);
    return null;
  }
};
