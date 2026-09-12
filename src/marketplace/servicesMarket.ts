/* ===============================================================
   SKY SERVICES MARKET  -  Store
   Биржа услуг: дизайн, разработка, музыка, контент
=============================================================== */
import { create } from 'zustand';

import {
  Palette, Code2, Music2, Film, PenLine, Megaphone, Swords, Wrench,
} from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

export type ServiceCategory =
  | 'design'       // графика, UI/UX
  | 'dev'          // разработка
  | 'music'        // написание музыки, битмейкинг
  | 'video'        // монтаж, анимация
  | 'writing'      // тексты, копирайтинг
  | 'marketing'    // SMM, реклама
  | 'gaming'       // гейминг услуги (отдельно от gaming market)
  | 'other';

export const SVC_CAT_LABEL: Record<ServiceCategory, string> = {
  design: 'Дизайн', dev: 'Разработка', music: 'Музыка',
  video: 'Видео', writing: 'Текст', marketing: 'Маркетинг',
  gaming: 'Гейминг', other: 'Другое',
};
/**
 * Значок категории услуги. Раньше была эмодзи — её рисовал шрифт
 * устройства, поэтому картинка отличалась на телефоне, компьютере и
 * телевизоре, а под цвет темы не подгонялась.
 */
export const SVC_CAT_ICON: Record<ServiceCategory, IconComponent> = {
  design:    Palette,
  dev:       Code2,
  music:     Music2,
  video:     Film,
  writing:   PenLine,
  marketing: Megaphone,
  gaming:    Swords,
  other:     Wrench,
};
export const SVC_CAT_COLOR: Record<ServiceCategory, string> = {
  design: '#ec4899', dev: '#4f6ef7', music: '#a855f7', video: '#f43f5e',
  writing: '#f59e0b', marketing: '#34d399', gaming: '#8b5cf6', other: '#8a8a96',
};

export type ServiceLevel = 'basic' | 'standard' | 'premium';

export interface ServicePackage {
  level:       ServiceLevel;
  title:       string;
  description: string;
  price:       number;
  delivery:    number;  // дней
  revisions:   number;
  includes:    string[];
}

export interface ServiceListing {
  id:          string;
  title:       string;
  description: string;
  category:    ServiceCategory;
  sellerId:    string;
  sellerName:  string;
  sellerAvatar?: string;
  sellerLevel: 'new' | 'pro' | 'top';  // уровень исполнителя
  verified:    boolean;
  packages:    ServicePackage[];
  tags:        string[];
  rating:      number;
  reviews:     number;
  sold:        number;
  portfolio:   string[];  // URLs / base64
  gradient:    [string, string];
  featured?:   boolean;
  createdAt:   string;
}

export interface ServiceOrder {
  id:            string;
  listingId:     string;
  listingTitle:  string;
  buyerId:       string;
  sellerId:      string;
  sellerName:    string;
  package:       ServiceLevel;
  price:         number;
  delivery:      number;
  status:        'pending' | 'in_work' | 'review' | 'completed' | 'revision' | 'cancelled';
  requirements?: string;
  createdAt:     string;
  deadline:      string;
  completedAt?:  string;
}

const STATUS_LABEL_SVC: Record<ServiceOrder['status'], string> = {
  pending:   'Ожидание', in_work: 'В работе', review: 'На проверке',
  completed: 'Выполнен', revision: 'На доработке', cancelled: 'Отменён',
};

const SEED_LISTINGS: ServiceListing[] = [
  {
    id:'svc-1', title:'Создам логотип для вашего бренда / канала',
    description:'Профессиональный логотип в фирменном стиле. AI-free, ручная работа. Вектор + PNG.',
    category:'design', sellerId:'acc-luna', sellerName:'Luna Nova',
    sellerLevel:'top', verified:true,
    packages:[
      { level:'basic',    title:'Базовый',   description:'1 концепт, 2 правки',      price:1500, delivery:3,  revisions:2, includes:['PNG 2000×2000','JPG'] },
      { level:'standard', title:'Стандарт',  description:'3 концепта, 5 правок',     price:3500, delivery:5,  revisions:5, includes:['PNG','SVG вектор','Фавикон','Гайдлайн цветов'] },
      { level:'premium',  title:'Премиум',   description:'5 концептов, безлимит правок', price:7900, delivery:7, revisions:-1, includes:['Полный брендпак','Визитка','Баннеры'] },
    ],
    tags:['logo','branding','design'], rating:4.9, reviews:67, sold:89,
    portfolio:[], gradient:['#1a0533','#ec4899'],
    featured:true, createdAt:new Date(Date.now()-86400000*14).toISOString(),
  },
  {
    id:'svc-2', title:'Напишу трек / бит под ваш проект',
    description:'Профессиональный битмейкинг и саундтреки. Synthwave, Ambient, Trap, EDM.',
    category:'music', sellerId:'acc-luna', sellerName:'Luna Nova',
    sellerLevel:'top', verified:true,
    packages:[
      { level:'basic',    title:'Бит',      description:'1 авторский бит, WAV',       price:2000, delivery:5,  revisions:2, includes:['WAV 44.1kHz','Продажа прав'] },
      { level:'standard', title:'Трек',     description:'Полный трек с мастерингом',  price:5000, delivery:10, revisions:3, includes:['WAV+MP3','Мастеринг','Обложка'] },
      { level:'premium',  title:'Саундтрек',description:'EP из 3 треков',             price:12000,delivery:21, revisions:-1,includes:['3 трека','Все форматы','Эксклюзивность'] },
    ],
    tags:['music','beat','synthwave'], rating:5.0, reviews:34, sold:41,
    portfolio:[], gradient:['#200122','#a855f7'],
    featured:true, createdAt:new Date(Date.now()-86400000*7).toISOString(),
  },
  {
    id:'svc-3', title:'Разработка Telegram-бота под ваши задачи',
    description:'Python / Node.js бот с любой логикой: оплата, каталог, рассылка, CRM.',
    category:'dev', sellerId:'acc-neo', sellerName:'Neo Driver',
    sellerLevel:'pro', verified:true,
    packages:[
      { level:'basic',    title:'Базовый',  description:'Простой бот до 5 команд',    price:3000, delivery:3,  revisions:2, includes:['Исходный код','Деплой','1 мес поддержки'] },
      { level:'standard', title:'Продвинутый', description:'Бот с БД и платежами',    price:8000, delivery:7,  revisions:5, includes:['Полный функционал','API интеграции','3 мес поддержки'] },
      { level:'premium',  title:'Под ключ', description:'Сложный бот с панелью',      price:20000,delivery:21, revisions:-1,includes:['Бот + веб-панель','SLA','6 мес поддержки'] },
    ],
    tags:['telegram','bot','python','node'], rating:4.8, reviews:22, sold:31,
    portfolio:[], gradient:['#0d1422','#4f6ef7'],
    createdAt:new Date(Date.now()-86400000*5).toISOString(),
  },
  {
    id:'svc-4', title:'Монтаж и аниграфика для YouTube / Shorts',
    description:'Динамичный монтаж, моушн-дизайн, субтитры, цветокоррекция. Знаю тренды.',
    category:'video', sellerId:'acc-kutuzov', sellerName:'Kutuzov',
    sellerLevel:'pro', verified:true,
    packages:[
      { level:'basic',    title:'Ролик до 5 мин', description:'Монтаж без анимации', price:2500, delivery:3,  revisions:3, includes:['MP4 1080p','Музыка'] },
      { level:'standard', title:'YouTube видео',   description:'Монтаж + анимация',  price:6000, delivery:7,  revisions:5, includes:['MP4 4K','Анимация','Субтитры','Превью'] },
      { level:'premium',  title:'Полный продакшн', description:'Съёмка+монтаж',      price:15000,delivery:14, revisions:-1,includes:['Всё включено','Сценарий','Бренд-кит'] },
    ],
    tags:['video','youtube','montage','motion'], rating:4.7, reviews:15, sold:19,
    portfolio:[], gradient:['#0f2417','#f43f5e'],
    createdAt:new Date(Date.now()-86400000*3).toISOString(),
  },
  {
    id:'svc-5', title:'SMM ведение аккаунта в социальных сетях',
    description:'Полное ведение ВК, TG, Instagram. Контент-план, посты, сторис, аналитика.',
    category:'marketing', sellerId:'acc-luna', sellerName:'Luna Nova',
    sellerLevel:'top', verified:true,
    packages:[
      { level:'basic',    title:'Старт',    description:'10 постов/мес, 1 сеть',   price:8000,  delivery:30, revisions:2, includes:['Контент-план','Тексты+фото','Отчёт'] },
      { level:'standard', title:'Актив',    description:'20 постов, 2 сети',       price:15000, delivery:30, revisions:5, includes:['2 сети','Сторис','Аналитика'] },
      { level:'premium',  title:'Полный',   description:'Безлим постов, все сети', price:30000, delivery:30, revisions:-1,includes:['Все соцсети','Таргет','Рекламный бюджет'] },
    ],
    tags:['smm','social','marketing','content'], rating:4.9, reviews:41, sold:53,
    portfolio:[], gradient:['#1a2010','#34d399'],
    featured:true, createdAt:new Date(Date.now()-86400000*10).toISOString(),
  },
  {
    id:'svc-6', title:'Написание текстов SEO / лонгриды / сценарии',
    description:'Экспертные тексты для сайтов, сценарии для YouTube, рекламные тексты.',
    category:'writing', sellerId:'acc-kutuzov', sellerName:'Kutuzov',
    sellerLevel:'pro', verified:true,
    packages:[
      { level:'basic',    title:'Статья',   description:'1000 слов SEO-текст',  price:1500, delivery:2,  revisions:2, includes:['Текст','Ключевые слова'] },
      { level:'standard', title:'Лонгрид',  description:'3000 слов + инфографика', price:4000, delivery:5, revisions:3, includes:['Текст+инфо','Метатеги'] },
      { level:'premium',  title:'Сценарий', description:'Полный сценарий видео', price:8000, delivery:7, revisions:-1,includes:['Сценарий','Раскадровка','Правки'] },
    ],
    tags:['seo','text','copywriting','script'], rating:4.6, reviews:28, sold:35,
    portfolio:[], gradient:['#1a1a0e','#f59e0b'],
    createdAt:new Date(Date.now()-86400000*6).toISOString(),
  },
];

const SK = 'sky:services-market:v1';
const W  = typeof window !== 'undefined';
const loadS = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(SK)||'null'); } catch { return null; } };
const saveS = (d: object) => { if (!W) return; try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };

const storedS = loadS();

interface SvcMarketState {
  listings: ServiceListing[];
  orders:   ServiceOrder[];
  order:    (listingId: string, pkg: ServiceLevel, buyerId: string, requirements?: string) => ServiceOrder | null;
  getMyOrders: (userId: string) => ServiceOrder[];
  getMyListings: (userId: string) => ServiceListing[];
}

export const useServicesMarket = create<SvcMarketState>((set, get) => ({
  listings: storedS?.listings ?? SEED_LISTINGS,
  orders:   storedS?.orders   ?? [],

  order: (listingId, pkg, buyerId, requirements) => {
    const listing = get().listings.find(l => l.id === listingId);
    if (!listing) return null;
    const pack = listing.packages.find(p => p.level === pkg);
    if (!pack) return null;
    const deadline = new Date(Date.now() + pack.delivery * 86400000).toISOString();
    const o: ServiceOrder = {
      id:           `so-${Date.now()}`,
      listingId,
      listingTitle: listing.title,
      buyerId,
      sellerId:     listing.sellerId,
      sellerName:   listing.sellerName,
      package:      pkg,
      price:        pack.price,
      delivery:     pack.delivery,
      status:       'pending',
      requirements,
      createdAt:    new Date().toISOString(),
      deadline,
    };
    set(s => ({
      orders:   [...s.orders, o],
      listings: s.listings.map(l => l.id === listingId ? { ...l, sold: l.sold + 1 } : l),
    }));
    saveS({ listings: get().listings, orders: get().orders });
    return o;
  },

  getMyOrders: (userId) =>
    get().orders.filter(o => o.buyerId === userId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)),

  getMyListings: (userId) =>
    get().listings.filter(l => l.sellerId === userId),
}));

export { STATUS_LABEL_SVC };
export const fmtSvcPrice = (n: number) =>
  n.toLocaleString('ru', { style:'currency', currency:'RUB', minimumFractionDigits:0 });
