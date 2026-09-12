/**
 * Кабинет организатора.
 *
 * Открывается по подписке 159 ₽ в месяц — но «открывается» здесь
 * означает «сервер разрешил»: этот файл лишь показывает то, что сервер
 * уже решил. Поставить себе active в состоянии React можно, только
 * ни одно действие от этого не пройдёт — каждое из них сервер
 * проверяет заново.
 *
 * Отдельно про истёкшую подписку. Она закрывает действия, а не данные:
 * список мероприятий, продажи, статистика, билеты и контроль на входе
 * остаются доступны. Купленный билет не должен переставать работать
 * оттого, что у организатора кончился месяц.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Plus, Pencil, Trash2, ScanLine, BarChart3, Users,
  Wallet, Loader2, CheckCircle2, XCircle, AlertTriangle, ImagePlus,
  Ticket as TicketIcon, Eye, ShieldCheck, Hash, Search,
} from 'lucide-react';
import {
  apiOrganizer, apiPayOrganizer, apiSetOrganizerName, apiMyEvents,
  apiCreateEvent, apiUpdateEvent, apiPublishProblems, apiSubmitEvent, apiSetEventStatus,
  apiCreateType, apiUpdateType, apiDeleteType, apiUploadCover,
  apiEventTickets, apiEventOrders, apiEventStats,
  apiScan, apiSetTicketStatus, apiExpireRemaining,
  apiEvent, newIdemKey, coverUrl,
  type TicketEvent, type TicketType, type Ticket, type Order,
  type Subscription, type OrganizerSummary, type EventStats, type Payment,
  type ScanResult, type ScanVerdict,
} from './ticketsApi';
import {
  fmtMoney, fmtDate, fmtWhen, fmtStamp, hueOf, bgGrad, categoryIcon,
  EVENT_STATUS_LABEL, EVENT_STATUS_COLOR, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR,
} from './ticketsUi';

const CATEGORIES = ['Концерты', 'Театр', 'Спорт', 'Стендап', 'Фестивали', 'Шоу', 'Детские', 'Выставки', 'Кино', 'Другое'];
const ACCENTS = ['#4e8cf7', '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b', '#22c55e', '#14b8a6'];

/** Дата для <input type="datetime-local"> — по местному времени браузера. */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromLocalInput = (value: string) => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/* ─── Мелкие детали оформления ──────────────────────────────────── */

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>{label}</span>
    <div className="mt-1.5">{children}</div>
    {hint && <span className="text-[10px] mt-1 block" style={{ color: 'var(--t3)' }}>{hint}</span>}
  </label>
);

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)',
};

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ ...inputStyle, ...props.style }} />
);

const Area = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none resize-none" style={{ ...inputStyle, ...props.style }} />
);

const Note = ({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: React.ReactNode }) => {
  const color = kind === 'error' ? 'var(--red)' : kind === 'ok' ? 'var(--green)' : 'var(--amber)';
  const bg = kind === 'error' ? 'rgba(244,63,94,0.08)' : kind === 'ok' ? 'rgba(0,200,90,0.08)' : 'rgba(245,158,11,0.08)';
  return <p className="text-xs font-semibold rounded-xl px-3 py-2" style={{ background: bg, color }}>{children}</p>;
};

const Head = ({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) => (
  <div className="flex items-center gap-3 px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
    <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={onBack} aria-label="Назад"
      className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}>
      <ArrowLeft size={18} />
    </motion.button>
    <p className="flex-1 text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{title}</p>
    {right}
  </div>
);

/* ══════════════════════════════════════════════════════════════════
   Контроль на входе
   ══════════════════════════════════════════════════════════════════ */

/**
 * Экран контролёра: набрал код — увидел ответ.
 *
 * Решение принимает сервер: здесь мы его только показываем. «Годен»
 * и «уже прошёл» отличаются не цветом рамки, а тем, что сервер
 * отметил билет — и отметил ровно один раз, даже если два контролёра
 * поднесут телефон одновременно.
 */
const CheckIn = ({ onBack }: { onBack: () => void }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<{ code: string; result: ScanVerdict; at: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (mark: boolean) => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    const r = await apiScan({ code: value }, mark);
    setBusy(false);
    setRes(r);
    setHistory(h => [{ code: value, result: r.result, at: new Date().toLocaleTimeString('ru-RU') }, ...h].slice(0, 20));
    if (mark) { setCode(''); inputRef.current?.focus(); }
  };

  const markExpired = async () => {
    const t = res?.ticket;
    if (!t) return;
    setBusy(true);
    const r = await apiSetTicketStatus(t.id, 'expired');
    setBusy(false);
    if (r.ok) setRes({ result: 'expired', ticket: { ...t, status: 'expired' } });
  };

  const verdict = res?.result;
  const good = verdict === 'ok' || verdict === 'valid';
  const color = verdict === 'ok' || verdict === 'valid' ? 'var(--green)'
    : verdict === 'not_found' ? 'var(--red)'
      : 'var(--amber)';
  const label = verdict === 'ok' ? 'Пропустить — отмечен'
    : verdict === 'valid' ? 'Действителен'
      : verdict === 'not_found' ? 'Билет не найден'
        : verdict ? TICKET_STATUS_LABEL[verdict] ?? verdict : '';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Head title="Контроль на входе" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <Field label="Код билета" hint="SKY-XXXX-XXXX. Можно без дефисов и без «SKY».">
            <input ref={inputRef} value={code} autoFocus
              onChange={e => { setCode(e.target.value); setRes(null); }}
              onKeyDown={e => { if (e.key === 'Enter') void run(false); }}
              placeholder="SKY-A2C4-K7M9"
              aria-label="Код билета"
              data-checkin-code
              className="w-full rounded-xl px-3.5 py-3 text-lg font-mono font-black tracking-widest outline-none"
              style={{ ...inputStyle, textTransform: 'uppercase' }} />
          </Field>
          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void run(false)} disabled={busy || !code.trim()}
              data-checkin-inspect
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer', opacity: code.trim() ? 1 : 0.5 }}>
              <Search size={13} className="inline mr-1" />Проверить
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void run(true)} disabled={busy || !code.trim()}
              data-checkin-mark
              className="flex-1 rounded-xl py-2.5 text-sm font-black"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: code.trim() ? 1 : 0.5 }}>
              {busy ? <Loader2 size={14} className="inline animate-spin" /> : <><ScanLine size={13} className="inline mr-1" />Погасить</>}
            </motion.button>
          </div>
        </div>

        {res && (
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            data-checkin-result={verdict}
            className="rounded-2xl p-5 text-center" style={{ background: 'var(--bg-l2)', border: `1.5px solid ${color}` }}>
            {good
              ? <CheckCircle2 size={40} className="mx-auto mb-2" style={{ color }} />
              : verdict === 'not_found'
                ? <XCircle size={40} className="mx-auto mb-2" style={{ color }} />
                : <AlertTriangle size={40} className="mx-auto mb-2" style={{ color }} />}
            <p className="text-lg font-black" style={{ color }}>{label}</p>
            {res.ticket && (
              <div className="mt-3 text-left space-y-1">
                <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{res.ticket.eventTitle}</p>
                <p className="text-xs" style={{ color: 'var(--t3)' }}>
                  {res.ticket.typeName} · место {res.ticket.seatNo} · {fmtWhen(res.ticket.startsAt)}
                </p>
                <p className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{res.ticket.code}</p>
                {res.ticket.usedAt && (
                  <p className="text-xs" style={{ color: 'var(--amber)' }}>Отмечен {fmtStamp(res.ticket.usedAt)}</p>
                )}
                {res.ticket.status !== 'expired' && (
                  <button type="button" onClick={() => void markExpired()} disabled={busy}
                    data-checkin-expire
                    className="mt-2 w-full rounded-xl py-2 text-xs font-bold"
                    style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer' }}>
                    Пометить просроченным
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}

        {history.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)', borderBottom: '1px solid var(--border)' }}>
              Последние проверки
            </p>
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--t2)' }}>{h.code.toUpperCase()}</span>
                <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{h.at}</span>
                <span className="text-[10px] font-bold" style={{ color: h.result === 'ok' || h.result === 'valid' ? 'var(--green)' : h.result === 'not_found' ? 'var(--red)' : 'var(--amber)' }}>
                  {h.result === 'ok' ? 'отмечен' : h.result === 'valid' ? 'годен' : h.result === 'not_found' ? 'нет такого' : TICKET_STATUS_LABEL[h.result] ?? h.result}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   Один мероприятие в кабинете
   ══════════════════════════════════════════════════════════════════ */

type EventPane = 'edit' | 'types' | 'tickets' | 'orders' | 'stats';

const EventEditor = ({ eventId, onBack, onChanged }: {
  eventId: string;
  onBack: () => void;
  onChanged: () => void;
}) => {
  const [pane, setPane] = useState<EventPane>('edit');
  const [ev, setEv] = useState<TicketEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  const [form, setForm] = useState({
    title: '', desc: '', category: 'Другое', ageLimit: 0,
    startsAt: '', endsAt: '', city: '', venue: '', address: '', venueNote: '', accent: ACCENTS[0],
  });

  const reload = useCallback(async () => {
    const full = await apiEvent(eventId);
    if (!full) { onBack(); return; }
    setEv(full);
    setForm({
      title: full.title, desc: full.desc, category: full.category, ageLimit: full.ageLimit,
      startsAt: toLocalInput(full.startsAt), endsAt: toLocalInput(full.endsAt),
      city: full.city, venue: full.venue, address: full.address, venueNote: full.venueNote,
      accent: full.accent,
    });
    setProblems(await apiPublishProblems(eventId));
  }, [eventId, onBack]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    setBusy(true); setError(''); setOkMsg('');
    const r = await apiUpdateEvent(eventId, {
      title: form.title, desc: form.desc, category: form.category, ageLimit: form.ageLimit,
      startsAt: fromLocalInput(form.startsAt), endsAt: form.endsAt ? fromLocalInput(form.endsAt) : null,
      city: form.city, venue: form.venue, address: form.address, venueNote: form.venueNote,
      accent: form.accent,
    });
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setOkMsg('Сохранено');
    setProblems(await apiPublishProblems(eventId));
    onChanged();
  };

  const submit = async () => {
    setBusy(true); setError(''); setOkMsg('');
    const r = await apiSubmitEvent(eventId);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      if (r.problems) setProblems(r.problems);
      return;
    }
    setOkMsg('Отправлено на проверку');
    await reload();
    onChanged();
  };

  const setStatus = async (status: TicketEvent['status']) => {
    setBusy(true); setError('');
    const r = await apiSetEventStatus(eventId, status);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    await reload();
    onChanged();
  };

  if (!ev) {
    return <div className="grid h-full place-items-center"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;
  }

  const hue = hueOf(ev.accent);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Head title={ev.title} onBack={onBack}
        right={
          <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0"
            style={{ background: 'var(--bg-l3)', color: EVENT_STATUS_COLOR[ev.status] }}>
            {EVENT_STATUS_LABEL[ev.status]}
          </span>
        } />

      <div className="flex gap-1 px-5 py-2.5 shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)', scrollbarWidth: 'none' }}>
        {([['edit', 'Афиша'], ['types', 'Билеты'], ['tickets', 'Проданные'], ['orders', 'Заказы'], ['stats', 'Статистика']] as [EventPane, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPane(k)}
            data-event-pane={k}
            className="shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold"
            style={{ background: pane === k ? 'var(--accent)' : 'var(--bg-l2)', color: pane === k ? '#fff' : 'var(--t3)', border: `1px solid ${pane === k ? 'transparent' : 'var(--border)'}`, cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
        {error && <Note kind="error">{error}</Note>}
        {okMsg && <Note kind="ok">{okMsg}</Note>}

        {pane === 'edit' && (
          <>
            {ev.rejectReason && <Note kind="warn">Отклонено: {ev.rejectReason}</Note>}

            <CoverPicker ev={ev} hue={hue} onDone={() => void reload()} />

            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <Field label="Название"><Input value={form.title} maxLength={120} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></Field>
              <Field label="Описание" hint="От 20 символов — иначе не опубликовать.">
                <Area rows={4} value={form.desc} maxLength={5000} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Категория">
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Возраст">
                  <select value={form.ageLimit} onChange={e => setForm(f => ({ ...f, ageLimit: Number(e.target.value) }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle}>
                    {[0, 6, 12, 16, 18, 21].map(n => <option key={n} value={n}>{n === 0 ? 'без ограничений' : `${n}+`}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Начало"><Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} /></Field>
                <Field label="Окончание"><Input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Город"><Input value={form.city} maxLength={80} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></Field>
                <Field label="Площадка"><Input value={form.venue} maxLength={200} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} /></Field>
              </div>
              <Field label="Адрес"><Input value={form.address} maxLength={200} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></Field>
              <Field label="Как пройти" hint="Необязательно: вход со двора, нужен паспорт и так далее.">
                <Input value={form.venueNote} maxLength={200} onChange={e => setForm(f => ({ ...f, venueNote: e.target.value }))} />
              </Field>
              <Field label="Цвет">
                <div className="flex gap-2 flex-wrap">
                  {ACCENTS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, accent: c }))}
                      aria-label={`Цвет ${c}`}
                      className="h-8 w-8 rounded-full"
                      style={{ background: c, border: form.accent === c ? '2px solid var(--t1)' : '2px solid transparent', cursor: 'pointer' }} />
                  ))}
                </div>
              </Field>

              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void save()} disabled={busy}
                data-event-save
                className="w-full rounded-xl py-3 text-sm font-black"
                style={{ background: `hsl(${hue},65%,42%)`, color: '#fff', border: 'none', cursor: 'pointer' }}>
                {busy ? <Loader2 size={14} className="inline animate-spin" /> : 'Сохранить'}
              </motion.button>
            </div>

            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Публикация</p>
              {problems.length > 0
                ? (
                  <div className="space-y-1.5">
                    {problems.map(p => (
                      <p key={p} className="flex items-center gap-2 text-xs" style={{ color: 'var(--amber)' }}>
                        <AlertTriangle size={12} />{p}
                      </p>
                    ))}
                  </div>
                )
                : <p className="flex items-center gap-2 text-xs" style={{ color: 'var(--green)' }}><CheckCircle2 size={12} />Всё заполнено</p>}

              {(ev.status === 'draft') && (
                <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void submit()} disabled={busy || problems.length > 0}
                  data-event-submit
                  className="w-full rounded-xl py-2.5 text-sm font-bold"
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', opacity: problems.length > 0 ? 0.5 : 1 }}>
                  Отправить на проверку
                </motion.button>
              )}
              {ev.status === 'pending' && (
                <>
                  <Note kind="warn">Ждёт проверки модератором</Note>
                  <button type="button" onClick={() => void setStatus('draft')} disabled={busy}
                    className="w-full rounded-xl py-2.5 text-sm font-bold"
                    style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    Вернуть в черновики
                  </button>
                </>
              )}
              {ev.status === 'published' && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void setStatus('paused')} disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-xs font-bold"
                    style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    Пауза продаж
                  </button>
                  <button type="button" onClick={() => void setStatus('cancelled')} disabled={busy}
                    className="flex-1 rounded-xl py-2.5 text-xs font-bold"
                    style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.2)', cursor: 'pointer' }}>
                    Отменить
                  </button>
                </div>
              )}
              {ev.status === 'paused' && (
                <button type="button" onClick={() => void setStatus('published')} disabled={busy}
                  className="w-full rounded-xl py-2.5 text-sm font-bold"
                  style={{ background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Возобновить продажи
                </button>
              )}
              {ev.status === 'cancelled' && <Note kind="error">Мероприятие отменено, билеты погашены</Note>}
            </div>
          </>
        )}

        {pane === 'types' && <TypesPane ev={ev} onChanged={() => void reload()} />}
        {pane === 'tickets' && <SoldTicketsPane eventId={eventId} />}
        {pane === 'orders' && <OrdersPane eventId={eventId} />}
        {pane === 'stats' && <StatsPane eventId={eventId} />}
      </div>
    </div>
  );
};

/* ─── Афиша: картинка ───────────────────────────────────────────── */

const CoverPicker = ({ ev, hue, onDone }: { ev: TicketEvent; hue: number; onDone: () => void }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const Icon = categoryIcon(ev.category);
  /* Чтобы браузер не показал старую картинку из кэша после замены. */
  const [bust, setBust] = useState(0);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setPercent(0);
    const { promise } = apiUploadCover(ev.id, 'cover', file, setPercent);
    const r = await promise;
    setPercent(null);
    if (!r.ok) { setError(r.reason ?? 'Не получилось'); return; }
    setBust(Date.now());
    onDone();
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="relative" style={{ height: 140, background: bgGrad(hue) }}>
        {ev.hasCover
          ? <img src={`${coverUrl(ev.id)}${bust ? `?v=${bust}` : ''}`} alt="" className="h-full w-full object-cover" />
          : (
            <div className="absolute inset-0 grid place-items-center" style={{ opacity: 0.25 }}>
              <Icon size={48} style={{ color: '#fff' }} />
            </div>
          )}
        {percent !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <div className="h-full" style={{ width: `${percent}%`, background: 'var(--accent)' }} />
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={percent !== null}
          data-cover-pick
          className="w-full rounded-xl py-2.5 text-sm font-bold"
          style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          <ImagePlus size={13} className="inline mr-1" />
          {percent !== null ? `Загрузка ${percent}%` : ev.hasCover ? 'Заменить афишу' : 'Загрузить афишу'}
        </button>
        {/* Тип файла определяет сервер по первым байтам: подпись в
            Content-Type и расширение ничего не решают. */}
        <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--t3)' }}>JPEG, PNG или WebP, до 6 МБ</p>
        {error && <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>{error}</p>}
      </div>
    </div>
  );
};

/* ─── Типы билетов ──────────────────────────────────────────────── */

const TypesPane = ({ ev, onChanged }: { ev: TicketEvent; onChanged: () => void }) => {
  const [types, setTypes] = useState<TicketType[]>(ev.types ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', desc: '', price: '', quantity: '', perUserMax: '8' });
  const [editing, setEditing] = useState<string | null>(null);
  const [patch, setPatch] = useState({ name: '', price: '', quantity: '', perUserMax: '', status: 'active' });

  useEffect(() => { setTypes(ev.types ?? []); }, [ev]);

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  const add = async () => {
    setBusy(true); setError('');
    const r = await apiCreateType(ev.id, {
      name: draft.name, desc: draft.desc,
      price: num(draft.price), quantity: num(draft.quantity), perUserMax: num(draft.perUserMax),
    });
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setTypes(r.types);
    setAdding(false);
    setDraft({ name: '', desc: '', price: '', quantity: '', perUserMax: '8' });
    onChanged();
  };

  const saveEdit = async (id: string) => {
    setBusy(true); setError('');
    const r = await apiUpdateType(id, {
      name: patch.name || undefined,
      price: num(patch.price), quantity: num(patch.quantity), perUserMax: num(patch.perUserMax),
      status: patch.status as TicketType['status'],
    });
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setTypes(r.types);
    setEditing(null);
    onChanged();
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    const r = await apiDeleteType(id);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setTypes(r.types);
    onChanged();
  };

  return (
    <div className="space-y-3">
      {error && <Note kind="error">{error}</Note>}

      {types.map(t => (
        <div key={t.id} data-type-row={t.id}
          className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          {editing === t.id
            ? (
              <div className="space-y-3">
                <Field label="Название"><Input value={patch.name} onChange={e => setPatch(p => ({ ...p, name: e.target.value }))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Цена, ₽"><Input inputMode="numeric" value={patch.price} onChange={e => setPatch(p => ({ ...p, price: e.target.value }))} /></Field>
                  <Field label="Мест" hint={`продано ${t.sold ?? 0}`}>
                    <Input inputMode="numeric" value={patch.quantity} onChange={e => setPatch(p => ({ ...p, quantity: e.target.value }))} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="В одни руки"><Input inputMode="numeric" value={patch.perUserMax} onChange={e => setPatch(p => ({ ...p, perUserMax: e.target.value }))} /></Field>
                  <Field label="Состояние">
                    <select value={patch.status} onChange={e => setPatch(p => ({ ...p, status: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle}>
                      <option value="active">В продаже</option>
                      <option value="hidden">Скрыт</option>
                      <option value="closed">Продажа закрыта</option>
                    </select>
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(null)}
                    className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>Отмена</button>
                  <button type="button" onClick={() => void saveEdit(t.id)} disabled={busy}
                    className="flex-1 rounded-xl py-2 text-xs font-black" style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>Сохранить</button>
                </div>
              </div>
            )
            : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{t.name}</p>
                  <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{fmtMoney(t.price)}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
                    продано {t.sold ?? 0} из {t.quantity ?? 0} · в одни руки {t.perUserMax}
                  </p>
                  <p className="text-[10px] mt-1 font-bold" style={{ color: t.status === 'active' ? 'var(--green)' : 'var(--t3)' }}>
                    {t.status === 'active' ? 'в продаже' : t.status === 'hidden' ? 'скрыт' : 'продажа закрыта'}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" aria-label="Изменить"
                    onClick={() => { setEditing(t.id); setPatch({ name: t.name, price: String(t.price), quantity: String(t.quantity ?? 0), perUserMax: String(t.perUserMax), status: t.status }); }}
                    className="grid h-8 w-8 place-items-center rounded-lg"
                    style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    <Pencil size={13} />
                  </button>
                  {/* Удалить можно только то, по чему ещё нет продаж: это решает сервер. */}
                  <button type="button" aria-label="Удалить" onClick={() => void remove(t.id)} disabled={busy}
                    className="grid h-8 w-8 place-items-center rounded-lg"
                    style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.2)', cursor: 'pointer' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
        </div>
      ))}

      {adding
        ? (
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <Field label="Название"><Input value={draft.name} placeholder="Вход · Партер · VIP" onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></Field>
            <Field label="Описание"><Input value={draft.desc} onChange={e => setDraft(d => ({ ...d, desc: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Цена, ₽"><Input inputMode="numeric" value={draft.price} placeholder="500" onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} /></Field>
              <Field label="Мест"><Input inputMode="numeric" value={draft.quantity} placeholder="100" onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} /></Field>
            </div>
            <Field label="В одни руки"><Input inputMode="numeric" value={draft.perUserMax} onChange={e => setDraft(d => ({ ...d, perUserMax: e.target.value }))} /></Field>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)}
                className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>Отмена</button>
              <button type="button" onClick={() => void add()} disabled={busy}
                data-type-add
                className="flex-1 rounded-xl py-2.5 text-xs font-black" style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>Добавить</button>
            </div>
          </div>
        )
        : (
          <button type="button" onClick={() => setAdding(true)}
            data-type-new
            className="w-full rounded-2xl py-3 text-sm font-bold"
            style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px dashed var(--border)', cursor: 'pointer' }}>
            <Plus size={14} className="inline mr-1" />Добавить тип билета
          </button>
        )}
    </div>
  );
};

/* ─── Проданные билеты ──────────────────────────────────────────── */

/**
 * Список проданных билетов — по одному на каждое место, с кодом.
 *
 * Это то место, где организатор находит билет по коду и гасит его или
 * помечает просроченным. Отметка ложится в ту же строку, которую
 * читает список покупателя, поэтому у него билет меняется тоже.
 */
const SoldTicketsPane = ({ eventId }: { eventId: string }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const page = await apiEventTickets(eventId, { status, q: q.trim(), limit: 200 });
    setBusy(false);
    setTickets(page?.tickets ?? []);
  }, [eventId, status, q]);

  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const change = async (t: Ticket, next: 'expired' | 'valid' | 'cancelled') => {
    setBusy(true); setError('');
    const r = await apiSetTicketStatus(t.id, next);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setTickets(list => list.map(x => x.id === t.id ? { ...x, status: r.status } : x));
  };

  const expireAll = async () => {
    setBusy(true); setError('');
    const r = await apiExpireRemaining(eventId);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    void load();
  };

  return (
    <div className="space-y-3">
      {error && <Note kind="error">{error}</Note>}

      <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
        <Hash size={14} style={{ color: 'var(--t3)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти по коду билета"
          aria-label="Поиск по коду билета" data-sold-search
          className="flex-1 text-sm bg-transparent outline-none font-mono" style={{ color: 'var(--t1)' }} />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Очистить" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>×</button>}
      </div>

      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['all', 'Все'], ['valid', 'Действующие'], ['used', 'Прошли'], ['expired', 'Просроченные'], ['cancelled', 'Отменённые']] as [string, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold"
            style={{ background: status === k ? 'var(--bg-l3)' : 'transparent', color: status === k ? 'var(--t1)' : 'var(--t3)', border: `1px solid ${status === k ? 'var(--border)' : 'transparent'}`, cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      {busy && tickets.length === 0 && <div className="grid place-items-center h-24"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}

      {tickets.map(t => (
        <div key={t.id} data-sold-ticket={t.code}
          className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-black font-mono tracking-widest" style={{ color: 'var(--accent)' }}>{t.code}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>{t.typeName} · место {t.seatNo} · {fmtMoney(t.price)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
                {t.buyer}{t.buyerUsername ? ` · ${t.buyerUsername}` : ''}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>куплен {fmtStamp(t.createdAt)}</p>
              {t.usedAt && <p className="text-[10px]" style={{ color: 'var(--t3)' }}>прошёл {fmtStamp(t.usedAt)}</p>}
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0"
              style={{ background: 'var(--bg-l3)', color: TICKET_STATUS_COLOR[t.status] }}>
              {TICKET_STATUS_LABEL[t.status]}
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            {t.status === 'valid' && (
              <button type="button" onClick={() => void change(t, 'expired')} disabled={busy}
                data-sold-expire={t.code}
                className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer' }}>
                Пометить просроченным
              </button>
            )}
            {(t.status === 'expired' || t.status === 'cancelled') && (
              <button type="button" onClick={() => void change(t, 'valid')} disabled={busy}
                className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{ background: 'rgba(0,200,90,0.08)', color: 'var(--green)', border: '1px solid rgba(0,200,90,0.2)', cursor: 'pointer' }}>
                Вернуть в действующие
              </button>
            )}
            {t.status === 'used' && (
              <p className="flex-1 text-center text-xs py-2" style={{ color: 'var(--t3)' }}>Прошёл контроль</p>
            )}
          </div>
        </div>
      ))}

      {!busy && tickets.length === 0 && (
        <div className="grid place-items-center h-32 text-center">
          <div>
            <TicketIcon size={30} className="mx-auto mb-2" style={{ color: 'var(--t3)' }} />
            <p className="text-sm" style={{ color: 'var(--t3)' }}>{q ? 'Билет с таким кодом не найден' : 'Билетов пока нет'}</p>
          </div>
        </div>
      )}

      {tickets.some(t => t.status === 'valid') && (
        <button type="button" onClick={() => void expireAll()} disabled={busy}
          data-expire-all
          className="w-full rounded-xl py-2.5 text-xs font-bold"
          style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--amber)', border: '1px dashed rgba(245,158,11,0.3)', cursor: 'pointer' }}>
          Пометить просроченными все непогашенные
        </button>
      )}
    </div>
  );
};

/* ─── Заказы ────────────────────────────────────────────────────── */

const OrdersPane = ({ eventId }: { eventId: string }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => { void (async () => { setOrders(await apiEventOrders(eventId)); setBusy(false); })(); }, [eventId]);

  if (busy) return <div className="grid place-items-center h-24"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;
  if (orders.length === 0) return <p className="text-sm text-center py-10" style={{ color: 'var(--t3)' }}>Заказов пока нет</p>;

  return (
    <div className="space-y-2">
      {orders.map(o => (
        <div key={o.id} className="rounded-2xl px-4 py-3 flex items-center justify-between"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{o.buyer}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>
              {o.typeName} × {o.quantity} · {fmtStamp(o.paidAt ?? o.createdAt)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>{fmtMoney(o.total)}</p>
            <p className="text-[10px] font-bold" style={{ color: o.status === 'paid' ? 'var(--green)' : 'var(--t3)' }}>
              {o.status === 'paid' ? 'оплачен' : o.status === 'cancelled' ? 'отменён' : o.status === 'refunded' ? 'возвращён' : 'ждёт оплаты'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── Статистика ────────────────────────────────────────────────── */

const StatsPane = ({ eventId }: { eventId: string }) => {
  const [s, setS] = useState<EventStats | null>(null);

  useEffect(() => { void (async () => setS(await apiEventStats(eventId)))(); }, [eventId]);

  if (!s) return <div className="grid place-items-center h-24"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;

  const maxRevenue = Math.max(1, ...s.daily.map(d => d.revenue));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([
          ['Продано', `${s.sold}`, 'var(--t1)'],
          ['Выручка', fmtMoney(s.revenue), 'var(--green)'],
          ['Заказов', `${s.orders}`, 'var(--t1)'],
          ['Просмотров', `${s.views}`, 'var(--t1)'],
          ['Осталось мест', `${s.available}`, 'var(--amber)'],
          ['Всего мест', `${s.capacity}`, 'var(--t3)'],
        ] as [string, string, string][]).map(([k, v, c]) => (
          <div key={k} className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>{k}</p>
            <p className="text-lg font-black mt-1" style={{ color: c }}>{v}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>Контроль на входе</p>
        <div className="flex flex-wrap gap-2">
          {([['valid', 'Действующие'], ['used', 'Прошли'], ['expired', 'Просрочены'], ['cancelled', 'Отменены'], ['refunded', 'Возвращены']] as [keyof EventStats['checkin'], string][]).map(([k, l]) => (
            <div key={k} className="rounded-xl px-3 py-2" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
              <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{l}</p>
              <p className="text-sm font-black" style={{ color: TICKET_STATUS_COLOR[k] }}>{s.checkin[k]}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>По типам билетов</p>
        {s.byType.map(t => {
          const pct = t.quantity > 0 ? Math.round((t.sold / t.quantity) * 100) : 0;
          return (
            <div key={t.id} className="mb-3 last:mb-0">
              <div className="flex justify-between items-center mb-1">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--t2)' }}>{t.name} · {fmtMoney(t.price)}</p>
                <p className="text-xs font-bold shrink-0" style={{ color: 'var(--t1)' }}>{t.sold} / {t.quantity}</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>выручка {fmtMoney(t.revenue)}</p>
            </div>
          );
        })}
        {s.byType.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Типов билетов ещё нет</p>}
      </div>

      {s.daily.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>По дням</p>
          <div className="flex items-end gap-1.5" style={{ height: 80 }}>
            {s.daily.map(d => (
              <div key={d.day} className="flex-1 rounded-t" title={`${d.day}: ${fmtMoney(d.revenue)}`}
                style={{ height: `${Math.max(4, Math.round((d.revenue / maxRevenue) * 100))}%`, background: 'var(--accent)', opacity: 0.8 }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   Кабинет
   ══════════════════════════════════════════════════════════════════ */

export const OrganizerCabinet = ({ onBack, onSubscription }: {
  onBack: () => void;
  onSubscription?: (s: Subscription) => void;
}) => {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [summary, setSummary] = useState<OrganizerSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<'list' | 'checkin'>('list');
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', startsAt: '', city: '', venue: '', category: 'Концерты' });
  const [name, setName] = useState('');
  const [nameOpen, setNameOpen] = useState(false);

  const payKey = useRef<string>(newIdemKey());

  const load = useCallback(async () => {
    const [org, mine] = await Promise.all([apiOrganizer(), apiMyEvents('all')]);
    if (org) {
      setSub(org.subscription);
      setSummary(org.summary);
      setPayments(org.payments);
      setName(org.subscription.displayName ?? '');
      onSubscription?.(org.subscription);
    }
    if (mine) setEvents(mine.events);
    setLoading(false);
  }, [onSubscription]);

  useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    setBusy(true); setError('');
    const r = await apiPayOrganizer(payKey.current);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    payKey.current = newIdemKey();
    await load();
  };

  const saveName = async () => {
    setBusy(true);
    const s = await apiSetOrganizerName(name);
    setBusy(false);
    if (s) { setSub(s); onSubscription?.(s); }
    setNameOpen(false);
  };

  const create = async () => {
    setBusy(true); setError('');
    const r = await apiCreateEvent({
      title: newEvent.title,
      startsAt: fromLocalInput(newEvent.startsAt),
      city: newEvent.city,
      venue: newEvent.venue,
      category: newEvent.category,
    });
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setCreating(false);
    setNewEvent({ title: '', startsAt: '', city: '', venue: '', category: 'Концерты' });
    await load();
    setEditing(r.event.id);
  };

  if (screen === 'checkin') return <CheckIn onBack={() => { setScreen('list'); void load(); }} />;
  if (editing) return <EventEditor eventId={editing} onBack={() => { setEditing(null); void load(); }} onChanged={() => void load()} />;

  if (loading) return <div className="grid h-full place-items-center"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;

  const active = sub?.active === true;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Head title="Кабинет организатора" onBack={onBack}
        right={
          <button type="button" onClick={() => setScreen('checkin')}
            data-open-checkin
            className="rounded-xl px-3 py-1.5 text-xs font-bold shrink-0"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)', cursor: 'pointer' }}>
            <ScanLine size={12} className="inline mr-1" />Контроль
          </button>
        } />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
        {error && <Note kind="error">{error}</Note>}

        {/* ── Подписка ──
            Активность решает сервер: здесь только показ его ответа. */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: `1px solid ${active ? 'rgba(0,200,90,0.2)' : 'var(--border)'}` }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Кабинет организатора</p>
              <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
                {sub?.price ?? 159} ₽ в месяц · оплата со счёта Sky
              </p>
            </div>
            <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0"
              data-subscription-state={active ? 'active' : sub?.status ?? 'inactive'}
              style={{ background: 'var(--bg-l3)', color: active ? 'var(--green)' : sub?.status === 'expired' ? 'var(--amber)' : 'var(--t3)' }}>
              {active ? 'активна' : sub?.status === 'expired' ? 'истекла' : 'не оформлена'}
            </span>
          </div>

          {active && sub?.activeUntil && (
            <p className="text-xs mt-3" style={{ color: 'var(--t2)' }}>
              Действует до {fmtDate(sub.activeUntil)} · осталось {sub.daysLeft} дн.
            </p>
          )}
          {!active && sub?.status === 'expired' && (
            <p className="text-xs mt-3" style={{ color: 'var(--amber)' }}>
              Мероприятия, продажи и статистика на месте. Проданные билеты
              продолжают действовать. Закрыты только новые действия.
            </p>
          )}

          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void pay()} disabled={busy}
            data-subscription-pay
            className="w-full rounded-xl py-3 text-sm font-black mt-3"
            style={{ background: active ? 'var(--bg-l3)' : 'var(--accent)', color: active ? 'var(--t2)' : '#fff', border: active ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
            {busy ? <Loader2 size={14} className="inline animate-spin" /> : (
              <><Wallet size={13} className="inline mr-1" />{active ? `Продлить на ${sub?.days ?? 30} дн.` : `Оформить за ${sub?.price ?? 159} ₽`}</>
            )}
          </motion.button>

          {active && (
            <div className="mt-3">
              {nameOpen
                ? (
                  <div className="space-y-2">
                    <Input value={name} maxLength={80} placeholder="Как вас назвать в афише"
                      onChange={e => setName(e.target.value)} />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setNameOpen(false)}
                        className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>Отмена</button>
                      <button type="button" onClick={() => void saveName()} disabled={busy}
                        className="flex-1 rounded-xl py-2 text-xs font-black" style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>Сохранить</button>
                    </div>
                  </div>
                )
                : (
                  <button type="button" onClick={() => setNameOpen(true)}
                    className="w-full rounded-xl py-2 text-xs font-bold"
                    style={{ background: 'transparent', color: 'var(--t3)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    <Pencil size={11} className="inline mr-1" />
                    Имя в афише: {sub?.displayName || 'как в профиле'}
                  </button>
                )}
            </div>
          )}
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-2">
            {([
              ['Опубликовано', `${summary.published}`, 'var(--green)'],
              ['Черновиков', `${summary.drafts}`, 'var(--t1)'],
              ['На проверке', `${summary.pending}`, 'var(--amber)'],
              ['Продано билетов', `${summary.sold}`, 'var(--t1)'],
            ] as [string, string, string][]).map(([k, v, c]) => (
              <div key={k} className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>{k}</p>
                <p className="text-lg font-black mt-1" style={{ color: c }}>{v}</p>
              </div>
            ))}
            <div className="col-span-2 rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Выручка</p>
              <p className="text-xl font-black mt-1" style={{ color: 'var(--green)' }}>{fmtMoney(summary.revenue)}</p>
            </div>
          </div>
        )}

        {/* ── Новое мероприятие ── */}
        {creating
          ? (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Новое мероприятие</p>
              <Field label="Название"><Input value={newEvent.title} maxLength={120} onChange={e => setNewEvent(n => ({ ...n, title: e.target.value }))} /></Field>
              <Field label="Начало"><Input type="datetime-local" value={newEvent.startsAt} onChange={e => setNewEvent(n => ({ ...n, startsAt: e.target.value }))} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Город"><Input value={newEvent.city} onChange={e => setNewEvent(n => ({ ...n, city: e.target.value }))} /></Field>
                <Field label="Площадка"><Input value={newEvent.venue} onChange={e => setNewEvent(n => ({ ...n, venue: e.target.value }))} /></Field>
              </div>
              <Field label="Категория">
                <select value={newEvent.category} onChange={e => setNewEvent(n => ({ ...n, category: e.target.value }))}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCreating(false)}
                  className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>Отмена</button>
                <button type="button" onClick={() => void create()} disabled={busy}
                  data-event-create
                  className="flex-1 rounded-xl py-2.5 text-xs font-black" style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>Создать черновик</button>
              </div>
            </div>
          )
          : (
            <button type="button" onClick={() => setCreating(true)}
              data-event-new
              className="w-full rounded-2xl py-3 text-sm font-bold"
              style={{ background: 'var(--bg-l2)', color: active ? 'var(--t2)' : 'var(--t3)', border: '1px dashed var(--border)', cursor: 'pointer' }}>
              <Plus size={14} className="inline mr-1" />Новое мероприятие
            </button>
          )}

        {/* ── Свои мероприятия ──
            Список открыт и при истёкшей подписке: данные не пропадают. */}
        {events.map(ev => {
          const hue = hueOf(ev.accent);
          const Icon = categoryIcon(ev.category);
          return (
            <div key={ev.id} data-my-event={ev.id}
              onClick={() => setEditing(ev.id)}
              className="rounded-2xl overflow-hidden cursor-pointer"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 px-4 py-3" style={{ background: bgGrad(hue) }}>
                <div className="h-10 w-10 rounded-xl grid place-items-center shrink-0 overflow-hidden" style={{ background: 'rgba(0,0,0,0.25)' }}>
                  {ev.hasCover
                    ? <img src={coverUrl(ev.id)} alt="" className="h-full w-full object-cover" />
                    : <Icon size={18} style={{ color: '#fff' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate text-white">{ev.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{fmtWhen(ev.startsAt)} · {ev.city}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0"
                  style={{ background: 'rgba(0,0,0,0.35)', color: EVENT_STATUS_COLOR[ev.status] }}>
                  {EVENT_STATUS_LABEL[ev.status]}
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--t3)' }}>
                  <span className="inline-flex items-center gap-1"><Users size={11} />{ev.sold ?? 0}</span>
                  <span className="inline-flex items-center gap-1"><Eye size={11} />{ev.views}</span>
                  <span className="inline-flex items-center gap-1"><BarChart3 size={11} />{fmtMoney(ev.revenue ?? 0)}</span>
                </div>
                <span className="text-xs font-bold" style={{ color: 'var(--t2)' }}>
                  осталось {ev.available}
                </span>
              </div>
            </div>
          );
        })}

        {events.length === 0 && (
          <div className="grid place-items-center h-32 text-center">
            <div>
              <TicketIcon size={30} className="mx-auto mb-2" style={{ color: 'var(--t3)' }} />
              <p className="text-sm" style={{ color: 'var(--t3)' }}>Мероприятий пока нет</p>
            </div>
          </div>
        )}

        {payments.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <p className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)', borderBottom: '1px solid var(--border)' }}>
              <ShieldCheck size={11} className="inline mr-1" />История оплат
            </p>
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--t3)' }}>{fmtStamp(p.at)}</span>
                <span className="text-xs" style={{ color: 'var(--t3)' }}>{p.days} дн.</span>
                <span className="text-xs font-bold" style={{ color: 'var(--t1)' }}>{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
