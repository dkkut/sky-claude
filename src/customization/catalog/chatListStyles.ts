/* ===============================================================
   CATALOG — Оформление строки в списке чатов
   Применяется к строке ВЛАДЕЛЬЦА стиля везде, где её видят другие —
   в списке чатов собеседника (см. messenger/ChatList.tsx).
=============================================================== */
import type { CosmeticItem } from '../types';

export interface ChatListStyleItem extends CosmeticItem {
  category:     'chatListStyle';
  border?:      string;
  glow?:        string;
  leftBar?:     string;      // цвет полоски слева
  background?:  string;      // лёгкая подложка строки
  badge?:       string;      // короткая подпись-бейдж («Premium»)
  animated?:    boolean;
}

export const CHAT_LIST_STYLE_CATALOG: ChatListStyleItem[] = [
  {
    id: 'cls-default', category: 'chatListStyle', name: 'Без оформления', description: 'Обычная строка чата',
    rarity: 'common', unlock: { type: 'default' }, obtainLabel: 'Доступно всем',
  },
  {
    id: 'cls-glow-frame', category: 'chatListStyle', name: 'Светящаяся рамка', description: 'Мягкое свечение по контуру строки',
    rarity: 'epic', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    border: '1px solid rgba(124,159,255,0.35)', glow: 'inset 0 0 16px rgba(124,159,255,0.12)',
  },
  {
    id: 'cls-neon-strip', category: 'chatListStyle', name: 'Неоновая полоска', description: 'Яркая неоновая полоска слева',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    leftBar: 'linear-gradient(180deg,#00f0ff,#ff00e5)', animated: true,
  },
  {
    id: 'cls-animated-gradient', category: 'chatListStyle', name: 'Анимированный градиент', description: 'Плавно переливающийся фон строки',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'linear-gradient(120deg,rgba(124,159,255,0.1),rgba(192,132,252,0.1),rgba(54,224,190,0.1))', animated: true,
  },
  {
    id: 'cls-glass-card', category: 'chatListStyle', name: 'Стеклянная карточка', description: 'Строка приподнята стеклянной подложкой',
    rarity: 'rare', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  },
  {
    id: 'cls-iridescent', category: 'chatListStyle', name: 'Переливающийся контур', description: 'Перламутровый градиентный контур',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    border: '1px solid transparent', leftBar: 'linear-gradient(180deg,#f472b6,#a78bfa,#38bdf8,#34d399)', animated: true,
  },
  {
    id: 'cls-cosmic-glow', category: 'chatListStyle', name: 'Космическое свечение', description: 'Глубокое сине-фиолетовое сияние',
    rarity: 'epic', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    glow: 'inset 0 0 20px rgba(124,58,237,0.18)', background: 'rgba(88,28,135,0.08)',
  },
  {
    id: 'cls-gold-frame', category: 'chatListStyle', name: 'Золотая рамка', description: 'Статусная золотая окантовка',
    rarity: 'legendary', unlock: { type: 'owned' }, obtainLabel: 'Маркет кастомизации',
    border: '1px solid rgba(245,197,110,0.45)', glow: 'inset 0 0 14px rgba(245,197,110,0.15)',
  },
  {
    id: 'cls-minimal-label', category: 'chatListStyle', name: 'Минималистичная метка', description: 'Скромная подпись «Premium», без эффектов',
    rarity: 'rare', unlock: { type: 'prime' }, obtainLabel: 'Sky Prime',
    badge: 'Premium',
  },
];

export const CHAT_LIST_STYLE_MAP: Record<string, ChatListStyleItem> = Object.fromEntries(CHAT_LIST_STYLE_CATALOG.map(s => [s.id, s]));
