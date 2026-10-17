/**
 * Вкладка «Модули»: закрыть любой раздел или сервис Sky с указанием причины. Людям вместо модуля показывается баннер
 * «Сервис временно недоступен…». Сервер — server/modclosure.mjs, право `modules`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, Unlock } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };

interface Mod { key: string; label: string; group: string; closed: boolean; reason: string; showReason: boolean; closedAt: string | null }
const ERR: Record<string, string> = { not_allowed: 'Недостаточно прав.', reason_required: 'Укажите причину (от 3 знаков).', unknown_module: 'Неизвестный модуль.' };
const fmtDt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const Row = ({ m, onChanged }: { m: Mod; onChanged: () => void }) => {
  const [edit, setEdit] = useState(false);
  const [reason, setReason] = useState(m.reason);
  const [show, setShow] = useState(m.showReason);
  const [busy, setBusy] = useState(false);
  const send = async (closed: boolean) => {
    if (closed && reason.trim().length < 3) { flash(ERR.reason_required); return; }
    setBusy(true);
    const r = await apiCall(`/api/admin/modules/${m.key}`, { method: 'PUT', body: JSON.stringify({ closed, reason, showReason: show }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось'); return; }
    flash(closed ? `Закрыто: ${m.label}` : `Открыто: ${m.label}`); setEdit(false); onChanged();
  };
  return (
    <div className="rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${m.closed ? C.red : C.brd}` }} data-module-row={m.key}>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-semibold" style={{ color: C.t1 }}>{m.label}</p>
        {m.closed && <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(239,68,68,.15)', color: C.red }}>Закрыт{m.closedAt ? ` · ${fmtDt(m.closedAt)}` : ''}</span>}
        {m.closed
          ? <button type="button" disabled={busy} onClick={() => void send(false)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}><Unlock size={12} /> Открыть</button>
          : <button type="button" onClick={() => setEdit((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}><Lock size={12} /> Закрыть</button>}
      </div>
      {m.closed && <p className="mt-1.5 text-[11px]" style={{ color: C.t3 }}>Причина: {m.reason}{m.showReason ? ' · людям показывается' : ' · людям не показывается'}</p>}
      {edit && !m.closed && (
        <div className="mt-2 space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Причина закрытия (обязательно)" aria-label={`Причина закрытия ${m.label}`} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
          <label className="flex items-center gap-2 text-[11px]" style={{ color: C.t2 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Показывать причину людям под сообщением</label>
          <button type="button" disabled={busy} onClick={() => void send(true)} className="w-full rounded-xl py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Закрыть для всех</button>
        </div>
      )}
    </div>
  );
};

const AllBar = ({ anyOpen, onChanged }: { anyOpen: boolean; onChanged: () => void }) => {
  const [edit, setEdit] = useState(false);
  const [reason, setReason] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async (closed: boolean) => {
    if (closed && reason.trim().length < 3) { flash(ERR.reason_required); return; }
    setBusy(true);
    const r = await apiCall('/api/admin/modules', { method: 'PUT', body: JSON.stringify({ closed, reason, showReason: show }) });
    setBusy(false);
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось'); return; }
    flash(closed ? 'Все модули закрыты' : 'Все модули открыты'); setEdit(false); setReason(''); onChanged();
  };
  return (
    <div className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.red}` }} data-modules-all>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-bold" style={{ color: C.t1 }}>Все модули сразу</p>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm('Открыть все модули?')) void send(false); }} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}><Unlock size={12} /> Открыть все</button>
        {anyOpen && <button type="button" onClick={() => setEdit((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold" style={{ background: C.red, color: '#fff' }}><Lock size={12} /> Закрыть все</button>}
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: C.t3 }}>У людей закроются все разделы и сервисы; в «Профиле» останется только «Выйти из Sky ID». Администраторы заходят как обычно.</p>
      {edit && (
        <div className="mt-2 space-y-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Причина закрытия (обязательно)" aria-label="Причина закрытия всех модулей" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={field} />
          <label className="flex items-center gap-2 text-[11px]" style={{ color: C.t2 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Показывать причину людям</label>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm('Закрыть ВСЕ модули для людей?')) void send(true); }} className="w-full rounded-xl py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.red, color: '#fff' }}>Закрыть все для людей</button>
        </div>
      )}
    </div>
  );
};

export const ModulesTab = () => {
  const [list, setList] = useState<Mod[] | null>(null);
  const load = useCallback(async () => {
    const r = await apiCall<{ modules: Mod[] }>('/api/admin/modules');
    if (r.ok && r.data) setList(r.data.modules); else flash(ERR[r.error ?? ''] ?? 'Не удалось загрузить список');
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!list) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;
  const groups = [...new Set(list.map((m) => m.group))];
  return (
    <div className="space-y-4">
      <AllBar anyOpen={list.some((m) => !m.closed)} onChanged={() => void load()} />
      <p className="text-[11px]" style={{ color: C.t3 }}>
        Закрытый модуль у людей заменяется баннером «Сервис временно недоступен, мы уже работаем над восстановлением доступа». Это закрытие интерфейса:
        сами запросы к серверу оно не блокирует, а администраторы заходят в закрытый модуль как обычно (с красной меткой «Закрыт для людей»). Изменение доходит до людей в течение минуты.
      </p>
      {groups.map((g) => (
        <div key={g} className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.t3 }}>{g}</p>
          {list.filter((m) => m.group === g).map((m) => <Row key={m.key + String(m.closed)} m={m} onChanged={() => void load()} />)}
        </div>
      ))}
    </div>
  );
};
