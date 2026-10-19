// Письмо с хоста: node scripts/notify-mail.mjs <кому> <тема> <текст>
// Использует тот же отправщик, что и коды входа (EMAIL_MODE: resend/smtp/…), поэтому отдельной почты на сервере не нужно.
// Запускается из watchdog через `docker compose run --rm --no-deps api node scripts/notify-mail.mjs …` — работает и когда сам api лежит.
import { sendEmail, closeMailer } from '../server/notify.mjs';
const [to, subject, ...rest] = process.argv.slice(2);
if (!to || !subject) { console.error('Использование: notify-mail.mjs <кому> <тема> <текст>'); process.exit(2); }
const r = await sendEmail(to, subject, rest.join(' ') || subject).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
await closeMailer?.();
if (!r?.ok) { console.error(`[notify-mail] не отправлено: ${r?.error ?? 'неизвестно'}`); process.exit(1); }
console.log('[notify-mail] отправлено');
process.exit(0);
