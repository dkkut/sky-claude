/** Музыка в профиле: избранные песни и плейлисты. Свои — выбираются здесь же; чужие видны, если человек не скрыл раздел (и нет исключения для вас). */
import { useCallback, useEffect, useState } from 'react';
import { Music2, Play, Pencil, ListMusic, Check } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { apiTrack, apiPlaylist, apiTracks, apiPlaylists, toClientTrack } from '@/music/musicApi';
import { playMusicQueue } from '@/music/useMusicSync';
import type { ProfileData } from '../useProfileData';

interface PT { id: string; title: string; artist: string; duration?: number; status?: string }
interface PP { id: string; name: string; isPublic?: boolean; count: number }
const card = { background: 'var(--profile-card-bg, var(--bg-l2))', border: '1px solid var(--profile-card-border, var(--border))' } as const;

export const MusicSection = ({ data }: { data: ProfileData }) => {
  const [m, setM] = useState<{ hidden: boolean; tracks: PT[]; playlists: PP[] } | null>(null);
  const [edit, setEdit] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<NonNullable<typeof m>>(`/api/profile-music/${encodeURIComponent(data.userId)}`); setM(r.ok ? r.data! : null); }, [data.userId]);
  useEffect(() => { void load(); }, [load]);
  if (!m || m.hidden) return null;
  if (!data.isOwn && !m.tracks.length && !m.playlists.length) return null;

  const play = async (id: string) => {
    const pool = (await Promise.all(m.tracks.map((t) => apiTrack(t.id)))).filter(Boolean).map((t) => toClientTrack(t!));
    if (pool.length) playMusicQueue(pool, id);
  };
  const playList = async (id: string) => {
    const p = await apiPlaylist(id); const tr = (p?.tracks ?? []).map(toClientTrack);
    if (!tr.length) return flash('В плейлисте нет треков');
    playMusicQueue(tr, tr[0].id);
  };
  return (
    <div className="space-y-2 rounded-[28px] p-4" style={card}>
      <div className="flex items-center gap-2">
        <Music2 size={16} style={{ color: 'var(--accent)' }} />
        <p className="flex-1 text-sm font-black" style={{ color: 'var(--t1)' }}>Музыка</p>
        {data.isOwn && <button type="button" onClick={() => setEdit(true)} aria-label="Изменить музыку в профиле" className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l3)' }}><Pencil size={14} style={{ color: 'var(--t2)' }} /></button>}
      </div>
      {m.tracks.map((t) => (
        <button key={t.id} type="button" onClick={() => void play(t.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left" style={{ background: 'var(--bg-l3)' }}>
          <Play size={14} style={{ color: 'var(--accent)' }} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{t.title}</span><span className="block truncate text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{t.artist}</span></span>
          {t.status && t.status !== 'published' && <span className="text-[10px]" style={{ color: 'var(--t3)' }}>только вы</span>}
        </button>))}
      {m.playlists.map((p) => (
        <button key={p.id} type="button" onClick={() => void playList(p.id)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left" style={{ background: 'var(--bg-l3)' }}>
          <ListMusic size={14} style={{ color: 'var(--accent)' }} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{p.name}</span>
          <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{p.count}</span>
        </button>))}
      {!m.tracks.length && !m.playlists.length && <p className="text-xs" style={{ color: 'var(--t3)' }}>Выберите песни и плейлисты, которые увидят в вашем профиле.</p>}
      {edit && <Picker current={m} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} />}
    </div>
  );
};

const Picker = ({ current, onClose, onSaved }: { current: { tracks: PT[]; playlists: PP[] }; onClose: () => void; onSaved: () => void }) => {
  const [tracks, setTracks] = useState<{ id: string; title: string; artist: string }[]>([]); const [lists, setLists] = useState<{ id: string; name: string; isPublic?: boolean }[]>([]);
  const [selT, setSelT] = useState(current.tracks.map((t) => t.id)); const [selP, setSelP] = useState(current.playlists.map((p) => p.id));
  useEffect(() => {
    void (async () => {
      const [mine, fav, pls] = await Promise.all([apiTracks({ mine: true, limit: 100 }), apiCall<{ tracks: { id: string; title: string; artist: string }[] }>('/api/music/favorites'), apiPlaylists()]);
      const seen = new Map<string, { id: string; title: string; artist: string }>();
      for (const t of [...(mine ?? []), ...(fav.ok ? fav.data!.tracks ?? [] : []), ...current.tracks]) seen.set(t.id, { id: t.id, title: t.title, artist: t.artist });
      setTracks([...seen.values()]); setLists((pls ?? []) as { id: string; name: string; isPublic?: boolean }[]);
    })();
  }, [current.tracks]);
  const tog = (arr: string[], id: string, set: (v: string[]) => void, max: number) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id].slice(0, max));
  const save = async () => { const r = await apiCall('/api/profile-music', { method: 'PUT', body: JSON.stringify({ tracks: selT, playlists: selP }) }); if (!r.ok) return flash('Не удалось сохранить'); flash('Сохранено'); onSaved(); };
  const row = (on: boolean, label: string, sub: string, f: () => void) => (
    <button type="button" onClick={f} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left" style={{ background: on ? 'rgba(99,102,241,0.25)' : 'var(--bg-l3)' }}>
      <span className="grid h-5 w-5 place-items-center rounded-md" style={{ background: on ? 'var(--accent)' : 'var(--bg-l2)' }}>{on && <Check size={11} color="#fff" />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{label}</span><span className="block truncate text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{sub}</span></span>
    </button>);
  return (
    <div className="fixed inset-0 z-[10040] flex flex-col" style={{ background: 'var(--bg)', paddingTop: 'var(--safe-top)' }}>
      <div className="flex items-center gap-2 px-4 py-3">
        <p className="flex-1 text-base font-black" style={{ color: 'var(--t1)' }}>Музыка в профиле</p>
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>Отмена</button>
        <button type="button" onClick={() => void save()} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>Сохранить</button>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-10">
        <p className="text-[11px] font-bold uppercase" style={{ color: 'var(--t3)' }}>{`Песни (${selT.length}/30)`}</p>
        {tracks.map((t) => row(selT.includes(t.id), t.title, t.artist, () => tog(selT, t.id, setSelT, 30)))}
        {!tracks.length && <p className="text-xs" style={{ color: 'var(--t3)' }}>Своих и избранных песен пока нет.</p>}
        <p className="pt-3 text-[11px] font-bold uppercase" style={{ color: 'var(--t3)' }}>{`Плейлисты (${selP.length}/10)`}</p>
        {lists.map((p) => row(selP.includes(p.id), p.name, p.isPublic ? 'Публичный' : 'Закрытый — другие его не увидят', () => tog(selP, p.id, setSelP, 10)))}
        {!lists.length && <p className="text-xs" style={{ color: 'var(--t3)' }}>Плейлистов пока нет.</p>}
        <p className="pt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Другие люди видят только опубликованные песни и публичные плейлисты. Раздел можно скрыть целиком или для отдельных людей в «Конфиденциальности».</p>
      </div>
    </div>
  );
};
