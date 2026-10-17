/** Админка → «Музыканты»: заявки на владение карточкой, дубли и объединение (с откатом), снятие владельца. Сервер: server/artistcards.mjs, право `content`. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Music2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Claim { id: string; cardId: string; cardName: string; claimant: string; claimantName: string; status: string; ownTracks: number; note: string; links: string[]; reason?: string; createdAt: string }
interface Card { id: string; name: string; tracks: number; confirmedOwner: boolean; autoCreated: boolean }
interface Pair { a: Card; b: Card; match: number; sameAfterTranslit: boolean }
const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const ERR: Record<string, string> = { reason_required: 'Укажите причину (не короче 5 знаков).', self_review: 'Нельзя решать собственную заявку.', owners_differ: 'У карточек разные подтверждённые владельцы.', not_allowed: 'Недостаточно прав.', already_merged: 'Карточка уже объединена.', name_taken: 'Имя уже занято другой карточкой.' };

export const ArtistCardsTab = () => {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [reason, setReason] = useState('');
  const [unId, setUnId] = useState('');
  const [err, setErr] = useState<string>();
  const load = useCallback(async () => {
    const a = await apiCall<{ items: Claim[] }>('/api/admin/artist-cards/claims?status=pending');
    if (!a.ok) { setErr(a.error === 'not_allowed' ? 'Недостаточно прав.' : 'Не удалось загрузить'); return; }
    setClaims(a.data?.items ?? []);
    const b = await apiCall<{ pairs: Pair[] }>('/api/admin/artist-cards/duplicates');
    setPairs(b.ok ? (b.data?.pairs ?? []) : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const done = (r: { ok: boolean; error?: string }, okText = 'Готово') => { flash(r.ok ? okText : (ERR[r.error ?? ''] ?? 'Не получилось')); if (r.ok) { setReason(''); void load(); } };
  const decide = async (id: string, approve: boolean) => done(await apiCall(`/api/admin/artist-cards/claims/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, reason }) }));
  const merge = async (from: string, into: string) => done(await apiCall('/api/admin/artist-cards/merge', { method: 'POST', body: JSON.stringify({ from, into, reason }) }), 'Карточки объединены');
  const unmerge = async () => done(await apiCall(`/api/admin/artist-cards/${unId.trim()}/unmerge`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Объединение отменено');

  if (err) return <p className="text-sm" style={{ color: C.red }}>{err}</p>;
  if (!claims || !pairs) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}><Music2 size={16} style={{ color: C.acc }} />Карточки музыкантов</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина / пояснение решения (нужна для отказа, объединения и отката)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} aria-label="Причина" />

      <section className="space-y-2">
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Заявки на владение ({claims.length})</p>
        {claims.map((c) => (
          <div key={c.id} className="space-y-1.5 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{c.cardName} <span className="font-normal" style={{ color: C.t3 }}>← {c.claimant}</span></p>
            <p className="text-[11.5px]" style={{ color: C.t3 }}>Своих треков на карточке: {c.ownTracks}</p>
            <p className="whitespace-pre-wrap text-[12.5px]" style={{ color: C.t2 }} translate="no">{c.note}</p>
            {c.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="block text-[12px] underline" style={{ color: C.acc }}>{l}</a>)}
            <div className="flex gap-2">
              <button type="button" onClick={() => void decide(c.id, true)} className="rounded-xl px-4 py-1.5 text-xs font-bold text-white" style={{ background: C.green }}>Подтвердить</button>
              <button type="button" onClick={() => void decide(c.id, false)} className="rounded-xl px-4 py-1.5 text-xs font-bold text-white" style={{ background: C.red }}>Отклонить</button>
            </div>
          </div>))}
        {!claims.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>Заявок нет</p>}
      </section>

      <section className="space-y-2">
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Возможные дубли ({pairs.length})</p>
        {pairs.map((p) => (
          <div key={p.a.id + p.b.id} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[13px]" style={{ color: C.t1 }} translate="no">{p.a.name} <span style={{ color: C.t3 }}>({p.a.tracks})</span> ≈ {p.b.name} <span style={{ color: C.t3 }}>({p.b.tracks})</span></p>
            <p className="text-[11px]" style={{ color: C.t3 }}>Совпадение {Math.round(p.match * 100)}%{p.sameAfterTranslit ? ' · совпадает после транслитерации' : ''}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void merge(p.b.id, p.a.id)} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>«{p.b.name}» → «{p.a.name}»</button>
              <button type="button" onClick={() => void merge(p.a.id, p.b.id)} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>«{p.a.name}» → «{p.b.name}»</button>
            </div>
          </div>))}
        {!pairs.length && <p className="text-[12.5px]" style={{ color: C.t3 }}>Похожих карточек не найдено</p>}
      </section>

      <section className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Отменить объединение</p>
        <div className="flex gap-2">
          <input value={unId} onChange={(e) => setUnId(e.target.value)} placeholder="Идентификатор объединённой карточки (acd-…)" className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Идентификатор карточки" />
          <button type="button" disabled={!unId.trim()} onClick={() => void unmerge()} className="rounded-xl px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Отменить</button>
        </div>
      </section>
    </div>
  );
};
