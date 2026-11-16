import { apiCall } from '@/core/auth/api';

export type Svc = { title: string; workType: 'one_time' | 'long_term' | 'both'; priceFrom: number | null; note: string };
export type Work = { id: string; title: string; description: string; url: string; hasImage: boolean };
export type Spec = {
  id: string; ownerId: string; category: string; displayName: string; headline: string; description: string; specializations: string[]; services: Svc[];
  workTypes: string[]; availability: string; availabilityNote: string; hasPhoto: boolean; status: string; statusReason?: string; portfolio?: Work[]; isMine?: boolean;
};
export type Offer = { id: string; specialistId: string; specialistName: string; clientId: string; clientName: string; kind: string; title: string; brief: string; budgetRub: number | null; deadline: string | null; status: string; statusReason: string; role: 'client' | 'specialist'; updatedAt: string };
export type Msg = { id: number; mine: boolean; text: string; at: string };
type R<T> = { ok: boolean; error?: string; data?: T & { error?: string; field?: string; missing?: string[] } };
const B = '/api/specialists';
const j = (m: string, body?: unknown) => ({ method: m, body: body === undefined ? undefined : JSON.stringify(body) });

export const CATEGORY: Record<string, string> = { editors: 'Видеомонтажёры', designers: 'Дизайнеры', writers: 'Сценаристы', covers: 'Создатели обложек', promo: 'Специалисты по продвижению', other: 'Другие специалисты' };
export const WORK: Record<string, string> = { one_time: 'Разовый заказ', long_term: 'Долгосрочное сотрудничество' };
export const AVAIL: Record<string, string> = { open: 'Принимает заказы', busy: 'Занят, возможна очередь', closed: 'Не принимает' };
export const STATUS: Record<string, string> = { sent: 'Отправлено', negotiating: 'Обсуждение условий', accepted: 'Принято', declined: 'Отклонено', withdrawn: 'Отозвано', in_progress: 'В работе', completed: 'Завершено', cancelled: 'Отменено', disputed: 'Спор' };
export const PROFILE_STATUS: Record<string, string> = { draft: 'Черновик', pending: 'На проверке', published: 'Опубликована', rejected: 'Отклонена', suspended: 'Приостановлена' };
const ERR: Record<string, string> = {
  not_found: 'Не найдено.', not_allowed: 'Недостаточно прав.', own_profile: 'Это ваша собственная анкета.', bad_state: 'В этом статусе так сделать нельзя.', active_offer_exists: 'У вас уже есть активное предложение этому специалисту.',
  already_reported: 'Вы уже отправили жалобу.', suspended: 'Анкета приостановлена администрацией.', closed: 'Предложение закрыто.', profile_unavailable: 'Анкета сейчас не опубликована.', too_many_open_offers: 'Слишком много открытых предложений.',
  too_many_reports: 'Слишком много жалоб за сутки.', too_many_messages: 'В обсуждении слишком много сообщений.', too_many_works: 'В портфолио не больше 12 работ.', image_too_large: 'Картинка слишком большая.', bad_image: 'Нужен PNG, JPEG или WebP.',
  not_accepting: 'Специалист сейчас не принимает заказы.', work_type_not_offered: 'Специалист не предлагает такой формат работы.', reason_required: 'Укажите причину (от 5 знаков).', work_needs_proof: 'Добавьте картинку или ссылку на работу.',
  bad_field: 'Проверьте поле.', incomplete: 'Заполнено не всё.', no_profile: 'Сначала создайте анкету.', too_many_requests: 'Слишком часто, подождите.',
};
export const errText = (e?: string, d?: { field?: string; missing?: string[] }) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (d?.field ? ` Поле: ${d.field}.` : '') + (d?.missing?.length ? ` Не хватает: ${d.missing.map((x) => ({ photo: 'фото', portfolio: 'работ в портфолио', services: 'услуг' }[x] ?? x)).join(', ')}.` : '');

export const apiSearch = (q: Record<string, string>) => apiCall<{ specialists: Spec[] }>(`${B}?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`);
export const apiSpecialist = (id: string) => apiCall<{ specialist: Spec }>(`${B}/${id}`);
export const apiMine = () => apiCall<{ profile: Spec | null }>(`${B}/me`);
export const apiSave = (b: unknown): Promise<R<{ id: string; status: string }>> => apiCall(`${B}/me`, j('PUT', b));
export const apiPhoto = (dataUrl: string): Promise<R<object>> => apiCall(`${B}/me/photo`, j('PUT', { dataUrl }));
export const apiAddWork = (b: unknown): Promise<R<object>> => apiCall(`${B}/me/works`, j('POST', b));
export const apiDelWork = (id: string): Promise<R<object>> => apiCall(`${B}/me/works/${id}`, j('DELETE'));
export const apiSubmit = (): Promise<R<object>> => apiCall(`${B}/me/submit`, j('POST', {}));
export const apiOffers = (role = 'all') => apiCall<{ offers: Offer[] }>(`${B}/offers?role=${role}`);
export const apiOffer = (id: string) => apiCall<{ offer: Offer; messages: Msg[] }>(`${B}/offers/${id}`);
export const apiSendOffer = (b: unknown): Promise<R<{ id: string }>> => apiCall(`${B}/offers`, j('POST', b));
export const apiMessage = (id: string, text: string): Promise<R<object>> => apiCall(`${B}/offers/${id}/messages`, j('POST', { text }));
export const apiAction = (id: string, action: string, reason = ''): Promise<R<{ status: string }>> => apiCall(`${B}/offers/${id}/${action}`, j('POST', { reason }));
export const apiReport = (b: unknown): Promise<R<object>> => apiCall(`${B}/reports`, j('POST', b));

/** Картинку сжимаем на устройстве до JPEG и отдаём data-URL (сервер всё равно проверяет тип по сигнатуре). */
export const shrink = (file: File, max: number, quality = 0.85): Promise<string> => new Promise((resolve, reject) => {
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad_image')); }; img.src = url;
});
