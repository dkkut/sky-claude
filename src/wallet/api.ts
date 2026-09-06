/* ===============================================================
   КЛИЕНТ КОШЕЛЬКА

   Баланс и операции живут на сервере. Здесь только вызовы: ни одна
   сумма не считается в браузере, потому что посчитанное в браузере
   можно переписать.

   Владельца операции сервер определяет по токену — свой идентификатор
   мы никуда не передаём, и списать с чужого счёта нельзя даже подделав
   запрос.
=============================================================== */
import { getAccessToken, apiRefresh } from '@/core/auth/api';
import type { Transaction, TxType } from './store';

export interface WalletSnapshot {
  balance:      number;
  points:       number;
  transactions: Transaction[];
}

export interface OpResult {
  ok:       boolean;
  balance?: number;
  points?:  number;
  reason?:  string;
}

const ERRORS: Record<string, string> = {
  insufficient_funds:      'Недостаточно средств',
  insufficient_points:     'Недостаточно баллов',
  invalid_amount:          'Некорректная сумма',
  self_transfer:           'Нельзя перевести самому себе',
  recipient_not_found:     'Получатель не найден',
  payments_not_configured: 'Пополнение недоступно: платежи не подключены',
  unauthorized:            'Сессия истекла, войдите заново',
};

const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const send = () => fetch(`/api/wallet${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      ...(init.headers ?? {}),
    },
    credentials: 'same-origin',
  });

  const res = await send();
  if (res.status !== 401) return res;

  // Access-токен живёт 15 минут; обновляемся один раз и повторяем.
  const refreshed = await apiRefresh();
  return refreshed.ok ? send() : res;
};

const readJson = async (res: Response): Promise<any> => {
  try { return await res.json(); } catch { return {}; }
};

const op = async (path: string, body: unknown): Promise<OpResult> => {
  const res  = await call(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await readJson(res);
  if (!res.ok) return { ok: false, reason: ERRORS[data?.error] ?? `Ошибка (${res.status})` };
  return { ok: true, balance: data.balance, points: data.points };
};

export const fetchWallet = async (): Promise<WalletSnapshot | null> => {
  const res = await call('');
  if (!res.ok) return null;
  const data = await readJson(res);
  return {
    balance: data.balance ?? 0,
    points:  data.points  ?? 0,
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
  };
};

export const apiTopUp    = (amount: number, method: string) => op('/topup', { amount, method });
export const apiSpend    = (amount: number, type: TxType, desc: string, ref?: string) =>
  op('/spend', { amount, type, desc, ref });
export const apiTransfer = (toUsername: string, amount: number) => op('/transfer', { toUsername, amount });
export const apiTransferTo = (toUserId: string, amount: number) => op('/transfer', { toUserId, amount });
export const apiExchange = (rubles: number) => op('/exchange', { rubles });
export const apiSpendPoints = (amount: number, desc: string, ref?: string) =>
  op('/spend-points', { amount, desc, ref });

// Обе операции увеличивают баланс или баллы и в боевом режиме закрыты
// сервером — до тех пор, пока их источник не переедет из браузера.
export const apiRefund      = (amount: number, desc: string, ref?: string) =>
  op('/refund', { amount, desc, ref });
export const apiEarnPoints  = (amount: number, desc: string) =>
  op('/earn-points', { amount, desc });
