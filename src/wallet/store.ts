/* ===============================================================
   SKYMONEY  -  кошелёк Sky
   Баланс, транзакции, пополнение, списание для Prime и Market
=============================================================== */
import { create } from 'zustand';
import {
  CreditCard, Crown, ShoppingBag, Music2, Home, RotateCcw,
  ArrowDownLeft, ArrowUpRight, Star, Gift, Landmark, Truck,
  Megaphone, ShieldCheck, Gem, Radio, Wallet, Ticket,
} from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

/**
 * Виды операций кошелька — должны покрывать каждую строку, которую
 * пишет server/wallet.mjs (addTx) и все вызовы wallet.credit/spend/
 * creditPoints по всему серверу (ads.mjs, family.mjs, garant.mjs,
 * kutrentmarket.mjs, market.mjs, nftmarket.mjs, primegifts.mjs,
 * pvzops.mjs, skinMarket.mjs, streams.mjs, ticketorders.mjs — список
 * растёт с каждым новым местом, которое трогает кошелёк). Раньше тут
 * было 10 типов, хотя сервер пишет больше двадцати — для неизвестного
 * типа TX_ICON[tx.type] был undefined, и `<Icon />` с undefined валил
 * весь экран кошелька (minified React #130: «Element type is
 * invalid… got: undefined») — ровно это случалось каждому, кому
 * владелец начислял деньги через панель администратора (тип
 * 'admin_grant' сюда не входил), и точно так же свалило бы на
 * возврате/подписке Sky Garant, подписке/продвижении Market, подписке
 * ПВЗ, покупке NFT, подарке Prime, скине питомца или донате на
 * трансляции. TX_ICON/TX_LABEL ниже — лучшее, что можно сделать:
 * держать актуальный список; TxItem в SkyMoneyWallet.tsx берёт отсюда
 * значения с запасным вариантом, чтобы следующий тип, про который тут
 * забудут, не ронял экран, а просто показывался подписанным дженерик-
 * значком.
 */
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
  | 'points_spend'   // трата баллов
  | 'admin_grant'           // начисление по решению владельца (панель администратора)
  | 'admin_points'          // начисление баллов по решению владельца
  | 'courier_earning'       // заработок курьера за доставку
  | 'ads'                   // списание за рекламную кампанию
  | 'family_prime'          // Sky Prime Family
  | 'garant_refund'         // возврат по сделке Sky Garant
  | 'garant_subscription'   // подписка Sky Garant Pro
  | 'kutrent_topup'         // пополнение через KutRent Market
  | 'market_subscription'   // подписка продавца Sky Market
  | 'market_promotion'      // продвижение товара в Sky Market
  | 'pvz_subscription'      // активация точки Sky ПВЗ
  | 'nft_purchase'          // покупка NFT
  | 'points_refund'         // возврат баллов
  | 'prime_gift'            // подарок Prime
  | 'skin_purchase'         // покупка скина питомца
  | 'skin_purchase_refund'  // возврат за скин питомца
  | 'stream_donation'       // донат на трансляции
  | 'code_topup'            // пополнение по коду Sky Codes
  | 'code_points';          // баллы по коду Sky Codes

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
  admin_grant:          'Начисление администрации',
  admin_points:         'Начислены баллы администрацией',
  courier_earning:      'Заработок курьера',
  ads:                  'Реклама',
  family_prime:         'Sky Prime Family',
  garant_refund:        'Возврат Sky Garant',
  garant_subscription:  'Sky Garant Pro',
  kutrent_topup:        'Пополнение KutRent Market',
  market_subscription:  'Подписка Sky Market',
  market_promotion:     'Продвижение в Sky Market',
  pvz_subscription:     'Активация Sky ПВЗ',
  nft_purchase:         'Покупка NFT',
  points_refund:        'Возврат баллов',
  prime_gift:           'Подарок Prime',
  skin_purchase:        'Скин питомца',
  skin_purchase_refund: 'Возврат за скин питомца',
  stream_donation:      'Донат на трансляции',
  code_topup:           'Пополнение по коду',
  code_points:          'Баллы по коду',
};

/** Запасной значок и подпись для вида операции, которого ещё нет в
 *  TX_ICON/TX_LABEL — чтобы незнакомый тип не ронял экран кошелька. */
export const TX_ICON_FALLBACK: IconComponent = Wallet;
export const TX_LABEL_FALLBACK = 'Операция';

/**
 * Значок вида операции.
 *
 * Раньше здесь лежала эмодзи, и в списке операций картинка зависела
 * от шрифта устройства: на телефоне одна, на телевизоре другая, а
 * цвет под тему не подбирался. Теперь это значок из набора
 * приложения — он одинаков везде и красится вместе с темой.
 */
export const TX_ICON: Record<TxType, IconComponent> = {
  topup:        CreditCard,
  prime:        Crown,
  market:       ShoppingBag,
  music:        Music2,
  family:       Home,
  refund:       RotateCcw,
  transfer_in:  ArrowDownLeft,
  transfer_out: ArrowUpRight,
  points_earn:  Star,
  points_spend: Gift,
  admin_grant:          Landmark,
  admin_points:         Landmark,
  courier_earning:      Truck,
  ads:                  Megaphone,
  family_prime:         Home,
  garant_refund:        RotateCcw,
  garant_subscription:  ShieldCheck,
  kutrent_topup:        CreditCard,
  market_subscription:  ShoppingBag,
  market_promotion:     Megaphone,
  pvz_subscription:     ShieldCheck,
  nft_purchase:         Gem,
  points_refund:        RotateCcw,
  prime_gift:           Gift,
  skin_purchase:        ShoppingBag,
  skin_purchase_refund: RotateCcw,
  stream_donation:      Radio,
  code_topup:           Ticket,
  code_points:          Ticket,
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
  fetchWallet, apiTopUp, apiSpend, apiExchange, apiSpendPoints,
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
