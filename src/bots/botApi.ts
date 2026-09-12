/**
 * Sky Bots: разговор с сервером.
 *
 * Здесь только вызовы. Кому что можно — решает сервер, и ни одна
 * проверка отсюда его проверку не заменяет: этот файл живёт в браузере,
 * а браузер переписывается.
 *
 * Отдельно стоит сказать, чего здесь НЕТ. Раньше в этом модуле код
 * бота выполнялся прямо в браузере автора — в Web Worker. Бот работал,
 * пока открыта вкладка, и отвечал только своему создателю. Теперь код
 * бота живёт на сервере владельца, а браузер лишь управляет карточкой
 * и смотрит состояние.
 */
import { apiCall } from '@/core/auth/api';

/* ─── Что такое бот снаружи ─────────────────────────────────────── */

export interface BotCommand { cmd: string; desc: string }

/** Состояние сервера владельца — то, что видно в «Моих ботах». */
export interface RuntimeState {
  linked: boolean;
  /** unlinked · online · connecting · error · offline */
  status: 'unlinked' | 'online' | 'connecting' | 'error' | 'offline';
  label?: string;
  delivery?: 'poll' | 'webhook';
  version?: string | null;
  sdk?: string | null;
  connectedAt?: string | null;
  lastSeen?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  eventsSent?: number;
  actionsDone?: number;
}

export interface Bot {
  id: string;
  name: string;
  username: string;
  shortDesc: string;
  desc: string;
  category: string;
  /** Короткое слово; значок подбирает botIcon(). */
  icon: string;
  accent: string;
  verified: boolean;
  inline: boolean;
  inlineTrigger?: string;
  inlinePlaceholder?: string;
  users: number;
  /** Поднят ли сервер владельца. «Онлайн» без этого — обман. */
  online: boolean;
  commands: BotCommand[];

  /* Дальше — только для своего бота. */
  own?: boolean;
  status?: 'private' | 'pending' | 'published' | 'rejected';
  rejectReason?: string;
  codeLang?: string;
  hasCode?: boolean;
  createdAt?: string;
  runtime?: RuntimeState;
  queued?: number;
}

export interface BotLogLine {
  id: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  detail: string;
  at: string;
}

/** Сообщение в диалоге с ботом — то же, что и в мессенджере. */
export interface BotMessage {
  id: string;
  chatId: string;
  authorId: string;
  text: string;
  kind: string;
  createdAt: string;
  fromMe?: boolean;
  viaBot?: string;
  [key: string]: unknown;
}

/* ─── Каталог ───────────────────────────────────────────────────── */

export const apiBotCatalog = (q = '', category = '') => {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (category && category !== 'Все') p.set('category', category);
  const tail = p.toString();
  return apiCall<{ bots: Bot[]; categories: string[] }>(
    `/api/bots/catalog${tail ? `?${tail}` : ''}`,
  );
};

export const apiBot = (botId: string) =>
  apiCall<{ bot: Bot }>(`/api/bots/${encodeURIComponent(botId)}`);

export const apiBotByUsername = (username: string) =>
  apiCall<{ bot: Bot }>(`/api/bots/by-username/${encodeURIComponent(username.replace(/^@/, ''))}`);

/* ─── «Мои боты» ────────────────────────────────────────────────── */

export const apiMyBots = () => apiCall<{ bots: Bot[] }>('/api/bots/mine');

export interface BotDraft {
  name: string;
  username: string;
  shortDesc?: string;
  desc?: string;
  category?: string;
  icon?: string;
  accent?: string;
  code?: string;
  codeLang?: string;
}

export const apiCreateBot = (draft: BotDraft) =>
  apiCall<{ bot: Bot }>('/api/bots', { method: 'POST', body: JSON.stringify(draft) });

export const apiUpdateBot = (botId: string, patch: Partial<BotDraft> & {
  inline?: boolean; inlineTrigger?: string; inlinePlaceholder?: string;
}) =>
  apiCall<{ bot: Bot }>(`/api/bots/${encodeURIComponent(botId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });

export const apiDeleteBot = (botId: string) =>
  apiCall<{ ok: true }>(`/api/bots/${encodeURIComponent(botId)}`, { method: 'DELETE' });

/** Черновик кода. Sky его хранит и показывает, но не запускает. */
export const apiBotCode = (botId: string) =>
  apiCall<{ code: string; lang: string }>(`/api/bots/${encodeURIComponent(botId)}/code`);

export const apiSetCommands = (botId: string, commands: BotCommand[]) =>
  apiCall<{ commands: BotCommand[] }>(`/api/bots/${encodeURIComponent(botId)}/commands`,
    { method: 'PUT', body: JSON.stringify({ commands }) });

export const apiBotLog = (botId: string, limit = 100) =>
  apiCall<{ log: BotLogLine[] }>(`/api/bots/${encodeURIComponent(botId)}/log?limit=${limit}`);

/* ─── Сервер владельца ──────────────────────────────────────────── */

/**
 * Код привязки.
 *
 * Показывается один раз, тому, кто его заказал. Повторно его не
 * узнать — только выпустить новый. В журнале его тоже нет.
 */
export const apiCreatePairing = (botId: string) =>
  apiCall<{ code: string; expiresIn: number }>(
    `/api/bots/${encodeURIComponent(botId)}/pairing`, { method: 'POST' });

export const apiUnlinkRuntime = (botId: string) =>
  apiCall<{ ok: true }>(`/api/bots/${encodeURIComponent(botId)}/unlink`, { method: 'POST' });

export const apiSetDelivery = (botId: string, mode: 'poll' | 'webhook', webhookUrl?: string) =>
  apiCall<{ delivery: string; url?: string; webhookSecret?: string }>(
    `/api/bots/${encodeURIComponent(botId)}/delivery`,
    { method: 'POST', body: JSON.stringify({ mode, webhookUrl }) });

/* ─── Публикация ────────────────────────────────────────────────── */

export const apiSubmitBot = (botId: string) =>
  apiCall<{ bot: Bot }>(`/api/bots/${encodeURIComponent(botId)}/submit`, { method: 'POST' });

export const apiUnpublishBot = (botId: string) =>
  apiCall<{ bot: Bot }>(`/api/bots/${encodeURIComponent(botId)}/unpublish`, { method: 'POST' });

export const apiBotModerationQueue = () =>
  apiCall<{ bots: (Bot & { ownerName: string; submittedAt: string })[] }>('/api/bots/moderation');

export const apiModerateBot = (botId: string, approve: boolean, reason = '') =>
  apiCall<{ ok: true }>('/api/bots/moderation',
    { method: 'POST', body: JSON.stringify({ botId, approve, reason }) });

/* ─── Разговор с ботом ──────────────────────────────────────────── */

export const apiBotDialog = (botId: string, limit = 50) =>
  apiCall<{ chatId: string; botProfileId: string; messages: BotMessage[] }>(
    `/api/bots/${encodeURIComponent(botId)}/dialog?limit=${limit}`);

export const apiSendToBot = (botId: string, text: string, fromName = '') =>
  apiCall<{ chatId: string; message: BotMessage; queued: boolean }>(
    `/api/bots/${encodeURIComponent(botId)}/dialog`,
    { method: 'POST', body: JSON.stringify({ text, fromName }) });

/* ─── Inline ────────────────────────────────────────────────────── */

export interface InlineBotHint {
  id: string;
  name: string;
  username: string;
  icon: string;
  accent: string;
  trigger: string;
  placeholder: string;
  verified: boolean;
  online: boolean;
}

export interface InlineResult { id: string; title: string; text: string }

/** Подсказка по # — только опубликованные inline-боты. */
export const apiInlineBots = (q = '') =>
  apiCall<{ bots: InlineBotHint[] }>(`/api/bots/inline${q ? `?q=${encodeURIComponent(q)}` : ''}`);

/**
 * Спросить inline-бота.
 *
 * Ничего не отправляет: возвращает варианты. Отправит их человек,
 * нажав «Отправить», — см. apiInlineConfirm.
 */
export const apiInlineQuery = (chatId: string, trigger: string, query: string, fromName = '') =>
  apiCall<{ bot: InlineBotHint; results: InlineResult[] }>('/api/bots/inline/query',
    { method: 'POST', body: JSON.stringify({ chatId, trigger, query, fromName }) });

/**
 * Подтверждение: сообщение уходит от имени человека.
 *
 * Автора ставит сервер — того, кто нажал. Бот в этот момент уже не
 * участвует: он своё дело сделал, когда предложил текст.
 */
export const apiInlineConfirm = (chatId: string, pendingId: string) =>
  apiCall<{ message: BotMessage; chatId: string }>('/api/bots/inline/confirm',
    { method: 'POST', body: JSON.stringify({ chatId, pendingId }) });

/* ─── Человеческие названия отказов ─────────────────────────────── */

export const BOT_ERRORS: Record<string, string> = {
  invalid_name:              'Название: от 2 до 64 символов',
  invalid_username:          'Ник: 3–32 символа, латиница, цифры и _',
  username_must_end_with_bot: 'Ник бота должен оканчиваться на «bot»',
  username_taken:            'Такой ник уже занят',
  invalid_trigger:           'Триггер: 2–24 символа, без пробелов',
  trigger_taken:             'Такой триггер уже занят другим ботом',
  too_many:                  'Больше 20 ботов на один профиль нельзя',
  code_too_large:            'Код длиннее 256 КБ',
  runtime_required:          'Сначала подключите свой сервер: без него бот не сможет отвечать',
  not_linked:                'Сервер не подключён',
  already_pending:           'Бот уже на проверке',
  already_published:         'Бот уже опубликован',
  invalid_webhook_url:       'Проверьте адрес вебхука',
  webhook_must_be_https:     'Вебхук принимается только по https',
  webhook_host_not_allowed:  'Такой адрес не подходит: нужен обычный домен в интернете',
  invalid_webhook_port:      'Для вебхука подходят порты 443 и 8443',
  bot_not_found:             'Такого бота нет',
  bot_timeout:               'Сервер бота не ответил',
  bot_unavailable:           'Бот сейчас недоступен',
  bot_mismatch:              'Ответ пришёл не от того бота',
  expired:                   'Предложение устарело — вызовите бота заново',
  too_many_requests:         'Слишком часто. Попробуйте позже',
};

export const explainBot = (error?: string, fallback = 'Не получилось') =>
  (error && BOT_ERRORS[error]) || fallback;
