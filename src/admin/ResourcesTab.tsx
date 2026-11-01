/**
 * Sky Admin → Система → «Оптимизация ресурсов». Сервер: server/resourceopt.mjs (замеры раз в 15 с, режимы с гистерезисом), право `analytics`.
 * Настройки меняет только владелец, с подтверждением личности; каждое изменение пишется в журнал администрации.
 * Показываются только настоящие измерения: чего измерить нельзя — того нет (контейнеры других сервисов видны только на сервере через docker stats).
 */
import { visibleTick } from '@/shared/visibleTick';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, Gauge } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/resources';
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Менять настройки может только владелец.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.',
  step_up_exhausted: 'Слишком много неверных кодов — запросите новый.', bad_field: 'Проверьте значение поля.', too_many_requests: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string, f?: string) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (f ? ` Поле: ${f}.` : '');
const MODE_COLOR: Record<string, string> = { normal: C.green, economy: C.amber, high: C.red, critical: C.red };
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} ГБ` : `${Math.round(b / 1048576)} МБ`);
const KIND: Record<string, string> = { mode: 'Режим', warning: 'Предупреждение', action: 'Действие', settings: 'Настройки', deferred: 'Отложено' };

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>
);
const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="rounded-xl px-3 py-2" style={{ background: C.l2 }}><p className="text-[11px]" style={{ color: C.t3 }}>{label}</p><p className="text-sm font-bold" style={{ color: C.t1 }}>{value}</p>{sub && <p className="text-[10.5px]" style={{ color: C.t3 }}>{sub}</p>}</div>
);
const Spark = ({ data, color, max }: { data: number[]; color: string; max?: number }) => {
  if (data.length < 2) return <p className="text-[11px]" style={{ color: C.t3 }}>Мало замеров.</p>;
  const m = Math.max(1, max ?? Math.max(...data)); const w = 220; const h = 36;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - Math.min(1, v / m) * (h - 2) - 1}`).join(' ');
  return <svg width={w} height={h} role="img" aria-label="График за последний час"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" /></svg>;
};

export const ResourcesTab = () => {
  const [d, setD] = useState<D | null>(null);
  const [f, setF] = useState<D | null>(null);
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState(false);
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');
  const [disk, setDisk] = useState<D | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<D>(A);
    if (r.ok) { setD(r.data ?? {}); setF((cur) => cur ?? { ...(r.data?.settings ?? {}) }); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(visibleTick(() => load()), 15000); return () => window.clearInterval(t); }, [load]);

  const begin = async () => {
    const r = await apiCall<D>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'app')); setCode(''); setAsk(true);
  };
  const save = async () => {
    const r = await apiCall<D>(`${A}/settings`, { method: 'PUT', body: JSON.stringify({ settings: f, stepUpCode: code }) });
    if (!r.ok) { flash(errText(r.error, r.data?.field)); return; }
    flash('Сохранено'); setAsk(false); setF(null); await load();
  };
  const scan = async () => {
    setScanning(true);
    const r = await apiCall<D>(`${A}/disk-scan`, { method: 'POST', body: '{}' });
    setScanning(false);
    if (r.ok) setDisk(r.data ?? null); else flash(errText(r.error));
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d || !f) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const now = d.now ?? {}; const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const series = (d.series ?? []) as D[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${MODE_COLOR[d.mode] ?? C.brd}` }}>
        <Gauge size={22} style={{ color: MODE_COLOR[d.mode] }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>Режим: {d.modeLabel}{!d.settings.enabled && ' (автооптимизация выключена)'}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>С {dt(d.since)}{d.why?.length ? ` · причины: ${d.why.join(', ')}` : ''}{d.deferredHousekeeping ? ` · плановых уборок отложено: ${d.deferredHousekeeping}` : ''}</p>
        </div>
      </div>

      {(d.warnings?.length > 0 || d.causes?.length > 0) && (
        <Card title="Предупреждения и вероятные причины">
          {(d.warnings as D[]).map((w, i) => <p key={`w${i}`} className="text-xs" style={{ color: w.level === 'critical' ? C.red : C.amber }}>{w.text}</p>)}
          {(d.causes as string[]).map((c, i) => <p key={`c${i}`} className="text-xs" style={{ color: C.t2 }}>• {c}</p>)}
        </Card>
      )}

      <Card title="Процесс API и машина">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="CPU на ядро" value={`${now.loadPct ?? '—'}%`} sub={`ядер: ${d.process.cores}`} />
          <Stat label="Память" value={`${now.memPct ?? '—'}%`} sub={d.process.cgroup?.limit ? `лимит контейнера ${mb(d.process.cgroup.limit)}` : `машина ${mb(d.process.machineMemMb * 1048576)}`} />
          <Stat label="Процесс API (RSS)" value={`${d.process.rssMb} МБ`} sub={`куча ${d.process.heapMb} МБ`} />
          <Stat label="Задержка цикла (p99)" value={`${now.lagP99 ?? '—'} мс`} />
          <Stat label="Свободно на диске" value={now.diskFreePct != null ? `${now.diskFreePct}%` : 'неизвестно'} />
          <Stat label="Запросов/с (с запуска)" value={d.requests?.perSecond ?? '—'} sub={d.requests ? `5xx: ${d.requests.errors5xx}, p95: ${d.requests.p95Ms ?? '—'} мс` : undefined} />
          <Stat label="Работает" value={`${Math.round(d.process.uptimeSec / 60)} мин`} />
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <div><p className="text-[11px]" style={{ color: C.t3 }}>CPU на ядро, %</p><Spark data={series.map((x) => x.load)} color={C.acc} max={150} /></div>
          <div><p className="text-[11px]" style={{ color: C.t3 }}>Память, %</p><Spark data={series.map((x) => x.mem)} color={C.amber} max={100} /></div>
          <div><p className="text-[11px]" style={{ color: C.t3 }}>Запросов к БД за 15 с</p><Spark data={series.map((x) => x.dbq)} color={C.green} /></div>
        </div>
        <p className="text-[11px]" style={{ color: C.t3 }}>{d.containers}</p>
      </Card>

      <Card title="База данных">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Запросов в минуту" value={d.database.queriesPerMin} />
          <Stat label="Среднее время" value={`${d.database.avgMs} мс`} />
          <Stat label="Соединения" value={`${d.database.pool.total - d.database.pool.idle}/${d.database.pool.max}`} sub={`ждут: ${d.database.pool.waiting}`} />
          <Stat label="Ошибок запросов" value={d.database.errors} />
        </div>
        <p className="pt-1 text-[11px] font-bold" style={{ color: C.t3 }}>Медленные запросы (от {d.database.slowThresholdMs} мс; литералы и числа заменены на «?»)</p>
        {(d.slowQueries as D[]).length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Медленных запросов нет.</p> :
          (d.slowQueries as D[]).map((q, i) => <p key={i} className="break-all text-[11px]" style={{ color: C.t2 }}><b>{q.ms} мс</b> · {dt(q.at)} · <span translate="no">{q.sql}</span></p>)}
      </Card>

      <Card title="Самые частые запросы к базе (с запуска)">
        {(d.topQueries as D[] | undefined)?.length ? (d.topQueries as D[]).map((q, i) => (
          <p key={i} className="break-all text-[11px]" style={{ color: C.t2 }}><b>{q.count}×</b> · {q.avgMs} мс · <span translate="no">{q.sql}</span></p>
        )) : <p className="text-xs" style={{ color: C.t3 }}>Данных пока нет.</p>}
        <p className="text-[11px]" style={{ color: C.t3 }}>Помогает найти повторяющиеся запросы и кандидатов на кэш. Показывается только форма запроса, без значений.</p>
      </Card>

      <Card title="Место по категориям">
        <button type="button" disabled={scanning} onClick={() => void scan()} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          {scanning ? 'Считаю…' : 'Посчитать'}
        </button>
        <p className="text-[11px]" style={{ color: C.t3 }}>Подсчёт идёт по кнопке (результат хранится 10 минут), чтобы не нагружать диск постоянным обходом. Папки считаются до 200 000 файлов каждая.</p>
        {disk && (disk.categories as D[]).map((c, i) => <p key={i} className="text-xs" style={{ color: C.t2 }}>{c.label}: <b>{mb(c.bytes)}</b>{c.files != null ? ` · файлов: ${c.files}` : ''}{c.truncated ? ' (подсчёт неполный)' : ''}</p>)}
      </Card>

      <Card title="Настройки">
        {!d.canEdit && <p className="text-[11px]" style={{ color: C.t3 }}>Менять настройки может только владелец.</p>}
        <div className="space-y-2">
          {Object.entries(d.bools as D).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
              <input type="checkbox" disabled={!d.canEdit} checked={f[k] === true} onChange={(e) => set(k, e.target.checked)} /> {v.label}
            </label>
          ))}
          {Object.entries(d.limits as D).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between gap-3 text-xs" style={{ color: C.t2 }}>
              <span>{v.label} <span style={{ color: C.t3 }}>({v.lo}–{v.hi})</span></span>
              <input type="number" disabled={!d.canEdit} value={f[k] ?? ''} min={v.lo} max={v.hi} onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))}
                className="w-24 rounded-lg px-2 py-1 text-right text-xs outline-none" style={field} aria-label={v.label} />
            </label>
          ))}
        </div>
        {d.canEdit && !ask && <button type="button" onClick={() => void begin()} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>Сохранить (с подтверждением личности)</button>}
        {ask && (
          <div className="space-y-2">
            <p className="text-[11px]" style={{ color: C.t3 }}>Введите код подтверждения ({'Введите код из приложения-аутентификатора.'}).</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" aria-label="Код подтверждения" className="w-40 rounded-lg px-2 py-1 text-sm outline-none" style={field} />
            <div className="flex gap-2">
              <button type="button" disabled={code.length < 6} onClick={() => void save()} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Подтвердить</button>
              <button type="button" onClick={() => setAsk(false)} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>Отмена</button>
            </div>
          </div>
        )}
      </Card>

      <Card title="История изменений режимов и событий">
        {(d.events as D[]).length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Пока ничего не происходило.</p> :
          (d.events as D[]).map((e, i) => <p key={i} className="text-[11.5px]" style={{ color: C.t2 }}><b>{KIND[e.kind] ?? e.kind}</b> · {dt(e.at)} · {e.detail}</p>)}
      </Card>
    </div>
  );
};
