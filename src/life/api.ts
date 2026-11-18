/** Sky Life: запросы к серверу и общие типы. Все обращения идут через общую сессию Sky ID (apiCall) — отдельной авторизации нет. */
import { apiCall, apiBlob, apiRawAuthed } from '@/core/auth/api';

export type Item = {
  id: string; kind: string; category: string | null; status: 'open' | 'done' | 'archived' | 'cancelled'; priority: number; dueAt: string | null; eventAt: string | null; remindAt: string | null;
  parentId: string | null; progress: number; privacy: string; title: string; description: string; tags: string[]; extra: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  createdAt: string; subTotal?: number; subDone?: number; files?: number; children?: Item[]; fileList?: LFile[]; history?: { progress: number; at: string }[]; state?: string;
};
export type LFile = { id: string; name: string; mime: string; bytes: number };

export const ERR: Record<string, string> = {
  limit_reached: 'Достигнут лимит записей для вашего тарифа. Удалите ненужное или оформите Sky Prime.', storage_limit: 'Хранилище заполнено для вашего тарифа.', posts_limit: 'Достигнут лимит публикаций для вашего тарифа.',
  prime_required: 'Эта возможность входит в Sky Prime.', secret_not_allowed: 'Здесь нельзя хранить пароли, коды подтверждения, номера карт и секретные ключи. Уберите их из текста.',
  bad_title: 'Название слишком короткое.', bad_date: 'Проверьте дату.', bad_category: 'Недопустимая категория.', not_found: 'Не найдено.', forbidden: 'Недостаточно прав.', restricted: 'Ваши деловые функции ограничены администрацией.',
  file_type_not_allowed: 'Такой тип файла нельзя загрузить.', file_type_mismatch: 'Содержимое файла не соответствует его типу.', malware_detected: 'Файл не прошёл проверку безопасности.', too_large: 'Файл слишком большой (до 20 МБ).', scan_unavailable: 'Проверка файлов временно недоступна.',
  claims_not_allowed: 'Нельзя писать «гарантированный доход», «без риска», «проверено Sky» и подобное.', contact_in_public_text: 'Не указывайте телефон, почту и ссылки на мессенджеры в открытом тексте — контакт добавляется отдельно и открывается только вам решать.',
  summary_too_short: 'Опишите предложение подробнее (от 30 знаков).', contact_required: 'Укажите контакт для связи (он не виден публично).', daily_limit: 'Слишком много за сутки. Попробуйте завтра.', already_sent: 'Вы уже отправляли предложение по этой публикации.',
  own_post: 'Это ваша публикация.', message_too_short: 'Напишите сообщение подробнее (от 10 знаков).', already_reported: 'Вы уже жаловались на это.', user_not_found: 'Человек с таким ником не найден.', already_member: 'Уже в проекте или приглашён.',
  public_fields_required: 'Для открытого проекта заполните публичное название и описание.', public_text_not_allowed: 'В публичном тексте нельзя контакты, секреты и обещания дохода.', life_disabled: 'Sky Life временно отключён.', biz_disabled: 'Деловые функции временно отключены.',
  ai_not_configured: 'Sky AI сейчас не подключён.', ai_busy: 'Sky AI занят, повторите чуть позже.', ai_budget: 'Лимит Sky AI исчерпан.', ai_service_off: 'Помощник Sky Life отключён администрацией.', ai_service_limit: 'Суточный лимит помощника исчерпан.',
  nothing_to_work_with: 'Напишите запрос или разрешите помощнику читать ваши цели в настройках.', too_many_requests: 'Слишком часто. Подождите минуту.', server_error: 'Ошибка сервера. Попробуйте ещё раз.', bad_amount: 'Проверьте сумму.', bad_equity: 'Доля — от 0 до 100 %.',
  not_accepted: 'Сначала примите предложение.', bad_state: 'Состояние уже изменилось — обновите.', reason_required: 'Укажите причину (не короче 5 знаков).', not_allowed: 'Недостаточно прав.', self_review: 'Свою публикацию решать нельзя.',
};
export const errText = (e?: string) => (e && ERR[e]) || 'Не получилось. Попробуйте ещё раз.';

export const J = async <T = any>(path: string, method = 'GET', body?: unknown) => // eslint-disable-line @typescript-eslint/no-explicit-any
  apiCall<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export const uploadLife = async (target: Record<string, string>, file: File) => {
  const qs = new URLSearchParams({ ...target, name: file.name }).toString();
  try {
    const res = await apiRawAuthed(`/api/life/files/upload?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, error: res.ok ? undefined : (data?.error as string | undefined), data };
  } catch { return { ok: false, error: 'network', data: null }; }
};
export const openLifeFile = async (f: LFile) => {
  const r = await apiBlob(`/api/life/files/${f.id}`); if (!r.ok || !r.blob) return false;
  const url = URL.createObjectURL(r.blob); const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; if (!/^(image|application\/pdf|text)/.test(f.mime)) a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); return true;
};
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const toLocalInput = (s?: string | null) => { if (!s) return ''; const d = new Date(s); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);
