/** Вкладка «Организации Sky GO»: очередь проверки карточек, решение с причиной, категории (добавить/изменить/скрыть/порядок), журнал сбоев. Право go_places. */
import { useCallback, useEffect, useState } from 'react';
import { apiCall, apiBlob } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { goError } from '@/go/api';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const box = { background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 12 } as const;
const inp = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1, borderRadius: 10, padding: '8px 10px', fontSize: 13, minWidth: 0 } as const;
const btn = (bg: string = C.acc, off = false) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, opacity: off ? 0.5 : 1 }) as const;
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const A = '/api/admin/go/places';
const body = (b: unknown) => JSON.stringify(b ?? {});
const ACTION: Record<string, string> = { connect: 'Подключена', disconnect: 'Отключена', save: 'Изменена', submit: 'Отправлена на проверку', photo_add: 'Добавлено фото', photo_remove: 'Удалено фото',
  admin_approve: 'Одобрена', admin_reject: 'Отклонена', admin_hide: 'Скрыта', admin_unhide: 'Возвращена в каталог', admin_block: 'Заблокирована', admin_unblock: 'Разблокирована' };
const ERR_EXTRA: Record<string, string> = { not_allowed: 'Недостаточно прав.', self_review: 'Свою карточку проверять нельзя.', reason_required: 'Напишите причину (от 5 знаков).', bad_state: 'Состояние карточки уже изменилось — обновите список.', category_in_use: 'В категории есть организации — её можно только скрыть.', exists: 'Такая категория уже есть.' };
const bad = (r: { error?: string; reason?: string; status?: number }) => flash((r.error && ERR_EXTRA[r.error]) || goError(r));

interface Row { id: string; name: string; connected: boolean; status: string; statusLabel: string; bizStatus: string; city: string; address: string; category: string | null; photos: number; submittedAt: string | null; rejectReason: string }
interface Cat { id: string; name: string; icon: string; sort: number; hidden: boolean; places: number }
type View = 'queue' | 'cats' | 'reports' | 'errors';

const AdminPhoto = ({ url }: { url: string }) => {
  const [src, setSrc] = useState('');
  useEffect(() => { let u = ''; let alive = true; void apiBlob(url).then((r) => { if (alive && r.ok && r.blob) { u = URL.createObjectURL(r.blob); setSrc(u); } }); return () => { alive = false; if (u) URL.revokeObjectURL(u); }; }, [url]);
  return <div style={{ width: 96, height: 96, borderRadius: 12, overflow: 'hidden', background: C.l2 }}>{src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>;
};

const Reviews = ({ id }: { id: string }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ reviews: any[] }>(`${A}/${id}/reviews`); if (r.ok) setRows(r.data!.reviews); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (rid: string, hide: boolean) => {
    let reason = ''; if (hide) { reason = prompt('Причина скрытия отзыва (от 5 знаков)') ?? ''; if (reason.trim().length < 5) return; }
    const r = await apiCall(`${A}/reviews/${rid}/${hide ? 'hide' : 'show'}`, { method: 'POST', body: body({ reason }) }); if (!r.ok) return bad(r); void load();
  };
  if (!rows?.length) return null;
  return <details><summary style={{ fontSize: 12, color: C.t2, cursor: 'pointer' }}>Отзывы ({rows.length})</summary>
    {rows.map((r) => <div key={r.id} style={{ fontSize: 12, color: C.t2, padding: '4px 0', opacity: r.hidden ? 0.6 : 1 }}>{'★'.repeat(r.rating)} <span translate="no">{r.text}</span>{r.hidden ? ` — скрыт: ${r.hiddenReason}` : ''}
      {' '}<button type="button" onClick={() => void act(r.id, !r.hidden)} style={{ background: 'none', border: 'none', color: C.acc, textDecoration: 'underline' }}>{r.hidden ? 'Показать' : 'Скрыть'}</button></div>)}</details>;
};

const Reports = () => {
  const [st, setSt] = useState('open'); const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ reports: any[] }>(`${A}/reports?status=${st}`); if (r.ok) setRows(r.data!.reports); else { setRows([]); bad(r); } }, [st]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, a: 'resolve' | 'dismiss') => {
    const note = prompt(a === 'resolve' ? 'Что сделано по жалобе' : 'Почему жалоба отклонена') ?? ''; if (note.trim().length < 3) return;
    const r = await apiCall(`${A}/reports/${id}/${a}`, { method: 'POST', body: body({ note }) }); if (!r.ok) return bad(r); flash('Готово'); void load();
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <select aria-label="Статус" value={st} onChange={(e) => setSt(e.target.value)} style={inp}><option value="open">Открытые</option><option value="resolved">Решённые</option><option value="dismissed">Отклонённые</option></select>
      {!rows ? <div style={box}>Загрузка…</div> : !rows.length ? <div style={box}>Жалоб нет.</div> : rows.map((r) => (
        <div key={r.id} style={box}><b translate="no" style={{ color: C.t1 }}>{r.placeName}</b> <span style={{ fontSize: 12, color: C.t3 }}>· {r.reasonLabel} · {when(r.at)}</span>
          {r.text && <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{r.text}</div>}
          {r.resolution && <div style={{ fontSize: 12, color: C.t3 }}>Решение: {r.resolution}</div>}
          {r.status === 'open' && <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><button type="button" style={btn(C.acc)} onClick={() => void act(r.id, 'resolve')}>Решено</button><button type="button" style={btn(C.t3)} onClick={() => void act(r.id, 'dismiss')}>Отклонить</button></div>}
          <div style={{ fontSize: 11, color: C.t3 }}>{r.placeId}</div></div>))}
    </div>
  );
};

const Detail = ({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<any>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ place: any }>(`${A}/${id}`); if (r.ok) setD(r.data!.place); else bad(r); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (a: string) => {
    if (busy) return; setBusy(true);
    const r = await apiCall(`${A}/${id}/${a}`, { method: 'POST', body: body({ reason }) }); setBusy(false);
    if (!r.ok) return bad(r);
    flash('Готово'); setReason(''); await load(); onChanged();
  };
  if (!d) return <div style={box}>Загрузка…</div>;
  const st = d.status as string;
  const can = (a: string) => ({ approve: st === 'pending', reject: st === 'pending', hide: st === 'published', unhide: st === 'hidden', block: st !== 'blocked', unblock: st === 'blocked' })[a];
  return (
    <div style={{ ...box, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div><b translate="no" style={{ color: C.t1, fontSize: 16 }}>{d.name}</b><div style={{ fontSize: 12, color: C.t3 }}>{d.id} · {d.statusLabel}{d.bizStatus !== 'active' ? ` · бизнес: ${d.bizStatus}` : ''}</div></div>
        <button type="button" onClick={onClose} style={btn(C.l2)} aria-label="Закрыть"><span style={{ color: C.t1 }}>Закрыть</span></button>
      </div>
      <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{d.city}, {d.address} · {d.lat != null ? `${d.lat}, ${d.lng}` : 'точка не задана'} · {d.phone || 'телефон не указан'}</div>
      {d.about && <div translate="no" style={{ fontSize: 13, color: C.t1, whiteSpace: 'pre-wrap' }}>{d.about}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(d.photos as string[]).map((u) => <AdminPhoto key={u} url={u} />)}{!d.photos.length && <span style={{ fontSize: 12, color: C.t3 }}>Фотографий нет</span>}</div>
      <div style={{ fontSize: 12, color: C.t2 }}><b>Позиции ({d.items.length}):</b> {d.items.map((i: any) => `${i.title} — ${i.priceRub} ₽${i.kind === 'service' ? ' (услуга)' : i.stock != null ? ` (ост. ${i.stock})` : ''}`).join('; ') || 'нет'}</div>
      {d.rejectReason && <div style={{ fontSize: 12, color: C.red }}>Причина: {d.rejectReason}</div>}
      <input aria-label="Причина" placeholder="Причина (обязательна для отказа, скрытия, блокировки)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} style={inp} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([['approve', 'Одобрить', C.acc], ['reject', 'Отклонить', C.red], ['hide', 'Скрыть', C.t3], ['unhide', 'Вернуть в каталог', C.acc], ['block', 'Заблокировать', C.red], ['unblock', 'Разблокировать', C.acc]] as const).filter(([a]) => can(a)).map(([a, n, bg]) =>
          <button key={a} type="button" disabled={busy} onClick={() => void act(a)} style={btn(bg, busy)}>{n}</button>)}
      </div>
      <Reviews id={id} />
      <details><summary style={{ fontSize: 12, color: C.t2, cursor: 'pointer' }}>История изменений ({d.log.length})</summary>
        {d.log.map((l: any, i: number) => <div key={i} style={{ fontSize: 12, color: C.t2, padding: '2px 0' }}>{when(l.at)} · {ACTION[l.action] ?? l.action}{l.detail ? ` — ${l.detail}` : ''}</div>)}</details>
    </div>
  );
};

const Cats = () => {
  const [cats, setCats] = useState<Cat[] | null>(null); const [name, setName] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ categories: Cat[] }>('/api/admin/go/place-categories'); if (r.ok) setCats(r.data!.categories); else bad(r); }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (c: Cat | null, patch: Partial<Cat>) => {
    const b = { ...(c ?? { name: '', icon: 'building', sort: 100, hidden: false }), ...patch };
    const r = c ? await apiCall(`/api/admin/go/place-categories/${c.id}`, { method: 'PUT', body: body(b) }) : await apiCall('/api/admin/go/place-categories', { method: 'POST', body: body(b) });
    if (!r.ok) return bad(r); void load();
  };
  const del = async (c: Cat) => { if (!confirm(`Удалить категорию «${c.name}»?`)) return; const r = await apiCall(`/api/admin/go/place-categories/${c.id}`, { method: 'DELETE' }); if (!r.ok) return bad(r); void load(); };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}><input aria-label="Новая категория" placeholder="Новая категория" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ ...inp, flex: 1 }} />
        <button type="button" disabled={name.trim().length < 2} style={btn(C.acc, name.trim().length < 2)} onClick={() => { void save(null, { name: name.trim(), sort: ((cats?.length ?? 0) + 1) * 10 }); setName(''); }}>Добавить</button></div>
      {!cats ? <div style={box}>Загрузка…</div> : cats.map((c) => (
        <div key={c.id} style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', opacity: c.hidden ? 0.6 : 1 }}>
          <input aria-label="Название" defaultValue={c.name} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) void save(c, { name: v }); }} style={{ ...inp, flex: 1, minWidth: 140 }} />
          <input aria-label="Порядок" type="number" defaultValue={c.sort} onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== c.sort) void save(c, { sort: v }); }} style={{ ...inp, width: 74 }} />
          <span style={{ fontSize: 12, color: C.t3 }}>{c.places} орг.</span>
          <button type="button" style={btn(C.l2)} onClick={() => void save(c, { hidden: !c.hidden })}><span style={{ color: C.t1 }}>{c.hidden ? 'Показать' : 'Скрыть'}</span></button>
          <button type="button" style={btn(C.red)} onClick={() => void del(c)}>Удалить</button>
        </div>
      ))}
    </div>
  );
};

export const GoPlacesTab = () => {
  const [view, setView] = useState<View>('queue'); const [status, setStatus] = useState('pending'); const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null); const [open, setOpen] = useState<string | null>(null); const [errs, setErrs] = useState<{ where: string; detail: string; at: string }[] | null>(null);
  const load = useCallback(async () => {
    const u = new URLSearchParams(); if (status) u.set('status', status); if (q.trim()) u.set('q', q.trim());
    const r = await apiCall<{ places: Row[] }>(`${A}?${u.toString()}`); if (r.ok) setRows(r.data!.places); else { setRows([]); bad(r); }
  }, [status, q]);
  useEffect(() => { if (view === 'queue') void load(); }, [view, load]);
  useEffect(() => { if (view === 'errors') void apiCall<{ errors: any[] }>(`${A}/errors`).then((r) => { if (r.ok) setErrs(r.data!.errors); else bad(r); }); }, [view]);
  const tabs: [View, string][] = [['queue', 'Карточки'], ['reports', 'Жалобы'], ['cats', 'Категории'], ['errors', 'Сбои']];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>{tabs.map(([k, n]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} style={btn(view === k ? C.acc : C.l2)}><span style={{ color: view === k ? '#fff' : C.t1 }}>{n}</span></button>)}</div>
      {view === 'queue' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            <option value="pending">На проверке</option><option value="published">Опубликованные</option><option value="rejected">Отклонённые</option><option value="hidden">Скрытые</option><option value="blocked">Заблокированные</option><option value="">Все</option></select>
          <input aria-label="Поиск" placeholder="Название, город или ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, flex: 1 }} />
        </div>
        {open && <Detail id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
        {!rows ? <div style={box}>Загрузка…</div> : !rows.length ? <div style={box}>Ничего нет.</div> : rows.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpen(r.id)} style={{ ...box, textAlign: 'left', cursor: 'pointer' }}>
            <b translate="no" style={{ color: C.t1 }}>{r.name}</b> <span style={{ fontSize: 12, color: C.t3 }}>· {r.statusLabel}{r.connected ? '' : ' · не подключена'}</span>
            <div translate="no" style={{ fontSize: 12, color: C.t2 }}>{r.category ?? 'без категории'} · {r.city}, {r.address} · фото: {r.photos}{r.submittedAt ? ` · отправлена ${when(r.submittedAt)}` : ''}</div>
          </button>))}
      </>}
      {view === 'cats' && <Cats />}
      {view === 'reports' && <Reports />}
      {view === 'errors' && (!errs ? <div style={box}>Загрузка…</div> : !errs.length ? <div style={box}>Сбоев не записано.</div> : errs.map((e, i) => <div key={i} style={{ ...box, fontSize: 12, color: C.t2 }}><b style={{ color: C.t1 }}>{e.where}</b> · {when(e.at)}<div>{e.detail}</div></div>))}
    </div>
  );
};
