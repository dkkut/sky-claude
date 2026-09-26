import { useState, useEffect } from 'react';
import { Trophy, Plus, X, Users, Clock, ChevronRight, Zap, Flag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGamingStore, GAMES } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { GENRE_COLOR, countdown } from './Primitives';

const PRIZES  = ['500 ₽','1 000 ₽','5 000 ₽','10 000 ₽','50 000 ₽','Sky Prime 1 мес','Sky Prime 3 мес','Скин эпик','Скин легендарный'];

const STATUS_CFG = {
  live:     { label: 'LIVE',   bg: 'rgba(244,63,94,0.12)',   color: '#f43f5e', dot: true  },
  upcoming: { label: 'Скоро',  bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', dot: false },
  finished: { label: 'Итоги', bg: 'rgba(100,100,120,0.12)', color: 'var(--t3)', dot: false },
};

export const TourneysView = () => {
  const { tourneys, joinTourney, leaveTourney, createTourney, loadTournaments, setTourneyStatus } = useGamingStore();
  const { currentUserId } = useAuthStore();
  const [filter,     setFilter]     = useState<'all'|'live'|'upcoming'|'finished'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const uid = currentUserId ?? '';

  useEffect(() => { void loadTournaments(); }, [loadTournaments]);

  const [title,   setTitle]   = useState('');
  const [gameId,  setGameId]  = useState(GAMES[0]?.id ?? '');
  const [format,  setFormat]  = useState(GAMES[0]?.format ?? '');
  const [teamsMax,setTeamsMax]= useState(16);
  const [prize,   setPrize]   = useState('5 000 ₽');
  const [startAt, setStartAt] = useState('');
  const [err,     setErr]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...tourneys]
    .filter(t => filter === 'all' || t.status === filter)
    .sort((a, b) => ({ live:0, upcoming:1, finished:2 }[a.status]) - ({ live:0, upcoming:1, finished:2 }[b.status]));

  const handleCreate = async () => {
    if (!title.trim()) { setErr('Введите название'); return; }
    if (!startAt)       { setErr('Укажите дату');    return; }
    setSubmitting(true);
    const r = await createTourney({ gameId, title: title.trim(), prize, teamsMax, format, startsAt: new Date(startAt).toISOString() });
    setSubmitting(false);
    if (r.error) { setErr(r.error === 'invalid_schedule' ? 'Дата должна быть в будущем' : 'Не удалось создать турнир'); return; }
    setTitle(''); setStartAt(''); setErr(''); setShowCreate(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="flex gap-1.5 flex-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {(['all','live','upcoming','finished'] as const).map(k => {
            const labels = { all:'Все', live:'Live', upcoming:'Скоро', finished:'Архив' };
            const on = filter === k;
            return (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
                style={{
                  background: on ? (k === 'live' ? 'rgba(244,63,94,0.15)' : 'var(--accent-bg)') : 'transparent',
                  color: on ? (k === 'live' ? '#f43f5e' : 'var(--accent)') : 'var(--t3)',
                  border: `1px solid ${on ? (k === 'live' ? 'rgba(244,63,94,0.3)' : 'rgba(79,110,247,0.3)') : 'var(--border)'}`,
                }}>
                {k === 'live' && on && (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1.5 animate-pulse"/>
                )}
                {labels[k]}
                {k !== 'all' && (
                  <span className="ml-1.5 text-[9px] opacity-60">
                    {tourneys.filter(t => t.status === k).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <motion.button whileTap={{ scale: 0.92 }} type="button"
          onClick={() => setShowCreate(v => !v)}
          className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: showCreate ? 'rgba(79,110,247,0.15)' : 'var(--accent)',
            color: showCreate ? 'var(--accent)' : 'white',
            border: showCreate ? '1px solid rgba(79,110,247,0.3)' : 'none' }}>
          {showCreate ? <X size={12}/> : <Plus size={12}/>}
          {showCreate ? 'Отмена' : 'Создать'}
        </motion.button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-4 mb-3">
            <div className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--bg-l1)', border: '1px solid rgba(79,110,247,0.2)' }}>
              <p className="text-sm font-black text-white">Новый турнир</p>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Название *"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <div className="grid grid-cols-2 gap-2">
                <select value={gameId} onChange={e => { setGameId(e.target.value); setFormat(GAMES.find(g => g.id === e.target.value)?.format ?? ''); }}
                  className="rounded-xl px-2 py-2 text-xs outline-none"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
                  {GAMES.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
                <div className="rounded-xl px-3 py-2 text-xs flex items-center"
                  style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t3)' }}>
                  {format}
                </div>
                <select value={teamsMax} onChange={e => setTeamsMax(+e.target.value)}
                  className="rounded-xl px-2 py-2 text-xs outline-none"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
                  {[4,8,16,32,64].map(n => <option key={n} value={n}>{n} команд</option>)}
                </select>
                <select value={prize} onChange={e => setPrize(e.target.value)}
                  className="rounded-xl px-2 py-2 text-xs outline-none"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
                  {PRIZES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={handleCreate} disabled={submitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                <Trophy size={14}/> {submitting ? 'Секунду…' : 'Создать турнир'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5" style={{ scrollbarWidth: 'none' }}>
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="grid h-14 w-14 place-items-center rounded-2xl"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <Trophy size={24} style={{ color: 'var(--t3)', opacity: 0.5 }}/>
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--t3)' }}>Нет турниров</p>
          </div>
        )}
        {sorted.map(t => {
          const game = GAMES.find(g => g.id === t.gameId);
          const col  = game ? GENRE_COLOR[game.genre] : 'var(--accent)';
          const cfg  = STATUS_CFG[t.status];
          const isIn = t.isJoined;
          const isOrganizer = t.organizerId === uid;
          const pct  = Math.min(100, (t.teamsIn / t.teamsMax) * 100);

          return (
            <motion.div key={t.id} layout
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--bg-l2)', border: `1px solid ${t.status === 'live' ? 'rgba(244,63,94,0.25)' : 'var(--border)'}` }}>

              {/* Live indicator strip */}
              {t.status === 'live' && (
                <div className="h-0.5 w-full"
                  style={{ background: 'linear-gradient(90deg,#f43f5e,rgba(244,63,94,0.3))' }}/>
              )}

              <div className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  {/* Cover */}
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl"
                    style={{ background: game?.gradient ?? `${col}15` }}>
                    {game?.cover ?? '🏆'}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{t.title}</p>
                      <span className="shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold"
                        style={{ background: cfg.bg, color: cfg.color }}>
                        {cfg.dot && (
                          <span className="h-1.5 w-1.5 rounded-full inline-block animate-pulse"
                            style={{ background: cfg.color }}/>
                        )}
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
                      {game?.title} · {t.format}
                      {t.status !== 'finished' && ` · ${countdown(t.startAt)}`}
                    </p>
                  </div>
                  {/* Prize */}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black" style={{ color: 'var(--amber)' }}>{t.prize}</p>
                    <p className="text-[9px]" style={{ color: 'var(--t3)' }}>приз</p>
                  </div>
                </div>

                {/* Progress + actions */}
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Users size={10} style={{ color: 'var(--t3)' }}/>
                        <span className="text-[10px]" style={{ color: 'var(--t3)' }}>
                          {t.teamsIn} / {t.teamsMax} команд
                        </span>
                      </div>
                      <span className="text-[10px] font-semibold"
                        style={{ color: pct >= 90 ? '#f43f5e' : col }}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                      <motion.div className="h-full rounded-full"
                        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                        style={{ background: pct >= 90 ? '#f43f5e' : `linear-gradient(90deg,${col}80,${col})` }}/>
                    </div>
                  </div>

                  {t.status !== 'finished' && (
                    <div className="flex gap-2">
                      {isIn ? (
                        <button type="button" onClick={() => leaveTourney(t.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all"
                          style={{ background: 'rgba(248,113,113,0.08)', color: 'var(--red)',
                            border: '1px solid rgba(248,113,113,0.2)' }}>
                          <X size={11}/> Выйти
                        </button>
                      ) : (
                        <button type="button" onClick={() => joinTourney(t.id)}
                          disabled={t.teamsIn >= t.teamsMax}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all disabled:opacity-40"
                          style={{ background: 'var(--accent)', color: 'white' }}>
                          <Zap size={11}/> Участвовать
                        </button>
                      )}
                      {isIn && (
                        <div className="flex items-center justify-center rounded-xl px-3 py-2 gap-1"
                          style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }}>
                          <span className="h-1.5 w-1.5 rounded-full bg-green-400"/>
                          <span className="text-[10px] font-semibold" style={{ color: 'var(--green)' }}>Зарег.</span>
                        </div>
                      )}
                      {isOrganizer && (
                        <button type="button" onClick={() => setTourneyStatus(t.id, 'finished')}
                          className="flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
                          style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
                          <Flag size={11}/> Завершить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
