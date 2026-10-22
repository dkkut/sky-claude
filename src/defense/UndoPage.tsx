/**
 * Страница отмены защитных действий: /defense-undo?t=… (ссылка из письма «Sky: сработала самозащита», отдельный verify.html, без входа).
 * Открытие ссылки ничего не отменяет: сначала список того, что сделала защита; отмена — по кнопке и коду из аутентификатора владельца.
 * Сервер: server/selfdefense.mjs (inspectUndo/confirmUndo), /api/defense/undo/*.
 */
import { useEffect, useRef, useState } from 'react';
import { Shield, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

type Act = { id: string; label: string; target: string; status: string; reversible: boolean; error?: string };
interface Info { incident: { title: string; severity: string; status: string; drill: boolean; createdAt: string }; events: { label: string; ip: string; at: string }[]; actions: Act[] }
const ST: Record<string, string> = { done: 'выполнено', simulated: 'учебное', skipped: 'не выполнялось', failed: 'не вышло', undone: 'отменено' };
const ERR: Record<string, string> = {
  bad_code: 'Код не подошёл.', locked: 'Слишком много неверных кодов. Подождите 15 минут.', invalid_link: 'Ссылка недействительна или устарела.',
  two_factor_required: 'У владельца не включён аутентификатор — отмена по ссылке недоступна. Отмените в админке.', owner_missing: 'Владелец не найден.', too_many_requests: 'Слишком часто, подождите минуту.',
};
const fmt = (iso: string) => new Date(iso).toLocaleString();

export const DefenseUndoPage = () => {
  const token = useRef(new URLSearchParams(location.search).get('t') ?? '');
  const [info, setInfo] = useState<Info | null>(null);
  const [phase, setPhase] = useState<'loading' | 'gone' | 'ready' | 'done'>('loading');
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [falseAlarm, setFalseAlarm] = useState(true); const [pick, setPick] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    try { history.replaceState(null, '', location.pathname); } catch { /* не критично */ }
    void apiCall<Info>(`/api/defense/undo/info?t=${encodeURIComponent(token.current)}`).then((r) => {
      if (r.ok && r.data) { setInfo(r.data); setPhase('ready'); setPick(Object.fromEntries(r.data.actions.filter((a) => ['done', 'simulated'].includes(a.status) && (a.reversible || a.status === 'simulated')).map((a) => [a.id, true]))); } else setPhase('gone');
    });
  }, []);

  const undo = async () => {
    setBusy(true); setErr('');
    const ids = Object.entries(pick).filter(([, v]) => v).map(([k]) => k);
    const r = await apiCall<{ results: { ok?: boolean }[] }>('/api/defense/undo/confirm', { method: 'POST', body: JSON.stringify({ t: token.current, code: code.trim(), actionIds: ids, falseAlarm }) });
    setBusy(false);
    if (!r.ok) { setErr(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? 'ошибка'})`); return; }
    setPhase('done');
  };

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'var(--bg-l0, #0b0b10)', color: 'var(--t1, #fff)' }}>
      <div className="w-full max-w-md space-y-4 rounded-2xl p-5" style={{ background: 'var(--bg-l1, #15151c)', border: '1px solid var(--border, #2a2a35)' }}>{children}</div>
    </div>);

  if (phase === 'loading') return shell(<Loader2 className="mx-auto animate-spin" size={22} />);
  if (phase === 'gone') return shell(<><ShieldAlert size={26} style={{ color: 'var(--red, #ef4444)' }} /><p className="text-sm">Ссылка недействительна или срок её действия вышел. Отменить действия защиты можно в админке: «Самозащита».</p></>);
  if (phase === 'done') return shell(<><ShieldCheck size={26} style={{ color: 'var(--green, #22c55e)' }} /><p className="text-sm font-bold">Готово: выбранные действия защиты отменены.</p><p className="text-xs opacity-70">Если тревога окажется настоящей, защита сработает снова.</p></>);
  const open = info!.actions.filter((a) => ['done', 'simulated'].includes(a.status));
  return shell(<>
    <div className="flex items-center gap-2"><Shield size={22} style={{ color: 'var(--accent, #7c5cff)' }} /><b className="text-base">Самозащита Sky</b></div>
    {info!.incident.drill && <p className="rounded-lg p-2 text-xs" style={{ background: 'rgba(245,158,11,.15)' }}>Это учебная тревога — реальных действий не было.</p>}
    <div className="text-sm"><b>{info!.incident.title}</b><div className="text-xs opacity-70">{fmt(info!.incident.createdAt)} · важность: {info!.incident.severity}</div></div>
    {info!.events.length > 0 && <ul className="space-y-1 text-xs opacity-80">{info!.events.map((e, i) => <li key={i}>• {e.label}{e.ip ? ` · ${e.ip}` : ''} · {fmt(e.at)}</li>)}</ul>}
    <div className="space-y-1.5">
      <div className="text-xs font-bold opacity-70">Что сделала защита</div>
      {info!.actions.length === 0 && <p className="text-xs opacity-70">Действий не было — только запись.</p>}
      {info!.actions.map((a) => {
        const can = ['done', 'simulated'].includes(a.status) && (a.reversible || a.status === 'simulated');
        return <label key={a.id} className="flex items-start gap-2 text-sm">
          <input type="checkbox" disabled={!can} checked={Boolean(pick[a.id])} onChange={(e) => setPick({ ...pick, [a.id]: e.target.checked })} className="mt-1" />
          <span>{a.label}{a.target && a.target !== a.label ? ` — ${a.target}` : ''}<span className="ml-1 text-xs opacity-60">({ST[a.status] ?? a.status}{a.status === 'done' && !a.reversible ? ', необратимо' : ''})</span></span></label>;
      })}
    </div>
    {open.length > 0 ? <>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={falseAlarm} onChange={(e) => setFalseAlarm(e.target.checked)} /> Пометить как ложную тревогу</label>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" placeholder="Код из аутентификатора" className="w-full rounded-xl px-3 py-2 text-center text-lg tracking-widest" style={{ background: 'var(--bg-l2, #1d1d27)', border: '1px solid var(--border, #2a2a35)', color: 'inherit' }} />
      {err && <p className="text-xs" style={{ color: 'var(--red, #ef4444)' }}>{err}</p>}
      <button type="button" disabled={busy || code.length < 6 || !Object.values(pick).some(Boolean)} onClick={undo} className="w-full rounded-xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent, #7c5cff)', color: '#fff' }}>{busy ? 'Проверяю…' : 'Отменить выбранное'}</button>
      <p className="text-[11px] opacity-60">Если тревога настоящая — ничего не нажимайте: защита уже работает.</p>
    </> : <p className="text-xs opacity-70">Отменять нечего: все действия уже сняты или необратимы.</p>}
  </>);
};
