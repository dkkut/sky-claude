/**
 * Вкладка «Sky GO»: заявки исполнителей, заказы и споры, подписки, тарифы и настройки, интеграции.
 * Сервер — server/goadmin.mjs, server/goreg.mjs. Право `go`; цены, порядок оплаты — `go_finance`.
 * Реестры ФНС не подключены: одобрение — решение сотрудника по документам.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiBlob, apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { goError, ROLE_LABEL, STATUS_LABEL, type GoRole } from '@/go/api';
import { Photo } from '@/go/Stay';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const box = { background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 12 } as const;
const inp = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1, borderRadius: 10, padding: '7px 10px', fontSize: 13 } as const;
const btn = (bg = C.acc, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }) as const;
const A = '/api/admin/go';
const get = <T,>(p: string) => apiCall<T>(`${A}${p}`);
const send = <T,>(m: string, p: string, b: unknown) => apiCall<T>(`${A}${p}`, { method: m, body: JSON.stringify(b) });
const bad = (r: { error?: string; reason?: string }) => flash(({ not_allowed: 'Недостаточно прав.', note_required: 'Укажите причину.', bad_transition: 'Переход невозможен.', bad_price: 'Неверная цена.' } as Record<string, string>)[r.error ?? ''] ?? goError(r));

type Sub = 'apps' | 'orders' | 'stay' | 'subs' | 'tariffs' | 'integrations';

export const GoAdminTab = () => {
  const [sub, setSub] = useState<Sub>('apps');
  const [ov, setOv] = useState<any>(null);
  useEffect(() => { void get<any>('/overview').then((r) => r.ok && setOv(r.data)); }, [sub]);
  const TABS: [Sub, string][] = [['apps', 'Заявки'], ['orders', 'Заказы и споры'], ['stay', 'Жильё и отдых'], ['subs', 'Подписки'], ['tariffs', 'Тарифы и настройки'], ['integrations', 'Интеграции']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ov && <div style={{ ...box, fontSize: 13, color: C.t2 }}>Активных подписок: <b style={{ color: C.t1 }}>{ov.activeSubscriptions}</b> · На проверке: <b style={{ color: C.t1 }}>{(ov.executors.submitted ?? 0) + (ov.executors.in_review ?? 0)}</b> · Заказов за 30 дней: <b style={{ color: C.t1 }}>{ov.orders30d.reduce((s: number, r: any) => s + r.n, 0)}</b></div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{TABS.map(([k, t]) => <button key={k} onClick={() => setSub(k)} style={btn(sub === k ? C.acc : C.l2, sub === k ? '#fff' : C.t1)}>{t}</button>)}</div>
      {sub === 'apps' && <Apps />}{sub === 'orders' && <Orders />}{sub === 'stay' && <StayListings />}{sub === 'subs' && <Subs />}{sub === 'tariffs' && <Tariffs />}{sub === 'integrations' && <Integrations />}
    </div>
  );
};

const Apps = () => {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await get<{ items: any[] }>(`/applications?status=${status}`); setItems(r.ok ? r.data!.items : []); }, [status]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <AppDetail id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
        {[['submitted', 'На проверке'], ['needs_info', 'Нужны уточнения'], ['approved', 'Одобрены'], ['rejected', 'Отклонены'], ['suspended', 'Приостановлены'], ['', 'Все']].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
      {!items ? <div style={{ color: C.t3 }}>Загрузка…</div> : items.length === 0 ? <div style={{ color: C.t3 }}>Заявок нет.</div> : items.map((a) => (
        <div key={a.id} onClick={() => setOpen(a.id)} style={{ ...box, cursor: 'pointer' }}>
          <b style={{ color: C.t1 }}>{ROLE_LABEL[a.role as GoRole]}</b> · {a.legalForm.toUpperCase()} · {a.city}
          <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>@{a.username} · {a.name} · ИНН …{a.innLast4}</div>
        </div>))}
    </div>
  );
};

const AppDetail = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [d, setD] = useState<any>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [img, setImg] = useState<{ url: string; mime: string } | null>(null);
  const load = useCallback(async () => { const r = await get<any>(`/applications/${id}`); if (r.ok) setD(r.data!.executor); else bad(r); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const view = async (docId: string) => { const r = await apiBlob(`${A}/docs/${docId}`); if (!r.ok || !r.blob) return flash('Не удалось открыть документ.'); setImg({ url: URL.createObjectURL(r.blob), mime: r.blob.type }); };
  const decide = async (action: string) => {
    setBusy(true); const r = await send('POST', `/applications/${id}/decide`, { action, note }); setBusy(false);
    if (!r.ok) return bad(r); flash('Готово'); setNote(''); void load();
  };
  if (!d) return <div style={{ color: C.t3 }}>Загрузка…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={onBack} style={btn(C.l2, C.t1)}>← К списку</button>
      <div style={box}>
        <b style={{ color: C.t1 }}>{ROLE_LABEL[d.role as GoRole]}</b> · {d.legalForm.toUpperCase()} · {d.city} · статус: <b>{d.status}</b>
        <div translate="no" style={{ fontSize: 13, color: C.t2, marginTop: 6 }}>@{d.username} ({d.name})</div>
        <pre translate="no" style={{ fontSize: 12.5, color: C.t1, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{Object.entries({ ...d.fields, ...d.extra }).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
        <div style={{ fontSize: 12, color: C.t3, marginTop: 8 }}>Формат ИНН/ОГРН проверен сервером. Сверка с реестрами ФНС (ЕГРИП/ЕГРЮЛ, статус НПД) НЕ выполнялась — проверьте вручную.</div>
        {d.reviewNote && <div style={{ fontSize: 12.5, color: C.t2, marginTop: 4 }}>Последний комментарий: {d.reviewNote}</div>}
      </div>
      <div style={box}>
        <b style={{ color: C.t1 }}>Документы</b> <span style={{ fontSize: 12, color: C.t3 }}>(каждый просмотр записывается в журнал)</span>
        {d.docs.length === 0 && <div style={{ color: C.t3, fontSize: 13 }}>Не загружены{d.checks.requiredDocs.length ? ` (нужны: ${d.checks.requiredDocs.join(', ')})` : ''}.</div>}
        {d.docs.map((x: any) => <div key={x.id} style={{ marginTop: 6 }}><button onClick={() => view(x.id)} style={btn(C.l2, C.t1)}>{x.label}</button></div>)}
        {img && (img.mime === 'application/pdf' ? <a href={img.url} target="_blank" rel="noreferrer" style={{ color: C.acc }}>Открыть PDF</a> : <img src={img.url} alt="" style={{ maxWidth: '100%', marginTop: 8, borderRadius: 10 }} />)}
      </div>
      <div style={box}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (обязателен для отказа, уточнения, приостановки)" rows={2} style={{ ...inp, width: '100%' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {['submitted', 'in_review'].includes(d.status) && <><button disabled={busy} onClick={() => decide('approve')} style={btn(C.green)}>Одобрить</button>
            <button disabled={busy} onClick={() => decide('needs_info')} style={btn('#f59e0b')}>Запросить сведения</button>
            <button disabled={busy} onClick={() => decide('reject')} style={btn(C.red)}>Отклонить</button></>}
          {d.status === 'approved' && <button disabled={busy} onClick={() => decide('suspend')} style={btn(C.red)}>Приостановить</button>}
          {d.status === 'suspended' && <button disabled={busy} onClick={() => decide('unsuspend')} style={btn(C.green)}>Вернуть допуск</button>}
        </div>
      </div>
    </div>
  );
};

const Orders = () => {
  const [kind, setKind] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const [items, setItems] = useState<any[] | null>(null); const [open, setOpen] = useState<any>(null); const [note, setNote] = useState('');
  const load = useCallback(async () => { const r = await get<{ items: any[] }>(`/orders?kind=${kind}&status=${status}&q=${encodeURIComponent(q)}`); setItems(r.ok ? r.data!.items : []); }, [kind, status, q]);
  useEffect(() => { void load(); }, [load]);
  const show = async (id: string) => { const r = await get<any>(`/orders/${id}`); if (r.ok) setOpen(r.data!.order); else bad(r); };
  const resolve = async (outcome: 'paid' | 'cancelled') => { const r = await send('POST', `/orders/${open.id}/resolve`, { outcome, note }); if (!r.ok) return bad(r); flash('Спор закрыт'); setOpen(null); setNote(''); void load(); };
  if (open) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={() => setOpen(null)} style={btn(C.l2, C.t1)}>← К списку</button>
      <div style={box}>
        <b style={{ color: C.t1 }}>{open.kind} · {open.priceRub} ₽ · {STATUS_LABEL[open.status] ?? open.status}</b>
        <div translate="no" style={{ fontSize: 12.5, color: C.t2, marginTop: 4 }}>Заказчик: @{open.customer?.username} · Исполнитель: {open.executor ? `@${open.executor.username}` : '—'}</div>
        <pre translate="no" style={{ fontSize: 12, color: C.t2, whiteSpace: 'pre-wrap' }}>{JSON.stringify(open.data, null, 1).slice(0, 1200)}</pre>
        {open.pay && <div style={{ fontSize: 13, color: C.t1 }}>Оплата напрямую: {open.pay.amountRub} ₽ · {open.pay.state}</div>}
        {open.events?.map((e: any, i: number) => <div key={i} style={{ fontSize: 12.5, color: C.t2 }}>{new Date(e.at).toLocaleString('ru-RU')} — {e.note || e.to}</div>)}
      </div>
      {open.status === 'dispute' && <div style={box}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Решение и причина" rows={2} style={{ ...inp, width: '100%' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button onClick={() => resolve('paid')} style={btn(C.green)}>Считать оплаченным</button><button onClick={() => resolve('cancelled')} style={btn(C.red)}>Отменить заказ</button></div>
        <div style={{ fontSize: 12, color: C.t3, marginTop: 6 }}>Sky не принимает деньги за заказы GO — решение меняет только статус заказа.</div>
      </div>}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={inp}><option value="">Все виды</option><option value="taxi">Такси</option><option value="food">Еда</option><option value="delivery">Доставка</option><option value="stay">Жильё и отдых</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}><option value="">Все статусы</option><option value="dispute">Споры</option><option value="searching">Поиск</option><option value="awaiting_payment">Ожидают оплаты</option><option value="paid">Оплачены</option><option value="cancelled">Отменены</option></select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="id или @логин заказчика" style={{ ...inp, flex: 1, minWidth: 140 }} />
      </div>
      {!items ? <div style={{ color: C.t3 }}>Загрузка…</div> : items.length === 0 ? <div style={{ color: C.t3 }}>Заказов нет.</div> : items.map((o) => (
        <div key={o.id} onClick={() => show(o.id)} style={{ ...box, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span translate="no" style={{ color: C.t1 }}>{o.kind} · @{o.customer} · {o.city}</span><span style={{ color: o.status === 'dispute' ? C.red : C.t2 }}>{o.priceRub} ₽ · {STATUS_LABEL[o.status] ?? o.status}</span>
        </div>))}
    </div>
  );
};

/** Объявления «Жилье и отдых»: просмотр и снятие с публикации с причиной (право go). */
const StayListings = () => {
  const [status, setStatus] = useState('published'); const [q, setQ] = useState('');
  const [items, setItems] = useState<any[] | null>(null); const [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await get<{ items: any[] }>(`/listings?status=${status}&q=${encodeURIComponent(q)}`); setItems(r.ok ? r.data!.items : []); }, [status, q]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, action: 'hide' | 'restore') => { const r = await send('POST', `/listings/${id}/moderate`, { action, note: note[id] ?? '' }); if (!r.ok) return bad(r); flash(action === 'hide' ? 'Объявление снято' : 'Возвращено владельцу'); void load(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>{[['published', 'Опубликованы'], ['hidden', 'Сняты'], ['draft', 'Черновики'], ['', 'Все']].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или @владелец" style={{ ...inp, flex: 1 }} />
      </div>
      {!items ? <div style={{ color: C.t3 }}>Загрузка…</div> : items.length === 0 ? <div style={{ color: C.t3 }}>Объявлений нет.</div> : items.map((l) => (
        <div key={l.id} style={box}>
          <div style={{ display: 'flex', gap: 10 }}>
            {l.photos[0] && <div style={{ width: 90, height: 68, borderRadius: 10, overflow: 'hidden', flex: '0 0 90px' }}><Photo id={l.photos[0]} admin /></div>}
            <div style={{ minWidth: 0 }}>
              <b translate="no" style={{ color: C.t1 }}>{l.title}</b>
              <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>{l.kind} · {l.city} · @{l.owner} · от {l.priceRub} ₽ · {l.status}</div>
              {l.modNote && <div style={{ fontSize: 12.5, color: C.red }}>Снято: {l.modNote}</div>}
            </div>
          </div>
          <div translate="no" style={{ fontSize: 12.5, color: C.t2, margin: '6px 0', whiteSpace: 'pre-wrap' }}>{String(l.descr).slice(0, 300)}</div>
          {l.status !== 'hidden'
            ? <div style={{ display: 'flex', gap: 6 }}><input value={note[l.id] ?? ''} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} placeholder="Причина снятия" style={{ ...inp, flex: 1 }} /><button onClick={() => act(l.id, 'hide')} style={btn(C.red)}>Снять</button></div>
            : <button onClick={() => act(l.id, 'restore')} style={btn(C.green)}>Вернуть владельцу</button>}
        </div>))}
    </div>
  );
};

const Subs = () => {
  const [q, setQ] = useState(''); const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { void get<{ items: any[] }>(`/subscriptions?q=${encodeURIComponent(q)}`).then((r) => setItems(r.ok ? r.data!.items : [])); }, [q]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PersonalTariffs />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="@логин или имя" style={inp} />
      {!items ? <div style={{ color: C.t3 }}>Загрузка…</div> : items.length === 0 ? <div style={{ color: C.t3 }}>Подписок нет.</div> : items.map((s) => (
        <div key={s.profileId + s.role} style={{ ...box, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span translate="no" style={{ color: C.t1 }}>@{s.username} · {ROLE_LABEL[s.role as GoRole]}</span>
          <span style={{ color: s.active ? C.green : C.red, fontSize: 13 }}>{s.active ? 'до ' : 'истекла '}{new Date(s.expiresAt).toLocaleDateString('ru-RU')} · платежей: {s.payments} · {s.totalRub} ₽</span>
        </div>))}
    </div>
  );
};

/** Персональный тариф: цена и срок для одного исполнителя (право go_finance). Действует при следующей оплате. */
const PersonalTariffs = () => {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ username: '', role: 'taxi_driver', priceRub: '', periodDays: '7', note: '' });
  const load = useCallback(async () => { const r = await get<{ items: any[] }>('/executor-tariffs'); if (r.ok) setItems(r.data!.items); }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (reset = false, over?: { username: string; role: string }) => {
    const b = reset ? { ...over, reset: true } : { ...f, priceRub: Number(f.priceRub), periodDays: Number(f.periodDays) };
    const r = await send('PUT', '/executor-tariffs', b); if (!r.ok) return bad(r);
    flash(reset ? 'Возвращён общий тариф' : 'Персональный тариф сохранён'); void load();
  };
  return (
    <div style={box}>
      <b style={{ color: C.t1 }}>Персональный тариф исполнителя</b> <span style={{ fontSize: 12, color: C.t3 }}>(право go_finance; вместо общего, со следующей оплаты)</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <input placeholder="@логин" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} style={{ ...inp, width: 130 }} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={inp}>{(['taxi_driver', 'courier', 'food_seller', 'company', 'host', 'tour_operator', 'hotel'] as GoRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <input placeholder="₽" value={f.priceRub} onChange={(e) => setF({ ...f, priceRub: e.target.value.replace(/\D/g, '') })} style={{ ...inp, width: 70 }} />
        <input placeholder="дней" value={f.periodDays} onChange={(e) => setF({ ...f, periodDays: e.target.value.replace(/\D/g, '') })} style={{ ...inp, width: 60 }} />
        <input placeholder="Примечание" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ ...inp, flex: 1, minWidth: 120 }} />
        <button onClick={() => save()} style={btn()} disabled={!f.username || f.priceRub === ''}>Сохранить</button>
      </div>
      {items.map((t) => (
        <div key={t.profileId + t.role} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 13, color: C.t1 }}>
          <span translate="no">@{t.username} · {ROLE_LABEL[t.role as GoRole]} · {t.priceRub} ₽ / {t.periodDays} дн.{t.note ? ` · ${t.note}` : ''}</span>
          <button onClick={() => save(true, { username: t.username, role: t.role })} style={btn(C.l2, C.t1)}>Сбросить</button>
        </div>))}
    </div>
  );
};

const Tariffs = () => {
  const [d, setD] = useState<any>(null);
  const load = useCallback(async () => { const r = await get<any>('/settings'); if (r.ok) setD(r.data); else bad(r); }, []);
  useEffect(() => { void load(); }, [load]);
  const [prices, setPrices] = useState<Record<string, { priceRub: string; periodDays: string }>>({});
  const [cities, setCities] = useState<string | null>(null); const [json, setJson] = useState<Record<string, string>>({});
  if (!d) return <div style={{ color: C.t3 }}>Загрузка…</div>;
  const saveTariff = async (code: string) => {
    const p = prices[code]; if (!p) return;
    const r = await send('PUT', `/tariffs/${code}`, { priceRub: Number(p.priceRub), periodDays: Number(p.periodDays) }); if (!r.ok) return bad(r); flash('Тариф сохранён'); void load();
  };
  const saveSetting = async (key: string, value: unknown) => { const r = await send('PUT', `/settings/${key}`, { value }); if (!r.ok) return bad(r); flash('Сохранено'); void load(); };
  const setRole = async (role: string, code: string) => { const r = await send('PUT', '/role-tariff', { role, code }); if (!r.ok) return bad(r); flash('Сохранено'); void load(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={box}>
        <b style={{ color: C.t1 }}>Тарифы подписки</b> <span style={{ fontSize: 12, color: C.t3 }}>(право go_finance; без автосписаний)</span>
        {d.tariffs.map((t: any) => (
          <div key={t.code} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 130, color: C.t1 }}>{t.title}</span>
            <input value={prices[t.code]?.priceRub ?? t.priceRub} onChange={(e) => setPrices({ ...prices, [t.code]: { priceRub: e.target.value.replace(/\D/g, ''), periodDays: prices[t.code]?.periodDays ?? String(t.periodDays) } })} style={{ ...inp, width: 80 }} /> ₽
            <input value={prices[t.code]?.periodDays ?? t.periodDays} onChange={(e) => setPrices({ ...prices, [t.code]: { priceRub: prices[t.code]?.priceRub ?? String(t.priceRub), periodDays: e.target.value.replace(/\D/g, '') } })} style={{ ...inp, width: 60 }} /> дн.
            <button onClick={() => saveTariff(t.code)} style={btn()}>Сохранить</button>
          </div>))}
        <div style={{ marginTop: 10, fontSize: 13, color: C.t2 }}>Какой тариф у какого кабинета:</div>
        {Object.entries(d.roleTariff).map(([role, code]) => (
          <div key={role} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, color: C.t1 }}>
            <span style={{ width: 160 }}>{ROLE_LABEL[role as GoRole] ?? role}</span>
            <select value={String(code)} onChange={(e) => setRole(role, e.target.value)} style={inp}>{d.tariffs.map((t: any) => <option key={t.code} value={t.code}>{t.title}</option>)}</select>
          </div>))}
      </div>
      <div style={box}>
        <b style={{ color: C.t1 }}>Города</b>
        <textarea rows={2} value={cities ?? (d.settings.cities ?? []).join(', ')} onChange={(e) => setCities(e.target.value)} style={{ ...inp, width: '100%', marginTop: 6 }} />
        <button style={{ ...btn(), marginTop: 6 }} onClick={() => saveSetting('cities', (cities ?? '').split(',').map((s) => s.trim()).filter(Boolean))} disabled={cities == null}>Сохранить города</button>
      </div>
      {(['taxi_tariffs', 'delivery_tariff'] as const).map((k) => (
        <div key={k} style={box}>
          <b style={{ color: C.t1 }}>{k === 'taxi_tariffs' ? 'Цены такси' : 'Цены доставки'}</b> <span style={{ fontSize: 12, color: C.t3 }}>(JSON; сервер проверит значения)</span>
          <textarea rows={8} value={json[k] ?? JSON.stringify(d.settings[k], null, 1)} onChange={(e) => setJson({ ...json, [k]: e.target.value })} style={{ ...inp, width: '100%', marginTop: 6, fontFamily: 'monospace' }} />
          <button style={{ ...btn(), marginTop: 6 }} disabled={json[k] == null} onClick={() => { try { void saveSetting(k, JSON.parse(json[k])); } catch { flash('Неверный JSON'); } }}>Сохранить</button>
        </div>))}
      <div style={box}>
        <b style={{ color: C.t1 }}>Порядок оплаты еды</b>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {[['after', 'После вручения'], ['before', 'До приготовления']].map(([k, t]) => <button key={k} style={btn(d.settings.payment_terms?.food === k ? C.acc : C.l2, d.settings.payment_terms?.food === k ? '#fff' : C.t1)}
            onClick={() => saveSetting('payment_terms', { taxi: 'after_ride', food: k, delivery: 'after' })}>{t}</button>)}
        </div>
      </div>
    </div>
  );
};

const Integrations = () => {
  const [d, setD] = useState<any>(null);
  useEffect(() => { void get<any>('/integrations').then((r) => r.ok && setD(r.data)); }, []);
  if (!d) return <div style={{ color: C.t3 }}>Загрузка…</div>;
  const row = (t: string, ok: boolean, note: string) => <div style={{ ...box, display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ color: C.t1 }}>{t}</span><span style={{ color: ok ? C.green : C.red, fontSize: 13, textAlign: 'right' }}>{ok ? 'Подключено' : 'Не подключено'}{note ? ` — ${note}` : ''}</span></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {row('Карты и маршруты (GOOGLE_MAPS_KEY)', Boolean(d.maps?.enabled ?? d.maps?.configured), 'без них расстояния считаются по прямой и помечаются как оценка')}
      {row('Авиабилеты (FLIGHTS_PROVIDER, TRAVELPAYOUTS_*)', Boolean(d.flights?.configured), d.flights?.note ?? 'бронирование внутри Sky не поддерживается — переход на сайт партнёра')}
      {row('Заправки (FUEL_PROVIDER, OVERPASS_URL)', Boolean(d.fuel?.configured), d.fuel?.note ?? 'цены топлива поставщик не отдаёт')}
      <div style={{ fontSize: 12, color: C.t3 }}>Ключи задаются на сервере (.env), в интерфейсе не хранятся.</div>
    </div>
  );
};
