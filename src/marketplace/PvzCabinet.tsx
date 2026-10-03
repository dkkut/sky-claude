/**
 * Кабинет владельца и сотрудника пункта выдачи (Sky ПВЗ).
 *
 * Показывается только тому, кто где-то работает (myPvz из store.ts) —
 * появляется вкладка в Sky Market, а не отдельное приложение. Права на
 * каждое действие проверяет сервер заново при каждом запросе; здесь
 * кнопки просто не рисуются там, где нажимать их всё равно нечем —
 * это удобство, а не защита.
 *
 * Сканер здесь — обычное текстовое поле: реальные ПВЗ читают QR
 * ручным сканером, который работает как клавиатура и просто печатает
 * содержимое кода с Enter в конце, либо сотрудник вставляет то, что
 * прочитала камера телефона. Декоративный «сканер», рисующий
 * прогресс-бар без реального разбора кадра, был бы обманом интерфейса.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Store, Plus, Users, Box, PackageCheck, Wallet, Video,
  ScrollText, Settings, ArrowLeft, CheckCircle2, AlertTriangle,
  QrCode, Upload, Loader2, ShieldAlert, Lock, Unlock,
} from 'lucide-react';
import { C, fmt, fmtTime, Empty, Field, inputStyle, Alert } from './ui';
import { useMarketStore } from './store';
import { PvzViolationsTab } from './ViolationsTab';
import {
  apiPvzConfig, apiPvzCreate, apiPvzActivate, apiPvzOverview, apiPvzSetClosed,
  apiPvzUpdateSettings, apiPvzStaff, apiPvzAddStaff, apiPvzRevokeStaff,
  apiPvzCells, apiPvzAddCell, apiPvzCellStatus, apiPvzIssueOrder,
  apiPvzCommissionsOwner, apiPvzCommissionDispute, apiPvzAudit,
  type PvzOverview, type PvzCell, type PvzStaffMember, type PvzRole,
  type PvzCommission, type PvzAuditEntry,
} from './pvzStaffApi';
import {
  apiPvzPendingShipments, apiPvzOpenShipmentByQr, apiPvzScanOrder,
  apiPvzManualReceive, apiPvzConfirmReceipt, apiPvzUnmatched, apiPvzResolveUnmatched,
  apiPvzShipmentDetail,
  type PvzShipment, type PvzShipmentDetail, type PvzUnmatchedScan,
} from './pvzShipmentsApi';
import { apiPvzVideoReview, apiUploadPvzVideo, videoUrl, type VideoReview } from './logistics/sharedApi';
import { ReportProblemButton } from './pvzSupport';

const ROLE_RANK: Record<PvzRole, number> = { read_only: 0, employee: 1, manager: 2, owner: 3 };
const ROLE_LABEL: Record<PvzRole, string> = {
  read_only: 'Только просмотр', employee: 'Сотрудник', manager: 'Менеджер', owner: 'Владелец',
};

type PvzTab = 'overview' | 'receiving' | 'cells' | 'issue' | 'staff' | 'commissions' | 'video' | 'audit' | 'violations' | 'settings';

/* ── Создание новой точки ─────────────────────────────────────────── */

const CreatePvz = ({ onCreated }: { onCreated: () => void }) => {
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [cellCount, setCellCount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => { void (async () => {
    const r = await apiPvzConfig();
    if (r.ok && r.data) setPrice(r.data.subscriptionPrice);
  })(); }, []);

  const create = async () => {
    if (!title.trim() || !city.trim() || !address.trim()) return;
    setBusy(true); setError(null);
    const r = await apiPvzCreate({
      title: title.trim(), city: city.trim(), address: address.trim(),
      phone: phone.trim() || undefined, cellCount: Number(cellCount) || 0,
    });
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Не получилось завести точку'); return; }
    onCreated();
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Store size={18} style={{ color: C.acc }} />
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Завести пункт выдачи</p>
      </div>
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Точка сразу видна вам в кабинете, но в публичный каталог не попадёт, пока не оплачена
        активация{price != null ? ` — ${fmt(price)}/мес` : ''}. Оплата спишется с кошелька Sky,
        так же как подписка продавца.
      </p>

      <Field label="Название"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
        className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Город"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80}
        className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Адрес"><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300}
        className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Телефон (необязательно)"><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40}
        className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Сколько ячеек завести сразу">
        <input value={cellCount} onChange={(e) => setCellCount(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      {error && <Alert text={error} />}

      <button type="button" disabled={busy || !title.trim() || !city.trim() || !address.trim()} onClick={create}
        className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Заводим…' : 'Завести точку'}
      </button>
    </div>
  );
};

/* ── Обзор точки + активация подписки ─────────────────────────────── */

const OverviewTab = ({ pvz, onChanged }: { pvz: PvzOverview; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setBusy(true); setError(null);
    const r = await apiPvzActivate(pvz.id);
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Не удалось оплатить активацию'); return; }
    onChanged();
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {pvz.ownerStatus === 'pending_activation' && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <p className="text-[12px] font-bold" style={{ color: C.amber }}>Точка ещё не активирована</p>
          <p className="text-[11px]" style={{ color: C.t2 }}>
            Пока не оплачена подписка, точки нет в публичном каталоге — покупатели не могут выбрать
            её при оформлении заказа.
          </p>
          {error && <Alert text={error} />}
          <button type="button" disabled={busy} onClick={activate}
            className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
            style={{ background: C.acc, color: '#fff' }}>
            {busy ? 'Оплачиваем…' : 'Активировать точку'}
          </button>
        </div>
      )}

      {pvz.staffClosed && <Alert kind="info" text={`Точка временно закрыта сотрудниками. ${pvz.staffClosedReason || ''}`} />}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[10px] font-semibold" style={{ color: C.t3 }}>Ячеек</p>
          <p className="text-lg font-black" style={{ color: C.t1 }}>{pvz.cellCount}</p>
        </div>
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[10px] font-semibold" style={{ color: C.t3 }}>Ждут выдачи</p>
          <p className="text-lg font-black" style={{ color: C.t1 }}>{pvz.waitingOrders.length}</p>
        </div>
      </div>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>{pvz.city}, {pvz.address}</p>
        <p className="mt-0.5 text-[10px]" style={{ color: C.t3 }}>
          {pvz.workFrom}–{pvz.workTo} · хранение {pvz.holdDays} дн. · ваша роль: {ROLE_LABEL[pvz.myRole]}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>Ждут выдачи · {pvz.waitingOrders.length}</p>
        {pvz.waitingOrders.length === 0 && <Empty title="Никто не ждёт выдачи" Icon={PackageCheck} />}
        {pvz.waitingOrders.map((o) => (
          <div key={o.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <span className="truncate text-[11px]" style={{ color: C.t1 }}>{o.title}</span>
            {o.pickupUntil && <span className="shrink-0 text-[10px]" style={{ color: C.t3 }}>до {fmtTime(o.pickupUntil)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Приёмка: открыть поставку по QR, сканировать заказы ──────────── */

const ReceivingTab = ({ pvzId, myRole }: { pvzId: string; myRole: PvzRole }) => {
  const isManager = ROLE_RANK[myRole] >= ROLE_RANK.manager;
  const [pending, setPending] = useState<PvzShipment[]>([]);
  const [open, setOpen] = useState<PvzShipmentDetail | null>(null);
  const [qrInput, setQrInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [manualOrderId, setManualOrderId] = useState('');
  const [unmatched, setUnmatched] = useState<PvzUnmatchedScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);

  const loadPending = useCallback(async () => {
    const r = await apiPvzPendingShipments(pvzId);
    if (r.ok && r.data) setPending(r.data.shipments);
  }, [pvzId]);

  const loadUnmatched = useCallback(async () => {
    if (!isManager) return;
    const r = await apiPvzUnmatched(pvzId);
    if (r.ok && r.data) setUnmatched(r.data.entries.filter((e) => !e.resolved));
  }, [pvzId, isManager]);

  useEffect(() => { void loadPending(); void loadUnmatched(); }, [loadPending, loadUnmatched]);

  const openByQr = async () => {
    if (!qrInput.trim()) return;
    setBusy(true); setMsg(null);
    const r = await apiPvzOpenShipmentByQr(pvzId, qrInput.trim());
    setBusy(false);
    if (!r.ok || !r.data) { setMsg({ kind: 'error', text: r.reason ?? 'QR поставки не распознан' }); return; }
    setOpen(r.data.shipment); setQrInput('');
  };

  const scanOrder = async () => {
    if (!open || !scanInput.trim()) return;
    setBusy(true); setMsg(null);
    const r = await apiPvzScanOrder(open.id, pvzId, scanInput.trim());
    setBusy(false); setScanInput('');
    if (!r.ok) {
      setMsg({ kind: 'error', text: r.error === 'already_received' ? 'Этот заказ уже принят'
        : r.error === 'not_in_shipment' ? 'Этот заказ не в этой поставке'
          : r.error === 'order_closed' ? 'Заказ уже закрыт'
            : 'QR не распознан или заказ не тот — записано на разбор' });
      void loadUnmatched();
      return;
    }
    setMsg({ kind: 'info', text: `Принят: ${r.data?.title ?? r.data?.orderId}` });
    const d = await apiPvzShipmentDetailSafe(open.id);
    if (d) setOpen(d);
  };

  const manualReceive = async () => {
    if (!open || !manualOrderId.trim()) return;
    setBusy(true); setMsg(null);
    const r = await apiPvzManualReceive(open.id, pvzId, manualOrderId.trim());
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'error', text: r.reason ?? 'Не получилось принять вручную' }); return; }
    setManualOrderId('');
    const d = await apiPvzShipmentDetailSafe(open.id);
    if (d) setOpen(d);
  };

  const confirm = async (partial: boolean) => {
    if (!open) return;
    setBusy(true); setMsg(null);
    const r = await apiPvzConfirmReceipt(open.id, pvzId, partial);
    setBusy(false);
    if (!r.ok) { setMsg({ kind: 'error', text: r.error === 'incomplete' ? 'Приняты не все заказы — подтвердите как частичную' : r.reason ?? 'Не получилось закрыть приёмку' }); return; }
    setMsg({ kind: 'info', text: `Приёмка закрыта: ${r.data?.received} принято, ${r.data?.missing} не найдено` });
    setOpen(null); void loadPending();
  };

  const resolve = async (id: string) => {
    const r = await apiPvzResolveUnmatched(pvzId, id);
    if (r.ok) void loadUnmatched();
  };

  if (open) {
    const expected = open.items.filter((i) => i.status === 'expected');
    return (
      <div className="h-full space-y-3 overflow-y-auto p-4">
        <button type="button" onClick={() => setOpen(null)} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.acc }}>
          <ArrowLeft size={13} /> К списку поставок
        </button>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Приёмка · {open.receivedCount}/{open.expectedCount}</p>

        {msg && <Alert kind={msg.kind} text={msg.text} />}

        <Field label="Отсканировать QR заказа">
          <div className="flex gap-2">
            <input value={scanInput} onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void scanOrder(); }}
              autoFocus placeholder="skypvz:order:…" className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
            <button type="button" disabled={busy} onClick={scanOrder}
              className="rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Принять</button>
          </div>
        </Field>

        <div className="space-y-1.5">
          {open.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <span className="truncate text-[11px]" style={{ color: C.t1 }}>{it.title}</span>
              <span className="shrink-0 text-[10px] font-bold" style={{
                color: it.status === 'received' ? C.green : it.status === 'missing' ? C.red : C.t3,
              }}>{it.status === 'received' ? 'принят' : it.status === 'missing' ? 'не найден' : 'ожидание'}</span>
            </div>
          ))}
        </div>

        {isManager && expected.length > 0 && (
          <Field label="Повреждённый QR — принять по номеру заказа (manager+)">
            <div className="flex gap-2">
              <input value={manualOrderId} onChange={(e) => setManualOrderId(e.target.value)}
                placeholder="mo-…" className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
              <button type="button" disabled={busy} onClick={manualReceive}
                className="rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1 }}>Принять</button>
            </div>
          </Field>
        )}

        <div className="flex gap-2">
          <button type="button" disabled={busy || expected.length === 0} onClick={() => confirm(true)}
            className="flex-1 rounded-xl py-2.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1 }}>
            Закрыть частично
          </button>
          <button type="button" disabled={busy || expected.length > 0} onClick={() => confirm(false)}
            className="flex-1 rounded-xl py-2.5 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
            Закрыть полностью
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <Field label="Открыть поставку по QR">
        <div className="flex gap-2">
          <input value={qrInput} onChange={(e) => setQrInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void openByQr(); }}
            placeholder="skypvz:shipment:…" className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <button type="button" disabled={busy} onClick={openByQr}
            className="rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Открыть</button>
        </div>
      </Field>
      {msg && <Alert kind={msg.kind} text={msg.text} />}

      <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>Ожидают приёмки · {pending.length}</p>
      {pending.length === 0 && <Empty title="Поставок в ожидании нет" Icon={PackageCheck} />}
      {pending.map((s) => (
        <button key={s.id} type="button"
          onClick={async () => { const d = await apiPvzShipmentDetailSafe(s.id); if (d) setOpen(d); }}
          className="flex w-full items-center justify-between rounded-xl p-3 text-left" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <span className="text-[11px]" style={{ color: C.t1 }}>{s.receivedCount}/{s.expectedCount} принято</span>
          <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTime(s.createdAt)}</span>
        </button>
      ))}

      {isManager && unmatched.length > 0 && (
        <>
          <p className="pt-2 text-[11px] font-semibold" style={{ color: C.red }}>Разбор несовпадений · {unmatched.length}</p>
          {unmatched.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px]" style={{ color: C.t1 }}>{u.reason}</p>
                {u.orderId && <p className="truncate text-[10px]" style={{ color: C.t3 }}>{u.orderId}</p>}
              </div>
              <ReportProblemButton subject="Несовпадение при сканировании в ПВЗ" label="В поддержку" context={{
                'Пункт выдачи': pvzId, 'Поставка': u.shipmentId, 'Заказ (если распознан)': u.orderId,
                'Причина отказа': u.reason, 'Когда': u.createdAt,
              }} />
              <button type="button" onClick={() => resolve(u.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l2, color: C.t2 }}>Разобрано</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

const apiPvzShipmentDetailSafe = async (shipmentId: string) => {
  const r = await apiPvzShipmentDetail(shipmentId);
  return r.ok && r.data ? r.data.shipment : null;
};

/* ── Ячейки ────────────────────────────────────────────────────────── */

const CellsTab = ({ pvzId }: { pvzId: string }) => {
  const [cells, setCells] = useState<PvzCell[]>([]);
  const [number, setNumber] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const r = await apiPvzCells(pvzId);
    if (r.ok && r.data) setCells(r.data.cells);
  }, [pvzId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!number.trim()) return;
    const r = await apiPvzAddCell(pvzId, number.trim(), 'M', false);
    if (r.ok) { setNumber(''); setAdding(false); void load(); }
  };

  const toggleBlock = async (cell: PvzCell) => {
    const status = cell.status === 'BLOCKED' ? 'FREE' : 'BLOCKED';
    const r = await apiPvzCellStatus(pvzId, cell.id, status, status === 'BLOCKED' ? 'Заблокирована вручную' : undefined);
    if (r.ok) void load();
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold" style={{ background: C.accBg, color: C.acc }}>
          <Plus size={13} /> Новая ячейка
        </button>
      ) : (
        <div className="flex gap-2">
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Номер, напр. A1"
            className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          <button type="button" onClick={add} className="rounded-xl px-3 py-2 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>Добавить</button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <button key={c.id} type="button" onClick={() => c.status !== 'OCCUPIED' && void toggleBlock(c)}
            className="rounded-xl p-2.5 text-center" style={{
              background: c.status === 'OCCUPIED' ? 'rgba(79,110,247,0.12)' : c.status === 'BLOCKED' ? 'rgba(239,68,68,0.1)' : C.l1,
              border: `1px solid ${c.status === 'OCCUPIED' ? 'rgba(79,110,247,0.3)' : c.status === 'BLOCKED' ? 'rgba(239,68,68,0.25)' : C.brd}`,
            }}>
            <p className="text-[13px] font-black" style={{ color: C.t1 }}>{c.number}</p>
            <p className="text-[9px] font-semibold" style={{ color: c.status === 'OCCUPIED' ? C.acc : c.status === 'BLOCKED' ? C.red : C.t3 }}>
              {c.status === 'OCCUPIED' ? 'занята' : c.status === 'BLOCKED' ? 'блок' : c.status === 'FREE' ? 'свободна' : c.status.toLowerCase()}
            </p>
          </button>
        ))}
      </div>
      {cells.length === 0 && <Empty title="Ячеек пока нет" Icon={Box} />}
    </div>
  );
};

/* ── Выдача заказа ─────────────────────────────────────────────────── */

const IssueTab = ({ pvzId }: { pvzId: string }) => {
  const [orderId, setOrderId] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);

  const issue = async () => {
    if (!orderId.trim() || !proof.trim()) return;
    setBusy(true); setMsg(null);
    const r = await apiPvzIssueOrder(pvzId, orderId.trim(), proof.trim());
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: 'error', text: r.error === 'bad_code' ? 'Код или QR получения неверны'
        : r.error === 'wrong_state' ? 'Заказ ещё не готов к выдаче или уже выдан' : r.reason ?? 'Не получилось выдать' });
      return;
    }
    setMsg({ kind: 'info', text: 'Заказ выдан' });
    setOrderId(''); setProof('');
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Покупатель называет код вслух или показывает QR получения — сервер сам сверяет его с заказом,
        от вас нужен только номер заказа и то, что сказал или показал покупатель.
      </p>
      <Field label="Номер заказа"><input value={orderId} onChange={(e) => setOrderId(e.target.value)}
        placeholder="mo-…" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
      <Field label="Код или QR получения">
        <input value={proof} onChange={(e) => setProof(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void issue(); }}
          placeholder="6-значный код или skypvz:pickup:…" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>
      {msg && <Alert kind={msg.kind} text={msg.text} />}
      <button type="button" disabled={busy} onClick={issue}
        className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
        Выдать заказ
      </button>
    </div>
  );
};

/* ── Сотрудники ────────────────────────────────────────────────────── */

const StaffTab = ({ pvzId, myRole }: { pvzId: string; myRole: PvzRole }) => {
  const [staff, setStaff] = useState<PvzStaffMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [role, setRole] = useState<PvzRole>('employee');
  const [error, setError] = useState<string | null>(null);
  const myRank = ROLE_RANK[myRole];

  const load = useCallback(async () => {
    const r = await apiPvzStaff(pvzId);
    if (r.ok && r.data) setStaff(r.data.staff);
  }, [pvzId]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!profileId.trim()) return;
    setError(null);
    const r = await apiPvzAddStaff(pvzId, profileId.trim(), role);
    if (!r.ok) { setError(r.reason ?? 'Не получилось назначить'); return; }
    setProfileId(''); setAdding(false); void load();
  };

  const revoke = async (id: string) => {
    const r = await apiPvzRevokeStaff(pvzId, id);
    if (!r.ok) { setError(r.error === 'last_owner' ? 'Нельзя снять последнего владельца точки' : r.reason ?? 'Не получилось'); return; }
    void load();
  };

  const assignableRoles = (Object.keys(ROLE_LABEL) as PvzRole[]).filter((r) =>
    myRank >= ROLE_RANK.owner ? true : ROLE_RANK[r] < ROLE_RANK.manager);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {myRank >= ROLE_RANK.manager && (
        !adding ? (
          <button type="button" onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold" style={{ background: C.accBg, color: C.acc }}>
            <Plus size={13} /> Назначить сотрудника
          </button>
        ) : (
          <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <Field label="Sky ID человека"><input value={profileId} onChange={(e) => setProfileId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
            <Field label="Роль">
              <div className="flex flex-wrap gap-1.5">
                {assignableRoles.map((r) => (
                  <button key={r} type="button" onClick={() => setRole(r)}
                    className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
                    style={{ background: role === r ? C.accBg : C.l2, color: role === r ? C.acc : C.t3 }}>{ROLE_LABEL[r]}</button>
                ))}
              </div>
            </Field>
            {error && <Alert text={error} />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-xl py-2 text-[11px] font-bold" style={{ background: C.l2, color: C.t2 }}>Отмена</button>
              <button type="button" onClick={add} className="flex-1 rounded-xl py-2 text-[11px] font-bold" style={{ background: C.acc, color: '#fff' }}>Назначить</button>
            </div>
          </div>
        )
      )}
      {error && !adding && <Alert text={error} />}

      <div className="space-y-1.5">
        {staff.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}`, opacity: s.status === 'revoked' ? 0.5 : 1 }}>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold" style={{ color: C.t1 }}>{s.name || s.username}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>{ROLE_LABEL[s.role]}{s.status === 'revoked' ? ' · снят' : ''}</p>
            </div>
            {s.status === 'active' && myRank >= ROLE_RANK.manager && (
              <button type="button" onClick={() => revoke(s.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: 'rgba(239,68,68,0.12)', color: C.red }}>Снять</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Комиссия владельцу ───────────────────────────────────────────── */

const CommissionsTab = () => {
  const [list, setList] = useState<PvzCommission[]>([]);
  useEffect(() => { void (async () => {
    const r = await apiPvzCommissionsOwner();
    if (r.ok && r.data) setList(r.data.commissions);
  })(); }, []);

  const dispute = async (id: string) => {
    const r = await apiPvzCommissionDispute(id);
    if (r.ok) setList((l) => l.map((c) => (c.id === id ? { ...c, status: 'disputed' } : c)));
  };

  const total = list.filter((c) => c.status === 'accrued').reduce((s, c) => s + c.amountKop, 0);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[10px] font-semibold" style={{ color: C.t3 }}>Ожидает оплаты от продавцов</p>
        <p className="text-lg font-black" style={{ color: C.t1 }}>{fmt(total / 100)}</p>
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>
        Продавец платит комиссию напрямую, минуя Sky — как и всю сделку. Здесь только начисления и то,
        что продавец заявил об оплате.
      </p>
      {list.length === 0 && <Empty title="Начислений пока нет" Icon={Wallet} />}
      {list.map((c) => (
        <div key={c.id} className="rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <span className="truncate text-[11px] font-semibold" style={{ color: C.t1 }}>{c.orderTitle}</span>
            <span className="shrink-0 text-[11px] font-bold" style={{ color: C.t1 }}>{fmt(c.amountKop / 100)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px]" style={{
              color: c.status === 'declared_paid' ? C.green : c.status === 'disputed' ? C.red : C.amber,
            }}>
              {c.status === 'accrued' ? 'Ожидает оплаты' : c.status === 'declared_paid' ? 'Продавец заявил об оплате' : c.status === 'disputed' ? 'Спорно' : 'Отменено'}
              {' '}· {c.percent}%
            </span>
            {c.status === 'accrued' && (
              <div className="flex items-center gap-2">
                <ReportProblemButton subject="Спорное начисление комиссии ПВЗ" label="В поддержку" context={{
                  'Начисление': c.id, 'Заказ': c.orderId, 'Точка': c.pvzTitle, 'Сумма': `${fmt(c.amountKop / 100)} (${c.percent}%)`,
                }} />
                <button type="button" onClick={() => dispute(c.id)} className="text-[10px] font-bold" style={{ color: C.red }}>Оспорить</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Видеообзор ────────────────────────────────────────────────────── */

const VideoTab = ({ pvzId }: { pvzId: string }) => {
  const [review, setReview] = useState<VideoReview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    const r = await apiPvzVideoReview(pvzId);
    setReview(r.ok ? (r.data?.review ?? null) : null);
    setLoaded(true);
  }, [pvzId]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    setBusy(true); setFailed('');
    const r = await apiUploadPvzVideo(pvzId, file);
    setBusy(false);
    if (!r.ok) {
      setFailed(r.error === 'too_large' ? 'Запись слишком большая — не больше 512 МБ.'
        : r.error === 'unsupported_video' ? 'Это не видеофайл. Подойдут MP4, MOV и WebM.'
          : 'Не удалось загрузить. Попробуйте ещё раз.');
      return;
    }
    await load();
  };

  if (!loaded) return <div className="p-4"><Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} /></div>;

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Видеообзор точки смотрит администрация Sky и, после одобрения, любой покупатель в каталоге.
      </p>
      {review && (
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold" style={{
              color: review.status === 'approved' ? C.green : review.status === 'rejected' ? C.red : C.amber,
            }}>
              {review.status === 'approved' ? 'Обзор одобрен' : review.status === 'rejected' ? 'Обзор отклонён' : 'Обзор на проверке'}
            </span>
          </div>
          {review.status === 'rejected' && review.rejectReason && (
            <p className="mt-1.5 text-[11px]" style={{ color: C.t2 }}>Причина: {review.rejectReason}</p>
          )}
          <video src={videoUrl(review.id)} controls preload="metadata" className="mt-2 w-full rounded-xl" style={{ maxHeight: 200, background: '#000' }} />
        </div>
      )}
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}
      {review?.status !== 'pending' && (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {review ? 'Снять и загрузить заново' : 'Загрузить видеообзор'}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      )}
    </div>
  );
};

/* ── Журнал ────────────────────────────────────────────────────────── */

const AuditTab = ({ pvzId }: { pvzId: string }) => {
  const [entries, setEntries] = useState<PvzAuditEntry[]>([]);
  useEffect(() => { void (async () => {
    const r = await apiPvzAudit(pvzId);
    if (r.ok && r.data) setEntries(r.data.entries);
  })(); }, [pvzId]);

  return (
    <div className="h-full space-y-1.5 overflow-y-auto p-4">
      {entries.length === 0 && <Empty title="Журнал пуст" Icon={ScrollText} />}
      {entries.map((e) => (
        <div key={e.id} className="rounded-xl p-2.5" style={{
          background: e.suspicious ? 'rgba(239,68,68,0.08)' : C.l1,
          border: `1px solid ${e.suspicious ? 'rgba(239,68,68,0.2)' : C.brd}`,
        }}>
          <div className="flex items-center gap-1.5">
            {e.suspicious && <ShieldAlert size={11} style={{ color: C.red }} />}
            <span className="text-[11px] font-semibold" style={{ color: C.t1 }}>{e.action}</span>
            <span className="ml-auto shrink-0 text-[10px]" style={{ color: C.t3 }}>{fmtTime(e.createdAt)}</span>
          </div>
          {e.targetId && <p className="mt-0.5 truncate text-[10px]" style={{ color: C.t3 }}>{e.targetType}: {e.targetId}</p>}
        </div>
      ))}
    </div>
  );
};

/* ── Настройки ─────────────────────────────────────────────────────── */

const SettingsTab = ({ pvz, myRole, onChanged }: { pvz: PvzOverview; myRole: PvzRole; onChanged: () => void }) => {
  const isOwner = ROLE_RANK[myRole] >= ROLE_RANK.owner;
  const isManager = ROLE_RANK[myRole] >= ROLE_RANK.manager;
  const [phone, setPhone] = useState(pvz.phone);
  const [workFrom, setWorkFrom] = useState(pvz.workFrom);
  const [workTo, setWorkTo] = useState(pvz.workTo);
  const [holdDays, setHoldDays] = useState(String(pvz.holdDays));
  const [paymentDetails, setPaymentDetails] = useState(pvz.ownerPaymentDetails ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await apiPvzUpdateSettings(pvz.id, { phone, workFrom, workTo, holdDays: Number(holdDays) || undefined });
    setBusy(false);
    if (!r.ok) { setMsg(r.reason ?? 'Не получилось сохранить'); return; }
    onChanged();
  };

  const savePayment = async () => {
    setPayBusy(true); setPayMsg(null);
    const r = await apiPvzUpdateSettings(pvz.id, { paymentDetails });
    setPayBusy(false);
    if (!r.ok) { setPayMsg(r.reason ?? 'Не получилось сохранить'); return; }
    onChanged();
  };

  const toggleClosed = async () => {
    const r = await apiPvzSetClosed(pvz.id, !pvz.staffClosed, reason);
    if (r.ok) onChanged();
  };

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {isManager && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>Временное закрытие</p>
          {!pvz.staffClosed && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (например, ремонт)"
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          )}
          <button type="button" onClick={toggleClosed}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-bold"
            style={{ background: pvz.staffClosed ? C.accBg : 'rgba(239,68,68,0.1)', color: pvz.staffClosed ? C.acc : C.red }}>
            {pvz.staffClosed ? <Unlock size={13} /> : <Lock size={13} />}
            {pvz.staffClosed ? 'Открыть точку' : 'Закрыть точку временно'}
          </button>
        </div>
      )}

      {isOwner ? (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>Часы работы и хранение</p>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Название, город и адрес меняет только администрация Sky — это карточка публичного каталога.
          </p>
          <div className="flex gap-2">
            <Field label="Открытие"><input value={workFrom} onChange={(e) => setWorkFrom(e.target.value)} placeholder="09:00"
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
            <Field label="Закрытие"><input value={workTo} onChange={(e) => setWorkTo(e.target.value)} placeholder="21:00"
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
          </div>
          <Field label="Срок хранения, дней"><input value={holdDays} onChange={(e) => setHoldDays(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
          <Field label="Телефон"><input value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} /></Field>
          {msg && <Alert text={msg} />}
          <button type="button" disabled={busy} onClick={save}
            className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Сохранить</button>
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: C.t3 }}>Часы работы и реквизиты меняет только владелец точки.</p>
      )}

      {isOwner && (
        <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>Реквизиты для оплаты комиссии</p>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Продавцы платят комиссию вам напрямую, минуя Sky — как и всю сделку с покупателем. Эти
            реквизиты видны только вам и продавцам с начислением по этой точке, каждому — вместе с его
            собственной комиссией.
          </p>
          <textarea value={paymentDetails} onChange={(e) => setPaymentDetails(e.target.value)}
            rows={3} maxLength={600}
            placeholder="Например: СБП +7 900 000-00-00 (Т-Банк), получатель Иван И."
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          {!pvz.hasOwnerPaymentDetails && (
            <Alert kind="info" text="Пока реквизиты не заданы, продавцы не узнают, куда переводить комиссию." />
          )}
          {payMsg && <Alert text={payMsg} />}
          <button type="button" disabled={payBusy} onClick={savePayment}
            className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Сохранить реквизиты</button>
        </div>
      )}
    </div>
  );
};

/* ── Корень кабинета ───────────────────────────────────────────────── */

const TABS: { key: PvzTab; label: string; Icon: typeof Store; minRole: PvzRole }[] = [
  { key: 'overview',    label: 'Обзор',       Icon: Store,        minRole: 'read_only' },
  { key: 'receiving',   label: 'Приёмка',     Icon: PackageCheck, minRole: 'employee' },
  { key: 'cells',       label: 'Ячейки',      Icon: Box,          minRole: 'employee' },
  { key: 'issue',       label: 'Выдача',      Icon: QrCode,       minRole: 'employee' },
  { key: 'staff',       label: 'Сотрудники',  Icon: Users,        minRole: 'read_only' },
  { key: 'commissions', label: 'Комиссии',    Icon: Wallet,       minRole: 'owner' },
  { key: 'video',       label: 'Видеообзор',  Icon: Video,        minRole: 'manager' },
  { key: 'audit',       label: 'Журнал',      Icon: ScrollText,   minRole: 'manager' },
  { key: 'violations',  label: 'Нарушения и штрафы', Icon: ShieldAlert, minRole: 'owner' },
  { key: 'settings',    label: 'Настройки',   Icon: Settings,     minRole: 'employee' },
];

export const PvzCabinet = () => {
  const { myPvz, loadMyPvz } = useMarketStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [pvz, setPvz] = useState<PvzOverview | null>(null);
  const [tab, setTab] = useState<PvzTab>('overview');
  const [creating, setCreating] = useState(false);

  useEffect(() => { void loadMyPvz(); }, []);
  useEffect(() => {
    if (!selected && myPvz.length > 0) setSelected(myPvz[0].pvzId);
  }, [myPvz, selected]);

  const loadOverview = useCallback(async () => {
    if (!selected) return;
    const r = await apiPvzOverview(selected);
    if (r.ok && r.data) setPvz(r.data.pvz);
  }, [selected]);
  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const refreshAll = () => { void loadOverview(); void loadMyPvz(); };

  if (creating || (myPvz.length === 0 && !pvz)) {
    return <CreatePvz onCreated={() => { setCreating(false); void loadMyPvz(); }} />;
  }
  if (!selected || !pvz) return <p className="p-4 text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>;

  const rank = ROLE_RANK[pvz.myRole];
  const visibleTabs = TABS.filter((t) => rank >= ROLE_RANK[t.minRole]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2.5" style={{ borderBottom: `1px solid ${C.brd}` }}>
        {myPvz.length > 1 ? (
          <select value={selected} onChange={(e) => setSelected(e.target.value)}
            className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold" style={inputStyle}>
            {myPvz.map((m) => <option key={m.pvzId} value={m.pvzId}>{m.title}</option>)}
          </select>
        ) : (
          <p className="flex-1 truncate text-[12px] font-bold" style={{ color: C.t1 }}>{pvz.title}</p>
        )}
        {pvz.ownerStatus === 'pending_activation' && (
          <AlertTriangle size={14} style={{ color: C.amber }} />
        )}
        {pvz.ownerStatus === 'active' && <CheckCircle2 size={14} style={{ color: C.green }} />}
        <button type="button" onClick={() => setCreating(true)}
          className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2, color: C.t3 }}>
          <Plus size={13} />
        </button>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto px-4 py-2" style={{ borderBottom: `1px solid ${C.brd}`, scrollbarWidth: 'none' }}>
        {visibleTabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{ background: tab === t.key ? C.accBg : 'transparent', color: tab === t.key ? C.acc : C.t3 }}>
            <t.Icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'overview' && <OverviewTab pvz={pvz} onChanged={refreshAll} />}
        {tab === 'receiving' && <ReceivingTab pvzId={pvz.id} myRole={pvz.myRole} />}
        {tab === 'cells' && <CellsTab pvzId={pvz.id} />}
        {tab === 'issue' && <IssueTab pvzId={pvz.id} />}
        {tab === 'staff' && <StaffTab pvzId={pvz.id} myRole={pvz.myRole} />}
        {tab === 'commissions' && <CommissionsTab />}
        {tab === 'video' && <VideoTab pvzId={pvz.id} />}
        {tab === 'audit' && <AuditTab pvzId={pvz.id} />}
        {tab === 'violations' && <PvzViolationsTab pvzId={pvz.id} />}
        {tab === 'settings' && <SettingsTab pvz={pvz} myRole={pvz.myRole} onChanged={refreshAll} />}
      </div>
    </div>
  );
};
