/**
 * Вкладка «Sky Sandbox»: проверка сборки ДО публикации, отчёты, ручное одобрение публикации и откат.
 * Проверки выполняет раннер на хосте (sandbox/runner.mjs), вердикт считает сервер (server/sandbox.mjs).
 * Права: `sandbox` — просмотр и запуск проверок; `sandbox_publish` — одобрение публикации и откат (с кодом подтверждения).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, Play, RotateCw, X, Rocket, Undo2, ChevronDown, ChevronRight } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/sandbox';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', bad_sha: 'Нужен полный идентификатор коммита — 40 знаков (0–9, a–f).', queue_full: 'В очереди уже пять проверок — дождитесь их.',
  sha_mismatch: 'Идентификатор не совпал с проверенным.', not_publishable: 'Проверка не пройдена — публиковать нельзя.', not_checked: 'Проверка ещё не завершена.',
  isolation_required: 'Сборка проверялась без изоляции или по сокращённому профилю — публиковать нельзя. Повторите проверку на раннере с изоляцией.',
  warnings_not_accepted: 'Есть замечания — подтвердите, что прочитали их.', report_stale: 'Отчёт устарел — запустите проверку заново.', owner_required: 'Критичные изменения одобряет только владелец.',
  self_approval: 'Сборку, которую вы сами запустили, одобряет другой сотрудник (или владелец).', publication_in_progress: 'Другая публикация уже идёт.', build_not_found: 'Сборка не найдена.',
  nothing_to_roll_back: 'Нет сведений о прежней версии.', newer_deployed: 'После этой публикации выходили другие — откатывайте последнюю.', manual_restore_required: 'Нужно восстановление базы из резервной копии — это решает владелец.',
  confirm_schema: 'Подтвердите, что понимаете: база останется в новой схеме.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  too_many_requests: 'Слишком часто, подождите минуту.', not_cancellable: 'Уже нельзя отменить.', lockdown: 'Панель закрыта.',
};
const errText = (e?: string, hint?: string) => hint || (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (ms?: number) => (ms ? (ms >= 60000 ? `${Math.round(ms / 6000) / 10} мин` : `${Math.round(ms / 100) / 10} с`) : '');

const VERDICT: Record<string, { label: string; color: string; icon: ReactNode }> = {
  passed: { label: 'Проверка пройдена', color: C.green, icon: <ShieldCheck size={14} /> },
  warnings: { label: 'Есть замечания', color: C.amber, icon: <ShieldAlert size={14} /> },
  failed: { label: 'Проверка не пройдена', color: C.red, icon: <ShieldX size={14} /> },
  error: { label: 'Проверка не пройдена', color: C.red, icon: <ShieldX size={14} /> },
  queued: { label: 'В очереди', color: C.t3, icon: <Loader2 size={14} /> },
  running: { label: 'Выполняется', color: C.acc, icon: <Loader2 size={14} className="animate-spin" /> },
  cancelled: { label: 'Отменена', color: C.t3, icon: <X size={14} /> },
};
const PUB: Record<string, [string, string]> = { approved: ['ждёт раннера', C.amber], running: ['выполняется', C.acc], deployed: ['опубликовано', C.green], failed: ['сбой', C.red], rolled_back: ['код возвращён на прежнюю версию', C.amber], cancelled: ['отменена', C.t3] };
const CHK: Record<string, string> = { ok: C.green, warn: C.amber, fail: C.red, skip: C.t3, run: C.acc };
const CHK_LABEL: Record<string, string> = { ok: 'пройдена', warn: 'замечание', fail: 'не пройдена', skip: 'пропущена', run: 'идёт' };

const Badge = ({ s }: { s: string }) => { const v = VERDICT[s] ?? VERDICT.queued; return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'rgba(127,127,127,.12)', color: v.color }}>{v.icon}{v.label}</span>; };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);

const Report = ({ id }: { id: string }) => {
  const [b, setB] = useState<Data | null>(null); const [open, setOpen] = useState<string>('');
  useEffect(() => {
    let live = true;
    const load = async () => { const r = await apiCall<Data>(`${A}/builds/${id}`); if (live && r.ok) setB(r.data ?? null); };
    void load(); const iv = setInterval(visibleTick(load), 4000);
    return () => { live = false; clearInterval(iv); };
  }, [id]);
  if (!b) return <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
  const checks: Data[] = b.report?.checks ?? [];
  return (
    <div className="mt-2 space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
      {b.error && <p className="text-xs" style={{ color: C.red }}>{b.error}</p>}
      {(b.report?.reasons ?? []).map((r: string) => <p key={r} className="text-xs" style={{ color: C.amber }}>{r}</p>)}
      {b.critical && <p className="text-xs" style={{ color: C.amber }}>Критичные изменения одобряет только владелец.</p>}
      {b.critical && (b.critical_reasons ?? []).map((r: string) => <p key={r} className="text-[11px]" style={{ color: C.amber }}>{r}</p>)}
      {b.destructive && <p className="text-xs" style={{ color: C.red }}>В новых миграциях есть разрушающий SQL — откат кода без восстановления базы небезопасен.</p>}
      {!!b.report?.changed && <p className="text-xs" style={{ color: C.t3 }}>Изменено файлов: {b.report.changed}{b.report.baseSha ? ` · от ${String(b.report.baseSha).slice(0, 10)}` : ''}</p>}
      {checks.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Результатов пока нет.</p>}
      {checks.map((c) => (
        <div key={c.id}>
          <button type="button" className="flex w-full items-center gap-2 text-left text-xs" onClick={() => setOpen(open === c.id ? '' : c.id)}>
            {c.log ? (open === c.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
            <span className="font-bold" style={{ color: CHK[c.status] }}>{CHK_LABEL[c.status] ?? c.status}</span>
            <span style={{ color: C.t1 }}>{c.title}</span>
            <span className="ml-auto" style={{ color: C.t3 }}>{dur(c.ms)}</span>
          </button>
          {c.detail && <p className="ml-5 text-[11px]" style={{ color: C.t2 }} translate="no">{c.detail}</p>}
          {open === c.id && c.log && <pre className="ml-5 mt-1 max-h-60 overflow-auto rounded-lg p-2 text-[10px]" style={{ background: C.l1, color: C.t2 }} translate="no">{c.log}</pre>}
        </div>
      ))}
    </div>
  );
};

export const SandboxTab = () => {
  const [data, setData] = useState<Data | null>(null); const [failed, setFailed] = useState('');
  const [sha, setSha] = useState(''); const [ref, setRef] = useState(''); const [profile, setProfile] = useState('full'); const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState('');
  const [pub, setPub] = useState<Data | null>(null); const [accept, setAccept] = useState(false); const [note, setNote] = useState(''); const [code, setCode] = useState(''); const [method, setMethod] = useState('');
  const [rb, setRb] = useState<Data | null>(null); const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setData(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); const iv = setInterval(visibleTick(load), 6000); return () => clearInterval(iv); }, [load]);

  const start = async () => {
    setBusy(true);
    const r = await apiCall<Data>(`${A}/builds`, { method: 'POST', body: JSON.stringify({ sha: sha.trim().toLowerCase(), ref, profile }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error, r.data?.hint)); return; }
    flash('Проверка поставлена в очередь'); setSha(''); setRef(''); await load();
  };
  const act = async (id: string, what: 'rerun' | 'cancel') => {
    const r = await apiCall<Data>(`${A}/builds/${id}/${what}`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    flash(what === 'rerun' ? 'Проверка запущена заново' : 'Отменено'); await load();
  };
  const askCode = async () => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return false; }
    setMethod(String(r.data?.method ?? 'email')); setCode(''); return true;
  };
  const openPublish = async (b: Data) => { if (await askCode()) { setPub(b); setAccept(false); setNote(''); } };
  const openRollback = async (p: Data) => { if (await askCode()) { setRb(p); setConfirm(false); } };
  const doPublish = async () => {
    if (!pub) return; setBusy(true);
    const r = await apiCall<Data>(`${A}/publish`, { method: 'POST', body: JSON.stringify({ buildId: pub.id, sha: pub.sha, acceptWarnings: accept, note, stepUpCode: code }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error, r.data?.hint)); return; }
    flash('Публикация одобрена — раннер на сервере начнёт её в течение минуты'); setPub(null); await load();
  };
  const doRollback = async () => {
    if (!rb) return; setBusy(true);
    const r = await apiCall<Data>(`${A}/publications/${rb.id}/rollback`, { method: 'POST', body: JSON.stringify({ confirmSchema: confirm, stepUpCode: code }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error, r.data?.hint)); return; }
    flash('Откат кода запрошен'); setRb(null); await load();
  };
  const cancelPub = async (id: string) => { const r = await apiCall<Data>(`${A}/publications/${id}/cancel`, { method: 'POST', body: '{}' }); flash(r.ok ? 'Публикация отменена' : errText(r.error)); await load(); };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!data) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const builds: Data[] = data.builds ?? []; const pubs: Data[] = data.publications ?? []; const runners: Data[] = data.runners ?? [];
  const canPublish = Boolean(data.canPublish);
  const code6 = method === 'totp' ? 'Код из приложения-аутентификатора' : 'Код из письма';
  const modal = (children: ReactNode) => <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.55)' }}><div className="w-full max-w-md space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>{children}</div></div>;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-base font-bold" style={{ color: C.t1 }}>Sky Sandbox</h3>
        <p className="text-xs" style={{ color: C.t2 }}>Обновление проверяется в отдельной среде до публикации: сборка, миграции на временной копии, запуск и критические сценарии, секреты и зависимости. Боевая база и секреты проверке недоступны. Публикация — только вручную, после одобрения, с резервной копией и проверкой работы.</p>
        {!data.enabled && <p className="text-xs font-bold" style={{ color: C.amber }}>Sky Sandbox не настроен на сервере: задайте SANDBOX_SECRET и запустите раннер.</p>}
        {data.enabled && runners.length === 0 && <p className="text-xs" style={{ color: C.amber }}>Раннер пока не выходил на связь — проверки будут ждать в очереди.</p>}
        {runners.map((r) => <p key={r.runner} className="text-xs" style={{ color: r.online ? C.green : C.t3 }}><span translate="no">{r.runner}</span>: {r.online ? 'на связи' : 'не отвечает'} · {(r.caps ?? []).includes('deploy') ? 'проверки и публикация' : 'только проверки'} · {dt(r.seen)}</p>)}
        {data.lastDeployed && <p className="text-xs" style={{ color: C.t3 }}>Последняя публикация: <span translate="no">{String(data.lastDeployed.id)}</span>, {dt(data.lastDeployed.finished_at)}</p>}
      </div>

      <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="text-xs font-bold" style={{ color: C.t1 }}>Новая проверка</div>
        <input value={sha} onChange={(e) => setSha(e.target.value)} placeholder="Идентификатор коммита (40 знаков)" className="w-full rounded-xl px-3 py-2 text-xs" style={field} translate="no" />
        <div className="flex flex-wrap gap-2">
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ветка или заметка (необязательно)" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={field} />
          <select value={profile} onChange={(e) => setProfile(e.target.value)} className="rounded-xl px-3 py-2 text-xs" style={field}>
            <option value="full">Полный профиль</option><option value="quick">Быстрый (нельзя публиковать)</option>
          </select>
          <Btn onClick={() => void start()} disabled={busy || sha.trim().length !== 40}><Play size={12} />Запустить</Btn>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold" style={{ color: C.t1 }}>Сборки</div>
        {builds.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Проверок ещё не было.</p>}
        {builds.map((b) => (
          <div key={b.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge s={b.status} />
              <span className="text-xs font-bold" style={{ color: C.t1 }} translate="no">{String(b.sha).slice(0, 12)}</span>
              {b.ref && <span className="text-xs" style={{ color: C.t2 }} translate="no">{b.ref}</span>}
              <span className="text-[11px]" style={{ color: C.t3 }}><span>{b.profile === 'full' ? 'полный' : 'быстрый'}</span>{b.mode === 'isolated' && <span>{' · изолированная среда'}</span>}{b.mode && b.mode !== 'isolated' && <span>{' · без изоляции'}</span>}{b.critical && <span>{' · критично'}</span>}</span>
              <span className="ml-auto text-[11px]" style={{ color: C.t3 }}>{dt(b.created_at)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn tone="plain" onClick={() => setOpenId(openId === b.id ? '' : b.id)}>{openId === b.id ? 'Скрыть отчёт' : 'Отчёт'}</Btn>
              <Btn tone="plain" onClick={() => void act(b.id, 'rerun')}><RotateCw size={12} />Повторить</Btn>
              {(b.status === 'queued' || b.status === 'running') && <Btn tone="red" onClick={() => void act(b.id, 'cancel')}>Отменить</Btn>}
              {canPublish && (b.status === 'passed' || b.status === 'warnings') && <Btn onClick={() => void openPublish(b)}><Rocket size={12} />Опубликовать…</Btn>}
            </div>
            {openId === b.id && <Report id={b.id} />}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold" style={{ color: C.t1 }}>Публикации</div>
        {pubs.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Публикаций ещё не было.</p>}
        {pubs.map((p) => {
          const st = PUB[p.status] ?? [p.status, C.t3];
          return (
            <div key={p.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold" style={{ color: st[1] }}>{st[0]}</span>
                <span className="font-bold" style={{ color: C.t1 }}>{p.kind === 'rollback' ? 'Откат' : 'Публикация'}</span>
                <span translate="no" style={{ color: C.t1 }}>{String(p.sha).slice(0, 12)}</span>
                {p.critical && <span style={{ color: C.amber }}>критично</span>}
                <span className="ml-auto" style={{ color: C.t3 }}>{dt(p.created_at)}</span>
              </div>
              {(p.steps ?? []).map((s: Data) => <p key={s.id} className="mt-1 text-[11px]" style={{ color: C.t2 }}><span className="font-bold" style={{ color: CHK[s.status] }}>{CHK_LABEL[s.status] ?? s.status}</span> {s.title}{s.detail ? ` — ${s.detail}` : ''}</p>)}
              {p.outcome_note && <p className="mt-1 text-xs" style={{ color: C.t2 }}>{p.outcome_note}</p>}
              {p.backup_ref && <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Резервная копия: <span translate="no">{p.backup_ref}</span></p>}
              <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>{p.plan?.note}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.status === 'approved' && canPublish && <Btn tone="red" onClick={() => void cancelPub(p.id)}>Отменить</Btn>}
                {p.kind === 'deploy' && ['deployed', 'failed'].includes(p.status) && p.prev_sha && canPublish && p.plan?.auto && <Btn tone="plain" onClick={() => void openRollback(p)}><Undo2 size={12} />Откатить код…</Btn>}
              </div>
            </div>
          );
        })}
      </div>

      {pub && modal(<>
        <div className="text-sm font-bold" style={{ color: C.t1 }}>Опубликовать сборку</div>
        <p className="text-xs" style={{ color: C.t2 }}><span translate="no">{String(pub.sha).slice(0, 12)}</span> · <Badge s={pub.status} />{pub.critical ? ' · критичные изменения' : ''}</p>
        {pub.status === 'warnings' && <label className="flex items-start gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /><span>Я прочитал замечания в отчёте и согласен публиковать</span></label>}
        {pub.has_migrations && <p className="text-xs" style={{ color: C.amber }}>В сборке есть миграции базы: после публикации база будет в новой схеме.</p>}
        <p className="text-xs" style={{ color: C.t3 }}>Перед публикацией раннер сделает резервную копию, после — проверит работу сервера и при сбое вернёт прежний код.</p>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка (необязательно)" className="w-full rounded-xl px-3 py-2 text-xs" style={field} />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={code6} inputMode="numeric" className="w-full rounded-xl px-3 py-2 text-xs" style={field} />
        <div className="flex justify-end gap-2"><Btn tone="plain" onClick={() => setPub(null)}>Отмена</Btn><Btn onClick={() => void doPublish()} disabled={busy || code.length < 6 || (pub.status === 'warnings' && !accept)}>Одобрить публикацию</Btn></div>
      </>)}

      {rb && modal(<>
        <div className="text-sm font-bold" style={{ color: C.t1 }}>Откатить код на прежнюю версию</div>
        <p className="text-xs" style={{ color: C.t2 }} translate="no">{`Вернётся версия ${String(rb.prev_sha).slice(0, 12)}. База данных не откатывается.`}</p>
        {rb.has_migrations && <label className="flex items-start gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>Миграции только добавляли данные: прежний код работает с новой схемой. Я понимаю, что база останется новой</span></label>}
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={code6} inputMode="numeric" className="w-full rounded-xl px-3 py-2 text-xs" style={field} />
        <div className="flex justify-end gap-2"><Btn tone="plain" onClick={() => setRb(null)}>Отмена</Btn><Btn tone="red" onClick={() => void doRollback()} disabled={busy || code.length < 6 || (rb.has_migrations && !confirm)}>Запросить откат</Btn></div>
      </>)}
    </div>
  );
};
