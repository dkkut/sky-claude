/**
 * Проверка мероприятий перед афишей.
 *
 * Очередь отдаёт сервер и только администратору. Права здесь не
 * дублируются: обычному человеку ручка отвечает отказом, и пустой
 * список — это не «мы спрятали кнопку», а «сервер не дал».
 *
 * Решение видно целиком: афиша, описание, площадка, время и цены. Без
 * этого проверка превращается в штамп по названию.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Check, X, MapPin, Calendar, Eye } from 'lucide-react';
import {
  apiModerationQueue, apiModerate, coverUrl,
  type TicketEvent,
} from './ticketsApi';
import { fmtMoney, fmtWhen, hueOf, bgGrad, categoryIcon } from './ticketsUi';

type QueueEvent = TicketEvent & { organizerName: string };

export const TicketsModeration = () => {
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setEvents(await apiModerationQueue());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id); setError('');
    const r = await apiModerate(id, approve, reason[id] ?? '');
    setBusy(null);
    if (!r.ok) { setError(r.reason); return; }
    setEvents(list => list.filter(e => e.id !== id));
  };

  if (loading) {
    return <div className="grid place-items-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={15} style={{ color: 'var(--accent)' }} />
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>
          Мероприятия на проверке{events.length > 0 ? ` · ${events.length}` : ''}
        </p>
      </div>

      {error && (
        <p className="text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)' }}>{error}</p>
      )}

      {events.length === 0 && (
        <p className="text-sm py-10 text-center" style={{ color: 'var(--t3)' }}>Очередь пуста</p>
      )}

      {events.map(ev => {
        const hue = hueOf(ev.accent);
        const Icon = categoryIcon(ev.category);
        return (
          <div key={ev.id} data-ticket-moderation-card={ev.id}
            className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <div className="relative" style={{ height: 120, background: bgGrad(hue) }}>
              {ev.hasCover
                ? <img src={coverUrl(ev.id)} alt="" className="h-full w-full object-cover" />
                : <div className="absolute inset-0 grid place-items-center" style={{ opacity: 0.2 }}><Icon size={44} style={{ color: '#fff' }} /></div>}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent 60%)' }} />
              <div className="absolute bottom-3 left-4 right-4">
                <p className="text-base font-black text-white truncate">{ev.title}</p>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{ev.category} · {ev.organizerName}</p>
              </div>
            </div>

            <div className="px-4 py-3 space-y-2">
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--t3)' }}>
                <span className="inline-flex items-center gap-1"><Calendar size={11} />{fmtWhen(ev.startsAt)}</span>
                <span className="inline-flex items-center gap-1"><MapPin size={11} />{ev.venue}, {ev.city}</span>
                {ev.ageLimit > 0 && <span>{ev.ageLimit}+</span>}
                <span className="inline-flex items-center gap-1"><Eye size={11} />{ev.views}</span>
              </div>
              {ev.address && <p className="text-xs" style={{ color: 'var(--t3)' }}>{ev.address}</p>}
              {ev.desc && <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--t2)' }}>{ev.desc}</p>}
              <p className="text-xs font-bold" style={{ color: 'var(--t1)' }}>
                {ev.priceFrom === null ? 'цена не указана' : `от ${fmtMoney(ev.priceFrom)}`} · мест {ev.capacity}
              </p>

              <input value={reason[ev.id] ?? ''} maxLength={300}
                onChange={e => setReason(r => ({ ...r, [ev.id]: e.target.value }))}
                placeholder="Причина отказа — её увидит организатор"
                aria-label="Причина отказа"
                className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' }} />

              <div className="flex gap-2">
                <button type="button" onClick={() => void decide(ev.id, false)} disabled={busy === ev.id}
                  data-ticket-reject
                  className="flex-1 rounded-xl py-2.5 text-xs font-bold"
                  style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)', border: '1px solid rgba(244,63,94,0.2)', cursor: 'pointer' }}>
                  <X size={12} className="inline mr-1" />Отклонить
                </button>
                <button type="button" onClick={() => void decide(ev.id, true)} disabled={busy === ev.id}
                  data-ticket-approve
                  className="flex-1 rounded-xl py-2.5 text-xs font-black"
                  style={{ background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  {busy === ev.id ? <Loader2 size={12} className="inline animate-spin" /> : <><Check size={12} className="inline mr-1" />Опубликовать</>}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
