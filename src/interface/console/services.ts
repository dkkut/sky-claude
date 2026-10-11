/* Реестр сервисов Sky Console: какой существующий модуль Sky открывается за каждой карточкой. */
import { Film, Music2, Mic2, Play, Gamepad2, Boxes, Phone, MessageCircle, Sparkles, Crown, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useModuleStore } from '@/data/state/modules';
import { useConsoleStore, type ServiceKey } from './consoleStore';

export type Group = 'games' | 'media' | 'social';

export interface ServiceDef {
  key: ServiceKey;
  label: string;
  desc: string;
  group: Group;
  icon: LucideIcon;
  /** Основной цвет сервиса: фон главного меню меняется под выбранную карточку. */
  color: string;
  action: string;
  /** Раздел Extras (если сервис живёт внутри него). */
  extras?: string;
  module?: 'gaming' | 'video' | 'messages' | 'notifications';
}

export const SERVICES: ServiceDef[] = [
  { key: 'film', label: 'Sky Film', desc: 'Фильмы и сериалы. Продолжайте с того места, где остановились.', group: 'media', icon: Film, color: '#f43f5e', action: 'Смотреть', extras: 'movies' },
  { key: 'music', label: 'Sky Music', desc: 'Ваша музыка, избранное и плейлисты.', group: 'media', icon: Music2, color: '#6366f1', action: 'Слушать', extras: 'music' },
  { key: 'video', label: 'SkyVideo', desc: 'Каналы и видео сообщества.', group: 'media', icon: Play, color: '#ef4444', action: 'Смотреть', module: 'video' },
  { key: 'podcasts', label: 'Sky Podcasts', desc: 'Подкасты и выпуски — слушайте или смотрите.', group: 'media', icon: Mic2, color: '#10b981', action: 'Слушать', extras: 'podcasts' },
  { key: 'games', label: 'Sky Games', desc: 'Каталог игр, достижения и серверы.', group: 'games', icon: Gamepad2, color: '#8b5cf6', action: 'Играть', module: 'gaming' },
  { key: 'blox', label: 'Sky Blox', desc: 'Игры сообщества, магазин и достижения.', group: 'games', icon: Boxes, color: '#22d3ee', action: 'Играть', extras: 'blox' },
  { key: 'prime', label: 'Sky Prime', desc: 'Подписка, баллы и подарки.', group: 'media', icon: Crown, color: '#f59e0b', action: 'Открыть', extras: 'prime' },
  { key: 'market', label: 'Sky Market', desc: 'Покупки, заказы и доставка.', group: 'social', icon: ShoppingBag, color: '#fb7185', action: 'Открыть', extras: 'market' },
  { key: 'calls', label: 'Sky Calls', desc: 'Голосовые и видеозвонки с друзьями.', group: 'social', icon: Phone, color: '#34d399', action: 'Открыть' },
  { key: 'messenger', label: 'Messenger', desc: 'Чаты, группы и каналы.', group: 'social', icon: MessageCircle, color: '#4f6ef7', action: 'Открыть', module: 'messages' },
  { key: 'ai', label: 'Sky AI', desc: 'Помощник: вопросы, команды и голос.', group: 'social', icon: Sparkles, color: '#a78bfa', action: 'Открыть', extras: 'ai' },
];

export const serviceByKey = (k: ServiceKey) => SERVICES.find((s) => s.key === k);

/** Открывает существующий модуль нужным разделом и показывает его в оболочке. */
export const openService = (key: ServiceKey, opts?: { itemId?: string }) => {
  const def = serviceByKey(key);
  const m = useModuleStore.getState();
  if (def?.extras) { m.setActiveModule('extras'); m.setPendingExtrasTab(def.extras); m.setPendingExtrasItemId(opts?.itemId ?? null); }
  else if (def?.module) m.setActiveModule(def.module);
  else if (key === 'notifications') m.setActiveModule('notifications');
  useConsoleStore.getState().open(key);
};
