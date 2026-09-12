/* ================================================================
   ПРОФИЛЬ АРТИСТА

   Профиль и подписчики живут на сервере: их видят все и с любого
   устройства. Раньше это был локальный список в браузере, где артист
   «набирал подписчиков», о которых никто не знал.

   Аватара и баннера здесь нет намеренно: отдельного хранилища картинок
   для артиста пока не заведено, а держать их строкой в браузере —
   значит показывать их только себе.
================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Music2, Headphones, Users, Mic2, Edit3, Check, Loader, Play} from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';
import {
  apiMyArtist, apiSaveArtist, apiFollowing, type ServerArtist,
} from './musicApi';
import type { Track } from '@/platform/store';

const YM = {
  card: 'var(--bg-l2)', border: 'var(--border)', accent: 'var(--accent)',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
};

const fmtPlays = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}М`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}К` : String(n));

const GENRES = ['Pop', 'Rock', 'Electronic', 'Hip-Hop', 'Jazz', 'Classical',
  'Ambient', 'Synthwave', 'Indie', 'Soul', 'R&B', 'Folk', 'Metal', 'Другое'];

/* ── Форма профиля ─────────────────────────────────────────────── */
const ArtistForm = ({ initial, onSaved, onCancel }: {
  initial: ServerArtist | null;
  onSaved: (a: ServerArtist) => void;
  onCancel?: () => void;
}) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [genres, setGenres] = useState<string[]>(initial?.genres ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    const res = await apiSaveArtist({ name: name.trim(), bio: bio.trim(), genres });
    setBusy(false);
    if (!res.ok || !res.artist) { setError(res.reason ?? 'Не получилось сохранить'); return; }
    onSaved(res.artist);
  };

  return (
    <div className="space-y-3 px-4 py-4">
      <input value={name} onChange={e => setName(e.target.value)} maxLength={120}
        placeholder="Псевдоним или название группы"
        className="w-full rounded-2xl px-3 py-2.5 text-sm outline-none"
        style={{ background: YM.card, border: `1px solid ${YM.border}`, color: YM.t1 }}/>
      <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={1000}
        placeholder="О себе"
        className="w-full resize-none rounded-2xl px-3 py-2.5 text-sm outline-none"
        style={{ background: YM.card, border: `1px solid ${YM.border}`, color: YM.t1 }}/>
      <div className="flex flex-wrap gap-1.5">
        {GENRES.map(g => {
          const on = genres.includes(g);
          return (
            <button key={g} type="button"
              onClick={() => setGenres(prev => on ? prev.filter(x => x !== g) : [...prev, g])}
              className="rounded-full px-3 py-1.5 text-[11.5px] font-medium"
              style={{ background: on ? YM.accent : 'var(--bg-l2)', color: on ? '#fff' : YM.t3,
                border: `1px solid ${on ? 'transparent' : YM.border}` }}>
              {g}
            </button>
          );
        })}
      </div>
      {error && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || name.trim().length < 2} onClick={() => void save()}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black disabled:opacity-40"
          style={{ background: YM.accent, color: '#fff' }}>
          {busy ? <><Loader size={15} className="animate-spin"/>Сохраняем…</> : <><Check size={15}/>Сохранить</>}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="rounded-2xl px-4 py-3 text-sm" style={{ background: YM.card, color: YM.t3 }}>
            Отмена
          </button>
        )}
      </div>
    </div>
  );
};

/* ── Вкладка «Артист» ──────────────────────────────────────────── */
export const MusicianProfileTab = ({
  playing, activeId, onPlay,
}: {
  playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void;
}) => {
  const tracks = useMusicStore(s => s.tracks);
  const [artist, setArtist] = useState<ServerArtist | null>(null);
  const [following, setFollowing] = useState<ServerArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, f] = await Promise.all([apiMyArtist(), apiFollowing()]);
    setArtist(a);
    setFollowing(f ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const myTracks = useMemo(
    () => tracks.filter(t => t.uploadedBy === 'me' && t.status === 'published'),
    [tracks],
  );
  const totalPlays = myTracks.reduce((s, t) => s + t.plays, 0);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm" style={{ color: YM.t3 }}>Загружаем профиль…</p>
      </div>
    );
  }

  /* ── Профиля ещё нет ── */
  if (!artist) {
    return (
      <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex flex-col items-center gap-4 px-8 pb-2 pt-10 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-3xl"
            style={{ background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.25)' }}>
            <Mic2 size={34} style={{ color: '#6366f1' }}/>
          </div>
          <div>
            <p className="text-lg font-black" style={{ color: YM.t1 }}>Профиль артиста</p>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: YM.t2 }}>
              Под этим именем ваши треки увидят в каталоге, а слушатели смогут
              на вас подписаться и узнавать о новых записях.
            </p>
          </div>
        </div>
        <ArtistForm initial={null} onSaved={(a) => { setArtist(a); setEditing(false); }}/>
      </div>
    );
  }

  /* ── Профиль есть ── */
  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      <div className="px-4 pt-5">
        <div className="flex items-start gap-3">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-black text-white"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            {artist.name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black" style={{ color: YM.t1 }}>{artist.name}</p>
            {artist.genres.length > 0 && (
              <p className="mt-0.5 text-[11px]" style={{ color: YM.t3 }}>{artist.genres.join(' · ')}</p>
            )}
          </div>
          <button type="button" onClick={() => setEditing(v => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
            style={{ background: 'var(--bg-l2)', color: YM.t2, border: `1px solid ${YM.border}` }}>
            <Edit3 size={11}/>{editing ? 'Закрыть' : 'Изменить'}
          </button>
        </div>
        {artist.bio && !editing && (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: YM.t2 }}>{artist.bio}</p>
        )}
      </div>

      {editing && (
        <ArtistForm initial={artist} onCancel={() => setEditing(false)}
          onSaved={(a) => { setArtist(a); setEditing(false); }}/>
      )}

      <div className="grid grid-cols-3 gap-2 px-4 pb-1 pt-4">
        {[
          { label: 'Треков', val: String(artist.tracks), icon: Music2, color: '#6366f1' },
          { label: 'Прослушиваний', val: fmtPlays(artist.plays || totalPlays), icon: Headphones, color: '#22d3ee' },
          { label: 'Подписчиков', val: String(artist.followers), icon: Users, color: '#f43f5e' },
        ].map(({ label, val, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl px-3 py-3 text-center"
            style={{ background: 'var(--bg-l2)', border: `1px solid ${YM.border}` }}>
            <Icon size={14} className="mx-auto mb-1.5" style={{ color }}/>
            <p className="text-base font-black" style={{ color: YM.t1 }}>{val}</p>
            <p className="mt-0.5 text-[9px]" style={{ color: YM.t3 }}>{label}</p>
          </div>
        ))}
      </div>

      <p className="px-4 pb-2 pt-5 text-[10px] font-black uppercase tracking-wider" style={{ color: YM.t3 }}>
        В каталоге
      </p>
      {myTracks.length === 0 ? (
        <p className="px-4 pb-4 text-[12.5px]" style={{ color: YM.t3 }}>
          Пока ничего не опубликовано. Загрузите трек и отправьте его на проверку —
          после неё он появится в каталоге.
        </p>
      ) : myTracks.map((t, i) => (
        <button key={t.id} type="button" onClick={() => onPlay(t, myTracks)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
          <span className="w-4 shrink-0 text-[11px] tabular-nums" style={{ color: YM.t3 }}>{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium"
              style={{ color: activeId === t.id ? YM.accent : YM.t1 }}>{t.title}</p>
            <p className="truncate text-[11px]" style={{ color: YM.t3 }}>
              {fmtPlays(t.plays)} прослушиваний
            </p>
          </div>
          <span className="shrink-0 text-[11px]" style={{ color: YM.t3 }}>
            {playing && activeId === t.id ? <Play size={11} fill="currentColor"/> : null}
          </span>
        </button>
      ))}

      <p className="px-4 pb-2 pt-5 text-[10px] font-black uppercase tracking-wider" style={{ color: YM.t3 }}>
        Мои подписки
      </p>
      {following.length === 0 ? (
        <p className="px-4 pb-10 text-[12.5px]" style={{ color: YM.t3 }}>
          Подписок пока нет. Откройте страницу исполнителя из строки трека — там есть «Подписаться».
        </p>
      ) : (
        <div className="pb-10">
          {following.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-black text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
                {a.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium" style={{ color: YM.t1 }}>{a.name}</p>
                <p className="text-[11px]" style={{ color: YM.t3 }}>{a.tracks} треков в каталоге</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}/>
    </div>
  );
};
