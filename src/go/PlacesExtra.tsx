/** Sky GO → Организации, этап 2: запись по расписанию, отзывы, жалоба, «Мои записи». Слоты и занятость считает только сервер. */
import { useMemo, useState } from 'react';
import { CalendarClock, Star, Flag } from 'lucide-react';
import { flash } from '@/shared/flash';
import { gpBook, REPORT_REASONS, type GpBooking } from './placesApi';
import { Btn, Card, Chip, Col, Empty, ErrorState, Input, Notice, fail, useAction, useLoad, C, GO, fmt } from './ui';

const newKey = () => `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const when = (iso: string, tz?: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: tz || undefined, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hm = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit' });
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/* ─── Запись ─── */
export const BookBlock = ({ placeId, onBooked }: { placeId: string; onBooked: () => void }) => {
  const [info] = useLoad(() => gpBook.info(placeId), [placeId]);
  const [item, setItem] = useState<string>(''); const [day, setDay] = useState('');
  const [start, setStart] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [note, setNote] = useState('');
  const [key, setKey] = useState(newKey); const [done, setDone] = useState<{ label: string; at: string; payUrl?: string | null; deposit?: number } | null>(null);
  const [busy, run] = useAction();
  const d = info && info.ok ? info.data! : null;
  const [sl, reloadSl] = useLoad(async () => (item && day ? gpBook.slots(placeId, item, day) : null), [placeId, item, day]);
  const days = useMemo(() => (d?.today ? Array.from({ length: Math.min(d.horizonDays ?? 14, 14) + 1 }, (_, i) => addDays(d.today!, i)) : []), [d?.today, d?.horizonDays]);
  if (!d || !d.enabled || !d.services.length) return null;
  const svc = d.services.find((s) => s.id === item);
  const slots = sl && sl.ok ? sl.data!.slots : [];
  const submit = () => void run(async () => {
    const r = await gpBook.book(placeId, { itemId: item, start, contact: { name, phone }, note, idemKey: key });
    if (!r.ok) { if (r.error === 'slot_taken') { setStart(''); reloadSl(); } setKey(newKey()); return fail(r); }
    setDone({ label: r.data!.statusLabel, at: r.data!.startsAt, payUrl: r.data!.payUrl, deposit: r.data!.depositRub }); onBooked();
  });
  if (done) return <Card><b style={{ color: C.t1 }}>Запись создана</b><div style={{ fontSize: 13, color: C.t2, margin: '4px 0' }}>{svc?.title}, {when(done.at, d.tz)}. Статус: {done.label}. {done.payUrl ? `Чтобы удержать время, переведите задаток ${fmt(done.deposit ?? 0)} ₽ организации в течение 30 минут — иначе запись отменится.` : 'Оплата — на месте, по договорённости с организацией.'}</div>
    {done.payUrl && <a href={done.payUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: 12, borderRadius: 14, background: GO, color: '#fff', fontWeight: 800, textDecoration: 'none', marginBottom: 8 }}>Перейти к оплате задатка</a>}<Btn kind="soft" onClick={() => { setDone(null); setStart(''); setKey(newKey()); }}>Готово</Btn></Card>;
  return (
    <Card>
      <div style={{ fontWeight: 800, color: C.t1, marginBottom: 8 }}><CalendarClock size={16} style={{ verticalAlign: -3 }} /> Записаться</div>
      <Col gap={8}>
        <select aria-label="Услуга" value={item} onChange={(e) => { setItem(e.target.value); setStart(''); }} style={{ padding: 10, borderRadius: 12, background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          <option value="">Выберите услугу…</option>{d.services.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.durationMin} мин · {fmt(s.priceRub)} ₽</option>)}
        </select>
        {item && <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{days.map((x) => <button key={x} type="button" aria-pressed={day === x} onClick={() => { setDay(x); setStart(''); }} style={{ flexShrink: 0, minHeight: 40, padding: '6px 12px', borderRadius: 12, border: `1px solid ${day === x ? GO : C.brd}`, background: day === x ? GO : C.l1, color: day === x ? '#fff' : C.t1, fontSize: 13 }}>{dayLabel(x)}</button>)}</div>}
        {item && day && (!sl ? <Empty text="Загрузка…" /> : !sl.ok ? <ErrorState text="Не удалось загрузить время." onRetry={reloadSl} />
          : sl.data!.dayOff ? <Notice>В этот день организация не работает.</Notice>
          : !slots.length ? <Notice>На этот день свободного времени нет.</Notice>
          : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{slots.map((s) => <button key={s.start} type="button" aria-pressed={start === s.start} onClick={() => setStart(s.start)} style={{ minHeight: 40, minWidth: 64, padding: '6px 10px', borderRadius: 10, border: `1px solid ${start === s.start ? GO : C.brd}`, background: start === s.start ? GO : C.l1, color: start === s.start ? '#fff' : C.t1, fontWeight: 700 }}>{hm(s.start, d.tz)}</button>)}</div>)}
        {start && <>
          <Input label="Имя" value={name} onChange={setName} max={80} /><Input label="Телефон" value={phone} onChange={setPhone} type="tel" max={30} placeholder="+7…" />
          <Input label="Пожелания (необязательно)" value={note} onChange={setNote} max={300} />
          <Btn busy={busy} disabled={name.trim().length < 2 || phone.trim().length < 5} onClick={submit}>{d.autoConfirm ? 'Записаться' : 'Отправить заявку на запись'}</Btn>
          <div style={{ fontSize: 12, color: C.t3 }}>{svc && svc.depositRub > 0 ? `Нужен задаток ${fmt(svc.depositRub)} ₽ — переводом организации, Sky деньги не принимает. ` : ''}{d.autoConfirm ? 'Запись подтверждается сразу.' : 'Организация подтвердит запись — вы получите уведомление.'} {svc && svc.depositRub > 0 ? 'Остаток — на месте.' : 'Оплата не требуется: расчёт на месте.'}</div>
        </>}
      </Col>
    </Card>
  );
};

/* ─── Отзывы ─── */
const Stars = ({ n }: { n: number }) => <span aria-label={`${n} из 5`} style={{ color: '#f59e0b' }}>{'★'.repeat(n)}<span style={{ color: C.t3 }}>{'★'.repeat(5 - n)}</span></span>;
export const ReviewsBlock = ({ placeId }: { placeId: string }) => {
  const [res, reload] = useLoad(() => gpBook.reviews(placeId), [placeId]);
  const [rating, setRating] = useState(5); const [text, setText] = useState(''); const [busy, run] = useAction();
  if (!res || !res.ok) return null;
  const d = res.data!;
  return (
    <Col gap={8}>
      <div style={{ fontWeight: 800, fontSize: 17, color: C.t1 }}><Star size={16} style={{ verticalAlign: -2 }} /> Отзывы {d.avg != null && <span style={{ color: C.t2, fontWeight: 600, fontSize: 14 }}>· {d.avg} ({d.count})</span>}</div>
      {!d.reviews.length && <div style={{ fontSize: 13, color: C.t2 }}>Отзывов пока нет. Оставить отзыв можно после выполненного заказа или состоявшейся записи.</div>}
      {d.reviews.map((r) => <Card key={r.id}><div><Stars n={r.rating} /> <span translate="no" style={{ fontSize: 12, color: C.t3 }}>{r.name} · {new Date(r.at).toLocaleDateString('ru-RU')}</span></div>
        {r.text && <div translate="no" style={{ fontSize: 14, color: C.t1, margin: '4px 0' }}>{r.text}</div>}
        {r.reply && <div translate="no" style={{ fontSize: 13, color: C.t2, borderLeft: `3px solid ${GO}`, paddingLeft: 8 }}>Ответ организации: {r.reply}</div>}</Card>)}
      {d.canReview && <Card><div style={{ fontWeight: 700, color: C.t1, marginBottom: 6 }}>Ваш отзыв</div>
        <div role="radiogroup" aria-label="Оценка" style={{ display: 'flex', gap: 4, marginBottom: 6 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}`} onClick={() => setRating(n)} style={{ fontSize: 28, background: 'none', border: 'none', minWidth: 44, minHeight: 44, color: n <= rating ? '#f59e0b' : C.t3 }}>★</button>)}</div>
        <Input label="Комментарий (необязательно)" value={text} onChange={setText} max={1000} area />
        <Btn busy={busy} onClick={() => void run(async () => { const r = await gpBook.review(placeId, rating, text); if (!r.ok) return fail(r); flash('Спасибо за отзыв'); setText(''); reload(); })}>Отправить отзыв</Btn></Card>}
    </Col>
  );
};

/* ─── Жалоба ─── */
export const ReportBlock = ({ placeId }: { placeId: string }) => {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState('wrong_info'); const [text, setText] = useState(''); const [busy, run] = useAction();
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ background: 'none', border: 'none', color: C.t3, fontSize: 13, minHeight: 44 }}><Flag size={13} style={{ verticalAlign: -2 }} /> Пожаловаться на организацию</button>;
  return (
    <Card><Col gap={8}>
      <select aria-label="Причина" value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: 10, borderRadius: 12, background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{Object.entries(REPORT_REASONS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <Input label="Что не так" value={text} onChange={setText} max={500} area />
      <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} onClick={() => void run(async () => { const r = await gpBook.report(placeId, reason, text); if (!r.ok) return fail(r); flash('Жалоба отправлена — её проверит администрация'); setOpen(false); setText(''); })}>Отправить</Btn><Btn kind="soft" onClick={() => setOpen(false)}>Отмена</Btn></div>
    </Col></Card>
  );
};

/* ─── Мои записи ─── */
export const MyBookings = () => {
  const [res, reload] = useLoad(() => gpBook.mine(), [], 30000); const [busy, run] = useAction();
  const list: GpBooking[] = res && res.ok ? res.data!.bookings : [];
  if (!res) return <Empty text="Загрузка…" />;
  if (!res.ok) return <ErrorState text="Не удалось загрузить записи." onRetry={reload} />;
  if (!list.length) return <Empty text="Записей пока нет" />;
  return (
    <Col>{list.map((b) => (
      <Card key={b.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b translate="no" style={{ color: C.t1 }}>{b.placeName}</b><span style={{ color: C.t1, fontWeight: 700 }}>{when(b.startsAt, b.tz)}</span></div>
        <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{b.item} · {fmt(b.priceRub)} ₽{b.address ? ` · ${b.address}` : ''}</div>
        <div style={{ margin: '6px 0' }}><Chip>{b.statusLabel}</Chip></div>
        {b.comment && <div translate="no" style={{ fontSize: 12, color: C.t2 }}>{b.comment}</div>}
        {b.payUrl && <a href={b.payUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: 12, borderRadius: 12, background: GO, color: '#fff', fontWeight: 800, textDecoration: 'none', marginBottom: 6 }}>Оплатить задаток {fmt(b.depositRub ?? 0)} ₽</a>}
        {b.canCancel && <Btn kind="danger" busy={busy} onClick={() => void run(async () => { const r = await gpBook.cancel(b.id); if (!r.ok) return fail(r); flash('Запись отменена'); reload(); })}>Отменить запись</Btn>}
      </Card>))}
    </Col>
  );
};
