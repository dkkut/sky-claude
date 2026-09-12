/**
 * Значок по виду семейного события.
 *
 * В ленте и в достижениях раньше лежала эмодзи — прямо в сохранённых
 * данных. Из-за этого одно и то же событие выглядело по-разному на
 * телефоне, на компьютере и на телевизоре: эмодзи рисует шрифт
 * устройства, и ни цвет, ни толщину линии подогнать под интерфейс
 * нельзя. Хуже того, картинка оказывалась записанной в историю
 * навсегда: поменять её потом можно было только правкой сохранённых
 * записей.
 *
 * Теперь хранится вид события — короткое слово, — а картинку к нему
 * подбирает эта таблица. Старые записи с эмодзи тоже переживут: вид, о
 * котором мы не знаем, получает нейтральный значок, а не пустое место.
 */
import {
  Home, UserPlus, Baby, Wallet, Send, Target, Gift, PartyPopper,
  Bell, Check, X, Crown, CalendarDays, Siren, Lock, Unlock, LogOut,
  Banknote, ShieldCheck, Plane, Trophy, Gem, Zap, Dot, Cake, Receipt, Target as Goal,
  Umbrella, Gamepad2, Car, Laptop, Guitar, Smartphone, Bike, GraduationCap,
  Hourglass,
} from 'lucide-react';

const MAP: Record<string, typeof Home> = {
  home: Home,
  join: UserPlus,
  child: Baby,
  topup: Wallet,
  transfer: Send,
  goal: Target,
  goalAdd: Gift,
  done: PartyPopper,
  request: Bell,
  approve: Check,
  reject: X,
  prime: Crown,
  calendar: CalendarDays,
  sos: Siren,
  lock: Lock,
  unlock: Unlock,
  logout: LogOut,
  money: Banknote,
  safe: ShieldCheck,
  trip: Plane,
  trophy: Trophy,
  target: Target,
  gem: Gem,
  gift: Gift,
  zap: Zap,
  birthday: Cake,
  bill: Receipt,
  goalGive: Goal,
  capsule: Hourglass,
  // Виды семейных целей — их человек выбирает сам при создании.
  beach: Umbrella,
  game: Gamepad2,
  car: Car,
  house: Home,
  laptop: Laptop,
  guitar: Guitar,
  phone: Smartphone,
  bike: Bike,
  study: GraduationCap,
};

/** Что предлагаем выбрать для новой семейной цели. */
export const GOAL_KINDS = ['beach','game','car','house','laptop','trip','guitar','phone','bike','study'];

export const familyIcon = (kind: string) => MAP[kind] ?? Dot;

export const FamilyIcon = ({ kind, size = 16, color = 'var(--t2)' }:
{ kind: string; size?: number; color?: string }) => {
  const Icon = familyIcon(kind);
  return <Icon size={size} style={{ color }}/>;
};
