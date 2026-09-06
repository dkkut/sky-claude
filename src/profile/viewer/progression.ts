/* ===============================================================
   PROFILE PROGRESSION
   «Уровень», «опыт» и достижения — не выдуманные цифры, а честная
   функция от реальных, уже хранимых в приложении данных: постов,
   полученных реакций, подарков, стажа на платформе и т.д.
   Формула прозрачна и детерминирована — при желании её можно
   вывести пользователю целиком (см. StatsSection).
=============================================================== */
import { useMemo } from 'react';
import {
  Trophy, Sparkles, Users, Gift as GiftIcon, MessagesSquare,
  Crown, ShieldCheck, Briefcase, CalendarClock, Flame,
} from 'lucide-react';
import { useBloomStore } from '@/bloom/store';
import { useGiftStore } from '@/gifts/store';
import { useSocialGraph } from './social';
import type { Account } from '@/core/auth/store';
import type { IconProps } from './types';
import type { ComponentType } from 'react';

export interface Achievement {
  key:         string;
  label:       string;
  description: string;
  icon:        ComponentType<IconProps>;
  tone:        string; // css-цвет акцента значка
}

export interface LevelInfo {
  level:      number;
  xp:         number;
  xpIntoLvl:  number;
  xpForNext:  number;
  progress:   number; // 0..1
}

export const tenureDays = (createdAt: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));

export function computeLevel(xp: number): LevelInfo {
  // Level N требует 40*(N-1)^2 очков — простая монотонная кривая.
  let level = 1;
  while (xp >= 40 * level * level) level++;
  const base = 40 * (level - 1) * (level - 1);
  const next = 40 * level * level;
  return {
    level, xp,
    xpIntoLvl: xp - base,
    xpForNext: next - base,
    progress: Math.min(1, (xp - base) / Math.max(1, next - base)),
  };
}

interface ProgressionResult {
  level:        LevelInfo;
  achievements: Achievement[];
  postsCount:      number;
  reactionsReceived: number;
  giftsReceived:   number;
  giftsSent:       number;
  friendsCount:    number;
  tenure:          number;
}

/** Собирает реальную статистику пользователя и считает по ней уровень + достижения. */
export function useProgression(userId: string, account: Account | undefined): ProgressionResult {
  const posts       = useBloomStore(s => s.posts);
  const sent        = useGiftStore(s => s.sent);
  const friendEdges = useSocialGraph(s => s.friends); // подписываемся на «сырые» данные, а не на функцию-геттер

  return useMemo(() => {
    const myPosts = posts.filter(p => p.authorId === userId);
    const reactionsReceived = myPosts.reduce(
      (sum, p) => sum + p.reactions.reduce((s2, r) => s2 + r.userIds.length, 0), 0,
    );
    const giftsReceived = sent.filter(g => g.toId === userId).length;
    const giftsSent     = sent.filter(g => g.fromId === userId).length;
    const friendsCount  = friendEdges.filter(e => e.status === 'accepted' && (e.aId === userId || e.bId === userId)).length;
    const tenure = account ? tenureDays(account.createdAt) : 0;

    const xp = Math.round(
      myPosts.length * 8 +
      reactionsReceived * 1 +
      giftsReceived * 12 +
      giftsSent * 6 +
      friendsCount * 5 +
      tenure * 0.5,
    );

    const achievements: Achievement[] = [];
    if (tenure >= 365) achievements.push({ key: 'veteran', label: 'Ветеран Sky', description: 'На платформе больше года', icon: CalendarClock, tone: '#a78bfa' });
    else if (tenure >= 30) achievements.push({ key: 'settled', label: 'Старожил', description: 'На платформе больше месяца', icon: CalendarClock, tone: '#8b93a8' });

    if (myPosts.length >= 1)  achievements.push({ key: 'first_post', label: 'Первая публикация', description: 'Опубликовал первый пост в Sky Bloom', icon: Sparkles, tone: '#36e0be' });
    if (myPosts.length >= 10) achievements.push({ key: 'author', label: 'Автор', description: '10+ публикаций в Sky Bloom', icon: Sparkles, tone: '#36e0be' });

    if (reactionsReceived >= 50) achievements.push({ key: 'crowd_favorite', label: 'Любимец публики', description: '50+ реакций на публикациях', icon: Flame, tone: '#fb923c' });

    if (giftsReceived >= 1) achievements.push({ key: 'collector', label: 'Коллекционер', description: 'Получил подарок от других пользователей', icon: GiftIcon, tone: '#f472b6' });
    if (giftsReceived >= 10) achievements.push({ key: 'star', label: 'Звезда Sky', description: '10+ подарков в коллекции', icon: Trophy, tone: '#facc15' });

    if (giftsSent >= 5) achievements.push({ key: 'patron', label: 'Меценат', description: 'Подарил 5+ подарков другим', icon: GiftIcon, tone: '#f472b6' });

    if (friendsCount >= 5)  achievements.push({ key: 'social', label: 'Душа компании', description: '5+ друзей на платформе', icon: Users, tone: '#6e8eff' });
    if (friendsCount >= 20) achievements.push({ key: 'hub', label: 'Центр притяжения', description: '20+ друзей на платформе', icon: Users, tone: '#6e8eff' });

    if (account?.isPrime)         achievements.push({ key: 'prime', label: 'Sky Prime', description: 'Активная подписка Prime', icon: Crown, tone: '#facc15' });
    if (account?.isPrimeBusiness) achievements.push({ key: 'business', label: 'Sky Business', description: 'Бизнес-аккаунт Sky', icon: Briefcase, tone: '#60a5fa' });
    if (account?.isAdmin)         achievements.push({ key: 'admin', label: 'Команда Sky', description: 'Администратор платформы', icon: ShieldCheck, tone: '#f87171' });

    if (myPosts.length + giftsSent + giftsReceived >= 25) achievements.push({ key: 'active', label: 'Активный участник', description: 'Заметная активность на платформе', icon: MessagesSquare, tone: '#36e0be' });

    return {
      level: computeLevel(xp),
      achievements,
      postsCount: myPosts.length,
      reactionsReceived,
      giftsReceived,
      giftsSent,
      friendsCount,
      tenure,
    };
  }, [posts, sent, friendEdges, userId, account]);
}
