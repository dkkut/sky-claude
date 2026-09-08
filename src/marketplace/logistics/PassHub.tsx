/* ======================================================================
   SKY MARKET / LOGISTICS  —  Pass Hub
   Раздел «Пропуска и доступы» в личном кабинете продавца
====================================================================== */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, KeyRound, Ban, CheckCircle2, Trash2, Send,
  MessageSquare, Mail, LogIn, LogOut, ScanLine,
  ClipboardList,
} from 'lucide-react';
import { C, fmtTs } from '../SkyMarket';
import { useWarehouseStore } from './warehouseStore';
import { usePassStore, ACCESS_LEVELS } from './passStore';
import { SlidePanel, EmptyState, ConfirmModal } from './shared';
import type { AccessPass, AccessLevel, PassType, PassSendChannel } from './types';
import { qrDataUri } from '@/shared/qr';

const levelCfg = (level: AccessLevel) => ACCESS_LEVELS.find(l => l.key === level)!;

const isExpired = (p: AccessPass) => !!p.validUntil && new Date(p.validUntil).getTime() < Date.now();

/* ── Карточка пропуска ────────────────────────────────────────────── */
const PassCard = ({ pass, whName, onOpen }: { pass: AccessPass; whName: string; onOpen: () => void }) => {
  const cfg = levelCfg(pass.accessLevel);
  const expired = isExpired(pass);
  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-2xl p-3 flex items-center gap-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: `${cfg.color}18` }}>
        <KeyRound size={18} style={{ color: cfg.color }}/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{pass.holderName}</p>
        <p className="text-[10px] truncate mt-0.5" style={{ color: C.t3 }}>{whName}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
          <span className="text-[10px]" style={{ color: C.t3 }}>{pass.type === 'permanent' ? 'Постоянный' : 'Временный'}</span>
        </div>
      </div>
      <div className="shrink-0">
        {!pass.active ? (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(244,63,94,0.1)', color: C.red }}>Блокирован</span>
        ) : expired ? (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', color: C.t3 }}>Истёк</span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(0,220,90,0.1)', color: C.green }}>Активен</span>
        )}
      </div>
    </button>
  );
};

/* ── Форма создания пропуска ──────────────────────────────────────── */
const PassForm = ({ warehouseId, warehouses, onDone, onClose }: {
  warehouseId?: string; warehouses: { id: string; name: string }[]; onClose: () => void; onDone: (id: string) => void;
}) => {
  const { createPass } = usePassStore();
  const [whId, setWhId] = useState(warehouseId ?? warehouses[0]?.id ?? '');
  const [holderName, setHolderName] = useState('');
  const [holderContact, setHolderContact] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('guest');
  const [type, setType] = useState<PassType>('temporary');
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });

  const submit = () => {
    if (!whId || !holderName.trim()) return;
    const pass = createPass({
      warehouseId: whId, holderName, holderContact,
      accessLevel, type, validUntil: type === 'temporary' ? new Date(validUntil).toISOString() : null,
    });
    onDone(pass.id);
  };

  return (
    <div className="p-4 space-y-4 pb-8">
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>СКЛАД</p>
        <select value={whId} onChange={e => setWhId(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ИМЯ ПОСЕТИТЕЛЯ</p>
        <input value={holderName} onChange={e => setHolderName(e.target.value)} placeholder="Иван Иванов"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ТЕЛЕФОН ИЛИ EMAIL</p>
        <input value={holderContact} onChange={e => setHolderContact(e.target.value)} placeholder="+7 999 000-00-00 или email"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-2" style={{ color: C.t3 }}>УРОВЕНЬ ДОСТУПА</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {ACCESS_LEVELS.map(l => (
            <button key={l.key} type="button" onClick={() => setAccessLevel(l.key)}
              className="rounded-xl py-2 text-[10px] font-bold"
              style={{ background: accessLevel===l.key ? `${l.color}20` : C.l2, color: accessLevel===l.key ? l.color : C.t3, border: `1px solid ${accessLevel===l.key ? l.color : 'transparent'}` }}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-2" style={{ color: C.t3 }}>ТИП ПРОПУСКА</p>
        <div className="flex rounded-xl p-1" style={{ background: C.l2 }}>
          {(['temporary','permanent'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold" style={{ background: type===t ? C.l3 : 'transparent', color: type===t ? C.t1 : C.t3 }}>
              {t === 'temporary' ? 'Временный' : 'Постоянный'}
            </button>
          ))}
        </div>
        {type === 'temporary' && (
          <input type="datetime-local" value={validUntil} onChange={e => setValidUntil(e.target.value)}
            className="w-full mt-2 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        )}
      </div>

      <button type="button" onClick={submit} disabled={!whId || !holderName.trim()}
        className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
        Создать пропуск
      </button>
    </div>
  );
};

/* ── Отправка пропуска ────────────────────────────────────────────── */
const SendPassBlock = ({ pass }: { pass: AccessPass }) => {
  const { sendPass, sendLogsFor } = usePassStore();
  const [channel, setChannel] = useState<PassSendChannel>('sms');
  const [target, setTarget] = useState(pass.holderContact);
  const [sent, setSent] = useState(false);
  const logs = sendLogsFor(pass.id);

  const CHANNELS: { key: PassSendChannel; label: string; icon: any }[] = [
    { key:'sms', label:'SMS', icon:MessageSquare }, { key:'email', label:'Email', icon:Mail }, { key:'chat', label:'Чат', icon:Send },
  ];

  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-xs font-bold" style={{ color: C.t1 }}>Отправить пропуск</p>
      <div className="flex gap-1.5">
        {CHANNELS.map(c => (
          <button key={c.key} type="button" onClick={() => setChannel(c.key)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold"
            style={{ background: channel===c.key ? C.accBg : C.l2, color: channel===c.key ? C.acc : C.t3 }}>
            <c.icon size={12}/> {c.label}
          </button>
        ))}
      </div>
      <input value={target} onChange={e => setTarget(e.target.value)} placeholder={channel==='email' ? 'email@example.com' : channel==='sms' ? '+7 999 000-00-00' : 'Имя пользователя в Sky'}
        className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
      <button type="button" onClick={() => { sendPass(pass.id, channel, target); setSent(true); setTimeout(()=>setSent(false), 2000); }}
        disabled={!target.trim()}
        className="w-full rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
        {sent ? 'Отправлено ✓' : 'Отправить'}
      </button>
      {logs.length > 0 && (
        <div className="pt-1 space-y-1">
          {logs.slice(-3).reverse().map(l => (
            <p key={l.id} className="text-[10px]" style={{ color: C.t3 }}>Отправлено через {l.channel.toUpperCase()} · {l.target} · {fmtTs(l.sentAt)}</p>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Сканер QR (симуляция подтверждения входа) ───────────────────── */
const ScannerBlock = ({ onScanned }: { onScanned: (code: string) => { ok: boolean; reason?: string } }) => {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  const scan = () => {
    if (!code.trim()) return;
    const r = onScanned(code.trim());
    setResult(r);
  };

  return (
    <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: C.t1 }}><ScanLine size={13}/> QR-сканер на входе</p>
      <p className="text-[10px]" style={{ color: C.t3 }}>Введите код пропуска вручную или используйте камеру сканера на устройстве проходной</p>
      <div className="flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Код пропуска"
          className="flex-1 rounded-xl px-3 py-2 text-xs font-mono tracking-widest outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        <button type="button" onClick={scan} className="rounded-xl px-3 py-2 text-xs font-bold text-white shrink-0" style={{ background: C.acc }}>Скан</button>
      </div>
      {result && (
        <div className="rounded-xl p-2 flex items-center gap-2" style={{ background: result.ok ? 'rgba(0,220,90,0.08)' : 'rgba(244,63,94,0.08)' }}>
          {result.ok ? <CheckCircle2 size={14} style={{ color: C.green }}/> : <Ban size={14} style={{ color: C.red }}/>}
          <p className="text-[11px]" style={{ color: result.ok ? C.green : C.red }}>{result.ok ? 'Доступ подтверждён' : result.reason}</p>
        </div>
      )}
    </div>
  );
};

/* ── Детальная карточка пропуска ──────────────────────────────────── */
const PassDetail = ({ pass, whName, onClose }: { pass: AccessPass; whName: string; onClose: () => void }) => {
  const { blockPass, unblockPass, deletePass, visitsFor, scanPass } = usePassStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const visits = visitsFor(pass.id);
  const cfg = levelCfg(pass.accessLevel);
  const expired = isExpired(pass);

  // Код пропуска — это и есть секрет: кто его знает, тот проходит.
  // Поэтому QR рисуется здесь же, на устройстве, и наружу не уходит.
  const qrUrl = qrDataUri(
    JSON.stringify({ code: pass.code, warehouseId: pass.warehouseId, level: pass.accessLevel }),
    { size: 200, background: '#141420', color: '#ffffff', quietZone: 2 },
  );

  return (
    <SlidePanel open onClose={onClose} title={pass.holderName}>
      <div className="p-4 space-y-3">
        <div className="rounded-3xl overflow-hidden" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="px-5 pt-5 pb-3 text-center">
            <p className="text-base font-bold" style={{ color: C.t1 }}>{pass.holderName}</p>
            <p className="text-xs mt-1" style={{ color: C.t3 }}>{whName}</p>
            <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${cfg.color}18`, color: cfg.color }}>{cfg.label}</span>
          </div>
          <div className="flex justify-center px-5 pb-3">
            <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.brd}`, opacity: pass.active && !expired ? 1 : 0.35 }}>
              <img src={qrUrl} alt="QR" width={180} height={180} style={{ display:'block' }}/>
            </div>
          </div>
          <div className="px-5 pb-5 space-y-2">
            <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: C.accBg }}>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: C.t3 }}>Код пропуска</p>
              <p className="text-lg font-black font-mono tracking-widest" style={{ color: C.acc }}>{pass.code}</p>
            </div>
            {!pass.active && <p className="text-[10px] text-center font-bold" style={{ color: C.red }}>⛔ Пропуск заблокирован</p>}
            {expired && pass.active && <p className="text-[10px] text-center font-bold" style={{ color: C.amber }}>⚠ Срок действия истёк</p>}
            <p className="text-[10px] text-center" style={{ color: C.t3 }}>
              {pass.type === 'permanent' ? 'Постоянный пропуск' : `Действует до ${pass.validUntil ? fmtTs(pass.validUntil) : ''}`}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {pass.active ? (
            <button type="button" onClick={() => blockPass(pass.id)} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: 'rgba(244,63,94,0.1)', color: C.red }}>
              <Ban size={13}/> Заблокировать
            </button>
          ) : (
            <button type="button" onClick={() => unblockPass(pass.id)} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: 'rgba(0,220,90,0.1)', color: C.green }}>
              <CheckCircle2 size={13}/> Разблокировать
            </button>
          )}
          <button type="button" onClick={() => setConfirmDelete(true)} className="grid h-10 w-10 place-items-center rounded-xl shrink-0" style={{ background: C.l2 }}>
            <Trash2 size={14} style={{ color: C.red }}/>
          </button>
        </div>

        <SendPassBlock pass={pass}/>
        <ScannerBlock onScanned={(code) => scanPass(code)}/>

        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><ClipboardList size={13}/> Журнал посещений ({visits.length})</p>
          {visits.length === 0 ? (
            <p className="text-[11px]" style={{ color: C.t3 }}>Пока не было входов/выходов по этому пропуску</p>
          ) : (
            <div className="space-y-1.5">
              {visits.map(v => (
                <div key={v.id} className="flex items-center gap-2 text-[11px]">
                  {v.action === 'entry' ? <LogIn size={12} style={{ color: C.green }}/> : <LogOut size={12} style={{ color: C.amber }}/>}
                  <span style={{ color: C.t2 }}>{v.action === 'entry' ? 'Вход' : 'Выход'}</span>
                  <span style={{ color: C.t3 }}>· {new Date(v.at).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить пропуск?">
        <p className="text-xs mb-3" style={{ color: C.t3 }}>Пропуск будет удалён навсегда, доступ по нему станет невозможен.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
          <button type="button" onClick={() => { deletePass(pass.id); setConfirmDelete(false); onClose(); }} className="flex-1 rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.red }}>Удалить</button>
        </div>
      </ConfirmModal>
    </SlidePanel>
  );
};

/* ── Отчёт по посещаемости ────────────────────────────────────────── */
const AttendanceReport = ({ warehouseId, passes }: { warehouseId: string; passes: AccessPass[] }) => {
  const { visitsForWarehouse } = usePassStore();
  const visits = visitsForWarehouse(warehouseId);
  const byPass = useMemo(() => {
    const map = new Map<string, number>();
    visits.forEach(v => map.set(v.passId, (map.get(v.passId) ?? 0) + 1));
    return Array.from(map.entries()).map(([passId, count]) => ({
      passId, count, holder: passes.find(p => p.id === passId)?.holderName ?? '—',
    })).sort((a,b) => b.count - a.count);
  }, [visits, passes]);

  if (visits.length === 0) return <EmptyState icon={ClipboardList} title="Нет данных по посещаемости" sub="Журнал входов и выходов появится после первых сканирований"/>;

  return (
    <div className="p-4 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.t3 }}>Активность по пропускам</p>
      {byPass.map(b => (
        <div key={b.passId} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <span className="text-xs font-semibold" style={{ color: C.t1 }}>{b.holder}</span>
          <span className="text-xs font-bold" style={{ color: C.acc }}>{b.count} событ.</span>
        </div>
      ))}
      <p className="text-[10px] font-bold uppercase tracking-widest mt-3 mb-1" style={{ color: C.t3 }}>Последние события</p>
      {visits.slice(0, 15).map(v => {
        const holder = passes.find(p => p.id === v.passId)?.holderName ?? '—';
        return (
          <div key={v.id} className="flex items-center gap-2 text-[11px] px-1">
            {v.action === 'entry' ? <LogIn size={11} style={{ color: C.green }}/> : <LogOut size={11} style={{ color: C.amber }}/>}
            <span style={{ color: C.t2 }}>{holder}</span>
            <span style={{ color: C.t3 }}>· {new Date(v.at).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const PassHub = () => {
  const { myWarehouses } = useWarehouseStore();
  const { myPasses } = usePassStore();
  const warehouses = myWarehouses();
  const passes = myPasses();

  const [whFilter, setWhFilter] = useState<string>('all');
  const [view, setView] = useState<'passes' | 'report'>('passes');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = whFilter === 'all' ? passes : passes.filter(p => p.warehouseId === whFilter);
  const openPass = passes.find(p => p.id === openId);

  if (warehouses.length === 0) {
    return <div className="h-full"><EmptyState icon={KeyRound} title="Сначала добавьте склад" sub="Пропуска привязываются к конкретному складу — создайте склад в разделе «Мои склады»"/></div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="px-4 py-3 space-y-2" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <div className="flex rounded-xl p-1" style={{ background: C.l2 }}>
              {(['passes','report'] as const).map(v => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: view===v ? C.l3 : 'transparent', color: view===v ? C.t1 : C.t3 }}>
                  {v === 'passes' ? 'Пропуска' : 'Отчёты'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.acc }}>
              <Plus size={13}/> Новый
            </button>
          </div>
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            <option value="all">Все склады</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>

        {view === 'passes' ? (
          <div className="p-4 space-y-2">
            {filtered.length === 0 ? (
              <EmptyState icon={KeyRound} title="Пока нет пропусков" sub="Создайте временный или постоянный пропуск для сотрудника, курьера или гостя"/>
            ) : filtered.map(p => (
              <PassCard key={p.id} pass={p} whName={warehouses.find(w=>w.id===p.warehouseId)?.name ?? '—'} onOpen={() => setOpenId(p.id)}/>
            ))}
          </div>
        ) : (
          <AttendanceReport warehouseId={whFilter === 'all' ? (warehouses[0]?.id ?? '') : whFilter} passes={passes}/>
        )}
      </div>

      <SlidePanel open={creating} onClose={() => setCreating(false)} title="Новый пропуск">
        <PassForm warehouseId={whFilter !== 'all' ? whFilter : undefined} warehouses={warehouses}
          onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpenId(id); }}/>
      </SlidePanel>

      {openPass && <PassDetail pass={openPass} whName={warehouses.find(w=>w.id===openPass.warehouseId)?.name ?? '—'} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
