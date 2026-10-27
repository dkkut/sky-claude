/* ===============================================================
   SKYMONEY  -  кошелёк Sky
   Баланс, транзакции, пополнение, списание для Prime и Market
=============================================================== */
import { create } from 'zustand';
import {
  CreditCard, Crown, ShoppingBag, Music2, Home, RotateCcw,
  Gamepad2, RotateCcw, ArrowDownLeft, ArrowUpRight, Star, Gift, Landmark, Truck,
  Megaphone, ShieldCheck, Gem, Radio, Wallet, Ticket, Gamepad2, Sparkles,
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
  | 'admin_adjust'          // корректировка баланса администрацией
  | 'admin_reversal'        // откат операции администрацией
  | 'admin_refund'          // возврат администрацией (Prime, подарок)
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
  | 'exchange_out'          // списание рублей при обмене на баллы
  | 'prime_gift'            // подарок Prime
  | 'skin_purchase'         // покупка скина питомца
  | 'skin_purchase_refund'  // возврат за скин питомца
  | 'stream_donation'       // донат на трансляции
  | 'code_topup'            // пополнение по коду Sky Codes
  | 'skykassa_topup'        // пополнение через SkyKassa
  | 'skykassa_refund'       // возврат пополнения SkyKassa
  | 'skykassa_bonus'        // бонус за первое пополнение
  | 'kbiz_sub'              // подписка SkyKassa Business
  | 'code_points'           // баллы по коду Sky Codes
  | 'cashback'              // кэшбэк Prime Points за заказ Sky Market
  | 'launcher_placement'    // размещение игры в Sky Launcher (499 ₽)
  | 'launcher_refund'       // возврат платы за размещение игры
  | 'prime_reward'          // обмен баллов на награду Prime
  | 'prime_reward_refund'   // возврат баллов за отклонённую награду
  | 'blox_purchase'         // покупка в игре Sky Blox
  | 'blox_refund'          // возврат за покупку в Sky Blox
  | 'blox_payout'          // выплата вознаграждения разработчику Sky Blox
  | 'blox_commission_payout' // выплата с баланса комиссий Sky Blox
  | 'blox_commission_topup'; // пополнение баланса комиссий Sky Blox

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
  exchange_out:  'Обмен на баллы',
  points_spend:  'Потрачены баллы',
  admin_grant:          'Начисление администрации',
  admin_adjust:         'Корректировка администрацией',
  admin_reversal:       'Отмена операции администрацией',
  admin_refund:         'Возврат администрацией',
  admin_points:         'Начислены баллы администрацией',
  courier_earning:      'Заработок курьера',
  ads:                  'Реклама',
  family_prime:         'Sky Prime Family',
  launcher_placement:   'Размещение игры в Sky Launcher',
  launcher_refund:      'Возврат за размещение игры',
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
  skykassa_topup:       'Пополнение SkyKassa',
  skykassa_refund:      'Возврат SkyKassa',
  skykassa_bonus:       'Бонус за первое пополнение',
  kbiz_sub:             'SkyKassa Business',
  code_points:          'Баллы по коду',
  cashback:             'Кэшбэк Prime',
  prime_reward:         'Награда Prime',
  prime_reward_refund:  'Возврат за награду',
  blox_purchase:        'Покупка в Sky Blox',
  blox_refund:          'Возврат за покупку в Sky Blox',
  blox_payout:          'Выплата вознаграждения Sky Blox',
  blox_commission_payout: 'Выплата от платформы Sky Blox',
  blox_commission_topup: 'Пополнение баланса комиссий Sky Blox',
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
  exchange_out: ArrowUpRight,
  points_spend: Gift,
  admin_grant:          Landmark,
  admin_adjust:         Landmark,
  admin_reversal:       RotateCcw,
  admin_refund:         RotateCcw,
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
  skykassa_topup:       Sparkles,
  skykassa_refund:      RotateCcw,
  skykassa_bonus:       Sparkles,
  kbiz_sub:             Sparkles,
  code_points:          Ticket,
  cashback:             Gift,
  launcher_placement:   Gamepad2,
  launcher_refund:      RotateCcw,
  prime_reward:         Gift,
  prime_reward_refund:  Gift,
  blox_purchase:        Gamepad2,
  blox_refund:          RotateCcw,
  blox_payout:          Gamepad2,
  blox_commission_payout: Gamepad2,
  blox_commission_topup: Gamepad2,
};

export interface Transaction {
  id:        string;
  userId:    string;
  type:      TxType;
  amount:    number;      // > 0 = приход, < 0 = расход
  desc:      string;
  createdAt: string;
  ref?:      string;      // ID заказа / подписки / трека
  /** 'rub' — рубли, 'pts' — Prime Points. Сервер ставит у новых записей; у старых — по виду операции. */
  currency?: 'rub' | 'pts';
}

/** Виды операций, которые всегда в баллах (для записей без currency). */
const POINTS_TYPES = new Set<string>(['points_earn', 'points_spend', 'points_refund', 'admin_points', 'code_points', 'cashback']);
export const isPoints = (t: { type: string; currency?: string }) =>
  t.currency ? t.currency === 'pts' : POINTS_TYPES.has(t.type);

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

    // Первый запрос после входа нередко уходит раньше, чем готов токен, или теряется в сети —
    // тогда баланс оставался 0 до перезагрузки. Повторяем с паузами и не бросаем ошибку наружу.
    refresh: async () => {
      for (const wait of [0, 1200, 3000, 6000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          const snap = await fetchWallet();
          if (snap) { apply(snap); return; }
        } catch { /* повторим */ }
      }
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
export const fmtPts = (n: number) => `${Math.abs(n).toLocaleString('ru')} баллов`;
export const fmtTx = (t: { type: string; amount: number; currency?: string }) =>
  isPoints(t) ? `${t.amount > 0 ? '+' : t.amount < 0 ? '−' : ''}${fmtPts(t.amount)}` : fmtSigned(t.amount);
