/**
 * Вкладка «Общий склад» внутри склада.
 *
 * Личный склад — это владелец, его сотрудники и его же товар. Общий
 * устроен иначе: приходит чужой продавец, кладёт чужой товар в
 * запираемую ячейку и платит за неё владельцу склада напрямую. Sky в
 * этих деньгах не участвует так же, как не участвует в деньгах сделки.
 *
 * Открыть общий склад одним переключателем нельзя, и этот экран не
 * решает, можно ли: он показывает то, что ответил сервер. Список «чего
 * не хватает» приходит оттуда же — «нельзя» без объяснения заставляет
 * гадать.
 */
import { ReviewVideo } from './ReviewVideo';
import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Check, X, Upload, Lock, KeyRound, Ban, Trash2, Plus, ShieldCheck,
} from 'lucide-react';
import { C, fmt, fmtTs } from '@/marketplace/SkyMarket';
import { SlidePanel, ConfirmModal } from './shared';
import { DocumentGate } from './DocumentGate';
import {
  apiReadiness, apiUpdateShared, apiSharedAction, apiVideoReview, apiUploadVideo,
  apiCells, apiCreateCell, apiDeleteCell, apiBlockCell,
  apiWarehouseRentals, apiMoveRental, apiMoveKey, apiCancelRental,
  videoUrl, CELL_SIZE_LABEL, CELL_STATE_LABEL, RENTAL_LABEL, KEY_LABEL,
  type SharedSettings, type Readiness, type VideoReview, type Cell, type Rental, type CellSize,
} from './sharedApi';
import type { Warehouse } from './types';

const inputStyle = { background: 'var(--bg-l2)', border: '1px solid var(--brd)', color: 'var(--t1)' };

const STATE_LABEL: Record<string, string> = {
  off: 'Личный склад',
  review: 'Заявка на проверке',
  active: 'Открыт для чужих',
  rejected: 'Заявка отклонена',
  suspended: 'Отключён администрацией',
};

/* ─── Чего не хватает ──────────────────────────────────────────────── */

const READY_LABEL: { key: keyof Readiness; text: string }[] = [
  { key: 'video',   text: 'Видеообзор помещения одобрен администрацией' },
  { key: 'rules',   text: 'Регламент общедоступного склада принят' },
  { key: 'payment', text: 'Указаны реквизиты для оплаты ячеек' },
  { key: 'price',   text: 'Назначена цена ячейки' },
  { key: 'cells',   text: 'Заведена хотя бы одна ячейка' },
];

const ReadyList = ({ ready }: { ready: Readiness }) => (
  <div className="space-y-1.5">
    {READY_LABEL.map((r) => (
      <div key={r.key} className="flex items-start gap-2 text-[11px]">
        {ready[r.key]
          ? <Check size={13} style={{ color: C.green, flexShrink: 0, marginTop: 1 }} />
          : <X size={13} style={{ color: C.t3, flexShrink: 0, marginTop: 1 }} />}
        <span style={{ color: ready[r.key] ? C.t2 : C.t3 }}>{r.text}</span>
      </div>
    ))}
  </div>
);

/* ─── Видеообзор ───────────────────────────────────────────────────── */

const VideoBlock = ({ warehouseId, onChanged }: { warehouseId: string; onChanged: () => void }) => {
  const [review, setReview] = useState<VideoReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    const r = await apiVideoReview(warehouseId);
    setReview(r.ok ? (r.data?.review ?? null) : null);
    setLoaded(true);
  }, [warehouseId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true); setFailed('');
    const r = await apiUploadVideo(warehouseId, file);
    setBusy(false);
    if (!r.ok) {
      setFailed(r.error === 'too_large' ? 'Запись слишком большая — не больше 512 МБ.'
        : r.error === 'unsupported_video' ? 'Это не видеофайл. Подойдут MP4, MOV и WebM.'
          : r.error === 'review_pending' ? 'Прошлый обзор ещё на проверке.'
            : 'Не удалось загрузить. Попробуйте ещё раз.');
      return;
    }
    await load();
    onChanged();
  };

  if (!loaded) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Регламент требует зонирования, нумерации мест и запираемых ячеек с ключами.
        Проверить это по анкете нельзя — поэтому помещение снимают на видео,
        и запись смотрит человек из администрации. Её видите только вы и она.
      </p>

      {review && (
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold" style={{
              color: review.status === 'approved' ? C.green
                : review.status === 'rejected' ? C.red : C.amber,
            }}>
              {review.status === 'approved' ? 'Обзор одобрен'
                : review.status === 'rejected' ? 'Обзор отклонён' : 'Обзор на проверке'}
            </span>
            <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(review.createdAt)}</span>
          </div>
          {review.status === 'rejected' && review.rejectReason && (
            <p className="mt-1.5 text-[11px]" style={{ color: C.t2 }}>Причина: {review.rejectReason}</p>
          )}
          <ReviewVideo id={review.id} maxHeight={200} />
        </div>
      )}

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {review?.status !== 'pending' && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {review ? 'Снять и загрузить заново' : 'Загрузить видеообзор'}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      )}
    </div>
  );
};

/* ─── Ячейки ───────────────────────────────────────────────────────── */

const CellsBlock = ({ warehouseId, onChanged }: { warehouseId: string; onChanged: () => void }) => {
  const [cells, setCells] = useState<Cell[]>([]);
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState('');
  const [zone, setZone] = useState('');
  const [size, setSize] = useState<CellSize>('medium');
  const [price, setPrice] = useState('');
  const [failed, setFailed] = useState('');
  const [blocking, setBlocking] = useState<Cell | null>(null);
  const [reason, setReason] = useState('');
  const [dropping, setDropping] = useState<Cell | null>(null);

  const load = useCallback(async () => {
    const r = await apiCells(warehouseId);
    setCells(r.ok ? (r.data?.cells ?? []) : []);
  }, [warehouseId]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!number.trim()) return;
    const r = await apiCreateCell(warehouseId, {
      number: number.trim(), zone: zone.trim(), size,
      price: price.trim() === '' ? null : Number(price),
    });
    if (!r.ok) {
      setFailed(r.error === 'number_taken' ? 'Ячейка с таким номером уже есть.'
        : r.error === 'too_many_cells' ? 'Больше ячеек завести нельзя.'
          : 'Не получилось завести ячейку.');
      return;
    }
    setNumber(''); setZone(''); setPrice(''); setFailed(''); setAdding(false);
    await load(); onChanged();
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Регламент, п. 3: у каждой ячейки свой номер, свой замок и свой ключ.
        Ячейка с пропавшим ключом выводится из эксплуатации до замены замка —
        это происходит само, когда ключ отмечают утраченным.
      </p>

      {cells.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <Lock size={13} style={{
            color: c.state === 'free' ? C.green : c.state === 'blocked' ? C.red : C.amber,
          }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold" style={{ color: C.t1 }}>
              №{c.number}
              {c.zone && <span className="font-normal" style={{ color: C.t3 }}> · {c.zone}</span>}
            </p>
            <p className="text-[10px]" style={{ color: C.t3 }}>
              {CELL_SIZE_LABEL[c.size]} · {CELL_STATE_LABEL[c.state]}
              {c.price != null && ` · ${fmt(c.price)}`}
            </p>
            {c.blockReason && (
              <p className="text-[10px]" style={{ color: C.red }}>{c.blockReason}</p>
            )}
          </div>
          <button type="button" onClick={() => { setBlocking(c); setReason(''); }}
            className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2 }}>
            <Ban size={12} style={{ color: c.state === 'blocked' ? C.green : C.amber }} />
          </button>
          <button type="button" onClick={() => setDropping(c)}
            className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2 }}>
            <Trash2 size={12} style={{ color: C.red }} />
          </button>
        </div>
      ))}

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {adding ? (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Номер на дверце, например A-01"
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Зона (по регламенту, п. 2.1)"
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          <div className="flex gap-2">
            <select value={size} onChange={(e) => setSize(e.target.value as CellSize)}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle}>
              {(Object.keys(CELL_SIZE_LABEL) as CellSize[]).map((s) => (
                <option key={s} value={s}>{CELL_SIZE_LABEL[s]}</option>
              ))}
            </select>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal"
              placeholder="Своя цена, ₽"
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          </div>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Своя цена нужна, только если эта ячейка дороже или дешевле прочих.
            Пусто — берётся цена склада.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void add()}
              className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
              Завести
            </button>
            <button type="button" onClick={() => setAdding(false)}
              className="rounded-xl px-4 py-2 text-xs" style={{ background: C.l2, color: C.t3 }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          <Plus size={13} /> Добавить ячейку
        </button>
      )}

      {blocking && (
        <ConfirmModal open onClose={() => setBlocking(null)}
          title={blocking.state === 'blocked' ? 'Вернуть ячейку в работу?' : 'Вывести ячейку из эксплуатации?'}>
          <p className="mb-3 text-xs" style={{ color: C.t2 }}>
            {blocking.state === 'blocked'
              ? 'Ячейка снова станет доступной. Если внутри чужой товар по живой аренде, она останется занятой.'
              : 'Регламент, п. 3.8 и 5.4: пропал ключ, сломан замок, есть следы вскрытия. Снятую аренду это не отменяет.'}
          </p>
          {blocking.state !== 'blocked' && (
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Почему выводим из эксплуатации"
              className="mb-3 w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />
          )}
          <div className="flex gap-2">
            <button type="button"
              onClick={() => {
                void apiBlockCell(blocking.id, blocking.state !== 'blocked', reason || 'Проверка замка')
                  .then(() => { setBlocking(null); void load(); });
              }}
              className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
              Да
            </button>
            <button type="button" onClick={() => setBlocking(null)}
              className="rounded-xl px-4 py-2 text-xs" style={{ background: C.l2, color: C.t3 }}>
              Отмена
            </button>
          </div>
        </ConfirmModal>
      )}

      {dropping && (
        <ConfirmModal open onClose={() => setDropping(null)} title="Удалить ячейку?">
          <p className="mb-3 text-xs" style={{ color: C.t2 }}>
            Ячейку с живой арендой удалить нельзя: внутри чужой товар.
          </p>
          <div className="flex gap-2">
            <button type="button"
              onClick={() => {
                void apiDeleteCell(dropping.id).then((r) => {
                  setDropping(null);
                  if (!r.ok) {
                    setFailed(r.error === 'cell_rented'
                      ? 'Ячейка снята — сначала закройте аренду.' : 'Не удалось удалить.');
                  }
                  void load(); onChanged();
                });
              }}
              className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.red, color: '#fff' }}>
              Удалить
            </button>
            <button type="button" onClick={() => setDropping(null)}
              className="rounded-xl px-4 py-2 text-xs" style={{ background: C.l2, color: C.t3 }}>
              Отмена
            </button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
};

/* ─── Аренды склада ────────────────────────────────────────────────── */

const RentalsBlock = ({ warehouseId }: { warehouseId: string }) => {
  const [rentals, setRentals] = useState<Rental[]>([]);

  const load = useCallback(async () => {
    const r = await apiWarehouseRentals(warehouseId);
    setRentals(r.ok ? (r.data?.rentals ?? []) : []);
  }, [warehouseId]);

  useEffect(() => { void load(); }, [load]);

  if (rentals.length === 0) {
    return <p className="py-6 text-center text-[11px]" style={{ color: C.t3 }}>Ячейки пока никто не снял.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Деньги за ячейку арендатор переводит вам напрямую по вашим реквизитам.
        Sky перевода не видит: «получил» — это ваше слово, а не проверка платежа.
      </p>

      {rentals.map((r) => (
        <div key={r.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>Ячейка №{r.cellNumber}</p>
            <span className="text-[10px] font-bold" style={{
              color: r.status === 'active' ? C.green : r.status === 'cancelled' ? C.red : C.amber,
            }}>{RENTAL_LABEL[r.status]}</span>
          </div>
          <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
            {r.days} дн. · {fmt(r.total)} · {KEY_LABEL[r.keyState]}
            {r.endsAt && ` · до ${fmtTs(r.endsAt)}`}
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(r.status === 'created' || r.status === 'payment_declared') && (
              <button type="button"
                onClick={() => void apiMoveRental(r.id, 'confirm-paid').then(load)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>
                Деньги получил
              </button>
            )}
            {r.status === 'active' && (
              <>
                <button type="button"
                  onClick={() => void apiMoveKey(r.id, r.keyState === 'issued' ? 'stored' : 'issued').then(load)}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
                  style={{ background: C.l2, color: C.t2 }}>
                  <KeyRound size={11} /> {r.keyState === 'issued' ? 'Ключ вернули' : 'Выдать ключ'}
                </button>
                <button type="button"
                  onClick={() => void apiMoveKey(r.id, 'lost').then(load)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l2, color: C.red }}>
                  Ключ утрачен
                </button>
                <button type="button"
                  onClick={() => void apiMoveRental(r.id, 'finish').then(load)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l2, color: C.t2 }}>
                  Закрыть аренду
                </button>
              </>
            )}
            {(r.status === 'created' || r.status === 'payment_declared') && (
              <button type="button"
                onClick={() => void apiCancelRental(r.id, 'Отменено складом').then(load)}
                className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: C.l2, color: C.red }}>
                Отменить
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ─── Сама вкладка ─────────────────────────────────────────────────── */

type Section = 'state' | 'settings' | 'cells' | 'rentals';

export const SharedWarehouseTab = ({ wh }: { wh: Warehouse }) => {
  const [settings, setSettings] = useState<SharedSettings | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [section, setSection] = useState<Section>('state');
  const [gate, setGate] = useState(false);
  const [failed, setFailed] = useState('');

  /* Поля настроек держим отдельно: пока их правят, показывать надо
     набранное, а не то, что лежит на сервере. */
  const [price, setPrice] = useState('');
  const [period, setPeriod] = useState('7');
  const [minDays, setMinDays] = useState('7');
  const [maxDays, setMaxDays] = useState('180');
  const [pay, setPay] = useState('');
  const [rules, setRules] = useState('');
  const [cctv, setCctv] = useState(false);
  const [guard, setGuard] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      apiReadiness(wh.id),
      apiUpdateShared(wh.id, {}),
    ]);
    if (r1.ok && r1.data) setReady(r1.data.readiness);
    if (r2.ok && r2.data) {
      const s = r2.data.settings;
      setSettings(s);
      setPrice(s.cellPrice ? String(s.cellPrice) : '');
      setPeriod(String(s.cellPeriodDays));
      setMinDays(String(s.minRentDays));
      setMaxDays(String(s.maxRentDays));
      setPay(s.paymentDetails ?? '');
      setRules(s.rules);
      setCctv(s.hasCctv);
      setGuard(s.hasGuard);
    }
  }, [wh.id]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setFailed('');
    const r = await apiUpdateShared(wh.id, {
      cellPrice: Number(price) || 0,
      cellPeriodDays: Number(period) || 7,
      minRentDays: Number(minDays) || 1,
      maxRentDays: Number(maxDays) || 180,
      paymentDetails: pay,
      rules,
      hasCctv: cctv,
      hasGuard: guard,
    });
    if (!r.ok) {
      setFailed(r.error === 'bad_days'
        ? 'Наименьший срок не может быть больше наибольшего.'
        : 'Не удалось сохранить.');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await load();
  };

  const act = async (action: 'request' | 'activate' | 'close') => {
    setFailed('');
    const r = await apiSharedAction(wh.id, action);
    if (!r.ok) {
      setFailed(
        r.error === 'warehouse_rules_required' ? 'Сначала примите регламент.'
          : r.error === 'video_review_required' ? 'Сначала загрузите видеообзор и дождитесь решения.'
            : r.error === 'video_review_rejected' ? 'Обзор отклонён — снимите заново.'
              : r.error === 'payment_details_required' ? 'Укажите реквизиты для оплаты ячеек.'
                : r.error === 'cell_price_required' ? 'Назначьте цену ячейки.'
                  : r.error === 'cells_required' ? 'Заведите хотя бы одну ячейку.'
                    : r.error === 'shared_suspended' ? 'Склад отключён администрацией.'
                      : 'Не получилось.');
      return;
    }
    await load();
  };

  if (gate) {
    return (
      <SlidePanel open onClose={() => setGate(false)} onBack={() => setGate(false)}
        title="Регламент общедоступного склада">
        <DocumentGate code="shared_warehouse_rules"
          note="Его принимают и владелец склада, и каждый, кто снимает ячейку: доступ к складу получают оба."
          onAccepted={() => { setGate(false); void load(); }} />
      </SlidePanel>
    );
  }

  if (!settings || !ready) {
    return <div className="grid place-items-center py-10"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>;
  }

  const SECTIONS: { key: Section; label: string }[] = [
    { key: 'state', label: 'Состояние' },
    { key: 'settings', label: 'Настройки' },
    { key: 'cells', label: 'Ячейки' },
    { key: 'rentals', label: 'Аренды' },
  ];

  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: section === s.key ? C.accBg : C.l2, color: section === s.key ? C.acc : C.t3 }}>
            {s.label}
          </button>
        ))}
      </div>

      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      {section === 'state' && (
        <div className="space-y-3">
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} style={{
                color: settings.state === 'active' ? C.green
                  : settings.state === 'suspended' || settings.state === 'rejected' ? C.red : C.amber,
              }} />
              <p className="text-xs font-bold" style={{ color: C.t1 }}>
                {STATE_LABEL[settings.state] ?? settings.state}
              </p>
            </div>
            {settings.state === 'suspended' && (
              <p className="mt-1.5 text-[11px]" style={{ color: C.t2 }}>
                Отключено администрацией за нарушение регламента. Обратно включить может только она.
              </p>
            )}
          </div>

          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="mb-2 text-[10px] font-bold" style={{ color: C.t3 }}>ЧТО НУЖНО, ЧТОБЫ ОТКРЫТЬ</p>
            <ReadyList ready={ready} />
          </div>

          {!ready.rules && (
            <button type="button" onClick={() => setGate(true)}
              className="w-full rounded-xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
              Прочитать и принять регламент
            </button>
          )}

          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="mb-2 text-[10px] font-bold" style={{ color: C.t3 }}>ВИДЕООБЗОР ПОМЕЩЕНИЯ</p>
            <VideoBlock warehouseId={wh.id} onChanged={() => void load()} />
          </div>

          <div className="flex gap-2">
            {settings.state !== 'active' && settings.state !== 'suspended' && (
              <>
                {settings.state === 'off' || settings.state === 'rejected' ? (
                  <button type="button" onClick={() => void act('request')}
                    className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
                    Подать заявку
                  </button>
                ) : null}
                <button type="button" onClick={() => void act('activate')}
                  className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
                  Открыть общий склад
                </button>
              </>
            )}
            {settings.state === 'active' && (
              <button type="button" onClick={() => void act('close')}
                className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.red }}>
                Закрыть для чужих
              </button>
            )}
          </div>

          {settings.state === 'active' && (
            <p className="text-[10px]" style={{ color: C.t3 }}>
              Закрытие не рвёт живые аренды: у людей внутри лежит товар. Склад просто
              перестаёт принимать новых.
            </p>
          )}
        </div>
      )}

      {section === 'settings' && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>ЦЕНА ОДНОЙ ЯЧЕЙКИ, ₽</p>
            <div className="flex gap-2">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              <input value={period} onChange={(e) => setPeriod(e.target.value)} inputMode="numeric"
                className="w-24 rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              Цена и срок, за который она берётся: {price || '0'} ₽ за {period || '7'} дн.
              Аренда на больший срок считается пропорционально — цену считает сервер, не экран.
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>СРОК АРЕНДЫ, ДНЕЙ</p>
            <div className="flex items-center gap-2">
              <input value={minDays} onChange={(e) => setMinDays(e.target.value)} inputMode="numeric"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              <span className="text-xs" style={{ color: C.t3 }}>—</span>
              <input value={maxDays} onChange={(e) => setMaxDays(e.target.value)} inputMode="numeric"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>РЕКВИЗИТЫ ДЛЯ ОПЛАТЫ ЯЧЕЕК</p>
            <textarea value={pay} onChange={(e) => setPay(e.target.value)} rows={3}
              placeholder="Куда арендатор переводит деньги: счёт, карта, СБП"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              Приходят арендатору вместе с его арендой, от сервера. Присланные в переписке
              реквизиты подменяет тот, кто в переписку попал.
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-bold" style={{ color: C.t3 }}>ПРАВИЛА ЭТОГО СКЛАДА</p>
            <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={4}
              placeholder="Что здесь нельзя, когда приёмка, как получить ключ"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              Поверх общего регламента, не вместо него.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
            <input type="checkbox" checked={cctv} onChange={(e) => setCctv(e.target.checked)} />
            Есть видеонаблюдение (регламент, п. 8.1)
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
            <input type="checkbox" checked={guard} onChange={(e) => setGuard(e.target.checked)} />
            Есть охрана
          </label>

          <button type="button" onClick={() => void save()}
            className="w-full rounded-xl py-2.5 text-xs font-bold"
            style={{ background: saved ? C.green : C.acc, color: '#fff' }}>
            {saved ? 'Сохранено' : 'Сохранить настройки'}
          </button>
        </div>
      )}

      {section === 'cells' && <CellsBlock warehouseId={wh.id} onChanged={() => void load()} />}
      {section === 'rentals' && <RentalsBlock warehouseId={wh.id} />}
    </div>
  );
};
