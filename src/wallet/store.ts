/* ===============================================================
   SKYMONEY  -  кошелёк Sky
   Баланс, транзакции, пополнение, списание для Prime и Market
=============================================================== */
import { create } from 'zustand';

export type TxType =
  | 'topup'          // пополнение
  | 'prime'          // покупка Prime
  | 'market'         // покупка в маркете
  | 'music'          // покупка трека
  | 'family'         // операция с семейным счётом Sky Family
  | 'refund'         // возврат
  | 'transfer_in'    // входящий перевод
  | 'transfer_out'   // исходящий перевод
  | 'points_earn'    // начисление баллов
  | 'points_spend';  // трата баллов

export const TX_LABEL: Record<TxType, string> = {
  topup:        'Пополнение',
  prime:        'Sky Prime',
  market:       'Маркет',
  music:        'Музыка',
  family:       'Sky Family',
  refund:       'Возврат',
  transfer_in:  'Получен перевод',
  transfer_out:  'Перевод',
  points_earn:   'Начислены баллы',
  points_spend:  'Потрачены баллы',
};

export const TX_ICON: Record<TxType, string> = {
  topup:        '💳',
  prime:        '👑',
  market:       '🛍',
  music:        '🎵',
  family:       '🏠',
  refund:       '↩️',
  transfer_in:  '📥',
  transfer_out:  '📤',
  points_earn:   '⭐',
  points_spend:  '🎁',
};

export interface Transaction {
  id:        string;
  userId:    string;
  type:      TxType;
  amount:    number;      // > 0 = приход, < 0 = расход
  desc:      string;
  createdAt: string;
  ref?:      string;      // ID заказа / подписки / трека
}

interface WalletState {
  /** Чей снимок сейчас загружен. Сервер отдаёт только свои данные. */
  userId:       string | null;
  balance:      number;
  points:       number;
  transactions: Transaction[];
  /** Идёт ли обмен с сервером — для блокировки кнопок в интерфейсе. */
  busy:         boolean;

  /** Подтягивает состояние с сервера. Вызывается при входе и после операций. */
  refresh:      () => Promise<void>;
  /** Сбрасывает кэш при выходе, чтобы чужой баланс не остался на экране. */
  reset:        () => void;

  topUp:     (userId: string, amount: number, method: string) => Promise<boolean>;
  spend:     (userId: string, amount: number, type: TxType, desc: string, ref?: string) => Promise<boolean>;
  transfer:  (fromId: string, toId: string, amount: number) => Promise<boolean>;
  spendPoints: (userId: string, amount: number, desc: string, ref?: string) => Promise<boolean>;
  refund:      (userId: string, amount: number, desc: string, ref?: string) => Promise<boolean>;
  earnPoints:  (userId: string, amount: number, desc: string) => Promise<boolean>;
  exchangeToPoints: (userId: string, rubles: number) => Promise<boolean>;

  // Чтение идёт из кэша последнего ответа сервера. Параметр userId
  // оставлен ради совместимости с местами вызова: чужой баланс клиенту
  // не отдаётся, поэтому для любого другого id вернётся 0.
  getBalance:  (userId: string) => number;
  getPoints:   (userId: string) => number;
  getTxs:      (userId: string) => Transaction[];

  /** Текст последней ошибки операции — для показа пользователю. */
  lastError:   string | null;
}

import {
  fetchWallet, apiTopUp, apiSpend, apiTransferTo, apiExchange, apiSpendPoints,
  apiRefund, apiEarnPoints,
} from './api';

export const useMoney = create<WalletState>((set, get) => {
  /** Применяет снимок, пришедший с сервера. */
  const apply = (snap: { balance: number; points: number; transactions: Transaction[] }) =>
    set({ balance: snap.balance, points: snap.points, transactions: snap.transactions });

  /**
   * Общая обвязка для операций: блокирует кнопки, а после успеха
   * перечитывает состояние с сервера. Локально сумму не считаем —
   * иначе экран и база разъедутся при любой гонке.
   */
  const run = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    set({ busy: true, lastError: null });
    try {
      const res = await fn();
      if (!res.ok) { set({ lastError: res.reason ?? 'Операция не выполнена' }); return false; }
      await get().refresh();
      return true;
    } catch {
      set({ lastError: 'Нет связи с сервером' });
      return false;
    } finally {
      set({ busy: false });
    }
  };

  return {
    userId: null,
    balance: 0,
    points: 0,
    transactions: [],
    busy: false,
    lastError: null,

    refresh: async () => {
      const snap = await fetchWallet();
      if (snap) apply(snap);
    },

    reset: () => set({ userId: null, balance: 0, points: 0, transactions: [], lastError: null }),

    getBalance: (userId) => (userId && userId === get().userId ? get().balance : 0),
    getPoints:  (userId) => (userId && userId === get().userId ? get().points  : 0),
    getTxs:     (userId) => (userId && userId === get().userId ? get().transactions : []),

    topUp:    (_userId, amount, method)              => run(() => apiTopUp(amount, method)),
    spend:    (_userId, amount, type, desc, ref)     => run(() => apiSpend(amount, type, desc, ref)),
    transfer: (_fromId, toId, amount)                => run(() => apiTransferTo(toId, amount)),
    spendPoints: (_userId, amount, desc, ref)        => run(() => apiSpendPoints(amount, desc, ref)),
    refund:      (_userId, amount, desc, ref)        => run(() => apiRefund(amount, desc, ref)),
    earnPoints:  (_userId, amount, desc)             => run(() => apiEarnPoints(amount, desc)),
    exchangeToPoints: (_userId, rubles)              => run(() => apiExchange(rubles)),
  };
});

/** Загружает кошелёк вошедшего пользователя. Вызывается из main.tsx. */
export const reloadWalletForUser = async (userId: string | null) => {
  if (!userId) { useMoney.getState().reset(); return; }
  useMoney.setState({ userId });
  await useMoney.getState().refresh();
};

export const fmt = (n: number) =>
  Math.abs(n).toLocaleString('ru', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 });

export const fmtSigned = (n: number) => (n > 0 ? '+' : '') + fmt(n);
