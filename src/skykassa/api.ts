/* SkyKassa — клиент API. Здесь ничего не решается: сумму, статус, реквизиты и права определяет сервер. */
import { apiCall } from '@/core/auth/api';

export type Res<T> = { ok: true; data: T } | { ok: false; error?: string; message?: string; field?: string; status?: number };

const req = async <T>(path: string, init?: RequestInit): Promise<Res<T>> => {
  const r = await apiCall<T>(path, init);
  if (r.ok) return { ok: true, data: r.data as T };
  const d = (r.data ?? {}) as { message?: string; field?: string };
  return { ok: false, error: r.error, message: d.message, field: d.field, status: r.status };
};
const post = <T>(p: string, b?: unknown) => req<T>(p, { method: 'POST', body: JSON.stringify(b ?? {}) });

export type Destination = 'balance' | 'code';
export type IdKind = 'card' | 'phone' | 'account' | 'other';

export interface SenderField { key: string; label: string; type: 'text' | 'digits' | 'select'; required?: boolean; options?: string[]; maxLen?: number }
export interface Requisites {
  methodTitle: string; recipient: string; bank: string; idKind: IdKind; identifier: string; tail: string;
  currency: string; purpose: string; instruction: string; amount: number;
}
export interface Payment {
  id: string; number: string; app: string; kind: 'direct' | 'partner'; status: string; statusLabel: string;
  amount: number; fee: number; total: number; currency: string; destination: Destination;
  methodTitle: string; partnerTitle: string; expiresAt: string | null; reportedAt: string | null; createdAt: string;
  creditedAt: string | null; balanceAfter: number | null;
  requisites: Requisites | null; partnerUrl: string | null;
  sender: { fio: string; idKind: IdKind; idMasked: string; confirmed: boolean } | null;
  senderConfig: { fields: SenderField[]; kinds: IdKind[] } | null;
  rejectReason: string; cancelReason: string;
  messages: { id: string; fromStaff: boolean; body: string; at: string }[];
  refunds: { id: string; amount: number; status: string; reason: string; declineReason: string; at: string }[];
  refundedTotal: number; ticketId: string | null;
  code: { value: string | null; used: boolean; expired: boolean; expiresAt: string | null } | null;
  canCancel: boolean;
}
export interface HistoryItem {
  id: string; number: string; status: string; statusLabel: string; amount: number; currency: string;
  destination: Destination; kind: string; methodTitle: string; createdAt: string; app: string;
}
export interface Options {
  direct: { id: string; kind: string; title: string; description: string; min: number; max: number }[];
  partners: { id: string; title: string; logo: string; methods: string[]; fee: number; total: number; feePercent: number; feeFixed: number; available: boolean; status: string; note: string }[];
  firstBonus?: { percent: number; maxRub: number; rub: number } | null;
  settings: { notice: string; minAmount: number; maxAmount: number; ttlMinutes: number };
}
export interface Config { paused: boolean; message: string; notice: string; minAmount: number; maxAmount: number; ttlMinutes: number; apps: Record<string, boolean> }

export const kkConfig = () => req<Config>('/api/skykassa/config');
export const kkOptions = (amount: number, destination: Destination, app: string) =>
  req<Options>(`/api/skykassa/options?amount=${amount}&destination=${destination}&app=${encodeURIComponent(app)}`);
export const kkCreate = (b: { amount: number; destination: Destination; app: string; idemKey: string }) =>
  post<{ payment: Payment; duplicate: boolean }>('/api/skykassa/payments', b);
export const kkGet = (id: string, refresh = false) => req<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}${refresh ? '?refresh=1' : ''}`);
export const kkList = () => req<{ items: HistoryItem[] }>('/api/skykassa/payments?limit=100');
export const kkChoose = (id: string, b: { mode: 'direct'; methodId: string } | { mode: 'partner'; partnerId: string }) =>
  post<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}/choose`, b);
export interface SenderInput { fio: string; idKind: IdKind; idNumber: string; extra: Record<string, string>; confirmed: boolean }
export const kkSender = (id: string, b: SenderInput) => post<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}/sender`, b);
export const kkSenderChange = (id: string, b: SenderInput & { reason: string }) => post<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}/sender-change`, b);
export const kkReport = (id: string, amount: number) => post<{ payment: Payment; duplicate?: boolean }>(`/api/skykassa/payments/${encodeURIComponent(id)}/report`, { amount });
export const kkCancel = (id: string, reason?: string) => post<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}/cancel`, { reason });
export const kkReply = (id: string, body: string) => post<{ payment: Payment }>(`/api/skykassa/payments/${encodeURIComponent(id)}/reply`, { body });
export const kkRefund = (id: string, reason: string, amount?: number) => post<{ ok: true }>(`/api/skykassa/payments/${encodeURIComponent(id)}/refund`, { reason, amount });
export const kkSupport = (id: string) => post<{ ticketId: string }>(`/api/skykassa/payments/${encodeURIComponent(id)}/support`);

/** Понятный человеку текст для кода ошибки сервера. */
export const kkError = (code?: string, field?: string, message?: string): string => {
  if (message && (code === 'paused' || code === 'app_disabled')) return message;
  const m: Record<string, string> = {
    paused: 'Приём платежей временно приостановлен.',
    app_disabled: 'В этом приложении пополнение временно недоступно.',
    bad_amount: 'Сумма вне допустимых границ.',
    bad_destination: 'Неверное назначение платежа.',
    too_many_open: 'Слишком много незавершённых платежей. Завершите или отмените предыдущие.',
    too_many_attempts: 'Слишком часто. Подождите минуту и повторите.',
    not_found: 'Платёж не найден.',
    expired: 'Срок действия платежа истёк. Создайте новый платёж.',
    bad_state: 'Это действие сейчас недоступно для платежа.',
    method_unavailable: 'Способ оплаты недоступен. Выберите другой.',
    partner_unavailable: 'Партнёр сейчас недоступен.',
    partner_not_connected: 'Этот платёжный партнёр ещё не подключён.',
    partner_unreachable: 'Партнёр не отвечает. Попробуйте позже.',
    partner_error: 'Партнёр вернул ошибку. Попробуйте позже.',
    partner_bad_answer: 'Партнёр вернул неожиданный ответ. Попробуйте позже.',
    sender_required: 'Заполните данные отправителя.',
    sender_not_confirmed: 'Подтвердите, что данные отправителя верны.',
    amount_mismatch: 'Сумма не совпадает с платежом.',
    bad_fio: 'Укажите фамилию и имя полностью, только буквами.',
    bad_card: 'Номер карты указан неверно.',
    bad_phone: 'Номер телефона указан неверно.',
    bad_account: 'Номер счёта указан неверно (20 цифр или IBAN).',
    bad_other: 'Идентификатор слишком короткий.',
    bad_kind: 'Выберите тип идентификатора.',
    field_required: 'Заполните обязательное поле.',
    field_digits: 'В этом поле только цифры.',
    field_option: 'Выберите значение из списка.',
    use_change: 'Заявка уже отправлена: изменить данные можно только с указанием причины.',
    reason_required: 'Укажите причину (не короче 5 знаков).',
    cannot_cancel: 'Платёж уже нельзя отменить.',
    empty: 'Напишите сообщение.',
    code_already_used: 'Код пополнения уже активирован — возврат невозможен.',
    code_full_only: 'Код пополнения можно вернуть только целиком.',
    refund_open: 'Возврат по этому платежу уже запрошен.',
    unauthorized: 'Войдите в аккаунт.',
  };
  const text = (code && m[code]) || `Не получилось${code ? ` (${code})` : ''}. Попробуйте ещё раз.`;
  return field && (code === 'field_required' || code === 'field_digits' || code === 'field_option') ? text : text;
};

export const newIdemKey = (): string => {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
