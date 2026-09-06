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
  // балансы по userId
  balances:     Record<string, number>;
  points:       Record<string, number>;   // Баллы Прайма
  transactions: Transaction[];

  // действия
  topUp:     (userId: string, amount: number, method: string) => boolean;
  spend:     (userId: string, amount: number, type: TxType, desc: string, ref?: string) => boolean;
  refund:    (userId: string, amount: number, desc: string, ref?: string) => void;
  transfer:  (fromId: string, toId: string, amount: number) => boolean;
  getBalance:  (userId: string) => number;
  getPoints:   (userId: string) => number;
  earnPoints:  (userId: string, amount: number, desc: string) => void;
  spendPoints: (userId: string, amount: number, desc: string, ref?: string) => boolean;
  exchangeToPoints: (userId: string, rubles: number) => boolean;  // 1₽ = 1 балл (курс 1:1)
  getTxs:      (userId: string) => Transaction[];
}

const KEY = 'sky:money:v1';
const W   = typeof window !== 'undefined';

const load = () => {
  if (!W) return null;
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
const save = (s: WalletState) => {
  if (!W) return;
  try { localStorage.setItem(KEY, JSON.stringify({ balances: s.balances, points: s.points, transactions: s.transactions })); } catch {}
};

const stored = load();

/* Seed: каждому демо-аккаунту стартовый баланс */
const SEED_BALANCES: Record<string, number> = {
  'acc-kutuzov': 1200,
  'acc-luna':    3500,
  'acc-neo':     800,
};
const SEED_POINTS: Record<string, number> = {
  'acc-kutuzov': 500,
  'acc-luna':    1200,
  'acc-neo':     250,
};

const mkTx = (userId: string, type: TxType, amount: number, desc: string, ref?: string): Transaction => ({
  id:        `tx-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
  userId, type, amount, desc, ref: ref ?? undefined,
  createdAt: new Date().toISOString(),
});

export const useMoney = create<WalletState>((set, get) => {
  const persist = () => { try { save(get()); } catch {} };

  return {
    balances:     stored?.balances     ?? SEED_BALANCES,
    points:       stored?.points       ?? SEED_POINTS,
    transactions: stored?.transactions ?? [
      mkTx('acc-kutuzov','topup',    1200, 'Стартовый баланс'),
      mkTx('acc-luna',   'topup',    3500, 'Стартовый баланс'),
      mkTx('acc-neo',    'topup',    800,  'Стартовый баланс'),
      mkTx('acc-kutuzov','market',  -2580, 'Футболка Neo Driver™ × 2', 'o2'),
      mkTx('acc-luna',   'prime',   -3790, 'Sky Prime  -  1 год'),
    ],

    getBalance: (userId) => get().balances[userId] ?? 0,
    getPoints:  (userId) => get().points[userId] ?? 0,

    earnPoints: (userId, amount, desc) => {
      set(s => ({
        points: { ...s.points, [userId]: (s.points[userId] ?? 0) + amount },
        transactions: [...s.transactions, mkTx(userId, 'points_earn', amount, desc)],
      }));
      persist();
    },

    spendPoints: (userId, amount, desc, ref) => {
      const pts = get().points[userId] ?? 0;
      if (pts < amount) return false;
      set(s => ({
        points: { ...s.points, [userId]: s.points[userId] - amount },
        transactions: [...s.transactions, mkTx(userId, 'points_spend', -amount, desc, ref)],
      }));
      persist(); return true;
    },

    exchangeToPoints: (userId, rubles) => {
      // 1 ₽ = 10 баллов
      const pts = get().balances[userId] ?? 0;
      if (pts < rubles) return false;
      const points = rubles * 10;
      set(s => ({
        balances: { ...s.balances, [userId]: s.balances[userId] - rubles },
        points:   { ...s.points,   [userId]: (s.points[userId] ?? 0) + points },
        transactions: [
          ...s.transactions,
          mkTx(userId, 'points_earn', points, `Обмен ${rubles.toLocaleString('ru')} ₽ → ${points.toLocaleString('ru')} баллов`),
        ],
      }));
      persist(); return true;
    },

    getTxs: (userId) =>
      get().transactions
        .filter(t => t.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

    topUp: (userId, amount, method) => {
      if (amount <= 0) return false;
      set(s => ({
        balances: { ...s.balances, [userId]: (s.balances[userId] ?? 0) + amount },
        transactions: [...s.transactions, mkTx(userId, 'topup', amount, `Пополнение через ${method}`)],
      }));
      persist(); return true;
    },

    spend: (userId, amount, type, desc, ref) => {
      if (amount <= 0) return false;
      const bal = get().balances[userId] ?? 0;
      if (bal < amount) return false;
      set(s => ({
        balances: { ...s.balances, [userId]: s.balances[userId] - amount },
        transactions: [...s.transactions, mkTx(userId, type, -amount, desc, ref)],
      }));
      persist(); return true;
    },

    refund: (userId, amount, desc, ref) => {
      set(s => ({
        balances: { ...s.balances, [userId]: (s.balances[userId] ?? 0) + amount },
        transactions: [...s.transactions, mkTx(userId, 'refund', amount, desc, ref)],
      }));
      persist();
    },

    transfer: (fromId, toId, amount) => {
      if (amount <= 0) return false;
      const bal = get().balances[fromId] ?? 0;
      if (bal < amount) return false;
      const now = new Date().toISOString();
      set(s => ({
        balances: {
          ...s.balances,
          [fromId]: (s.balances[fromId] ?? 0) - amount,
          [toId]:   (s.balances[toId]   ?? 0) + amount,
        },
        transactions: [
          ...s.transactions,
          mkTx(fromId, 'transfer_out', -amount, `Перевод пользователю`),
          mkTx(toId,   'transfer_in',   amount, `Получен перевод`),
        ],
      }));
      persist(); return true;
    },
  };
});

/* -- Helpers --------------------------------------------------- */
export const fmt = (n: number) =>
  Math.abs(n).toLocaleString('ru', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 });

export const fmtSigned = (n: number) => (n > 0 ? '+' : '') + fmt(n);
