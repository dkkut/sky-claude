/* ===============================================================
   CATALOG — Баннеры верхней панели чата
   Тема принадлежит владельцу Premium-аккаунта: когда кто-то открывает
   переписку с ним, в шапке отображается ИМЕННО его выбранная тема
   (см. profile/viewer/cosmetics.ts::activeBanner + messenger/ChatWindow.tsx).
=============================================================== */
import type { CosmeticItem } from '../types';
import type { MotifName } from '../Decorative';

export interface BannerItem extends CosmeticItem {
  category:  'banner';
  background: string;   // фон капсулы шапки
  accent:    string;    // цвет кнопок/иконок/разделителей
  accent2?:  string;    // вторичный цвет мотива
  motif:     MotifName;
  motifOpacity?: number;
}

export const BANNER_CATALOG: BannerItem[] = [
  {
    id: 'banner-default', category: 'banner', name: 'Sky по умолчанию', description: 'Стандартное оформление шапки чата',
    rarity: 'common', unlock: { type: 'default' }, obtainLabel: 'Доступна всем',
    background: 'rgba(20,20,26,0.55)', accent: 'rgba(255,255,255,0.12)', motif: 'constellations', motifOpacity: 0,
  },
  {
    id: 'banner-aurora', category: 'banner', name: 'Aurora', description: 'Северное сияние переливается над перепиской',
    rarity: 'epic', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    background: 'linear-gradient(120deg,#0b1f2b,#123a3f,#0b1f2b)', accent: 'rgba(54,224,190,0.22)', accent2: '#7c9fff',
    motif: 'aurora', motifOpacity: 0.5,
  },
  {
    id: 'banner-liquid-glass', category: 'banner', name: 'Liquid Glass', description: 'Фирменное жидкое стекло Sky',
    rarity: 'rare', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    background: 'linear-gradient(135deg,rgba(91,155,209,0.25),rgba(124,159,255,0.12))', accent: 'rgba(255,255,255,0.18)',
    motif: 'glass', motifOpacity: 0.5,
  },
  {
    id: 'banner-neon', category: 'banner', name: 'Neon', description: 'Электрические неоновые контуры',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(120deg,#150a24,#1e0b30,#0d0518)', accent: 'rgba(0,240,255,0.25)', accent2: '#ff00e5',
    motif: 'neonCircuits', motifOpacity: 0.55,
  },
  {
    id: 'banner-space', category: 'banner', name: 'Space', description: 'Тихая пустота космоса за спиной',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(160deg,#04050f,#0a0d1c,#04050f)', accent: 'rgba(129,140,248,0.22)',
    motif: 'constellations', motifOpacity: 0.5,
  },
  {
    id: 'banner-galaxy', category: 'banner', name: 'Galaxy', description: 'Туманности и звёздная пыль',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#1a0b3d,#3b1364,#0d0524)', accent: 'rgba(192,132,252,0.25)', accent2: '#f0abfc',
    motif: 'constellations', motifOpacity: 0.65,
  },
  {
    id: 'banner-sunset', category: 'banner', name: 'Sunset', description: 'Тёплые закатные оттенки',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(120deg,#3b1d2b,#7a3b2e,#c2703d)', accent: 'rgba(255,210,150,0.25)', accent2: '#ffd28f',
    motif: 'sunset', motifOpacity: 0.55,
  },
  {
    id: 'banner-sakura', category: 'banner', name: 'Sakura', description: 'Лепестки сакуры на ветру',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(120deg,#2a1620,#4a2233,#2a1620)', accent: 'rgba(251,164,181,0.25)', accent2: '#fecdd3',
    motif: 'sakura', motifOpacity: 0.55,
  },
  {
    id: 'banner-cyber', category: 'banner', name: 'Cyber', description: 'Цифровые дорожки и шестигранники',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#06131a,#0a2233,#06131a)', accent: 'rgba(34,211,238,0.25)', accent2: '#22d3ee',
    motif: 'neonCircuits', motifOpacity: 0.5,
  },
  {
    id: 'banner-crystal', category: 'banner', name: 'Crystal', description: 'Грани кристалла ловят свет',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#0b1e2b,#123044,#0b1e2b)', accent: 'rgba(186,230,253,0.25)', accent2: '#bae6fd',
    motif: 'crystal', motifOpacity: 0.55,
  },
  {
    id: 'banner-ocean', category: 'banner', name: 'Ocean', description: 'Тихие волны и пузырьки в глубине',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#031824,#053347,#031824)', accent: 'rgba(56,189,248,0.22)', accent2: '#38bdf8',
    motif: 'ocean', motifOpacity: 0.5,
  },
  {
    id: 'banner-winter', category: 'banner', name: 'Winter', description: 'Морозный узор на стекле',
    rarity: 'rare', unlock: { type: 'season', from: '2025-12-01', to: '2026-01-31' }, obtainLabel: 'Зимнее событие',
    background: 'linear-gradient(135deg,#0c1d2b,#16324a,#0c1d2b)', accent: 'rgba(224,242,254,0.25)', accent2: '#e0f2fe',
    motif: 'winter', motifOpacity: 0.5,
  },
  {
    id: 'banner-fire', category: 'banner', name: 'Fire', description: 'Языки пламени у нижнего края',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#1f0a08,#3d130d,#1f0a08)', accent: 'rgba(251,146,60,0.25)', accent2: '#fde68a',
    motif: 'fire', motifOpacity: 0.55,
  },
  {
    id: 'banner-vaporwave', category: 'banner', name: 'Vaporwave', description: 'Ретро-сетка и закатное солнце',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(135deg,#1a0b2e,#3d1a54,#1a0b2e)', accent: 'rgba(244,114,182,0.25)', accent2: '#67e8f9',
    motif: 'vapor', motifOpacity: 0.6,
  },
];

export const BANNER_MAP: Record<string, BannerItem> = Object.fromEntries(BANNER_CATALOG.map(b => [b.id, b]));
