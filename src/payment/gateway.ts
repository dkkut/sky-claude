/* ===============================================================
   SKY PAY  -  Платёжный шлюз
   Архитектура: провайдер-агностик, как у Telegram Payments.
   Сейчас: эмуляция с реалистичной задержкой и статусами.
   На сервере: подключить провайдера (ЮKassa / Stripe / СБП)
   одной строкой  -  заменить execute() в GatewayProvider.
=============================================================== */
import { create } from 'zustand';
import { CreditCard, Globe, Zap, Wallet } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

/* -- Типы ------------------------------------------------------ */
export type PayProvider  = 'skypay_card' | 'skypay_intl' | 'skypay_sbp' | 'skypay_paypal';
export type PayStatus    = 'created' | 'pending' | 'processing' | 'confirmed' | 'failed' | 'refunded' | 'expired';
export type PayPurpose   = 'wallet_topup' | 'prime_month' | 'prime_year' | 'prime_2year' | 'market_order' | 'music_purchase';

export const PURPOSE_LABEL: Record<PayPurpose, string> = {
  wallet_topup:    'Пополнение кошелька',
  prime_month:     'Sky Prime  -  1 месяц',
  prime_year:      'Sky Prime  -  1 год',
  prime_2year:     'Sky Prime  -  2 года',
  market_order:    'Покупка в Sky Market',
  music_purchase:  'Покупка трека',
};

export interface PaymentSession {
  id:          string;          // SKY-PAY-XXXXXXXXXXXX
  userId:      string;
  purpose:     PayPurpose;
  amount:      number;          // в рублях
  fee:         number;          // комиссия провайдера
  total:       number;          // amount + fee
  currency:    'RUB';
  provider:    PayProvider;
  status:      PayStatus;
  createdAt:   string;
  updatedAt:   string;
  confirmedAt?: string;
  failedAt?:   string;
  refundedAt?: string;
  errorCode?:  string;
  errorMsg?:   string;
  // Зашифрованные данные (в prod  -  токенизация провайдером, НЕ хранятся в открытую)
  meta?:       Record<string, string>;
}

export interface CardData {
  number:  string;   // последние 4 цифры  -  маска
  expiry:  string;   // MM/YY
  holder:  string;
  brand:   'visa' | 'mastercard' | 'mir' | 'amex' | 'unknown';
}

/* -- Provider config (будет храниться на сервере) --------------- */
interface ProviderConfig {
  id:       PayProvider;
  label:    string;
  Icon:     IconComponent;
  feeRate:  number;   // 0..1
  minFee:   number;   // минимальная комиссия ₽
  enabled:  boolean;
  // На сервере: apiKey, secretKey, webhookSecret
}

export const PROVIDERS: ProviderConfig[] = [
  { id:'skypay_card',   label:'Карта РФ',          Icon:CreditCard, feeRate:0,     minFee:0,  enabled:true  },
  { id:'skypay_intl',   label:'Зарубежная карта',   Icon:Globe,      feeRate:0.015, minFee:10, enabled:true  },
  { id:'skypay_sbp',    label:'СБП',               Icon:Zap,        feeRate:0,     minFee:0,  enabled:true  },
  { id:'skypay_paypal', label:'PayPal',             Icon:Wallet,     feeRate:0.025, minFee:15, enabled:true  },
];

/* -- Gateway Provider Interface (заменить на реальный в prod) -- */
export interface IGatewayProvider {
  name:      string;
  /* Создать платёжный счёт у провайдера */
  createInvoice(session: PaymentSession, cardData?: CardData): Promise<{ invoiceId: string; redirectUrl?: string }>;
  /* Подтвердить оплату (вебхук или polling) */
  checkStatus(invoiceId: string): Promise<'confirmed' | 'failed' | 'pending'>;
  /* Рефанд */
  refund(invoiceId: string, amount: number): Promise<boolean>;
}

/* -- Demo Gateway Provider (реалистичная эмуляция) ------------ */
export class DemoGatewayProvider implements IGatewayProvider {
  name = 'SkyPay Demo';

  async createInvoice(session: PaymentSession, cardData?: CardData) {
    // Симулируем сетевой запрос к процессингу
    await delay(600 + Math.random() * 400);
    // В prod: POST /api/pay/create → {invoiceId, redirectUrl}
    return { invoiceId: `INV-${Date.now()}` };
  }

  async checkStatus(invoiceId: string) {
    // Симулируем 3DS / подтверждение банка
    await delay(1200 + Math.random() * 800);
    // В prod: GET /api/pay/status/:invoiceId или вебхук
    // 95% успех в демо
    return Math.random() > 0.05 ? 'confirmed' as const : 'failed' as const;
  }

  async refund(invoiceId: string, amount: number) {
    await delay(500);
    return true;
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/* -- Session ID generator --------------------------------------- */
const newSessionId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand  = Array.from({ length:12 }, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `SKY-PAY-${rand}`;
};

/* -- Storage ---------------------------------------------------- */
const STORE_KEY = 'sky:pay:sessions:v1';
const W         = typeof window !== 'undefined';

const loadSessions = (): PaymentSession[] => {
  if (!W) return [];
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
};
const saveSessions = (sessions: PaymentSession[]) => {
  if (!W) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(sessions)); } catch {}
};

/* === PAY STORE ================================================ */
interface PayStore {
  sessions:    PaymentSession[];
  provider:    IGatewayProvider;

  /* Создать новую сессию */
  createSession: (
    userId:   string,
    purpose:  PayPurpose,
    amount:   number,
    prov:     PayProvider,
  ) => PaymentSession;

  /* Запустить оплату */
  executePayment: (
    sessionId: string,
    cardData?: CardData,
    onProgress?: (status: PayStatus) => void,
  ) => Promise<PaymentSession>;

  /* Вернуть деньги */
  refundSession: (sessionId: string) => Promise<boolean>;

  /* Обновить статус (для вебхука с сервера) */
  updateStatus: (sessionId: string, status: PayStatus, meta?: Record<string, string>) => void;

  /* Получить сессии пользователя */
  getUserSessions: (userId: string) => PaymentSession[];
}

export const usePayGateway = create<PayStore>((set, get) => {
  const gw = new DemoGatewayProvider();

  const persist = () => setTimeout(() => saveSessions(get().sessions), 0);

  const mutSession = (id: string, patch: Partial<PaymentSession>) => {
    set(s => ({
      sessions: s.sessions.map(sess =>
        sess.id === id ? { ...sess, ...patch, updatedAt: new Date().toISOString() } : sess
      ),
    }));
    persist();
  };

  return {
    sessions: loadSessions(),
    provider: gw,

    createSession: (userId, purpose, amount, prov) => {
      const cfg  = PROVIDERS.find(p => p.id === prov)!;
      const fee  = Math.max(cfg.minFee, Math.round(amount * cfg.feeRate));
      const sess: PaymentSession = {
        id:         newSessionId(),
        userId,
        purpose,
        amount,
        fee,
        total:      amount + fee,
        currency:   'RUB',
        provider:   prov,
        status:     'created',
        createdAt:  new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
      };
      set(s => ({ sessions: [...s.sessions, sess] }));
      persist();
      return sess;
    },

    executePayment: async (sessionId, cardData, onProgress) => {
      const sess = get().sessions.find(s => s.id === sessionId);
      if (!sess) throw new Error('Session not found');

      // 1. Pending
      mutSession(sessionId, { status: 'pending' });
      onProgress?.('pending');

      try {
        // 2. Create invoice at provider
        const { invoiceId } = await gw.createInvoice(sess, cardData);
        mutSession(sessionId, { status: 'processing', meta: { invoiceId } });
        onProgress?.('processing');

        // 3. Confirm / 3DS
        const result = await gw.checkStatus(invoiceId);

        if (result === 'confirmed') {
          mutSession(sessionId, { status: 'confirmed', confirmedAt: new Date().toISOString() });
          onProgress?.('confirmed');
        } else {
          mutSession(sessionId, {
            status: 'failed', failedAt: new Date().toISOString(),
            errorCode: 'DECLINED', errorMsg: 'Платёж отклонён банком',
          });
          onProgress?.('failed');
        }
      } catch (e) {
        mutSession(sessionId, {
          status: 'failed', failedAt: new Date().toISOString(),
          errorCode: 'NETWORK_ERR', errorMsg: 'Ошибка соединения',
        });
        onProgress?.('failed');
      }

      return get().sessions.find(s => s.id === sessionId)!;
    },

    refundSession: async (sessionId) => {
      const sess = get().sessions.find(s => s.id === sessionId);
      if (!sess || sess.status !== 'confirmed') return false;
      const ok = await gw.refund(sess.meta?.invoiceId ?? '', sess.amount);
      if (ok) mutSession(sessionId, { status: 'refunded', refundedAt: new Date().toISOString() });
      return ok;
    },

    updateStatus: (sessionId, status, meta) => {
      mutSession(sessionId, { status, ...(meta ? { meta } : {}) });
    },

    getUserSessions: (userId) =>
      get().sessions
        .filter(s => s.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
});

/* -- Helpers --------------------------------------------------- */
export const detectCardBrand = (num: string): CardData['brand'] => {
  const n = num.replace(/\s/g, '');
  if (/^4/.test(n))           return 'visa';
  if (/^5[1-5]/.test(n))      return 'mastercard';
  if (/^2/.test(n))           return 'mir';
  if (/^3[47]/.test(n))       return 'amex';
  return 'unknown';
};

export const maskCard = (num: string) => {
  const n = num.replace(/\s/g, '');
  return n.length >= 4 ? `•••• •••• •••• ${n.slice(-4)}` : num;
};

export const fmtAmount = (n: number) =>
  n.toLocaleString('ru', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 });

export const STATUS_LABEL: Record<PayStatus, string> = {
  created:    'Создан',
  pending:    'Ожидает оплаты',
  processing: 'Обрабатывается',
  confirmed:  'Оплачен',
  failed:     'Отклонён',
  refunded:   'Возврат',
  expired:    'Истёк',
};
