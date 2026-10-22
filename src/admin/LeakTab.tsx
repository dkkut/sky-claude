/**
 * Вкладка «Утечки»: журнал сигналов обнаружения (массовая выгрузка, секрет/приманка, действия админов, изменение кода, сканирование).
 * Сервер — server/leakdetect.mjs, /api/admin/leaks (право security). Пометка «ложная тревога» не отменяет действий защиты — их отменяют во вкладке «Самозащита».
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', amber: 'var(--amber)' };
type Ev = { id: string; kind: string; severity: string; subject: string; ip: string; detail: Record<string, unknown>; status: string; incidentId: string | null; at: string };
const KIND: Record<string, string> = { mass_export: 'Массовая выгрузка', canary: 'Сработала приманка', secret_in_request: 'Секрет в запросе', admin_anomaly: 'Действия администратора', integrity: 'Изменён код/конфигурация', guard: 'Сторож хоста', probing: 'Сканирование' };
const SEV: Record<string, string> = { low: 'низкая', medium: 'средняя', high: 'высокая', critical: 'критичная' };
const ST: Record<string, string> = { open: 'новое', acknowledged: 'принято', false_positive: 'ложная тревога' };
const dt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const sevColor = (s: string) => (s === 'critical' ? C.red : s === 'high' ? C.amber : C.t2);

export const LeakTab = () => {
  const [rows, setRows] = useState<Ev[] | null>(null); const [failed, setFailed] = useState('');
  const [kind, setKind] = useState(''); const [status, setStatus] = useState('');
  const load = useCallback(async () => {
    const q = new URLSearchParams(); if (kind) q.set('kind', kind); if (status) q.set('status', status);
    const r = await apiCall<{ events: Ev[] }>(`/api/admin/leaks?${q}`);
    if (r.ok) { setRows(r.data?.events ?? []); setFailed(''); } else setFailed(`Не удалось загрузить (${r.error ?? 'ошибка'})`);
  }, [kind, status]);
  useEffect(() => { void load(); }, [load]);
  const mark = async (id: string, st: string) => { const r = await apiCall(`/api/admin/leaks/${id}/mark`, { method: 'POST', body: JSON.stringify({ status: st }) }); flash(r.ok ? 'Отмечено' : 'Не получилось'); void load(); };
  const sel = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3 text-xs" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t2 }}>
        <Search size={13} className="mr-1 inline" />Сигналы собираются автоматически: объём данных и частота запросов, секреты и приманки в запросах, всплески действий администраторов, изменения файлов, сканирование.
        Содержимого сообщений и ответов в журнале нет — только метаданные. Одинаковые сигналы за 10 минут склеиваются в один (счётчик <b>count</b>).
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl px-3 py-1.5 text-xs" style={sel}><option value="">Все виды</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl px-3 py-1.5 text-xs" style={sel}><option value="">Любой статус</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="button" onClick={() => void load()} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>Обновить</button>
      </div>
      {!rows ? <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} /> : rows.length === 0 ? <p className="text-sm" style={{ color: C.t3 }}>Сигналов нет.</p> : (
        <ul className="space-y-2">{rows.map((e) => (
          <li key={e.id} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><b style={{ color: sevColor(e.severity) }}>{KIND[e.kind] ?? e.kind}</b>
              <span className="text-xs" style={{ color: C.t3 }}>{SEV[e.severity] ?? e.severity} · {dt(e.at)} · {ST[e.status] ?? e.status}</span></div>
            <div className="mt-1 text-xs" style={{ color: C.t2 }} translate="no">{e.subject}{e.ip ? ` · ${e.ip}` : ''}</div>
            <pre className="mt-1 overflow-x-auto text-[11px]" style={{ color: C.t3 }} translate="no">{JSON.stringify(e.detail)}</pre>
            <div className="mt-2 flex gap-2">
              {e.status !== 'acknowledged' && <button type="button" onClick={() => void mark(e.id, 'acknowledged')} className="rounded-lg px-2 py-1 text-[11px] font-bold" style={{ background: C.l2, color: C.t1 }}>Принято</button>}
              {e.status !== 'false_positive' && <button type="button" onClick={() => void mark(e.id, 'false_positive')} className="rounded-lg px-2 py-1 text-[11px] font-bold" style={{ background: C.l2, color: C.t1 }}>Ложная тревога</button>}
            </div>
          </li>))}</ul>)}
    </div>
  );
};
