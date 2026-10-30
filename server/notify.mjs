/**
 * Доставка кодов: SMS и почта.
 *
 * Провайдер выбирается переменными окружения. Каждый режим либо
 * действительно отправляет сообщение, либо честно возвращает ошибку —
 * «сделать вид, что ушло» нельзя: человек будет ждать код, которого нет,
 * а вход окажется закрыт без объяснений.
 *
 * Режим 'log' пишет код в журнал сервера. Это отладочный режим: любой,
 * у кого есть доступ к логам, увидит коды входа и войдёт под чужим
 * аккаунтом. Поэтому в бою он требует отдельного разрешения
 * (ALLOW_LOG_CODES=1) и громко предупреждает при запуске.
 */
import { config } from './config.mjs';

/** Общий таймаут на обращение к провайдеру. */
const TIMEOUT_MS = 10_000;

/**
 * Заголовок с токеном провайдера.
 *
 * В заголовки HTTP можно класть только латиницу: одна кириллическая
 * буква в токене — и отправка падает целиком, а человек видит лишь
 * «не удалось отправить». Такой токен отбрасываем с понятной жалобой:
 * настоящие ключи провайдеров всегда латинские.
 */
const asciiOnly = (value) => /^[\x21-\x7e]*$/.test(String(value ?? ''));

const authHeader = (token, where) => {
  if (!token) return {};
  if (!asciiOnly(token)) {
    console.error(`[${where}] токен содержит недопустимые символы — заголовок не отправлен.`);
    return {};
  }
  return { Authorization: `Bearer ${token}` };
};

/**
 * Разрешён ли отладочный режим здесь и сейчас.
 * Вынесено отдельно: одинаково для SMS и для почты.
 */
const logAllowed = () => config.nodeEnv !== 'production' || config.allowLogCodes;

/* ─── SMS ──────────────────────────────────────────────────────────────── */

const smsProviders = {
  /** Отладочный режим: код виден в журнале сервера. */
  async log(phone, text) {
    if (!logAllowed()) {
      console.error('[sms] SMS_MODE=log в бою запрещён: задайте провайдера ' +
                    'или ALLOW_LOG_CODES=1, если понимаете последствия.');
      return { ok: false, error: 'sms_not_configured' };
    }
    console.log(`[sms:log] ${phone} → ${text}`);
    return { ok: true };
  },

  /**
   * sms.ru. Нужен SMS_API_ID; SMS_FROM — только если имя отправителя
   * согласовано с провайдером.
   */
  async smsru(phone, text) {
    if (!config.smsApiId) return { ok: false, error: 'sms_not_configured' };

    const to = phone.replace(/\D/g, '');
    const params = new URLSearchParams({ api_id: config.smsApiId, to, msg: text, json: '1' });
    if (config.smsFrom) params.set('from', config.smsFrom);

    try {
      const res = await fetch('https://sms.ru/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json();

      // Общий статус «OK» ещё не значит, что приняли именно этот номер:
      // отказ по конкретному адресату лежит в data.sms[номер].
      const perNumber = data?.sms?.[to];
      const accepted = data?.status === 'OK' && (!perNumber || perNumber.status === 'OK');
      if (!accepted) {
        const why = perNumber?.status_text ?? data?.status_text ?? data?.status_code;
        console.error('[sms:smsru] отказ провайдера:', why);
        return { ok: false, error: 'sms_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[sms:smsru] сеть:', err.message);
      return { ok: false, error: 'sms_delivery_failed' };
    }
  },

  /**
   * TextBee — шлюз, который отправляет SMS через ваш собственный
   * телефон с Android. Нужен ключ из личного кабинета (SMS_API_ID);
   * SMS_DEVICE_ID указывать не обязательно — без него берётся телефон,
   * выходивший на связь последним.
   */
  async textbee(phone, text) {
    if (!config.smsApiId) return { ok: false, error: 'sms_not_configured' };
    if (!asciiOnly(config.smsApiId)) {
      console.error('[sms:textbee] ключ содержит недопустимые символы.');
      return { ok: false, error: 'sms_not_configured' };
    }

    const body = { recipients: [phone], message: text };
    if (config.smsDeviceId) body.deviceId = config.smsDeviceId;

    try {
      const res = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': config.smsApiId },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) {
        // Тело ответа при отказе содержит причину — она пригодится,
        // а сам код сообщения в журнал не попадает.
        const why = await res.text().catch(() => '');
        console.error(`[sms:textbee] шлюз ответил ${res.status}: ${why.slice(0, 200)}`);
        return { ok: false, error: 'sms_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[sms:textbee] сеть:', err.message);
      return { ok: false, error: 'sms_delivery_failed' };
    }
  },

  /**
   * Любой другой провайдер через свой обработчик: POST с JSON
   * { to, text }. Пригодится, если ни sms.ru, ни TextBee не подходят.
   */
  async webhook(phone, text) {
    if (!config.smsWebhookUrl) return { ok: false, error: 'sms_not_configured' };
    try {
      const res = await fetch(config.smsWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(config.smsWebhookToken, 'sms:webhook'),
        },
        body: JSON.stringify({ to: phone, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error('[sms:webhook] обработчик ответил', res.status);
        return { ok: false, error: 'sms_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[sms:webhook] сеть:', err.message);
      return { ok: false, error: 'sms_delivery_failed' };
    }
  },
};

/**
 * Жёсткий потолок на отправку: зависший почтовый или SMS-сервер не должен держать ответ входа
 * дольше 15 секунд — человек получает понятную ошибку доставки, а не «тишину».
 */
const withDeadline = (p, kind) => Promise.race([
  p,
  new Promise((resolve) => setTimeout(() => {
    console.error(`[${kind}] отправка не уложилась в 15 с — отвечаем ошибкой доставки`);
    resolve({ ok: false, error: `${kind}_delivery_failed` });
  }, 15_000).unref?.()),
]);

export const sendSms = async (phone, text) => {
  const provider = smsProviders[config.smsMode];
  if (!provider) {
    console.error(`[sms] SMS_MODE=${config.smsMode} — такого провайдера нет, код не отправлен.`);
    return { ok: false, error: 'sms_not_configured' };
  }
  return withDeadline(provider(phone, text), 'sms');
};

/* ─── Почта ────────────────────────────────────────────────────────────── */

/**
 * Соединение с почтовым сервером держим одно на процесс: на каждый код
 * заново здороваться с сервером и заново проходить TLS — лишние секунды
 * и лишний повод для отказа по частоте подключений.
 */
let mailer = null;
const getMailer = async () => {
  if (mailer) return mailer;
  const { createTransport } = await import('nodemailer');
  mailer = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    pool: true,
    maxConnections: 3,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 20_000,
    // Без шифрования не отправляем вовсе: письмо с кодом не должно
    // идти по сети открытым текстом. requireTLS заставляет перейти на
    // TLS даже когда порт не «сразу защищённый» (587 вместо 465).
    requireTLS: true,
    // Самоподписанные сертификаты не принимаем: иначе кто угодно
    // посередине представится вашим почтовым сервером.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });
  return mailer;
};

const emailProviders = {
  async log(to, subject, text, extra) {
    if (!logAllowed()) {
      console.error('[email] EMAIL_MODE=log в бою запрещён: задайте провайдера ' +
                    'или ALLOW_LOG_CODES=1, если понимаете последствия.');
      return { ok: false, error: 'email_not_configured' };
    }
    console.log(`[email:log] ${to} | ${subject} | ${text}${extra?.html ? ' | +html' : ''}`);
    return { ok: true };
  },

  /** Обычный почтовый ящик хостинга. */
  async smtp(to, subject, text, extra) {
    if (!config.smtpHost || !config.emailFrom) return { ok: false, error: 'email_not_configured' };
    try {
      const transport = await getMailer();
      await transport.sendMail({ from: config.emailFrom, to, subject, text, ...(extra?.html ? { html: extra.html } : {}), ...(extra?.headers ? { headers: extra.headers } : {}) });
      return { ok: true };
    } catch (err) {
      console.error('[email:smtp]', err.message);
      return { ok: false, error: 'email_delivery_failed' };
    }
  },

  /** Resend — почтовый сервис с обычным HTTP-интерфейсом. */
  async resend(to, subject, text, extra) {
    if (!config.resendApiKey || !config.emailFrom) return { ok: false, error: 'email_not_configured' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.resendApiKey}`,
        },
        body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, ...(extra?.html ? { html: extra.html } : {}), ...(extra?.headers ? { headers: extra.headers } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        // Причина от Resend (неверный ключ, домен/отправитель не подтверждён, лимит тарифа) — в журнал, без ключа и адресов.
        const why = await res.text().then((t) => { try { const j = JSON.parse(t); return String(j.message || j.name || t); } catch { return t; } }).catch(() => '');
        console.error('[email:resend] сервис ответил', res.status, why.replace(/re_[A-Za-z0-9_]+/g, '***').replace(/[\w.+-]+@[\w.-]+/g, '<адрес>').slice(0, 200));
        return { ok: false, error: 'email_delivery_failed' };
      }
      return { ok: true };
    } catch (err) {
      console.error('[email:resend] сеть:', err.message);
      return { ok: false, error: 'email_delivery_failed' };
    }
  },

  /** Любой другой сервис через свой обработчик: POST { to, subject, text }. */
  async webhook(to, subject, text, extra) {
    if (!config.emailWebhookUrl) return { ok: false, error: 'email_not_configured' };
    try {
      const res = await fetch(config.emailWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(config.emailWebhookToken, 'email:webhook'),
        },
        body: JSON.stringify({ to, subject, text, ...(extra?.html ? { html: extra.html } : {}), ...(extra?.headers ? { headers: extra.headers } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
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

/** extra — необязательно: { html, headers }. Без него поведение прежнее (только текст). */
export const sendEmail = async (to, subject, text, extra) => {
  const provider = emailProviders[config.emailMode];
  if (!provider) {
    console.error(`[email] EMAIL_MODE=${config.emailMode} — такого провайдера нет, письмо не отправлено.`);
    return { ok: false, error: 'email_not_configured' };
  }
  return withDeadline(provider(to, subject, text, extra), 'email');
};

/* ─── Проверка настроек при запуске ────────────────────────────────────── */

/**
 * Говорит вслух, чем всё кончится, ещё до первой попытки войти.
 * Молча запуститься с неработающей доставкой хуже, чем не запуститься:
 * поломка обнаружится только тогда, когда кто-то не сможет войти.
 */
export const checkDeliverySetup = () => {
  const problems = [];

  if (!smsProviders[config.smsMode]) {
    problems.push(`SMS_MODE=${config.smsMode} — такого провайдера нет.`);
  } else if (config.smsMode === 'log') {
    problems.push(logAllowed()
      ? 'SMS_MODE=log — коды входа пишутся в журнал и никому не отправляются.'
      : 'SMS_MODE=log запрещён в бою: войти не сможет никто. Задайте SMS_MODE=smsru и SMS_API_ID.');
  } else if ((config.smsMode === 'smsru' || config.smsMode === 'textbee') && !config.smsApiId) {
    problems.push(`SMS_MODE=${config.smsMode}, но SMS_API_ID пуст — SMS отправлять нечем.`);
  } else if (config.smsMode === 'webhook' && !config.smsWebhookUrl) {
    problems.push('SMS_MODE=webhook, но SMS_WEBHOOK_URL пуст.');
  }

  if (!emailProviders[config.emailMode]) {
    problems.push(`EMAIL_MODE=${config.emailMode} — такого провайдера нет.`);
  } else if (config.emailMode === 'log') {
    problems.push(logAllowed()
      ? 'EMAIL_MODE=log — коды на почту пишутся в журнал и никому не отправляются.'
      : 'EMAIL_MODE=log запрещён в бою: привязка почты и второй фактор по почте работать не будут.');
  } else if (config.emailMode === 'smtp' && (!config.smtpHost || !config.emailFrom)) {
    problems.push('EMAIL_MODE=smtp, но не заданы SMTP_HOST или EMAIL_FROM.');
  } else if (config.emailMode === 'resend' && (!config.resendApiKey || !config.emailFrom)) {
    problems.push('EMAIL_MODE=resend, но не заданы RESEND_API_KEY или EMAIL_FROM.');
  } else if (config.emailMode === 'webhook' && !config.emailWebhookUrl) {
    problems.push('EMAIL_MODE=webhook, но EMAIL_WEBHOOK_URL пуст.');
  }

  for (const [name, value] of [
    ['SMS_WEBHOOK_TOKEN', config.smsWebhookToken],
    ['EMAIL_WEBHOOK_TOKEN', config.emailWebhookToken],
    ['SMS_API_ID', config.smsApiId],
    ['RESEND_API_KEY', config.resendApiKey],
  ]) {
    if (value && !asciiOnly(value)) problems.push(`${name} содержит нелатинские символы — он не пройдёт.`);
  }

  for (const p of problems) console.warn(`[доставка] ${p}`);
  return problems;
};

/** Закрывает соединение с почтовым сервером при остановке процесса. */
export const closeMailer = () => {
  mailer?.close?.();
  mailer = null;
};
