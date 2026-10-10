/**
 * Админ-панель Sky Blox. Кнопки рисуются по правам, которые сообщил
 * сервер, но каждое действие он проверяет заново и пишет в журнал:
 *   blox            — игры, серверы, разработчики, ограничения, мониторинг;
 *   blox_moderation — очередь проверки, жалобы, апелляции;
 *   blox_finance    — покупки и возвраты, начисления, выплаты (с подтверждением личности).
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { C, Alert, StatusBadge, errText, fmtDt, fmtN, inputStyle } from './ui';
import * as A from './bloxApi';

const card = { background: C.l1, border: `1px solid ${C.brd}` } as const;
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: on ? C.acc : C.l2, color: on ? '#fff' : C.t3 }}>{children}</button>
);
const Wait = () => <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;

/** Поле причины и кнопки действий. */
const Actions = ({ actions, onRun, placeholder = 'Комментарий / причина решения', extra }: {
  actions: { key: string; label: string; tone?: 'ok' | 'bad' }[]; onRun: (key: string, text: string) => Promise<string | null>; placeholder?: string; extra?: React.ReactNode;
}) => {
  const [text, setText] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (k: string) => { setBusy(true); setMsg(''); const e = await onRun(k, text.trim()); setBusy(false); if (e) setMsg(e); else setText(''); };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} placeholder={placeholder} className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      {extra}
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => <button key={a.key} type="button" disabled={busy} onClick={() => void run(a.key)} className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40" style={{ background: a.tone === 'ok' ? C.green : a.tone === 'bad' ? C.red : C.l2, color: a.tone ? '#fff' : C.t1 }}>{a.label}</button>)}
      </div>
      {msg && <p className="text-[11px]" style={{ color: C.red }}>{msg}</p>}
    </div>
  );
};

/** Подтверждение личности: код из приложения или письма. */
const StepUp = ({ onCode, onCancel }: { onCode: (c: string) => void; onCancel: () => void }) => {
  const [method, setMethod] = useState<string | null>(null); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  useEffect(() => { void A.apiAdminStepUp().then((r) => { setBusy(false); if (r.ok) setMethod(r.data.method ?? 'email'); else setErr(errText(r)); }); }, []);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Подтвердите личность</p>
      {busy && <Wait />}{err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {method && <p className="text-[11px]" style={{ color: C.t3 }}>{method === 'app' ? 'Код из приложения двухэтапной защиты.' : 'Код отправлен на почту, действует пять минут.'}</p>}
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" className="flex-1 rounded-lg px-3 py-2 text-[13px] tracking-widest" style={inputStyle} />
        <button type="button" disabled={code.length < 6} onClick={() => onCode(code)} className="rounded-lg px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Подтвердить</button>
      </div>
      <button type="button" onClick={onCancel} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
    </div>
  );
};

/* ── Игры и серверы ──────────────────────────────────────────────── */

const GamesTab = () => {
  const [items, setItems] = useState<Awaited<ReturnType<typeof A.apiAdminGames>> | null>(null);
  const [q, setQ] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => setItems(await A.apiAdminGames(q.trim() || undefined)), [q]);
  useEffect(() => { void load(); }, [load]);
  const probe = async (id: string) => { setBusy(id); const r = await A.apiAdminProbe(id); setBusy(''); setMsg(r.ok ? (r.data.ok ? 'Сервер доступен.' : r.data.checks.filter((c) => !c.ok).map((c) => c.message).join(' ')) : errText(r)); void load(); };
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      {msg && <Alert kind="info" text={msg} />}
      {!items ? <Wait /> : !items.ok ? <Alert text={errText(items)} /> : items.data.items.map((g) => (
        <div key={g.id} className="space-y-1 rounded-2xl p-3" style={card}>
          <div className="flex items-center gap-2"><p className="flex-1 truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{g.title}</p><StatusBadge status={g.status} /></div>
          <p className="text-[11px]" style={{ color: C.t3 }}><span translate="no">{g.developerName}</span> · {g.hosting} · запусков {fmtN(g.launches)}</p>
          <p className="break-all font-mono text-[10px]" style={{ color: C.t3 }} translate="no">{g.clientUrl || '—'} {g.serverUrl && `· ${g.serverUrl}`}</p>
          <div className="flex items-center gap-2"><span className="text-[11px] font-bold" style={{ color: g.connStatus === 'ok' ? C.green : g.connStatus === 'failed' ? C.red : C.t3 }}>{({ ok: 'сервер доступен', failed: 'ошибка', unconfigured: 'не проверялся', checking: 'проверяется' } as Record<string, string>)[g.connStatus]}</span>
            {g.checkedAt && <span className="text-[10px]" style={{ color: C.t3 }}>{fmtDt(g.checkedAt)}</span>}
            <button type="button" disabled={busy === g.id} onClick={() => void probe(g.id)} className="ml-auto flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.acc }}><RefreshCw size={11} /> Проверить</button></div>
          {g.connError && <p className="text-[11px]" style={{ color: C.red }} translate="no">{g.connError}</p>}
        </div>
      ))}
    </div>
  );
};

/* ── Модерация ───────────────────────────────────────────────────── */

const ModDetail = ({ type, id, onBack, onChanged }: { type: 'game' | 'place'; id: string; onBack: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminModDetail>> | null>(null);
  const load = useCallback(async () => setD(await A.apiAdminModDetail(type, id)), [type, id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Wait />;
  if (!d.ok) return <Alert text={errText(d)} />;
  const g = d.data.game; const p = d.data.place;
  const run = async (k: string, t: string) => { const r = await A.apiAdminModerate(type, id, k, t); if (!r.ok) return errText(r); await load(); onChanged(); return null; };
  const findings = (type === 'game' ? g?.autoFindings : p?.autoFindings) ?? [];
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К очереди</button>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <div className="flex items-center gap-2"><p className="flex-1 text-[14px] font-bold" style={{ color: C.t1 }} translate="no">{(type === 'game' ? g?.title : p?.title)}</p><StatusBadge status={(type === 'game' ? g?.moderationStatus : p?.moderationStatus)} /></div>
        <p className="whitespace-pre-wrap text-[12px]" style={{ color: C.t2 }} translate="no">{type === 'game' ? g?.description : p?.description}</p>
        {g && <p className="text-[11px]" style={{ color: C.t3 }} translate="no">Разработчик: {g.developerName} · {g.hostingType} · {g.clientUrl} {g.serverUrl && `· ${g.serverUrl}`}</p>}
        {g && <p className="text-[11px]" style={{ color: g.connStatus === 'ok' ? C.green : C.red }}>Соединение: {g.connStatus}{g.connError ? ` — ${g.connError}` : ''}</p>}
        {p && <p className="text-[11px]" style={{ color: C.t3 }} translate="no">Путь запуска: {p.entryPath} · игроков до {p.maxPlayers} · {p.minAge}+</p>}
        {(d.data.openReports ?? 0) > 0 && <p className="text-[11px] font-bold" style={{ color: C.red }}>Открытых жалоб: {d.data.openReports}</p>}
      </div>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Автоматические проверки</p>
        {findings.length === 0 ? <p className="text-[11px]" style={{ color: C.t3 }}>Замечаний нет.</p> : findings.map((f, i) => <p key={i} className="text-[11px]" style={{ color: f.severity === 'high' ? C.red : C.amber }}>• {f.message}</p>)}
        <p className="text-[10px]" style={{ color: C.t3 }}>{d.data.note ?? 'Автоматические проверки — подсказка; отсутствие замечаний не означает, что содержимое проверено. Просмотрите страницу игры, обложку и описание вручную.'}</p>
      </div>
      <div className="rounded-2xl p-3" style={card}>
        <Actions onRun={run} actions={[{ key: 'approve', label: 'Одобрить', tone: 'ok' }, { key: 'request_changes', label: 'Запросить исправления' }, { key: 'hide', label: 'Скрыть' }, { key: 'block', label: 'Заблокировать', tone: 'bad' }, { key: 're_review', label: 'На повторную проверку' }]} />
        <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>Свой проект одобрять нельзя. Причина обязательна для исправлений, скрытия и блокировки.</p>
      </div>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История решений</p>
        {d.data.history.map((h, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(h.at)} · {h.by} · {h.action}{h.reason && <span style={{ color: C.t3 }} translate="no"> · {h.reason}</span>}</p>)}
      </div>
    </div>
  );
};

const ModerationTab = () => {
  const [type, setType] = useState<'game' | 'place'>('game'); const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<A.QueueRow[] | null>(null); const [err, setErr] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await A.apiAdminQueue(status, type); if (r.ok) { setItems(r.data.items); setErr(''); } else { setItems([]); setErr(errText(r)); } }, [status, type]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <ModDetail type={type} id={open} onBack={() => setOpen(null)} onChanged={() => void load()} />;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <Chip on={type === 'game'} onClick={() => setType('game')}>Игры</Chip><Chip on={type === 'place'} onClick={() => setType('place')}>Плейсы</Chip>
        {([['pending', 'На проверке'], ['needs_changes', 'Ждут исправлений'], ['approved', 'Одобренные'], ['published', 'Опубликованные'], ['hidden', 'Скрытые'], ['blocked', 'Заблокированные'], ['all', 'Все']] as const).map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}
      </div>
      {err && <Alert text={err} />}
      {items === null ? <Wait /> : items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Очередь пуста.</p> : items.map((r) => (
        <button key={r.id} type="button" onClick={() => setOpen(r.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <div className="flex items-center gap-2"><p className="flex-1 truncate text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{r.title}{r.gameTitle ? ` · ${r.gameTitle}` : ''}</p><StatusBadge status={r.status} /></div>
          <p className="text-[11px]" style={{ color: C.t3 }}><span translate="no">{r.developerName}</span> · соединение: {r.connStatus} · {fmtDt(r.submittedAt)}{r.findings?.length ? ` · замечаний автопроверки: ${r.findings.length}` : ''}</p>
        </button>
      ))}
    </div>
  );
};

/* ── Жалобы и апелляции ──────────────────────────────────────────── */

const ReportsTab = () => {
  const [reports, setReports] = useState<A.ReportRow[] | null>(null); const [appeals, setAppeals] = useState<A.AppealRow[] | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [r, a] = await Promise.all([A.apiAdminReports('open'), A.apiAdminAppeals('open')]);
    if (r.ok) setReports(r.data.items); else { setReports([]); setErr(errText(r)); }
    setAppeals(a.ok ? a.data.items : []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-3">
      {err && <Alert text={err} />}
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Жалобы (по приоритету)</p>
      {reports === null ? <Wait /> : reports.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Открытых жалоб нет.</p> : reports.map((r) => (
        <div key={r.id} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{r.gameTitle ?? r.developerName ?? r.targetId} · {r.targetType}</p>
          <p className="text-[11px]" style={{ color: r.priority === 3 ? C.red : C.t3 }}>{A.REPORT_LABEL[r.reason] ?? r.reason} · приоритет {r.priority} · {fmtDt(r.createdAt)}</p>
          {r.details && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{r.details}</p>}
          <Actions onRun={async (k, t) => { const [outcome, apply] = k.split(':'); const x = await A.apiAdminResolve(r.id, outcome, t, apply); if (!x.ok) return errText(x); await load(); return null; }}
            actions={[{ key: 'in_review', label: 'В работу' }, { key: 'dismissed', label: 'Отклонить' }, { key: 'upheld', label: 'Подтвердить' }, ...(r.targetType === 'game' || r.targetType === 'place' ? [{ key: 'upheld:hide', label: 'Подтвердить и скрыть' }, { key: 'upheld:block', label: 'Подтвердить и заблокировать', tone: 'bad' as const }] : []), ...(r.targetType === 'review' ? [{ key: 'upheld:hide', label: 'Скрыть отзыв' }] : [])]} />
        </div>
      ))}
      <p className="pt-2 text-[12px] font-bold" style={{ color: C.t1 }}>Апелляции</p>
      {appeals?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Открытых апелляций нет.</p>}
      {appeals?.map((a) => (
        <div key={a.id} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{a.developerName} · {a.subjectType}</p>
          <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{a.text}</p>
          <p className="text-[10px]" style={{ color: C.t3 }}>Решение обжалуется у другого модератора, не принимавшего исходное.</p>
          <Actions onRun={async (k, t) => { const x = await A.apiAdminDecide(a.id, k === 'accept', t); if (!x.ok) return errText(x); await load(); return null; }} actions={[{ key: 'accept', label: 'Принять', tone: 'ok' }, { key: 'reject', label: 'Отклонить', tone: 'bad' }]} />
        </div>
      ))}
    </div>
  );
};

/* ── Разработчики ────────────────────────────────────────────────── */

const DevelopersTab = () => {
  const [items, setItems] = useState<Awaited<ReturnType<typeof A.apiAdminDevelopers>> | null>(null);
  const load = useCallback(async () => setItems(await A.apiAdminDevelopers()), []);
  useEffect(() => { void load(); }, [load]);
  if (!items) return <Wait />;
  if (!items.ok) return <Alert text={errText(items)} />;
  return (
    <div className="space-y-2">
      {items.data.items.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Разработчиков пока нет.</p>}
      {items.data.items.map((d) => (
        <div key={d.id} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[13px] font-semibold" style={{ color: C.t1 }} translate="no">{d.displayName} <span style={{ color: C.t3 }}>@{d.username}</span></p>
          <p className="text-[11px]" style={{ color: d.status === 'suspended' ? C.red : C.t3 }}>{d.status === 'suspended' ? `приостановлен: ${d.suspendReason}` : 'активен'} · проектов {d.games} · жалоб {d.openReports} · уровень доверия {d.trustLevel}</p>
          <Actions onRun={async (k, t) => {
            const body = k === 'suspend' ? { status: 'suspended', reason: t } : k === 'resume' ? { status: 'active', reason: t } : { trustLevel: Number(k.split(':')[1]), reason: t };
            const r = await A.apiAdminSetDeveloper(d.id, body); if (!r.ok) return errText(r); await load(); return null;
          }} actions={[d.status === 'suspended' ? { key: 'resume', label: 'Возобновить' } : { key: 'suspend', label: 'Приостановить', tone: 'bad' as const }, { key: 'trust:0', label: 'Доверие 0' }, { key: 'trust:1', label: 'Доверие 1 (×2 квоты)' }, { key: 'trust:2', label: 'Доверие 2 (×4)' }]} />
        </div>
      ))}
    </div>
  );
};

/* ── Покупки и вознаграждения ────────────────────────────────────── */

const PurchasesTab = ({ finance }: { finance: boolean }) => {
  const [status, setStatus] = useState(''); const [items, setItems] = useState<Awaited<ReturnType<typeof A.apiAdminPurchases>> | null>(null);
  const load = useCallback(async () => setItems(await A.apiAdminPurchases(status || undefined)), [status]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>{([['', 'Все'], ['paid', 'Оплачены'], ['fulfilled', 'Выданы'], ['refunded', 'Возвраты'], ['pending', 'Ждут'], ['expired', 'Истекли']] as const).map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}</div>
      {!items ? <Wait /> : !items.ok ? <Alert text={errText(items)} /> : items.data.items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Покупок нет.</p> : items.data.items.map((p) => (
        <div key={p.id} className="space-y-1 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title} · {p.gameTitle} · @{p.username}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{p.status} · {p.price ?? '—'} баллов · разработчику {p.devPoints ?? '—'} (комиссия {p.commissionPct ?? '—'}%) · {fmtDt(p.createdAt)}{p.refundReason ? ` · ${p.refundReason}` : ''}</p>
          {finance && ['paid', 'fulfilled'].includes(p.status) && <Actions onRun={async (_k, t) => { const r = await A.apiAdminRefund(p.id, t); if (!r.ok) return errText(r); await load(); return null; }} actions={[{ key: 'refund', label: 'Вернуть баллы игроку', tone: 'bad' }]} placeholder="Причина возврата (обязательно)" />}
        </div>
      ))}
    </div>
  );
};

const EarningsTab = ({ finance }: { finance: boolean }) => {
  const [items, setItems] = useState<Awaited<ReturnType<typeof A.apiAdminEarnings>> | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminDevFinance>> | null>(null); const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [step, setStep] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => { void A.apiAdminEarnings().then(setItems); }, []);
  useEffect(() => { if (sel && finance) void A.apiAdminDevFinance(sel).then(setD); }, [sel, finance]);
  const adjust = async (code: string) => { const r = await A.apiAdminAdjust(sel!, { amount: Number(amount), reason, stepUpCode: code }); setStep(false); setMsg(r.ok ? 'Корректировка записана.' : errText(r)); if (r.ok) { setAmount(''); setReason(''); void A.apiAdminDevFinance(sel!).then(setD); } };
  return (
    <div className="space-y-2">
      {!items ? <Wait /> : !items.ok ? <Alert text={errText(items)} /> : items.data.items.map((e) => (
        <button key={e.developerId} type="button" onClick={() => setSel(e.developerId)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{e.displayName} @{e.username}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>начислено {e.accrued} · удержано {e.held} · комиссия {e.commission} · оборот {e.gross}</p>
        </button>
      ))}
      {sel && finance && d && d.ok && (
        <div className="space-y-2 rounded-2xl p-3" style={{ ...card, border: `1px solid ${C.acc}` }}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Баланс: доступно {d.data.balances.available} · резерв {d.data.balances.reserved} · выплачено {d.data.balances.paid} · удержание {d.data.balances.held}</p>
          <div className="space-y-1">{d.data.earnings.slice(0, 15).map((e) => <p key={e.id} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(e.at)} · {e.kind} · {e.amount > 0 ? '+' : ''}{e.amount} · <span translate="no">{e.note}</span></p>)}</div>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Корректировка начисления (журнал + подтверждение личности)</p>
          <div className="flex gap-2"><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="±баллы" className="w-28 rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} /><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (обязательно)" className="flex-1 rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} /></div>
          {!step ? <button type="button" disabled={!amount || reason.trim().length < 5} onClick={() => setStep(true)} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Применить</button> : <StepUp onCode={(c) => void adjust(c)} onCancel={() => setStep(false)} />}
          {msg && <p className="text-[11px]" style={{ color: C.t2 }}>{msg}</p>}
        </div>
      )}
    </div>
  );
};

/* ── Выплаты ─────────────────────────────────────────────────────── */

const PayoutDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminPayout>> | null>(null);
  const [ref, setRef] = useState(''); const [paidAt, setPaidAt] = useState(''); const [pending, setPending] = useState<{ key: string; text: string } | null>(null); const [msg, setMsg] = useState('');
  const load = useCallback(async () => setD(await A.apiAdminPayout(id)), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Wait />;
  if (!d.ok) return <Alert text={errText(d)} />;
  const p = d.data.payout; const b = d.data.balances;
  const exec = async (key: string, text: string, code?: string) => {
    const r = await A.apiAdminPayoutAction(id, key, { comment: text, paidRef: ref, paidAt: paidAt ? new Date(paidAt).toISOString() : undefined, stepUpCode: code });
    if (!r.ok) return errText(r) + (r.data?.confirmed !== undefined ? ` (подтверждено ${r.data.confirmed})` : '');
    setPending(null); setMsg('Готово.'); await load(); onChanged(); return null;
  };
  const run = async (key: string, text: string) => { if (key === 'paid') { setPending({ key, text }); return null; } return exec(key, text); };
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К списку</button>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[14px] font-bold" style={{ color: C.t1 }}>{p.amount.toLocaleString('ru-RU')} баллов · {({ draft: 'черновик', review: 'на рассмотрении', needs_info: 'ждёт уточнений', approved: 'одобрена', processing: 'в обработке', paid: 'выплачена', rejected: 'отклонена', cancelled: 'отменена' } as Record<string, string>)[p.status]}</p>
        {d.data.requisites && <p className="text-[12px]" style={{ color: C.t1 }} translate="no">Реквизиты: {d.data.requisites.method} · {d.data.requisites.holder} · {d.data.requisites.account} {d.data.requisites.bank}</p>}
        <p className="text-[10px]" style={{ color: C.t3 }}>Открытие реквизитов записано в журнал.</p>
        <p className="text-[11px]" style={{ color: C.t2 }}>Баланс разработчика: подтверждено {b.confirmed} · резерв {b.reserved} · выплачено {b.paid} · удержано {b.held} · доступно {b.available}</p>
      </div>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Связанные начисления</p>
        {d.data.earnings.slice(0, 20).map((e, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(e.at)} · {e.kind} · {e.amount > 0 ? '+' : ''}{e.amount} (комиссия {e.commission}) · доступно с {fmtDt(e.availableAt)}</p>)}
      </div>
      {!['paid', 'rejected', 'cancelled', 'draft'].includes(p.status) && (
        <div className="space-y-2 rounded-2xl p-3" style={card}>
          {p.status === 'processing' && (
            <div className="grid grid-cols-2 gap-2">
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ID платёжной операции / документ" className="rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} />
              <input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="rounded-lg px-2 py-1.5 text-[12px]" style={inputStyle} />
            </div>
          )}
          {pending ? <StepUp onCode={(c) => void exec(pending.key, pending.text, c).then((e) => e && setMsg(e))} onCancel={() => setPending(null)} /> : (
            <Actions onRun={run} actions={[
              ...(p.status === 'review' ? [{ key: 'approve', label: 'Одобрить (это ещё не выплата)', tone: 'ok' as const }] : []),
              ...(p.status === 'approved' ? [{ key: 'start', label: 'Перевести в обработку' }] : []),
              ...(p.status === 'processing' ? [{ key: 'paid', label: 'Зафиксировать выплату', tone: 'ok' as const }] : []),
              ...(['review', 'approved'].includes(p.status) ? [{ key: 'request_info', label: 'Запросить уточнения' }] : []),
              { key: 'reject', label: 'Отклонить (резерв снимется)', tone: 'bad' as const },
            ]} />
          )}
          <p className="text-[10px]" style={{ color: C.t3 }}>Деньги платформа не переводит: выплатите вручную вне Sky и зафиксируйте факт — с идентификатором операции и подтверждением личности. Перед фиксацией сумма перепроверяется по начислениям.</p>
          {msg && <p className="text-[11px]" style={{ color: msg === 'Готово.' ? C.green : C.red }}>{msg}</p>}
        </div>
      )}
      {p.status === 'paid' && <p className="text-[12px]" style={{ color: C.green }}>Выплата зафиксирована {fmtDt(p.paidAt)} · <span translate="no">{p.paidRef}</span></p>}
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История</p>
        {d.data.history.map((h, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtDt(h.at)} · {h.by} · {h.action}{h.comment && <span style={{ color: C.t3 }} translate="no"> · {h.comment}</span>}</p>)}
      </div>
    </div>
  );
};

const PayoutsTab = () => {
  const [status, setStatus] = useState('review'); const [items, setItems] = useState<Awaited<ReturnType<typeof A.apiAdminPayouts>> | null>(null); const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => setItems(await A.apiAdminPayouts(status)), [status]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <PayoutDetail id={open} onBack={() => setOpen(null)} onChanged={() => void load()} />;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>{([['review', 'Новые'], ['needs_info', 'Ждут уточнений'], ['approved', 'Одобрены'], ['processing', 'В обработке'], ['paid', 'Выплачены'], ['rejected', 'Отклонены'], ['all', 'Все']] as const).map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}</div>
      {!items ? <Wait /> : !items.ok ? <Alert text={errText(items)} /> : items.data.items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Заявок нет.</p> : items.data.items.map((p) => (
        <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{p.developerName} @{p.username} · {p.amount.toLocaleString('ru-RU')} баллов</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{p.status} · …{p.requisitesTail} · {fmtDt(p.submittedAt)}</p>
        </button>
      ))}
    </div>
  );
};

/* ── Ограничения ─────────────────────────────────────────────────── */

const LimitsTab = ({ can }: { can: (p: string) => boolean }) => {
  const [rows, setRows] = useState<A.LimitRow[] | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<{ key: string; value: number } | null>(null);
  const load = useCallback(async () => { const r = await A.apiAdminLimits(); if (r.ok) setRows(r.data.items); else { setRows([]); setErr(errText(r)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const FIN = ['commissionPercent', 'holdDays', 'minPayoutPoints', 'payoutsEnabled'];
  const save = async (key: string, value: number, code?: string) => { const r = await A.apiAdminSetLimit(key, value, code); setPending(null); setMsg(r.ok ? 'Сохранено.' : errText(r)); void load(); };
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>Ограничения действуют на сервере. Финансовые параметры (комиссия, удержание, минимум выплаты, приём заявок) меняет только финансовый сотрудник с подтверждением личности.</p>
      {err && <Alert text={err} />}{msg && <Alert kind="info" text={msg} />}
      {pending && <StepUp onCode={(c) => void save(pending.key, pending.value, c)} onCancel={() => setPending(null)} />}
      {!rows ? <Wait /> : rows.map((r) => {
        const fin = FIN.includes(r.key); const allowed = fin ? can('blox_finance') : can('blox');
        return (
          <div key={r.key} className="flex items-center gap-2 rounded-xl px-3 py-2" style={card}>
            <div className="min-w-0 flex-1"><p className="text-[12px]" style={{ color: C.t1 }}>{r.label}</p><p className="text-[10px]" style={{ color: C.t3 }}>по умолчанию {r.default} · допустимо {r.min}–{r.max}{fin ? ' · финансовый параметр' : ''}</p></div>
            <input defaultValue={r.value} key={r.value} disabled={!allowed} inputMode="numeric" className="w-24 rounded-lg px-2 py-1 text-right text-[12px] disabled:opacity-50" style={inputStyle}
              onBlur={(e) => { const n = Number(e.target.value); if (!Number.isInteger(n) || n === r.value) return; if (fin) setPending({ key: r.key, value: n }); else void save(r.key, n); }} />
          </div>
        );
      })}
    </div>
  );
};

/* ── Мониторинг ──────────────────────────────────────────────────── */

const gb = (n: number) => `${(n / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} МБ`;

const MonitorTab = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminMetrics>> | null>(null);
  const load = useCallback(async () => setD(await A.apiAdminMetrics()), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10000); return () => clearInterval(t); }, [load]);
  if (!d) return <Wait />;
  if (!d.ok) return <Alert text={errText(d)} />;
  const m = d.data.metrics;
  const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between text-[12px]"><span style={{ color: C.t3 }}>{l}</span><span style={{ color: C.t1 }}>{v}</span></div>;
  return (
    <div className="space-y-3">
      {d.data.warnings.map((w, i) => <Alert key={i} text={w.text} kind={w.level === 'critical' ? 'error' : 'info'} />)}
      <p className="text-[12px] font-bold" style={{ color: m.level === 2 ? C.red : m.level === 1 ? C.amber : C.green }}>Состояние: {['нормально', 'повышенная нагрузка', 'критическая нагрузка'][m.level]} · обновляется каждые 10 с</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1 rounded-2xl p-3" style={card}><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Процессор и память</p>
          <Row l="Ядер" v={String(m.cpu.cores)} /><Row l="Загрузка (1 / 5 мин)" v={`${m.cpu.load1} / ${m.cpu.load5}`} /><Row l="На ядро" v={String(m.cpu.loadPerCore)} />
          <Row l="Память машины" v={`${gb(m.memory.machineTotal - m.memory.machineFree)} из ${gb(m.memory.machineTotal)}`} /><Row l="Процесс Sky (RSS)" v={mb(m.memory.processRss)} /><Row l="Задержка цикла событий (p99)" v={`${m.eventLoop.p99Ms} мс`} /></div>
        <div className="space-y-1 rounded-2xl p-3" style={card}><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Диск и сеть</p>
          <Row l="Диск" v={m.disk ? `свободно ${gb(m.disk.freeBytes)} из ${gb(m.disk.totalBytes)}` : 'недоступно'} /><Row l="Сеть принято" v={m.network ? gb(m.network.rxBytes) : 'недоступно'} /><Row l="Сеть отправлено" v={m.network ? gb(m.network.txBytes) : 'недоступно'} /></div>
        <div className="space-y-1 rounded-2xl p-3" style={card}><p className="text-[12px] font-bold" style={{ color: C.t1 }}>Запросы API (с запуска)</p>
          <Row l="Всего" v={fmtN(m.requests.sinceStart)} /><Row l="В секунду" v={String(m.requests.perSecond)} /><Row l="Ошибки 5xx / 4xx" v={`${m.requests.errors5xx} / ${m.requests.errors4xx}`} /><Row l="Время ответа (медиана / p95)" v={`${m.requests.medianMs ?? '—'} / ${m.requests.p95Ms ?? '—'} мс`} /></div>
        <div className="space-y-1 rounded-2xl p-3" style={card}><p className="text-[12px] font-bold" style={{ color: C.t1 }}>База данных и фоновые задачи</p>
          <Row l="Состояние" v={m.database.ok ? `доступна, ${m.database.pingMs} мс` : 'не отвечает'} /><Row l="Соединения (занято / простаивает / ждут)" v={`${m.database.pool.total - m.database.pool.idle} / ${m.database.pool.idle} / ${m.database.pool.waiting}`} />
          <Row l="Идёт проверок серверов" v={String(m.jobs.probesRunning)} /><Row l="Серверы игр" v={m.gameServers ? Object.entries(m.gameServers).map(([k, n]) => `${k}: ${n}`).join(', ') || 'нет' : 'недоступно'} /><Row l="Аптайм" v={`${Math.round(m.uptimeSec / 3600)} ч`} /></div>
      </div>
      <p className="text-[10px]" style={{ color: C.t3 }}>Показатели измеряются на этом сервере; если значение получить нельзя, написано «недоступно». Метрики ведутся с запуска процесса.</p>
    </div>
  );
};

const AuditTab = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminAudit>> | null>(null);
  useEffect(() => { void A.apiAdminAudit().then(setD); }, []);
  if (!d) return <Wait />;
  if (!d.ok) return <Alert text={errText(d)} />;
  return <div className="space-y-1">{d.data.items.map((e) => <p key={e.id} className="rounded-lg px-3 py-1.5 text-[11px]" style={{ background: C.l2, color: C.t2 }}>{fmtDt(e.at)} · <b translate="no">{e.actor ?? 'система'}</b> · {e.type}{e.result !== 'ok' ? ` (${e.result})` : ''} · <span translate="no">{e.target}</span></p>)}</div>;
};


/* ── Баланс комиссий (только владелец) ───────────────────────────── */

const CommissionTab = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof A.apiAdminCommission>> | null>(null);
  const [mode, setMode] = useState<'payout' | 'topup'>('payout');
  const [username, setUsername] = useState(''); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const [step, setStep] = useState(false); const [msg, setMsg] = useState('');
  const load = useCallback(async () => setD(await A.apiAdminCommission()), []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Wait />;
  if (!d.ok) return <Alert text={errText(d)} />;
  const c = d.data;
  const send = async (code: string) => {
    const n = Number(amount);
    const r = mode === 'payout' ? await A.apiAdminCommissionPayout({ username: username.trim(), amount: n, reason: reason.trim(), stepUpCode: code }) : await A.apiAdminCommissionTopup({ amount: n, reason: reason.trim(), stepUpCode: code });
    setStep(false); setMsg(r.ok ? `Готово. Баланс комиссий: ${r.data.balance ?? ''}` : errText(r));
    if (r.ok) { setAmount(''); setReason(''); setUsername(''); void load(); }
  };
  const ready = Number(amount) > 0 && reason.trim().length >= 5 && (mode === 'topup' || username.trim().length >= 2);
  const kindLabel = { payout_fee: 'Удержание при выплате', topup: 'Пополнение', payout_to_user: 'Выплата пользователю' } as const;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-[11px]" style={{ color: C.t3 }}>Общий баланс комиссий, Prime Points</p>
        <p className="text-2xl font-black" style={{ color: C.t1 }}>{c.balance.toLocaleString('ru-RU')}</p>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>{`Комиссия с покупок ${c.sales.toLocaleString('ru-RU')} (${c.salesPercent}%) · удержания при выплатах ${c.fees.toLocaleString('ru-RU')} (${c.feePercent}%) · пополнено ${c.topups.toLocaleString('ru-RU')} · выплачено ${c.paidOut.toLocaleString('ru-RU')}`}</p>
      </div>
      <div className="space-y-2 rounded-2xl p-4" style={card}>
        <div className="flex gap-1"><Chip on={mode === 'payout'} onClick={() => setMode('payout')}>Выплатить пользователю</Chip><Chip on={mode === 'topup'} onClick={() => setMode('topup')}>Пополнить баланс</Chip></div>
        {mode === 'payout' && <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Имя пользователя (@username)" autoComplete="off" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} translate="no" />}
        <input value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="Сумма, баллы" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Причина (обязательно, попадёт в журнал и в историю кошелька)" className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        {mode === 'topup' && <p className="text-[10px]" style={{ color: C.t3 }}>Пополнение списывает баллы с вашего собственного кошелька — баллы из воздуха не создаются.</p>}
        {step ? <StepUp onCode={(code) => void send(code)} onCancel={() => setStep(false)} /> : <button type="button" disabled={!ready} onClick={() => { setMsg(''); setStep(true); }} className="rounded-xl px-5 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>{mode === 'payout' ? 'Выплатить' : 'Пополнить'}</button>}
        {msg && <p className="text-[11px]" style={{ color: msg.startsWith('Готово') ? C.green : C.red }}>{msg}</p>}
      </div>
      <div className="space-y-1">
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Движения по балансу</p>
        {c.items.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Движений пока нет.</p>}
        {c.items.map((i) => <p key={i.id} className="rounded-lg px-3 py-1.5 text-[11px]" style={{ background: C.l2, color: C.t2 }}>{fmtDt(i.at)} · {kindLabel[i.kind]} · <b style={{ color: i.amount < 0 ? C.red : C.green }}>{i.amount > 0 ? '+' : ''}{i.amount}</b>{i.user && <span translate="no"> · @{i.user}</span>}{i.reason && <span style={{ color: C.t3 }} translate="no"> · {i.reason}</span>}</p>)}
      </div>
    </div>
  );
};

/* ── Корень ──────────────────────────────────────────────────────── */

type Sub = 'games' | 'moderation' | 'reports' | 'developers' | 'purchases' | 'earnings' | 'payouts' | 'limits' | 'monitor' | 'audit' | 'commission';

export const BloxAdminSection = ({ can, owner }: { can: (perm: string) => boolean; owner?: boolean }) => {
  const adm = can('blox'); const mod = can('blox_moderation') || adm; const fin = can('blox_finance');
  const tabs: { key: Sub; label: string; show: boolean }[] = [
    { key: 'moderation', label: 'Модерация', show: mod }, { key: 'reports', label: 'Жалобы и апелляции', show: mod },
    { key: 'games', label: 'Игры и серверы', show: adm }, { key: 'developers', label: 'Разработчики', show: adm },
    { key: 'purchases', label: 'Покупки', show: adm || fin }, { key: 'earnings', label: 'Вознаграждения', show: adm || fin },
    { key: 'payouts', label: 'Выплаты', show: fin }, { key: 'commission', label: 'Баланс комиссий', show: owner === true }, { key: 'limits', label: 'Ограничения', show: adm || fin },
    { key: 'monitor', label: 'Мониторинг', show: adm }, { key: 'audit', label: 'Журнал', show: adm || mod || fin },
  ];
  const vis = tabs.filter((t) => t.show);
  const [sub, setSub] = useState<Sub>(vis[0]?.key ?? 'moderation');
  if (vis.length === 0) return <p className="text-[12px]" style={{ color: C.t3 }}>Нет доступа.</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>{vis.map((t) => <Chip key={t.key} on={sub === t.key} onClick={() => setSub(t.key)}>{t.label}</Chip>)}</div>
      {sub === 'moderation' && <ModerationTab />}{sub === 'reports' && <ReportsTab />}{sub === 'games' && <GamesTab />}{sub === 'developers' && <DevelopersTab />}
      {sub === 'purchases' && <PurchasesTab finance={fin} />}{sub === 'earnings' && <EarningsTab finance={fin} />}{sub === 'payouts' && <PayoutsTab />}
      {sub === 'limits' && <LimitsTab can={can} />}{sub === 'monitor' && <MonitorTab />}{sub === 'audit' && <AuditTab />}{sub === 'commission' && owner && <CommissionTab />}
    </div>
  );
};
