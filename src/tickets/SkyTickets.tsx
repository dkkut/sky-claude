/**
 * Sky Билеты.
 *
 * Экран тот же, что был, — поиск, фильтры, «Афиша / Мои билеты /
 * Избранное», карточка мероприятия, подтверждение и QR. Изменилось то,
 * откуда берутся данные: раньше список мероприятий был вписан в этот
 * файл, покупка добавляла строку в память вкладки, а код билета
 * получался из Math.random(). Теперь всё это живёт на сервере.
 *
 * Что из этого следует для чтения кода:
 *
 *   · цену и остаток мы только показываем — считает их сервер;
 *   · «купить» — это один запрос, и его результат мы не пересчитываем;
 *   · у каждого места свой билет со своим кодом, поэтому «мои билеты» —
 *     это список билетов, а не список покупок.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Ticket as TicketIcon, Heart, Calendar, Clock, MapPin, Building2, Star, Zap,
  QrCode, CheckCircle, Search, X, Briefcase, Eye, Loader2,
} from 'lucide-react';
import { qrDataUri } from '@/shared/qr';
import {
  apiCatalog, apiEvent, apiFavorites, apiSetFavorite, apiBuy, apiMyTickets,
  apiOrganizer, newIdemKey, coverUrl,
  type TicketEvent, type Ticket, type TicketType, type Order, type Subscription,
} from './ticketsApi';
import {
  fmtMoney, fmtDate, fmtTime, fmtWhen, fmtStamp, hueOf, bgGrad, stockColor,
  categoryIcon, TICKET_STATUS_LABEL, TICKET_STATUS_COLOR,
} from './ticketsUi';
import { OrganizerCabinet } from './OrganizerCabinet';

type MainTab = 'events' | 'my' | 'fav' | 'org';
type PriceBand = 'all' | 'budget' | 'mid' | 'prem';

/** Границы ценовых кнопок. Те же, что были на экране. */
const PRICE_BANDS: Record<PriceBand, { min?: number; max?: number }> = {
  all:    {},
  budget: { max: 1000 },
  mid:    { min: 1000, max: 5000 },
  prem:   { min: 5000 },
};

/* ─── Афиша: одна карточка ──────────────────────────────────────── */

const EventCard = ({ ev, onOpen, onFav }: {
  ev: TicketEvent;
  onOpen: () => void;
  onFav: (e: React.MouseEvent) => void;
}) => {
  const hue = hueOf(ev.accent);
  const urgent = !ev.soldOut && ev.available < 50;
  const Icon = categoryIcon(ev.category);
  return (
    <motion.div whileHover={{ y: -1 }} onClick={onOpen}
      data-ticket-event={ev.id}
      className="rounded-2xl overflow-hidden cursor-pointer"
      style={{
        background: 'var(--bg-l2)',
        border: `1px solid ${urgent ? 'rgba(244,63,94,0.25)' : 'var(--border)'}`,
        boxShadow: urgent ? '0 0 0 1px rgba(244,63,94,0.1)' : 'none',
      }}>
      <div className="relative overflow-hidden" style={{ height: 80, background: bgGrad(hue) }}>
        {ev.hasCover && (
          <img src={coverUrl(ev.id)} alt="" loading="lazy"
            className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.55 }} />
        )}
        {!ev.hasCover && (
          <div className="absolute right-5 top-1/2 -translate-y-1/2" style={{ opacity: 0.15 }}>
            <Icon size={46} style={{ color: '#fff' }} />
          </div>
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.55), transparent 70%)' }} />
        <div className="absolute inset-0 px-4 flex items-center gap-3">
          <div className="min-w-0">
            <div className="flex gap-1.5 mb-1.5">
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                style={{ background: `hsl(${hue},50%,30%,0.5)`, color: `hsl(${hue},85%,75%)` }}>
                {ev.category.toUpperCase()}
              </span>
              {ev.soldOut && <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: 'rgba(120,120,130,0.45)', color: '#fff' }}>МЕСТ НЕТ</span>}
              {urgent && <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.35)', color: '#f43f5e' }}><Zap size={9} className="inline mr-1" />МАЛО МЕСТ</span>}
              {ev.views > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}>
                  <Eye size={9} className="inline mr-1" />{ev.views}
                </span>
              )}
            </div>
            <p className="text-sm font-black text-white truncate">{ev.title}</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Calendar size={12} style={{ color: 'var(--t3)' }} />
            <p className="text-xs font-semibold" style={{ color: 'var(--t2)' }}>{fmtDate(ev.startsAt)}</p>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <MapPin size={12} style={{ color: 'var(--t3)' }} />
            <p className="text-xs truncate max-w-[120px]" style={{ color: 'var(--t2)' }}>{ev.venue || ev.city}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <motion.button whileTap={{ scale: 0.8 }} type="button" onClick={onFav}
            aria-label={ev.favorite ? 'Убрать из избранного' : 'В избранное'}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <Heart size={16} fill={ev.favorite ? '#ef4444' : 'none'} style={{ color: ev.favorite ? '#ef4444' : 'var(--t3)' }} />
          </motion.button>
          <div className="text-right">
            <p className="text-[10px]" style={{ color: 'var(--t3)' }}>от</p>
            <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>
              {ev.priceFrom === null ? '—' : fmtMoney(ev.priceFrom)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: stockColor(ev.available) }}>
            <div className="h-2 w-2 rounded-full" style={{ background: stockColor(ev.available) }} />
            <span className="font-bold">{ev.available}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

/* ─── Экран ─────────────────────────────────────────────────────── */

export const SkyTickets = () => {
  const [tab, setTab] = useState<MainTab>('events');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('Все');
  const [band, setBand] = useState<PriceBand>('all');
  const [q, setQ] = useState('');

  const [catalog, setCatalog] = useState<TicketEvent[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [favorites, setFavorites] = useState<TicketEvent[]>([]);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [myScope, setMyScope] = useState<'active' | 'past'>('active');
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const [open, setOpen] = useState<TicketEvent | null>(null);
  const [typeId, setTypeId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState('');
  const [confirm, setConfirm] = useState<{ order: Order; tickets: Ticket[] } | null>(null);
  const [showQR, setShowQR] = useState<Ticket | null>(null);

  /* Ключ идемпотентности живёт столько же, сколько открытая карточка:
     двойное нажатие «Купить» — это одна покупка, а следующая покупка
     того же билета — уже другая. */
  const idemRef = useRef<string>(newIdemKey());

  /* ── Загрузка афиши ──
     Поиск и фильтры уходят на сервер: фильтровать на клиенте значит
     сначала прислать ему всё, включая то, что показывать не следует. */
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    const page = await apiCatalog({
      q: q.trim(),
      city,
      category,
      priceMin: PRICE_BANDS[band].min,
      priceMax: PRICE_BANDS[band].max,
      limit: 60,
    });
    if (page) {
      setCatalog(page.events);
      setCities(page.cities);
      setCategories(page.categories);
    }
    setLoading(false);
  }, [q, city, category, band]);

  useEffect(() => {
    const t = setTimeout(() => { void loadCatalog(); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadCatalog, q]);

  useEffect(() => { void (async () => setSubscription((await apiOrganizer())?.subscription ?? null))(); }, []);

  useEffect(() => {
    if (tab === 'fav') void (async () => setFavorites(await apiFavorites()))();
    if (tab === 'my') void (async () => setMyTickets(await apiMyTickets(myScope)))();
  }, [tab, myScope]);

  const refreshMine = useCallback(async () => {
    setMyTickets(await apiMyTickets(myScope));
  }, [myScope]);

  const toggleFav = useCallback(async (ev: TicketEvent) => {
    const next = await apiSetFavorite(ev.id, !ev.favorite);
    const apply = (list: TicketEvent[]) => list.map(x => x.id === ev.id ? { ...x, favorite: next } : x);
    setCatalog(apply);
    setOpen(o => (o && o.id === ev.id ? { ...o, favorite: next } : o));
    setFavorites(list => next ? list : list.filter(x => x.id !== ev.id));
    if (next && tab === 'fav') setFavorites(await apiFavorites());
  }, [tab]);

  /* ── Открыть мероприятие ──
     Карточку перечитываем с сервера: в списке нет ни типов билетов,
     ни описания, а остаток к этому моменту мог измениться. */
  const openEvent = useCallback(async (id: string) => {
    const full = await apiEvent(id);
    if (!full) { void loadCatalog(); return; }
    setOpen(full);
    setQty(1);
    setBuyError('');
    idemRef.current = newIdemKey();
    const first = (full.types ?? []).find(t => t.onSale) ?? (full.types ?? [])[0];
    setTypeId(first?.id ?? '');
  }, [loadCatalog]);

  const selected: TicketType | undefined = useMemo(
    () => (open?.types ?? []).find(t => t.id === typeId),
    [open, typeId],
  );

  /* Верхнюю границу количества ставит сервер (лимит в одни руки и
     остаток); здесь мы только не даём нажать заведомо лишнее. */
  const maxQty = Math.max(1, Math.min(selected?.perUserMax ?? 1, selected?.available ?? 1));
  const total = (selected?.price ?? 0) * qty;

  const doBuy = async () => {
    if (!selected || buying) return;
    setBuying(true);
    setBuyError('');
    const res = await apiBuy(selected.id, qty, idemRef.current);
    setBuying(false);
    if (!res.ok || !res.order || !res.tickets) {
      setBuyError(res.reason ?? 'Не получилось');
      /* Остаток мог измениться, пока человек выбирал: перечитываем. */
      if (open) { const fresh = await apiEvent(open.id); if (fresh) setOpen(fresh); }
      return;
    }
    setConfirm({ order: res.order, tickets: res.tickets });
    setOpen(null);
    idemRef.current = newIdemKey();
    void loadCatalog();
    void refreshMine();
  };

  /* ── QR одного билета ──
     В коде QR лежит ключ, выданный сервером, а не название и дата:
     по названию и дате билет не проверить. */
  if (showQR) {
    const t = showQR;
    const hue = hueOf(t.accent);
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-xs rounded-3xl overflow-hidden"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
          <div className="px-6 pt-6 pb-4 text-center">
            <div className="mb-3 flex justify-center">
              <TicketIcon size={28} style={{ color: `hsl(${hue},70%,60%)` }} />
            </div>
            <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>{t.eventTitle}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{t.venue} · {fmtWhen(t.startsAt)}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{t.typeName} · место {t.seatNo}</p>
            <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-l3)', color: TICKET_STATUS_COLOR[t.status] }}>
              {TICKET_STATUS_LABEL[t.status]}
            </span>
          </div>
          <div className="flex justify-center px-6 pb-4">
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <img src={qrDataUri(t.qr ?? t.code, { size: 200, background: '#141420', color: '#ffffff', quietZone: 2 })}
                alt="QR" width={200} height={200} style={{ display: 'block' }} />
            </div>
          </div>
          <div className="px-6 pb-6 space-y-3">
            <div className="rounded-xl px-4 py-3 text-center" style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.12)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--t3)' }}>Код билета</p>
              <p className="text-2xl font-black font-mono tracking-widest" style={{ color: 'var(--accent)' }}>{t.code}</p>
            </div>
            <p className="text-[10px] text-center" style={{ color: 'var(--t3)' }}>
              Покажите QR при входе. Если камера не читает — назовите код.
            </p>
            <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => setShowQR(null)}
              className="w-full rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              Закрыть
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── Подтверждение покупки ── */
  if (confirm) {
    const { order, tickets } = confirm;
    return (
      <div className="flex h-full flex-col items-center justify-center p-5">
        <motion.div initial={{ scale: 0.8, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="w-full max-w-sm rounded-3xl overflow-hidden"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
          <div className="p-6 text-center" style={{ background: 'linear-gradient(135deg, rgba(0,200,90,0.08), rgba(0,200,90,0.02))' }}>
            <CheckCircle size={44} className="mx-auto mb-3" style={{ color: '#22c55e' }} />
            <p className="text-xl font-black" style={{ color: 'var(--t1)' }}>Готово!</p>
            <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>
              {tickets.length === 1 ? 'Билет сохранён в «Мои билеты»' : `${tickets.length} билета сохранены в «Мои билеты»`}
            </p>
          </div>
          <div className="px-5 py-4">
            {([
              ['Событие', order.eventTitle],
              ['Место', order.venue || order.city],
              ['Дата', fmtWhen(order.startsAt)],
              ['Тип', order.typeName],
              ['Количество', `${order.quantity} шт`],
              ['Итого', fmtMoney(order.total)],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-xs" style={{ color: 'var(--t3)' }}>{k}</p>
                <p className="text-xs font-bold" style={{ color: 'var(--t1)' }}>{v}</p>
              </div>
            ))}
            <div className="mt-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
                {tickets.length === 1 ? 'Код' : 'Коды билетов'}
              </p>
              {/* У каждого места свой код: по нему и проходят контроль. */}
              {tickets.map(t => (
                <button key={t.id} type="button" onClick={() => { setShowQR(t); setConfirm(null); }}
                  className="w-full rounded-xl px-4 py-3 flex items-center justify-between"
                  style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.12)', cursor: 'pointer' }}>
                  <span className="text-lg font-black font-mono tracking-widest" style={{ color: 'var(--accent)' }}>{t.code}</span>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--t3)' }}>место {t.seatNo} · QR</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 px-5 pb-5 mt-2">
            <motion.button whileTap={{ scale: 0.95 }} type="button"
              onClick={() => { setShowQR(tickets[0]); setConfirm(null); }}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              <QrCode size={13} className="inline mr-1" />QR-код
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} type="button"
              onClick={() => { setConfirm(null); setTab('my'); void refreshMine(); }}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Отлично!
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── Карточка мероприятия ── */
  if (open) {
    const ev = open;
    const hue = hueOf(ev.accent);
    const Icon = categoryIcon(ev.category);
    const types = ev.types ?? [];
    const avPct = ev.capacity > 0 ? Math.round((ev.available / ev.capacity) * 100) : 0;
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => setOpen(null)}
            aria-label="Назад"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </motion.button>
          <p className="flex-1 text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{ev.title}</p>
          <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={() => void toggleFav(ev)}
            aria-label={ev.favorite ? 'Убрать из избранного' : 'В избранное'}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <Heart size={16} fill={ev.favorite ? '#ef4444' : 'none'} style={{ color: ev.favorite ? '#ef4444' : 'var(--t3)' }} />
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="relative overflow-hidden" style={{ height: 160, background: bgGrad(hue) }}>
            {ev.hasCover
              ? <img src={coverUrl(ev.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              : (
                <div className="absolute right-8 top-1/2 -translate-y-1/2" style={{ opacity: 0.12 }}>
                  <Icon size={68} style={{ color: '#fff' }} />
                </div>
              )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)' }} />
            <div className="absolute bottom-5 left-5 right-5">
              <div className="flex gap-2 mb-2">
                <span className="text-[10px] font-black px-2 py-0.5 rounded"
                  style={{ background: `hsl(${hue},50%,30%,0.55)`, color: `hsl(${hue},85%,78%)` }}>
                  {ev.category.toUpperCase()}
                </span>
                {ev.ageLimit > 0 && <span className="text-[10px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>{ev.ageLimit}+</span>}
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
                  <Star size={9} fill="#fff" />{ev.organizerName}
                </span>
              </div>
              <p className="text-2xl font-black text-white drop-shadow-lg">{ev.title}</p>
            </div>
          </div>

          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-2">
              {([[Calendar, fmtDate(ev.startsAt)], [Clock, fmtTime(ev.startsAt)], [MapPin, ev.venue], [Building2, ev.city]] as [typeof Calendar, string][]).map(([I, val], i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <I size={15} style={{ color: 'var(--t3)' }} />
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{val || '—'}</p>
                </div>
              ))}
            </div>

            {(ev.address || ev.venueNote) && (
              <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                {ev.address && <p className="text-xs" style={{ color: 'var(--t2)' }}>{ev.address}</p>}
                {ev.venueNote && <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{ev.venueNote}</p>}
              </div>
            )}

            {ev.desc && <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--t2)' }}>{ev.desc}</p>}

            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: `1px solid ${ev.available < 50 ? 'rgba(244,63,94,0.2)' : 'var(--border)'}` }}>
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--t3)' }}>Мест доступно</p>
                <p className="text-sm font-bold" style={{ color: stockColor(ev.available) }}>{ev.available} из {ev.capacity}</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full" style={{ width: `${avPct}%`, background: stockColor(ev.available) }} />
              </div>
              {ev.available > 0 && ev.available < 50 && (
                <p className="inline-flex items-center gap-1 text-[10px] font-bold mt-1.5" style={{ color: 'var(--red)' }}>
                  <Zap size={10} />Торопитесь — осталось мало
                </p>
              )}
            </div>

            {/* Типы билетов приходят с сервера: их может быть один, а может быть пять. */}
            <div className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Тип билета</p>
              {types.length === 0 && <p className="text-sm" style={{ color: 'var(--t3)' }}>Билеты ещё не выставлены</p>}
              <div className="grid grid-cols-2 gap-2">
                {types.map(t => {
                  const active = t.id === typeId;
                  const can = t.onSale && t.available > 0;
                  return (
                    <button key={t.id} type="button" disabled={!can}
                      data-ticket-type={t.id}
                      onClick={() => { setTypeId(t.id); setQty(1); setBuyError(''); }}
                      className="rounded-xl p-3.5 text-left transition-all"
                      style={{
                        background: active ? `hsl(${hue},50%,16%)` : 'var(--bg-l3)',
                        border: `1.5px solid ${active ? `hsl(${hue},60%,32%)` : 'var(--border)'}`,
                        cursor: can ? 'pointer' : 'not-allowed',
                        opacity: can ? 1 : 0.45,
                      }}>
                      <p className="text-xs font-bold mb-1 truncate" style={{ color: active ? `hsl(${hue},80%,65%)` : 'var(--t2)' }}>{t.name}</p>
                      <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{fmtMoney(t.price)}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>
                        {t.available > 0 ? `осталось ${t.available}` : 'мест нет'}
                      </p>
                      {t.desc && <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--t3)' }}>{t.desc}</p>}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: 'var(--t2)' }}>Количество</p>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
                  <motion.button whileTap={{ scale: 0.85 }} type="button" aria-label="Меньше"
                    onClick={() => setQty(n => Math.max(1, n - 1))}
                    className="w-10 h-9 grid place-items-center text-lg transition-colors hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)' }}>−</motion.button>
                  <p className="w-8 text-center text-sm font-black" style={{ color: 'var(--t1)' }}>{qty}</p>
                  <motion.button whileTap={{ scale: 0.85 }} type="button" aria-label="Больше"
                    onClick={() => setQty(n => Math.min(maxQty, n + 1))}
                    className="w-10 h-9 grid place-items-center text-lg transition-colors hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)' }}>+</motion.button>
                </div>
              </div>
              {selected && (
                <p className="text-[10px] -mt-2 text-right" style={{ color: 'var(--t3)' }}>
                  не больше {selected.perUserMax} в одни руки
                </p>
              )}

              <div className="flex justify-between items-center pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--t2)' }}>Итого</p>
                <p className="text-2xl font-black" style={{ color: 'var(--t1)' }}>{fmtMoney(total)}</p>
              </div>

              {buyError && (
                <p className="text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(244,63,94,0.08)', color: 'var(--red)' }}>{buyError}</p>
              )}

              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => void doBuy()}
                disabled={!selected || !selected.onSale || selected.available < 1 || buying}
                data-ticket-buy
                className="w-full rounded-xl py-3.5 text-sm font-black"
                style={{
                  background: `hsl(${hue},65%,42%)`, color: '#fff', border: 'none',
                  cursor: (!selected || buying) ? 'not-allowed' : 'pointer',
                  opacity: (!selected || !selected.onSale || selected.available < 1) ? 0.5 : 1,
                  boxShadow: `0 4px 20px hsl(${hue},60%,25%)`,
                }}>
                {buying ? <Loader2 size={14} className="inline animate-spin" /> : `Купить · ${fmtMoney(total)}`}
              </motion.button>
              {/* Цену и остаток считает сервер: то, что нарисовано выше, — его ответ. */}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Кабинет организатора ── */
  if (tab === 'org') {
    return (
      <OrganizerCabinet
        onBack={() => setTab('events')}
        onSubscription={setSubscription}
      />
    );
  }

  /* ── Главный экран ── */
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <TicketIcon size={19} style={{ color: 'var(--t1)' }} />
            <h2 className="text-base font-black" style={{ color: 'var(--t1)' }}>Sky Билеты</h2>
          </div>
          {myTickets.length > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)' }}>
              <TicketIcon size={12} className="inline mr-1" />{myTickets.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-3" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--t3)', flexShrink: 0 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск событий, площадок..."
            aria-label="Поиск по афише"
            className="flex-1 text-sm bg-transparent outline-none" style={{ color: 'var(--t1)' }} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Очистить поиск"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
          {([['', 'Все'], ...categories.map(c => [c, c] as [string, string])] as [string, string][]).map(([k, l]) => (
            <button key={k || 'all'} type="button" onClick={() => setCategory(k)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: category === k ? 'var(--t1)' : 'var(--bg-l3)', color: category === k ? 'var(--bg)' : 'var(--t3)', border: `1px solid ${category === k ? 'transparent' : 'var(--border)'}`, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
          <div className="w-px shrink-0" style={{ background: 'var(--border)', margin: '2px 4px' }} />
          {(['Все', ...cities]).map(ct => (
            <button key={ct} type="button" onClick={() => setCity(ct)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: city === ct ? 'rgba(79,110,247,0.15)' : 'transparent', color: city === ct ? 'var(--accent)' : 'var(--t3)', border: `1px solid ${city === ct ? 'rgba(79,110,247,0.25)' : 'transparent'}`, cursor: 'pointer' }}>
              {ct}
            </button>
          ))}
          <div className="w-px shrink-0" style={{ background: 'var(--border)', margin: '2px 4px' }} />
          {([['all', 'Все'], ['budget', '< 1К'], ['mid', '1–5К'], ['prem', '5К+']] as [PriceBand, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setBand(k)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: band === k ? 'rgba(0,200,90,0.1)' : 'transparent', color: band === k ? 'var(--green)' : 'var(--t3)', border: `1px solid ${band === k ? 'rgba(0,200,90,0.2)' : 'transparent'}`, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 px-5 py-2.5 shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)', scrollbarWidth: 'none' }}>
        {([['events', 'Афиша'], ['my', 'Мои билеты'], ['fav', 'Избранное'], ['org', 'Кабинет']] as [MainTab, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            data-tickets-tab={k}
            className="shrink-0 rounded-xl px-4 py-1.5 text-xs font-bold transition-all"
            style={{ background: tab === k ? 'var(--accent)' : 'var(--bg-l2)', color: tab === k ? '#fff' : 'var(--t3)', border: `1px solid ${tab === k ? 'transparent' : 'var(--border)'}`, cursor: 'pointer' }}>
            {k === 'org' && <Briefcase size={11} className="inline mr-1" />}
            {l}
            {k === 'org' && subscription?.active && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: 'var(--green)' }} />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {tab === 'events' && (
          <>
            {loading && catalog.length === 0 && (
              <div className="grid place-items-center h-40"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>
            )}
            {catalog.map(ev => (
              <EventCard key={ev.id} ev={ev}
                onOpen={() => void openEvent(ev.id)}
                onFav={e => { e.stopPropagation(); void toggleFav(ev); }} />
            ))}
            {!loading && catalog.length === 0 && (
              <div className="grid place-items-center h-40">
                <p className="text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено</p>
              </div>
            )}
          </>
        )}

        {tab === 'my' && (
          <>
            <div className="flex gap-1.5">
              {([['active', 'Действующие'], ['past', 'Прошедшие']] as ['active' | 'past', string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMyScope(k)}
                  className="rounded-xl px-3 py-1.5 text-xs font-bold"
                  style={{ background: myScope === k ? 'var(--bg-l3)' : 'transparent', color: myScope === k ? 'var(--t1)' : 'var(--t3)', border: `1px solid ${myScope === k ? 'var(--border)' : 'transparent'}`, cursor: 'pointer' }}>
                  {l}
                </button>
              ))}
            </div>
            {myTickets.length === 0
              ? (
                <div className="grid place-items-center h-40 text-center">
                  <div>
                    <TicketIcon size={36} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
                    <p className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Нет билетов</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Купите в разделе «Афиша»</p>
                  </div>
                </div>
              )
              : myTickets.map(t => {
                const hue = hueOf(t.accent);
                return (
                  <div key={t.id} data-ticket-code={t.code}
                    className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-3 px-4 py-3" style={{ background: bgGrad(hue), borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate text-white">{t.eventTitle}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{t.venue} · {fmtWhen(t.startsAt)}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: 'rgba(0,0,0,0.35)', color: TICKET_STATUS_COLOR[t.status] }}>
                        {TICKET_STATUS_LABEL[t.status]}
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
                          {t.typeName} · место {t.seatNo} · куплен {fmtStamp(t.createdAt)}
                        </p>
                        <p className="text-sm font-black" style={{ color: 'var(--accent)' }}>{fmtMoney(t.price)}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <span className="text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-l3)', color: 'var(--accent)', border: '1px solid var(--border)' }}>{t.code}</span>
                        <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => setShowQR(t)}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold"
                          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)', cursor: 'pointer' }}>
                          <QrCode size={12} className="inline mr-1" />QR
                        </motion.button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </>
        )}

        {tab === 'fav' && (
          favorites.length === 0
            ? (
              <div className="grid place-items-center h-40 text-center">
                <div>
                  <Heart size={36} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
                  <p className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Нет избранного</p>
                </div>
              </div>
            )
            : favorites.map(ev => {
              const hue = hueOf(ev.accent);
              const Icon = categoryIcon(ev.category);
              return (
                <motion.div key={ev.id} whileHover={{ y: -1 }} onClick={() => void openEvent(ev.id)}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <div className="h-12 w-12 rounded-xl grid place-items-center shrink-0 overflow-hidden" style={{ background: bgGrad(hue) }}>
                    {ev.hasCover
                      ? <img src={coverUrl(ev.id)} alt="" className="h-full w-full object-cover" />
                      : <Icon size={20} style={{ color: '#fff' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{ev.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{ev.venue} · {fmtDate(ev.startsAt)}</p>
                    <p className="text-xs font-bold mt-1" style={{ color: 'var(--t1)' }}>
                      {ev.priceFrom === null ? 'билетов нет' : `от ${fmtMoney(ev.priceFrom)}`}
                    </p>
                  </div>
                  <motion.button whileTap={{ scale: 0.8 }} type="button"
                    aria-label="Убрать из избранного"
                    onClick={e => { e.stopPropagation(); void toggleFav(ev); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Heart size={18} fill="#ef4444" style={{ color: '#ef4444' }} />
                  </motion.button>
                </motion.div>
              );
            })
        )}
      </div>
    </div>
  );
};
