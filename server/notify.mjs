/**
 * Доставка кодов: SMS и почта.
 *
 * Провайдер подключается переменными окружения. По умолчанию режим
 * 'log' — код пишется в журнал сервера и никуда не уходит. Это годится
 * для отладки и для первого запуска, но в бою так оставлять нельзя:
 * любой, у кого есть доступ к логам, увидит коды входа.
 *
 * Если провайдер не настроен, отправка возвращает ошибку, а не делает
 * вид, что сообщение ушло: иначе человек ждал бы SMS, которого нет.
 */
import { config } from './config.mjs';

/* ─── SMS ──────────────────────────────────────────────────────────────── */

const smsProviders = {
  /** Отладочный режим: код виден в логах сервера. */
  async log(phone, text) {
    console.log(`[sms:log] ${phone} → ${text}`);
    return { ok: true };
  },

  /**
   * sms.ru — провайдер, упомянутый в документации проекта.
   * Нужны SMS_API_ID и, при отправке от имени отправителя, SMS_FROM.
   */
  async smsru(phone, text) {
    if (!config.smsApiId) return { ok: false, error: 'sms_not_configured' };

    const params = new URLSearchParams({
      api_id: config.smsApiId,
      to: phone.replace(/[^\d]/g, ''),
      msg: text,
      json: '1',
    });
    if (config.smsFrom) params.set('from', config.smsFrom);

    try {
      const res = await fetch('https://sms.ru/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      if (data?.status !== 'OK') {
        console.error('[sms:smsru] отказ провайдера:', data?.status_text ?? data?.status_code);
        return { ok: false, error: 'sms_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[sms:smsru] сеть:', err.message);
      return { ok: false, error: 'sms_delivery_failed' };
    }
  },
};

export const sendSms = async (phone, text) => {
  const provider = smsProviders[config.smsMode];
  if (!provider) {
    console.error(`[sms] SMS_MODE=${config.smsMode} — провайдер не настроен, код не отправлен.`);
    return { ok: false, error: 'sms_not_configured' };
  }
  return provider(phone, text);
};

/* ─── Почта ────────────────────────────────────────────────────────────── */

const emailProviders = {
  async log(to, subject, text) {
    console.log(`[email:log] ${to} | ${subject} | ${text}`);
    return { ok: true };
  },

  /**
   * Отправка через внешний обработчик: POST с JSON на указанный адрес.
   * Так подключается любой почтовый сервис без библиотеки SMTP в образе.
   */
  async webhook(to, subject, text) {
    if (!config.emailWebhookUrl) return { ok: false, error: 'email_not_configured' };
    try {
      const res = await fetch(config.emailWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.emailWebhookToken ? { Authorization: `Bearer ${config.emailWebhookToken}` } : {}),
        },
        body: JSON.stringify({ to, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error('[email:webhook] обработчик ответил', res.status);
        return { ok: false, error: 'email_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[email:webhook] сеть:', err.message);
      return { ok: false, error: 'email_delivery_failed' };
    }
  },
};

export const sendEmail = async (to, subject, text) => {
  const provider = emailProviders[config.emailMode];
  if (!provider) {
    console.error(`[email] EMAIL_MODE=${config.emailMode} — провайдер не настроен, письмо не отправлено.`);
    return { ok: false, error: 'email_not_configured' };
  }
  return provider(to, subject, text);
};
