/**
 * Совместное прослушивание.
 *
 * Своего звука здесь нет. Ни <audio>, ни AudioContext, ни второго
 * движка: играет тот же единственный элемент, что и всегда, — из
 * PlayerEngine, через usePlayerStore. Поэтому «обычный плеер и плеер
 * сессии играют одновременно» — невозможное состояние: элемент один, и
 * поставить в него можно только одну запись.
 *
 * Отсюда только управляют:
 *   · какая запись открыта — через push в общий стор;
 *   · идёт или стоит — через requestPlay, тот же канал, которым
 *     пользуется мини-плеер;
 *   · где именно — через requestSeek.
 *
 * Позицию и скорость читаем и пишем у самого элемента по его
 * идентификатору. Это единственное место, где модуль трогает DOM, и на
 * то есть причина: стор сообщает время четыре раза в секунду, а
 * подстройка скорости в сторе не предусмотрена вовсе — она нужна только
 * здесь и обычному плееру не нужна.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Users, Play, Pause, SkipBack, SkipForward, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePlayerStore } from '@/player/playerStore';
import { apiTrack, apiMediaTicket, coverUrl, audioUrl } from '@/music/musicApi';
import { sendTogether, useTogetherStore, type PlayerHandle } from './togetherState';
import { useTogetherSync } from './useTogetherSync';
import type { TogetherSession } from './togetherApi';

const AUDIO_ID = 'sky-player-audio';
const audioEl = () => document.getElementById(AUDIO_ID) as HTMLAudioElement | null;

interface TrackInfo { id: string; title: string; artist: string; hasCover: boolean }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const ListenTogether = ({ session }: { session: TogetherSession }) => {
  const playback = useTogetherStore(s => s.playback);
  const push = usePlayerStore(s => s.push);
  const requestPlay = usePlayerStore(s => s.requestPlay);
  const requestSeek = usePlayerStore(s => s.requestSeek);

  /* Сведения о треках подгружаются по мере надобности и запоминаются:
     в очереди может быть двести записей, и тянуть их все сразу ради
     подписи под обложкой незачем. */
  const [known, setKnown] = useState<Record<string, TrackInfo>>({});
  const knownRef = useRef(known);
  knownRef.current = known;

  const idx = playback?.queueIndex ?? session.queueIndex;
  const queue = playback?.queue ?? session.queue;
  const currentId = queue[idx]?.id ?? null;
  const current = currentId ? known[currentId] : undefined;

  /* Пропуск для звука: тег <audio> не умеет слать заголовок
     авторизации, поэтому музыка выдаёт короткую куку. Просим её так же,
     как это делает обычный экран музыки. */
  useEffect(() => { void apiMediaTicket(); }, []);

  useEffect(() => {
    if (!currentId || knownRef.current[currentId]) return;
    let alive = true;
    void apiTrack(currentId).then((t) => {
      if (!alive || !t) return;
      setKnown(prev => ({ ...prev, [currentId]: {
        id: t.id, title: t.title, artist: t.artist, hasCover: t.hasCover,
      } }));
    });
    return () => { alive = false; };
  }, [currentId]);

  const handle: PlayerHandle = useMemo(() => ({
    position: () => (audioEl()?.currentTime ?? 0) * 1000,
    playing: () => { const a = audioEl(); return Boolean(a && !a.paused && !a.ended); },
    seek: (ms) => { requestSeek(ms / 1000); },
    play: () => requestPlay(true),
    pause: () => requestPlay(false),
    setRate: (r) => { const a = audioEl(); if (a) a.playbackRate = r; },
    currentId: () => {
      /* Что сейчас открыто, спрашиваем у стора, а не у элемента: в
         адресе файла есть кодирование, и сравнивать строки адресов
         было бы гаданием. */
      return usePlayerStore.getState().item?.id ?? null;
    },
    setTrack: (_i, id) => {
      const info = knownRef.current[id];
      push({
        id,
        kind: 'music',
        title: info?.title ?? 'Трек',
        author: info?.artist ?? '',
        coverUrl: info?.hasCover ? coverUrl(id) : undefined,
        srcUrl: audioUrl(id),
      });
    },
  }), [push, requestPlay, requestSeek]);

  useTogetherSync(session.id, handle, session.status === 'live');

  /* Уходя — гасим. Оставить чужую сессию играть в фоне значит забрать
     у человека его собственный плеер: элемент-то один. */
  useEffect(() => () => { usePlayerStore.getState().requestPlay(false); }, [session.id]);

  const can = session.canControl;
  const playing = playback?.playing ?? false;
  const pos = playback?.positionMs ?? 0;
  const dur = playback?.durationMs ?? 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  const cmd = (a: 'play' | 'pause' | 'next' | 'prev') => {
    if (!can) return;
    sendTogether(session.id, a);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="h-40 w-40 overflow-hidden rounded-xl grid place-items-center"
        style={{ background: 'var(--bg-l2)' }}>
        {current?.hasCover
          ? <img src={coverUrl(current.id)} alt="" className="h-full w-full object-cover" />
          : <div className="grid place-items-center" style={{ opacity: 0.3 }}><Music2 size={48} /></div>}
      </div>

      <div className="text-center">
        <p className="font-bold text-white text-lg">{current?.title ?? session.title}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--t3)' }}>
          {current?.artist || 'Слушаем вместе'}
          {queue.length > 1 && ` · ${idx + 1} из ${queue.length}`}
        </p>
      </div>

      {/* Полоса времени. Длительность приходит с сервера вместе с
          очередью — это настоящая длина записи, а не выдуманное число. */}
      <div className="w-full max-w-sm">
        <div className={`h-1.5 w-full overflow-hidden rounded-full ${can ? 'cursor-pointer' : ''}`}
          style={{ background: 'rgba(255,255,255,0.1)' }}
          onClick={(e) => {
            if (!can || dur <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            const part = (e.clientX - r.left) / r.width;
            sendTogether(session.id, 'seek', { positionMs: Math.round(part * dur) });
          }}>
          <motion.div className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg,var(--accent),#818cf8)', width: `${pct}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs" style={{ color: 'var(--t3)' }}>{fmt(pos)}</span>
          <span className="text-xs" style={{ color: 'var(--t3)' }}>{dur > 0 ? fmt(dur) : '--:--'}</span>
        </div>
      </div>

      {can ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => cmd('prev')} disabled={idx <= 0}
            className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
            style={{ background: 'var(--border)', color: 'var(--t1)' }}>
            <SkipBack size={16} />
          </button>
          <motion.button whileTap={{ scale: 0.9 }} type="button"
            onClick={() => cmd(playing ? 'pause' : 'play')}
            className="grid h-12 w-12 place-items-center rounded-full"
            style={{ background: 'var(--accent)' }}>
            {playing ? <Pause size={20} className="text-white" />
                     : <Play size={20} className="text-white ml-0.5" />}
          </motion.button>
          <button type="button" onClick={() => cmd('next')} disabled={idx >= queue.length - 1}
            className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
            style={{ background: 'var(--border)', color: 'var(--t1)' }}>
            <SkipForward size={16} />
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--t3)' }}>
          <Lock size={12} /> Воспроизведением управляет владелец
        </p>
      )}

      <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>
        <Users size={11} /> Звук идёт через обычный плеер Sky Music — второго не запускается
      </p>
    </div>
  );
};
