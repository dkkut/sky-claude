/* ===============================================================
   SKY GIFTS  -  Подарки как в Telegram
   Покупка из кошелька, отправка в чат, коллекция подарков
=============================================================== */
import { create } from 'zustand';

export type GiftRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique';

export const GIFT_RARITY_LABEL: Record<GiftRarity, string> = {
  common:    'Обычный',
  rare:      'Редкий',
  epic:      'Эпический',
  legendary: 'Легендарный',
  unique:    'Уникальный',
};

export const GIFT_RARITY_COLOR: Record<GiftRarity, string> = {
  common:    '#8a8a96',
  rare:      '#4f6ef7',
  epic:      '#a855f7',
  legendary: '#f59e0b',
  unique:    '#ec4899',
};

export const GIFT_RARITY_GLOW: Record<GiftRarity, string> = {
  common:    'rgba(138,138,150,0.3)',
  rare:      'rgba(79,110,247,0.5)',
  epic:      'rgba(168,85,247,0.5)',
  legendary: 'rgba(245,158,11,0.6)',
  unique:    'rgba(236,72,153,0.6)',
};

export const RARITY_CARD_BG: Record<GiftRarity, string> = {
  common:    'linear-gradient(155deg,#1a1a1f,#252528)',
  rare:      'linear-gradient(155deg,#0d1422,#1a2d5a)',
  epic:      'linear-gradient(155deg,#1a0533,#3d1070)',
  legendary: 'linear-gradient(155deg,#1f1400,#4a3000)',
  unique:    'linear-gradient(155deg,#1a0020,#4a0050)',
};

export const RARITY_CARD_BORDER: Record<GiftRarity, string> = {
  common:    'rgba(138,138,150,0.25)',
  rare:      'rgba(79,110,247,0.4)',
  epic:      'rgba(168,85,247,0.45)',
  legendary: 'rgba(245,158,11,0.55)',
  unique:    'rgba(236,72,153,0.55)',
};

export const RARITY_SHIMMER: Record<GiftRarity, string> = {
  common:    'rgba(255,255,255,0.03)',
  rare:      'rgba(79,110,247,0.08)',
  epic:      'rgba(168,85,247,0.1)',
  legendary: 'rgba(245,158,11,0.12)',
  unique:    'rgba(236,72,153,0.12)',
};

export const RARITY_STARS: Record<GiftRarity, string> = {
  common:    '',
  rare:      '✦',
  epic:      '✦✦',
  legendary: '✦✦✦',
  unique:    '✦✦✦✦',
};

export interface GiftItem {
  id:          string;
  name:        string;
  emoji:       string;           // animated emoji / icon
  description: string;
  rarity:      GiftRarity;
  price:       number;           // в рублях
  pricePoints: number;             // в Баллах Прайма
  gradient:    [string, string]; // фон карточки
  animation:   'bounce' | 'spin' | 'pulse' | 'float' | 'sparkle';
  available:   number;           // -1 = unlimited
  sold:        number;
  seasonal?:   boolean;
}

export interface SentGift {
  id:          string;
  giftId:      string;
  giftName:    string;
  giftEmoji:   string;
  giftRarity:  GiftRarity;
  giftGrad:    [string, string];
  fromId:      string;
  fromName:    string;
  toId:        string;
  toName:      string;
  chatId:      string;
  savedToProfile?: boolean;   // сохранено в профиль, не отправлено
  message?:    string;          // личное послание
  sentAt:      string;
  price:       number;
}

/* -- Каталог подарков ------------------------------------------- */
export const GIFT_CATALOG: GiftItem[] = [
  {
    id:'g-star',    name:'Звезда',        emoji:'⭐',
    description:'Яркая звезда для особенного человека',
    rarity:'common', pricePoints:990,  price:99,  gradient:['#1a1a0e','#5a4a00'],
    animation:'float', available:-1, sold:1240,
  },
  {
    id:'g-heart',   name:'Сердце',        emoji:'❤️',
    description:'Выразите свои чувства красиво',
    rarity:'common', pricePoints:1490, price:149, gradient:['#1f0e0e','#8a1a1a'],
    animation:'pulse', available:-1, sold:3420,
  },
  {
    id:'g-diamond', name:'Бриллиант',     emoji:'💎',
    description:'Блестящий знак высокой оценки',
    rarity:'rare',   pricePoints:4990, price:499, gradient:['#0d1422','#1a3a6c'],
    animation:'spin',  available:-1, sold:891,
  },
  {
    id:'g-crown',   name:'Корона',        emoji:'👑',
    description:'Для настоящих королей и королев',
    rarity:'epic',   pricePoints:9900, price:990, gradient:['#1a0e00','#7a3a00'],
    animation:'bounce', available:-1, sold:234,
  },
  {
    id:'g-rocket',  name:'Ракета',        emoji:'🚀',
    description:'Пусть твоя жизнь взлетает вверх!',
    rarity:'rare',   pricePoints:3990, price:399, gradient:['#0d1a30','#1a3060'],
    animation:'float', available:-1, sold:567,
  },
  {
    id:'g-fire',    name:'Огонь',         emoji:'🔥',
    description:'Огненный подарок для горячих людей',
    rarity:'common', pricePoints:1990, price:199, gradient:['#1f0e00','#7a2a00'],
    animation:'pulse', available:-1, sold:2100,
  },
  {
    id:'g-trophy',  name:'Кубок',         emoji:'🏆',
    description:'Ты чемпион! Заслуженная награда',
    rarity:'epic',   pricePoints:14900,price:1490, gradient:['#1a1a00','#6a5a00'],
    animation:'bounce', available:-1, sold:145,
  },
  {
    id:'g-crystal', name:'Кристалл',      emoji:'🔮',
    description:'Магический кристалл  -  загадочный подарок',
    rarity:'epic',   pricePoints:19900,price:1990, gradient:['#0e0e1f','#2a0a6a'],
    animation:'spin', available:-1, sold:89,
  },
  {
    id:'g-unicorn', name:'Единорог',      emoji:'🦄',
    description:'Редкий и прекрасный. Только для избранных',
    rarity:'legendary', pricePoints:49900,price:4990, gradient:['#1a0533','#8b2fc9'],
    animation:'sparkle', available:-1, sold:34,
  },
  {
    id:'g-dragon',  name:'Дракон',        emoji:'🐉',
    description:'Легендарный дракон  -  величественный подарок',
    rarity:'legendary', pricePoints:99900,price:9990, gradient:['#1f0000','#7a0000'],
    animation:'float', available:100, sold:12, seasonal:true,
  },
  {
    id:'g-galaxy',  name:'Галактика',     emoji:'🌌',
    description:'Целая галактика в одном подарке',
    rarity:'unique', pricePoints:199900,price:19990, gradient:['#000018','#001040'],
    animation:'sparkle', available:50, sold:3,
  },
  {
    id:'g-sky',     name:'Sky Premium',   emoji:'✨',
    description:'Эксклюзивный подарок экосистемы Sky',
    rarity:'unique', pricePoints:299900,price:29990, gradient:['#0d1422','#4f2e8a'],
    animation:'sparkle', available:10, sold:1, seasonal:true,
  },
];

/* -- Storage --------------------------------------------------- */
const SK = 'sky:gifts:v1';
const W  = typeof window !== 'undefined';
const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(SK)||'null'); } catch { return null; } };
const save = (d: object) => { if (!W) return; try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };

const stored = load();

interface GiftState {
  sent:    SentGift[];
  sendGift: (
    giftId:    string,
    fromId:    string,
    fromName:  string,
    toId:      string,
    toName:    string,
    chatId:    string,
    message?:  string,
  ) => SentGift | null;
  saveToProfile: (giftId: string, userId: string, userName: string, message?: string) => SentGift | null;
  getReceived: (userId: string) => SentGift[];
  getProfileGifts: (userId: string) => SentGift[];
  getSentBy:   (userId: string) => SentGift[];
  getChatGifts:(chatId: string) => SentGift[];
}

export const useGiftStore = create<GiftState>((set, get) => ({
  sent: stored?.sent ?? [],

  sendGift: (giftId, fromId, fromName, toId, toName, chatId, message) => {
    const gift = GIFT_CATALOG.find(g => g.id === giftId);
    if (!gift) return null;
    const sg: SentGift = {
      id:         `sg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      giftId,
      giftName:   gift.name,
      giftEmoji:  gift.emoji,
      giftRarity: gift.rarity,
      giftGrad:   gift.gradient,
      fromId, fromName, toId, toName, chatId,
      message:    message?.trim() || undefined,
      sentAt:     new Date().toISOString(),
      price:      gift.price,
    };
    set(s => ({ sent: [...s.sent, sg] }));
    save({ sent: get().sent });
    return sg;
  },

  saveToProfile: (giftId, userId, userName, message) => {
    const gift = GIFT_CATALOG.find(g => g.id === giftId);
    if (!gift) return null;
    const sg: SentGift = {
      id:         `sg-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      giftId,
      giftName:   gift.name,
      giftEmoji:  gift.emoji,
      giftRarity: gift.rarity,
      giftGrad:   gift.gradient,
      fromId:     userId,
      fromName:   userName,
      toId:       userId,
      toName:     userName,
      chatId:     '',
      message:    message?.trim() || undefined,
      sentAt:     new Date().toISOString(),
      price:      gift.price,
      savedToProfile: true,
    };
    set(s => ({ sent: [...s.sent, sg] }));
    save({ sent: get().sent });
    return sg;
  },

  getReceived: (userId) =>
    get().sent.filter(g => g.toId === userId)
      .sort((a,b) => b.sentAt.localeCompare(a.sentAt)),

  getSentBy: (userId) =>
    get().sent.filter(g => g.fromId === userId)
      .sort((a,b) => b.sentAt.localeCompare(a.sentAt)),

  getProfileGifts: (userId) =>
    get().sent.filter(g => g.toId === userId && g.savedToProfile)
      .sort((a,b) => b.sentAt.localeCompare(a.sentAt)),

  getChatGifts: (chatId) =>
    get().sent.filter(g => g.chatId === chatId)
      .sort((a,b) => b.sentAt.localeCompare(a.sentAt)),
}));

export const fmtGiftPrice = (n: number) =>
  n.toLocaleString('ru', { style:'currency', currency:'RUB', minimumFractionDigits:0 });
