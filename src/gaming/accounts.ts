/* ===============================================================
   GAMING ACCOUNTS  -  привязка игровых аккаунтов
   Steam, Epic, PlayStation, Xbox, VK Play и другие
=============================================================== */
import { create } from 'zustand';

export type GamingPlatform =
  | 'steam' | 'epic' | 'psn' | 'xbox' | 'vkplay'
  | 'battlenet' | 'gog' | 'riot' | 'custom';

export interface GamingAccount {
  platform:    GamingPlatform;
  username:    string;         // никнейм на платформе
  profileUrl?: string;         // ссылка на профиль
  verified:    boolean;        // подтверждён (демо = всегда true)
  linkedAt:    string;         // ISO
}

export interface GameActivity {
  userId:        string;
  gameName:      string;
  gameIcon?:     string;        // emoji или URL
  platform:      GamingPlatform;
  startedAt:     number;        // timestamp
  lastUpdated:   number;
  isPlaying:     boolean;
  sessionMinutes:number;        // минут в текущей сессии
  totalHours:    number;        // всего часов
}

export const PLATFORMS: Record<GamingPlatform, {
  name:    string;
  icon:    string;
  color:   string;
  placeholder: string;
  urlPrefix:   string;
}> = {
  steam:     { name:'Steam',          icon:'🎮', color:'#1b2838', placeholder:'steamcommunity.com/id/...', urlPrefix:'https://steamcommunity.com/id/' },
  epic:      { name:'Epic Games',     icon:'⚡', color:'#2d2d2d', placeholder:'Ваш никнейм Epic',         urlPrefix:'https://store.epicgames.com/u/' },
  psn:       { name:'PlayStation',    icon:'🎮', color:'#003791', placeholder:'PSN ID',                   urlPrefix:'https://psnprofiles.com/' },
  xbox:      { name:'Xbox',           icon:'🟢', color:'#107c10', placeholder:'Gamertag',                  urlPrefix:'https://account.xbox.com/en-us/profile?gamertag=' },
  vkplay:    { name:'VK Play',        icon:'🔷', color:'#0077ff', placeholder:'Никнейм VK Play',           urlPrefix:'https://vkplay.ru/app/user/' },
  battlenet: { name:'Battle.net',     icon:'⚔️', color:'#148EFF', placeholder:'BattleTag#1234',            urlPrefix:'https://overwatch.blizzard.com/en-us/career/' },
  gog:       { name:'GOG',            icon:'🌌', color:'#86328a', placeholder:'Имя пользователя GOG',      urlPrefix:'https://www.gog.com/u/' },
  riot:      { name:'Riot Games',     icon:'⚔️', color:'#d13639', placeholder:'НИКА#TAG',                  urlPrefix:'https://tracker.gg/valorant/profile/riot/' },
  custom:    { name:'Другая',         icon:'🎯', color:'#4f6ef7', placeholder:'Никнейм / ссылка',          urlPrefix:'' },
};

/* -- Popular games for activity simulation --------------- */
export const POPULAR_GAMES: { name:string; icon:string; platform:GamingPlatform }[] = [
  { name:'Counter-Strike 2',    icon:'🔫', platform:'steam'     },
  { name:'Dota 2',              icon:'🏆', platform:'steam'     },
  { name:'Cyberpunk 2077',      icon:'🌆', platform:'steam'     },
  { name:'Elden Ring',          icon:'⚔️', platform:'steam'     },
  { name:'GTA V',               icon:'🚗', platform:'steam'     },
  { name:'Fortnite',            icon:'🎯', platform:'epic'      },
  { name:'Rocket League',       icon:'🚀', platform:'epic'      },
  { name:'Valorant',            icon:'🎯', platform:'riot'      },
  { name:'League of Legends',   icon:'⚔️', platform:'riot'      },
  { name:'Overwatch 2',         icon:'🦸', platform:'battlenet' },
  { name:'Minecraft',           icon:'⛏️', platform:'custom'    },
  { name:'Apex Legends',        icon:'🔥', platform:'epic'      },
];

/* -- Storage ----------------------------------------------- */
const ACC_KEY = 'sky:gaming-accounts:v1';
const ACT_KEY = 'sky:gaming-activity:v1';
const W = typeof window !== 'undefined';

const loadAccounts = (): Record<string, GamingAccount[]> => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(ACC_KEY) || '{}'); } catch { return {}; }
};
const saveAccounts = (d: Record<string, GamingAccount[]>) => {
  if (!W) return;
  try { localStorage.setItem(ACC_KEY, JSON.stringify(d)); } catch {}
};
const loadActivity = (): Record<string, GameActivity> => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(ACT_KEY) || '{}'); } catch { return {}; }
};
const saveActivity = (d: Record<string, GameActivity>) => {
  if (!W) return;
  try { localStorage.setItem(ACT_KEY, JSON.stringify(d)); } catch {}
};

interface GamingState {
  accounts:  Record<string, GamingAccount[]>;  // userId → accounts
  activity:  Record<string, GameActivity>;      // userId → current activity

  getAccounts: (userId: string) => GamingAccount[];
  addAccount:  (userId: string, acc: Omit<GamingAccount,'linkedAt'|'verified'>) => void;
  removeAccount:(userId: string, platform: GamingPlatform) => void;

  getActivity: (userId: string) => GameActivity | null;
  setPlaying:  (userId: string, game: string, icon: string, platform: GamingPlatform) => void;
  stopPlaying: (userId: string) => void;
  isPlaying:   (userId: string) => boolean;
}

export const useGamingAccounts = create<GamingState>((set, get) => ({
  accounts: loadAccounts(),
  activity: loadActivity(),

  getAccounts: (userId) => get().accounts[userId] ?? [],

  addAccount: (userId, acc) => {
    const next = {
      ...get().accounts,
      [userId]: [
        ...(get().accounts[userId] ?? []).filter(a => a.platform !== acc.platform),
        { ...acc, verified: true, linkedAt: new Date().toISOString() },
      ],
    };
    saveAccounts(next);
    set({ accounts: next });
  },

  removeAccount: (userId, platform) => {
    const next = {
      ...get().accounts,
      [userId]: (get().accounts[userId] ?? []).filter(a => a.platform !== platform),
    };
    saveAccounts(next);
    set({ accounts: next });
  },

  getActivity: (userId) => get().activity[userId] ?? null,

  setPlaying: (userId, game, icon, platform) => {
    const prev = get().activity[userId];
    const now  = Date.now();
    const entry: GameActivity = {
      userId, gameName: game, gameIcon: icon, platform,
      startedAt:     prev?.startedAt ?? now,
      lastUpdated:   now,
      isPlaying:     true,
      sessionMinutes:prev ? Math.floor((now - prev.startedAt) / 60000) : 0,
      totalHours:    prev?.totalHours ?? Math.floor(Math.random() * 500 + 10),
    };
    const next = { ...get().activity, [userId]: entry };
    saveActivity(next);
    set({ activity: next });
  },

  stopPlaying: (userId) => {
    const prev = get().activity[userId];
    if (!prev) return;
    const entry: GameActivity = {
      ...prev, isPlaying: false,
      lastUpdated:   Date.now(),
      sessionMinutes: Math.floor((Date.now() - prev.startedAt) / 60000),
      totalHours:    prev.totalHours + Math.floor((Date.now() - prev.startedAt) / 3600000),
    };
    const next = { ...get().activity, [userId]: entry };
    saveActivity(next);
    set({ activity: next });
  },

  isPlaying: (userId) => get().activity[userId]?.isPlaying ?? false,
}));

/* -- Helper formatters -------------------------------------- */
export const fmtSessionTime = (startedAt: number): string => {
  const min = Math.floor((Date.now() - startedAt) / 60000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
};

export const fmtTotalHours = (h: number): string => {
  if (h < 1)   return 'Менее часа';
  if (h < 100) return `${h} ч`;
  return `${h.toLocaleString('ru')} ч`;
};
