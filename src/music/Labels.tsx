/** Лейблы, альбомы и подтверждение прав правообладателя (Sky Music). Сервер — server/musiclabels.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, BadgeCheck, Trash2, Plus } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { useMusicStore } from './serverStore';

const C = { bg: 'var(--bg)', card: 'var(--bg-l2)', border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)', red: 'var(--red)' };
const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
const inpSt = { background: 'var(--bg-l3)', border: `1px solid ${C.border}`, color: C.t1 } as const;
const ERR: Record<string, string> = {
  name_required: 'Введите название (от 2 знаков).', exists: 'Такое название уже занято.', title_required: 'Введите название альбома.', bad_year: 'Год от 1900 до 2100.',
  card_not_yours: 'Эта карточка вам не принадлежит.', label_not_yours: 'Этот лейбл вам не принадлежит.', not_allowed: 'Нет прав на это действие.', holder_required: 'Укажите правообладателя.',
  note_required: 'Опишите основание (от 10 знаков).', already_pending: 'Заявка уже на проверке.', already_verified: 'Права уже подтверждены.', no_tracks: 'Выберите треки.', prime_required: 'Нужен Sky Prime.',
};
const fail = (r: { error?: string }) => flash(ERR[r.error ?? ''] ?? 'Не получилось. Повторите.');
const J = (o: unknown) => JSON.stringify(o);

interface Label { id: string; name: string; description?: string; rightsVerified: boolean; rightsHolder?: string; albums: number }
interface Album { id: string; title: string; year?: number; description?: string; cardId?: string; cardName?: string; labelId?: string; labelName?: string; tracks: number }
interface MyCard { id: string; name: string }
interface Claim { id: string; status: string; holder: string }
type Tab = 'labels' | 'albums' | 'rights';

export const MusicLabels = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<Tab>('labels');
  const [labels, setLabels] = useState<Label[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [cards, setCards] = useState<MyCard[]>([]);
  const load = useCallback(async () => {
    const [l, a, c] = await Promise.all([
      apiCall<{ labels: Label[] }>('/api/music/labels?mine=1'), apiCall<{ albums: Album[] }>('/api/music/albums?mine=1'), apiCall<{ cards: MyCard[] }>('/api/music/studio/cards'),
    ]);
    setLabels(l.ok ? l.data!.labels : []); setAlbums(a.ok ? a.data!.albums : []); setCards(c.ok ? c.data!.cards : []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 pt-4" style={{ background: C.bg }}>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" aria-label="Назад" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}><ChevronLeft size={18} style={{ color: C.t1 }} /></button>
        <p className="text-lg font-black" style={{ color: C.t1 }}>Лейблы и альбомы</p>
      </div>
      <div className="mb-3 flex gap-1.5">
        {([['labels', 'Лейблы'], ['albums', 'Альбомы'], ['rights', 'Права']] as const).map(([k, n]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="rounded-xl px-3.5 text-[13px] font-bold" style={{ minHeight: 40, background: tab === k ? C.accent : C.card, color: tab === k ? '#fff' : C.t2 }}>{n}</button>))}
      </div>
      {tab === 'labels' && <LabelsTab labels={labels} reload={load} />}
      {tab === 'albums' && <AlbumsTab albums={albums} labels={labels} cards={cards} reload={load} />}
      {tab === 'rights' && <RightsTab labels={labels} cards={cards} reload={load} />}
    </div>
  );
};

const LabelsTab = ({ labels, reload }: { labels: Label[]; reload: () => void }) => {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [edit, setEdit] = useState<Label | null>(null);
  const create = async () => { const r = await apiCall('/api/music/labels', { method: 'POST', body: J({ name, description: desc }) }); if (!r.ok) return fail(r); setName(''); setDesc(''); flash('Лейбл создан'); reload(); };
  const save = async () => { if (!edit) return; const r = await apiCall(`/api/music/labels/${edit.id}`, { method: 'PATCH', body: J({ name: edit.name, description: edit.description ?? '' }) }); if (!r.ok) return fail(r); setEdit(null); reload(); };
  const del = async (l: Label) => { if (!window.confirm(`Удалить лейбл «${l.name}»? Альбомы останутся без лейбла.`)) return; const r = await apiCall(`/api/music/labels/${l.id}`, { method: 'DELETE' }); if (!r.ok) return fail(r); reload(); };
  return (
    <div className="space-y-2">
      {labels.map((l) => (
        <div key={l.id} className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          {edit?.id === l.id ? (
            <div className="space-y-2">
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inp} style={inpSt} maxLength={120} translate="no" />
              <textarea value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={3} className={inp} style={inpSt} maxLength={2000} translate="no" />
              <div className="flex gap-2"><button type="button" onClick={() => void save()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.accent }}>Сохранить</button>
                <button type="button" onClick={() => setEdit(null)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: C.t2 }}>Отмена</button></div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[14px] font-bold" style={{ color: C.t1 }}><span translate="no">{l.name}</span>{l.rightsVerified && <BadgeCheck size={14} style={{ color: C.accent }} aria-label="Права подтверждены" />}</p>
                {l.description && <p className="mt-0.5 text-[12px]" style={{ color: C.t2 }} translate="no">{l.description}</p>}
                <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>{`Альбомов: ${l.albums}`}</p>
              </div>
              <button type="button" onClick={() => setEdit(l)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: 'var(--bg-l3)', color: C.t1 }}>Изменить</button>
              <button type="button" aria-label="Удалить" onClick={() => void del(l)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: 'var(--bg-l3)' }}><Trash2 size={14} style={{ color: C.red }} /></button>
            </div>)}
        </div>))}
      {!labels.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>У вас пока нет лейблов.</p>}
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.card, border: `1px dashed ${C.border}` }}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Новый лейбл</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" maxLength={120} className={inp} style={inpSt} translate="no" />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Описание (необязательно)" maxLength={2000} className={inp} style={inpSt} translate="no" />
        <button type="button" disabled={name.trim().length < 2} onClick={() => void create()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.accent }}><Plus size={13} />Создать</button>
      </div>
    </div>
  );
};

const AlbumsTab = ({ albums, labels, cards, reload }: { albums: Album[]; labels: Label[]; cards: MyCard[]; reload: () => void }) => {
  const [f, setF] = useState({ title: '', year: '', cardId: '', labelId: '' }); const [open, setOpen] = useState<string | null>(null);
  const create = async () => { const r = await apiCall('/api/music/albums', { method: 'POST', body: J({ title: f.title, year: f.year || undefined, cardId: f.cardId || undefined, labelId: f.labelId || undefined }) }); if (!r.ok) return fail(r); setF({ title: '', year: '', cardId: '', labelId: '' }); flash('Альбом создан'); reload(); };
  if (open) return <AlbumEditor id={open} labels={labels} cards={cards} onBack={() => { setOpen(null); reload(); }} />;
  return (
    <div className="space-y-2">
      {albums.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="w-full rounded-2xl p-3 text-left" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <p className="text-[14px] font-bold" style={{ color: C.t1 }} translate="no">{a.title}{a.year ? ` · ${a.year}` : ''}</p>
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">{[a.cardName, a.labelName].filter(Boolean).join(' · ') || '—'} · {a.tracks}</p>
        </button>))}
      {!albums.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>Альбомов пока нет.</p>}
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.card, border: `1px dashed ${C.border}` }}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Новый альбом</p>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Название" maxLength={200} className={inp} style={inpSt} translate="no" />
        <input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Год" inputMode="numeric" className={inp} style={inpSt} />
        <select value={f.cardId} onChange={(e) => setF({ ...f, cardId: e.target.value })} className={inp} style={inpSt}><option value="">Без карточки музыканта</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={f.labelId} onChange={(e) => setF({ ...f, labelId: e.target.value })} className={inp} style={inpSt}><option value="">Без лейбла</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <button type="button" disabled={!f.title.trim()} onClick={() => void create()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.accent }}><Plus size={13} />Создать</button>
      </div>
    </div>
  );
};

const AlbumEditor = ({ id, labels, cards, onBack }: { id: string; labels: Label[]; cards: MyCard[]; onBack: () => void }) => {
  const mine = useMusicStore((s) => s.tracks).filter((t) => t.uploadedBy === 'me');
  const [d, setD] = useState<{ album: Album; tracks: { id: string; title: string; artist: string }[]; canEdit: boolean } | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const load = useCallback(async () => { const r = await apiCall<NonNullable<typeof d>>(`/api/music/albums/${id}`); if (r.ok) setD(r.data!); else { fail(r); onBack(); } }, [id, onBack]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <p style={{ color: C.t3 }}>Загрузка…</p>;
  const a = d.album;
  const patch = async (p: Record<string, unknown>) => { const r = await apiCall(`/api/music/albums/${id}`, { method: 'PATCH', body: J(p) }); if (!r.ok) return fail(r); void load(); };
  const tracks = async (ids: string[], remove: boolean) => { const r = await apiCall(`/api/music/albums/${id}/tracks`, { method: 'POST', body: J({ trackIds: ids, remove }) }); if (!r.ok) return fail(r); setPick([]); void load(); };
  const del = async () => { if (!window.confirm('Удалить альбом? Треки останутся.')) return; const r = await apiCall(`/api/music/albums/${id}`, { method: 'DELETE' }); if (!r.ok) return fail(r); onBack(); };
  const inAlbum = new Set(d.tracks.map((t) => t.id));
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.t2 }}><ChevronLeft size={14} />К альбомам</button>
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <input defaultValue={a.title} disabled={!d.canEdit} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.title) void patch({ title: e.target.value }); }} maxLength={200} className={inp} style={inpSt} translate="no" />
        <input defaultValue={a.year ?? ''} disabled={!d.canEdit} inputMode="numeric" placeholder="Год" onBlur={(e) => { if (e.target.value !== String(a.year ?? '')) void patch({ year: e.target.value || null }); }} className={inp} style={inpSt} />
        <select value={a.cardId ?? ''} disabled={!d.canEdit} onChange={(e) => void patch({ cardId: e.target.value || null })} className={inp} style={inpSt}><option value="">Без карточки музыканта</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={a.labelId ?? ''} disabled={!d.canEdit} onChange={(e) => void patch({ labelId: e.target.value || null })} className={inp} style={inpSt}><option value="">Без лейбла</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        {d.canEdit && <button type="button" onClick={() => void del()} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: C.red }}><Trash2 size={13} />Удалить альбом</button>}
      </div>
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Треки в альбоме</p>
      {d.tracks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.card }}>
          <p className="min-w-0 flex-1 truncate text-[13px]" style={{ color: C.t1 }} translate="no">{t.title} — {t.artist}</p>
          {d.canEdit && <button type="button" onClick={() => void tracks([t.id], true)} className="text-[11px] font-bold" style={{ color: C.red }}>Убрать</button>}
        </div>))}
      {!d.tracks.length && <p className="text-[12px]" style={{ color: C.t3 }}>Пока пусто.</p>}
      {d.canEdit && (<>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Добавить свои треки</p>
        {mine.filter((t) => !inAlbum.has(t.id)).map((t) => (
          <label key={t.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px]" style={{ background: C.card, color: C.t1 }}>
            <input type="checkbox" checked={pick.includes(t.id)} onChange={(e) => setPick(e.target.checked ? [...pick, t.id] : pick.filter((x) => x !== t.id))} /><span className="truncate" translate="no">{t.title}</span>
          </label>))}
        <button type="button" disabled={!pick.length} onClick={() => void tracks(pick, false)} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.accent }}>{`Добавить выбранные (${pick.length})`}</button>
      </>)}
    </div>
  );
};

const RightsTab = ({ labels, cards }: { labels: Label[]; cards: MyCard[]; reload: () => void }) => {
  const items = [...cards.map((c) => ({ kind: 'card' as const, id: c.id, name: c.name, verified: false })), ...labels.map((l) => ({ kind: 'label' as const, id: l.id, name: l.name, verified: l.rightsVerified, holder: l.rightsHolder }))];
  return (
    <div className="space-y-2">
      <p className="text-[12px]" style={{ color: C.t3 }}>Подтверждение вручную: сотрудник Sky смотрит ваше пояснение и ссылки на документы. Реестры правообладателей не сверяются.</p>
      {items.map((i) => <RightsRow key={i.kind + i.id} {...i} />)}
      {!items.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>Нужна своя карточка музыканта или лейбл.</p>}
    </div>
  );
};
const RightsRow = ({ kind, id, name, verified, holder }: { kind: 'card' | 'label'; id: string; name: string; verified: boolean; holder?: string }) => {
  const [claims, setClaims] = useState<Claim[]>([]); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ holder: '', note: '', links: '' });
  const load = useCallback(() => { void apiCall<{ claims: Claim[] }>(`/api/music/rights?kind=${kind}&subjectId=${id}`).then((r) => setClaims(r.ok ? r.data!.claims : [])); }, [kind, id]);
  useEffect(() => { load(); }, [load]);
  const pending = claims.find((c) => c.status === 'pending');
  const send = async () => { const r = await apiCall('/api/music/rights', { method: 'POST', body: J({ kind, subjectId: id, holder: f.holder, note: f.note, links: f.links.split(/\s+/).filter(Boolean) }) }); if (!r.ok) return fail(r); flash('Заявка отправлена'); setOpen(false); load(); };
  return (
    <div className="rounded-2xl p-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <p className="text-[13.5px] font-bold" style={{ color: C.t1 }}><span translate="no">{name}</span> <span className="text-[11px] font-normal" style={{ color: C.t3 }}>{kind === 'card' ? 'карточка' : 'лейбл'}</span></p>
      {verified ? <p className="mt-1 flex items-center gap-1 text-[12px]" style={{ color: C.accent }}><BadgeCheck size={13} />Права подтверждены{holder ? ': ' : ''}<span translate="no">{holder}</span></p>
        : pending ? <p className="mt-1 text-[12px]" style={{ color: 'var(--amber, #f59e0b)' }}>Заявка на проверке</p>
        : !open ? <button type="button" onClick={() => setOpen(true)} className="mt-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.accent }}>Подтвердить права правообладателя</button>
        : (
          <div className="mt-2 space-y-2">
            <input value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} placeholder="Правообладатель (имя или организация)" maxLength={160} className={inp} style={inpSt} translate="no" />
            <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={3} placeholder="Основание: договор, лицензия, свидетельство…" maxLength={1500} className={inp} style={inpSt} translate="no" />
            <textarea value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} rows={2} placeholder="Ссылки на документы (https://…, через пробел)" className={inp} style={inpSt} translate="no" />
            <div className="flex gap-2"><button type="button" disabled={f.holder.trim().length < 2 || f.note.trim().length < 10} onClick={() => void send()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.accent }}>Отправить</button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: C.t2 }}>Отмена</button></div>
          </div>)}
    </div>
  );
};
