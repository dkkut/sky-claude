/* ===============================================================
   CATALOG — Рамки профиля
   Отображаются вокруг аватара везде: в профиле, списке чатов,
   верхней панели чата, мини-профилях. Новая рамка = новая запись
   в этом массиве, без правок остального кода.
=============================================================== */
import type { CosmeticItem } from '../types';

export interface FrameItem extends CosmeticItem {
  category: 'frame';
  ring:     string;    // css gradient/border для кольца
  glow?:    string;    // подсветка вокруг аватара
  animated?: boolean;  // рамка с анимацией вращения/пульсации
}

export const FRAME_CATALOG: FrameItem[] = [
  {
    id: 'none', category: 'frame', name: 'Без рамки', description: 'Стандартный аватар без оформления',
    rarity: 'common', unlock: { type: 'default' }, obtainLabel: 'Доступна всем',
    ring: 'transparent',
  },
  {
    id: 'frame-veteran', category: 'frame', name: 'Старожил', description: 'Больше года на платформе',
    rarity: 'rare', unlock: { type: 'tenure', days: 365 }, obtainLabel: 'Стаж на Sky от 1 года',
    ring: 'linear-gradient(135deg,#8b93a8,#4b5468)',
  },
  {
    id: 'frame-business', category: 'frame', name: 'Sky Business', description: 'Строгая деловая рамка для бизнес-аккаунтов',
    rarity: 'rare', unlock: { type: 'business' }, obtainLabel: 'Аккаунт Sky Business',
    ring: 'linear-gradient(135deg,#60a5fa,#2563eb)',
  },
  {
    id: 'frame-prime', category: 'frame', name: 'Sky Prime', description: 'Золотое кольцо активной подписки Prime',
    rarity: 'epic', unlock: { type: 'prime' }, obtainLabel: 'Активная подписка Sky Prime',
    ring: 'linear-gradient(135deg,#ffd66b,#f5a623)', glow: '0 0 18px rgba(245,166,35,.55)',
  },
  {
    id: 'frame-admin', category: 'frame', name: 'Команда Sky', description: 'Рамка администратора платформы',
    rarity: 'exclusive', unlock: { type: 'admin' }, obtainLabel: 'Выдаётся команде Sky',
    ring: 'linear-gradient(135deg,#f87171,#a855f7)', glow: '0 0 18px rgba(168,85,247,.5)',
  },
  {
    id: 'frame-neon', category: 'frame', name: 'Neon', description: 'Электрическое неоновое кольцо',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 0deg,#00f0ff,#ff00e5,#00f0ff)', glow: '0 0 16px rgba(0,240,255,.5)', animated: true,
  },
  {
    id: 'frame-blue-fire', category: 'frame', name: 'Blue Fire', description: 'Синее пламя, обвивающее аватар',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 90deg,#1d4ed8,#38bdf8,#1d4ed8)', glow: '0 0 18px rgba(56,189,248,.55)', animated: true,
  },
  {
    id: 'frame-purple-energy', category: 'frame', name: 'Purple Energy', description: 'Пульсирующая фиолетовая энергия',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 45deg,#7c3aed,#c084fc,#7c3aed)', glow: '0 0 18px rgba(168,85,247,.55)', animated: true,
  },
  {
    id: 'frame-stars', category: 'frame', name: 'Stars', description: 'Звёздная пыль по краю кольца',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'linear-gradient(135deg,#1e1b4b,#4338ca,#818cf8)',
  },
  {
    id: 'frame-snow', category: 'frame', name: 'Snow', description: 'Морозный зимний узор',
    rarity: 'rare', unlock: { type: 'season', from: '2025-12-01', to: '2026-01-31' }, obtainLabel: 'Зимнее событие (декабрь–январь)',
    ring: 'linear-gradient(135deg,#e0f2fe,#93c5fd,#e0f2fe)', glow: '0 0 14px rgba(147,197,253,.5)',
  },
  {
    id: 'frame-crystal', category: 'frame', name: 'Crystal', description: 'Гранёное кольцо из кристалла',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'linear-gradient(135deg,#bae6fd,#0ea5e9,#e0f2fe)', glow: '0 0 20px rgba(14,165,233,.5)',
  },
  {
    id: 'frame-cyber-ring', category: 'frame', name: 'Cyber Ring', description: 'Кольцо со схемотехническим узором',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 0deg,#22d3ee,#0f172a,#22d3ee)', glow: '0 0 16px rgba(34,211,238,.5)', animated: true,
  },
  {
    id: 'frame-lightning', category: 'frame', name: 'Lightning', description: 'Электрические разряды по кольцу',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 20deg,#facc15,#fff,#facc15)', glow: '0 0 20px rgba(250,204,21,.6)', animated: true,
  },
  {
    id: 'frame-flowers', category: 'frame', name: 'Flowers', description: 'Нежный цветочный венок',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'linear-gradient(135deg,#fda4af,#fb7185,#fecdd3)',
  },
  {
    id: 'frame-golden', category: 'frame', name: 'Golden', description: 'Массивное золотое кольцо',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'linear-gradient(135deg,#fef3c7,#f59e0b,#b45309)', glow: '0 0 18px rgba(245,158,11,.5)',
  },
  {
    id: 'frame-diamond', category: 'frame', name: 'Diamond', description: 'Бриллиантовое сияние',
    rarity: 'mythic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации · очень редкая',
    ring: 'conic-gradient(from 0deg,#fff,#a5f3fc,#fff,#e0e7ff,#fff)', glow: '0 0 22px rgba(255,255,255,.6)', animated: true,
  },
  {
    id: 'frame-liquid', category: 'frame', name: 'Liquid', description: 'Переливающаяся жидкая рамка в стиле Sky',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    ring: 'conic-gradient(from 0deg,#5b9bd1,#7c9fff,#36e0be,#5b9bd1)', glow: '0 0 20px rgba(91,155,209,.5)', animated: true,
  },
  {
    id: 'frame-premium-ring', category: 'frame', name: 'Premium Ring', description: 'Минималистичное premium-кольцо',
    rarity: 'epic', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    ring: 'linear-gradient(135deg,#fff,#f5a623)',
  },
];

export const FRAME_MAP: Record<string, FrameItem> = Object.fromEntries(FRAME_CATALOG.map(f => [f.id, f]));
