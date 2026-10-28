/**
 * Вкладка «Сервер» (Sky Ops): диагностика, «Починить всё», деплой, сборка приложений и консоль вывода.
 * Сервер задания только ставит в очередь; выполняет агент на хосте (ops/agent.mjs) из ЗАКРЫТОГО списка команд — произвольной командной строки нет.
 * Изменяющие действия (починка, деплой, сборка, перезапуск) — только с кодом подтверждения и по одному за раз.
 * Права: `server_ops` (у владельца есть, в «полные права» не входит).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Wrench, Rocket, Package, RotateCw, Terminal, Copy, X, CheckCircle2, XCircle, CircleDot } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/ops';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Spec = { name: string; label: string; type: 'select' | 'number' | 'text' | 'bool'; options?: string[]; min?: number; max?: number; def?: unknown };
type Cmd = { id: string; label: string; group: string; mutating: boolean; params: Spec[] };

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', ops_disabled: 'Sky Ops не настроен на сервере (нет OPS_SECRET).', busy: 'Уже выполняется другое изменяющее задание — дождитесь его.',
  queue_full: 'В очереди слишком много заданий.', unknown_command: 'Неизвестная команда.', bad_param: 'Неверное значение параметра.',
  step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  too_many_requests: 'Слишком часто, подождите минуту.', not_cancellable: 'Уже нельзя отменить.', lockdown: 'Панель закрыта.',
};
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const STATUS: Record<string, [string, string]> = { queued: ['в очереди', C.t3], running: ['выполняется', C.acc], done: ['готово', C.green], failed: ['с ошибкой', C.red], cancelled: ['отменено', C.amber] };
const isLive = (s?: string) => s === 'queued' || s === 'running';

const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);

const Params = ({ specs, value, onChange }: { specs: Spec[]; value: Data; onChange: (v: Data) => void }) => (
  <div className="flex flex-wrap items-end gap-3">
    {specs.map((s) => (
      <label key={s.name} className="flex flex-col gap-1 text-[11px]" style={{ color: C.t3 }}>
        {s.type !== 'bool' && s.label}
        {s.type === 'select' && <select value={String(value[s.name] ?? s.def ?? '')} onChange={(e) => onChange({ ...value, [s.name]: e.target.value })} className="rounded-lg px-2 py-1.5 text-xs outline-none" style={field}>{s.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
        {s.type === 'number' && <input type="number" min={s.min} max={s.max} value={Number(value[s.name] ?? s.def ?? 0)} onChange={(e) => onChange({ ...value, [s.name]: Number(e.target.value) })} className="w-24 rounded-lg px-2 py-1.5 text-xs outline-none" style={field} />}
        {s.type === 'text' && <input value={String(value[s.name] ?? '')} maxLength={s.max} onChange={(e) => onChange({ ...value, [s.name]: e.target.value })} className="w-44 rounded-lg px-2 py-1.5 text-xs outline-none" style={field} />}
        {s.type === 'bool' && <span className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(value[s.name] ?? s.def)} onChange={(e) => onChange({ ...value, [s.name]: e.target.checked })} />{s.label}</span>}
      </label>
    ))}
  </div>
);

const Action = ({ icon, title, hint, children, onRun, run, lock, tone = 'acc' }: { icon: ReactNode; title: string; hint: string; children?: ReactNode; onRun: () => void; run: string; lock: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>{icon}{title}</p>
    <p className="text-[11px] leading-snug" style={{ color: C.t3 }}>{hint}</p>
    {children}
    <Btn tone={tone} disabled={lock} onClick={onRun}>{run}</Btn>
  </div>
);

const defaults = (c?: Cmd): Data => Object.fromEntries((c?.params ?? []).map((p) => [p.name, p.def ?? (p.type === 'bool' ? false : '')]));

export const OpsTab = () => {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [view, setView] = useState<Data | null>(null);       // открытое задание с выводом
  const [waiting, setWaiting] = useState(false);              // API перезапускается (деплой) — ждём
  const [pending, setPending] = useState<{ kind: string; params: Data; title: string } | null>(null);
  const [code, setCode] = useState(''); const [method, setMethod] = useState(''); const [busy, setBusy] = useState(false);
  const [cmdId, setCmdId] = useState('status'); const [cmdParams, setCmdParams] = useState<Data>({});
  const [fix, setFix] = useState<Data>({ clearBlocks: true }); const [dep, setDep] = useState<Data>({ skipPull: false }); const [app, setApp] = useState<Data>({ target: 'all', force: false });
  const [restart, setRestart] = useState('api');
  const outRef = useRef<HTMLPreElement | null>(null); const stick = useRef(true);
  const watching = useRef('');

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setData(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); const iv = setInterval(visibleTick(load), 8000); return () => clearInterval(iv); }, [load]);

  const cmds: Cmd[] = data?.commands ?? [];
  const reads = cmds.filter((c) => c.group === 'read');
  const cur = reads.find((c) => c.id === cmdId);
  useEffect(() => { setCmdParams(defaults(cur)); }, [cmdId, data?.commands?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Следим за заданием: добавляем вывод по мере появления; при перезапуске API (деплой) молча ждём. */
  const watch = useCallback((id: string) => {
    watching.current = id; setWaiting(false);
    let len = 0; let text = '';
    const tick = async () => {
      if (watching.current !== id) return true;
      const r = await apiCall<Data>(`${A}/jobs/${id}?from=${len}`);
      if (!r.ok) { setWaiting(true); return false; }
      setWaiting(false);
      const j = r.data ?? {}; text += String(j.output ?? ''); len = Number(j.length ?? len);
      setView({ ...j, output: text });
      if (!isLive(j.status)) { void load(); return true; }
      return false;
    };
    void (async () => { for (;;) { if (await tick()) return; await new Promise((r) => setTimeout(r, 1000)); } })();
  }, [load]);
  useEffect(() => () => { watching.current = ''; }, []);
  useEffect(() => { const el = outRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [view?.output]);

  const openJob = async (id: string) => {
    const r = await apiCall<Data>(`${A}/jobs/${id}`);
    if (!r.ok) { flash(errText(r.error)); return; }
    setView(r.data ?? null); if (isLive(r.data?.status)) watch(id); else watching.current = '';
  };

  const startRead = async () => {
    setBusy(true);
    const r = await apiCall<Data>(`${A}/jobs`, { method: 'POST', body: JSON.stringify({ kind: cmdId, params: cmdParams }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error)); return; }
    setView({ id: r.data?.id, label: cur?.label, status: 'queued', output: '' }); watch(String(r.data?.id)); void load();
  };
  const ask = async (kind: string, params: Data, title: string) => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: JSON.stringify({}) });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'email')); setCode(''); setPending({ kind, params, title });
  };
  const confirm = async () => {
    if (!pending) return; setBusy(true);
    const r = await apiCall<Data>(`${A}/jobs`, { method: 'POST', body: JSON.stringify({ kind: pending.kind, params: pending.params, stepUpCode: code }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error)); return; }
    setPending(null); setCode('');
    setView({ id: r.data?.id, label: pending.title, status: 'queued', output: '' }); watch(String(r.data?.id)); void load();
  };
  const cancel = async (id: string) => { const r = await apiCall<Data>(`${A}/jobs/${id}/cancel`, { method: 'POST', body: '{}' }); flash(r.ok ? 'Остановка запрошена' : errText(r.error)); };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!data) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const agent = data.agent ?? {};
  const jobs: Data[] = data.jobs ?? [];
  const mutBusy = jobs.some((j) => j.mutating && isLive(j.status));
  const lock = !agent.online || mutBusy;

  return (
    <div className="space-y-4">
      {/* Агент */}
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${agent.online ? C.brd : C.amber}` }}>
        <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>
          <CircleDot size={15} style={{ color: agent.online ? C.green : C.amber }} />
          {!data.enabled ? 'Sky Ops не настроен на сервере' : agent.online ? 'Агент на сервере на связи' : 'Агент на сервере не отвечает'}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: C.t3 }}>
          Задания из этой вкладки выполняет служба на самом сервере; она принимает только закрытый список действий — произвольную команду отправить нельзя.
          {agent.lastSeen ? ` Последний отклик: ${dt(agent.lastSeen)}${agent.runner ? ` (${agent.runner})` : ''}.` : ''}
        </p>
        {(!data.enabled || !agent.online) && (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl p-3 text-[11px] leading-relaxed" style={{ background: C.l2, color: C.t2 }}>
{`Установка (один раз, в консоли сервера под root):
  cd /opt/sky-src && git pull
  bash scripts/install-ops.sh --genkey
  bash scripts/deploy-local.sh
  bash scripts/install-ops.sh --install
Проверка: bash scripts/install-ops.sh --status`}
          </pre>
        )}
      </div>

      {/* Действия */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Action lock={lock} icon={<Wrench size={16} style={{ color: C.acc }} />} title="Починить всё" run="Починить" onRun={() => void ask('repair', fix, 'Починить всё')}
          hint="Запускает Docker и службы, перезапускает упавшие и «нездоровые» контейнеры, чинит права файлов, чистит диск при нехватке места, поднимает SSH, проверяет nginx и ответ API. Шлюз SSH и ваши настройки доступа не трогает.">
          <Params specs={[{ name: 'clearBlocks', label: 'Снять блокировки адресов самозащитой', type: 'bool', def: true }]} value={fix} onChange={setFix} />
        </Action>
        <Action lock={lock} icon={<Rocket size={16} style={{ color: C.acc }} />} title="Деплой" run="Выложить" onRun={() => void ask('deploy', dep, 'Деплой')}
          hint="Забирает последнюю версию из репозитория, собирает образы, проверяет nginx и перезапускает сервис. Во время перезапуска сайт и эта вкладка ненадолго не отвечают — вывод продолжится сам.">
          <Params specs={[{ name: 'skipPull', label: 'Не делать git pull (собрать то, что уже лежит)', type: 'bool', def: false }]} value={dep} onChange={setDep} />
        </Action>
        <Action lock={lock} icon={<Package size={16} style={{ color: C.acc }} />} title="Пересобрать приложения" run="Собрать" onRun={() => void ask('build_apps', app, 'Сборка приложений')}
          hint="Собирает .apk и/или .exe в /opt/sky/apps (потом их загружают в «Сайт» → «Скачивание» и «Обновления»). Тяжёлая операция: она сама откажется, если не хватает места или памяти; для iOS нужен Mac.">
          <Params specs={[{ name: 'target', label: 'Что собрать', type: 'select', options: ['apk', 'exe', 'all'], def: 'all' }, { name: 'force', label: 'Собрать заново, даже если ничего не менялось', type: 'bool', def: false }]} value={app} onChange={setApp} />
        </Action>
        <Action lock={lock} icon={<RotateCw size={16} style={{ color: C.acc }} />} title="Перезапустить" run="Перезапустить" tone="plain" onRun={() => void ask('restart', { service: restart }, `Перезапуск: ${restart}`)}
          hint="Быстрый перезапуск без пересборки — когда API или nginx «завис».">
          <Params specs={[{ name: 'service', label: 'Что', type: 'select', options: ['api', 'web', 'api+web'], def: 'api' }]} value={{ service: restart }} onChange={(v) => setRestart(String(v.service))} />
        </Action>
      </div>
      {mutBusy && <p className="text-xs" style={{ color: C.amber }}>Сейчас выполняется изменяющее задание — новое можно запустить после него. Диагностика ниже доступна всегда.</p>}

      {/* Подтверждение */}
      {pending && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
          <p className="text-sm font-bold" style={{ color: C.t1 }}>Подтвердите: {pending.title}</p>
          <p className="text-xs" style={{ color: C.t3 }}>{method === 'totp' ? 'Введите код из приложения-аутентификатора.' : 'Код отправлен на подтверждённую почту.'} Он одноразовый и действует несколько минут.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Код" className="w-32 rounded-lg px-3 py-2 text-sm outline-none" style={field} />
            <Btn disabled={busy || code.length < 6} onClick={() => void confirm()}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}Подтвердить и запустить</Btn>
            <Btn tone="plain" onClick={() => setPending(null)}>Отмена</Btn>
          </div>
        </div>
      )}

      {/* Консоль */}
      <div className="space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}><Terminal size={16} style={{ color: C.acc }} />Консоль — вывод с сервера</p>
        <p className="text-xs" style={{ color: C.t3 }}>Только чтение: журналы, состояние служб, ошибки, диск, SSH, файрвол. Пароли и ключи из вывода вырезаются.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[11px]" style={{ color: C.t3 }}>Команда
            <select value={cmdId} onChange={(e) => setCmdId(e.target.value)} className="rounded-lg px-2 py-2 text-xs outline-none" style={field}>{reads.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <Btn disabled={busy || !agent.online} onClick={() => void startRead()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Terminal size={14} />}Выполнить</Btn>
        </div>
        {cur && cur.params.length > 0 && <Params specs={cur.params} value={cmdParams} onChange={setCmdParams} />}
        <div className="rounded-xl" style={{ background: '#0b0d12', border: `1px solid ${C.brd}` }}>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]" style={{ color: '#9aa3b5', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            {view ? (<>
              <span className="font-bold" style={{ color: '#e6e9f0' }}>{view.label ?? view.kind}</span>
              <span style={{ color: (STATUS[view.status] ?? ['', '#9aa3b5'])[1] }}>{(STATUS[view.status] ?? [view.status])[0]}</span>
              {view.status === 'done' && <CheckCircle2 size={12} style={{ color: C.green }} />}{view.status === 'failed' && <XCircle size={12} style={{ color: C.red }} />}
              {waiting && <span style={{ color: C.amber }}>сервер перезапускается — жду ответа…</span>}
              <span className="ml-auto flex items-center gap-2">
                {isLive(view.status) && <button type="button" onClick={() => void cancel(String(view.id))} className="inline-flex items-center gap-1" style={{ color: C.red }}><X size={12} />Остановить</button>}
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(String(view.output ?? '')).then(() => flash('Вывод скопирован')); }} className="inline-flex items-center gap-1"><Copy size={12} />Копировать</button>
              </span>
            </>) : <span>Вывод появится здесь</span>}
          </div>
          <pre ref={outRef} translate="no" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
            className="max-h-[420px] min-h-[160px] overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] leading-relaxed" data-keep-dark style={{ color: '#d7dbe6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
            {view ? (view.output || (isLive(view.status) ? 'Ждём ответа агента…' : '(вывода нет)')) : ''}
          </pre>
        </div>
      </div>

      {/* История */}
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Последние задания</p>
        {jobs.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Пока ничего не запускали.</p>}
        <div className="space-y-1">
          {jobs.map((j) => {
            const [label, color] = STATUS[j.status] ?? [j.status, C.t3];
            return (
              <button key={j.id} type="button" onClick={() => void openJob(String(j.id))} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-left text-xs" style={{ background: view?.id === j.id ? C.l2 : 'transparent', color: C.t2 }}>
                <span className="font-bold" style={{ color: C.t1 }}>{j.label}</span>
                <span style={{ color }}>{label}</span>
                <span style={{ color: C.t3 }}>{dt(j.createdAt)}</span>
                {j.note && <span style={{ color: C.t3 }}>{j.note}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
