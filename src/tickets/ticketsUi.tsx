/**
 * Мелочи, общие для афиши и кабинета: формат денег и дат, цвет из
 * акцента мероприятия, значок категории.
 *
 * Вынесено отдельно, чтобы афиша и кабинет выглядели одинаково не
 * «потому что скопировали», а потому что берут отсюда.
 */
import {
  Music2, Theater, Trophy, Mic2, PartyPopper, Sparkles,
  Baby, Image as ImageIcon, Film, Ticket,
} from 'lucide-react';

export const fmtMoney = (n: number) => n.toLocaleString('ru-RU') + ' ₽';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

export const fmtTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

export const fmtWhen = (iso?: string | null) => {
  const date = fmtDate(iso);
  const time = fmtTime(iso);
  return time ? `${date} · ${time}` : date;
};

export const fmtStamp = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/**
 * Оттенок из акцента мероприятия.
 *
 * Прежний экран рисовал карточки по числу hue. Акцент с сервера —
 * шестнадцатеричный цвет, поэтому оттенок считаем из него: вид
 * остаётся тот же, а цвет теперь выбирает организатор.
 */
export const hueOf = (accent?: string): number => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(accent ?? ''));
  if (!m) return 225;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 225;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
};

export const bgGrad = (hue: number) =>
  `linear-gradient(135deg, hsl(${hue},55%,14%) 0%, hsl(${(hue + 55) % 360},45%,8%) 100%)`;

/** Цвет остатка мест: тот же светофор, что был. */
export const stockColor = (available: number) =>
  available < 20 ? 'var(--red)' : available < 100 ? 'var(--amber)' : 'var(--green)';

export const CATEGORY_ICON: Record<string, typeof Ticket> = {
  'Концерты': Music2,
  'Театр': Theater,
  'Спорт': Trophy,
  'Стендап': Mic2,
  'Фестивали': PartyPopper,
  'Шоу': Sparkles,
  'Детские': Baby,
  'Выставки': ImageIcon,
  'Кино': Film,
  'Другое': Ticket,
};

export const categoryIcon = (category?: string) => CATEGORY_ICON[category ?? ''] ?? Ticket;

/** Как называется состояние мероприятия на экране. */
export const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  pending: 'На проверке',
  published: 'Опубликовано',
  paused: 'Продажи на паузе',
  completed: 'Завершено',
  cancelled: 'Отменено',
};

export const EVENT_STATUS_COLOR: Record<string, string> = {
  draft: 'var(--t3)',
  pending: 'var(--amber)',
  published: 'var(--green)',
  paused: 'var(--amber)',
  completed: 'var(--t3)',
  cancelled: 'var(--red)',
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  valid: 'Действителен',
  used: 'Использован',
  expired: 'Просрочен',
  cancelled: 'Отменён',
  refunded: 'Возвращён',
};

export const TICKET_STATUS_COLOR: Record<string, string> = {
  valid: 'var(--green)',
  used: 'var(--accent)',
  expired: 'var(--amber)',
  cancelled: 'var(--red)',
  refunded: 'var(--t3)',
};
