/* ===================================================
   SKY GAMING  -  Store
   Концепт: профиль, игры, турниры, ивенты, активность
=================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';

export type GameGenre = 'fps'|'moba'|'battle-royale'|'racing'|'rpg'|'strategy';
export type TourneyStatus = 'upcoming'|'live'|'finished';
export type EventType = 'tourney'|'drop'|'update'|'collab';

export interface GameEntry {
  id:         string;
  title:      string;
  genre:      GameGenre;
  cover:      string;           // emoji как заглушка
  gradient:   string;           // CSS gradient для карточки
  players:    number;           // онлайн сейчас
  rating:     number;           // 1-5
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
  id:         string;
  gameId:     string;
  title:      string;
  status:     TourneyStatus;
  prize:      string;           // «50 000 ₽» | «Sky Prime 6 мес»
  prizeIcon:  string;
  teamsMax:   number;
  teamsIn:    number;
  startAt:    string;           // ISO
  format:     string;           // «5v5» | «Соло» | «Дуо»
  participants:string[];        // accountIds
}

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

export type QueueStatus = 'idle'|'searching'|'found'|'in_game';

/* --- Seed: Игры ------------------------------------ */
const SEED_MATCHES: MatchResult[] = [
  { id:'mr1', gameId:'g-arena', gameTitle:'Sky Arena', map:'Mirage',   result:'win',  score:'16-9',  kd:'24/12', rating:1.28, eloChange:+21, duration:'28:14', timestamp:Date.now()-1800000 },
  { id:'mr2', gameId:'g-arena', gameTitle:'Sky Arena', map:'Inferno',  result:'loss', score:'11-16', kd:'18/21', rating:0.82, eloChange:-18, duration:'34:52', timestamp:Date.now()-5400000 },
  { id:'mr3', gameId:'g-arena', gameTitle:'Sky Arena', map:'Dust2',    result:'win',  score:'16-14', kd:'22/17', rating:1.14, eloChange:+14, duration:'40:11', timestamp:Date.now()-10800000 },
  { id:'mr4', gameId:'g-arena', gameTitle:'Sky Arena', map:'Nuke',     result:'win',  score:'16-7',  kd:'31/10', rating:1.97, eloChange:+25, duration:'22:38', timestamp:Date.now()-86400000 },
  { id:'mr5', gameId:'g-drift', gameTitle:'Neon Drift', map:'Circuit', result:'loss', score:'3rd/16',kd:'—',    rating:0.76, eloChange:-15, duration:'12:04', timestamp:Date.now()-172800000 },
];

export const GAMES: GameEntry[] = [
  { id:'g-arena',   title:'Sky Arena',       genre:'fps',          cover:'⚔️',  gradient:'linear-gradient(135deg,#1a1035,#4f2e8a)',       players:42800, rating:4.8, tags:['PvP','Команда','5v5'],        description:'Тактический шутер от первого лица. Командные матчи 5v5 на арене Sky. Уникальные способности, тактическое взаимодействие.',     developer:'Sky Studios',  releaseYear:2023 },
  { id:'g-drift',   title:'Neon Drift',      genre:'racing',       cover:'🏎️',  gradient:'linear-gradient(135deg,#0d1f3c,#1a6bce)',       players:18300, rating:4.5, tags:['Гонки','Дрифт','Открытый мир'], description:'Ночные гонки в неоновом городе будущего. Кастомизация авто, дрифт-механика, еженедельные чемпионаты.',              developer:'Neon Works',   releaseYear:2022 },
  { id:'g-bloom',   title:'Bloom Tactics',   genre:'strategy',     cover:'🌸',  gradient:'linear-gradient(135deg,#1a0d2e,#8b2fc9)',       players:9600,  rating:4.3, tags:['Стратегия','Turn-based','PvE'], description:'Пошаговая стратегия с элементами RPG. Стройте базу, нанимайте героев, захватывайте территории.',                    developer:'BloomSoft',    releaseYear:2024 },
  { id:'g-nexus',   title:'Nexus Royale',    genre:'battle-royale',cover:'🌀',  gradient:'linear-gradient(135deg,#0f2417,#1a7a43)',       players:67100, rating:4.6, tags:['Battle Royale','Соло','Сквад'],  description:'Брутальный battle royale с картой 8×8 км. 120 игроков, динамичный шторм, уникальный лут.',                            developer:'VortexDev',    releaseYear:2023 },
  { id:'g-world',   title:'Sky World',       genre:'rpg',          cover:'🌍',  gradient:'linear-gradient(135deg,#1a2010,#3d7a1a)',       players:31500, rating:4.7, tags:['MMORPG','Open World','PvE'],    description:'Открытый мир с живой экономикой, тысячами квестов и системой гильдий. Ежемесячные обновления.',                     developer:'Sky Studios',  releaseYear:2021 },
  { id:'g-void',   title:'Void Strike',      genre:'moba',         cover:'💥',  gradient:'linear-gradient(135deg,#1f0e0e,#8a1a1a)',       players:54200, rating:4.4, tags:['MOBA','5v5','Heroes'],          description:'Классическая MOBA с уникальным ростером из 80+ героев. Ранговые матчи, турниры, патч каждые 2 недели.',             developer:'StrikeTeam',   releaseYear:2020 },
];

const GENRE_LABEL: Record<GameGenre, string> = {
  'fps':'FPS', 'moba':'MOBA', 'battle-royale':'Battle Royale',
  'racing':'Гонки', 'rpg':'RPG', 'strategy':'Стратегия',
};

export { GENRE_LABEL };

/* --- Seed: Статистика ------------------------------ */
const SEED_STATS: PlayerStat[] = [
  { accountId:'acc-kutuzov', gameId:'g-arena', rank:'Diamond',  rankIcon:'💎', xp:47200, wins:412, losses:189, hours:834, kd:2.4,  winRate:68, streak:7,  peakRank:'Master' },
  { accountId:'acc-kutuzov', gameId:'g-nexus', rank:'Platinum', rankIcon:'🔷', xp:29100, wins:203, losses:144, hours:412, kd:1.8,  winRate:58, streak:3,  peakRank:'Diamond' },
  { accountId:'acc-luna',    gameId:'g-arena', rank:'Master',   rankIcon:'🌟', xp:83400, wins:891, losses:201, hours:1620,kd:3.1,  winRate:81, streak:14, peakRank:'Master' },
  { accountId:'acc-luna',    gameId:'g-void',  rank:'Gold',     rankIcon:'🥇', xp:18700, wins:134, losses:99,  hours:280, kd:1.4,  winRate:57, streak:2,  peakRank:'Platinum' },
  { accountId:'acc-neo',     gameId:'g-drift', rank:'Master',   rankIcon:'🌟', xp:91000, wins:744, losses:98,  hours:2100,kd:0,    winRate:88, streak:21, peakRank:'Master' },
  { accountId:'acc-neo',     gameId:'g-nexus', rank:'Diamond',  rankIcon:'💎', xp:61300, wins:531, losses:203, hours:1040,kd:2.9,  winRate:72, streak:9,  peakRank:'Master' },
];

/* --- Seed: Турниры --------------------------------- */
const SEED_TOURNEYS: Tournament[] = [
  { id:'t1', gameId:'g-arena', title:'Sky Arena Grand Prix',   status:'live',     prize:'100 000 ₽', prizeIcon:'💰', teamsMax:32, teamsIn:32, startAt:new Date(Date.now()-3600000).toISOString(),    format:'5v5',  participants:['acc-kutuzov','acc-luna'] },
  { id:'t2', gameId:'g-nexus', title:'Nexus Royale Season Cup',status:'upcoming', prize:'50 000 ₽',  prizeIcon:'🏆', teamsMax:120,teamsIn:89, startAt:new Date(Date.now()+86400000*2).toISOString(), format:'Соло', participants:['acc-neo'] },
  { id:'t3', gameId:'g-drift', title:'Neon Drift Night Race',  status:'upcoming', prize:'Sky Prime 1 год', prizeIcon:'👑', teamsMax:64,teamsIn:41, startAt:new Date(Date.now()+86400000*5).toISOString(), format:'Дуо', participants:[] },
  { id:'t4', gameId:'g-void',  title:'Void Strike Masters',    status:'finished', prize:'25 000 ₽',  prizeIcon:'🥈', teamsMax:16, teamsIn:16, startAt:new Date(Date.now()-86400000*3).toISOString(), format:'5v5',  participants:['acc-luna'] },
];

/* --- Seed: Новости/ивенты -------------------------- */
const SEED_NEWS: NewsItem[] = [
  { id:'nw1', gameId:'g-arena', type:'update',  emoji:'⚡', hot:true,  title:'Sky Arena Patch 4.7  -  Новый агент «Тень»', body:'Добавлен новый агент с механикой невидимости. Балансировка оружия, исправление 23 багов.',                 date:new Date(Date.now()-3600000*2).toISOString() },
  { id:'nw2', gameId:'g-nexus', type:'drop',    emoji:'🎁', hot:true,  title:'Nexus Royale: Бесплатный скин до 15 марта', body:'Войдите в игру и получите эксклюзивный скин «Void Walker» и 500 кристаллов.',                          date:new Date(Date.now()-3600000*5).toISOString() },
  { id:'nw3',                   type:'collab',  emoji:'🤝', hot:false, title:'Sky Arena × Neon Drift Crossover',          body:'Выбивайте специальные авто-бандлы, играя в обе игры. Событие до конца месяца.',                        date:new Date(Date.now()-86400000).toISOString() },
  { id:'nw4', gameId:'g-world', type:'update',  emoji:'🌍', hot:false, title:'Sky World 8.0  -  Новый континент Аурис',     body:'Огромный новый материк с 400+ квестами, новой расой эльфов и системой осады замков.',                    date:new Date(Date.now()-86400000*2).toISOString() },
  { id:'nw5', gameId:'g-arena', type:'tourney', emoji:'🏆', hot:true,  title:'Регистрация на Sky Arena Grand Prix открыта', body:'Призовой фонд 100 000 ₽. 32 команды, двойное элиминирование. Регистрация до 10 марта.',                 date:new Date(Date.now()-86400000*3).toISOString() },
  { id:'nw6', gameId:'g-drift', type:'update',  emoji:'🏎️', hot:false, title:'Neon Drift: 12 новых авто и трасса «Токио»', body:'Добавлен Токийский автодром, физика дрифта переработана, новый режим Команда vs Команда.',             date:new Date(Date.now()-86400000*4).toISOString() },
];

/* --- Seed: Инвайты --------------------------------- */
const SEED_INVITES: Invite[] = [
  { id:'inv1', fromId:'acc-luna', fromName:'Luna Nova', gameId:'g-arena', gameTitle:'Sky Arena', mode:'Ранговый 5v5', createdAt:new Date(Date.now()-600000).toISOString(), status:'pending' },
  { id:'inv2', fromId:'acc-neo',  fromName:'Neo Driver', gameId:'g-drift', gameTitle:'Neon Drift', mode:'Ночная гонка', createdAt:new Date(Date.now()-1800000).toISOString(), status:'pending' },
];

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
  joinTourney:    (id: string) => void;
  leaveTourney:   (id: string) => void;
  answerInvite:   (id: string, accept: boolean) => void;
  sendInvite:     (toId: string, gameId: string, mode: string) => void;
  matchHistory:   MatchResult[];
  queueStatus:    QueueStatus;
  queueGame:      string | null;
  queueSeconds:   number;
  startQueue:     (gameId: string) => void;
  cancelQueue:    () => void;
  acceptMatch:    () => void;
  setGameProfile:  (gameId: string, nickname: string) => void;
  createTourney:   (t: Omit<Tournament,'id'|'participants'|'teamsIn'>) => void;
  deleteTourney:   (id: string) => void;
}

const stored = load();

export const useGamingStore = create<GamingState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ stats:s.stats, tourneys:s.tourneys, invites:s.invites });
  };
  const mut = (fn:(s:GamingState)=>Partial<GamingState>) => {
    set(s=>({...s,...fn(s)})); flush();
  };

  return {
    matchHistory: SEED_MATCHES,
    queueStatus: 'idle' as QueueStatus,
    queueGame: null,
    queueSeconds: 0,
    stats:    stored?.stats    ?? SEED_STATS,
    tourneys: stored?.tourneys ?? SEED_TOURNEYS,
    news:     SEED_NEWS,   // всегда из seed (новости не редактируются)
    invites:  stored?.invites  ?? SEED_INVITES,

    myStats: (gameId) => {
      const uid = me();
      const all = get().stats.filter(s => s.accountId===uid);
      return gameId ? all.filter(s=>s.gameId===gameId) : all;
    },

    joinTourney: (id) => {
      const uid = me();
      mut(s => ({
        tourneys: s.tourneys.map(t =>
          t.id===id && !t.participants.includes(uid) && t.teamsIn < t.teamsMax
            ? { ...t, participants:[...t.participants,uid], teamsIn:t.teamsIn+1 }
            : t
        )
      }));
    },

    leaveTourney: (id) => {
      const uid = me();
      mut(s => ({
        tourneys: s.tourneys.map(t =>
          t.id===id
            ? { ...t, participants:t.participants.filter(p=>p!==uid), teamsIn:Math.max(0,t.teamsIn-1) }
            : t
        )
      }));
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

    createTourney: (t) => {
      const id = 'ct-' + Date.now();
      mut(s => ({ tourneys: [...s.tourneys, { ...t, id, participants:[], teamsIn:0 }] }));
    },
    deleteTourney: (id) => {
      mut(s => ({ tourneys: s.tourneys.filter(t => t.id !== id) }));
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
