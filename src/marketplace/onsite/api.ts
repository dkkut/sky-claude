/** Sky Market «На месте»: разговор с сервером (/api/onsite/*). Проверки — на сервере; здесь только вызовы. */
import { apiCall } from '@/core/auth/api';

const j = (b?: unknown) => (b === undefined ? undefined : JSON.stringify(b));
const get = <T,>(p: string) => apiCall<T>(p);
const post = <T,>(p: string, b?: unknown) => apiCall<T>(p, { method: 'POST', body: j(b ?? {}) });

export type Scope = 'city' | 'region' | 'country';
export type Reach = Scope;
export interface OnsiteCard { id: string; title: string; priceRub: number; negotiable: boolean; category: string; condition: string; status: string; country: string; region: string; city: string; scope: Scope; area: string; photo: string | null; publishedAt: string | null;
  seller?: { id: string; username: string; name: string; reviews: number; avg: number | null; completedDeals: number }; requests?: number; modNote?: string; views?: number }
export interface OnsiteDetail extends OnsiteCard { descr: string; photos: string[]; own: boolean }
export interface Deal { id: string; listingId: string; status: string; role: 'buyer' | 'seller'; note: string; meetAt: string | null; meetPlace: string; codeAttempts: number; buyerDone: boolean; sellerDone: boolean; outcomeNote: string; createdAt: string; updatedAt: string;
  title?: string; priceRub?: number; city?: string; area?: string; photo?: string | null; with?: string; listingStatus?: string; meetCode?: string | null; buyer?: { username: string; name: string }; seller?: { username: string; name: string };
  myReview?: { rating: number; text: string } | null; theirReview?: { rating: number; text: string } | null }

export const CATEGORY_LABEL: Record<string, string> = { electronics: 'Электроника', home: 'Для дома', furniture: 'Мебель', clothes: 'Одежда и обувь', kids: 'Детям', auto_parts: 'Автозапчасти', sport: 'Спорт и отдых', hobby: 'Хобби', books: 'Книги', tools: 'Инструменты', garden: 'Сад и дача', other: 'Другое' };
export const CONDITION_LABEL: Record<string, string> = { new: 'Новое', like_new: 'Как новое', used: 'Б/у', for_parts: 'На запчасти' };
export const SCOPE_LABEL: Record<Scope, string> = { city: 'Только в моём городе', region: 'По области', country: 'По стране' };
export const DEAL_LABEL: Record<string, string> = { requested: 'Ждёт ответа продавца', accepted: 'Встреча назначена', met: 'Встретились — осмотр', completed: 'Сделка состоялась', failed: 'Не состоялась', declined: 'Отклонено', cancelled: 'Отменено', expired: 'Истекло' };

export const ERRORS: Record<string, string> = {
  title_required: 'Название — от 3 знаков.', bad_category: 'Выберите категорию.', bad_price: 'Укажите цену (0 — отдам даром).', bad_scope: 'Выберите, где готовы встретиться.', city_required: 'Укажите город.', region_required: 'Укажите область или регион.', bad_country: 'Неверная страна.',
  too_many_listings: 'Слишком много объявлений — закройте старые.', photo_required: 'Добавьте хотя бы одно фото.', too_many_photos: 'Не больше 6 фото.', file_too_large: 'Фото больше 4 МБ.', unsupported_type: 'Нужен JPG, PNG или WebP.',
  not_editable: 'Это объявление уже закрыто.', removed_by_moderation: 'Объявление снято модерацией.', has_active_deal: 'По объявлению есть активная встреча — сначала отмените её.',
  own_listing: 'Это ваше объявление.', deal_exists: 'Вы уже договариваетесь по этому объявлению.', too_many_open: 'Слишком много активных встреч.', bad_time: 'Укажите время встречи — от 10 минут до 30 дней вперёд.', place_required: 'Укажите место встречи.',
  listing_unavailable: 'Объявление уже недоступно.', bad_code: 'Код не подошёл.', code_locked: 'Попытки закончились — отмените встречу или пожалуйтесь.', note_required: 'Опишите причину.', bad_rating: 'Оценка — от 1 до 5.', already_reviewed: 'Вы уже оставили отзыв.',
  bad_reason: 'Выберите причину жалобы.', already_reported: 'Вы уже жаловались на это объявление.', rate_limited: 'Слишком часто — попробуйте позже.', text_required: 'Напишите сообщение.', closed: 'Встреча закрыта.', bad_state: 'Действие сейчас недоступно.', not_found: 'Не найдено.',
};
export const errText = (r: { error?: string }) => ERRORS[r.error ?? ''] ?? 'Не получилось. Попробуйте ещё раз.';

export const onsiteApi = {
  meta: () => get<{ categories: string[]; conditions: string[]; maxPhotos: number; note: string }>('/api/onsite/meta'),
  catalog: (q: Record<string, string | number | undefined>) => get<{ items: OnsiteCard[] }>(`/api/onsite/listings?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  listing: (id: string) => get<{ listing: OnsiteDetail; myDeal: { id: string; status: string } | null; reviews: { rating: number; text: string; at: string; by: string }[] }>(`/api/onsite/listings/${id}`),
  request: (id: string, note: string) => post<{ id: string }>(`/api/onsite/listings/${id}/deals`, { note }),
  report: (id: string, reason: string, text: string) => post(`/api/onsite/listings/${id}/report`, { reason, text }),
  mine: () => get<{ items: OnsiteCard[] }>('/api/onsite/my/listings'),
  save: (b: unknown) => apiCall<{ id: string }>('/api/onsite/my/listings', { method: 'PUT', body: j(b) }),
  act: (id: string, a: 'publish' | 'close') => post(`/api/onsite/my/listings/${id}/${a}`),
  remove: (id: string) => apiCall(`/api/onsite/my/listings/${id}`, { method: 'DELETE' }),
  addPhoto: (id: string, file: File) => apiCall<{ id: string }>(`/api/onsite/my/listings/${id}/photos`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }),
  removePhoto: (id: string, pid: string) => apiCall(`/api/onsite/my/listings/${id}/photos/${pid}`, { method: 'DELETE' }),
  deals: () => get<{ items: Deal[] }>('/api/onsite/deals'),
  deal: (id: string) => get<{ deal: Deal; messages: { id: number; mine: boolean; text: string; at: string }[] }>(`/api/onsite/deals/${id}`),
  dealAct: (id: string, a: 'message' | 'accept' | 'decline' | 'cancel' | 'confirm' | 'done' | 'fail' | 'review', b?: unknown) => post(`/api/onsite/deals/${id}/${a}`, b),
};
