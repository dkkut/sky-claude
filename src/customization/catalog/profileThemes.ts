/* ===============================================================
   CATALOG — Темы профиля
   Работают только внутри полного профиля (FullProfilePage): фон
   страницы, карточки блоков, акцент, декоративный мотив.
   Тема «Sky» — дефолт, визуально = текущий стиль (ничего не ломает).
=============================================================== */
import type { CosmeticItem } from '../types';
import type { MotifName } from '../Decorative';

export interface ProfileThemeItem extends CosmeticItem {
  category:       'profileTheme';
  pageBackground: string;
  cardBackground: string;
  cardBorder:     string;
  accent:         string;
  motif:          MotifName;
  motifOpacity?:  number;
}

export const PROFILE_THEME_CATALOG: ProfileThemeItem[] = [
  {
    id: 'theme-sky', category: 'profileTheme', name: 'Sky', description: 'Фирменный стиль Sky по умолчанию',
    rarity: 'common', unlock: { type: 'default' }, obtainLabel: 'Доступна всем',
    pageBackground: 'var(--bg)', cardBackground: 'var(--bg-l1)', cardBorder: 'var(--border)', accent: 'var(--accent)',
    motif: 'constellations', motifOpacity: 0,
  },
  {
    id: 'theme-galaxy', category: 'profileTheme', name: 'Galaxy', description: 'Туманности и звёздная пыль вокруг блоков профиля',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'radial-gradient(ellipse at 20% -10%,#3b1364 0%,#0d0524 45%,#050310 100%)',
    cardBackground: 'rgba(30,15,60,0.55)', cardBorder: 'rgba(192,132,252,0.18)', accent: '#c084fc',
    motif: 'constellations', motifOpacity: 0.5,
  },
  {
    id: 'theme-aurora', category: 'profileTheme', name: 'Aurora', description: 'Северное сияние переливается по фону',
    rarity: 'epic', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    pageBackground: 'linear-gradient(180deg,#04151a,#082630,#04151a)',
    cardBackground: 'rgba(10,40,45,0.55)', cardBorder: 'rgba(54,224,190,0.18)', accent: '#36e0be',
    motif: 'aurora', motifOpacity: 0.4,
  },
  {
    id: 'theme-cloud', category: 'profileTheme', name: 'Cloud', description: 'Мягкие облака на светлом небе',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(180deg,#1c2b45,#2b3d5c,#1c2b45)',
    cardBackground: 'rgba(255,255,255,0.06)', cardBorder: 'rgba(255,255,255,0.12)', accent: '#a7c5ff',
    motif: 'cloud', motifOpacity: 0.5,
  },
  {
    id: 'theme-cyber', category: 'profileTheme', name: 'Cyber', description: 'Цифровые дорожки и неоновые узлы',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#050d12,#0a1e28,#050d12)',
    cardBackground: 'rgba(10,30,40,0.55)', cardBorder: 'rgba(34,211,238,0.2)', accent: '#22d3ee',
    motif: 'neonCircuits', motifOpacity: 0.4,
  },
  {
    id: 'theme-crystal', category: 'profileTheme', name: 'Crystal', description: 'Гранёные кристальные блики',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#08161f,#0f2536,#08161f)',
    cardBackground: 'rgba(15,40,55,0.5)', cardBorder: 'rgba(186,230,253,0.2)', accent: '#bae6fd',
    motif: 'crystal', motifOpacity: 0.45,
  },
  {
    id: 'theme-dark-glass', category: 'profileTheme', name: 'Dark Glass', description: 'Тёмное стекло с холодными бликами',
    rarity: 'rare', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    pageBackground: 'linear-gradient(160deg,#0a0a0f,#131320,#0a0a0f)',
    cardBackground: 'rgba(255,255,255,0.04)', cardBorder: 'rgba(255,255,255,0.1)', accent: '#7c9fff',
    motif: 'glass', motifOpacity: 0.4,
  },
  {
    id: 'theme-anime', category: 'profileTheme', name: 'Anime', description: 'Яркие вспышки и линии скорости',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#1a0e2e,#2d123f,#1a0e2e)',
    cardBackground: 'rgba(40,15,55,0.5)', cardBorder: 'rgba(244,114,182,0.2)', accent: '#f472b6',
    motif: 'anime', motifOpacity: 0.4,
  },
  {
    id: 'theme-forest', category: 'profileTheme', name: 'Forest', description: 'Листья и частицы света сквозь ветви',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#0a1810,#122a1a,#0a1810)',
    cardBackground: 'rgba(15,35,22,0.55)', cardBorder: 'rgba(52,211,153,0.18)', accent: '#34d399',
    motif: 'forest', motifOpacity: 0.45,
  },
  {
    id: 'theme-minimal', category: 'profileTheme', name: 'Minimal', description: 'Почти без декора — только чистые линии',
    rarity: 'common', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: '#101014', cardBackground: '#17171c', cardBorder: 'rgba(255,255,255,0.06)', accent: '#e5e7eb',
    motif: 'constellations', motifOpacity: 0.06,
  },
  {
    id: 'theme-ocean', category: 'profileTheme', name: 'Ocean', description: 'Тихая толща воды и пузырьки',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#021420,#03293c,#021420)',
    cardBackground: 'rgba(5,35,50,0.55)', cardBorder: 'rgba(56,189,248,0.18)', accent: '#38bdf8',
    motif: 'ocean', motifOpacity: 0.4,
  },
  {
    id: 'theme-royal', category: 'profileTheme', name: 'Royal', description: 'Золотые орнаменты на глубоком бордовом',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#170a10,#2b0f1a,#170a10)',
    cardBackground: 'rgba(40,15,25,0.55)', cardBorder: 'rgba(245,197,110,0.2)', accent: '#f5c56e',
    motif: 'royal', motifOpacity: 0.5,
  },
  {
    id: 'theme-night', category: 'profileTheme', name: 'Night', description: 'Тихая ночь с редкими звёздами',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(180deg,#05050a,#0c0c16,#05050a)',
    cardBackground: 'rgba(15,15,25,0.6)', cardBorder: 'rgba(129,140,248,0.14)', accent: '#818cf8',
    motif: 'constellations', motifOpacity: 0.3,
  },
  {
    id: 'theme-retro', category: 'profileTheme', name: 'Retro', description: 'Ретро-сетка и вейпорвейв-солнце',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#170a2b,#341050,#170a2b)',
    cardBackground: 'rgba(40,15,60,0.5)', cardBorder: 'rgba(103,232,249,0.2)', accent: '#f472b6',
    motif: 'vapor', motifOpacity: 0.5,
  },
  {
    id: 'theme-neon', category: 'profileTheme', name: 'Neon', description: 'Контрастные неоновые контуры',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    pageBackground: 'linear-gradient(160deg,#0d0016,#1c0026,#0d0016)',
    cardBackground: 'rgba(25,0,35,0.55)', cardBorder: 'rgba(0,240,255,0.2)', accent: '#00f0ff',
    motif: 'neonCircuits', motifOpacity: 0.45,
  },
];

export const PROFILE_THEME_MAP: Record<string, ProfileThemeItem> = Object.fromEntries(PROFILE_THEME_CATALOG.map(t => [t.id, t]));
