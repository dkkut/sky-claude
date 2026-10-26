import { BookImage, Flower2, MessageCircleMore, Sparkles, UserRound, Bell, Gamepad2, Library, Briefcase, Building2 } from 'lucide-react';
import type { ModuleKey } from '@/data/state/modules';
export interface NavItem { key: ModuleKey; label: string; icon: typeof MessageCircleMore; }
export const navigation: NavItem[] = [
  { key:'stories',       label:'Истории',       icon:BookImage },
  { key:'messages',      label:'Чаты',          icon:MessageCircleMore },
  { key:'notifications', label:'Уведомления',   icon:Bell },
  { key:'bloom',         label:'Bloom',         icon:Flower2 },
  { key:'gaming',        label:'Gaming',        icon:Gamepad2 },
  { key:'extras',        label:'Медиа',         icon:Sparkles },
  { key:'library',       label:'Библиотека',    icon:Library },
  { key:'studio',        label:'Studio',        icon:Briefcase },
  { key:'business',      label:'Сервисы для бизнеса', icon:Building2 },
  { key:'profile',       label:'Профиль',       icon:UserRound },
];
