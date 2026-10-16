/**
 * Вкладка «Sky Storage»: состояние, безопасность и доступ (четыре кнопки), резервные копии и восстановление,
 * подключения, квоты и пороги, журнал. Всё решает сервер (server/skystorage*.mjs, маршруты /api/admin/storage):
 * экран только показывает состояние ИЗ ОТВЕТА сервера — «успех» не рисуется, пока сервер его не подтвердил.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, Power, ShieldCheck, ShieldOff, PlayCircle, AlertTriangle, RefreshCw, Download, Lock } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/storage';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Это действие доступно только владельцу.', confirm_required: 'Нужно явное подтверждение.',
  step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  no_second_factor: 'Нужна подтверждённая почта или аутентификатор.', conflict: 'Состояние уже изменил другой администратор — данные обновлены, повторите.',
  checks_failed: 'Проверки не пройдены — включать нельзя.', busy: 'Уже выполняется другая тяжёлая задача.', reason_required: 'Укажите причину (от 5 знаков).',
  storage_unavailable: 'Хранилище недоступно.', target_not_configured: 'Площадка копий не настроена (scripts/setup-storage.sh).', target_unavailable: 'Площадка копий недоступна.',
  kek_not_configured: 'Не задан ключ шифрования копий (scripts/setup-storage.sh).', kek_missing: 'Нет ключа, которым зашифрована копия.', bad_state: 'Недоступно в текущем состоянии.',
  recovery_procedure_required: 'Это ограничение снимается только процедурой восстановления.', rotate_keys_first: 'Сначала замените ключ шифрования (scripts/setup-storage.sh --rotate).',
  plan_expired: 'План устарел — составьте заново.', plan_already_applied: 'Этот план уже применён.', too_many_attempts: 'Слишком часто, подождите минуту.',
  nothing_selected: 'Ничего не выбрано.', bad_field: 'Проверьте значение поля.', not_found: 'Не найдено.', connection_pending: 'Подключение ждёт подтверждения владельца.',
};
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await apiCall<Data>(`${A}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return r.ok ? { ok: true as const, data: r.data as Data } : { ok: false as const, error: r.error, data: (r.data ?? {}) as Data, status: r.status };
};
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} ГБ` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} МБ` : `${Math.round(n / 1e3)} КБ`);

const Wait = () => <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children, tone }: { title?: string; children: ReactNode; tone?: string }) => (
  <div className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${tone ?? C.brd}` }}>
    {title && <p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>}{children}
  </div>
);
const Badge = ({ ok, children }: { ok: boolean | null; children: ReactNode }) => (
  <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: ok === null ? C.l2 : ok ? 'rgba(52,211,153,.15)' : 'rgba(239,68,68,.15)', color: ok === null ? C.t3 : ok ? C.green : C.red }}>{children}</span>
);

/* ── подтверждение личности ── */
const StepUp = ({ onCode, onCancel }: { onCode: (c: string) => void; onCancel: () => void }) => {
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  useEffect(() => { let live = true; void call('POST', '/step-up', {}).then((r) => { if (!live) return; setBusy(false); if (r.ok) setMethod(String(r.data.method ?? 'email')); else setErr(errText(r.error)); }); return () => { live = false; }; }, []);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
      <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
      {busy && <Wait />}{err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {method && <p className="text-[11px]" style={{ color: C.t3 }}>{method === 'app' ? 'Код из приложения двухэтапной защиты.' : 'Код отправлен на почту, действует пять минут.'}</p>}
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-widest outline-none" style={field} />
        <Btn disabled={code.length < 6} onClick={() => onCode(code)}>Подтвердить</Btn>
      </div>
      <button type="button" onClick={onCancel} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
    </div>
  );
};

/** Действие, которое выполняется только с кодом подтверждения личности: `ask(fn)` показывает форму кода, `node` — её место на экране. */
const useCodeGate = () => {
  const [pending, setPending] = useState<null | ((code: string) => Promise<void>)>(null);
  const ask = (fn: (code: string) => Promise<void>) => setPending(() => fn);
  const node = pending ? <StepUp onCode={(c) => { const f = pending; setPending(null); void f(c); }} onCancel={() => setPending(null)} /> : null;
  return { ask, node };
};

/** Критическое действие: описание последствий → причина → явное подтверждение → код → запрос → фактическое состояние. */
const Critical = ({ title, consequences, path, extra, needReason = true, preview, confirmLabel, onDone, onCancel }: {
  title: string; consequences: string[]; path: string; extra?: () => Data; needReason?: boolean; preview?: ReactNode; confirmLabel: string;
  onDone: () => void; onCancel: () => void;
}) => {
  const [reason, setReason] = useState(''); const [ok, setOk] = useState(false); const [step, setStep] = useState(false); const [busy, setBusy] = useState(false);
  const run = async (code: string) => {
    setBusy(true);
    const ov = await call('GET', '/overview');
    const r = await call('POST', path, { ...(extra?.() ?? {}), reason, confirm: true, stepUpCode: code, expectedVersion: ov.ok ? ov.data.state.version : undefined });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error)); if (!String(r.error).startsWith('step_up')) setStep(false); if (r.error === 'conflict') onDone(); return; }
    flash('Выполнено — сервер подтвердил новое состояние'); onDone();
  };
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.red}` }} data-storage-critical={path}>
      <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.red }}><AlertTriangle size={14} />{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-[12px]" style={{ color: C.t2 }}>{consequences.map((c) => <li key={c}>{c}</li>)}</ul>
      {preview}
      {needReason && <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Причина (обязательно, попадёт в журнал)" aria-label="Причина" className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none" style={field} />}
      <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Понимаю последствия</label>
      {step ? <StepUp onCode={(c) => void run(c)} onCancel={() => setStep(false)} />
        : <div className="flex gap-2"><Btn tone="red" disabled={!ok || busy || (needReason && reason.trim().length < 5)} onClick={() => setStep(true)}>{confirmLabel}</Btn><Btn tone="plain" onClick={onCancel}>Отмена</Btn></div>}
      {busy && <Wait />}
    </div>
  );
};

/* ═══════════ Состояние и безопасность ═══════════ */
const Overview = ({ perms, owner }: { perms: string[]; owner: boolean }) => {
  const [d, setD] = useState<Data | null>(null);
  const [panel, setPanel] = useState<string | null>(null);
  const [mode, setMode] = useState<'full' | 'writes'>('full');
  const [checks, setChecks] = useState<Data | null>(null);
  const [restr, setRestr] = useState<Data[] | null>(null); const [sel, setSel] = useState<string[]>([]);
  const has = (p: string) => perms.includes(p);
  const load = useCallback(async () => { const r = await call('GET', '/overview'); if (r.ok) setD(r.data); else flash(errText(r.error)); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => window.clearInterval(t); }, [load]);
  const open = async (p: string) => {
    setPanel(p);
    if (p === 'enable') { const r = await call('POST', '/enable', { preview: true }); setChecks(r.ok ? r.data : null); }
    if (p === 'unlock') { const r = await call('GET', '/restrictions'); setRestr(r.ok ? r.data.items : []); setSel([]); }
  };
  const done = () => { setPanel(null); setChecks(null); void load(); };
  if (!d) return <Wait />;
  const st = d.state; const e = st.effective;
  const lvl = d.stats.capacity.level; const pct = d.stats.capacity.pct;
  return (
    <div className="space-y-3">
      <Card title="Общее состояние" tone={e.read && e.write ? C.brd : C.red}>
        <div className="flex flex-wrap gap-2">
          <Badge ok={e.read}>чтение {e.read ? 'разрешено' : 'закрыто'}</Badge><Badge ok={e.write}>запись {e.write ? 'разрешена' : 'закрыта'}</Badge>
          <Badge ok={!st.emergency.active}>{st.emergency.active ? 'аварийное отключение' : 'без аварийного отключения'}</Badge>
          <Badge ok={!st.maintenance.active}>{st.maintenance.active ? `техработы (${st.maintenance.mode === 'emergency' ? 'аварийная остановка' : 'безопасное обслуживание'})` : 'без технических работ'}</Badge>
          <Badge ok={st.skyAuth.active ? true : null}>{st.skyAuth.active ? 'обязательная авторизация Sky' : 'авторизация Sky: обычная'}</Badge>
        </div>
        {e.reasons.map((r: Data) => <p key={r.code + r.text} className="text-[12px]" style={{ color: C.amber }}>• {r.text}</p>)}
        <p className="text-[11px]" style={{ color: C.t3 }}>Версия состояния {st.version} · обновлено {dt(st.updatedAt)}</p>
      </Card>

      <Card title="Объём и площадка">
        <div className="h-2 overflow-hidden rounded-full" style={{ background: C.l2 }}><div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: lvl === 'ok' ? C.green : lvl === 'warn' ? C.amber : C.red }} /></div>
        <p className="text-[12px]" style={{ color: C.t2 }}>Занято {gb(d.stats.capacity.used)} из {gb(d.stats.capacity.total)} ({pct}%, уровень «{lvl}») · файлов {d.stats.capacity.files} · свободно на диске {gb(d.stats.capacity.diskFree)}</p>
        <div className="grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4" style={{ color: C.t3 }}>{d.stats.categories.filter((c: Data) => c.bytes || c.files).map((c: Data) => <span key={c.category}>{c.category}: {gb(c.bytes)} · {c.files}</span>)}</div>
        <p className="text-[12px]" style={{ color: C.t2 }}>
          Площадка копий: {d.target.configured ? <><b>{d.target.kind}</b> <span translate="no">{d.target.label}</span> {d.target.health?.ok ? <Badge ok>доступна, {d.target.health.ms} мс</Badge> : <Badge ok={false}>недоступна {d.target.health?.code ?? ''}</Badge>} {!d.target.independent && <Badge ok={false}>не независимая площадка</Badge>}</> : <Badge ok={false}>не настроена{d.target.missing?.length ? `: ${d.target.missing.join(', ')}` : ''}</Badge>}
        </p>
        <p className="text-[12px]" style={{ color: C.t2 }}>Основное хранение медиа: {d.primary?.enabled ? <Badge ok>S3 (кэш на диске {d.primary.cacheDays ? `${d.primary.cacheDays} дн.` : 'без очистки'})</Badge> : <Badge ok={false}>диск сервера, S3 не включён</Badge>}</p>
        <p className="text-[12px]" style={{ color: C.t2 }}>Ключ шифрования копий: {d.keys.configured ? <Badge ok>активный {d.keys.active}</Badge> : <Badge ok={false}>не задан</Badge>} · последняя проверенная копия: {d.backups.lastVerified ? dt(d.backups.lastVerified.verified_at) : 'нет'} · загрузок идёт {d.activity.uploads}, чтений {d.activity.io}</p>
        {d.lastProblems.length > 0 && <details className="text-[11px]" style={{ color: C.t3 }}><summary>Последние предупреждения и ошибки</summary>{d.lastProblems.map((p: Data) => <p key={p.id} translate="no">{dt(p.at)} · {p.level} · {p.kind}</p>)}</details>}
      </Card>

      <Card title="Безопасность и доступ">
        <p className="text-[11px]" style={{ color: C.t3 }}>Четыре независимые команды. Каждая проверяется на сервере, требует подтверждения личности и пишется в журнал. Ни одна не меняет состояния других.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Btn tone="red" disabled={!has('storage_emergency')} onClick={() => void open('off')}><Power size={12} className="mr-1 inline" />1. Выключить хранилище</Btn>
          <Btn tone="plain" disabled={!has('storage_emergency')} onClick={() => void open('skyauth')}><ShieldCheck size={12} className="mr-1 inline" />2. Ограничить доступ от ключа Sky</Btn>
          <Btn disabled={!has('storage_enable')} onClick={() => void open('enable')}><PlayCircle size={12} className="mr-1 inline" />3. Включить хранилище</Btn>
          <Btn tone="plain" disabled={!has('storage_unlock')} onClick={() => void open('unlock')}><ShieldOff size={12} className="mr-1 inline" />4. Отключить ограничения</Btn>
        </div>
        {panel === 'off' && <Critical title="Выключить хранилище" confirmLabel="Выключить" path="/emergency-off" extra={() => ({ mode })} onDone={done} onCancel={() => setPanel(null)}
          consequences={['Новые операции записи (и чтения при выбранном режиме) закрываются на сервере, даже если приложения продолжат слать запросы.', 'Новые подключения запрещены, ранее выданные временные ссылки и пропуска аннулируются.', 'Файлы, ключи и резервные копии НЕ удаляются.', 'Владелец и администраторы получат уведомление.']}
          preview={<select value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'writes')} aria-label="Режим" className="rounded-lg px-2 py-1.5 text-sm" style={field}><option value="full">Закрыть чтение и запись</option><option value="writes">Закрыть только запись</option></select>} />}
        {panel === 'skyauth' && <Critical title="Ограничить доступ от ключа Sky" confirmLabel="Включить ограничение" path="/sky-auth" onDone={done} onCancel={() => setPanel(null)}
          consequences={['Доступ к хранилищу требует действующей серверной авторизации Sky; ранее выданные временные ссылки отзываются.', 'Новые пропуска живут короче (настраивается в «Квоты и пороги»); приложения запросят их заново автоматически.', 'Само хранилище не выключается; снять режим можно кнопкой 4.']} />}
        {panel === 'enable' && <Critical title="Включить хранилище" confirmLabel="Включить" path="/enable" needReason={false} onDone={done} onCancel={() => setPanel(null)}
          consequences={['Снимается только аварийное отключение — и только если пройдены проверки ниже.', 'Другие ограничения, технические работы и режим авторизации Sky не меняются; скомпрометированные сессии не возобновляются.']}
          preview={checks ? <div className="space-y-0.5 text-[12px]">{checks.checks.map((c: Data) => <p key={c.id} style={{ color: c.ok ? C.green : c.critical ? C.red : C.amber }}>{c.ok ? '✔' : c.critical ? '✖' : '!'} {c.label}{c.detail ? ` — ${c.detail}` : ''}</p>)}{!checks.canEnable && <p style={{ color: C.red }}>Критические проверки не пройдены — включение будет отклонено сервером.</p>}</div> : <Wait />} />}
        {panel === 'unlock' && <Critical title="Отключить ограничения" confirmLabel="Снять выбранные" path="/unlock" extra={() => ({ ids: sel })} onDone={done} onCancel={() => setPanel(null)}
          consequences={['Снимаются только выбранные ограничения; хранилище не включается автоматически и другие состояния не затрагиваются.', 'Критические ограничения снимает только владелец; ограничения из-за компрометации — только процедурой восстановления.']}
          preview={restr === null ? <Wait /> : restr.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Активных ограничений нет.</p> : <div className="space-y-1">{restr.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded-lg p-2 text-[12px]" style={{ background: C.l1, color: C.t2 }}>
              <input type="checkbox" disabled={r.kind === 'compromise'} checked={sel.includes(r.id)} onChange={(ev) => setSel(ev.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} />
              <span><b style={{ color: C.t1 }}>{r.kind}</b>{r.critical ? ' (критическое)' : ''} — {r.reason} · {dt(r.at)} · <span translate="no">{r.by}</span><br />{r.consequence}</span>
            </label>))}</div>} />}
      </Card>

      <More perms={perms} owner={owner} state={st} onDone={load} />
    </div>
  );
};

const More = ({ perms, owner, state, onDone }: { perms: string[]; owner: boolean; state: Data; onDone: () => void }) => {
  const [panel, setPanel] = useState<string | null>(null);
  const [kind, setKind] = useState('readonly'); const [mm, setMm] = useState<'safe' | 'emergency'>('safe');
  const has = (p: string) => perms.includes(p);
  const done = () => { setPanel(null); onDone(); };
  const maint = state.maintenance.active;
  return (
    <Card title="Технические работы и дополнительные ограничения">
      <div className="flex flex-wrap gap-2">
        {has('storage_maintenance') && !maint && <><select value={mm} onChange={(e) => setMm(e.target.value as 'safe' | 'emergency')} aria-label="Режим техработ" className="rounded-lg px-2 py-1 text-xs" style={field}><option value="safe">Безопасное обслуживание</option><option value="emergency">Аварийная остановка</option></select><Btn tone="plain" onClick={() => setPanel('maint')}>Начать технические работы</Btn></>}
        {has('storage_maintenance') && maint && <Btn tone="plain" onClick={() => setPanel('maintoff')}>Завершить технические работы</Btn>}
        {has('storage_emergency') && <Btn tone="plain" onClick={() => setPanel('restrict')}>Добавить ограничение</Btn>}
        {has('storage_emergency') && <Btn tone="red" onClick={() => setPanel('compromise')}>Отметить компрометацию</Btn>}
        {owner && state.restrictions.some((r: Data) => r.kind === 'compromise') && <Btn tone="plain" onClick={() => setPanel('recover')}>Процедура восстановления</Btn>}
      </div>
      {panel === 'maint' && <Critical title="Технические работы" confirmLabel="Начать" path="/maintenance" extra={() => ({ on: true, mode: mm })} onDone={done} onCancel={() => setPanel(null)}
        consequences={['Новые загрузки блокируются на сервере; чтение продолжает работать' + (mm === 'emergency' ? ' — НО при аварийной остановке закрывается и оно.' : '.'), 'Режим переживает перезапуск; аварийное отключение и ограничения он не отменяет и не заменяет.']} />}
      {panel === 'maintoff' && <Critical title="Завершить технические работы" confirmLabel="Завершить" path="/maintenance" extra={() => ({ on: false })} needReason={false} onDone={done} onCancel={() => setPanel(null)}
        consequences={['Перед завершением сервер проверяет базу, авторизацию и диск. Аварийное отключение и ограничения останутся.']} />}
      {panel === 'restrict' && <Critical title="Добавить ограничение" confirmLabel="Добавить" path="/restrict" extra={() => ({ kind })} onDone={done} onCancel={() => setPanel(null)}
        consequences={['readonly — запись закрыта; no_new_connections — новые подключения закрыты; lock_all — закрыто всё (критическое).']}
        preview={<select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид ограничения" className="rounded-lg px-2 py-1.5 text-sm" style={field}><option value="readonly">readonly — только чтение</option><option value="no_new_connections">no_new_connections</option><option value="lock_all">lock_all — полная блокировка</option></select>} />}
      {panel === 'compromise' && <Critical title="Отметить компрометацию" confirmLabel="Отметить" path="/compromise" onDone={done} onCancel={() => setPanel(null)}
        consequences={['Запись и новые подключения закрываются, временные ссылки отзываются.', 'Ограничение снимается только владельцем по процедуре восстановления после смены ключа шифрования.']} />}
      {panel === 'recover' && <Critical title="Процедура восстановления после компрометации" confirmLabel="Выполнить" path="/recover" needReason={false} extra={() => ({ ackKeysRotated: true })} onDone={done} onCancel={() => setPanel(null)}
        consequences={['Требуется сменить активный ключ шифрования (scripts/setup-storage.sh --rotate) и перезапустить сервер.', 'Все подключения отзываются и потребуют нового подтверждения. Хранилище само не включается.']} />}
    </Card>
  );
};

/* ═══════════ Резервные копии ═══════════ */
const Backups = ({ perms, owner }: { perms: string[]; owner: boolean }) => {
  const [d, setD] = useState<Data | null>(null);
  const [kind, setKind] = useState('full'); const [scope, setScope] = useState('');
  const [plan, setPlan] = useState<Data | null>(null); const [ret, setRet] = useState<Data | null>(null); const [sch, setSch] = useState<Data[]>([]);
  const [restoreFor, setRestoreFor] = useState<string | null>(null); const [restoreScope, setRestoreScope] = useState(''); const [overwrite, setOverwrite] = useState(false);
  const [step, setStep] = useState<null | { kind: 'apply' | 'download'; id: string }>(null); const [link, setLink] = useState('');
  const [sf, setSf] = useState({ frequency: 'daily', times: '03:00', weekday: '1', kind: 'full' });
  const gate = useCodeGate();
  const has = (p: string) => perms.includes(p);
  const load = useCallback(async () => { const [a, b] = await Promise.all([call('GET', '/backups'), call('GET', '/schedules')]); if (a.ok) setD(a.data); if (b.ok) setSch(b.data.items); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => window.clearInterval(t); }, [load]);
  const scopeObj = () => (kind === 'service' ? { services: scope.split(',').map((x) => x.trim()).filter(Boolean) } : kind === 'category' ? { categories: scope.split(',').map((x) => x.trim()).filter(Boolean) } : {});
  const run = async () => { const r = await call('POST', '/backups', { kind, scope: scopeObj() }); flash(r.ok ? 'Копирование запущено' : errText(r.error)); void load(); };
  const act = async (id: string, a: string, body: Data = {}) => { const r = await call('POST', `/backups/${id}/${a}`, body); if (!r.ok) flash(errText(r.error)); else flash(a === 'verify' ? (r.data.ok ? 'Целостность подтверждена' : 'Копия НЕ прошла проверку') : 'Готово'); void load(); return r; };
  const stepDone = async (code: string) => {
    if (!step) return;
    if (step.kind === 'download') { const r = await call('POST', `/backups/${step.id}/download-link`, { confirm: true, stepUpCode: code }); if (r.ok) { setLink(r.data.url); setStep(null); } else flash(errText(r.error)); return; }
    const r = await call('POST', '/restore/apply', { planId: plan?.planId, overwrite, confirm: true, stepUpCode: code });
    if (r.ok) { flash(`Восстановление: ${r.data.status}`); setPlan({ ...plan, result: r.data }); setStep(null); } else { flash(errText(r.error)); if (!String(r.error).startsWith('step_up')) setStep(null); }
  };
  if (!d) return <Wait />;
  const s = d.summary;
  return (
    <div className="space-y-3">
      {has('storage_backup') && (
        <Card title="Запустить копирование">
          <div className="flex flex-wrap gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Тип копии" className="rounded-lg px-2 py-1.5 text-sm" style={field}>
              <option value="full">Полная копия защищённых данных</option><option value="media">Медиафайлы</option><option value="messenger">Мессенджер и вложения</option>
              <option value="service">Выбранный сервис</option><option value="category">Выбранная категория</option><option value="metadata">Метаданные и связи</option><option value="config">Конфигурация (без секретов)</option>
            </select>
            {['service', 'category'].includes(kind) && <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder={kind === 'service' ? 'music, film, podcasts…' : 'music, film…'} aria-label="Область" className="rounded-lg px-2 py-1.5 text-sm outline-none" style={field} />}
            <Btn disabled={s.running} onClick={() => void run()}><PlayCircle size={12} className="mr-1 inline" />Запустить</Btn>
          </div>
          {s.running && <p className="text-[12px]" style={{ color: C.amber }}>Сейчас выполняется задача — параллельный запуск заблокирован.</p>}
          {!s.target.configured && <p className="text-[12px]" style={{ color: C.red }}>Площадка копий не настроена: bash scripts/setup-storage.sh</p>}
        </Card>
      )}
      <Card title="Копии">
        {d.items.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Копий пока нет.</p>}
        {d.items.map((b: Data) => (
          <div key={b.id} className="space-y-1 rounded-lg p-2" style={{ background: C.l2 }} data-backup={b.id}>
            <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: C.t1 }}>
              <b translate="no">{b.kind}</b><span translate="no">{b.id}</span><Badge ok={b.status === 'verified' ? true : ['failed', 'corrupt'].includes(b.status) ? false : null}>{b.status}</Badge>
              <span style={{ color: C.t3 }}>{dt(b.started_at)} · {b.files} файл. · {gb(Number(b.bytes))}{b.base_id ? ' · инкрементальная' : ''}{b.trigger === 'schedule' ? ' · по расписанию' : ''}{b.pinned ? ' · закреплена' : ''}</span>
            </div>
            {['running', 'verifying'].includes(b.status) && <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.l1 }}><div className="h-full" style={{ width: `${b.progress}%`, background: C.acc }} /></div>}
            {b.error && <p className="text-[11px]" style={{ color: C.red }} translate="no">{b.error}</p>}
            {b.verify && <p className="text-[11px]" style={{ color: C.t3 }}>Проверка {dt(b.verified_at)}: проверено {b.verify.checked}, ошибок {b.verify.failed.length}, пропало {b.verify.missing.length}</p>}
            <div className="flex flex-wrap gap-1.5">
              {has('storage_backup') && ['ok', 'verified', 'corrupt'].includes(b.status) && <Btn tone="plain" onClick={() => void act(b.id, 'verify')}>Проверить целостность</Btn>}
              {has('storage_backup') && ['running'].includes(b.status) && <Btn tone="plain" onClick={() => void act(b.id, 'cancel')}>Отменить</Btn>}
              {has('storage_backup') && <Btn tone="plain" onClick={() => void act(b.id, 'pin', { pinned: !b.pinned })}>{b.pinned ? 'Открепить' : 'Закрепить'}</Btn>}
              {owner && ['ok', 'verified'].includes(b.status) && <Btn tone="plain" onClick={() => { setRestoreFor(b.id); setPlan(null); }}>Восстановить…</Btn>}
              {owner && ['ok', 'verified'].includes(b.status) && <Btn tone="plain" onClick={() => setStep({ kind: 'download', id: b.id })}><Download size={12} className="mr-1 inline" />Скачать</Btn>}
            </div>
            {restoreFor === b.id && (
              <div className="space-y-2 rounded-lg p-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <input value={restoreScope} onChange={(e) => setRestoreScope(e.target.value)} placeholder="Сервисы через запятую (пусто — всё содержимое копии)" aria-label="Область восстановления" className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={field} />
                <Btn onClick={async () => { const r = await call('POST', `/backups/${b.id}/restore-plan`, { scope: restoreScope.trim() ? { services: restoreScope.split(',').map((x) => x.trim()).filter(Boolean) } : {} }); if (r.ok) setPlan(r.data); else flash(errText(r.error)); }}>Составить план (ничего не меняет)</Btn>
                {plan && !plan.result && (
                  <div className="space-y-1 text-[12px]" style={{ color: C.t2 }}>
                    <p>К восстановлению: <b>{plan.toRestore}</b> файл. ({gb(plan.bytes)}), уже совпадают: {plan.same}, конфликтов: <b style={{ color: plan.conflictCount ? C.amber : C.t2 }}>{plan.conflictCount}</b>, таблиц: {plan.tables.length}</p>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />Перезаписать конфликтующие файлы (прежние сохранятся в карантине)</label>
                    <Btn tone="red" onClick={() => setStep({ kind: 'apply', id: b.id })}>Применить план…</Btn>
                  </div>
                )}
                {plan?.result && <p className="text-[12px]" style={{ color: plan.result.status === 'ok' ? C.green : C.amber }}>Результат: {plan.result.status} — файлов {plan.result.restored}, конфликтов {plan.result.conflicts}, ошибок {plan.result.failed.length}</p>}
              </div>
            )}
          </div>
        ))}
        {step && <StepUp onCode={(c) => void stepDone(c)} onCancel={() => setStep(null)} />}
        {link && <p className="break-all text-[12px]" style={{ color: C.green }}>Одноразовая ссылка (действует недолго, ключи в архив не входят): <a href={link} rel="noreferrer noopener" style={{ textDecoration: 'underline' }}>{link}</a></p>}
      </Card>
      {has('storage_backup') && (
        <Card title="Хранение и очистка">
          <Btn tone="plain" onClick={async () => { const r = await call('GET', '/retention/plan'); if (r.ok) setRet(r.data); }}><RefreshCw size={12} className="mr-1 inline" />Предпросмотр: что будет удалено</Btn>
          {ret && (ret.plan.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Удалять нечего (политика: {ret.policy.days} дн., минимум {ret.policy.minKeep} проверенных копии; цепочки и единственные копии защищены).</p> : (
            <div className="space-y-1 text-[12px]" style={{ color: C.t2 }}>{ret.plan.map((p: Data) => <p key={p.id} translate="no">{p.id} · {p.kind} · {dt(p.startedAt)} · {gb(p.bytes)} — {p.why}</p>)}
              <Btn tone="red" onClick={async () => { const r = await call('POST', '/retention/apply', { confirm: true }); flash(r.ok ? `Удалено копий: ${r.data.deleted}` : errText(r.error)); setRet(null); void load(); }}>Удалить перечисленные копии</Btn></div>))}
          <p className="text-[11px]" style={{ color: C.t3 }}>Пользовательские оригиналы при очистке копий не затрагиваются никогда.</p>
        </Card>
      )}
      {has('storage_schedule') && (
        <Card title="Расписание (работает на сервере, без браузера)">
          {gate.node}
          {sch.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
              <span translate="no">{x.frequency}{x.frequency === 'weekly' ? ` (день ${x.weekday})` : ''} · {(x.times ?? []).join(', ')} · {x.kind}</span><Badge ok={x.enabled}>{x.enabled ? 'включено' : 'выключено'}</Badge>
              <span style={{ color: C.t3 }}>последний запуск {dt(x.last_run_at)}</span>
              <Btn tone="plain" onClick={() => gate.ask(async (code) => { const r = await call('PUT', `/schedules/${x.id}`, { enabled: !x.enabled, stepUpCode: code }); if (!r.ok) flash(errText(r.error)); void load(); })}>{x.enabled ? 'Выключить' : 'Включить'}</Btn>
              <Btn tone="plain" onClick={() => gate.ask(async (code) => { const r = await call('DELETE', `/schedules/${x.id}`, { stepUpCode: code }); if (!r.ok) flash(errText(r.error)); void load(); })}>Удалить</Btn>
            </div>))}
          <div className="flex flex-wrap items-end gap-2">
            <select value={sf.frequency} onChange={(e) => setSf({ ...sf, frequency: e.target.value })} aria-label="Частота" className="rounded-lg px-2 py-1.5 text-sm" style={field}><option value="daily">Ежедневно</option><option value="multi">Несколько раз в день</option><option value="weekly">Еженедельно</option></select>
            <input value={sf.times} onChange={(e) => setSf({ ...sf, times: e.target.value })} aria-label="Время" placeholder="03:00, 15:00" className="w-32 rounded-lg px-2 py-1.5 text-sm outline-none" style={field} />
            {sf.frequency === 'weekly' && <select value={sf.weekday} onChange={(e) => setSf({ ...sf, weekday: e.target.value })} aria-label="День недели" className="rounded-lg px-2 py-1.5 text-sm" style={field}>{['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map((n, i) => <option key={n} value={i}>{n}</option>)}</select>}
            <select value={sf.kind} onChange={(e) => setSf({ ...sf, kind: e.target.value })} aria-label="Что копировать" className="rounded-lg px-2 py-1.5 text-sm" style={field}><option value="full">Полная</option><option value="media">Медиа</option><option value="messenger">Мессенджер</option><option value="metadata">Метаданные</option><option value="config">Конфигурация</option></select>
            <Btn onClick={() => gate.ask(async (code) => { const r = await call('POST', '/schedules', { frequency: sf.frequency, times: sf.times.split(',').map((x) => x.trim()), weekday: Number(sf.weekday), kind: sf.kind, stepUpCode: code }); flash(r.ok ? 'Расписание добавлено' : errText(r.error)); void load(); })}>Добавить</Btn>
          </div>
        </Card>
      )}
    </div>
  );
};

/* ═══════════ Подключения ═══════════ */
const Connections = ({ owner }: { owner: boolean }) => {
  const [items, setItems] = useState<Data[] | null>(null); const [step, setStep] = useState<null | { id: string; act: string; approve?: boolean }>(null);
  const load = useCallback(async () => { const r = await call('GET', '/connections'); if (r.ok) setItems(r.data.items); else flash(errText(r.error)); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => window.clearInterval(t); }, [load]);
  const go = async (code: string) => {
    if (!step) return;
    const r = await call('POST', `/connections/${step.id}/${step.act}`, { approve: step.approve, stepUpCode: code });
    if (r.ok) { flash(step.act === 'revoke' ? 'Подключение отозвано' : step.approve ? 'Подключение подтверждено' : 'Подключение отклонено'); setStep(null); void load(); } else { flash(errText(r.error)); if (!String(r.error).startsWith('step_up')) setStep(null); }
  };
  if (!items) return <Wait />;
  return (
    <Card title="Подключения к управлению хранилищем">
      <p className="text-[11px]" style={{ color: C.t3 }}>Новое устройство получает запрос; до подтверждения владельцем доступа к защищённым данным нет. Без ответа запрос закрывается сам — молчание не согласие.</p>
      {items.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Запросов пока нет.</p>}
      {items.map((c) => (
        <div key={c.id} className="space-y-1 rounded-lg p-2 text-[12px]" style={{ background: C.l2, color: C.t2 }} data-connection={c.status}>
          <div className="flex flex-wrap items-center gap-2"><b translate="no" style={{ color: C.t1 }}>@{c.username}</b><Badge ok={c.status === 'approved' ? true : ['denied', 'expired', 'revoked'].includes(c.status) ? false : null}>{c.status}</Badge>
            <span style={{ color: C.t3 }}>{dt(c.createdAt)} · риск {c.risk} ({(c.reasons ?? []).join(', ')}){c.decidedVia ? ` · решено: ${c.decidedVia}` : ''}</span></div>
          <p translate="no" style={{ color: C.t3 }}>{c.info?.ua} · {c.info?.net}</p>
          {owner && c.status === 'pending' && <div className="flex gap-2"><Btn onClick={() => setStep({ id: c.id, act: 'decide', approve: true })}>Подтвердить</Btn><Btn tone="red" onClick={() => setStep({ id: c.id, act: 'decide', approve: false })}>Отклонить</Btn></div>}
          {owner && c.status === 'approved' && <Btn tone="plain" onClick={() => setStep({ id: c.id, act: 'revoke' })}>Отозвать</Btn>}
        </div>))}
      {step && <StepUp onCode={(c) => void go(c)} onCancel={() => setStep(null)} />}
    </Card>
  );
};

/* ═══════════ Квоты и пороги ═══════════ */
const Quotas = ({ perms }: { perms: string[] }) => {
  const [d, setD] = useState<Data | null>(null); const [s, setS] = useState<Data | null>(null);
  const load = useCallback(async () => { const r = await call('GET', '/overview'); if (r.ok) { setD(r.data); setS(r.data.state.settings); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d || !s) return <Wait />;
  const can = perms.includes('storage_quota');
  const n = (k: string, v: string) => setS({ ...s, [k]: v === '' ? null : Number(v) });
  const th = (k: string, v: string) => setS({ ...s, thresholds: { ...s.thresholds, [k]: Number(v) } });
  const gate = useCodeGate();
  const saveSettings = () => gate.ask(async (code) => { const r = await call('PUT', '/settings', { settings: s, expectedVersion: undefined, stepUpCode: code }); flash(r.ok ? 'Сохранено' : errText(r.error)); void load(); });
  return (
    <div className="space-y-3">
      <Card title="Пороги и лимиты">
        {gate.node}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['warn', 'critical', 'block', 'full'] as const).map((k) => <label key={k} className="text-[11px]" style={{ color: C.t3 }}>{{ warn: 'Предупреждение, %', critical: 'Критично, %', block: 'Блок необязательных, %', full: 'Запрет записи, %' }[k]}<input type="number" disabled={!can} value={s.thresholds[k]} onChange={(e) => th(k, e.target.value)} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field} /></label>)}
          {([['totalBytes', 'Общий объём, байт'], ['reserveFreeBytes', 'Резерв свободного места, байт'], ['maxFileBytes', 'Макс. размер файла, байт'], ['maxFiles', 'Макс. файлов'], ['maxConcurrentUploads', 'Одновременных загрузок'], ['maxConcurrentIO', 'Одновременных чтений'], ['uploadsPerMinute', 'Загрузок в минуту'], ['approvalTimeoutMin', 'Таймаут подтверждения, мин'], ['skyAuthMaxTicketMin', 'Срок пропуска при авторизации Sky, мин'], ['quarantineDays', 'Карантин, дней'], ['downloadLinkMinutes', 'Срок ссылки скачивания, мин']] as const).map(([k, l]) =>
            <label key={k} className="text-[11px]" style={{ color: C.t3 }}>{l}<input type="number" disabled={!can} value={s[k] ?? ''} onChange={(e) => n(k, e.target.value)} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field} /></label>)}
          <label className="text-[11px]" style={{ color: C.t3 }}>Хранить копии, дней<input type="number" disabled={!can} value={s.retention.days} onChange={(e) => setS({ ...s, retention: { ...s.retention, days: Number(e.target.value) } })} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
          <label className="text-[11px]" style={{ color: C.t3 }}>Мин. проверенных копий<input type="number" disabled={!can} value={s.retention.minKeep} onChange={(e) => setS({ ...s, retention: { ...s.retention, minKeep: Number(e.target.value) } })} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
          <label className="text-[11px]" style={{ color: C.t3 }}>Лимит объёма копий, байт<input type="number" disabled={!can} value={s.retention.maxBytes ?? ''} onChange={(e) => setS({ ...s, retention: { ...s.retention, maxBytes: e.target.value === '' ? null : Number(e.target.value) } })} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field} /></label>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" disabled={!can} checked={s.backupRequiredForEnable} onChange={(e) => setS({ ...s, backupRequiredForEnable: e.target.checked })} />Включение хранилища требует свежей проверенной копии</label>
        {can && <Btn onClick={() => void saveSettings()}>Сохранить пороги и лимиты</Btn>}
      </Card>
      <Card title="Квоты по разделам">
        {d.categories.map((c: string) => <QuotaRow key={c} cat={c} row={d.quotas.find((x: Data) => x.category === c)} used={d.stats.categories.find((x: Data) => x.category === c)} can={can} onSaved={load} />)}
      </Card>
    </div>
  );
};
const QuotaRow = ({ cat, row, used, can, onSaved }: { cat: string; row?: Data; used?: Data; can: boolean; onSaved: () => void }) => {
  const { ask, node } = useCodeGate();
  const [f, setF] = useState({ hardBytes: row?.hard_bytes ?? '', maxFileBytes: row?.max_file_bytes ?? '', maxFiles: row?.max_files ?? '', maxConcurrent: row?.max_concurrent ?? '' });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="flex flex-wrap items-end gap-2 text-[11px]" style={{ color: C.t3 }} data-quota={cat}>
      {node}
      <span className="w-32 text-[12px] font-bold" style={{ color: C.t1 }}>{cat}<br /><span className="font-normal" style={{ color: C.t3 }}>{used ? `${gb(used.bytes)} · ${used.files}` : '—'}</span></span>
      {([['hardBytes', 'Объём, байт'], ['maxFileBytes', 'Файл, байт'], ['maxFiles', 'Файлов'], ['maxConcurrent', 'Параллельно']] as const).map(([k, l]) => <label key={k}>{l}<input type="number" disabled={!can} value={f[k]} onChange={(e) => set(k, e.target.value)} className="mt-0.5 block w-28 rounded-lg px-2 py-1 text-sm" style={field} /></label>)}
      {can && <Btn tone="plain" onClick={() => ask(async (code) => { const r = await call('PUT', '/quotas', { category: cat, hardBytes: f.hardBytes, maxFileBytes: f.maxFileBytes, maxFiles: f.maxFiles, maxConcurrent: f.maxConcurrent, stepUpCode: code }); flash(r.ok ? 'Сохранено' : errText(r.error)); onSaved(); })}>Сохранить</Btn>}
    </div>
  );
};

/* ═══════════ Журнал ═══════════ */
const Events = () => {
  const [level, setLevel] = useState(''); const [items, setItems] = useState<Data[] | null>(null);
  const load = useCallback(async () => { const r = await call('GET', `/events${level ? `?level=${level}` : ''}`); if (r.ok) setItems(r.data.items); else flash(errText(r.error)); }, [level]);
  useEffect(() => { void load(); }, [load]);
  return (
    <Card title="Журнал безопасности и операций">
      <div className="flex gap-2"><select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Уровень" className="rounded-lg px-2 py-1.5 text-sm" style={field}><option value="">Все</option><option value="info">info</option><option value="warn">warn</option><option value="critical">critical</option></select><Btn tone="plain" onClick={() => void load()}><RefreshCw size={12} /></Btn></div>
      {!items ? <Wait /> : items.map((e) => (
        <p key={e.id} className="text-[11px]" translate="no" style={{ color: e.level === 'critical' ? C.red : e.level === 'warn' ? C.amber : C.t3 }}>
          {dt(e.at)} · {e.level} · <b>{e.kind}</b>{e.by ? ` · @${e.by}` : ''} · {JSON.stringify(e.detail).slice(0, 160)}
        </p>))}
      <p className="text-[11px]" style={{ color: C.t3 }}>Действия администраторов дополнительно пишутся в общий журнал админки с цепочкой отпечатков (вкладка «Журнал»).</p>
    </Card>
  );
};

/* ═══════════ Вкладка ═══════════ */
export const StorageTab = ({ perms, owner }: { perms: string[]; owner: boolean }) => {
  const [gate, setGate] = useState<Data | null>(null); const [tab, setTab] = useState('state');
  const check = useCallback(async () => { const r = await call('GET', '/connection-status'); setGate(r.ok ? r.data : { allowed: false, status: r.error ?? 'error' }); }, []);
  useEffect(() => { void check(); const t = window.setInterval(() => { if (!document.hidden) void check(); }, 5000); return () => window.clearInterval(t); }, [check]);
  if (!gate) return <Wait />;
  if (!gate.allowed) return (
    <Card title="Подключение ждёт подтверждения" tone={C.amber}>
      <p className="flex items-center gap-2 text-[13px]" style={{ color: C.t2 }}><Lock size={14} />Это новое устройство для управления Sky Storage. Владелец получил запрос (и письмо, если не ответил). Пока он не подтвердит, доступа к данным нет; без ответа запрос закроется сам.</p>
      <p className="text-[12px]" style={{ color: C.t3 }}>Статус: {gate.status}{gate.pending?.expiresAt ? ` · действует до ${dt(gate.pending.expiresAt)}` : ''}</p>
    </Card>
  );
  const tabs = [{ k: 'state', l: 'Состояние и безопасность' }, { k: 'backups', l: 'Резервные копии' }, { k: 'conn', l: 'Подключения', hide: !perms.includes('storage_access') && !owner }, { k: 'quota', l: 'Квоты и пороги' }, { k: 'log', l: 'Журнал', hide: !perms.includes('storage_audit') }].filter((t) => !t.hide);
  return (
    <div className="space-y-3" data-storage-admin>
      <ScrollTabs>{tabs.map((t) => (
        <button key={t.k} type="button" onClick={() => setTab(t.k)} className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold" style={tab === t.k ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{t.l}</button>))}</ScrollTabs>
      {tab === 'state' && <Overview perms={perms} owner={owner} />}
      {tab === 'backups' && <Backups perms={perms} owner={owner} />}
      {tab === 'conn' && <Connections owner={owner} />}
      {tab === 'quota' && <Quotas perms={perms} />}
      {tab === 'log' && <Events />}
    </div>
  );
};
