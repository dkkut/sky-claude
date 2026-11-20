/** Bloom: мероприятия — список, создание, карточка с «пойду / интересно». Данные и права решает сервер (server/bloomevents.mjs). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Plus, MapPin, Link2, Users, CalendarDays, Loader2, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { reportFilter } from '@/shared/contentFilter';
import { openProfile } from '@/profile/viewer/store';

type Ev = {
  id: string; title: string; description: string; startsAt: string; endsAt?: string | null; place?: string; onlineUrl?: string; capacity?: number;
  going: number; interested: number; full: boolean; mine: 'going' | 'interested' | null; cancelled: boolean; cancelReason?: string; past: boolean; held?: boolean; isOrganizer: boolean;
  organizer: { id: string; name: string; username: string }; community?: { id: string; name: string; slug: string };
};
const ERR: Record<string, string> = {
  bad_title: 'Название — от 3 знаков.', place_required: 'Укажите место или ссылку на онлайн-встречу.', start_in_past: 'Начало не может быть в прошлом.',
  start_too_far: 'Дальше двух лет вперёд планировать нельзя.', bad_end: 'Конец должен быть позже начала и не дольше 14 дней.', bad_link: 'Ссылка — только https.',
  bad_capacity: 'Число мест — целое от 1.', event_full: 'Мест больше нет.', cancelled: 'Мероприятие отменено.', event_over: 'Мероприятие уже прошло.',
  daily_limit: 'Слишком много мероприятий за сутки.', too_many_events: 'Не больше 20 предстоящих мероприятий одновременно.', forbidden: 'Создавать мероприятия сообщества могут только его модераторы.',
  banned: 'Вам закрыт доступ к этому сообществу.', capacity_below_going: 'Мест не может быть меньше, чем уже идёт.', content_blocked: 'Не опубликовано: в тексте есть запрещённое.',
};
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const inp = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const Btn = ({ children, onClick, tone = 'acc', disabled }: { children: ReactNode; onClick: () => void; tone?: 'acc' | 'plain' | 'red'; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-40"
    style={tone === 'acc' ? { background: 'var(--accent)', color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.14)', color: '#ef4444' } : { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>{children}</button>
);
type R<T> = (T & { error?: string; held?: boolean }) | null;
const call = async <T,>(path: string, method = 'GET', body?: unknown): Promise<R<T>> => {
  const r = await apiCall<T & { error?: string; held?: boolean }>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) { if (r.error !== 'content_blocked') flash(ERR[r.error ?? ''] ?? 'Не получилось. Попробуйте ещё раз.'); return null; }
  return (r.data ?? {}) as R<T>;
};
const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (iso?: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const Form = ({ ev, communityId, onClose, onDone }: { ev?: Ev; communityId?: string; onClose: () => void; onDone: () => void }) => {
  const [f, setF] = useState({ title: ev?.title ?? '', description: ev?.description ?? '', place: ev?.place ?? '', onlineUrl: ev?.onlineUrl ?? '', startsAt: toLocalInput(ev?.startsAt), endsAt: toLocalInput(ev?.endsAt), capacity: ev?.capacity ? String(ev.capacity) : '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    const body = { title: f.title, description: f.description, place: f.place, onlineUrl: f.onlineUrl, startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : '', endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null, capacity: f.capacity ? Number(f.capacity) : null, ...(communityId ? { communityId } : {}) };
    const r = ev ? await call(`/api/bloom/events/${ev.id}`, 'PUT', body) : await call('/api/bloom/events', 'POST', body);
    setBusy(false);
    if (!r) return;
    if (r.held) reportFilter(undefined, true); else flash(ev ? 'Сохранено' : 'Мероприятие опубликовано');
    onDone();
  };
  return (
    <div className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Мероприятие">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={card}>
        <p className="text-base font-black" style={{ color: 'var(--t1)' }}>{ev ? 'Изменить мероприятие' : 'Новое мероприятие'}</p>
        <input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={100} placeholder="Название" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} rows={4} placeholder="Описание: что будет, что взять с собой" className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] font-bold" style={{ color: 'var(--t3)' }}>Начало<input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} className="mt-1 w-full rounded-xl px-2 py-2 text-sm outline-none" style={inp} /></label>
          <label className="text-[11px] font-bold" style={{ color: 'var(--t3)' }}>Конец (необязательно)<input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} className="mt-1 w-full rounded-xl px-2 py-2 text-sm outline-none" style={inp} /></label>
        </div>
        <input value={f.place} onChange={(e) => set('place', e.target.value)} maxLength={200} placeholder="Место (адрес или название)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <input value={f.onlineUrl} onChange={(e) => set('onlineUrl', e.target.value)} maxLength={300} placeholder="или ссылка на онлайн-встречу (https://…)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <input value={f.capacity} onChange={(e) => set('capacity', e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} placeholder="Число мест (пусто — без ограничения)" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Sky ничего не продаёт и не проверяет мероприятие: это объявление и список желающих. Текст проверяется фильтрами контента.</p>
        <div className="flex justify-end gap-2"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy || f.title.trim().length < 3 || !f.startsAt || (!f.place.trim() && !f.onlineUrl.trim())} onClick={() => void save()}>{busy ? '…' : ev ? 'Сохранить' : 'Опубликовать'}</Btn></div>
      </div>
    </div>
  );
};

const Detail = ({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) => {
  const [ev, setEv] = useState<Ev | null>(null); const [edit, setEdit] = useState(false); const [people, setPeople] = useState<{ id: string; name: string; username: string; status: string }[] | null>(null);
  const load = useCallback(async () => { const r = await call<{ event: Ev }>(`/api/bloom/events/${id}`); if (r) setEv(r.event); else onClose(); }, [id, onClose]);
  useEffect(() => { void load(); }, [load]);
  if (!ev) return <div className="fixed inset-0 z-[205] grid place-items-center bg-black/60"><Loader2 className="animate-spin" size={20} style={{ color: '#fff' }} /></div>;
  const rsvp = async (status: string) => { const r = await call(`/api/bloom/events/${ev.id}/rsvp`, 'POST', { status }); if (r) { await load(); onChanged(); } };
  const open = !ev.cancelled && !ev.past;
  return (
    <div className="fixed inset-0 z-[205] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Мероприятие">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={card}>
        <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute right-4 top-4"><X size={18} style={{ color: 'var(--t3)' }} /></button>
        <p className="pr-6 text-lg font-black" style={{ color: 'var(--t1)' }} translate="no">{ev.title}</p>
        {ev.cancelled && <p className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}>Отменено{ev.cancelReason ? ` · ` : ''}<span translate="no">{ev.cancelReason}</span></p>}
        {ev.held && <p className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'rgba(245,158,11,.14)', color: '#f59e0b' }}>На проверке у модератора — другие пока не видят.</p>}
        <div className="space-y-1 text-sm" style={{ color: 'var(--t2)' }}>
          <p className="flex items-center gap-2"><CalendarDays size={14} />{fmt(ev.startsAt)}{ev.endsAt ? ` — ${fmt(ev.endsAt)}` : ''}</p>
          {ev.place && <p className="flex items-center gap-2"><MapPin size={14} /><span translate="no">{ev.place}</span></p>}
          {ev.onlineUrl && <p className="flex items-center gap-2"><Link2 size={14} /><a href={ev.onlineUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline" translate="no">{ev.onlineUrl}</a></p>}
          <p className="flex items-center gap-2"><Users size={14} />Идут: {ev.going}{ev.capacity ? ` из ${ev.capacity}` : ''} · Интересно: {ev.interested}</p>
        </div>
        {ev.description && <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{ev.description}</p>}
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Организатор: <button type="button" className="font-bold underline" onClick={() => openProfile(ev.organizer.id)} translate="no">{ev.organizer.name}</button>{ev.community ? <> · сообщество <span translate="no">{ev.community.name}</span></> : null}</p>
        {open && (
          <div className="flex flex-wrap gap-2">
            <Btn tone={ev.mine === 'going' ? 'acc' : 'plain'} disabled={ev.full && ev.mine !== 'going'} onClick={() => void rsvp(ev.mine === 'going' ? 'none' : 'going')}>{ev.mine === 'going' ? 'Вы идёте ✓' : ev.full ? 'Мест нет' : 'Пойду'}</Btn>
            <Btn tone={ev.mine === 'interested' ? 'acc' : 'plain'} onClick={() => void rsvp(ev.mine === 'interested' ? 'none' : 'interested')}>{ev.mine === 'interested' ? 'Интересно ✓' : 'Интересно'}</Btn>
          </div>
        )}
        {ev.isOrganizer && !ev.cancelled && (
          <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {!ev.past && <Btn tone="plain" onClick={() => setEdit(true)}>Изменить</Btn>}
            <Btn tone="plain" onClick={async () => { const r = await call<{ attendees: { id: string; name: string; username: string; status: string }[] }>(`/api/bloom/events/${ev.id}/attendees`); if (r) setPeople(r.attendees); }}>Кто идёт</Btn>
            {!ev.past && <Btn tone="red" onClick={async () => { if (!window.confirm('Отменить мероприятие? Идущим придёт уведомление.')) return; const reason = window.prompt('Причина (необязательно)') ?? ''; const r = await call(`/api/bloom/events/${ev.id}/cancel`, 'POST', { reason }); if (r) { await load(); onChanged(); } }}>Отменить</Btn>}
          </div>
        )}
        {people && <ul className="space-y-1 text-xs" style={{ color: 'var(--t2)' }}>{people.length === 0 ? <li>Пока никого.</li> : people.map((p) => <li key={p.id}><span translate="no">{p.name}</span> · {p.status === 'going' ? 'идёт' : 'интересно'}</li>)}</ul>}
        {edit && <Form ev={ev} onClose={() => setEdit(false)} onDone={() => { setEdit(false); void load(); onChanged(); }} />}
      </div>
    </div>
  );
};

const SCOPES: { k: string; l: string }[] = [{ k: 'upcoming', l: 'Предстоящие' }, { k: 'going', l: 'Мои записи' }, { k: 'mine', l: 'Я организую' }, { k: 'past', l: 'Прошедшие' }];

export const EventsView = ({ communityId }: { communityId?: string }) => {
  const [scope, setScope] = useState('upcoming'); const [list, setList] = useState<Ev[] | null>(null); const [openId, setOpenId] = useState<string | null>(null); const [create, setCreate] = useState(false);
  const load = useCallback(async () => {
    const r = await call<{ events: Ev[] }>(`/api/bloom/events?scope=${scope}${communityId ? `&communityId=${communityId}` : ''}`);
    setList(r ? r.events : []);
  }, [scope, communityId]);
  useEffect(() => { setList(null); void load(); }, [load]);
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="glass-pill flex min-w-0 gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SCOPES.map((s) => <button key={s.k} type="button" onClick={() => setScope(s.k)} className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold" style={{ color: scope === s.k ? 'var(--t1)' : 'var(--t3)', background: scope === s.k ? 'var(--bg-l2)' : 'transparent' }}>{s.l}</button>)}
        </div>
        <button type="button" onClick={() => setCreate(true)} className="glass-btn accent shrink-0 gap-1 whitespace-nowrap text-xs" style={{ display: "inline-flex", flexDirection: "row", alignItems: "center" }}><Plus size={14} />Создать</button>
      </div>
      {list === null ? <div className="grid h-24 place-items-center"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--t3)' }} /></div>
        : list.length === 0 ? <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>Здесь пока нет мероприятий.</p>
          : list.map((e) => (
            <button key={e.id} type="button" onClick={() => setOpenId(e.id)} className="w-full rounded-2xl p-3 text-left transition active:scale-[.99]" style={card}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-black" style={{ color: 'var(--t1)' }} translate="no">{e.title}</p>
                {e.cancelled ? <span className="shrink-0 text-[10px] font-bold" style={{ color: '#ef4444' }}>Отменено</span> : e.mine === 'going' ? <span className="shrink-0 text-[10px] font-bold" style={{ color: 'var(--accent)' }}>Вы идёте</span> : e.held ? <span className="shrink-0 text-[10px] font-bold" style={{ color: '#f59e0b' }}>На проверке</span> : null}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'var(--t2)' }}><CalendarDays size={12} />{fmt(e.startsAt)}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--t3)' }}>{e.place ? <><MapPin size={12} /><span translate="no">{e.place}</span></> : <><Link2 size={12} />Онлайн</>} · Идут: {e.going}{e.capacity ? `/${e.capacity}` : ''}</p>
            </button>
          ))}
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
      {create && <Form communityId={communityId} onClose={() => setCreate(false)} onDone={() => { setCreate(false); void load(); }} />}
    </div>
  );
};
