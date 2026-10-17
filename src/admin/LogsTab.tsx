/**
 * Админка → «Журналы»: единый журнал событий Sky (пользователи, администрация, серверы, приложения, безопасность).
 * Поиск и фильтры, выгрузка CSV/JSON, сроки хранения, временный DEBUG, проверка цепочки аудиторских записей.
 * В журнале нет паролей, токенов, кодов, реквизитов и текстов сообщений — сервер вырезает их до записи. Сервер: server/skylog.mjs, право `logs`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScrollText, Download, ShieldCheck, ShieldAlert } from 'lucide-react';
import { apiCall, apiText } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Ev { id: number; at: string; category: string; level: string; type: string; service?: string; actorId?: string; targetId?: string; result: string; reason?: string; device?: string; requestId?: string; detail: Record<string, unknown>; audit: boolean }
interface Summary { last24h: { byCategory: Record<string, { count: number; errors: number }>; byLevel: Record<string, number>; topProblems: { type: string; n: number }[] }; total: number; writer: { written: number; dropped: number; failedFlushes: number; buffered: number }; settings: { retentionDays: Record<string, number>; debugUntil: string | null; telemetry: boolean } }

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber, #f59e0b)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const CAT: Record<string, string> = { user: 'Пользователи', admin: 'Администрация', server: 'Сервер', client: 'Приложения', security: 'Безопасность' };
const LVL_COLOR: Record<string, string> = { DEBUG: C.t3, INFO: C.t2, WARN: C.amber, ERROR: C.red, CRITICAL: C.red };
const ERR: Record<string, string> = { audit_retention_min_90: 'Аудиторские журналы (администрация, безопасность) хранятся не меньше 90 дней.', bad_retention: 'Срок хранения — от 1 до 3650 дней.', bad_debug: 'DEBUG включается не больше чем на 24 часа.' };

export const LogsTab = () => {
  const [sum, setSum] = useState<Summary | null>(null);
  const [items, setItems] = useState<Ev[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string>();
  const [f, setF] = useState({ section: '', category: '', level: '', result: '', type: '', actor: '', q: '', from: '', to: '' });
  const [chain, setChain] = useState<{ ok: boolean; checked: number; why?: string; brokenAt?: number } | null>(null);
  const [ret, setRet] = useState<Record<string, string>>({});

  const query = useCallback((extra = '') => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, k === 'from' || k === 'to' ? new Date(v).toISOString() : v);
    return `${p.toString()}${extra}`;
  }, [f]);

  const load = useCallback(async () => {
    const r = await apiCall<{ items: Ev[]; next: number | null }>(`/api/admin/logs?limit=100&${query()}`);
    if (!r.ok || !r.data) { setErr(r.error === 'not_allowed' ? 'Недостаточно прав.' : 'Не удалось загрузить'); return; }
    setErr(undefined); setItems(r.data.items); setNext(r.data.next);
  }, [query]);
  const loadSummary = useCallback(async () => {
    const r = await apiCall<Summary>('/api/admin/logs/summary');
    if (r.ok && r.data) { setSum(r.data); setRet(Object.fromEntries(Object.entries(r.data.settings.retentionDays).map(([k, v]) => [k, String(v)]))); }
  }, []);
  useEffect(() => { void load(); void loadSummary(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.section]);

  const more = async () => {
    if (next === null) return;
    const r = await apiCall<{ items: Ev[]; next: number | null }>(`/api/admin/logs?limit=100&before=${next}&${query()}`);
    if (r.ok && r.data) { setItems((cur) => [...(cur ?? []), ...r.data!.items]); setNext(r.data.next); }
  };
  const download = async (format: 'csv' | 'json') => {
    const r = await apiText(`/api/admin/logs/export?format=${format}&${query()}`);
    if (!r.ok) { flash('Не удалось выгрузить'); return; }
    const blob = new Blob([r.text], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sky-logs.${format}`; a.click(); URL.revokeObjectURL(a.href);
  };
  const verify = async () => { const r = await apiCall<NonNullable<typeof chain>>('/api/admin/logs/verify', { method: 'POST', body: '{}' }); if (r.ok && r.data) setChain(r.data); };
  const saveSettings = async (body: Record<string, unknown>) => {
    const r = await apiCall('/api/admin/logs/settings', { method: 'PUT', body: JSON.stringify(body) });
    flash(r.ok ? 'Сохранено' : (ERR[r.error ?? ''] ?? 'Не удалось сохранить')); void loadSummary();
  };

  if (err) return <p className="text-sm" style={{ color: C.red }}>{err}</p>;
  if (!sum || !items) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;
  const debugOn = sum.settings.debugUntil && new Date(sum.settings.debugUntil) > new Date();
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}><ScrollText size={16} style={{ color: C.acc }} />Журналы</p>
      <p className="text-[12.5px]" style={{ color: C.t2 }}>Единый журнал: вход и выход, действия администрации, сбои серверов и приложений, события безопасности. Паролей, токенов, кодов, реквизитов и текстов сообщений здесь нет — они вырезаются до записи. Записи администрации и безопасности защищены цепочкой хешей.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.keys(CAT).map((c) => (
          <div key={c} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-lg font-bold tabular-nums" style={{ color: C.t1 }}>{sum.last24h.byCategory[c]?.count ?? 0}</p>
            <p className="text-[10px]" style={{ color: C.t3 }}>{CAT[c]} за 24 ч{sum.last24h.byCategory[c]?.errors ? ` · ошибок ${sum.last24h.byCategory[c].errors}` : ''}</p>
          </div>))}
      </div>
      {sum.writer.dropped > 0 && <p className="text-[12px]" style={{ color: C.red }}>{`Потеряно записей из-за перегрузки: ${sum.writer.dropped}`}</p>}
      {sum.last24h.topProblems.length > 0 && <p className="text-[12px]" style={{ color: C.t2 }}>Чаще всего за сутки (предупреждения и ошибки): {sum.last24h.topProblems.map((p) => `${p.type} ×${p.n}`).join(', ')}</p>}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Раздел журнала">
        {[['', 'Все события'], ['users', 'Действия пользователей'], ['admin', 'Действия администрации'], ['server', 'Сервер'], ['storage', 'Хранилище']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={f.section === k} onClick={() => setF({ ...f, section: k, category: '' })}
            className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: f.section === k ? C.acc : C.l2, color: f.section === k ? '#fff' : C.t2 }}>{label}</button>
        ))}
      </div>
      <p className="text-[11.5px]" style={{ color: C.t3 }}>{f.section === 'users' ? 'Каждое изменяющее действие людей в экосистеме: кто, куда обратился, чем кончилось. Содержимого (текстов, файлов, платёжных данных) в журнале нет.'
        : f.section === 'admin' ? 'Все действия администрации и владельца: решения, настройки, деньги, права. Записи защищены цепочкой хешей.'
          : f.section === 'server' ? 'События сервера: запуск и остановка, уборка, сбои, ошибки обработки запросов.'
            : f.section === 'storage' ? 'События хранилища: доступ, копии, ограничения, ключи, сбои.' : 'Выберите раздел или смотрите всё вместе.'}</p>

      <section className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm" style={field} aria-label="Категория"><option value="">Все категории</option>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm" style={field} aria-label="Уровень"><option value="">Все уровни</option>{['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'].map((l) => <option key={l}>{l}</option>)}</select>
          <select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm" style={field} aria-label="Результат"><option value="">Любой результат</option><option value="ok">Успех</option><option value="denied">Отказано</option><option value="error">Ошибка</option></select>
          <input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} placeholder="Тип события (начало)" className="rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Тип события" />
          <input value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} placeholder="Идентификатор человека" className="rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Идентификатор человека" />
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Текст в записи" className="rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Поиск по тексту" />
          <input type="datetime-local" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="С" />
          <input type="datetime-local" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="По" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Найти</button>
          <button type="button" onClick={() => void download('csv')} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}><Download size={13} />CSV</button>
          <button type="button" onClick={() => void download('json')} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}><Download size={13} />JSON</button>
        </div>
      </section>

      <ul className="space-y-1">
        {items.map((e) => (
          <li key={e.id} className="rounded-lg" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]">
              <span className="w-14 shrink-0 font-bold" style={{ color: LVL_COLOR[e.level] }}>{e.level}</span>
              <span className="w-28 shrink-0 tabular-nums" style={{ color: C.t3 }}>{new Date(e.at).toLocaleString()}</span>
              <span className="w-24 shrink-0 truncate" style={{ color: C.t3 }}>{CAT[e.category]}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: C.t1 }} translate="no">{e.type}{e.reason ? ` — ${e.reason}` : ''}</span>
              {e.result !== 'ok' && <span style={{ color: e.result === 'denied' ? C.amber : C.red }}>{e.result === 'denied' ? 'отказано' : 'ошибка'}</span>}
            </button>
            {open === e.id && <pre className="overflow-x-auto px-3 pb-3 text-[11px]" style={{ color: C.t2 }} translate="no">{JSON.stringify({ id: e.id, service: e.service, actor: e.actorId, target: e.targetId, device: e.device, request: e.requestId, audit: e.audit, detail: e.detail }, null, 2)}</pre>}
          </li>))}
        {!items.length && <li className="py-6 text-center text-[12.5px]" style={{ color: C.t3 }}>Записей по этому запросу нет</li>}
      </ul>
      {next !== null && <button type="button" onClick={() => void more()} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Показать ещё</button>}

      <section className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Целостность аудиторских записей</p>
        <button type="button" onClick={() => void verify()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Проверить цепочку</button>
        {chain && (chain.ok
          ? <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: C.green }}><ShieldCheck size={14} />{`Цепочка цела, проверено записей: ${chain.checked}`}</p>
          : <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: C.red }}><ShieldAlert size={14} />{`Нарушение на записи ${chain.brokenAt}: ${chain.why}`}</p>)}
        <p className="text-[11px]" style={{ color: C.t3 }}>Проверка обнаруживает правку или удаление записи «в середине». Она не защищает от человека с полным доступом к базе, который перепишет журнал целиком, — храните резервные копии отдельно.</p>
      </section>

      <section className="space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Хранение и режимы</p>
        <div className="grid gap-2 sm:grid-cols-5">
          {Object.keys(CAT).map((c) => (
            <label key={c} className="block text-[11px]" style={{ color: C.t3 }}>{CAT[c]}, дней
              <input inputMode="numeric" value={ret[c] ?? ''} onChange={(e) => setRet({ ...ret, [c]: e.target.value.replace(/\D/g, '') })} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={field} aria-label={`Срок хранения: ${CAT[c]}`} /></label>))}
        </div>
        <button type="button" onClick={() => void saveSettings({ retentionDays: Object.fromEntries(Object.entries(ret).filter(([, v]) => v).map(([k, v]) => [k, Number(v)])) })} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Сохранить сроки</button>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: C.t2 }}>
          <span>{debugOn ? `DEBUG включён до ${new Date(sum.settings.debugUntil!).toLocaleTimeString()}` : 'DEBUG выключен'}</span>
          {[15, 60, 240].map((m) => <button key={m} type="button" onClick={() => void saveSettings({ debugMinutes: m })} className="rounded-lg px-3 py-1 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>{`${m} мин`}</button>)}
          {debugOn && <button type="button" onClick={() => void saveSettings({ debugMinutes: 0 })} className="rounded-lg px-3 py-1 text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: C.red }}>Выключить</button>}
        </div>
        <label className="flex items-center gap-2 text-[12.5px]" style={{ color: C.t2 }}><input type="checkbox" checked={sum.settings.telemetry} onChange={(e) => void saveSettings({ telemetry: e.target.checked })} />Принимать ошибки из приложений (телеметрия)</label>
      </section>
    </div>
  );
};
