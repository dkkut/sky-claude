/* ===============================================================
   КЛИЕНТ КОШЕЛЬКА

   Баланс и операции живут на сервере. Здесь только вызовы: ни одна
   сумма не считается в браузере, потому что посчитанное в браузере
   можно переписать.

   Владельца операции сервер определяет по токену — свой идентификатор
   мы никуда не передаём, и списать с чужого счёта нельзя даже подделав
   запрос.
=============================================================== */
import { getAccessToken, apiRefreshSession } from '@/core/auth/api';
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
  if (res.status === 403) { try { window.dispatchEvent(new CustomEvent('sky:money-locked')); } catch { /* ok */ } }
  if (res.status !== 401) return res;

  // Access-токен живёт 15 минут; обновляемся один раз и повторяем.
  const refreshed = await apiRefreshSession();
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
  let res = await call('');
  // SkyMoney закрыт замком (moneyguard.mjs): история и состояние недоступны — берём только два числа для экранов покупки в других сервисах.
  if (res.status === 403) {
    const data0 = await readJson(res.clone());
    if (data0?.error === 'money_locked') {
      res = await call('/balance');
      if (!res.ok) return null;
      const b = await readJson(res);
      return { balance: b.balance ?? 0, points: b.points ?? 0, transactions: [] };
    }
  }
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
export const apiExchange = (rubles: number) => op('/exchange', { rubles });
export const apiSpendPoints = (amount: number, desc: string, ref?: string) =>
  op('/spend-points', { amount, desc, ref });

// Обе операции увеличивают баланс или баллы и в боевом режиме закрыты
// сервером — до тех пор, пока их источник не переедет из браузера.
export const apiRefund      = (amount: number, desc: string, ref?: string) =>
  op('/refund', { amount, desc, ref });
export const apiEarnPoints  = (amount: number, desc: string) =>
  op('/earn-points', { amount, desc });
