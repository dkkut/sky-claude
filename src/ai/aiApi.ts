/**
 * Sky AI: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается.
 *
 * В частности, `prime` ниже — это то, что сервер УЖЕ решил по таблице
 * подписок. Поставить его себе в true можно, и кнопки даже появятся —
 * но ни одна Prime-ручка от этого не сработает: сервер спрашивает базу
 * заново на каждом запросе.
 *
 * Чего здесь нет и быть не может: ключа поставщика, адреса поставщика,
 * названия модели и системной части запроса. Всё это знает только
 * сервер. Раньше было иначе — старая функция callAI обращалась к
 * api.anthropic.com прямо отсюда, и именно поэтому Sky AI не работал.
 */
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';

/* ─── Что приходит с сервера ────────────────────────────────────── */

export interface AiChat {
  id: string;
  title: string;
  messages: number;
  createdAt: string;
  updatedAt: string;
}

export type AiTool = 'chat' | 'summary' | 'file' | 'image' | 'transcribe';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tool: AiTool;
  createdAt: string;
}

export interface AiQuota { used: number; limit: number }

export interface AiState {
  /** Названа ли модель владельцем сервера. Нет — Sky AI честно молчит. */
  configured: boolean;
  /** Назван ли поставщик расшифровки речи. Это отдельный поставщик. */
  transcription: boolean;
  /** Назван ли поставщик голосового ответа. Тоже отдельный поставщик:
   *  без него голосовой режим работает, но отвечает только текстом. */
  voiceReply: boolean;
  /** Решение сервера, не браузера. */
  prime: boolean;
  usage: Record<AiTool, AiQuota>;
  primeTools: AiTool[];
  maxMessageChars: number;
  maxSummaryChars: number;
  summaryStyles: { key: string; label: string }[];
  uploadLimits: { document: number; image: number; audio: number };
}

export interface TranscriptCue { at: string; start: number; text: string }

/* ─── Понятные причины отказа ───────────────────────────────────── */

const REASONS: Record<string, string> = {
  prime_required:      'Нужен Sky Prime',
  daily_limit:         'На сегодня лимит исчерпан. Попробуйте завтра',
  rate_limited:        'Слишком часто. Подождите минуту',
  too_many_requests:   'Слишком часто. Подождите',
  ai_not_configured:   'Sky AI пока не настроен на этом сервере',
  stt_not_configured:  'Расшифровка на этом сервере пока не подключена',
  tts_not_configured:  'Голосовой ответ на этом сервере пока не подключён',
  ai_busy:             'Сейчас много запросов. Попробуйте через минуту',
  ai_timeout:          'Ответ занял слишком много времени',
  ai_failed:           'Модель не ответила. Попробуйте позже',
  stt_failed:          'Не удалось расшифровать запись',
  stt_empty:           'В записи не нашлось речи',
  ai_input_too_large:  'Слишком большой материал для одного запроса',
  too_large:           'Файл слишком большой',
  empty_file:          'Файл пустой',
  empty_message:       'Пустое сообщение',
  empty_document:      'В документе не нашлось текста',
  text_too_short:      'Для пересказа нужен текст подлиннее',
  unsupported_type:    'Такой файл не подходит',
  unsupported_image:   'Подходят JPEG, PNG, WebP и GIF',
  unsupported_audio:   'Такая запись не подходит',
  too_many_chats:      'Слишком много диалогов — удалите лишние',
  invalid_title:       'Нужно название',
  not_found:           'Не найдено',
  storage_unavailable: 'На сервере нет места — сообщите владельцу',
  write_failed:        'Не удалось сохранить файл',
};

export const aiReason = (code?: string, fallback = 'Не получилось') =>
  (code && REASONS[code]) || fallback;

/** Отказ, который стоит показать как предложение Prime, а не как ошибку. */
export const isPrimeRefusal = (code?: string) => code === 'prime_required';

/* ─── Состояние ─────────────────────────────────────────────────── */

export const apiAiState = async (): Promise<AiState | null> => {
  const r = await apiCall<AiState>('/api/ai/state');
  return r.ok ? r.data ?? null : null;
};

/* ─── Диалоги: бесплатно ────────────────────────────────────────── */

export const apiAiChats = async (): Promise<AiChat[]> => {
  const r = await apiCall<{ chats: AiChat[] }>('/api/ai/chats');
  return r.ok ? r.data?.chats ?? [] : [];
};

export const apiAiCreateChat = async (title = '') => {
  const r = await apiCall<{ chat: AiChat }>('/api/ai/chats', {
    method: 'POST', body: JSON.stringify({ title }),
  });
  return r.ok
    ? { ok: true as const, chat: r.data?.chat as AiChat }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

export const apiAiReadChat = async (id: string) => {
  const r = await apiCall<{ chat: AiChat; messages: AiMessage[] }>(
    `/api/ai/chat/${encodeURIComponent(id)}`,
  );
  return r.ok ? r.data ?? null : null;
};

export const apiAiRenameChat = async (id: string, title: string) => {
  const r = await apiCall<{ chat: AiChat }>(`/api/ai/chat/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ title }),
  });
  return r.ok ? r.data?.chat ?? null : null;
};

export const apiAiDeleteChat = async (id: string) => {
  const r = await apiCall(`/api/ai/chat/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

/* ─── Обычный чат: бесплатно ────────────────────────────────────── */

export interface SendResult {
  ok: boolean;
  chatId?: string;
  chat?: AiChat;
  answer?: AiMessage;
  usage?: { kind: AiTool; used: number; limit: number };
  reason?: string;
  code?: string;
}

export const apiAiSend = async (
  text: string, chatId?: string,
  opts: { mode?: 'chat' | 'code'; voice?: boolean; assist?: boolean } = {},
): Promise<SendResult> => {
  const r = await apiCall<SendResult>('/api/ai/send', {
    method: 'POST', body: JSON.stringify({ text, chatId, ...opts }),
  });
  if (!r.ok) return { ok: false, reason: aiReason(r.error, r.reason), code: r.error };
  /* ok ставим после разворота: в теле ответа его нет, но если однажды
     появится — поле должно остаться нашим. */
  return { ...(r.data as SendResult), ok: true };
};

/* ─── Мелкие помощники: тоже бесплатно ──────────────────────────
   Один ход без истории — то же, что человек набрал бы в чате сам.
   Поэтому Prime для них не нужен, и это осознанное решение, а не
   недосмотр: закрывать подпиской «переведи это сообщение» значило бы
   закрывать подпиской обычный разговор. */

export type AskTask = 'translate' | 'fix' | 'friendly' | 'formal' | 'shorten' | 'replies' | 'gist' | 'advise';

export const apiAiAsk = async (task: AskTask, text: string, arg = '') => {
  const r = await apiCall<{ text: string }>('/api/ai/ask', {
    method: 'POST', body: JSON.stringify({ task, text, arg }),
  });
  return r.ok
    ? { ok: true as const, text: r.data?.text ?? '' }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

/**
 * Правка черновика до отправки: орфография и тон.
 *
 * Тоже один короткий ход, тоже бесплатно. Названия действий здесь —
 * прежние, чтобы не переписывать вызывающий код переписки; на сервер
 * уходит уже слово из его закрытого списка.
 */
export type AiComposerAction = 'fix' | 'tone-friendly' | 'tone-formal' | 'tone-short';

const COMPOSER_TASK: Record<AiComposerAction, AskTask> = {
  fix: 'fix',
  'tone-friendly': 'friendly',
  'tone-formal': 'formal',
  'tone-short': 'shorten',
};

/** Возвращает исправленный текст. Бросает исключение при отказе. */
export async function runAiComposerAction(action: AiComposerAction, text: string): Promise<string> {
  const r = await apiAiAsk(COMPOSER_TASK[action], text);
  if (!r.ok) throw new Error(r.reason);
  return r.text;
}

/* ─── Prime-инструменты ─────────────────────────────────────────── */

export const apiAiSummary = async (text: string, style = 'short', chatId?: string) => {
  const r = await apiCall<{ text: string; style: string }>('/api/ai/summary', {
    method: 'POST', body: JSON.stringify({ text, style, chatId }),
  });
  return r.ok
    ? { ok: true as const, text: r.data?.text ?? '', style: r.data?.style ?? style }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

export const apiAiAnalyzeFile = async (fileId: string, question = '', chatId?: string) => {
  const r = await apiCall<{ text: string; kind: string; name: string; truncated: boolean }>(
    '/api/ai/file', { method: 'POST', body: JSON.stringify({ fileId, question, chatId }) },
  );
  return r.ok
    ? { ok: true as const, ...(r.data as { text: string; kind: string; name: string; truncated: boolean }) }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

export const apiAiAnalyzeImage = async (fileId: string, question = '', chatId?: string) => {
  const r = await apiCall<{ text: string; mime: string; name: string }>(
    '/api/ai/image', { method: 'POST', body: JSON.stringify({ fileId, question, chatId }) },
  );
  return r.ok
    ? { ok: true as const, ...(r.data as { text: string; mime: string; name: string }) }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

export const apiAiTranscribe = async (fileId: string, chatId?: string, language = '') => {
  const r = await apiCall<{ text: string; cues: TranscriptCue[]; language: string }>(
    '/api/ai/transcribe', { method: 'POST', body: JSON.stringify({ fileId, chatId, language }) },
  );
  return r.ok
    ? { ok: true as const, text: r.data?.text ?? '', cues: r.data?.cues ?? [] }
    : { ok: false as const, reason: aiReason(r.error, r.reason), code: r.error };
};

/* ─── Голосовой режим ───────────────────────────────────────────── */

export interface VoiceTurnResult {
  chatId: string;
  chat: AiChat;
  recognizedText: string;
  answer: AiMessage;
  audio: string | null;
  audioMime: string | null;
  usage?: { kind: AiTool; used: number; limit: number };
}

/**
 * Один голосовой ход: запись отправляется как есть, ответом приходят
 * и распознанный текст, и реплика модели (в тот же диалог), и, если
 * поставщик голоса назван, её озвучка (base64).
 *
 * XMLHttpRequest — тем же способом, что и apiAiUpload: запись хоть и
 * короткая, но полоса хода отправки не помешает.
 */
export const apiAiVoice = (
  audio: Blob,
  chatId?: string,
): { promise: Promise<{ ok: true; data: VoiceTurnResult } | { ok: false; reason: string; code?: string }>; cancel: () => void } => {
  const p = new URLSearchParams();
  if (chatId) p.set('chat', chatId);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: true; data: VoiceTurnResult } | { ok: false; reason: string; code?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/ai/voice?${p.toString()}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', audio.type || 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.onload = () => {
      let body: Partial<VoiceTurnResult> & { error?: string } = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, data: body as VoiceTurnResult });
      else resolve({ ok: false, reason: aiReason(body.error, 'Не получилось'), code: body.error });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Соединение оборвалось — попробуйте ещё раз' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Отменено' });
    xhr.send(audio);
  });
  return { promise, cancel: () => xhr.abort() };
};

/* ─── Приём файла ───────────────────────────────────────────────── */

/**
 * Файл уходит телом запроса. Тип сервер определит сам, по первым
 * байтам: тому, что напишет браузер в Content-Type, он не верит, и имя
 * файла в пути на диске не участвует.
 *
 * XMLHttpRequest вместо fetch — ради полосы хода отправки: запись на
 * сорок минут идёт заметное время, и полоса без движения выглядит
 * зависанием.
 */
export const apiAiUpload = (
  file: Blob,
  name: string,
  chatId?: string,
  onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; fileId?: string; reason?: string; code?: string }>; cancel: () => void } => {
  const p = new URLSearchParams();
  p.set('name', name.slice(0, 200));
  if (chatId) p.set('chat', chatId);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; fileId?: string; reason?: string; code?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/ai/upload?${p.toString()}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: { fileId?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.fileId) resolve({ ok: true, fileId: body.fileId });
      else resolve({ ok: false, reason: aiReason(body.error, 'Не удалось загрузить'), code: body.error });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Загрузка оборвалась — попробуйте ещё раз' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Загрузка отменена' });
    xhr.send(file);
  });
  return { promise, cancel: () => xhr.abort() };
};

/**
 * Загрузить то, что уже лежит в Sky, и отдать на разбор.
 *
 * Нужно для голосовых в переписке: браузер и так их проигрывает, то
 * есть уже имеет к ним доступ. Отдельного моста между вложениями
 * переписки и Sky AI нет намеренно — он открывал бы чужие вложения по
 * идентификатору.
 */
export const uploadFromUrl = async (
  url: string,
  name: string,
  chatId?: string,
  onProgress?: (percent: number) => void,
) => {
  let blob: Blob;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return { ok: false as const, reason: 'Не удалось прочитать запись' };
    blob = await res.blob();
  } catch {
    return { ok: false as const, reason: 'Не удалось прочитать запись' };
  }
  return apiAiUpload(blob, name, chatId, onProgress).promise;
};
