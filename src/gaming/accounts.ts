/* ===============================================================
   GAMING ACCOUNTS  -  привязка игровых аккаунтов
   Steam, Epic, PlayStation, Xbox, VK Play и другие
=============================================================== */
import { create } from 'zustand';
import { flash } from '@/shared/flash';
import { apiGamePing, apiGameStop, apiGameSummary, apiGameShare, apiGamePresence } from '@/extras/mediaActivityApi';

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

/* -- Известные игры: тот же список, что у сервера и у Windows-приложения (electron/known-games.json) -- */
import KNOWN from '../../electron/known-games.json';
export interface KnownGame { id: string; title: string; icon: string; platform: GamingPlatform; exe: string[]; pkg: string[] }
export const KNOWN_GAMES = KNOWN as KnownGame[];
export const POPULAR_GAMES = KNOWN_GAMES.map(g => ({ id: g.id, name: g.title, icon: g.icon, platform: g.platform }));
export const iconOf = (refId: string, kind: string) => (kind === 'blox' ? '🧱' : KNOWN_GAMES.find(g => g.id === refId)?.icon ?? '🎮');

/* -- Storage ----------------------------------------------- */
const ACC_KEY = 'sky:gaming-accounts:v1';
const W = typeof window !== 'undefined';

const loadAccounts = (): Record<string, GamingAccount[]> => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(ACC_KEY) || '{}'); } catch { return {}; }
};
const saveAccounts = (d: Record<string, GamingAccount[]>) => {
  if (!W) return;
  try { localStorage.setItem(ACC_KEY, JSON.stringify(d)); } catch {}
};
interface GamingState {
  accounts:  Record<string, GamingAccount[]>;  // userId → accounts
  activity:  Record<string, GameActivity>;      // userId → current activity

  getAccounts: (userId: string) => GamingAccount[];
  addAccount:  (userId: string, acc: Omit<GamingAccount,'linkedAt'|'verified'>) => void;
  removeAccount:(userId: string, platform: GamingPlatform) => void;

  getActivity: (userId: string) => GameActivity | null;
  setPlaying:  (userId: string, game: string, icon: string, platform: GamingPlatform, id?: string) => void;
  stopPlaying: (userId: string) => void;
  /** Игра, которую человек отметил сам: пока Sky открыт, шлёт пульс (до 3 часов). */
  manual: { id: string; title: string; until: number } | null;
  share: boolean;
  setShare: (on: boolean) => Promise<void>;
  /** Свои итоги и текущая игра с сервера. */
  refreshOwn: (userId: string) => Promise<void>;
  /** Что играют другие (только те, кто включил показ). */
  refreshPresence: (ids: string[]) => Promise<void>;
  isPlaying:   (userId: string) => boolean;
}

export const useGamingAccounts = create<GamingState>((set, get) => ({
  accounts: loadAccounts(),
  activity: {},
  manual: null,
  share: false,

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

  setPlaying: (userId, game, icon, platform, id) => {
    const now = Date.now();
    const entry: GameActivity = { userId, gameName: game, gameIcon: icon, platform, startedAt: now, lastUpdated: now, isPlaying: true, sessionMinutes: 0, totalHours: 0 };
    set({ activity: { ...get().activity, [userId]: entry }, manual: { id: id ?? 'custom', title: game, until: now + 3 * 3600_000 } });
    void apiGamePing('game', id ?? 'custom', game).then((r) => { if (!r.ok) flash(r.reason ?? 'Не удалось отметить игру'); });
  },

  stopPlaying: (userId) => {
    const prev = get().activity[userId];
    set({ manual: null, activity: prev ? { ...get().activity, [userId]: { ...prev, isPlaying: false } } : get().activity });
    void apiGameStop();
  },

  setShare: async (on) => {
    const prev = get().share;
    set({ share: on });
    const r = await apiGameShare(on);
    if (!r.ok) { set({ share: prev }); flash(r.reason ?? 'Не удалось сохранить'); }
  },

  refreshOwn: async (userId) => {
    const r = await apiGameSummary();
    if (!r) return;
    const pl = r.playing;
    const stat = pl ? r.games.find(g => g.refId === pl.refId && g.kind === pl.kind) : null;
    const prev = get().activity[userId];
    const next = { ...get().activity };
    if (pl) {
      next[userId] = { userId, gameName: pl.title, gameIcon: iconOf(pl.refId, pl.kind), platform: 'custom', startedAt: new Date(pl.since).getTime(),
        lastUpdated: Date.now(), isPlaying: true, sessionMinutes: Math.floor((Date.now() - new Date(pl.since).getTime()) / 60000),
        totalHours: Math.floor((stat?.totalSec ?? 0) / 3600) };
    } else if (prev?.isPlaying && !get().manual) next[userId] = { ...prev, isPlaying: false };
    set({ activity: next, share: r.share });
  },

  refreshPresence: async (ids) => {
    const r = await apiGamePresence(ids);
    if (!r) return;
    const next = { ...get().activity };
    for (const id of ids) {
      const pl = r[id];
      if (pl) next[id] = { userId: id, gameName: pl.title, gameIcon: iconOf(pl.refId, pl.kind), platform: 'custom', startedAt: new Date(pl.since).getTime(),
        lastUpdated: Date.now(), isPlaying: true, sessionMinutes: 0, totalHours: 0 };
      else if (next[id]?.isPlaying) next[id] = { ...next[id], isPlaying: false };
    }
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
