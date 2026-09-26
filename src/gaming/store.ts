/* ===================================================
   SKY GAMING  -  Store
   Концепт: профиль, игры, турниры, ивенты, активность
=================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { wireSend } from '@/core/wire';
import { apiGameRating, type GameRating } from './matchmakingApi';
import {
  apiListTournaments, apiCreateTournament, apiJoinTournament, apiLeaveTournament, apiSetTournamentStatus,
  type ServerTournament,
} from './tournamentsApi';

export type GameGenre = 'fps'|'moba'|'battle-royale';
export type TourneyStatus = 'upcoming'|'live'|'finished';
export type EventType = 'tourney'|'drop'|'update'|'collab';

export interface GameEntry {
  id:         string;
  title:      string;
  genre:      GameGenre;
  cover:      string;           // emoji как заглушка
  gradient:   string;           // CSS gradient для карточки
  format:     string;           // реальный размер команды на Sky (см. server/matchmaking.mjs TEAM_SIZE)
  tags:       string[];
  description:string;
  developer:  string;
  releaseYear:number;
}

export interface PlayerStat {
  accountId:  string;
  gameId:     string;
  rank:       string;           // Bronze / Silver / Gold / Platinum / Diamond / Master
  rankIcon:   string;           // emoji
  xp:         number;
  wins:       number;
  losses:     number;
  hours:      number;
  kd:         number;           // kill/death
  winRate:    number;           // %
  streak:     number;
  peakRank:   string;
}

export interface Tournament {
  id:          string;
  gameId:      string;
  title:       string;
  status:      TourneyStatus;
  prize:       string;           // «50 000 ₽» | «Sky Prime 6 мес»
  teamsMax:    number;
  teamsIn:     number;
  startAt:     string;           // ISO
  format:      string;           // «5 на 5» | «Отряд 4 на 4»
  organizerId: string;
  /* Список всех участников сервер не отдаёт (не всем нужно видеть
     чужой состав) — только моё собственное участие. */
  isJoined:    boolean;
}

const toClientTourney = (t: ServerTournament): Tournament => ({
  id: t.id, gameId: t.gameId, title: t.title, status: t.status === 'cancelled' ? 'finished' : t.status,
  prize: t.prize, teamsMax: t.teamsMax, teamsIn: t.teamsIn, startAt: t.startsAt, format: t.format,
  organizerId: t.organizerId, isJoined: t.isJoined,
});

export interface NewsItem {
  id:        string;
  gameId?:   string;
  type:      EventType;
  title:     string;
  body:      string;
  emoji:     string;
  date:      string;
  hot:       boolean;
}

export interface Invite {
  id:         string;
  fromId:     string;
  fromName:   string;
  gameId:     string;
  gameTitle:  string;
  mode:       string;
  createdAt:  string;
  status:     'pending'|'accepted'|'declined';
}

export interface MatchResult {
  id:       string;
  gameId:   string;
  gameTitle:string;
  map:      string;
  result:   'win'|'loss'|'draw';
  score:    string;
  kd:       string;
  rating:   number;
  eloChange:number;
  duration: string;
  timestamp:number;
}

export type QueueStatus = 'idle'|'searching'|'found'|'waiting'|'in_game'|'reported'|'result';

/** Изменение рейтинга после подтверждённого самоотчёта — настоящая
 *  дельта Эло с сервера (server/matchmaking.mjs, confirmResult), а не
 *  выдуманное число из старой формулы 500+wins*12+hours*3. */
export interface MatchResultChange {
  delta: number;
  won:   boolean;
}

/** Найденный или подтверждённый матч — с сервера (server/matchmaking.mjs),
 *  teamA/teamB — настоящие id профилей, а не выдумка интерфейса. */
export interface MatchInfo {
  id: string;
  gameId: string;
  teamA: string[];
  teamB: string[];
  avgElo: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'reported' | 'completed' | 'disputed';
  reportedBy?:     string | null;
  reportedWinner?: 'a' | 'b' | null;
}

/* --- Игры: CS2 / Dota 2 / Fortnite ------------------
   Реальные названные игры вместо вымышленных — размер команды (format)
   совпадает с TEAM_SIZE на сервере (server/matchmaking.mjs), а не
   выдуман отдельно для карточки. Настоящей истории матчей здесь пока
   нет: она приходит только после того как поставленный на сервере
   матч сыгран и подтверждён обеими сторонами (см. задачу с
   самоотчётом), поэтому список последних матчей ниже — пустой, а не
   выдуманный. */
const SEED_MATCHES: MatchResult[] = [];

export const GAMES: GameEntry[] = [
  { id:'g-cs2',      title:'Counter-Strike 2', genre:'fps',           cover:'🔫', gradient:'linear-gradient(135deg,#1a0d10,#7a2020)', format:'5 на 5', tags:['FPS','Тактический','5 на 5'],
    description:'Тактический шутер от первого лица от Valve: раунды с закладкой и обезвреживанием бомбы, экономика, точный контроль отдачи. На Sky — поиск матча 5 на 5 по ELO.',
    developer:'Valve', releaseYear:2023 },
  { id:'g-dota2',    title:'Dota 2',           genre:'moba',          cover:'⚔️', gradient:'linear-gradient(135deg,#1f0e2e,#6b21a8)', format:'5 на 5', tags:['MOBA','5 на 5','Герои'],
    description:'MOBA от Valve: две команды по пять игроков сражаются за разрушение вражеского трона на карте с более чем сотней героев. На Sky — поиск матча 5 на 5 по ELO.',
    developer:'Valve', releaseYear:2013 },
  { id:'g-fortnite', title:'Fortnite',         genre:'battle-royale', cover:'🪂', gradient:'linear-gradient(135deg,#0f2417,#1a7a43)', format:'Отряд 4 на 4', tags:['Battle Royale','Отряд','Строительство'],
    description:'Battle royale от Epic Games с фирменным строительством. На Sky матчмейкинг работает в формате «отряд на отряд» 4 на 4 — прямое противостояние двух команд, а не полноценная королевская битва на десятки отрядов сразу.',
    developer:'Epic Games', releaseYear:2017 },
];

const GENRE_LABEL: Record<GameGenre, string> = {
  'fps':'FPS', 'moba':'MOBA', 'battle-royale':'Battle Royale',
};

export { GENRE_LABEL };

/* --- Статистика/турниры/новости/инвайты: реальных данных пока нет.
   Раньше здесь лежали выдуманные записи под старые вымышленные игры
   (Sky Arena, Neon Drift и т.д.) — с переходом на настоящие CS2/Dota
   2/Fortnite такие записи означали бы конкретную ложь про сторонние
   игры (несуществующий патч CS2, вымышленный «Neo Driver» и т.п.), а
   не безобидную заглушку для своей же выдуманной игры. Пустой список
   — честное состояние; каждый экран уже умеет показывать «пусто». */
const SEED_STATS: PlayerStat[] = [];
const SEED_NEWS: NewsItem[] = [];
const SEED_INVITES: Invite[] = [];

/* --- Store ----------------------------------------- */
const KEY = 'sky:gaming:v1';
const W   = typeof window !== 'undefined';
const load  = () => { try { return JSON.parse(localStorage.getItem(KEY)||'null'); } catch { return null; } };
const save  = (d:object) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const me    = () => useAuthStore.getState().currentUserId ?? '';

interface GamingState {
  stats:      PlayerStat[];
  tourneys:   Tournament[];
  news:       NewsItem[];
  invites:    Invite[];

  myStats:        (gameId?: string) => PlayerStat[];
  loadTournaments: () => Promise<void>;
  joinTourney:    (id: string) => Promise<void>;
  leaveTourney:   (id: string) => Promise<void>;
  setTourneyStatus: (id: string, status: 'live' | 'finished' | 'cancelled') => Promise<void>;
  answerInvite:   (id: string, accept: boolean) => void;
  sendInvite:     (toId: string, gameId: string, mode: string) => void;
  matchHistory:   MatchResult[];
  queueStatus:    QueueStatus;
  queueGame:      string | null;
  queueSeconds:   number;
  currentMatch:   MatchInfo | null;
  /* Комната войс-пати, которую сервер сам открыл для моей команды
     после подтверждения матча (см. server/signal.mjs, case 'mm:accept').
     null — комнаты нет (игра не командная) или матч ещё не подтверждён. */
  voiceRoomId:    string | null;
  /* Настоящий рейтинг с сервера (game_ratings), по каждой игре отдельно —
     заменяет старую формулу 500+wins*12+hours*3, которая читала и
     писала localStorage тем же браузером, что её и показывал. */
  ratings:        Record<string, GameRating>;
  ratingFor:      (gameId: string) => GameRating | undefined;
  /* Результат подтверждённого/оспоренного самоотчёта — заполняется на
     mm:result-confirmed/mm:result-disputed, показывается один раз и
     сбрасывается вместе с матчем (cancelQueue). */
  resultChange:   MatchResultChange | null;
  resultDisputed: boolean;
  startQueue:     (gameId: string) => void;
  cancelQueue:    () => void;
  acceptMatch:    () => void;
  declineMatch:   () => void;
  loadRating:     (gameId: string) => Promise<void>;
  /* Самоотчёт о результате — см. server/matchmaking.mjs. */
  reportWinner:   (winnerTeam: 'a' | 'b') => void;
  confirmResult:  () => void;
  disputeResult:  () => void;
  /* Приходит из socket.ts по входящим mm:* событиям — источник правды
     сервер, эти методы только кладут то, что он прислал. */
  applyQueued:            (gameId: string) => void;
  applyFound:              (match: MatchInfo) => void;
  applyWaiting:            (match: MatchInfo) => void;
  applyConfirmed:          (match: MatchInfo, voiceRoomId: string | null) => void;
  applyReported:           (match: MatchInfo) => void;
  applyResultConfirmed:    (change: MatchResultChange) => void;
  applyResultDisputed:     () => void;
  applyCancelled:          () => void;
  applyCancelledRequeued:  (gameId: string) => void;
  applyMmError:            () => void;
  setGameProfile:  (gameId: string, nickname: string) => void;
  createTourney:   (t: { gameId: string; title: string; description?: string; format?: string; prize?: string; teamsMax: number; startsAt: string }) => Promise<{ error?: string }>;
}

const stored = load();

/* Счётчик секунд поиска — чисто отображение, тикает локально, пока
   идёт реальный поиск на сервере; сам факт «нашли/не нашли» решает
   только сервер через WebSocket-события mm:*. */
let queueTick: ReturnType<typeof setInterval> | null = null;
const stopQueueTick = () => { if (queueTick) { clearInterval(queueTick); queueTick = null; } };

export const useGamingStore = create<GamingState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ stats:s.stats, invites:s.invites });
  };
  const mut = (fn:(s:GamingState)=>Partial<GamingState>) => {
    set(s=>({...s,...fn(s)})); flush();
  };

  return {
    matchHistory: SEED_MATCHES,
    queueStatus: 'idle' as QueueStatus,
    queueGame: null,
    queueSeconds: 0,
    currentMatch: null,
    voiceRoomId: null,
    resultChange: null,
    resultDisputed: false,
    ratings: {},
    ratingFor: (gameId) => get().ratings[gameId],
    stats:    stored?.stats    ?? SEED_STATS,
    // Турниры — не localStorage: общий для всех список с сервера
    // (server/tournaments.mjs), заполняется через loadTournaments().
    tourneys: [],
    news:     SEED_NEWS,   // всегда из seed (новости не редактируются)
    invites:  stored?.invites  ?? SEED_INVITES,

    // Сама постановка в очередь и поиск соперника — на сервере
    // (server/matchmaking.mjs, joinQueue): ELO берётся из его
    // таблицы, а не выдумывается на лету из wins/hours, которые
    // раньше лежали в этом же браузере и правились им же.
    startQueue: (gameId) => {
      stopQueueTick();
      set({ queueStatus: 'searching', queueGame: gameId, queueSeconds: 0, currentMatch: null });
      queueTick = setInterval(() => {
        if (get().queueStatus !== 'searching') { stopQueueTick(); return; }
        set(s => ({ queueSeconds: s.queueSeconds + 1 }));
      }, 1000);
      wireSend({ type: 'mm:join', payload: { gameId } });
    },

    cancelQueue: () => {
      stopQueueTick();
      wireSend({ type: 'mm:leave' });
      set({ queueStatus: 'idle', queueGame: null, queueSeconds: 0, currentMatch: null, voiceRoomId: null, resultChange: null, resultDisputed: false });
    },

    acceptMatch: () => {
      const matchId = get().currentMatch?.id;
      if (!matchId) return;
      wireSend({ type: 'mm:accept', payload: { matchId } });
      set({ queueStatus: 'waiting' });
    },

    declineMatch: () => {
      const matchId = get().currentMatch?.id;
      if (!matchId) return;
      wireSend({ type: 'mm:decline', payload: { matchId } });
      set({ queueStatus: 'idle', queueGame: null, queueSeconds: 0, currentMatch: null, voiceRoomId: null, resultChange: null, resultDisputed: false });
    },

    loadRating: async (gameId) => {
      const rating = await apiGameRating(gameId);
      if (rating) set(s => ({ ratings: { ...s.ratings, [gameId]: rating } }));
    },

    // Самоотчёт — сервер сам решает, кто вправе заявить и подтвердить
    // (matchmaking.mjs: участник матча / обязательно другая команда),
    // здесь только отправка команды; состояние меняется по ответу mm:*.
    reportWinner: (winnerTeam) => {
      const matchId = get().currentMatch?.id;
      if (!matchId) return;
      wireSend({ type: 'mm:report', payload: { matchId, winnerTeam } });
    },
    confirmResult: () => {
      const matchId = get().currentMatch?.id;
      if (!matchId) return;
      wireSend({ type: 'mm:confirm-result', payload: { matchId } });
    },
    disputeResult: () => {
      const matchId = get().currentMatch?.id;
      if (!matchId) return;
      wireSend({ type: 'mm:dispute-result', payload: { matchId } });
    },

    applyQueued: (gameId) => {
      set({ queueStatus: 'searching', queueGame: gameId, currentMatch: null });
    },
    applyFound: (match) => {
      stopQueueTick();
      set({ queueStatus: 'found', queueGame: match.gameId, currentMatch: match, voiceRoomId: null });
    },
    applyWaiting: (match) => {
      set({ queueStatus: 'waiting', currentMatch: match });
    },
    applyConfirmed: (match, voiceRoomId) => {
      set({ queueStatus: 'in_game', currentMatch: match, voiceRoomId });
    },
    applyReported: (match) => {
      set({ queueStatus: 'reported', currentMatch: match });
    },
    applyResultConfirmed: (change) => {
      set({ queueStatus: 'result', resultChange: change, resultDisputed: false });
      const gameId = get().currentMatch?.gameId;
      if (gameId) void get().loadRating(gameId);
    },
    applyResultDisputed: () => {
      set({ queueStatus: 'result', resultChange: null, resultDisputed: true });
    },
    applyCancelled: () => {
      stopQueueTick();
      set({ queueStatus: 'idle', queueGame: null, queueSeconds: 0, currentMatch: null, voiceRoomId: null, resultChange: null, resultDisputed: false });
    },
    applyCancelledRequeued: (gameId) => {
      set({ queueStatus: 'searching', queueGame: gameId, queueSeconds: 0, currentMatch: null, voiceRoomId: null, resultChange: null, resultDisputed: false });
      stopQueueTick();
      queueTick = setInterval(() => {
        if (get().queueStatus !== 'searching') { stopQueueTick(); return; }
        set(s => ({ queueSeconds: s.queueSeconds + 1 }));
      }, 1000);
    },
    applyMmError: () => {
      stopQueueTick();
      set({ queueStatus: 'idle', queueGame: null, queueSeconds: 0, currentMatch: null, voiceRoomId: null, resultChange: null, resultDisputed: false });
    },

    myStats: (gameId) => {
      const uid = me();
      const all = get().stats.filter(s => s.accountId===uid);
      return gameId ? all.filter(s=>s.gameId===gameId) : all;
    },

    // Турниры — общий для всех список на сервере (server/tournaments.mjs),
    // а не запись в localStorage того, кто нажал кнопку: joinTourney на
    // одном устройстве теперь видно всем, включая другое устройство того
    // же человека.
    loadTournaments: async () => {
      const list = await apiListTournaments();
      set({ tourneys: list.map(toClientTourney) });
    },

    joinTourney: async (id) => {
      const t = await apiJoinTournament(id);
      if (t) set(s => ({ tourneys: s.tourneys.map(x => x.id === id ? toClientTourney(t) : x) }));
    },

    leaveTourney: async (id) => {
      const t = await apiLeaveTournament(id);
      if (t) set(s => ({ tourneys: s.tourneys.map(x => x.id === id ? toClientTourney(t) : x) }));
    },

    setTourneyStatus: async (id, status) => {
      const t = await apiSetTournamentStatus(id, status);
      if (t) set(s => ({ tourneys: s.tourneys.map(x => x.id === id ? toClientTourney(t) : x) }));
    },

    answerInvite: (id, accept) => {
      mut(s => ({
        invites: s.invites.map(i =>
          i.id===id ? { ...i, status: accept?'accepted':'declined' } : i
        )
      }));
    },

    sendInvite: (toId, gameId, mode) => {
      const uid  = me();
      const name = useAuthStore.getState().accounts.find(a=>a.id===uid)?.name ?? 'Игрок';
      const game = GAMES.find(g=>g.id===gameId);
      if (!game) return;
      const inv: Invite = {
        id:        `inv-${crypto.randomUUID().slice(0,8)}`,
        fromId:    uid, fromName:name,
        gameId, gameTitle:game.title, mode,
        createdAt: new Date().toISOString(),
        status:    'pending',
      };
      mut(s => ({ invites:[inv,...s.invites] }));
    },

    createTourney: async (t) => {
      const r = await apiCreateTournament(t);
      if (r.tournament) set(s => ({ tourneys: [toClientTourney(r.tournament!), ...s.tourneys] }));
      return { error: r.error };
    },
    setGameProfile: (gameId, nickname) => {
      const uid = me();
      const existing = get().stats.find(s=>s.accountId===uid&&s.gameId===gameId);
      if (!existing) {
        const stat: PlayerStat = {
          accountId:uid, gameId, rank:'Bronze', rankIcon:'🥉',
          xp:0, wins:0, losses:0, hours:0, kd:0, winRate:0, streak:0, peakRank:'Bronze',
        };
        mut(s => ({ stats:[...s.stats, stat] }));
      }
    },
  };
});
