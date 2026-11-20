/* ===============================================================
   SKY ADS  -  Рекламный кабинет

   Раньше кампании, модерация, показы и клики целиком жили в
   localStorage браузера. Теперь источник истины — сервер
   (server/ads.mjs): этот файл только держит последний ответ сервера
   и зовёт adsApi.ts на каждое действие.
=============================================================== */
import { create } from 'zustand';
import { Film, Tv, Flower2, Camera, Megaphone, Pin, ShoppingBag } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';
import {
  apiAdsTicket, apiMyCampaigns, apiCreateCampaign, apiPauseCampaign, apiResumeCampaign,
  apiCancelCampaign, adMediaUrl, type CreateCampaignInput,
} from './adsApi';

export type AdPlacement =
  | 'video_preroll'   // перед видео
  | 'film_preroll'    // перед кино
  | 'video_banner'    // баннер поверх видео
  | 'bloom_feed'      // пост в Bloom-ленте
  | 'bloom_stories'   // в историях
  | 'channel_post'    // пост в канале
  | 'channel_pin'     // закреплённый пост в канале
  | 'market_feed'     // карточка среди товаров Sky Market
  | 'market_product'; // баннер на странице товара Sky Market

/** Статусы сервера (server/ads.mjs) — полный жизненный цикл кампании. */
export type AdStatus =
  | 'draft'
  | 'moderation'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type AdFormat =
  | 'video'       // до 30 сек
  | 'image'       // статичный баннер
  | 'text'        // текстовый пост
  | 'text_image'; // текст + картинка

/** Форма кампании, как её отдаёт сервер (см. toCampaign в server/ads.mjs). */
export interface AdCampaign {
  id:           string;
  userId:       string;
  title:        string;
  description:  string;
  mediaId?:     string;
  linkUrl?:     string;
  placement:    AdPlacement;
  format:       AdFormat;
  budget:       number;
  spent:        number;
  dailyLimit:   number;
  startDate?:   string;
  endDate?:     string;
  durationDays: number;
  status:       AdStatus;
  createdAt:    string;
  moderatedAt?: string;
  rejectReason?: string;
  targetRegions: string[];
  impressions:  number;
  clicks:       number;
  ctr:          number;
}

export interface AdPricing {
  placement:    AdPlacement;
  label:        string;
  description:  string;
  Icon:         IconComponent;
  pricePerDay:  number;         // ₽/день
  minDays:      number;
  maxImpressions: number;       // охват в день
  formats:      AdFormat[];
}

/** Отображение и подсказки в интерфейсе. Ценам и лимитам отсюда сервер
 * не доверяет — при создании кампании он всегда считает сам по своей
 * копии этой же таблицы (PLACEMENTS в server/ads.mjs). */
export const AD_PLACEMENTS: AdPricing[] = [
  { placement: 'market_feed', label: 'Market  -  Каталог', description: 'Рекламная карточка среди товаров каталога Sky Market (с пометкой «Реклама»)', Icon: ShoppingBag, pricePerDay: 700, minDays: 1, maxImpressions: 10000, formats: ['text', 'text_image', 'image'] },
  { placement: 'market_product', label: 'Market  -  Страница товара', description: 'Баннер на странице товара Sky Market (с пометкой «Реклама»)', Icon: ShoppingBag, pricePerDay: 500, minDays: 1, maxImpressions: 8000, formats: ['text_image', 'image'] },
  {
    placement:     'video_preroll',
    label:         'Видео  -  Преролл',
    description:   'Видеореклама до 30 сек перед роликами Sky Video',
    Icon:          Film,
    pricePerDay:   1500,
    minDays:       3,
    maxImpressions:5000,
    formats:       ['video','image'],
  },
  {
    placement:     'video_banner',
    label:         'Видео  -  Баннер',
    description:   'Баннер поверх видео в правом нижнем углу',
    Icon:          Tv,
    pricePerDay:   800,
    minDays:       1,
    maxImpressions:8000,
    formats:       ['image','text_image'],
  },
  {
    placement:     'bloom_feed',
    label:         'Bloom  -  Лента',
    description:   'Рекламный пост в социальной ленте Bloom среди обычных постов',
    Icon:          Flower2,
    pricePerDay:   600,
    minDays:       1,
    maxImpressions:12000,
    formats:       ['text','text_image','image'],
  },
  {
    placement:     'bloom_stories',
    label:         'Bloom  -  Истории',
    description:   'Полноэкранная реклама в историях Sky',
    Icon:          Camera,
    pricePerDay:   1200,
    minDays:       1,
    maxImpressions:7000,
    formats:       ['image','video'],
  },
  {
    placement:     'channel_post',
    label:         'Каналы  -  Пост',
    description:   'Рекламный пост в популярных каналах Sky Messenger',
    Icon:          Megaphone,
    pricePerDay:   400,
    minDays:       1,
    maxImpressions:3000,
    formats:       ['text','text_image'],
  },
  {
    placement:     'channel_pin',
    label:         'Каналы  -  Закреп',
    description:   'Закреплённый пост в шапке канала  -  максимальная видимость',
    Icon:          Pin,
    pricePerDay:   2500,
    minDays:       1,
    maxImpressions:4000,
    formats:       ['text','text_image','image'],
  },
];

export const AD_FORMAT_LABEL: Record<AdFormat, string> = {
  video:      'Видеоролик',
  image:      'Изображение',
  text:       'Текстовый пост',
  text_image: 'Текст + картинка',
};

export const AD_STATUS_LABEL: Record<AdStatus, string> = {
  draft:      'Черновик',
  moderation: 'На модерации',
  approved:   'Одобрена',
  rejected:   'Отклонена',
  scheduled:  'Запланирована',
  active:     'Активна',
  paused:     'На паузе',
  completed:  'Завершена',
  cancelled:  'Отменена',
};

export const AD_STATUS_COLOR: Record<AdStatus, string> = {
  draft:      '#8a8a96',
  moderation: '#f59e0b',
  approved:   '#60a5fa',
  rejected:   '#f87171',
  scheduled:  '#818cf8',
  active:     '#34d399',
  paused:     '#8a8a96',
  completed:  '#45454f',
  cancelled:  '#f87171',
};

/** Адрес картинки/видео кампании — тег <img>/<video> тянет его сам. */
export const campaignMediaUrl = (c: AdCampaign) => c.mediaId ? adMediaUrl(c.mediaId) : undefined;

interface AdsState {
  campaigns: AdCampaign[];
  loaded:    boolean;
  loading:   boolean;
  load:      (force?: boolean) => Promise<void>;
  create:    (input: CreateCampaignInput) => Promise<{ ok: true; campaign: AdCampaign } | { ok: false; error?: string; reason?: string }>;
  pause:     (id: string) => Promise<boolean>;
  resume:    (id: string) => Promise<boolean>;
  cancel:    (id: string) => Promise<boolean>;
  getMy:     (userId: string) => AdCampaign[];
}

export const useAdsStore = create<AdsState>((set, get) => ({
  campaigns: [],
  loaded: false,
  loading: false,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    await apiAdsTicket();
    const items = await apiMyCampaigns();
    set({ campaigns: items, loaded: true, loading: false });
  },

  create: async (input) => {
    const r = await apiCreateCampaign(input);
    if (r.ok) await get().load(true);
    return r;
  },

  pause: async (id) => {
    const ok = await apiPauseCampaign(id);
    if (ok) await get().load(true);
    return ok;
  },
  resume: async (id) => {
    const ok = await apiResumeCampaign(id);
    if (ok) await get().load(true);
    return ok;
  },
  cancel: async (id) => {
    const ok = await apiCancelCampaign(id);
    if (ok) await get().load(true);
    return ok;
  },

  /** Кампании уже принадлежат вызвавшему (сервер отдаёт только свои) —
   * userId здесь не нужен для фильтрации, но оставлен для совместимости
   * с прежним вызовом из SkyAdsCabinet. */
  getMy: () => get().campaigns,
}));

export const fmtBudget = (n: number) =>
  n.toLocaleString('ru', { style:'currency', currency:'RUB', minimumFractionDigits:0 });
