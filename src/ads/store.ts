/* ===============================================================
   SKY ADS  -  Рекламный кабинет
   Реклама в: Видеохостинге, Каналах, Bloom-ленте
=============================================================== */
import { create } from 'zustand';
import { Film, Tv, Flower2, Camera, Megaphone, Pin } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

export type AdPlacement =
  | 'video_preroll'   // перед видео
  | 'video_banner'    // баннер поверх видео
  | 'bloom_feed'      // пост в Bloom-ленте
  | 'bloom_stories'   // в историях
  | 'channel_post'    // пост в канале
  | 'channel_pin';    // закреплённый пост в канале

export type AdStatus =
  | 'draft'
  | 'moderation'
  | 'active'
  | 'paused'
  | 'finished'
  | 'rejected';

export type AdFormat =
  | 'video'       // до 30 сек
  | 'image'       // статичный баннер
  | 'text'        // текстовый пост
  | 'text_image'; // текст + картинка

export interface AdCampaign {
  id:           string;
  userId:       string;
  title:        string;          // название кампании
  description:  string;         // рекламный текст
  imageUrl?:    string;         // base64 или URL
  videoUrl?:    string;
  linkUrl?:     string;         // ссылка куда ведёт реклама
  placement:    AdPlacement;
  format:       AdFormat;
  budget:       number;         // общий бюджет ₽
  spent:        number;         // потрачено ₽
  dailyLimit:   number;         // дневной лимит ₽
  startDate:    string;         // ISO date
  endDate:      string;
  durationDays: number;
  status:       AdStatus;
  createdAt:    string;
  moderatedAt?: string;
  rejectReason?: string;
  // Статистика
  impressions:  number;
  clicks:       number;
  ctr:          number;         // click-through rate %
  // Таргетинг
  targetAge?:   [number, number]; // [min, max]
  targetGender?: 'all' | 'm' | 'f';
  targetInterests?: string[];
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

export const AD_PLACEMENTS: AdPricing[] = [
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
  active:     'Активна',
  paused:     'На паузе',
  finished:   'Завершена',
  rejected:   'Отклонена',
};

export const AD_STATUS_COLOR: Record<AdStatus, string> = {
  draft:      '#8a8a96',
  moderation: '#f59e0b',
  active:     '#34d399',
  paused:     '#8a8a96',
  finished:   '#45454f',
  rejected:   '#f87171',
};

/* -- Storage ----------------------------------------------- */
const SK = 'sky:ads:v1';
const W  = typeof window !== 'undefined';
const load  = () => { if (!W) return []; try { return JSON.parse(localStorage.getItem(SK)||'[]'); } catch { return []; } };
const save  = (d: AdCampaign[]) => { if (!W) return; try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };

interface AdsState {
  campaigns: AdCampaign[];
  create:    (c: Omit<AdCampaign,'id'|'createdAt'|'spent'|'impressions'|'clicks'|'ctr'|'status'>) => string;
  update:    (id: string, patch: Partial<AdCampaign>) => void;
  pause:     (id: string) => void;
  resume:    (id: string) => void;
  delete:    (id: string) => void;
  getMy:     (userId: string) => AdCampaign[];
  // Admin
  moderate:  (id: string, approve: boolean, reason?: string) => void;
  getPending:() => AdCampaign[];
}

export const useAdsStore = create<AdsState>((set, get) => ({
  campaigns: load(),

  create: (params) => {
    const id = `ad-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const campaign: AdCampaign = {
      ...params, id,
      createdAt:   new Date().toISOString(),
      spent:       0,
      impressions: 0,
      clicks:      0,
      ctr:         0,
      status:      'moderation',
    };
    set(s => { const next = [...s.campaigns, campaign]; save(next); return { campaigns: next }; });
    return id;
  },

  update: (id, patch) => {
    set(s => { const next = s.campaigns.map(c => c.id===id ? {...c,...patch} : c); save(next); return { campaigns: next }; });
  },

  pause:  (id) => get().update(id, { status: 'paused' }),
  resume: (id) => get().update(id, { status: 'active' }),
  delete: (id) => {
    set(s => { const next = s.campaigns.filter(c => c.id!==id); save(next); return { campaigns: next }; });
  },

  getMy: (userId) =>
    get().campaigns.filter(c => c.userId === userId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)),

  moderate: (id, approve, reason) => {
    get().update(id, {
      status:      approve ? 'active' : 'rejected',
      moderatedAt: new Date().toISOString(),
      rejectReason: reason,
    });
    // Simulate impressions/clicks if active
    if (approve) {
      const c = get().campaigns.find(x => x.id===id);
      if (c) {
        setTimeout(() => {
          const imp = Math.floor(Math.random() * 3000 + 500);
          const clk = Math.floor(imp * (0.02 + Math.random()*0.06));
          get().update(id, { impressions: imp, clicks: clk, ctr: parseFloat((clk/imp*100).toFixed(1)) });
        }, 500);
      }
    }
  },

  getPending: () => get().campaigns.filter(c => c.status === 'moderation'),
}));

export const fmtBudget = (n: number) =>
  n.toLocaleString('ru', { style:'currency', currency:'RUB', minimumFractionDigits:0 });
