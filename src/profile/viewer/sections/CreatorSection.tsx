/** Авторская часть основного профиля Sky (Sky Media): работы по направлениям, подписчики, прослушивания и просмотры.
 *  Это не отдельный профиль: данные берутся по тому же id, видимость — настройки профиля («Авторское: …»). */
import { useCallback, useEffect, useState } from 'react';
import { Music2, Clapperboard, Mic2, BookOpen, Play, Disc3, ListMusic, Bell, UserPlus } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { apiTrack, apiPlaylist, toClientTrack } from '@/music/musicApi';
import { playMusicQueue } from '@/music/useMusicSync';
import { apiToggleFollow } from '../followsApi';
import type { ProfileData } from '../useProfileData';
import { BlockedBanner, MyRestrictionsPanel, type PublicRestriction } from '@/media/restrictions';

type Dir = 'music' | 'film' | 'podcasts' | 'books';
type Blk = { blocked?: PublicRestriction };
interface Creator {
  own: boolean; followers: number; hasWorks: boolean; totals?: { plays: number; views: number };
  directions: {
    music?: Blk & { count: number; plays: number; tracks: { id: string; title: string; artist: string; plays: number; status: string }[]; albums: { id: string; title: string; year?: number; tracks: number }[]; playlists: { id: string; name: string; count: number }[] };
    film?: Blk & { count: number; seriesCount: number; views: number; films: { id: string; title: string; year?: number; views: number; status: string }[]; series: { id: string; title: string; episodes: number; views: number; status: string }[] };
    podcasts?: Blk & { count: number; plays: number; items: { id: string; title: string; episodes: number; plays: number; status: string }[] };
    books?: Blk & { count: number; items: { id: string; title: string; status: string }[] };
  };
}
const card = { background: 'var(--profile-card-bg, var(--bg-l2))', border: '1px solid var(--profile-card-border, var(--border))' } as const;
const TABS: { k: Dir; label: string; Icon: typeof Music2 }[] = [
  { k: 'music', label: 'Музыка', Icon: Music2 }, { k: 'film', label: 'Кино', Icon: Clapperboard },
  { k: 'podcasts', label: 'Подкасты', Icon: Mic2 }, { k: 'books', label: 'Книги', Icon: BookOpen },
];
const nf = (n: number) => n.toLocaleString('ru-RU');
const Row = ({ icon, title, sub, onClick, tag }: { icon: React.ReactNode; title: string; sub?: string; onClick?: () => void; tag?: string }) => (
  <button type="button" disabled={!onClick} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left" style={{ background: 'var(--bg-l3)', cursor: onClick ? 'pointer' : 'default' }}>
    <span style={{ color: 'var(--accent)' }}>{icon}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{title}</span>{sub && <span className="block truncate text-[11px]" style={{ color: 'var(--t3)' }}>{sub}</span>}</span>
    {tag && <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{tag}</span>}
  </button>);

export const CreatorSection = ({ data }: { data: ProfileData }) => {
  const [c, setC] = useState<Creator | null>(null);
  const [tab, setTab] = useState<Dir | null>(null);
  const [following, setFollowing] = useState(data.relationship.isFollowing);
  const load = useCallback(async () => { const r = await apiCall<Creator>(`/api/creators/${encodeURIComponent(data.userId)}`); setC(r.ok ? r.data! : null); }, [data.userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setFollowing(data.relationship.isFollowing), [data.relationship.isFollowing]);
  if (!c) return null;
  const present = TABS.filter((t) => c.directions[t.k]);
  const shown = present.filter((t) => { const d = c.directions[t.k]!; return c.own || ('count' in d && d.count > 0); });
  if (!c.own && !c.hasWorks) return null;
  const cur: Dir | null = tab && shown.some((t) => t.k === tab) ? tab : shown[0]?.k ?? null;

  const follow = async () => {
    const r = await apiToggleFollow(data.userId);
    if (!r) return flash('Не удалось изменить подписку');
    setFollowing(r.following); setC((p) => p && { ...p, followers: Math.max(0, p.followers + (r.following ? 1 : -1)) });
  };
  const play = async (ids: string[], id: string) => {
    const pool = (await Promise.all(ids.map((x) => apiTrack(x)))).filter(Boolean).map((t) => toClientTrack(t!));
    if (pool.length) playMusicQueue(pool, id);
  };
  const playList = async (id: string) => {
    const p = await apiPlaylist(id); const tr = (p?.tracks ?? []).map(toClientTrack);
    if (!tr.length) return flash('В плейлисте нет треков'); playMusicQueue(tr, tr[0].id);
  };
  const m = c.directions.music, f = c.directions.film, p = c.directions.podcasts, b = c.directions.books;
  return (
    <div className="space-y-3 rounded-[28px] p-4" style={card}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm font-black" style={{ color: 'var(--t1)' }}>Автор</p>
        {!c.own && (
          <button type="button" onClick={() => void follow()} className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold"
            style={{ background: following ? 'var(--bg-l3)' : 'var(--accent)', color: following ? 'var(--accent)' : '#fff' }}>
            {following ? <Bell size={13} /> : <UserPlus size={13} />}{following ? 'Вы подписаны' : 'Подписаться'}
          </button>)}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl py-2" style={{ background: 'var(--bg-l3)' }}><p className="text-[16px] font-black" style={{ color: 'var(--t1)' }}>{nf(c.followers)}</p><p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>Подписчики</p></div>
        {c.totals && <>
          <div className="rounded-2xl py-2" style={{ background: 'var(--bg-l3)' }}><p className="text-[16px] font-black" style={{ color: 'var(--t1)' }}>{nf(c.totals.plays)}</p><p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>Прослушивания</p></div>
          <div className="rounded-2xl py-2" style={{ background: 'var(--bg-l3)' }}><p className="text-[16px] font-black" style={{ color: 'var(--t1)' }}>{nf(c.totals.views)}</p><p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>Просмотры</p></div>
        </>}
      </div>
      {shown.length > 0 && (
        <div className="glass-pill flex gap-1 p-1" role="tablist">
          {shown.map(({ k, label, Icon }) => (
            <button key={k} type="button" role="tab" aria-selected={cur === k} onClick={() => setTab(k)} className="relative isolate flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] font-bold"
              style={{ color: cur === k ? 'var(--t1)' : 'var(--t3)' }}>
              {cur === k && <span className="glass-lens absolute inset-0 -z-10 rounded-full" />}<Icon size={13} />{label}
            </button>))}
        </div>)}
      {c.own && <MyRestrictionsPanel />}
      {cur && c.directions[cur]?.blocked && <BlockedBanner r={c.directions[cur]!.blocked!} />}
      <div className="space-y-1.5">
        {cur === 'music' && m && <>
          {m.tracks.map((t) => <Row key={t.id} icon={<Play size={14} />} title={t.title} sub={`${t.artist} · ${nf(t.plays)} прослуш.`} tag={(t as { blocked?: boolean }).blocked ? 'ограничено' : t.status !== 'published' ? 'только вы' : undefined} onClick={() => void play(m.tracks.map((x) => x.id), t.id)} />)}
          {m.albums.map((a) => <Row key={a.id} icon={<Disc3 size={14} />} title={a.title} sub={`Альбом · ${a.tracks} трек.${a.year ? ` · ${a.year}` : ''}`} />)}
          {m.playlists.map((l) => <Row key={l.id} icon={<ListMusic size={14} />} title={l.name} sub={`Подборка · ${l.count}`} onClick={() => void playList(l.id)} />)}
          {!m.tracks.length && c.own && <p className="text-xs" style={{ color: 'var(--t3)' }}>Музыка появится здесь, когда на вашей карточке музыканта будут опубликованные треки.</p>}
        </>}
        {cur === 'film' && f && <>
          {f.films.map((x) => <Row key={x.id} icon={<Clapperboard size={14} />} title={x.title} sub={`${x.year ? `${x.year} · ` : ''}${nf(x.views)} просм.`} tag={x.status !== 'published' ? 'только вы' : undefined} />)}
          {f.series.map((x) => <Row key={x.id} icon={<Clapperboard size={14} />} title={x.title} sub={`Сериал · ${x.episodes} сер. · ${nf(x.views)} просм.`} tag={x.status !== 'published' ? 'только вы' : undefined} />)}
          {!f.films.length && !f.series.length && c.own && <p className="text-xs" style={{ color: 'var(--t3)' }}>Опубликуйте фильм или сериал в Студии.</p>}
        </>}
        {cur === 'podcasts' && p && <>
          {p.items.map((x) => <Row key={x.id} icon={<Mic2 size={14} />} title={x.title} sub={`${x.episodes} вып. · ${nf(x.plays)} прослуш.`} tag={x.status !== 'published' ? 'только вы' : undefined} />)}
          {!p.items.length && c.own && <p className="text-xs" style={{ color: 'var(--t3)' }}>Создайте подкаст в Студии.</p>}
        </>}
        {cur === 'books' && b && <>
          {b.items.map((x) => <Row key={x.id} icon={<BookOpen size={14} />} title={x.title} tag={x.status !== 'published' ? 'только вы' : undefined} />)}
          {!b.items.length && c.own && <p className="text-xs" style={{ color: 'var(--t3)' }}>Добавьте книгу в Студии.</p>}
        </>}
      </div>
    </div>
  );
};
