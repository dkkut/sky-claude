/* ===============================================================
   SKY GAMING MARKET  -  Store
   Внутриигровые товары: скины, буст, аккаунты, валюта
=============================================================== */
import { create } from 'zustand';

import {
  Palette, Zap, Coins, User, Package, Trophy, GraduationCap,
} from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

export type GItemType =
  | 'skin'        // скины персонажей / оружия
  | 'boost'       // усилители XP / рейтинга
  | 'currency'    // внутриигровая валюта
  | 'account'     // игровой аккаунт
  | 'case'        // кейс / лутбокс
  | 'rank'        // буст ранга
  | 'coaching';   // коучинг от топ-игрока

export type GItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY_LABEL: Record<GItemRarity, string> = {
  common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный',
};
export const RARITY_COLOR: Record<GItemRarity, string> = {
  common: '#8a8a96', rare: '#4f6ef7', epic: '#a855f7', legendary: '#f59e0b',
};
export const RARITY_GLOW: Record<GItemRarity, string> = {
  common: 'rgba(138,138,150,0.3)', rare: 'rgba(79,110,247,0.4)',
  epic: 'rgba(168,85,247,0.4)', legendary: 'rgba(245,158,11,0.5)',
};

export const GITEM_TYPE_LABEL: Record<GItemType, string> = {
  skin: 'Скин', boost: 'Буст', currency: 'Валюта',
  account: 'Аккаунт', case: 'Кейс', rank: 'Ранг', coaching: 'Коучинг',
};
/** Значок вида игрового товара — вместо эмодзи, которую рисовал шрифт устройства. */
export const GITEM_TYPE_ICON: Record<GItemType, IconComponent> = {
  skin:     Palette,
  boost:    Zap,
  currency: Coins,
  account:  User,
  case:     Package,
  rank:     Trophy,
  coaching: GraduationCap,
};

export interface GamingItem {
  id:          string;
  title:       string;
  description: string;
  game:        string;
  type:        GItemType;
  rarity:      GItemRarity;
  price:       number;
  originalPrice?: number;     // для отображения скидки
  sellerId:    string;
  sellerName:  string;
  verified:    boolean;       // продавец верифицирован
  gradient:    [string, string];
  tags:        string[];
  stock:       number;
  sold:        number;
  rating:      number;
  reviews:     number;
  delivery:    'instant' | 'manual';  // мгновенная / ручная выдача
  createdAt:   string;
  featured?:   boolean;
}

export interface GamingOrder {
  id:          string;
  itemId:      string;
  itemTitle:   string;
  buyerId:     string;
  sellerId:    string;
  price:       number;
  status:      'pending' | 'delivering' | 'completed' | 'disputed';
  createdAt:   string;
  deliveredAt?: string;
  game:        string;
  type:        GItemType;
}

const GRADS: Record<string, [string, string]> = {
  'g-arena':   ['#1a1035','#4f2e8a'],
  'g-drift':   ['#0d1f3c','#1a6bce'],
  'g-nexus':   ['#0f2417','#1a7a43'],
  'g-void':    ['#1f0e0e','#8a1a1a'],
  'g-bloom':   ['#1a0d2e','#8b2fc9'],
  'g-world':   ['#1a2010','#3d7a1a'],
};

const SEED_ITEMS: GamingItem[] = [
  {
    id:'gi-1', title:'Sky Arena  -  Dragon Slayer Bundle',
    description:'Скин дракона для главного персонажа + эффект удара + спрей. Легендарная серия.',
    game:'Sky Arena', type:'skin', rarity:'legendary', price:1490, sellerId:'acc-luna',
    sellerName:'Luna Nova', verified:true, gradient:['#1a1035','#4f2e8a'],
    tags:['arena','dragon','bundle'], stock:999999, sold:234, rating:4.9, reviews:89,
    delivery:'instant', createdAt:new Date(Date.now()-86400000*3).toISOString(), featured:true,
  },
  {
    id:'gi-2', title:'Neon Drift  -  Pro Racer Pack',
    description:'3 эксклюзивных скина авто + неоновый трейл. Только для PRO игроков.',
    game:'Neon Drift', type:'skin', rarity:'epic', price:890, sellerId:'acc-neo',
    sellerName:'Neo Driver', verified:true, gradient:['#0d1f3c','#1a6bce'],
    tags:['drift','car','neon'], stock:999999, sold:156, rating:4.7, reviews:43,
    delivery:'instant', createdAt:new Date(Date.now()-86400000*5).toISOString(),
  },
  {
    id:'gi-3', title:'Sky Arena  -  2× XP Boost × 7 дней',
    description:'Двойной опыт на 7 дней. Ускорит прокачку ранга в 2 раза.',
    game:'Sky Arena', type:'boost', rarity:'rare', price:299, sellerId:'acc-luna',
    sellerName:'Luna Nova', verified:true, gradient:['#1a1035','#4f2e8a'],
    tags:['xp','boost','arena'], stock:100, sold:412, rating:4.8, reviews:210,
    delivery:'instant', createdAt:new Date(Date.now()-86400000*1).toISOString(),
  },
  {
    id:'gi-4', title:'Sky Credits × 10 000',
    description:'Внутриигровая валюта Sky Credits. Трата на любые внутриигровые покупки.',
    game:'Sky Arena', type:'currency', rarity:'common', price:499, sellerId:'acc-kutuzov',
    sellerName:'Kutuzov', verified:true, gradient:['#1a1035','#4f2e8a'],
    tags:['credits','currency'], stock:999999, sold:891, rating:5.0, reviews:320,
    delivery:'instant', createdAt:new Date(Date.now()-86400000*2).toISOString(),
  },
  {
    id:'gi-5', title:'Nexus Royale  -  Diamond Rank Boost',
    description:'Поднимем вас с Платины до Даймонда за 3-5 дней. Гарантия или возврат.',
    game:'Nexus Royale', type:'rank', rarity:'epic', price:2990, sellerId:'acc-luna',
    sellerName:'Luna Nova', verified:true, gradient:['#0f2417','#1a7a43'],
    tags:['rank','boost','diamond'], stock:5, sold:28, rating:4.9, reviews:28,
    delivery:'manual', createdAt:new Date(Date.now()-86400000*7).toISOString(), featured:true,
  },
  {
    id:'gi-6', title:'Лутбокс "Легенда" × 5 штук',
    description:'5 легендарных кейсов с гарантированным редким скином внутри.',
    game:'Sky Arena', type:'case', rarity:'legendary', price:799, originalPrice:1299,
    sellerId:'acc-neo', sellerName:'Neo Driver', verified:true, gradient:['#1f0e0e','#8a1a1a'],
    tags:['case','loot','rare'], stock:50, sold:67, rating:4.6, reviews:34,
    delivery:'instant', createdAt:new Date(Date.now()-86400000*4).toISOString(),
  },
  {
    id:'gi-7', title:'Личный коучинг от Neo Driver  -  2 часа',
    description:'2 часа персонального обучения. Разбор replay, советы по тактике, рост ранга.',
    game:'Sky Arena', type:'coaching', rarity:'epic', price:1990, sellerId:'acc-neo',
    sellerName:'Neo Driver', verified:true, gradient:['#0d1f3c','#1a6bce'],
    tags:['coaching','pro','session'], stock:3, sold:12, rating:5.0, reviews:12,
    delivery:'manual', createdAt:new Date(Date.now()-86400000*2).toISOString(), featured:true,
  },
  {
    id:'gi-8', title:'Sky World  -  аккаунт Master ранга',
    description:'Готовый аккаунт с Master рангом и 1620 часами. Все достижения сезона 4.',
    game:'Sky World', type:'account', rarity:'legendary', price:4990, sellerId:'acc-kutuzov',
    sellerName:'Kutuzov', verified:true, gradient:['#1a2010','#3d7a1a'],
    tags:['account','master','sky-world'], stock:1, sold:3, rating:4.8, reviews:3,
    delivery:'manual', createdAt:new Date(Date.now()-86400000*10).toISOString(),
  },
];


/* -- Storage --------------------------------------------------- */
const GK = 'sky:gaming-market:v1';
const W  = typeof window !== 'undefined';
const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(GK)||'null'); } catch { return null; } };
const save = (d: object) => { if (!W) return; try { localStorage.setItem(GK, JSON.stringify(d)); } catch {} };

const stored = load();

interface GMarketState {
  items:  GamingItem[];
  orders: GamingOrder[];
  buyItem: (itemId: string, userId: string) => GamingOrder | null;
  getMyOrders: (userId: string) => GamingOrder[];
}

export const useGamingMarket = create<GMarketState>((set, get) => ({
  items:  stored?.items  ?? SEED_ITEMS,
  orders: stored?.orders ?? [],

  buyItem: (itemId, userId) => {
    const item = get().items.find(i => i.id === itemId);
    if (!item || item.stock <= 0) return null;
    const order: GamingOrder = {
      id:        `go-${Date.now()}`,
      itemId,
      itemTitle: item.title,
      buyerId:   userId,
      sellerId:  item.sellerId,
      price:     item.price,
      status:    item.delivery === 'instant' ? 'delivering' : 'pending',
      createdAt: new Date().toISOString(),
      game:      item.game,
      type:      item.type,
      ...(item.delivery === 'instant' ? { deliveredAt: new Date().toISOString() } : {}),
    };
    set(s => ({
      orders: [...s.orders, order],
      items:  s.items.map(i => i.id === itemId && i.stock < 999999
        ? { ...i, stock: i.stock - 1, sold: i.sold + 1 } : i),
    }));
    save({ items: get().items, orders: get().orders });
    return order;
  },

  getMyOrders: (userId) =>
    get().orders.filter(o => o.buyerId === userId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)),
}));

export const fmtGPrice = (n: number) =>
  n.toLocaleString('ru', { style:'currency', currency:'RUB', minimumFractionDigits:0 });
