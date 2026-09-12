/**
 * Значок бота.
 *
 * Раньше аватаром бота была эмодзи, выбранная из списка и записанная в
 * данные. Из-за этого один и тот же бот выглядел по-разному на
 * телефоне, компьютере и телевизоре — эмодзи рисует шрифт устройства, —
 * а подогнать её цвет под тему было нельзя.
 *
 * Теперь в данных лежит вид значка — короткое слово, — а картинку к
 * нему подбирает эта таблица. Неизвестное слово получает нейтральный
 * значок, а не пустое место: так переживут записи, сделанные до
 * перехода.
 */
import {
  Bot, Zap, Sparkles, Cloud, Newspaper, Calculator,
  ShoppingCart, Shield, Rocket, Brain, Globe, Gamepad2,
} from 'lucide-react';
import type { IconComponent } from '@/shared/icon';

const MAP: Record<string, IconComponent> = {
  bot:        Bot,
  zap:        Zap,
  sparkles:   Sparkles,
  cloud:      Cloud,
  newspaper:  Newspaper,
  calculator: Calculator,
  cart:       ShoppingCart,
  shield:     Shield,
  rocket:     Rocket,
  brain:      Brain,
  globe:      Globe,
  gamepad:    Gamepad2,
};

/** Что предлагаем выбрать при создании бота. Порядок — как на экране. */
export const BOT_ICONS = Object.keys(MAP);

export const botIcon = (kind?: string): IconComponent => MAP[kind ?? ''] ?? Bot;

export const BotIcon = ({ kind, size = 20, color }:
{ kind?: string; size?: number; color?: string }) => {
  const Icon = botIcon(kind);
  return <Icon size={size} style={{ color: color ?? 'var(--t2)' }}/>;
};
