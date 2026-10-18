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

      <Registry reason={reason} onDone={() => { setReason(''); }} />
      <Royalty />

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

/* ─── Реестр карточек и передача владельца ─── */
interface Row { id: string; name: string; ownerId: string | null; ownerUsername: string | null; tracks: number }
const Registry = ({ reason }: { reason: string; onDone: () => void }) => {
  const [q, setQ] = useState(''); const [own, setOwn] = useState(''); const [rows, setRows] = useState<Row[] | null>(null);
  const [to, setTo] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const r = await apiCall<{ cards: Row[] }>(`/api/admin/artist-cards?q=${encodeURIComponent(q)}&owner=${own}&limit=50`);
    setRows(r.ok ? r.data!.cards : []);
  }, [q, own]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const transfer = async (id: string) => {
    const u = (to[id] ?? '').trim(); if (!u) return flash('Укажите @ник получателя.');
    if (!window.confirm(`Передать карточку ${u.startsWith('@') ? u : '@' + u}? Треки и релизы сохранятся, прежний владелец потеряет доступ.`)) return;
    const r = await apiCall(`/api/admin/artist-cards/${id}/transfer`, { method: 'POST', body: JSON.stringify({ username: u, reason }) });
    flash(r.ok ? 'Карточка передана' : (ERR[r.error ?? ''] ?? (r.error === 'user_not_found' ? 'Человек с таким ником не найден.' : r.error === 'already_owner' ? 'Он уже владелец.' : 'Не получилось')));
    if (r.ok) { setTo({ ...to, [id]: '' }); void load(); }
  };
  return (
    <section className="space-y-2">
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Все карточки и передача владельца</p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, id карточки или id владельца" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={field} />
        <select value={own} onChange={(e) => setOwn(e.target.value)} className="rounded-xl px-2 text-xs" style={field}><option value="">Все</option><option value="has">С владельцем</option><option value="none">Без владельца</option></select>
      </div>
      {!rows ? <p className="text-[12px]" style={{ color: C.t3 }}>Загрузка…</p> : rows.length === 0 ? <p className="text-[12.5px]" style={{ color: C.t3 }}>Ничего не найдено</p> : rows.map((c) => (
        <div key={c.id} className="space-y-1.5 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{c.name} <span className="font-normal" style={{ color: C.t3 }}>· треков: {c.tracks}</span></p>
          <p className="text-[11.5px]" style={{ color: C.t3 }} translate="no">{c.id} · владелец: {c.ownerUsername ? `@${c.ownerUsername}` : c.ownerId ?? 'нет'}</p>
          <div className="flex gap-2">
            <input value={to[c.id] ?? ''} onChange={(e) => setTo({ ...to, [c.id]: e.target.value })} placeholder="@ник нового владельца" className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-xs" style={field} />
            <button type="button" onClick={() => void transfer(c.id)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.acc }}>Передать</button>
          </div>
        </div>))}
      <p className="text-[11.5px]" style={{ color: C.t3 }}>Причина берётся из поля выше (не короче 5 знаков). Новый владелец правит только треки, загруженные им самим; id карточки и все треки остаются на месте.</p>
    </section>
  );
};

/* ─── Роялти экосистемы (только владелец сервиса) ─── */
const Royalty = () => {
  const [d, setD] = useState<{ mode: string; artistsOn: number; artistsWithOwner: number; note: string; log: { id: number; scope: string; card_id: string | null; old_value: string; new_value: string; reason: string; at: string }[] } | null>(null);
  const [no, setNo] = useState(false); const [why, setWhy] = useState('');
  const load = useCallback(async () => { const r = await apiCall<NonNullable<typeof d>>('/api/admin/music/royalty'); if (r.ok) setD(r.data!); else setNo(true); }, []);
  useEffect(() => { void load(); }, [load]);
  if (no) return null;
  if (!d) return null;
  const set = async (mode: string) => {
    if (!window.confirm('Изменить режим роялти для всей экосистемы?')) return;
    const r = await apiCall('/api/admin/music/royalty', { method: 'PUT', body: JSON.stringify({ mode, reason: why }) });
    flash(r.ok ? 'Сохранено' : (r.error === 'reason_required' ? 'Укажите причину (не короче 5 знаков).' : 'Не получилось')); if (r.ok) { setWhy(''); void load(); }
  };
  const LBL: Record<string, string> = { per_artist: 'По настройке артиста', all_on: 'Включено у всех', all_off: 'Выключено у всех' };
  return (
    <section className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Роялти экосистемы</p>
      <p className="text-[12px]" style={{ color: C.t2 }}>Режим: <b>{LBL[d.mode]}</b> · включили сами артисты: {d.artistsOn} из {d.artistsWithOwner}. Глобальный режим сильнее настройки артиста.</p>
      <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Причина изменения (обязательна)" className="w-full rounded-xl px-3 py-2 text-xs" style={field} />
      <div className="flex flex-wrap gap-2">{Object.entries(LBL).map(([m, t]) => <button key={m} type="button" onClick={() => void set(m)} disabled={d.mode === m} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50" style={{ background: d.mode === m ? C.acc : C.l2, color: d.mode === m ? '#fff' : C.t1 }}>{t}</button>)}</div>
      <p className="text-[11.5px]" style={{ color: C.t3 }}>{d.note}</p>
      {d.log.slice(0, 15).map((l) => <p key={l.id} className="text-[11px]" style={{ color: C.t3 }} translate="no">{new Date(l.at).toLocaleString('ru-RU')} · {l.scope === 'global' ? 'глобально' : l.card_id}: {l.old_value} → {l.new_value}{l.reason ? ` — ${l.reason}` : ''}</p>)}
    </section>
  );
};

