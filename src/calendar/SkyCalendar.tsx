/**
 * Sky Календарь — все даты человека в одном месте: свои события (повтор, напоминание, приглашения друзей)
 * и даты из других сервисов Sky (билеты, записи, парковки, поездки, сроки Sky Life, вскрытие капсул времени).
 * Чужие сервисы здесь только читаются; открыть источник можно кнопкой «Открыть».
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Users, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useModuleStore } from '@/data/state/modules';
import { visibleTick } from '@/shared/visibleTick';
import { SkyLoader } from '@/shared/SkyLoader';
import { calApi, type CalItem, type CalSource, type Guest, type PendingInvite } from './api';

const COLORS: Record<string, string> = { blue: '#3b82f6', violet: '#8b5cf6', pink: '#ec4899', red: '#ef4444', orange: '#f59e0b', green: '#22c55e', teal: '#14b8a6', gray: '#94a3b8' };
const ERR: Record<string, string> = {
  bad_title: 'Введите название.', bad_date: 'Проверьте даты: конец не может быть раньше начала.', too_long: 'Событие не может длиться больше 31 дня.',
  limit_reached: 'Достигнут предел числа событий.', too_many: 'Столько приглашённых не получится — максимум 20.', not_friend: 'Приглашать можно только друзей.',
  not_found: 'Событие не найдено.', bad_remind: 'Проверьте напоминание.', rate_limited: 'Слишком часто — подождите минуту.',
};
const errText = (e?: string) => ERR[e ?? ''] ?? (e ? `Не удалось выполнить (${e})` : 'Не удалось выполнить');
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const REMIND = [[0, 'В момент начала'], [10, 'За 10 минут'], [30, 'За 30 минут'], [60, 'За час'], [1440, 'За день']] as const;
const REPEAT = [['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц'], ['yearly', 'Каждый год']] as const;
const OPEN: Partial<Record<CalSource, string>> = { capsule: 'skytime', ticket: 'tickets', booking: 'go', trip: 'go', parking: 'go' };
const LABEL: Record<CalSource, string> = { event: 'Событие', capsule: 'Капсула времени вскроется', life: 'Sky Life', ticket: 'Билет', booking: 'Запись', parking: 'Парковка заканчивается', trip: 'Запланированная поездка', };

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const toLocalInput = (iso: string | Date) => { const d = new Date(iso); return new Date(+d - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const weekStart = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

const card: React.CSSProperties = { background: 'var(--bg-l1)', border: '1px solid var(--border)', borderRadius: 20, padding: 14 };
const field = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
const fieldSt: React.CSSProperties = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };

const titleOf = (it: CalItem) => {
  if (it.title) return it.title;
  if (it.source === 'trip') return it.what === 'delivery' ? 'Запланированная доставка' : 'Запланированная поездка';
  if (it.source === 'capsule') return it.toSelf ? 'Письмо себе из прошлого' : 'Капсула от друга';
  if (it.source === 'life') return it.what === 'due' ? 'Срок цели или задачи' : 'Событие из Sky Life';
  return LABEL[it.source];
};

export const SkyCalendar = () => {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [sel, setSel] = useState(() => key(new Date()));
  const [items, setItems] = useState<CalItem[] | null>(null);
  const [unavail, setUnavail] = useState<string[]>([]);
  const [failed, setFailed] = useState('');
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [edit, setEdit] = useState<CalItem | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const gridStart = useMemo(() => weekStart(cursor), [cursor]);
  const load = useCallback(async () => {
    const to = new Date(gridStart); to.setDate(to.getDate() + 42);
    const [r, i] = await Promise.all([calApi.range(gridStart, to), calApi.invites()]);
    if (r.ok && r.data) { setItems(r.data.items); setUnavail(r.data.unavailable); setFailed(''); } else setFailed(errText(r.error));
    if (i.ok && i.data) setInvites(i.data.invites);
  }, [gridStart]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(visibleTick(() => void load()), 60_000); return () => window.clearInterval(t); }, [load]);

  const byDay = useMemo(() => { const m = new Map<string, CalItem[]>(); for (const it of items ?? []) { const k = key(new Date(it.start)); (m.get(k) ?? m.set(k, []).get(k)!).push(it); } return m; }, [items]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; }), [gridStart]);
  const today = key(new Date());
  const dayItems = byDay.get(sel) ?? [];
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  const reply = async (id: string, accept: boolean) => { await calApi.respond(id, accept); void load(); };
  const openSource = (s: CalSource) => { const tab = OPEN[s]; if (!tab) return; const st = useModuleStore.getState(); st.setPendingExtrasTab(tab); st.setActiveModule('extras'); };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl min-w-0 flex-col overflow-y-auto overflow-x-hidden px-4 pb-24 pt-4" style={{ color: 'var(--t1)' }}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Предыдущий месяц" className="glass-btn round" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <h2 className="min-w-0 flex-1 text-center text-lg font-bold"><span>{MONTHS[cursor.getMonth()]}</span>{' '}{cursor.getFullYear()}</h2>
        <button type="button" aria-label="Следующий месяц" className="glass-btn round" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button type="button" className="glass-btn" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSel(key(n)); }}>Сегодня</button>
      </div>

      {invites.length > 0 && (
        <div className="mt-3 flex flex-col gap-2" style={card}>
          <div className="text-sm font-semibold">Приглашения</div>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <div className="min-w-0 flex-1"><div className="truncate font-semibold" translate="no">{i.title}</div><div className="text-xs" style={{ color: 'var(--t2)' }}><span translate="no">{i.ownerName}</span>{` · ${new Date(i.start).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</div></div>
              <button type="button" className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => void reply(i.id, true)}>Принять</button>
              <button type="button" className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--bg-l2)' }} onClick={() => void reply(i.id, false)}>Отклонить</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px]" style={{ color: 'var(--t3)' }}>{WD.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Календарь">
        {cells.map((d) => {
          const k = key(d), list = byDay.get(k) ?? [], other = d.getMonth() !== cursor.getMonth();
          return (
            <button key={k} type="button" role="gridcell" aria-selected={k === sel} onClick={() => setSel(k)}
              className="flex aspect-square min-w-0 flex-col items-center justify-start gap-0.5 rounded-xl pt-1 text-sm"
              style={{ background: k === sel ? 'var(--accent)' : 'var(--bg-l1)', color: k === sel ? '#fff' : 'var(--t1)', opacity: other ? 0.45 : 1, outline: k === today && k !== sel ? '1.5px solid var(--accent)' : undefined }}>
              <span className="font-semibold">{d.getDate()}</span>
              <span className="flex gap-0.5">{list.slice(0, 3).map((it) => <span key={it.id} className="h-1.5 w-1.5 rounded-full" style={{ background: k === sel ? '#fff' : COLORS[it.color] ?? COLORS.blue }} />)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold" style={{ color: 'var(--t2)' }}>{new Date(`${sel}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        <button type="button" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => setEdit('new')}><Plus size={15} />Событие</button>
      </div>
      {unavail.length > 0 && <p className="mt-2 text-xs" style={{ color: 'var(--t3)' }}>Часть источников сейчас недоступна — они появятся позже.</p>}
      <div className="mt-2 flex flex-col gap-2">
        {items === null ? (failed ? <p className="text-sm" role="alert">{failed} <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p> : <SkyLoader />) :
          dayItems.length === 0 ? <p className="text-sm" style={{ color: 'var(--t3)' }}>На этот день ничего не запланировано.</p> :
            dayItems.map((it) => (
              <div key={it.id} style={{ ...card, borderLeft: `4px solid ${COLORS[it.color] ?? COLORS.blue}` }}>
                <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === it.id ? null : it.id)}>
                  <div className="w-14 shrink-0 text-xs" style={{ color: 'var(--t2)' }}>{it.allDay ? 'Весь день' : hhmm(it.start)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" translate={it.source === 'event' || it.source === 'ticket' || it.source === 'booking' ? 'no' : undefined}>{titleOf(it)}</div>
                    <div className="text-xs" style={{ color: 'var(--t2)' }}>{LABEL[it.source]}{it.ownerName ? ' · ' : ''}{it.ownerName && <span translate="no">{it.ownerName}</span>}{it.invite === 'pending' ? ' · ждёт ответа' : ''}</div>
                  </div>
                </button>
                {open === it.id && <Detail it={it} onEdit={() => setEdit(it)} onOpenSource={() => openSource(it.source)} onChanged={load} />}
              </div>
            ))}
      </div>

      {edit && <EventForm item={edit === 'new' ? null : edit} day={sel} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
};

const Detail = ({ it, onEdit, onOpenSource, onChanged }: { it: CalItem; onEdit: () => void; onOpenSource: () => void; onChanged: () => void }) => {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { if (it.source === 'event' && it.mine) void calApi.guests(it.ref).then((r) => { if (r.ok && r.data) setGuests(r.data.guests); }); }, [it]);
  const del = async () => {
    if (!window.confirm(it.mine ? 'Удалить событие? Приглашённые получат уведомление.' : 'Выйти из события?')) return;
    const r = await calApi.remove(it.ref); if (r.ok) onChanged(); else setErr(errText(r.error));
  };
  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3 text-sm" style={{ borderColor: 'var(--border)' }}>
      {it.notes && <p className="whitespace-pre-wrap break-words" translate="no">{it.notes}</p>}
      {it.place && <p style={{ color: 'var(--t2)' }} translate="no">{it.place}</p>}
      {it.end && <p className="text-xs" style={{ color: 'var(--t2)' }}>{`${hhmm(it.start)} — ${hhmm(it.end)}`}</p>}
      {it.repeat && it.repeat !== 'none' && <p className="text-xs" style={{ color: 'var(--t2)' }}>{REPEAT.find((r) => r[0] === it.repeat)?.[1]}</p>}
      {guests.length > 0 && <p className="flex flex-wrap items-center gap-1 text-xs" style={{ color: 'var(--t2)' }}><Users size={13} />{guests.map((g) => <span key={g.id} translate="no">{`${g.name} (${g.status === 'accepted' ? '✓' : g.status === 'declined' ? '✗' : '…'})`}</span>)}</p>}
      {err && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{err}</p>}
      <div className="flex flex-wrap gap-2">
        {it.source === 'event' && it.mine && <button type="button" className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--bg-l2)' }} onClick={onEdit}>Изменить</button>}
        {it.source === 'event' && <button type="button" aria-label={it.mine ? 'Удалить событие' : 'Выйти из события'} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--bg-l2)' }} onClick={() => void del()}><Trash2 size={13} />{it.mine ? 'Удалить' : 'Выйти'}</button>}
        {OPEN[it.source] && <button type="button" className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: '#fff' }} onClick={onOpenSource}>Открыть</button>}
      </div>
    </div>
  );
};

interface Friend { id: string; name: string }

const EventForm = ({ item, day, onClose, onSaved }: { item: CalItem | null; day: string; onClose: () => void; onSaved: () => void }) => {
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [allDay, setAllDay] = useState(item?.allDay ?? false);
  const [start, setStart] = useState(item ? toLocalInput(item.start) : `${day}T10:00`);
  const [end, setEnd] = useState(item?.end ? toLocalInput(item.end) : '');
  const [repeat, setRepeat] = useState(item?.repeat ?? 'none');
  const [remind, setRemind] = useState<string>(item?.remindMin != null ? String(item.remindMin) : '');
  const [color, setColor] = useState(item?.color ?? 'blue');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { void apiCall<{ myFriends: Friend[] }>('/api/maps/friends').then((r) => { if (r.ok && r.data) setFriends(r.data.myFriends ?? []); }); }, []);
  const save = async () => {
    setErr(''); setBusy(true);
    const body = { title, notes, allDay, start: new Date(start).toISOString(), end: end ? new Date(end).toISOString() : null, repeat, remindMin: remind === '' ? null : Number(remind), color };
    const r = item ? await calApi.update(item.ref, body) : await calApi.create(body);
    let id = item?.ref ?? (r.data as { id?: string } | undefined)?.id;
    if (r.ok && id && pick.size) { const iv = await calApi.invite(id, [...pick]); if (!iv.ok) { setBusy(false); setErr(errText(iv.error)); return; } }
    setBusy(false);
    if (r.ok) onSaved(); else setErr(errText(r.error));
  };
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,.55)' }} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }} role="dialog" aria-label={item ? 'Изменить событие' : 'Новое событие'} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center"><h3 className="flex-1 text-base font-bold" style={{ color: 'var(--t1)' }}>{item ? 'Изменить событие' : 'Новое событие'}</h3><button type="button" aria-label="Закрыть" onClick={onClose}><X size={20} /></button></div>
        <div className="mt-3 flex flex-col gap-3">
          <input className={field} style={fieldSt} placeholder="Название" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} translate="no" />
          <textarea className={field} style={{ ...fieldSt, minHeight: 70 }} placeholder="Заметка (необязательно)" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} translate="no" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />Весь день</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs">Начало<input type="datetime-local" className={`${field} mt-1 min-w-0 text-xs`} style={fieldSt} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="min-w-0 text-xs">Конец<input type="datetime-local" className={`${field} mt-1 min-w-0 text-xs`} style={fieldSt} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Повтор" className={field} style={fieldSt} value={repeat} onChange={(e) => setRepeat(e.target.value)}>{REPEAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select aria-label="Напоминание" className={field} style={fieldSt} value={remind} onChange={(e) => setRemind(e.target.value)}><option value="">Без напоминания</option>{REMIND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Цвет">{Object.entries(COLORS).map(([k, c]) => <button key={k} type="button" role="radio" aria-checked={color === k} aria-label={k} onClick={() => setColor(k)} className="h-7 w-7 rounded-full" style={{ background: c, outline: color === k ? '2px solid var(--t1)' : undefined, outlineOffset: 2 }} />)}</div>
          {friends.length > 0 && (
            <div>
              <div className="text-xs" style={{ color: 'var(--t2)' }}>Пригласить друзей</div>
              <div className="mt-1 flex flex-wrap gap-1.5">{friends.map((f) => { const on = pick.has(f.id); return <button key={f.id} type="button" aria-pressed={on} translate="no" onClick={() => setPick((s) => { const n = new Set(s); if (on) n.delete(f.id); else n.add(f.id); return n; })} className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: on ? 'var(--accent)' : 'var(--bg-l2)', color: on ? '#fff' : 'var(--t1)' }}>{f.name}</button>; })}</div>
            </div>
          )}
          {err && <p className="text-sm" role="alert" style={{ color: '#ef4444' }}>{err}</p>}
          <button type="button" disabled={busy || !title.trim() || !start} onClick={() => void save()} className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Сохранить</button>
        </div>
      </div>
    </div>
  );
};

export default SkyCalendar;
