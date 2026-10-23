/** Админка → «Музыканты»: лейблы и альбомы (владелец сервиса и сотрудники `content`), заявки правообладателей, правка любой карточки. */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { CardImageEditor } from '@/artists/CardImages';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const ERR: Record<string, string> = { reason_required: 'Укажите причину (не короче 5 знаков).', not_allowed: 'Недостаточно прав.', self_review: 'Нельзя решать собственную заявку.', not_pending: 'Заявка уже решена.', exists: 'Такое название занято.', not_found: 'Не найдено.' };
const J = (o: unknown) => JSON.stringify(o);
interface L { id: string; name: string; description?: string; ownerId?: string; rightsVerified: boolean; rightsHolder?: string; albums: number }
interface A { id: string; title: string; year?: number; cardName?: string; labelName?: string; tracks: number }
interface R { id: string; kind: 'card' | 'label'; subjectId: string; subjectName: string; username: string; holder: string; note: string; links: string[] }

export const MusicLabelsAdmin = ({ reason }: { reason: string }) => {
  const [q, setQ] = useState(''); const [data, setData] = useState<{ labels: L[]; albums: A[] } | null>(null); const [rights, setRights] = useState<R[]>([]);
  const [cardId, setCardId] = useState(''); const [bio, setBio] = useState('');
  const [card, setCard] = useState<{ id: string; name: string; hasPhoto?: boolean; hasBanner?: boolean; hasCutout?: boolean } | null>(null);
  const openCard = useCallback(async () => { const r = await apiCall<{ card: NonNullable<typeof card> & { bio?: string } }>(`/api/music/artist-cards/${cardId.trim()}`); if (!r.ok) { setCard(null); return flash(ERR[r.error ?? ''] ?? 'Карточка не найдена'); } setCard(r.data!.card); setBio(r.data!.card.bio ?? ''); }, [cardId]);
  const load = useCallback(async () => {
    const [o, r] = await Promise.all([apiCall<{ labels: L[]; albums: A[] }>(`/api/admin/music-labels?q=${encodeURIComponent(q)}`), apiCall<{ items: R[] }>('/api/admin/music-rights?status=pending')]);
    setData(o.ok ? o.data! : { labels: [], albums: [] }); setRights(r.ok ? r.data!.items : []);
  }, [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const done = (r: { ok: boolean; error?: string }, okText = 'Готово') => { flash(r.ok ? okText : (ERR[r.error ?? ''] ?? 'Не получилось')); if (r.ok) void load(); };
  const decide = async (id: string, approve: boolean) => done(await apiCall(`/api/admin/music-rights/${id}/decide`, { method: 'POST', body: J({ approve, reason }) }));
  const revoke = async (kind: string, subjectId: string) => done(await apiCall('/api/admin/music-rights/revoke', { method: 'POST', body: J({ kind, subjectId, reason }) }), 'Подтверждение снято');
  const renameLabel = async (l: L) => { const n = window.prompt('Новое название лейбла', l.name); if (n && n !== l.name) done(await apiCall(`/api/music/labels/${l.id}`, { method: 'PATCH', body: J({ name: n }) })); };
  const delLabel = async (l: L) => { if (window.confirm(`Удалить лейбл «${l.name}»?`)) done(await apiCall(`/api/music/labels/${l.id}`, { method: 'DELETE' })); };
  const renameAlbum = async (a: A) => { const n = window.prompt('Новое название альбома', a.title); if (n && n !== a.title) done(await apiCall(`/api/music/albums/${a.id}`, { method: 'PATCH', body: J({ title: n }) })); };
  const delAlbum = async (a: A) => { if (window.confirm(`Удалить альбом «${a.title}»? Треки останутся.`)) done(await apiCall(`/api/music/albums/${a.id}`, { method: 'DELETE' })); };
  const saveCard = async () => done(await apiCall(`/api/music/artist-cards/${cardId.trim()}`, { method: 'PATCH', body: J({ bio }) }), 'Карточка обновлена');
  const btn = 'rounded-lg px-2.5 py-1 text-[11px] font-bold';
  return (
    <section className="space-y-3">
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Лейблы, альбомы и права правообладателей</p>
      <div className="space-y-2">
        <p className="text-[12px] font-semibold" style={{ color: C.t2 }}>{`Заявки на подтверждение прав (${rights.length})`}</p>
        {rights.map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{r.subjectName} <span className="font-normal" style={{ color: C.t3 }}>({r.kind === 'card' ? 'карточка' : 'лейбл'}, @{r.username})</span></p>
            <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{`Правообладатель: ${r.holder}`}</p>
            <p className="whitespace-pre-wrap text-[12.5px]" style={{ color: C.t2 }} translate="no">{r.note}</p>
            {r.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="block text-[12px] underline" style={{ color: C.acc }}>{l}</a>)}
            <div className="flex gap-2"><button type="button" onClick={() => void decide(r.id, true)} className={btn + ' text-white'} style={{ background: C.acc }}>Подтвердить</button>
              <button type="button" onClick={() => void decide(r.id, false)} className={btn + ' text-white'} style={{ background: C.red }}>Отклонить</button></div>
          </div>))}
        {!rights.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>Заявок нет</p>}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск лейбла или альбома" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
      {!data ? <p className="text-[12px]" style={{ color: C.t3 }}>Загрузка…</p> : (<>
        <p className="text-[12px] font-semibold" style={{ color: C.t2 }}>{`Лейблы (${data.labels.length})`}</p>
        {data.labels.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="min-w-0 flex-1 text-[13px]" style={{ color: C.t1 }} translate="no">{l.name} <span style={{ color: C.t3 }}>· {l.albums}</span>{l.rightsVerified ? <span style={{ color: C.acc }}>{` ✓ ${l.rightsHolder ?? ''}`}</span> : ''}</p>
            <button type="button" onClick={() => void renameLabel(l)} className={btn} style={{ background: C.l2, color: C.t1 }}>Изменить</button>
            {l.rightsVerified && <button type="button" onClick={() => void revoke('label', l.id)} className={btn} style={{ background: C.l2, color: C.t1 }}>Снять права</button>}
            <button type="button" onClick={() => void delLabel(l)} className={btn} style={{ background: C.l2, color: C.red }}>Удалить</button>
          </div>))}
        <p className="text-[12px] font-semibold" style={{ color: C.t2 }}>{`Альбомы (${data.albums.length})`}</p>
        {data.albums.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="min-w-0 flex-1 text-[13px]" style={{ color: C.t1 }} translate="no">{a.title}{a.year ? ` · ${a.year}` : ''} <span style={{ color: C.t3 }}>{[a.cardName, a.labelName].filter(Boolean).join(' · ')} · {a.tracks}</span></p>
            <button type="button" onClick={() => void renameAlbum(a)} className={btn} style={{ background: C.l2, color: C.t1 }}>Изменить</button>
            <button type="button" onClick={() => void delAlbum(a)} className={btn} style={{ background: C.l2, color: C.red }}>Удалить</button>
          </div>))}
      </>)}
      <div className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[12px] font-semibold" style={{ color: C.t2 }}>Править карточку музыканта (владелец сервиса)</p>
        <input value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="Идентификатор карточки (acd-…)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Новое описание" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
        <button type="button" disabled={!cardId.trim()} onClick={() => void openCard()} className={btn + ' disabled:opacity-50'} style={{ background: C.l2, color: C.t1 }}>Открыть карточку</button>
        {card && <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{card.name}</p>}
        {card && <CardImageEditor cardId={card.id} hasPhoto={Boolean(card.hasPhoto)} hasBanner={Boolean(card.hasBanner)} hasCutout={Boolean(card.hasCutout)} onChanged={() => void openCard()} />}
        <div className="flex gap-2"><button type="button" disabled={!cardId.trim()} onClick={() => void saveCard()} className={btn + ' text-white disabled:opacity-50'} style={{ background: C.acc }}>Сохранить</button>
          <button type="button" disabled={!cardId.trim()} onClick={() => void revoke('card', cardId.trim())} className={btn + ' disabled:opacity-50'} style={{ background: C.l2, color: C.t1 }}>Снять подтверждение прав</button></div>
      </div>
    </section>
  );
};
