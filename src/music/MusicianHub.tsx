/* ===============================================================
   МУЗЫКАНТЫ

   Витрина артистов. Раньше здесь был каталог из localStorage: человек
   видел только те профили, которые завели в этом же браузере, и
   подписывался в пустоту. Теперь список приходит с сервера — это те,
   у кого есть опубликованные треки, — и подписка видна обеим сторонам.

   Свой профиль артиста и статистика — во вкладке «Артист» в Sky Music.
=============================================================== */
import { useEffect, useState } from 'react';
import { Mic2, Users, Music2, UserPlus, UserMinus } from 'lucide-react';
import { apiArtists, apiFollowArtist, type ServerArtist } from './musicApi';

const C = {
  bg: 'var(--bg)', card: 'var(--bg-l2)', border: 'var(--border)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)',
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}М`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}К` : String(n));

export const MusicianHub = () => {
  const [artists, setArtists] = useState<ServerArtist[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void apiArtists().then(setArtists); }, []);

  const toggle = async (a: ServerArtist) => {
    setBusy(a.id);
    const fresh = await apiFollowArtist(a.id, !a.following);
    setBusy(null);
    if (fresh) setArtists(prev => (prev ?? []).map(x => (x.id === fresh.id ? fresh : x)));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>
      <div className="shrink-0 px-4 pb-3 pt-4">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Музыканты Sky</p>
        <p className="mt-0.5 text-xs" style={{ color: C.t3 }}>
          Те, чьи треки уже в каталоге. Свой профиль — в Sky Music, вкладка «Артист».
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: 'none' }}>
        {artists === null && (
          <p className="py-10 text-center text-[13px]" style={{ color: C.t3 }}>Загружаем…</p>
        )}
        {artists?.length === 0 && (
          <p className="py-10 text-center text-[13px]" style={{ color: C.t3 }}>
            Пока никто не выложил музыку в каталог
          </p>
        )}
        {(artists ?? []).map(a => (
          <div key={a.id} className="mb-2 flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-black text-white"
              style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
              {a.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold" style={{ color: C.t1 }}>{a.name}</p>
              <p className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: C.t3 }}>
                <span className="flex items-center gap-1"><Music2 size={10}/>{a.tracks}</span>
                <span className="flex items-center gap-1"><Users size={10}/>{fmt(a.followers)}</span>
              </p>
            </div>
            {!a.own && (
              <button type="button" disabled={busy === a.id} onClick={() => void toggle(a)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-50"
                style={{ background: a.following ? 'var(--bg-l3)' : C.accent,
                  color: a.following ? C.t2 : '#fff',
                  border: `1px solid ${a.following ? C.border : 'transparent'}` }}>
                {a.following ? <><UserMinus size={11}/>Вы подписаны</> : <><UserPlus size={11}/>Подписаться</>}
              </button>
            )}
            {a.own && (
              <span className="shrink-0 rounded-xl px-3 py-1.5 text-[11px]"
                style={{ background: 'rgba(255,255,255,0.05)', color: C.t3 }}>
                <Mic2 size={11} className="inline"/> это вы
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
