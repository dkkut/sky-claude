/** Sky для бизнеса → «Sky GO»: записи, расписание, отзывы, статистика (этап 2). Все решения принимает сервер. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { goError } from '@/go/api';
import { gpOwner2, type GpBookSettings, type GpOwnerBooking, type GpStats } from '@/go/placesApi';
import { Btn, In, Stat, card, field } from './ui';

const when = (iso: string, tz?: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: tz || undefined, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const Spin = () => <div className="grid place-items-center py-8"><Loader2 className="animate-spin" size={18} /></div>;
type R = { ok: boolean; error?: string; reason?: string; status?: number };
const bad = (r: R) => flash(goError(r));

export const Bookings = () => {
  const [st, setSt] = useState(''); const [list, setList] = useState<GpOwnerBooking[] | null>(null); const [why, setWhy] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await gpOwner2.bookings(st); if (r.ok) setList(r.data!.bookings); else { setList([]); bad(r); } }, [st]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, a: Parameters<typeof gpOwner2.act>[1]) => { if (busy) return; setBusy(true); const r = await gpOwner2.act(id, a, why[id] ?? ''); setBusy(false); if (!r.ok) return bad(r); void load(); };
  return (
    <div className="space-y-2">
      <select aria-label="Статус" value={st} onChange={(e) => setSt(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={field}>
        <option value="">Все</option><option value="requested">Ждут подтверждения</option><option value="confirmed">Подтверждены</option><option value="done">Состоялись</option><option value="cancelled">Отменены</option><option value="rejected">Отклонены</option><option value="no_show">Не пришли</option></select>
      {!list ? <Spin /> : !list.length ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Записей нет.</p> : list.map((b) => {
        const past = new Date(b.startsAt).getTime() <= Date.now();
        return (
          <div key={b.id} className="rounded-2xl p-3" style={card}>
            <div className="flex justify-between gap-2"><b translate="no" style={{ color: 'var(--t1)' }}>{b.item}</b><span className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{when(b.startsAt, b.tz)}</span></div>
            <p translate="no" className="text-xs" style={{ color: 'var(--t2)' }}>{b.name}, {b.phone} · {b.priceRub} ₽{b.note ? ` · ${b.note}` : ''}</p>
            <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}>{b.statusLabel}{b.comment ? ` — ${b.comment}` : ''}</p>
            {['requested', 'confirmed'].includes(b.status) && <>
              <input aria-label="Причина" placeholder="Причина (для отказа или отмены)" value={why[b.id] ?? ''} onChange={(e) => setWhy({ ...why, [b.id]: e.target.value })} maxLength={300} className="mt-2 w-full rounded-lg px-3 py-2 text-xs" style={field} />
              <div className="mt-2 flex flex-wrap gap-2">
                {b.status === 'requested' && <><Btn small tone="accent" disabled={busy} onClick={() => void act(b.id, 'confirm')}>Подтвердить</Btn><Btn small tone="danger" disabled={busy} onClick={() => void act(b.id, 'reject')}>Отклонить</Btn></>}
                {b.status === 'confirmed' && <><Btn small tone="danger" disabled={busy} onClick={() => void act(b.id, 'cancel')}>Отменить</Btn>{past && <><Btn small tone="accent" disabled={busy} onClick={() => void act(b.id, 'done')}>Состоялась</Btn><Btn small disabled={busy} onClick={() => void act(b.id, 'no-show')}>Не пришёл</Btn></>}</>}
              </div></>}
          </div>);
      })}
    </div>
  );
};

export const Schedule = () => {
  const [d, setD] = useState<{ settings: GpBookSettings; daysOff: { day: string; reason: string }[]; hoursSet: boolean } | null>(null); const [day, setDay] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await gpOwner2.booking(); if (r.ok) setD(r.data!); else bad(r); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Spin />;
  const s = d.settings;
  const save = async (patch: Partial<GpBookSettings>) => { if (busy) return; setBusy(true); const r = await gpOwner2.saveBooking(patch); setBusy(false); if (!r.ok) return bad(r); setD(r.data!); flash('Сохранено'); };
  const num = (k: 'stepMin' | 'horizonDays' | 'leadMin', label: string) => <In label={label} value={String(s[k])} onChange={(v) => setD({ ...d, settings: { ...s, [k]: Number(v.replace(/\D/g, '')) || 0 } })} max={5} />;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 space-y-2" style={card}>
        <label className="flex items-center justify-between gap-3 text-sm font-bold" style={{ color: 'var(--t1)' }}>Принимать записи
          <input type="checkbox" role="switch" checked={s.enabled} disabled={busy} onChange={(e) => void save({ enabled: e.target.checked })} /></label>
        {!d.hoursSet && <p className="text-xs" style={{ color: 'var(--amber, #f59e0b)' }}>Сначала задайте часы работы на вкладке «Карточка» — слоты строятся по ним.</p>}
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Записываться можно только на услуги с указанной длительностью (вкладка «Каталог» → тип «Услуга»). Свободное время считает сервер: часы работы − выходные − уже занятое. Одно и то же время дважды не выдаётся.</p>
        <div className="grid grid-cols-3 gap-2">{num('stepMin', 'Шаг, мин')}{num('horizonDays', 'Вперёд, дней')}{num('leadMin', 'Не позже чем за, мин')}</div>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={s.autoConfirm} onChange={(e) => void save({ autoConfirm: e.target.checked })} /> Подтверждать записи автоматически</label>
        <Btn tone="accent" disabled={busy} onClick={() => void save({ stepMin: s.stepMin, horizonDays: s.horizonDays, leadMin: s.leadMin })}>Сохранить</Btn>
      </div>
      <div className="rounded-2xl p-4 space-y-2" style={card}>
        <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Выходные и праздники</p>
        <div className="flex gap-2"><input type="date" aria-label="Дата" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={field} />
          <input aria-label="Причина" placeholder="Причина" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm" style={field} />
          <Btn small disabled={!day || busy} onClick={() => void gpOwner2.dayOff(day, true, reason).then((r) => { if (!r.ok) return bad(r); setD(r.data!); setDay(''); setReason(''); })}>Закрыть день</Btn></div>
        {d.daysOff.map((x) => <div key={x.day} className="flex items-center justify-between text-sm" style={{ color: 'var(--t2)' }}><span>{x.day}{x.reason ? ` — ${x.reason}` : ''}</span><Btn small onClick={() => void gpOwner2.dayOff(x.day, false).then((r) => { if (r.ok) setD(r.data!); else bad(r); })}>Открыть</Btn></div>)}
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Закрытие дня не отменяет уже созданные записи — отмените их вручную во вкладке «Записи».</p>
      </div>
    </div>
  );
};

export const OwnerReviews = () => {
  type Rv = { id: string; name: string; rating: number; text: string; reply: string; hidden: boolean; hiddenReason: string; at: string };
  const [rows, setRows] = useState<Rv[] | null>(null);
  const [txt, setTxt] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await gpOwner2.reviews(); if (r.ok) setRows(r.data!.reviews); else bad(r); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!rows) return <Spin />;
  if (!rows.length) return <p className="text-sm" style={{ color: 'var(--t3)' }}>Отзывов пока нет. Они появляются после выполненных заказов и состоявшихся записей.</p>;
  return (
    <div className="space-y-2">{rows.map((r) => (
      <div key={r.id} className="rounded-2xl p-3" style={{ ...card, opacity: r.hidden ? 0.6 : 1 }}>
        <p className="text-sm" style={{ color: 'var(--t1)' }}><span style={{ color: '#f59e0b' }}>{'★'.repeat(r.rating)}</span> <span translate="no" className="text-xs" style={{ color: 'var(--t3)' }}>{r.name} · {new Date(r.at).toLocaleDateString('ru-RU')}</span></p>
        {r.text && <p translate="no" className="text-sm" style={{ color: 'var(--t1)' }}>{r.text}</p>}
        {r.hidden && <p className="text-xs" style={{ color: 'var(--red)' }}>Скрыт администрацией: {r.hiddenReason}</p>}
        {r.reply ? <p translate="no" className="mt-1 text-xs" style={{ color: 'var(--t2)' }}>Ваш ответ: {r.reply}</p> : !r.hidden && (
          <div className="mt-2 flex gap-2"><input aria-label="Ответ" value={txt[r.id] ?? ''} onChange={(e) => setTxt({ ...txt, [r.id]: e.target.value })} maxLength={500} placeholder="Ответить" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm" style={field} />
            <Btn small tone="accent" disabled={(txt[r.id] ?? '').trim().length < 2} onClick={() => void gpOwner2.reply(r.id, txt[r.id]).then((x) => { if (!x.ok) return bad(x); void load(); })}>Ответить</Btn></div>)}
      </div>))}
    </div>
  );
};

export const PlaceStats = () => {
  const [days, setDays] = useState(30); const [s, setS] = useState<GpStats | null>(null);
  useEffect(() => { setS(null); void gpOwner2.stats(days).then((r) => { if (r.ok) setS(r.data!); else bad(r); }); }, [days]);
  return (
    <div className="space-y-2">
      <select aria-label="Период" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg px-3 py-2 text-sm" style={field}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select>
      {!s ? <Spin /> : <>
        <div className="grid grid-cols-2 gap-2">
          <Stat k="Заказы из каталога" v={s.orders.fromCatalog} sub={`всего заказов: ${s.orders.total}`} /><Stat k="Выполнено заказов" v={s.orders.done} sub={`${s.orders.doneRub} ₽ по выполненным`} />
          <Stat k="Записи" v={s.bookings.total} sub={`состоялись: ${s.bookings.done}, не пришли: ${s.bookings.noShow}`} /><Stat k="Отмены и отказы" v={s.orders.lost + s.bookings.lost} />
          <Stat k="Рейтинг" v={s.reviews.avg ?? '—'} sub={`отзывов: ${s.reviews.count}`} /><Stat k="В избранном" v={s.favorites} />
        </div>
        {s.top.length > 0 && <div className="rounded-2xl p-3 text-sm" style={card}><b style={{ color: 'var(--t1)' }}>Популярное</b>{s.top.map((t) => <div key={t.title} translate="no" style={{ color: 'var(--t2)' }}>{t.title} — {t.qty}</div>)}</div>}
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{s.note} Суммы — это стоимость выполненных заказов, а не поступления: Sky деньги не принимает.</p></>}
    </div>
  );
};
