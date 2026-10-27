import React, { useCallback, useEffect, useState } from 'react';
import { Users, Play } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { toClientTrack, type ServerTrack } from './musicApi';
import { hideExplicitOn } from '@/labels/hideExplicit';
import { visibleTick } from '@/shared/visibleTick';
import type { Track } from './types';

interface Duo { id: string; status: 'pending' | 'active'; incoming: boolean; partner: { id: string; username: string; name: string } | null }
interface Friend { id: string; username: string; name: string }
type QTrack = Track & { reason?: string };

/** Карточка «Поток на двоих» на главной Sky Music: приглашение друга, принятие, общая очередь из музыки, которая нравится обоим. */
export const DuoCard = ({ onPlay }: { onPlay: (t: Track, pool: Track[]) => void }) => {
  const [duos, setDuos] = useState<Duo[] | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [queue, setQueue] = useState<{ id: string; tracks: QTrack[]; note?: string; partnerName: string } | null>(null);
  const [msg, setMsg] = useState(''); const [open, setOpen] = useState(false);

  const load = useCallback(async () => { const r = await apiCall<{ duos: Duo[] }>('/api/music/duo'); if (r.ok) setDuos(r.data?.duos ?? []); }, []);
  useEffect(() => { void load(); const t = window.setInterval(visibleTick(() => void load()), 30000); return () => window.clearInterval(t); }, [load]);

  const pick = async () => { setOpen(true); if (!friends) { const r = await apiCall<{ friends: Friend[] }>('/api/music/duo/friends'); setFriends(r.ok ? r.data?.friends ?? [] : []); } };
  const invite = async (f: Friend) => {
    const r = await apiCall<{ error?: string }>('/api/music/duo', { method: 'POST', body: JSON.stringify({ friendId: f.id }) });
    setMsg(r.ok ? `Приглашение отправлено: ${f.name}` : r.status === 409 ? 'Приглашение этому человеку уже есть' : 'Не удалось отправить приглашение'); setOpen(false); void load();
  };
  const act = async (id: string, a: 'accept' | 'decline' | 'end') => {
    if (a === 'end' && !window.confirm('Завершить поток на двоих? Избранное друга больше не будет учитываться.')) return;
    await apiCall(`/api/music/duo/${id}/${a}`, { method: 'POST', body: '{}' }); setQueue(null); void load();
  };
  const play = async (d: Duo) => {
    setMsg('');
    const r = await apiCall<{ tracks: ServerTrack[]; note?: string; partner: { name: string } | null }>(`/api/music/duo/${d.id}/queue${hideExplicitOn() ? '?hideExplicit=1' : ''}`);
    if (!r.ok || !r.data) { setMsg('Не удалось собрать поток'); return; }
    const tracks: QTrack[] = r.data.tracks.map((t) => ({ ...toClientTrack(t), reason: (t as unknown as { reason?: string }).reason }));
    setQueue({ id: d.id, tracks, note: r.data.note, partnerName: r.data.partner?.name ?? '' });
    if (tracks.length) onPlay(tracks[0], tracks);
  };

  if (duos === null) return null;
  return (
    <section className="mx-5 mb-6 rounded-3xl border p-4" style={{ borderColor: 'rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)' }} aria-label="Поток на двоих">
      <div className="mb-2 flex items-center gap-2"><Users size={18} style={{ color: '#c4b5fd' }} /><h3 className="flex-1 text-[16px] font-bold" style={{ color: '#fff' }}>Поток на двоих</h3>
        {duos.length < 5 && <button type="button" onClick={() => void pick()} className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: '#a78bfa', color: '#111' }}>Позвать друга</button>}</div>
      {duos.length === 0 && <p className="text-[12px]" style={{ color: '#9aa1b2' }}>Пригласите друга — получится общий поток из музыки, которая нравится вам обоим. Друг видит только результат; пока он не принял приглашение, его вкус не используется.</p>}
      {msg && <p role="status" className="mb-2 text-[12px]" style={{ color: '#c7ccd6' }}>{msg}</p>}
      {duos.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]" style={{ color: '#e5e7eb' }}>
          <span className="min-w-0 flex-1 truncate" translate="no">{d.partner?.name ?? '—'}</span>
          {d.status === 'pending' && d.incoming && <><button type="button" onClick={() => void act(d.id, 'accept')} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: '#a78bfa', color: '#111' }}>Принять</button><button type="button" onClick={() => void act(d.id, 'decline')} className="text-[12px] underline">Отклонить</button></>}
          {d.status === 'pending' && !d.incoming && <><span className="text-[12px]" style={{ color: '#9aa1b2' }}>Ждём ответа</span><button type="button" onClick={() => void act(d.id, 'decline')} className="text-[12px] underline">Отозвать</button></>}
          {d.status === 'active' && <><button type="button" onClick={() => void play(d)} className="flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: '#a78bfa', color: '#111' }}><Play size={12} /> Слушать</button><button type="button" onClick={() => void act(d.id, 'end')} className="text-[12px] underline">Завершить</button></>}
        </div>))}
      {queue && (
        <div className="mt-2">
          {queue.note && <p className="text-[12px]" style={{ color: '#9aa1b2' }}>{queue.note}</p>}
          {queue.tracks.slice(0, 8).map((t) => (
            <button key={t.id} type="button" onClick={() => onPlay(t, queue.tracks)} className="block w-full truncate py-1 text-left text-[13px]" style={{ color: '#e5e7eb' }}>
              <span translate="no">{t.title} · {t.artist}</span>{t.reason && <span className="ml-2 text-[11px]" style={{ color: '#9aa1b2' }}>{t.reason}</span>}
            </button>))}
        </div>)}
      {open && (
        <div role="dialog" aria-label="Выберите друга" className="mt-2 max-h-56 overflow-y-auto rounded-2xl border p-2" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
          {friends === null ? <p className="p-2 text-[12px]" style={{ color: '#9aa1b2' }}>Загрузка…</p> : friends.length === 0 ? <p className="p-2 text-[12px]" style={{ color: '#9aa1b2' }}>Пока нет друзей — добавьте кого-нибудь в друзья.</p>
            : friends.map((f) => <button key={f.id} type="button" onClick={() => void invite(f)} className="block w-full truncate rounded-xl px-3 py-2 text-left text-[13px] hover:bg-white/10" style={{ color: '#fff' }} translate="no">{f.name} <span style={{ color: '#9aa1b2' }}>@{f.username}</span></button>)}
          <button type="button" onClick={() => setOpen(false)} className="mt-1 px-3 py-1 text-[12px] underline" style={{ color: '#9aa1b2' }}>Закрыть</button>
        </div>)}
    </section>
  );
};
