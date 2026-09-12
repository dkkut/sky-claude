/* ======================================================================
   SKY MARKET / LOGISTICS  —  Shipment Hub (Поставки / разметка)
   Раздел «Поставки» в личном кабинете продавца
====================================================================== */
import { useState, useMemo } from 'react';
import {
  Plus, PackageSearch, Search, Trash2, Pencil, Printer,
  History, ChevronRight, Warehouse as WhIcon, MapPin,
  Boxes, Scale, Ruler, X,
} from 'lucide-react';
import { C, fmtTs } from '../SkyMarket';
import { useMarketStore } from '../store';
import { useWarehouseStore } from './warehouseStore';
import {
  useShipmentStore, SHIPMENT_STATUS_CFG, SHIPMENT_STATUS_FLOW, type CreateShipmentInput,
} from './shipmentStore';
import { SlidePanel, EmptyState, ConfirmModal } from './shared';
import type { Shipment, ShipmentStatus } from './types';
import { qrDataUri } from '@/shared/qr';

/* ── QR (рисуется на устройстве, как и для пропусков) ────────────── */
const qrUrlFor = (shipment: Shipment) => qrDataUri(
  JSON.stringify({
    type: 'sky-shipment', number: shipment.number, code: shipment.code, id: shipment.id,
  }),
  { size: 220, background: '#ffffff', color: '#000000', quietZone: 1 },
);

/* ── HTML-разметка самой наклейки (переиспользуется и в превью, и в печати) ── */
const buildLabelHtml = (s: Shipment, qrUrl: string) => `
  <div style="width:340px;padding:14px;background:#fff;color:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,sans-serif;border:2px solid #0a0a0a;border-radius:6px;box-sizing:border-box;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0a0a0a;padding-bottom:8px;margin-bottom:8px;">
      <div>
        <div style="font-size:9px;letter-spacing:0.08em;font-weight:700;color:#555;">ПОСТАВКА</div>
        <div style="font-size:16px;font-weight:800;font-family:monospace;">${s.number}</div>
      </div>
      <img src="${qrUrl}" width="72" height="72" style="display:block;"/>
    </div>
    <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${escapeHtml(s.name)}</div>
    <table style="width:100%;font-size:11px;border-collapse:collapse;">
      <tr><td style="color:#555;padding:2px 0;width:40%;">Отправитель</td><td style="font-weight:600;">${escapeHtml(s.senderName)}</td></tr>
      ${s.senderAddress ? `<tr><td style="color:#555;padding:2px 0;">Адрес отпр.</td><td>${escapeHtml(s.senderAddress)}</td></tr>` : ''}
      <tr><td style="color:#555;padding:2px 0;">Получатель</td><td style="font-weight:600;">${escapeHtml(s.recipientName)}</td></tr>
      ${s.recipientAddress ? `<tr><td style="color:#555;padding:2px 0;">Адрес получ.</td><td>${escapeHtml(s.recipientAddress)}</td></tr>` : ''}
      <tr><td style="color:#555;padding:2px 0;">Сортировочный центр</td><td style="font-weight:600;">${escapeHtml(s.sortingCenterName || '—')}</td></tr>
      <tr><td style="color:#555;padding:2px 0;">Мест</td><td>${s.placesCount}</td></tr>
      ${s.weightKg != null ? `<tr><td style="color:#555;padding:2px 0;">Вес</td><td>${s.weightKg} кг</td></tr>` : ''}
      ${s.volumeM3 != null ? `<tr><td style="color:#555;padding:2px 0;">Объём</td><td>${s.volumeM3} м³</td></tr>` : ''}
      <tr><td style="color:#555;padding:2px 0;">Дата создания</td><td>${new Date(s.createdAt).toLocaleDateString('ru-RU')}</td></tr>
    </table>
    <div style="margin-top:8px;padding-top:6px;border-top:1px dashed #999;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:9px;color:#555;">ID: ${s.id}</div>
      <div style="font-size:12px;font-weight:800;font-family:monospace;letter-spacing:0.1em;">${s.code}</div>
    </div>
  </div>`;

const escapeHtml = (str: string) => str.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] as string));

/* Печать / «Скачать» — открываем отдельное окно только с наклейкой и
   вызываем системный диалог печати (в нём есть «Сохранить как PDF») */
const printLabel = (s: Shipment): boolean => {
  const win = window.open('', '_blank', 'width=420,height=560');
  if (!win) return false;
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Наклейка ${s.number}</title>
    <style>
      @page { margin: 10mm; }
      body { margin:0; padding:16px; display:flex; align-items:center; justify-content:center; background:#f2f2f2; }
      @media print { body { background:#fff; padding:0; } }
    </style></head><body>${buildLabelHtml(s, qrUrlFor(s))}</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
};

/* ── Карточка поставки в списке ───────────────────────────────────── */
const ShipmentCard = ({ shipment, onOpen }: { shipment: Shipment; onOpen: () => void }) => {
  const cfg = SHIPMENT_STATUS_CFG[shipment.status];
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-2xl p-3 flex items-center gap-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${C.acc}18` }}>
        <PackageSearch size={18} style={{ color: C.acc }}/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{shipment.name}</p>
        <p className="text-[10px] font-mono truncate mt-0.5" style={{ color: C.t3 }}>{shipment.number}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
          <span className="text-[10px]" style={{ color: C.t3 }}>{shipment.placesCount} мест</span>
          {shipment.sortingCenterName && <span className="text-[10px] truncate" style={{ color: C.t3 }}>· {shipment.sortingCenterName}</span>}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: C.t3 }} className="shrink-0"/>
    </button>
  );
};

/* ── Форма создания / редактирования ──────────────────────────────── */
const ShipmentForm = ({ editing, onClose, onDone }: {
  editing?: Shipment; onClose: () => void; onDone: (id: string) => void;
}) => {
  const { createShipment, updateShipment } = useShipmentStore();
  const { myWarehouses } = useWarehouseStore();
  const { mySeller } = useMarketStore();
  const seller = mySeller();
  const warehouses = myWarehouses();
  const sortingCenters = warehouses.filter(w => w.role === 'sorting_center');
  const centerOptions = sortingCenters.length > 0 ? sortingCenters : warehouses;

  const [name, setName]                       = useState(editing?.name ?? '');
  const [senderName, setSenderName]           = useState(editing?.senderName ?? seller?.shopName ?? '');
  const [senderAddress, setSenderAddress]     = useState(editing?.senderAddress ?? '');
  const [recipientName, setRecipientName]     = useState(editing?.recipientName ?? '');
  const [recipientAddress, setRecipientAddress] = useState(editing?.recipientAddress ?? '');
  const [placesCount, setPlacesCount]         = useState(editing?.placesCount ?? 1);
  const [weightKg, setWeightKg]               = useState(editing?.weightKg?.toString() ?? '');
  const [volumeM3, setVolumeM3]               = useState(editing?.volumeM3?.toString() ?? '');
  const [sortingCenterId, setSortingCenterId] = useState(
    editing ? (editing.sortingCenterId ?? '') : (centerOptions[0]?.id ?? ''),
  );

  const valid = name.trim() && senderName.trim() && recipientName.trim() && placesCount > 0;

  const submit = () => {
    if (!valid) return;
    const center = centerOptions.find(w => w.id === sortingCenterId);
    const input: CreateShipmentInput = {
      name: name.trim(), senderName: senderName.trim(), senderAddress: senderAddress.trim() || undefined,
      recipientName: recipientName.trim(), recipientAddress: recipientAddress.trim() || undefined,
      placesCount, weightKg: weightKg ? Number(weightKg) : undefined, volumeM3: volumeM3 ? Number(volumeM3) : undefined,
      sortingCenterId: center?.id ?? null, sortingCenterName: center?.name,
    };
    if (editing) { updateShipment(editing.id, input); onDone(editing.id); }
    else { onDone(createShipment(input)); }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>{label}</p>{children}</div>
  );
  const inputCls = "w-full rounded-xl px-3 py-2.5 text-sm outline-none";
  const inputStyle = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

  return (
    <div className="p-4 space-y-4 pb-8">
      <Field label="НАЗВАНИЕ ПОСТАВКИ">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Поставка электроники — партия 12"
          className={inputCls} style={inputStyle}/>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="ОТПРАВИТЕЛЬ">
          <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Название магазина"
            className={inputCls} style={inputStyle}/>
        </Field>
        <Field label="ПОЛУЧАТЕЛЬ">
          <input value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Кому"
            className={inputCls} style={inputStyle}/>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="АДРЕС ОТПРАВИТЕЛЯ">
          <input value={senderAddress} onChange={e => setSenderAddress(e.target.value)} placeholder="Необязательно"
            className={inputCls} style={inputStyle}/>
        </Field>
        <Field label="АДРЕС ПОЛУЧАТЕЛЯ">
          <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} placeholder="Необязательно"
            className={inputCls} style={inputStyle}/>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="МЕСТ">
          <input type="number" min={1} value={placesCount} onChange={e => setPlacesCount(Math.max(1, Number(e.target.value)))}
            className={inputCls} style={inputStyle}/>
        </Field>
        <Field label="ВЕС, КГ">
          <input type="number" min={0} step="0.1" value={weightKg} onChange={e => setWeightKg(e.target.value)} placeholder="—"
            className={inputCls} style={inputStyle}/>
        </Field>
        <Field label="ОБЪЁМ, М³">
          <input type="number" min={0} step="0.01" value={volumeM3} onChange={e => setVolumeM3(e.target.value)} placeholder="—"
            className={inputCls} style={inputStyle}/>
        </Field>
      </div>

      <Field label="СОРТИРОВОЧНЫЙ ЦЕНТР">
        {centerOptions.length === 0 ? (
          <p className="text-xs rounded-xl px-3 py-2.5" style={{ background: C.l2, color: C.t3 }}>
            Нет доступных складов — добавьте склад в разделе «Мои склады», и он будет доступен здесь.
          </p>
        ) : (
          <select value={sortingCenterId} onChange={e => setSortingCenterId(e.target.value)}
            className={inputCls} style={inputStyle}>
            <option value="">— Без привязки —</option>
            {centerOptions.map(w => <option key={w.id} value={w.id}>{w.name}{w.role === 'sorting_center' ? ' (сорт. центр)' : ''}</option>)}
          </select>
        )}
      </Field>

      <button type="button" onClick={submit} disabled={!valid}
        className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
        {editing ? 'Сохранить изменения' : 'Создать поставку'}
      </button>
    </div>
  );
};

/* ── Предпросмотр наклейки ────────────────────────────────────────── */
const LabelPreview = ({ shipment }: { shipment: Shipment }) => {
  const qrUrl = qrUrlFor(shipment);
  const [blocked, setBlocked] = useState(false);
  const handlePrint = () => {
    const ok = printLabel(shipment);
    setBlocked(!ok);
  };
  return (
    <div className="rounded-2xl p-4 flex flex-col items-center gap-3" style={{ background: C.l2 }}>
      <div dangerouslySetInnerHTML={{ __html: buildLabelHtml(shipment, qrUrl) }}/>
      <div className="flex gap-2 w-full">
        <button type="button" onClick={handlePrint}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>
          <Printer size={13}/> Печать / PDF
        </button>
      </div>
      {blocked ? (
        <p className="text-[10px] text-center font-bold" style={{ color: C.red }}>
          Браузер заблокировал всплывающее окно печати. Разрешите всплывающие окна для этого сайта и нажмите ещё раз.
        </p>
      ) : (
        <p className="text-[10px] text-center" style={{ color: C.t3 }}>
          В диалоге печати можно выбрать «Сохранить как PDF», чтобы скачать наклейку файлом.
        </p>
      )}
    </div>
  );
};

/* ── Быстрая смена сортировочного центра ──────────────────────────── */
const SortingCenterPicker = ({ shipment }: { shipment: Shipment }) => {
  const { setSortingCenter } = useShipmentStore();
  const { myWarehouses } = useWarehouseStore();
  const warehouses = myWarehouses();
  const centers = warehouses.filter(w => w.role === 'sorting_center');
  const options = centers.length > 0 ? centers : warehouses;
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState(shipment.sortingCenterId ?? '');

  const apply = () => {
    const center = options.find(w => w.id === value);
    setSortingCenter(shipment.id, center?.id ?? null, center?.name);
    setPicking(false);
  };

  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: C.t1 }}><WhIcon size={13}/> Сортировочный центр</p>
        {!picking && (
          <button type="button" onClick={() => setPicking(true)} className="text-[10px] font-bold" style={{ color: C.acc }}>Изменить</button>
        )}
      </div>
      {picking ? (
        options.length === 0 ? (
          <p className="text-[11px]" style={{ color: C.t3 }}>Нет доступных складов</p>
        ) : (
          <div className="flex gap-2">
            <select value={value} onChange={e => setValue(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
              <option value="">— Без привязки —</option>
              {options.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button type="button" onClick={apply} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>ОК</button>
            <button type="button" onClick={() => setPicking(false)} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t3 }}><X size={13}/></button>
          </div>
        )
      ) : (
        <p className="text-sm font-semibold" style={{ color: C.t1 }}>{shipment.sortingCenterName || '— не выбран —'}</p>
      )}
    </div>
  );
};

/* ── Детальная карточка поставки ──────────────────────────────────── */
const ShipmentDetail = ({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) => {
  const { setStatus, deleteShipment, logsFor } = useShipmentStore();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const logs = logsFor(shipment.id);
  const centerLogs = logs.filter(l => l.type === 'sorting_center_changed');
  const cfg = SHIPMENT_STATUS_CFG[shipment.status];

  if (editing) {
    return (
      <SlidePanel open onClose={() => setEditing(false)} title="Изменить поставку" onBack={() => setEditing(false)}>
        <ShipmentForm editing={shipment} onClose={() => setEditing(false)} onDone={() => setEditing(false)}/>
      </SlidePanel>
    );
  }

  return (
    <SlidePanel open onClose={onClose} title={shipment.number}>
      <div className="p-4 space-y-3">
        <LabelPreview shipment={shipment}/>

        <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>Статус</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SHIPMENT_STATUS_FLOW.map(st => (
              <button key={st} type="button" onClick={() => setStatus(shipment.id, st)}
                disabled={shipment.status === st}
                className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40"
                style={{ background: shipment.status === st ? `${SHIPMENT_STATUS_CFG[st].color}20` : C.l2, color: SHIPMENT_STATUS_CFG[st].color }}>
                {SHIPMENT_STATUS_CFG[st].label}
              </button>
            ))}
            <button type="button" onClick={() => setStatus(shipment.id, 'cancelled')}
              disabled={shipment.status === 'cancelled'}
              className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40"
              style={{ background: shipment.status === 'cancelled' ? `${C.red}20` : C.l2, color: C.red }}>
              Отменить
            </button>
          </div>
        </div>

        <SortingCenterPicker shipment={shipment}/>

        <div className="rounded-2xl p-3 space-y-1.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <Row icon={Boxes}  label="Мест" value={String(shipment.placesCount)}/>
          {shipment.weightKg != null && <Row icon={Scale} label="Вес" value={`${shipment.weightKg} кг`}/>}
          {shipment.volumeM3 != null && <Row icon={Ruler} label="Объём" value={`${shipment.volumeM3} м³`}/>}
          <Row icon={MapPin} label="Получатель" value={shipment.recipientAddress || shipment.recipientName}/>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>
            <Pencil size={13}/> Изменить
          </button>
          <button type="button" onClick={() => setShowHistory(v => !v)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>
            <History size={13}/> История
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="grid h-10 w-10 place-items-center rounded-xl shrink-0" style={{ background: C.l2 }}>
            <Trash2 size={14} style={{ color: C.red }}/>
          </button>
        </div>

        {showHistory && (
          <div className="rounded-2xl p-3 space-y-1.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            {logs.length === 0 ? (
              <p className="text-[11px]" style={{ color: C.t3 }}>Изменений пока нет</p>
            ) : logs.map(l => (
              <div key={l.id} className="text-[11px]">
                <span style={{ color: C.t2 }}>{l.text}</span>
                <span style={{ color: C.t3 }}> · {fmtTs(l.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {centerLogs.length > 0 && (
          <div className="rounded-2xl p-3 space-y-1.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t3 }}>История сортировочного центра</p>
            {centerLogs.map(l => (
              <div key={l.id} className="text-[11px]">
                <span style={{ color: C.t2 }}>{l.text}</span>
                <span style={{ color: C.t3 }}> · {fmtTs(l.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить поставку?">
        <p className="text-xs mb-3" style={{ color: C.t3 }}>Разметка и QR-код станут недействительны. Действие необратимо.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
          <button type="button" onClick={() => { deleteShipment(shipment.id); setConfirmDelete(false); onClose(); }} className="flex-1 rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.red }}>Удалить</button>
        </div>
      </ConfirmModal>
    </SlidePanel>
  );
};

const Row = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-center gap-2 text-[11px]">
    <Icon size={12} style={{ color: C.t3 }}/>
    <span style={{ color: C.t3 }}>{label}:</span>
    <span className="font-semibold truncate" style={{ color: C.t1 }}>{value}</span>
  </div>
);

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const ShipmentHub = () => {
  const { myShipments, findShipments } = useShipmentStore();
  const { myWarehouses } = useWarehouseStore();
  const warehouses = myWarehouses();
  const [query, setQuery] = useState('');
  const [centerFilter, setCenterFilter] = useState<string>('all');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const base = useMemo(() => query.trim() ? findShipments(query) : myShipments(), [query, myShipments, findShipments]);
  const shipments = useMemo(() => {
    if (centerFilter === 'all') return base;
    if (centerFilter === 'none') return base.filter(s => !s.sortingCenterId);
    return base.filter(s => s.sortingCenterId === centerFilter);
  }, [base, centerFilter]);
  const openShipment = shipments.find(s => s.id === openId) ?? myShipments().find(s => s.id === openId);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="px-4 py-3 space-y-2" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: C.t3 }}>{shipments.length} поставок(и)</p>
            <button type="button" onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.acc }}>
              <Plus size={13}/> Создать поставку
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.t3 }}/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по номеру, ID или коду"
              className="w-full rounded-xl pl-8 pr-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
          </div>
          {warehouses.length > 0 && (
            <select value={centerFilter} onChange={e => setCenterFilter(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
              <option value="all">Все сортировочные центры</option>
              <option value="none">Без привязки</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>

        <div className="p-4 space-y-2">
          {shipments.length === 0 ? (
            <EmptyState icon={PackageSearch} title={query || centerFilter !== 'all' ? 'Ничего не найдено' : 'Пока нет поставок'}
              sub={query || centerFilter !== 'all' ? 'Измените поиск или фильтр по сортировочному центру' : 'Создайте первую поставку и сформируйте наклейку для отправки'}/>
          ) : shipments.map(s => <ShipmentCard key={s.id} shipment={s} onOpen={() => setOpenId(s.id)}/>)}
        </div>
      </div>

      <SlidePanel open={creating} onClose={() => setCreating(false)} title="Новая поставка">
        <ShipmentForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpenId(id); }}/>
      </SlidePanel>

      {openShipment && <ShipmentDetail shipment={openShipment} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
