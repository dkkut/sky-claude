import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGamingStore, GAMES, type MatchResult } from './store';
import { useAuthStore } from '@/core/auth/store';
import { RANK_GLOW } from './components/Primitives';
import { GamingChannels } from './GamingChannels';
import { TourneysView } from './components/TourneysView';
import { VoicePartyModule } from '@/voiceparty/VoicePartyModule';
import { useOtherProfiles } from '@/profile/viewer/otherProfiles';

/* ── FACEIT colour tokens ─────────────────────────────────── */
const FC = {
  bg:      '#0f0f13',
  card:    '#161619',
  card2:   '#1c1c21',
  border:  'rgba(255,255,255,0.07)',
  border2: 'rgba(255,255,255,0.12)',
  orange:  '#f5771f',
  orangeD: '#cc5c0e',
  t1:      '#ffffff',
  t2:      '#9da3ae',
  t3:      '#575c66',
  green:   '#00dc5a',
  red:     '#ff3b5c',
  blue:    '#4a9eff',
};

/* ── Helpers ─────────────────────────────────────────────── */
const fmtTime = (sec: number) => `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
const ago = (ts: number) => {
  const d = Date.now() - ts;
  if (d < 3600000)   return `${Math.floor(d/60000)}м назад`;
  if (d < 86400000)  return `${Math.floor(d/3600000)}ч назад`;
  return `${Math.floor(d/86400000)}д назад`;
};
const K = (n: number) => n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n);

const RANK_ORDER = ['Bronze','Silver','Gold','Platinum','Diamond','Master'];
const RANK_CFG: Record<string,{color:string;bg:string;label:string}> = {
  Bronze:   { color:'#cd7f32', bg:'rgba(205,127,50,0.12)',  label:'Bronze'   },
  Silver:   { color:'#9da3ae', bg:'rgba(157,163,174,0.12)', label:'Silver'   },
  Gold:     { color:'#f5c518', bg:'rgba(245,197,24,0.12)',  label:'Gold'     },
  Platinum: { color:'#4a9eff', bg:'rgba(74,158,255,0.12)',  label:'Platinum' },
  Diamond:  { color:'#a855f7', bg:'rgba(168,85,247,0.12)',  label:'Diamond'  },
  Master:   { color:'#f5771f', bg:'rgba(245,119,31,0.12)',  label:'Master'   },
};

/* ── ELO badge ───────────────────────────────────────────── */
const EloBadge = ({ elo }: { elo: number }) => {
  const level = Math.min(10, Math.max(1, Math.floor(elo / 500) + 1));
  const color = level >= 10 ? '#aa01a7' : level >= 6 ? '#f5771f' : level >= 3 ? '#f0a500' : '#828282';
  return (
    <div className="flex items-center gap-1.5">
      <div className="grid place-items-center rounded text-xs font-black text-white"
        style={{ background: color, width: 22, height: 22, fontSize: 10, borderRadius: 4 }}>
        {level}
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color: FC.t1 }}>
        {elo.toLocaleString('ru')} ELO
      </span>
    </div>
  );
};

/* ── WIN / LOSS chip ─────────────────────────────────────── */
const ResultChip = ({ r }: { r: 'win'|'loss'|'draw' }) => (
  <div className="grid place-items-center rounded text-[10px] font-black"
    style={{
      width: 32, height: 20, borderRadius: 3,
      background: r === 'win' ? FC.green : r === 'loss' ? FC.red : '#575c66',
      color: '#000',
    }}>
    {r === 'win' ? 'W' : r === 'loss' ? 'L' : 'D'}
  </div>
);

/* ─────────────────────────────────────────────────────────
   PLAY TAB — Queue, Recent matches, Live party
───────────────────────────────────────────────────────── */
const PlayView = () => {
  const {
    myStats, matchHistory, queueStatus, queueGame, queueSeconds, currentMatch, rating,
    startQueue, cancelQueue, acceptMatch, declineMatch, loadRating,
  } = useGamingStore();
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const accountName = me?.name;
  const accountUsername = me?.username;
  const stats = myStats();
  const mainStat = stats[0];
  const mainGame = GAMES.find(g => g.id === mainStat?.gameId) ?? GAMES[0];
  const elo = 500 + (mainStat?.wins ?? 0) * 12 + (mainStat?.hours ?? 0) * 3;
  const rc = RANK_CFG[mainStat?.rank ?? 'Bronze'] ?? RANK_CFG.Bronze;

  // Соперник — реальный id из currentMatch, а не выдумка: подгружаем его
  // публичный профиль тем же кэшем, что и обычный просмотр профиля.
  const opponentId = currentMatch
    ? [...currentMatch.teamA, ...currentMatch.teamB].find(id => id !== currentUserId)
    : undefined;
  const opponentEntry = useOtherProfiles(s => (opponentId ? s.byId[opponentId] : undefined));
  const fetchOther = useOtherProfiles(s => s.fetch);
  useEffect(() => { if (opponentId) void fetchOther(opponentId); }, [opponentId, fetchOther]);
  useEffect(() => { if (queueGame) void loadRating(queueGame); }, [queueGame, loadRating]);
  const matchElo = currentMatch?.avgElo ?? rating?.elo ?? 1000;

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ scrollbarWidth:'none', background: FC.bg }}>

      {/* ── Player hero ─────────────────────────────────── */}
      <div className="mx-4 mt-3 rounded-xl overflow-hidden"
        style={{ background: FC.card, border: `1px solid ${FC.border}` }}>
        {/* Orange top stripe */}
        <div className="h-0.5" style={{ background: `linear-gradient(90deg,${FC.orange},transparent)` }}/>
        <div className="p-4">
          <div className="flex items-center gap-3">
            {/* Avatar with level ring */}
            <div className="relative shrink-0">
              <div className="grid h-14 w-14 place-items-center rounded-full text-xl font-black text-white"
                style={{ background: 'linear-gradient(135deg,#2a2a35,#1a1a22)',
                  border: `2px solid ${rc.color}`, boxShadow: `0 0 16px ${rc.color}40` }}>
                {accountName?.[0] ?? 'P'}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full text-[8px] font-black"
                style={{ background: RC(mainStat?.rank).color ?? FC.orange, color:'#000', border:`2px solid ${FC.bg}` }}>
                {mainStat?.rankIcon ?? '🥉'}
              </div>
            </div>
            {/* Name + ELO */}
            <div className="flex-1 min-w-0">
              <p className="text-base font-black truncate" style={{ color: FC.t1 }}>
                {accountName ?? 'Player'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <EloBadge elo={elo}/>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: rc.bg, color: rc.color }}>{rc.label}</span>
              </div>
            </div>
            {/* Win rate */}
            <div className="text-right shrink-0">
              <p className="text-xl font-black tabular-nums" style={{ color: FC.orange }}>
                {mainStat?.winRate ?? 0}%
              </p>
              <p className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: FC.t3 }}>WIN RATE</p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-3"
            style={{ borderTop: `1px solid ${FC.border}` }}>
            {[
              { v: String(mainStat?.wins ?? 0),            l: 'WINS',    c: FC.green },
              { v: `${mainStat?.kd?.toFixed(1) ?? '0.0'}`, l: 'K/D',     c: FC.t1   },
              { v: String(mainStat?.hours ?? 0) + 'h',     l: 'HOURS',   c: FC.t2   },
              { v: String(mainStat?.streak ?? 0),           l: 'STREAK',  c: FC.orange },
            ].map(({ v, l, c }) => (
              <div key={l} className="flex flex-col items-center gap-0.5">
                <p className="text-sm font-black tabular-nums" style={{ color: c }}>{v}</p>
                <p className="text-[8px] tracking-widest" style={{ color: FC.t3 }}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Queue / Match found ─────────────────────────── */}
      <div className="px-4 mt-3">
        {queueStatus === 'idle' && (
          <div className="space-y-2">
            {/* Game selector */}
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
              {GAMES.slice(0,4).map(g => (
                <button key={g.id} type="button" onClick={() => startQueue(g.id)}
                  className="shrink-0 flex items-center gap-2.5 rounded-xl px-4 py-2.5 transition-all hover:border-orange-500/50"
                  style={{ background: FC.card2, border: `1px solid ${FC.border}`, minWidth: 140 }}>
                  <span className="text-xl">{g.cover}</span>
                  <div className="text-left">
                    <p className="text-xs font-bold truncate" style={{ color: FC.t1 }}>{g.title}</p>
                    <p className="text-[9px]" style={{ color: FC.t3 }}>{g.format}</p>
                  </div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => startQueue(GAMES[0].id)}
              className="w-full rounded-xl py-3.5 text-sm font-black tracking-wide transition-all hover:opacity-90 active:scale-[0.99]"
              style={{ background: `linear-gradient(135deg,${FC.orange},${FC.orangeD})`,
                color:'#fff', boxShadow: `0 4px 20px ${FC.orange}40` }}>
              НАЙТИ МАТЧ
            </button>
          </div>
        )}

        {queueStatus === 'searching' && (
          <div className="rounded-xl overflow-hidden"
            style={{ background: FC.card, border: `1px solid ${FC.border}` }}>
            <div className="h-0.5 relative overflow-hidden"
              style={{ background: FC.border }}>
              <motion.div className="absolute inset-0" style={{ background: FC.orange }}
                animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}/>
            </div>
            <div className="p-4 flex items-center gap-4">
              <div className="relative shrink-0">
                <svg className="w-12 h-12 -rotate-90">
                  <circle cx="24" cy="24" r="20" fill="none" stroke={FC.border2} strokeWidth="3"/>
                  <motion.circle cx="24" cy="24" r="20" fill="none" stroke={FC.orange} strokeWidth="3"
                    strokeDasharray={`${2*Math.PI*20}`}
                    animate={{ strokeDashoffset: [2*Math.PI*20, 0] }}
                    transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[11px] font-black tabular-nums" style={{ color: FC.orange }}>
                    {fmtTime(queueSeconds)}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-black" style={{ color: FC.t1 }}>Поиск матча...</p>
                <p className="text-xs mt-0.5" style={{ color: FC.t2 }}>
                  {GAMES.find(g=>g.id===queueGame)?.title} · {GAMES.find(g=>g.id===queueGame)?.format} · {K(matchElo)} ELO
                </p>
              </div>
              <button type="button" onClick={cancelQueue}
                className="rounded-lg px-3 py-2 text-xs font-bold"
                style={{ background:'rgba(255,59,92,0.12)', color: FC.red, border:`1px solid rgba(255,59,92,0.25)` }}>
                Отмена
              </button>
            </div>
          </div>
        )}

        {(queueStatus === 'found' || queueStatus === 'waiting') && currentMatch && (
          <motion.div initial={{ scale:0.96, opacity:0 }} animate={{ scale:1, opacity:1 }}
            className="rounded-xl overflow-hidden"
            style={{ background: FC.card, border: `2px solid ${FC.green}` }}>
            <div className="h-0.5" style={{ background: FC.green }}/>
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <motion.div className="h-2 w-2 rounded-full" style={{ background: FC.green }}
                  animate={{ scale:[1,1.4,1] }} transition={{ duration:0.8, repeat:Infinity }}/>
                <p className="text-sm font-black uppercase tracking-wide" style={{ color: FC.green }}>
                  {queueStatus === 'found' ? 'Матч найден!' : 'Ждём соперника...'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4 text-center">
                {[
                  { l:'ИГРА', v: GAMES.find(g=>g.id===currentMatch.gameId)?.title ?? currentMatch.gameId },
                  { l:'AVG ELO', v:`${K(currentMatch.avgElo)}` },
                ].map(({l,v})=>(
                  <div key={l} className="rounded-lg py-2" style={{ background: FC.card2 }}>
                    <p className="text-xs font-black" style={{ color: FC.t1 }}>{v}</p>
                    <p className="text-[8px] tracking-widest mt-0.5" style={{ color: FC.t3 }}>{l}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg py-2 mb-4 text-center" style={{ background: FC.card2 }}>
                <p className="text-xs font-black" style={{ color: FC.t1 }}>
                  {opponentEntry?.name ?? (opponentEntry === null ? 'Игрок' : '…')}
                  {opponentEntry?.username ? ` · @${opponentEntry.username}` : ''}
                </p>
                <p className="text-[8px] tracking-widest mt-0.5" style={{ color: FC.t3 }}>СОПЕРНИК</p>
              </div>
              {queueStatus === 'found' ? (
                <div className="flex gap-2">
                  <button type="button" onClick={acceptMatch}
                    className="flex-1 rounded-lg py-2.5 text-sm font-black"
                    style={{ background: FC.green, color:'#000' }}>
                    ПРИНЯТЬ
                  </button>
                  <button type="button" onClick={declineMatch}
                    className="rounded-lg px-4 py-2.5 text-sm font-bold"
                    style={{ background: FC.card2, color: FC.t2, border:`1px solid ${FC.border}` }}>
                    Отказ
                  </button>
                </div>
              ) : (
                <p className="text-xs text-center" style={{ color: FC.t3 }}>
                  Вы приняли — ждём подтверждения от соперника.
                </p>
              )}
            </div>
          </motion.div>
        )}

        {queueStatus === 'in_game' && currentMatch && (
          <motion.div initial={{ scale:0.96, opacity:0 }} animate={{ scale:1, opacity:1 }}
            className="rounded-xl overflow-hidden p-4 text-center"
            style={{ background: FC.card, border: `2px solid ${FC.green}` }}>
            <p className="text-sm font-black uppercase tracking-wide mb-1" style={{ color: FC.green }}>
              Матч подтверждён
            </p>
            <p className="text-xs mb-3" style={{ color: FC.t2 }}>
              {GAMES.find(g=>g.id===currentMatch.gameId)?.title} против {opponentEntry?.name ?? 'соперника'}
            </p>
            <button type="button" onClick={cancelQueue}
              className="rounded-lg px-4 py-2 text-xs font-bold"
              style={{ background: FC.card2, color: FC.t2, border:`1px solid ${FC.border}` }}>
              Готово
            </button>
          </motion.div>
        )}
      </div>

      {/* ── Recent matches ──────────────────────────────── */}
      {matchHistory.length > 0 && (
        <div className="px-4 mt-5">
          <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: FC.t3 }}>
            Последние матчи
          </p>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${FC.border}` }}>
            {matchHistory.slice(0,5).map((m, i) => (
              <div key={m.id}
                className="flex items-center gap-3 px-3 py-2.5"
                style={{ background: i%2===0 ? FC.card : FC.card2,
                  borderBottom: i < Math.min(matchHistory.length,5)-1 ? `1px solid ${FC.border}` : 'none' }}>
                <ResultChip r={m.result}/>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate" style={{ color: FC.t1 }}>{m.map}</p>
                  <p className="text-[9px]" style={{ color: FC.t3 }}>{m.score} · {m.kd} K/D</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-black tabular-nums"
                    style={{ color: m.eloChange > 0 ? FC.green : FC.red }}>
                    {m.eloChange > 0 ? '+' : ''}{m.eloChange}
                  </p>
                  <p className="text-[9px]" style={{ color: FC.t3 }}>{ago(m.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── RANK HELPER (safe) ──────────────────────────────────── */
function RC(rank?: string) {
  return RANK_CFG[rank ?? 'Bronze'] ?? RANK_CFG.Bronze;
}

/* ─────────────────────────────────────────────────────────
   STATS TAB — Leaderboard + per-game
───────────────────────────────────────────────────────── */
const StatsView = () => {
  const { myStats } = useGamingStore();
  const stats = myStats();

  return (
    <div className="h-full overflow-y-auto pb-6 px-4" style={{ scrollbarWidth:'none', background: FC.bg }}>
      {stats.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <p className="text-sm font-bold" style={{ color: FC.t3 }}>Статистики нет</p>
          <p className="text-xs" style={{ color: FC.t3 }}>Сыграй матч чтобы увидеть данные</p>
        </div>
      ) : stats.map(s => {
        const game = GAMES.find(g => g.id === s.gameId)!;
        const elo  = 500 + s.wins * 12 + s.hours * 3;
        const rc   = RC(s.rank);
        const xpPct= Math.min(100, (s.xp % 10000) / 100);
        const wl   = s.wins + s.losses;

        return (
          <div key={s.gameId} className="mt-3 rounded-xl overflow-hidden"
            style={{ background: FC.card, border: `1px solid ${FC.border}` }}>
            {/* Game header */}
            <div className="flex items-center gap-3 px-4 py-3"
              style={{ background: FC.card2, borderBottom: `1px solid ${FC.border}` }}>
              <span className="text-2xl">{game.cover}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black" style={{ color: FC.t1 }}>{game.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <EloBadge elo={elo}/>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: rc.bg, color: rc.color }}>{rc.label}</span>
                </div>
              </div>
              {s.streak > 1 && (
                <div className="flex items-center gap-1 rounded-lg px-2 py-1"
                  style={{ background:'rgba(245,119,31,0.12)', border:`1px solid rgba(245,119,31,0.25)` }}>
                  <span style={{ color: FC.orange, fontSize:12 }}>🔥</span>
                  <span className="text-[10px] font-black" style={{ color: FC.orange }}>{s.streak}</span>
                </div>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4" style={{ borderBottom: `1px solid ${FC.border}` }}>
              {[
                { v:`${s.winRate}%`,        l:'W/R',  c: FC.green  },
                { v:s.kd.toFixed(2),         l:'K/D',  c: FC.t1    },
                { v:String(s.wins),           l:'WINS', c: FC.t1    },
                { v:`${s.hours}H`,            l:'TIME', c: FC.t2    },
              ].map(({v,l,c})=>(
                <div key={l} className="flex flex-col items-center py-3 gap-0.5"
                  style={{ borderRight: `1px solid ${FC.border}` }}>
                  <p className="text-sm font-black tabular-nums" style={{ color: c }}>{v}</p>
                  <p className="text-[8px] tracking-widest" style={{ color: FC.t3 }}>{l}</p>
                </div>
              ))}
            </div>

            {/* XP progress */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] uppercase tracking-widest" style={{ color: FC.t3 }}>
                  Прогресс до {RANK_ORDER[RANK_ORDER.indexOf(s.rank)+1] ?? 'MAX'}
                </p>
                <p className="text-[9px] font-black tabular-nums" style={{ color: FC.orange }}>
                  {K(s.xp)} XP
                </p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e1e25' }}>
                <motion.div initial={{ width:0 }} animate={{ width:`${xpPct}%` }}
                  transition={{ duration:1, ease:'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg,${FC.orangeD},${FC.orange})` }}/>
              </div>
              {/* W/L bar */}
              {wl > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-bold" style={{ color: FC.green }}>{s.wins}W</span>
                    <span className="text-[9px] font-bold" style={{ color: FC.red }}>{s.losses}L</span>
                  </div>
                  <div className="flex h-1 rounded-full overflow-hidden gap-px">
                    <div className="rounded-l-full" style={{ width:`${(s.wins/wl)*100}%`, background: FC.green }}/>
                    <div className="rounded-r-full flex-1" style={{ background: FC.red }}/>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────
   MAIN MODULE
───────────────────────────────────────────────────────── */
type Tab = 'play'|'voice'|'stats'|'tourneys'|'channels';

export const GamingModule = () => {
  const [tab, setTab] = useState<Tab>('play');
  const { invites } = useGamingStore();
  const pending = invites.filter(i => i.status === 'pending').length;

  const TABS: { key:Tab; label:string }[] = [
    { key:'play',     label:'Играть'    },
    { key:'voice',    label:'Войс-пати' },
    { key:'stats',    label:'Статы'     },
    { key:'tourneys', label:'Турниры'   },
    { key:'channels', label:'Каналы'    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: FC.bg }}>

      {/* ── FACEIT-style header ─────────────────────────── */}
      <div style={{ background: FC.card, borderBottom: `1px solid ${FC.border}` }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md"
              style={{ background: FC.orange }}>
              <span className="text-xs font-black text-black">SK</span>
            </div>
            <div>
              <p className="text-xs font-black tracking-tight" style={{ color: FC.t1 }}>SKY GAMING</p>
              <p className="text-[9px]" style={{ color: FC.t3 }}>
                CS2 · Dota 2 · Fortnite
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ background:'rgba(0,220,90,0.1)', border:'1px solid rgba(0,220,90,0.2)' }}>
            <motion.div className="h-1.5 w-1.5 rounded-full" style={{ background: FC.green }}
              animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.2, repeat:Infinity }}/>
            <span className="text-[9px] font-bold" style={{ color: FC.green }}>LIVE</span>
          </div>
        </div>

        {/* Tab bar — FACEIT style underline */}
        <div className="flex" style={{ borderTop: `1px solid ${FC.border}` }}>
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="relative flex-1 py-2.5 text-[12px] font-bold transition-colors"
              style={{ color: tab===t.key ? FC.t1 : FC.t3 }}>
              {t.label}
              {t.key==='play' && pending>0 && (
                <span className="absolute top-1.5 right-2 grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black"
                  style={{ background: FC.red, color:'#fff', padding:'0 3px' }}>{pending}</span>
              )}
              {tab===t.key && (
                <motion.div layoutId="faceit-tab"
                  className="absolute bottom-0 inset-x-0 h-[2px]"
                  style={{ background: FC.orange }}/>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} className="h-full"
            initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            transition={{ duration:0.1 }}>
            {tab==='play'     && <PlayView/>}
            {tab==='voice'    && <VoicePartyModule/>}
            {tab==='stats'    && <StatsView/>}
            {tab==='tourneys' && (
              <div className="h-full" style={{ background: FC.bg }}>
                <TourneysView/>
              </div>
            )}
            {tab==='channels' && <GamingChannels/>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
