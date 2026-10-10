/**
 * Отслеживание посылки: карточка в заказе и разовая проверка номера.
 *
 * Показывает состояние ТАМ, где его знает служба (СДЭК, Почта России,
 * DHL, UPS …). На состояние заказа это не влияет — «получено» по-прежнему
 * подтверждает покупатель или пункт выдачи. Если сервер не подключён к
 * API службы, остаётся ссылка на её публичную страницу.
 */
import { useEffect, useState } from 'react';
import { Truck, ExternalLink, RefreshCw, Trash2, Search, PackageCheck, AlertTriangle, MapPin } from 'lucide-react';
import { C, fmtTime, inputStyle } from './ui';
import {
  apiOrderTracking, apiSetOrderTracking, apiClearOrderTracking, apiTrackingProviders, apiTrackingLookup,
  type OrderTracking, type Parcel, type ParcelStatus, type TrackingProvider,
} from './trackingApi';

const STATUS_LABEL: Record<ParcelStatus, string> = {
  created: 'Принята к отправке',
  in_transit: 'В пути',
  out_for_delivery: 'Передана курьеру',
  ready_for_pickup: 'Ожидает в пункте выдачи',
  delivered: 'Вручена',
  exception: 'Проблема с доставкой',
  returned: 'Возврат отправителю',
  unknown: 'Нет данных',
};

const STATUS_COLOR: Record<ParcelStatus, string> = {
  created: C.t2, in_transit: C.acc, out_for_delivery: C.acc, ready_for_pickup: C.amber,
  delivered: C.green, exception: C.red, returned: C.red, unknown: C.t3,
};

const ERROR_LABEL: Record<string, string> = {
  not_configured: 'Онлайн-отслеживание этой службы пока не подключено — откройте страницу службы.',
  upstream_unavailable: 'Служба сейчас не отвечает. Попробуйте позже или откройте её страницу.',
  bad_input: 'Проверьте номер: латиница, цифры и дефис, от 5 до 40 символов.',
  bad_number: 'Проверьте номер: латиница, цифры и дефис, от 5 до 40 символов.',
  bad_provider: 'Выберите службу из списка.',
  bad_status: 'Сейчас номер у этого заказа менять нельзя.',
  rate_limited: 'Слишком много запросов. Подождите минуту.',
};

const useProviders = () => {
  const [list, setList] = useState<TrackingProvider[]>([]);
  useEffect(() => {
    let alive = true;
    void apiTrackingProviders().then((r) => { if (alive && r.ok && r.data) setList(r.data.providers); });
    return () => { alive = false; };
  }, []);
  return list;
};

const ProviderSelect = ({ value, onChange, list }:
{ value: string; onChange: (v: string) => void; list: TrackingProvider[] }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl px-3 py-2 text-[12px] outline-none"
    style={inputStyle}>
    <optgroup label="Россия">
      {list.filter((p) => p.region === 'ru').map((p) => <option key={p.code} value={p.code}>{p.title}</option>)}
    </optgroup>
    <optgroup label="Международные">
      {list.filter((p) => p.region === 'intl').map((p) => <option key={p.code} value={p.code}>{p.title}</option>)}
    </optgroup>
  </select>
);

/* ── История посылки ──────────────────────────────────────────────── */

const Timeline = ({ parcel }: { parcel: Parcel }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      {parcel.status === 'delivered' ? <PackageCheck size={14} style={{ color: STATUS_COLOR.delivered }} />
        : parcel.status === 'exception' || parcel.status === 'returned'
          ? <AlertTriangle size={14} style={{ color: STATUS_COLOR[parcel.status] }} />
          : <Truck size={14} style={{ color: STATUS_COLOR[parcel.status] }} />}
      <p className="text-[12px] font-bold" style={{ color: STATUS_COLOR[parcel.status] }}>
        {STATUS_LABEL[parcel.status]}
      </p>
    </div>
    {parcel.events.length === 0 ? (
      <p className="text-[11px]" style={{ color: C.t3 }}>
        У службы пока нет событий по этому номеру. Сразу после сдачи посылки они могут появиться не сразу.
      </p>
    ) : (
      <ol className="space-y-2 border-l pl-3" style={{ borderColor: C.brd }}>
        {parcel.events.slice(0, 20).map((e, i) => (
          <li key={`${e.time}-${i}`} className="relative">
            <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full"
              style={{ background: i === 0 ? C.acc : C.brdM }} />
            <p className="text-[11.5px]" style={{ color: i === 0 ? C.t1 : C.t2 }}>{e.text}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-[10.5px]" style={{ color: C.t3 }}>
              {e.time && <span>{fmtTime(e.time)}</span>}
              {e.location && <span className="flex items-center gap-0.5"><MapPin size={9} />{e.location}</span>}
            </p>
          </li>
        ))}
      </ol>
    )}
  </div>
);

const OpenLink = ({ url }: { url: string | null }) => url ? (
  <a href={url} target="_blank" rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: C.acc }}>
    <ExternalLink size={11} /> Открыть на сайте службы
  </a>
) : null;

/* ── Трек в заказе ────────────────────────────────────────────────── */

export const ParcelTracking = ({ orderId }: { orderId: string }) => {
  const providers = useProviders();
  const [data, setData] = useState<OrderTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState('cdek');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await apiOrderTracking(orderId);
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId]);

  const save = async () => {
    setBusy(true); setError(null);
    const r = await apiSetOrderTracking(orderId, provider, number.trim());
    setBusy(false);
    if (!r.ok) { setError(ERROR_LABEL[r.reason ?? ''] ?? r.reason ?? 'Не удалось сохранить'); return; }
    setEditing(false); setNumber('');
    await load();
  };
  const clear = async () => {
    setBusy(true);
    await apiClearOrderTracking(orderId);
    setBusy(false);
    await load();
  };

  if (loading && !data) return null;
  if (!data) return null;
  if (!data.tracking && !data.canEdit) return null;

  const form = (
    <div className="space-y-2">
      <ProviderSelect value={provider} onChange={setProvider} list={providers} />
      <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Трек-номер посылки"
        maxLength={40} className="w-full rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
      {error && <p className="text-[11px]" style={{ color: C.red }}>{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={busy || number.trim().length < 5}
          className="rounded-xl px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: C.acc }}>
          {busy ? 'Сохраняю…' : 'Сохранить'}
        </button>
        {data.tracking && (
          <button type="button" onClick={() => { setEditing(false); setError(null); }}
            className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: C.l2, color: C.t2 }}>Отмена</button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2.5 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Отслеживание посылки</p>
        {data.tracking && (
          <button type="button" onClick={() => void load()} aria-label="Обновить"
            className="grid h-7 w-7 place-items-center rounded-full" style={{ background: C.l2 }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} style={{ color: C.t2 }} />
          </button>
        )}
      </div>

      {!data.tracking && !editing && (
        <>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            Отправили заказ службой? Укажите трек-номер — покупатель увидит, где посылка.
          </p>
          {form}
        </>
      )}

      {data.tracking && (
        <>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            {data.tracking.providerTitle} · <span style={{ color: C.t1 }}>{data.tracking.number}</span>
          </p>
          {data.parcel ? <Timeline parcel={data.parcel} />
            : <p className="text-[11px]" style={{ color: C.t2 }}>
                {ERROR_LABEL[data.parcelError ?? ''] ?? 'Данных о посылке пока нет.'}
              </p>}
          {data.stale && <p className="text-[10.5px]" style={{ color: C.t3 }}>Показаны последние сохранённые данные — служба сейчас не ответила.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <OpenLink url={data.tracking.url} />
            {data.canEdit && !editing && (
              <span className="flex gap-3">
                <button type="button" onClick={() => { setEditing(true); setProvider(data.tracking!.provider); setNumber(data.tracking!.number); }}
                  className="text-[11px] font-bold" style={{ color: C.t2 }}>Изменить</button>
                <button type="button" onClick={() => void clear()} disabled={busy} aria-label="Убрать трек"
                  className="flex items-center gap-1 text-[11px] font-bold" style={{ color: C.red }}>
                  <Trash2 size={11} /> Убрать
                </button>
              </span>
            )}
          </div>
          {editing && form}
        </>
      )}
    </div>
  );
};

/* ── Разовая проверка любого номера ───────────────────────────────── */

export const ParcelLookup = () => {
  const providers = useProviders();
  const [provider, setProvider] = useState('cdek');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true); setError(null); setParcel(null); setUrl(null);
    const r = await apiTrackingLookup(provider, number.trim());
    setBusy(false);
    if (!r.ok || !r.data) { setError(ERROR_LABEL[r.reason ?? ''] ?? r.reason ?? 'Не удалось проверить'); return; }
    setUrl(r.data.url);
    if (r.data.parcel) setParcel(r.data.parcel);
    else setError(ERROR_LABEL[r.data.error ?? ''] ?? 'Данных о посылке пока нет.');
  };

  return (
    <div className="space-y-3 p-4">
      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>Где моя посылка?</p>
        <ProviderSelect value={provider} onChange={setProvider} list={providers} />
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Трек-номер" maxLength={40}
          onKeyDown={(e) => { if (e.key === 'Enter' && number.trim().length >= 5) void go(); }}
          className="w-full rounded-xl px-3 py-2 text-[12px] outline-none" style={inputStyle} />
        <button type="button" onClick={() => void go()} disabled={busy || number.trim().length < 5}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold text-white disabled:opacity-50"
          style={{ background: C.acc }}>
          <Search size={13} /> {busy ? 'Проверяю…' : 'Отследить'}
        </button>
      </div>
      {parcel && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[11px]" style={{ color: C.t3 }}>{parcel.carrierName} · <span style={{ color: C.t1 }}>{parcel.number}</span></p>
          <Timeline parcel={parcel} />
        </div>
      )}
      {error && <p className="text-[12px]" style={{ color: C.t2 }}>{error}</p>}
      <OpenLink url={url} />
    </div>
  );
};
