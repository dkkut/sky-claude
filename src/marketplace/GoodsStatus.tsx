/**
 * Экран статуса товара: где он сейчас и когда ожидать доставку.
 *
 * Данные собирает сервер из трёх источников — продавец или его сотрудник
 * (вручную), трек-номер службы доставки, отправление Sky Market — и
 * подписывает, откуда что взято. Внесённое вручную Sky не проверяет.
 */
import { useEffect, useState } from 'react';
import { MapPin, CalendarClock, PackageCheck, Truck, CheckCircle2, CircleDot, ExternalLink, Info, Users, X } from 'lucide-react';
import { C, fmtTime, inputStyle, Alert } from './ui';
import {
  apiGoodsStatus, apiSetGoodsStatus, apiClearGoodsStatus, apiGoodsQueue, apiGoodsStaff, apiAddGoodsStaff, apiRemoveGoodsStaff,
  type GoodsStatus as GS, type QueueItem, type StaffPerson, type StatusSource,
} from './goodsStatusApi';

const STEPS: { key: string; label: string }[] = [
  { key: 'paid', label: 'Оплата подтверждена' },
  { key: 'packing', label: 'Собирается' },
  { key: 'shipped', label: 'Отправлен' },
  { key: 'transit', label: 'В пути' },
  { key: 'ready', label: 'Готов к выдаче' },
  { key: 'done', label: 'Получен' },
];
const STEP_OF: Record<string, number> = {
  seller_payment_confirmed: 0, fulfillment: 1, seller_shipped: 2, in_transit: 3,
  ready_for_pickup: 4, buyer_received: 5, completed: 5,
};
const SOURCE: Record<StatusSource, { label: string; color: string }> = {
  seller: { label: 'Указал продавец', color: C.acc },
  staff: { label: 'Указал сотрудник магазина', color: C.acc },
  tracking: { label: 'По трек-номеру', color: C.green },
  shipment: { label: 'Отправление Sky Market', color: C.green },
};
const ERR: Record<string, string> = {
  bad_status: 'Сейчас менять статус нельзя: заказ ещё не оплачен или уже закрыт.',
  bad_date: 'Проверьте даты: срок не раньше сегодняшнего, не дальше чем через 120 дней, «до» не раньше «от».',
  empty: 'Укажите, где товар, или ожидаемую дату.',
};

const day = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const daysLeft = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);
const etaWords = (from: string, to: string | null) => {
  const n = daysLeft(from);
  const head = n < 0 ? 'Срок прошёл' : n === 0 ? 'Сегодня' : n === 1 ? 'Завтра' : n < 5 ? `Через ${n} дня` : `Через ${n} дней`;
  return { head, range: to ? `${day(from)} – ${day(to)}` : day(from) };
};

const SourceBadge = ({ source }: { source: StatusSource }) => (
  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
    style={{ background: C.l2, color: SOURCE[source].color, border: `1px solid ${C.brd}` }}>
    <CircleDot size={9} />{SOURCE[source].label}
  </span>
);

/* Дорожка: пройденные шаги залиты, текущий подсвечен. */
const Timeline = ({ idx }: { idx: number }) => (
  <ol className="relative flex flex-col gap-0">
    {STEPS.map((s, i) => {
      const done = i < idx; const now = i === idx; const last = i === STEPS.length - 1;
      return (
        <li key={s.key} className="relative flex items-start gap-3 pb-3 last:pb-0">
          {!last && (
            <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-[2px] rounded"
              style={{ background: done ? C.green : C.brd }} />
          )}
          <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{
              background: done ? C.green : now ? C.acc : C.l2,
              border: `1px solid ${done || now ? 'transparent' : C.brd}`,
              boxShadow: now ? `0 0 0 4px color-mix(in srgb, ${C.acc} 22%, transparent)` : undefined,
            }}>
            {done ? <CheckCircle2 size={13} color="#fff" /> : now ? <Truck size={12} color="#fff" /> : null}
          </span>
          <span className="pt-[3px] text-[12px] font-semibold" style={{ color: done || now ? C.t1 : C.t3 }}>{s.label}</span>
        </li>
      );
    })}
  </ol>
);

const toLocalDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const toIso = (d: string) => (d ? new Date(`${d}T12:00:00`).toISOString() : null);

const Editor = ({ gs, onSaved }: { gs: GS; onSaved: () => void }) => {
  const [place, setPlace] = useState(gs.manual?.place ?? '');
  const [note, setNote] = useState(gs.manual?.note ?? '');
  const [from, setFrom] = useState(toLocalDate(gs.manual?.eta ?? null));
  const [to, setTo] = useState(toLocalDate(gs.manual?.etaTo ?? null));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await apiSetGoodsStatus(gs.orderId, { place, note, eta: toIso(from), etaTo: from ? toIso(to) : null });
    setBusy(false);
    if (r.ok) onSaved(); else setErr(ERR[r.error ?? ''] ?? r.reason ?? 'Не удалось сохранить');
  };
  const clear = async () => { setBusy(true); await apiClearGoodsStatus(gs.orderId); setBusy(false); onSaved(); };
  return (
    <div className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Обновить статус товара</p>
      <input value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder="Где сейчас товар: склад, город, пункт…"
        className="rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
      <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий (необязательно)"
        className="rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[10px]" style={{ color: C.t3 }}>Доставка не раньше
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1 text-[10px]" style={{ color: C.t3 }}>…и не позже
          <input type="date" value={to} min={from} disabled={!from} onChange={(e) => setTo(e.target.value)} className="rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
        </label>
      </div>
      {err && <Alert text={err} />}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="flex-1 rounded-xl py-2 text-[12px] font-bold text-white disabled:opacity-50"
          style={{ background: C.acc }}>{busy ? 'Сохраняем…' : 'Сохранить и уведомить покупателя'}</button>
        {gs.manual && (
          <button type="button" disabled={busy} onClick={() => void clear()} className="rounded-xl px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>Сбросить</button>
        )}
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>Если указан трек-номер, место подтягивается и у службы доставки — показывается самое свежее.</p>
    </div>
  );
};

export const GoodsStatusCard = ({ orderId, reloadKey }: { orderId: string; reloadKey?: string }) => {
  const [gs, setGs] = useState<GS | null>(null); const [err, setErr] = useState(false);
  const load = async () => { const r = await apiGoodsStatus(orderId); if (r.ok && r.data) { setGs(r.data); setErr(false); } else setErr(true); };
  useEffect(() => { void load(); }, [orderId, reloadKey]);
  if (err) return null;
  if (!gs) return <div className="h-40 animate-pulse rounded-3xl" style={{ background: C.l1 }} />;
  if (!(gs.orderStatus in STEP_OF)) return null;
  const idx = STEP_OF[gs.orderStatus];
  const eta = gs.eta?.from ? etaWords(gs.eta.from, gs.eta.to) : null;
  const closed = idx >= 5;
  return (
    <section className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-3xl" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="flex flex-col gap-3 p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${closed ? C.green : C.acc} 20%, transparent), transparent 70%)` }}>
          <div className="flex items-center gap-2">
            <PackageCheck size={16} style={{ color: closed ? C.green : C.acc }} />
            <p className="text-[13px] font-extrabold" style={{ color: C.t1 }}>{closed ? 'Товар у вас' : 'Статус товара'}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-2xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}><MapPin size={11} />Где сейчас</p>
              {gs.current?.place ? (
                <>
                  <p className="mt-1 text-[15px] font-extrabold leading-tight" style={{ color: C.t1 }} translate="no">{gs.current.place}</p>
                  {gs.current.text && gs.current.text !== gs.current.place && <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }} translate="no">{gs.current.text}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2"><SourceBadge source={gs.current.source} />
                    <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTime(gs.current.at)}</span></div>
                </>
              ) : <p className="mt-1 text-[12px]" style={{ color: C.t3 }}>Продавец пока не указал место товара.</p>}
            </div>
            <div className="rounded-2xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}><CalendarClock size={11} />Ожидаемая доставка</p>
              {eta && !closed ? (
                <>
                  <p className="mt-1 text-[15px] font-extrabold leading-tight" style={{ color: C.t1 }}>{eta.head}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{eta.range}</p>
                  {gs.eta && <div className="mt-2"><SourceBadge source={gs.eta.source} /></div>}
                </>
              ) : <p className="mt-1 text-[12px]" style={{ color: C.t3 }}>{closed ? 'Заказ доставлен.' : 'Срок пока не назван.'}</p>}
            </div>
          </div>
          {gs.manual?.note && <p className="rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2 }} translate="no">«{gs.manual.note}»</p>}
        </div>

        <div className="p-4"><Timeline idx={idx} /></div>

        {gs.tracking && (
          <div className="flex flex-col gap-2 border-t p-4" style={{ borderColor: C.brd }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Трек-номер · {gs.tracking.providerTitle}</p>
              {gs.tracking.url && (
                <a href={gs.tracking.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.acc }}>
                  Страница службы<ExternalLink size={11} /></a>
              )}
            </div>
            <p className="text-[12px] font-mono" style={{ color: C.t2 }} translate="no">{gs.tracking.number}</p>
            {gs.parcel?.events?.length ? (
              <ul className="flex flex-col gap-1">
                {gs.parcel.events.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-[11px]" style={{ color: C.t2 }}>
                    <span style={{ color: C.t3 }}>{fmtTime(e.time)} · </span><span translate="no">{e.text}{e.location ? ` (${e.location})` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px]" style={{ color: C.t3 }}>{gs.parcelError === 'not_configured' ? 'Онлайн-отслеживание этой службы не подключено — откройте страницу службы.' : 'Событий у службы пока нет.'}</p>}
          </div>
        )}
        <p className="flex items-start gap-1.5 border-t px-4 py-3 text-[10px]" style={{ borderColor: C.brd, color: C.t3 }}>
          <Info size={11} className="mt-px shrink-0" />Место и срок, внесённые продавцом или его сотрудником, Sky не проверяет. Данные по трек-номеру — от службы доставки. Получение подтверждает покупатель.
        </p>
      </div>
      {gs.canEdit && <Editor key={gs.manual?.updatedAt ?? 'new'} gs={gs} onSaved={() => void load()} />}
      {gs.history.length > 1 && (
        <details className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <summary className="cursor-pointer text-[11px] font-bold" style={{ color: C.t2 }}>История обновлений ({gs.history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {gs.history.map((h, i) => (
              <li key={i} className="text-[11px]" style={{ color: C.t2 }}>
                <span style={{ color: C.t3 }}>{fmtTime(h.at)} · {h.role === 'staff' ? 'сотрудник' : 'продавец'} · </span><span translate="no">{h.place || '—'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

/* ── Продавец: сотрудники, которые обновляют статусы ─────────────── */
export const GoodsStaffPanel = () => {
  const [list, setList] = useState<StaffPerson[]>([]); const [max, setMax] = useState(10);
  const [name, setName] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const load = async () => { const r = await apiGoodsStaff(); if (r.ok && r.data) { setList(r.data.staff); setMax(r.data.max); } };
  useEffect(() => { void load(); }, []);
  const E: Record<string, string> = { user_not_found: 'Такого @ника нет.', bad_username: 'Проверьте @ник.', self: 'Себя назначать не нужно.', too_many: 'Сотрудников уже максимум.', not_seller: 'Сначала откройте магазин.' };
  const add = async () => {
    setMsg(null); const r = await apiAddGoodsStaff(name);
    if (r.ok) { setName(''); void load(); } else setMsg(E[r.error ?? ''] ?? r.reason ?? 'Не получилось');
  };
  return (
    <div className="flex flex-col gap-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="flex items-center gap-2 text-[13px] font-bold" style={{ color: C.t1 }}><Users size={14} />Сотрудники, которые обновляют статус товаров</p>
      <p className="text-[11px]" style={{ color: C.t3 }}>Назначенный человек видит только очередь заказов в работе (без адресов и контактов покупателя) и может вносить, где товар и когда доставка. Платежами и заказом он не управляет.</p>
      {list.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: C.l2 }}>
          <span className="text-[12px]" style={{ color: C.t1 }} translate="no">{p.name} <span style={{ color: C.t3 }}>@{p.username}</span></span>
          <button type="button" aria-label="Убрать" onClick={() => void apiRemoveGoodsStaff(p.id).then(load)} style={{ color: C.t3 }}><X size={14} /></button>
        </div>
      ))}
      {list.length < max && (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="@ник сотрудника" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
          <button type="button" disabled={!name.trim()} onClick={() => void add()} className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: C.acc }}>Назначить</button>
        </div>
      )}
      {msg && <Alert text={msg} />}
    </div>
  );
};

/* ── Сотрудник и продавец: очередь заказов в работе ──────────────── */
export const GoodsQueue = () => {
  const [items, setItems] = useState<QueueItem[] | null>(null); const [open, setOpen] = useState<string | null>(null);
  const load = async () => { const r = await apiGoodsQueue(); setItems(r.ok && r.data ? r.data.orders : []); };
  useEffect(() => { void load(); }, [open]);
  if (open) return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen(null)} className="self-start text-[12px] font-semibold" style={{ color: C.acc }}>← К очереди</button>
      <GoodsStatusCard orderId={open} />
    </div>
  );
  if (!items) return <div className="h-24 animate-pulse rounded-2xl" style={{ background: C.l1 }} />;
  if (!items.length) return <p className="text-[12px]" style={{ color: C.t3 }}>Сейчас нет заказов, где нужно обновлять статус товара.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => setOpen(o.id)} className="flex w-full flex-col gap-0.5 rounded-2xl p-3 text-left" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <span className="text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{o.title}</span>
            <span className="text-[11px]" style={{ color: o.place ? C.t2 : C.amber }} translate="no">{o.place || 'Место не указано'}{o.eta ? ` · до ${day(o.eta)}` : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/** Вход для сотрудника и продавца: показывается, только если есть заказы в работе. */
export const GoodsQueueEntry = () => {
  const [n, setN] = useState(0); const [show, setShow] = useState(false);
  useEffect(() => { void apiGoodsQueue().then((r) => setN(r.ok && r.data ? r.data.orders.length : 0)); }, []);
  if (!n) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      <button type="button" onClick={() => setShow((v) => !v)} className="flex items-center justify-between rounded-2xl px-4 py-3 text-left"
        style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <span className="text-[13px] font-bold" style={{ color: C.t1 }}>Статус товаров в работе · {n}</span>
        <span className="text-[11px]" style={{ color: C.acc }}>{show ? 'Скрыть' : 'Открыть'}</span>
      </button>
      {show && <GoodsQueue />}
    </div>
  );
};
