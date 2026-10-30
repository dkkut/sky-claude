/**
 * Sky Tax: панель налогового учёта. Одна и та же для Sky (в админке) и для предпринимателей (Sky для бизнеса, Sky Seller, Sky GO): работает с выбранным «субъектом» (scope).
 * Все решения принимает сервер (server/taxcore.mjs): интерфейс только показывает и отправляет действия. Чужой scope сервер не отдаёт.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Zap, Hand, ExternalLink, Check, X as XIcon } from 'lucide-react';
import { apiCall, apiBlob } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from '@/admin/ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)' };
const card = { background: C.l1, border: `1px solid ${C.brd}` };
const fld = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const inp = 'w-full rounded-xl px-3 py-2 text-sm';

export interface Subject { id: string; scope: string; kind: string; name: string; taxStatus: 'npd' | 'ip' | 'ooo' | null; regime: string; vat: string; innLast4: string; hasInn: boolean; mode: 'manual' | 'auto'; enabled: boolean; live: boolean; manualEscalateHours: number; manualAutoHours: number; receiptEmail: boolean; integration: { provider: string; title: string; status: string; lastOkAt: string | null; lastError: string | null } | null; ready: boolean }
interface Op { id: string; scope: string; sourceLabel: string; kind: 'sale' | 'refund'; classification: string; classReason: string; docKindLabel: string; amountRub: number; descr: string; status: string; statusLabel: string; waitReason: string; lastError: string | null; dueBy: string | null; overdue: boolean; paidAt: string; docId: string | null; docNumber: string | null; rejectReason: string | null; attempts: number; subjectName?: string }
interface Doc { id: string; opId: string; kindLabel: string; opKind: 'sale' | 'refund'; number: string; url: string | null; amountRub: number; provenance: string; emailStatus: string; issuedAt: string; pageUrl: string; scope?: string; subjectName?: string }
interface Provider { id: string; title: string; automatic: boolean; available: boolean; note: string; forStatus: boolean }
interface Report { sales: { n: number; sum: number }; refunds: { n: number; sum: number }; net: number; waiting: { n: number; sum: number }; failed: { n: number; sum: number }; rejected: { n: number; sum: number }; notRequired: { n: number; sum: number } }
interface LogRow { id: number; actor: string; action: string; status: string; detail: string; at: string }

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Только владелец.', bad_state: 'Операция уже в другом состоянии — обновите список.', classification_required: 'Сначала решите, считать ли операцию доходом.', subject_incomplete: 'Заполните налоговый статус, ИНН и подключите способ выдачи чеков.',
  reason_required: 'Нужна причина (от 5 знаков).', bad_inn: 'ИНН не прошёл проверку контрольной суммы.', bad_tax_status: 'Выберите налоговый статус.', bad_regime: 'Режим не подходит этому статусу.', bad_vat: 'Для самозанятого НДС нет.',
  status_verified_elsewhere: 'Налоговый статус уже подтверждён администрацией модуля — изменить его здесь нельзя.', individual_not_supported: 'Физические лица без статуса не ведут налоговый учёт в Sky.', provider_not_available: 'Этот способ пока не подключён.', provider_not_for_status: 'Способ не подходит вашему статусу.',
  bad_url: 'Адрес — только https.', bad_merchant: 'Укажите идентификатор.', bad_secret: 'Секрет — от 16 знаков.', two_factor_required: 'Введите код аутентификатора.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.',
  bad_amount: 'Сумма возврата больше остатка.', bad_number: 'Номер чека указан неверно.', manual_not_allowed: 'Ручной ввод доступен только для «Выдаю чек сам».', no_integration: 'Интеграция не подключена.', not_enabled: 'Сначала включите учёт.', confirm_required: 'Нужно подтверждение.', too_many_requests: 'Слишком часто, подождите.',
  gateway_unreachable: 'Шлюз недоступен.', gateway_rejected: 'Шлюз отклонил запрос.', gateway_bad_url: 'Адрес шлюза не принят.', not_found: 'Не найдено.',
};
const errText = (e?: string) => ERR[e ?? ''] ?? `Не получилось${e ? ` (${e})` : ''}`;
const WAIT: Record<string, string> = { live_disabled: 'Отправка в налоговую систему пока не включена — операция ждёт в очереди и не потеряется.', no_integration: 'Не подключён способ выдачи чеков.', subject_not_ready: 'Учёт не готов (проверьте настройки).', classification_review: 'Нужно решить, считать ли операцию доходом.', tax_status_missing: 'Укажите налоговый статус.' };
const STATUS_COLOR: Record<string, string> = { issued: '#12a76a', pending_confirm: '#f5a524', queued: '#4f6ef7', sending: '#4f6ef7', awaiting_provider: '#4f6ef7', awaiting_manual: '#f5a524', failed: '#e5484d', rejected: '#8a8fa8', not_required: '#8a8fa8' };
const TAX_RU = { npd: 'Самозанятый (НПД)', ip: 'ИП', ooo: 'ООО' } as const;
const REGIME_RU: Record<string, string> = { npd: 'НПД', usn_income: 'УСН «Доходы»', usn_income_expense: 'УСН «Доходы − расходы»', osno: 'ОСНО', psn: 'Патент' };
const REGIMES: Record<string, string[]> = { npd: ['npd'], ip: ['usn_income', 'usn_income_expense', 'osno', 'psn'], ooo: ['usn_income', 'usn_income_expense', 'osno'] };
const rub = (n: number) => `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const Btn = ({ children, onClick, disabled, kind = 'ghost', danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; kind?: 'ghost' | 'main'; danger?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" style={kind === 'main' ? { background: C.acc, color: '#fff' } : { background: C.l2, border: `1px solid ${C.brd}`, color: danger ? '#e5484d' : C.t1 }}>{children}</button>
);
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="mb-1 block text-xs" style={{ color: C.t3 }}>{label}</span>{children}</label>;
const Pill = ({ s, label }: { s: string; label: string }) => <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[s] ?? '#8a8fa8'} 16%, transparent)`, color: STATUS_COLOR[s] ?? C.t3 }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] ?? C.t3 }} />{label}</span>;

/* ─── переключатель режимов (главный элемент настроек) ─── */
export const ModeSwitch = ({ mode, onChange, disabled }: { mode: 'manual' | 'auto'; onChange: (m: 'manual' | 'auto') => void; disabled?: boolean }) => {
  const opts: { id: 'manual' | 'auto'; title: string; icon: typeof Hand; text: string; steps: string }[] = [
    { id: 'manual', title: 'Ручная обработка', icon: Hand, text: 'Каждая продажа ждёт вашей проверки.', steps: 'Оплата → «Ожидает подтверждения» → вы жмёте «Подтвердить и отправить» → чек → покупателю' },
    { id: 'auto', title: 'Автоматически после продажи', icon: Zap, text: 'Чек формируется и уходит покупателю сам.', steps: 'Оплата подтверждена → чек → покупателю. Вмешательство нужно только при ошибках' },
  ];
  return (
    <div role="radiogroup" aria-label="Режим обработки" className="grid gap-2 sm:grid-cols-2">
      {opts.map((o) => {
        const on = mode === o.id; const Icon = o.icon;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => !on && onChange(o.id)} className="relative overflow-hidden rounded-2xl p-4 text-left transition disabled:opacity-60"
            style={{ background: on ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-l1))' : C.l1, border: `2px solid ${on ? C.acc : C.brd}`, boxShadow: on ? '0 6px 24px color-mix(in srgb, var(--accent) 22%, transparent)' : 'none' }}>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: on ? C.acc : C.l2, color: on ? '#fff' : C.t2 }}><Icon size={17} /></span>
              <div className="min-w-0 flex-1 text-sm font-bold" style={{ color: C.t1 }}>{o.title}</div>
              <span className="grid h-5 w-5 place-items-center rounded-full" style={{ border: `2px solid ${on ? C.acc : C.brd}`, background: on ? C.acc : 'transparent', color: '#fff' }}>{on && <Check size={12} />}</span>
            </div>
            <p className="mt-2 text-xs" style={{ color: C.t2 }}>{o.text}</p>
            <p className="mt-1 text-[11px] leading-4" style={{ color: C.t3 }}>{o.steps}</p>
          </button>
        );
      })}
    </div>
  );
};

type Sec = 'ops' | 'docs' | 'settings' | 'report' | 'log';
interface Props { scope: string; sky?: boolean; compact?: boolean; adminView?: boolean }

export const TaxPanel = ({ scope, sky, adminView }: Props) => {
  const [info, setInfo] = useState<{ subject: Subject | null; canManage: boolean; canOperate: boolean; role: string; global: { liveEnabled: boolean; dueHours: number }; providers: Provider[] } | null>(null);
  const [err, setErr] = useState(''); const [sec, setSec] = useState<Sec>('ops');
  const q = `scope=${encodeURIComponent(scope)}`;
  const load = useCallback(async () => {
    const r = await apiCall<NonNullable<typeof info>>(`/api/tax/subject?${q}`);
    if (r.ok && r.data) { setInfo(r.data); setErr(''); } else setErr(errText(r.error));
  }, [q]);
  useEffect(() => { void load(); }, [load]);
  if (!info) return <div className="grid place-items-center py-10">{err ? <p className="text-sm" style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  const s = info.subject;
  return (
    <div className="min-w-0 space-y-3">
      <Banner s={s} info={info} />
      <ScrollTabs>{([['ops', 'Операции'], ['docs', 'Документы'], ['report', 'Отчёт'], ['log', 'Журнал'], ['settings', 'Настройки']] as [Sec, string][]).map(([k, l]) => (
        <button key={k} type="button" onClick={() => setSec(k)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold" style={sec === k ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{l}</button>))}</ScrollTabs>
      {sec === 'ops' && <Ops scope={scope} subject={s} canOperate={info.canOperate} reload={load} />}
      {sec === 'docs' && <Docs scope={scope} canOperate={info.canOperate} />}
      {sec === 'report' && <ReportView scope={scope} />}
      {sec === 'log' && <LogView scope={scope} />}
      {sec === 'settings' && <Settings scope={scope} info={info} sky={Boolean(sky)} adminView={Boolean(adminView)} reload={load} />}
    </div>
  );
};

const Banner = ({ s, info }: { s: Subject | null; info: { global: { liveEnabled: boolean } } }) => {
  if (!s || !s.enabled) return <div className="rounded-2xl p-3 text-sm" style={{ ...card, color: C.t2 }}>Налоговый учёт не включён. Откройте «Настройки»: укажите налоговый статус и ИНН, подключите способ выдачи чеков и включите учёт. Чеки «за прошлое» не формируются — только продажи после включения.</div>;
  const live = info.global.liveEnabled && s.live;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl p-3 text-xs" style={card}>
      <span className="font-bold" style={{ color: C.t1 }}>{s.name || 'Учёт'}</span>
      <Pill s={s.mode === 'auto' ? 'queued' : 'pending_confirm'} label={s.mode === 'auto' ? 'Автоматически после продажи' : 'Ручная обработка'} />
      <Pill s={live ? 'issued' : 'pending_confirm'} label={live ? 'Передача включена' : 'Передача не включена'} />
      {!live && <span style={{ color: C.t3 }}>Операции копятся в очереди и не пропадут; чеки не формируются, пока передачу не включат (нужны юридическая схема и подключённая интеграция).</span>}
    </div>
  );
};

/* ─── операции ─── */
const Ops = ({ scope, subject, canOperate, reload }: { scope: string; subject: Subject | null; canOperate: boolean; reload: () => void }) => {
  const [ops, setOps] = useState<Op[] | null>(null); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ ops: Op[] }>(`/api/tax/ops?scope=${encodeURIComponent(scope)}&status=${status}&q=${encodeURIComponent(q)}`); if (r.ok && r.data) setOps(r.data.ops); else flash(errText(r.error)); }, [scope, status, q]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(t); }, [load]);
  const act = async (id: string, a: string, body: Record<string, unknown> = {}) => {
    setBusy(id + a); const r = await apiCall(`/api/tax/ops/${id}/${a}`, { method: 'POST', body: JSON.stringify({ scope, ...body }) }); setBusy('');
    if (r.ok) { flash('Готово'); await load(); reload(); } else flash(errText(r.error));
  };
  const confirmAll = async () => { setBusy('all'); const r = await apiCall<{ confirmed: number }>(`/api/tax/ops/confirm-all`, { method: 'POST', body: JSON.stringify({ scope }) }); setBusy(''); if (r.ok) { flash(`Подтверждено: ${r.data?.confirmed ?? 0}`); await load(); } else flash(errText(r.error)); };
  const pending = (ops ?? []).filter((o) => o.status === 'pending_confirm' && !o.waitReason).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select className="rounded-xl px-3 py-2 text-xs" style={fld} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{['pending_confirm', 'queued', 'awaiting_manual', 'awaiting_provider', 'issued', 'failed', 'rejected', 'not_required'].map((x) => <option key={x} value={x}>{({ pending_confirm: 'Ожидает подтверждения', queued: 'В очереди', awaiting_manual: 'Нужно внести номер', awaiting_provider: 'Ждёт интеграцию', issued: 'Сформирован', failed: 'Ошибка', rejected: 'Отклонено', not_required: 'Чек не требуется' } as Record<string, string>)[x]}</option>)}</select>
        <input className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={fld} placeholder="Номер операции или чека, описание" value={q} onChange={(e) => setQ(e.target.value)} />
        {canOperate && subject?.mode === 'manual' && pending > 1 && <Btn kind="main" onClick={confirmAll} disabled={busy === 'all'}><Check size={13} /> Подтвердить все ({pending})</Btn>}
      </div>
      {!ops ? <div className="grid place-items-center py-8"><Loader2 className="animate-spin" size={18} /></div> : !ops.length ? <p className="rounded-2xl p-4 text-sm" style={{ ...card, color: C.t3 }}>Операций пока нет. Они появятся после продаж, оплаченных при включённом учёте.</p> : (
        <div className="space-y-2">{ops.map((o) => (
          <div key={o.id} className="rounded-2xl p-3" style={{ ...card, borderLeft: `4px solid ${STATUS_COLOR[o.status] ?? C.brd}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold" style={{ color: C.t1 }}>{o.kind === 'refund' ? '−' : ''}{rub(o.amountRub)}</span>
              <Pill s={o.status} label={o.statusLabel} />{o.overdue && <Pill s="failed" label="Срок подходит к концу" />}
              <span className="ml-auto text-[11px]" style={{ color: C.t3 }}>{dt(o.paidAt)}</span>
            </div>
            <div className="mt-1 text-xs" style={{ color: C.t2 }}>{o.sourceLabel}{o.descr ? ` · ${o.descr}` : ''}</div>
            <div className="mt-1 text-[11px] leading-4" style={{ color: C.t3 }}>{o.docKindLabel}. {o.classReason}</div>
            {o.waitReason && WAIT[o.waitReason] && <div className="mt-1 text-[11px]" style={{ color: '#f5a524' }}>{WAIT[o.waitReason]}</div>}
            {o.status === 'queued' && o.waitReason && WAIT[o.waitReason] && null}
            {o.lastError && ['failed', 'queued'].includes(o.status) && <div className="mt-1 text-[11px]" style={{ color: '#e5484d' }}>{o.lastError}{o.attempts ? ` (попыток: ${o.attempts})` : ''}</div>}
            {o.rejectReason && <div className="mt-1 text-[11px]" style={{ color: C.t3 }}>Причина отказа: {o.rejectReason}</div>}
            {o.docNumber && <div className="mt-1 text-[11px]" style={{ color: C.t2 }}>Документ № {o.docNumber}</div>}
            {canOperate && <OpActions o={o} busy={busy} act={act} />}
          </div>))}</div>)}
    </div>
  );
};
const OpActions = ({ o, busy, act }: { o: Op; busy: string; act: (id: string, a: string, body?: Record<string, unknown>) => void }) => {
  const [mode, setMode] = useState<'' | 'reject' | 'classify' | 'manual'>(''); const [text, setText] = useState(''); const [num, setNum] = useState(''); const [url, setUrl] = useState('');
  const ask = (m: typeof mode) => { setMode(mode === m ? '' : m); setText(''); };
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {o.status === 'pending_confirm' && !o.waitReason && <Btn kind="main" disabled={busy === o.id + 'confirm'} onClick={() => act(o.id, 'confirm')}><Check size={13} /> Подтвердить и отправить</Btn>}
        {o.status === 'pending_confirm' && o.waitReason === 'classification_review' && <><Btn kind="main" onClick={() => ask('classify')}>Это доход</Btn><Btn onClick={() => ask('classify')}>Это не доход</Btn></>}
        {['pending_confirm', 'failed', 'awaiting_manual'].includes(o.status) && <Btn danger onClick={() => ask('reject')}><XIcon size={13} /> Отклонить</Btn>}
        {o.status === 'failed' && <Btn onClick={() => act(o.id, 'retry')}>Повторить</Btn>}
        {['awaiting_manual'].includes(o.status) && <Btn kind="main" onClick={() => ask('manual')}>Внести номер выданного чека</Btn>}
      </div>
      {mode === 'reject' && <div className="flex gap-2"><input className={inp} style={fld} placeholder="Причина (от 5 знаков)" value={text} onChange={(e) => setText(e.target.value)} /><Btn danger onClick={() => act(o.id, 'reject', { reason: text })}>Отклонить</Btn></div>}
      {mode === 'classify' && <div className="space-y-2"><input className={inp} style={fld} placeholder="Основание решения (от 5 знаков)" value={text} onChange={(e) => setText(e.target.value)} /><div className="flex gap-2"><Btn kind="main" onClick={() => act(o.id, 'classify', { as: 'income', reason: text })}>Считать доходом</Btn><Btn onClick={() => act(o.id, 'classify', { as: 'not_income', reason: text })}>Не доход</Btn></div></div>}
      {mode === 'manual' && <div className="space-y-2"><p className="text-[11px]" style={{ color: C.t3 }}>Выдайте чек в приложении «Мой налог» или на своей кассе и внесите его номер. Sky номер не проверяет — документ будет помечен «внесён вручную».</p><div className="grid gap-2 sm:grid-cols-2"><input className={inp} style={fld} placeholder="Номер чека" value={num} onChange={(e) => setNum(e.target.value)} /><input className={inp} style={fld} placeholder="Ссылка на чек (https, необязательно)" value={url} onChange={(e) => setUrl(e.target.value)} /></div><Btn kind="main" onClick={() => act(o.id, 'manual-doc', { number: num, url })}>Сохранить документ</Btn></div>}
    </div>
  );
};

/* ─── документы ─── */
const PROV_RU: Record<string, string> = { provider: 'подтверждено интеграцией', manual: 'внесён вручную', internal: 'внутренний' };
const MAIL_RU: Record<string, string> = { sent: 'Отправлен покупателю', pending: 'Отправляется…', failed: 'Не отправлен', no_address: 'Нет адреса покупателя', none: 'Отправка отключена' };
export const DocsList = ({ docs, canOperate, scope, reload }: { docs: Doc[]; canOperate: boolean; scope?: string; reload?: () => void }) => {
  const [refund, setRefund] = useState<string | null>(null); const [amt, setAmt] = useState(''); const [why, setWhy] = useState('');
  const doRefund = async (d: Doc) => { const r = await apiCall(`/api/tax/docs/${d.id}/refund`, { method: 'POST', body: JSON.stringify({ scope: scope ?? d.scope, amount: amt ? Number(amt.replace(',', '.')) : undefined, reason: why }) }); if (r.ok) { flash('Возврат оформлен'); setRefund(null); setAmt(''); setWhy(''); reload?.(); } else flash(errText(r.error)); };
  const resend = async (d: Doc) => { const r = await apiCall(`/api/tax/docs/${d.id}/resend`, { method: 'POST', body: JSON.stringify({ scope: scope ?? d.scope }) }); flash(r.ok ? 'Поставлено на повторную отправку' : errText(r.error)); reload?.(); };
  if (!docs.length) return <p className="rounded-2xl p-4 text-sm" style={{ ...card, color: C.t3 }}>Документов пока нет.</p>;
  return (
    <div className="space-y-2">{docs.map((d) => (
      <div key={d.id} className="rounded-2xl p-3" style={card}>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold" style={{ color: C.t1 }}>{d.opKind === 'refund' ? 'Чек возврата' : 'Чек'} № {d.number}</span><span className="font-semibold" style={{ color: C.t1 }}>{d.opKind === 'refund' ? '−' : ''}{rub(d.amountRub)}</span><span className="ml-auto text-[11px]" style={{ color: C.t3 }}>{dt(d.issuedAt)}</span></div>
        <div className="mt-1 text-[11px]" style={{ color: C.t3 }}>{d.subjectName ? `${d.subjectName} · ` : ''}{d.kindLabel} · {PROV_RU[d.provenance]} · {MAIL_RU[d.emailStatus]}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={d.pageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}><ExternalLink size={13} /> Открыть / PDF</a>
          {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>У оператора</a>}
          {canOperate && <Btn onClick={() => resend(d)}>Отправить покупателю ещё раз</Btn>}
          {canOperate && d.opKind === 'sale' && <Btn onClick={() => setRefund(refund === d.id ? null : d.id)}>Оформить возврат</Btn>}
        </div>
        {refund === d.id && <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr_auto]"><input className={inp} style={fld} placeholder="Сумма (пусто — вся)" value={amt} onChange={(e) => setAmt(e.target.value)} /><input className={inp} style={fld} placeholder="Причина возврата" value={why} onChange={(e) => setWhy(e.target.value)} /><Btn kind="main" onClick={() => doRefund(d)}>Оформить</Btn></div>}
      </div>))}</div>
  );
};
const Docs = ({ scope, canOperate }: { scope: string; canOperate: boolean }) => {
  const [docs, setDocs] = useState<Doc[] | null>(null); const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ docs: Doc[] }>(`/api/tax/docs?scope=${encodeURIComponent(scope)}&q=${encodeURIComponent(q)}&from=${from}&to=${to}`); if (r.ok && r.data) setDocs(r.data.docs); }, [scope, q, from, to]);
  useEffect(() => { void load(); }, [load]);
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><input className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={fld} placeholder="Номер чека или операции" value={q} onChange={(e) => setQ(e.target.value)} /><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={to} onChange={(e) => setTo(e.target.value)} /></div>{docs ? <DocsList docs={docs} canOperate={canOperate} scope={scope} reload={load} /> : <Loader2 className="mx-auto animate-spin" size={18} />}</div>;
};

/* ─── отчёт ─── */
const ReportView = ({ scope }: { scope: string }) => {
  const [r, setR] = useState<Report | null>(null); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const load = useCallback(async () => { const x = await apiCall<{ report: Report }>(`/api/tax/report?scope=${encodeURIComponent(scope)}&from=${from}&to=${to}`); if (x.ok && x.data) setR(x.data.report); }, [scope, from, to]);
  useEffect(() => { void load(); }, [load]);
  const csv = async () => { const b = await apiBlob(`/api/tax/report?scope=${encodeURIComponent(scope)}&from=${from}&to=${to}&format=csv`); if (!b.ok || !b.blob) { flash('Не удалось выгрузить'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(b.blob); a.download = 'sky-tax.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const Stat = ({ k, v, sub, c }: { k: string; v: string; sub?: string; c?: string }) => <div className="rounded-2xl p-3" style={card}><div className="text-xs" style={{ color: C.t3 }}>{k}</div><div className="mt-1 text-xl font-bold" style={{ color: c ?? C.t1 }}>{v}</div>{sub && <div className="text-[11px]" style={{ color: C.t3 }}>{sub}</div>}</div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={from} onChange={(e) => setFrom(e.target.value)} /><span style={{ color: C.t3 }}>—</span><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={to} onChange={(e) => setTo(e.target.value)} /><Btn onClick={csv}>Выгрузить CSV</Btn></div>
      <p className="text-xs" style={{ color: C.t3 }}>Считаются только операции с сформированным документом. Это учётная сводка, а не налоговая декларация.</p>
      {r && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Продажи с чеком" v={rub(r.sales.sum)} sub={`${r.sales.n} шт.`} c="#12a76a" /><Stat k="Возвраты" v={rub(r.refunds.sum)} sub={`${r.refunds.n} шт.`} /><Stat k="Итого за период" v={rub(r.net)} />
        <Stat k="Ждут обработки" v={rub(r.waiting.sum)} sub={`${r.waiting.n} шт.`} c="#f5a524" /><Stat k="Ошибки" v={rub(r.failed.sum)} sub={`${r.failed.n} шт.`} c={r.failed.n ? '#e5484d' : undefined} /><Stat k="Отклонено" v={rub(r.rejected.sum)} sub={`${r.rejected.n} шт.`} /><Stat k="Чек не требуется" v={rub(r.notRequired.sum)} sub={`${r.notRequired.n} шт. (пополнения, обмен, транзит)`} />
      </div>}
    </div>
  );
};

/* ─── журнал ─── */
export const LogList = ({ rows }: { rows: LogRow[] }) => (
  <div className="overflow-x-auto rounded-2xl" style={card}>
    <table className="w-full min-w-[560px] text-left text-xs" style={{ color: C.t1 }}><thead style={{ color: C.t3 }}><tr>{['Время', 'Кто', 'Действие', 'Статус', 'Подробности'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((l) => <tr key={l.id} className="border-t" style={{ borderColor: C.brd }}><td className="whitespace-nowrap px-3 py-2">{dt(l.at)}</td><td className="px-3 py-2">{l.actor}</td><td className="px-3 py-2">{l.action}</td><td className="px-3 py-2" style={{ color: l.status === 'ok' ? C.t1 : '#e5484d' }}>{l.status}</td><td className="px-3 py-2" style={{ color: C.t3 }}>{l.detail}</td></tr>)}</tbody></table>
    {!rows.length && <p className="p-4 text-sm" style={{ color: C.t3 }}>Записей нет.</p>}
  </div>
);
const LogView = ({ scope }: { scope: string }) => { const [rows, setRows] = useState<LogRow[]>([]); useEffect(() => { void apiCall<{ log: LogRow[] }>(`/api/tax/log?scope=${encodeURIComponent(scope)}`).then((r) => r.ok && r.data && setRows(r.data.log)); }, [scope]); return <LogList rows={rows} />; };

/* ─── настройки ─── */
const Settings = ({ scope, info, sky, adminView, reload }: { scope: string; info: { subject: Subject | null; canManage: boolean; global: { liveEnabled: boolean; dueHours: number }; providers: Provider[] }; sky: boolean; adminView: boolean; reload: () => void }) => {
  const s = info.subject; const can = info.canManage;
  const [f, setF] = useState({ name: s?.name ?? '', taxStatus: s?.taxStatus ?? '', regime: s?.regime ?? '', vat: s?.vat ?? 'none', inn: '', esc: String(s?.manualEscalateHours ?? 12), auto: String(s?.manualAutoHours ?? 0) });
  const [ig, setIg] = useState({ provider: s?.integration?.provider ?? 'manual_entry', url: '', merchant: '', secret: '' });
  const [code, setCode] = useState(''); const [asked, setAsked] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ name: s?.name ?? '', taxStatus: s?.taxStatus ?? '', regime: s?.regime ?? '', vat: s?.vat ?? 'none', inn: '', esc: String(s?.manualEscalateHours ?? 12), auto: String(s?.manualAutoHours ?? 0) }); }, [s?.id, s?.taxStatus, s?.regime, s?.vat]); // eslint-disable-line react-hooks/exhaustive-deps
  const provs = useMemo(() => info.providers, [info.providers]);
  const codeBody = sky ? { stepUpCode: code.trim() } : { twoFactorCode: code.trim() };
  const post = async (path: string, body: Record<string, unknown>, method = 'POST', msg = 'Сохранено') => {
    setBusy(true); const r = await apiCall(`/api/tax/${path}`, { method, body: JSON.stringify({ scope, ...body }) }); setBusy(false);
    if (r.ok) { flash(msg); setCode(''); setAsked(false); reload(); return true; } flash(errText(r.error)); return false;
  };
  const askCode = async (purpose: 'tax_settings' | 'tax_live') => { const r = await apiCall('/api/admin/tax/step-up', { method: 'POST', body: JSON.stringify({ purpose }) }); if (r.ok) { setAsked(true); flash('Код отправлен'); } else flash(errText(r.error)); };
  const needsCode = (purpose: 'tax_settings' | 'tax_live') => (
    <div className="flex flex-wrap items-end gap-2">{sky && <Btn onClick={() => askCode(purpose)}>{asked ? 'Выслать код ещё раз' : 'Запросить код подтверждения'}</Btn>}<Field label={sky ? 'Код подтверждения' : 'Код аутентификатора (если включён)'}><input className={inp} style={fld} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></Field></div>
  );
  if (!s) return <div className="space-y-2"><p className="rounded-2xl p-3 text-sm" style={{ ...card, color: C.t2 }}>Налоговый учёт для этого раздела ещё не создан.</p>{can && <Btn kind="main" onClick={() => post('subject', { name: f.name || 'Мой бизнес' })}>Начать настройку</Btn>}</div>;
  const dis = !can || busy;
  return (
    <div className="space-y-4">
      {!can && <p className="rounded-2xl p-3 text-xs" style={{ ...card, color: C.t3 }}>Менять настройки может только владелец.{adminView ? ' Вы просматриваете чужие настройки — изменить их нельзя.' : ''}</p>}
      <section className="space-y-2"><h3 className="text-sm font-bold" style={{ color: C.t1 }}>Режим обработки</h3>
        <ModeSwitch mode={s.mode} disabled={dis} onChange={(m) => post('mode', { mode: m, ...(sky ? { stepUpCode: code.trim() } : {}) }, 'PUT', m === 'auto' ? 'Включена автоматическая обработка' : 'Включена ручная обработка')} />
        {sky && can && needsCode('tax_settings')}
        <p className="text-[11px] leading-4" style={{ color: C.t3 }}>Режим действует только для этого учёта и не затрагивает других. Ручное подтверждение — внутренний этап: срок формирования чека установлен законом, поэтому у ожидающих операций виден срок, а по его приближении приходит напоминание.</p>
        <div className="grid gap-2 sm:grid-cols-2"><Field label="Напомнить, если ждёт подтверждения дольше (часов)"><input className={inp} style={fld} disabled={dis} value={f.esc} onChange={(e) => setF({ ...f, esc: e.target.value })} /></Field><Field label="Отправить само через (часов; 0 — не отправлять само)"><input className={inp} style={fld} disabled={dis} value={f.auto} onChange={(e) => setF({ ...f, auto: e.target.value })} /></Field></div>
        <Btn disabled={dis} onClick={() => post('subject', { manualEscalateHours: Number(f.esc), manualAutoHours: Number(f.auto) })}>Сохранить сроки</Btn>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-bold" style={{ color: C.t1 }}>Налоговые сведения</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Название"><input className={inp} style={fld} disabled={dis} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Налоговый статус"><select className={inp} style={fld} disabled={dis} value={f.taxStatus} onChange={(e) => setF({ ...f, taxStatus: e.target.value, regime: e.target.value === 'npd' ? 'npd' : '', vat: e.target.value === 'npd' ? 'none' : f.vat })}><option value="">— выберите —</option>{(['npd', 'ip', 'ooo'] as const).map((k) => <option key={k} value={k}>{TAX_RU[k]}</option>)}</select></Field>
          <Field label="Режим налогообложения"><select className={inp} style={fld} disabled={dis || !f.taxStatus} value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value })}><option value="">— выберите —</option>{(REGIMES[f.taxStatus] ?? []).map((k) => <option key={k} value={k}>{REGIME_RU[k]}</option>)}</select></Field>
          <Field label="НДС"><select className={inp} style={fld} disabled={dis || f.taxStatus === 'npd'} value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })}>{['none', '0', '5', '7', '10', '20', '22'].map((k) => <option key={k} value={k}>{k === 'none' ? 'Без НДС' : `${k} %`}</option>)}</select></Field>
          <Field label={`ИНН ${s.hasInn ? `(сохранён, …${s.innLast4})` : ''}`}><input className={inp} style={fld} disabled={dis} value={f.inn} onChange={(e) => setF({ ...f, inn: e.target.value })} placeholder={f.taxStatus === 'ooo' ? '10 цифр' : '12 цифр'} inputMode="numeric" /></Field>
        </div>
        {f.inn && !sky && can && needsCode('tax_settings')}{f.inn && sky && can && needsCode('tax_settings')}
        <Btn kind="main" disabled={dis} onClick={() => post('subject', { name: f.name, ...(f.taxStatus ? { taxStatus: f.taxStatus } : {}), ...(f.regime ? { regime: f.regime } : {}), vat: f.vat, ...(f.inn ? { inn: f.inn, ...codeBody } : {}) })}>Сохранить сведения</Btn>
        <p className="text-[11px]" style={{ color: C.t3 }}>ИНН хранится зашифрованным. Sky проверяет только контрольную сумму: реестры ФНС не подключены, существование налогоплательщика не проверяется.</p>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-bold" style={{ color: C.t1 }}>Способ выдачи чеков</h3>
        <div className="grid gap-2">{provs.map((p) => {
          const on = ig.provider === p.id;
          return <button key={p.id} type="button" disabled={dis || !p.available || !p.forStatus} onClick={() => setIg({ ...ig, provider: p.id })} className="rounded-2xl p-3 text-left disabled:opacity-55" style={{ ...card, border: `2px solid ${on ? C.acc : C.brd}` }}><div className="flex items-center gap-2"><span className="text-sm font-semibold" style={{ color: C.t1 }}>{p.title}</span>{!p.available && <span className="rounded-full px-2 text-[10px]" style={{ background: C.l2, color: C.t3 }}>не подключено</span>}{p.automatic && p.available && <span className="rounded-full px-2 text-[10px]" style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: C.acc }}>автоматически</span>}</div><p className="mt-1 text-[11px] leading-4" style={{ color: C.t3 }}>{p.note}</p></button>;
        })}</div>
        {ig.provider === 'hmac_gateway' && <div className="grid gap-2 sm:grid-cols-3"><Field label="Адрес шлюза (https)"><input className={inp} style={fld} disabled={dis} value={ig.url} onChange={(e) => setIg({ ...ig, url: e.target.value })} /></Field><Field label="Идентификатор"><input className={inp} style={fld} disabled={dis} value={ig.merchant} onChange={(e) => setIg({ ...ig, merchant: e.target.value })} /></Field><Field label="Секрет подписи"><input type="password" className={inp} style={fld} disabled={dis} value={ig.secret} onChange={(e) => setIg({ ...ig, secret: e.target.value })} autoComplete="off" /></Field></div>}
        {can && needsCode('tax_settings')}
        <div className="flex flex-wrap gap-2"><Btn kind="main" disabled={dis} onClick={() => post('integration', { ...ig, ...codeBody }, 'PUT', 'Способ подключён')}>Подключить</Btn>
          {s.integration && <Btn disabled={dis || s.integration.provider === 'manual_entry'} onClick={() => post('integration', {}, 'POST', 'Связь со шлюзом есть')}>Проверить связь</Btn>}
          {s.integration && <Btn danger disabled={dis} onClick={() => post('integration', { ...codeBody }, 'DELETE', 'Интеграция отключена')}>Отключить</Btn>}</div>
        {s.integration && <p className="text-[11px]" style={{ color: s.integration.lastError ? '#e5484d' : C.t3 }}>Подключено: {s.integration.title}. {s.integration.lastError ? `Последняя ошибка: ${s.integration.lastError}` : s.integration.lastOkAt ? `Последний успешный обмен: ${dt(s.integration.lastOkAt)}` : ''}</p>}
      </section>
      <section className="space-y-2"><h3 className="text-sm font-bold" style={{ color: C.t1 }}>Включение</h3>
        <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" disabled={dis} checked={s.enabled} onChange={(e) => post('enabled', { enabled: e.target.checked }, 'POST', e.target.checked ? 'Учёт включён' : 'Учёт выключен')} /> Вести налоговый учёт (чеки «за прошлое» не формируются)</label>
        <label className="flex items-center gap-2 text-sm" style={{ color: C.t1 }}><input type="checkbox" disabled={dis || !s.enabled} checked={s.live} onChange={(e) => { if (e.target.checked && !window.confirm('Включить РЕАЛЬНУЮ передачу сведений и формирование чеков? Убедитесь, что реквизиты и интеграция проверены, а юридическая схема согласована.')) return; void post('live', { live: e.target.checked, confirm: true, ...codeBody }, 'POST', e.target.checked ? 'Реальная передача включена' : 'Реальная передача выключена'); }} /> Разрешить реальную передачу и формирование чеков</label>
        {can && s.enabled && needsCode('tax_live')}
        <p className="text-[11px] leading-4" style={{ color: info.global.liveEnabled ? C.t3 : '#f5a524' }}>{info.global.liveEnabled ? 'Глобально передача разрешена владельцем Sky.' : 'Глобально реальная передача ещё не включена владельцем Sky — до этого операции копятся в очереди, чеки не формируются.'}</p>
      </section>
    </div>
  );
};

/* ─── для кабинетов предпринимателей: выбор своего субъекта ─── */
export const MyTax = () => {
  const [scopes, setScopes] = useState<{ scope: string; kind: string; label: string; role: string; canManage: boolean; subject: Subject | null }[] | null>(null); const [cur, setCur] = useState('');
  useEffect(() => { void apiCall<{ scopes: NonNullable<typeof scopes> }>('/api/tax/scopes').then((r) => { if (r.ok && r.data) { const sc = r.data.scopes.filter((x) => x.kind !== 'sky'); setScopes(sc); setCur(sc[0]?.scope ?? ''); } else setScopes([]); }); }, []);
  if (!scopes) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={20} /></div>;
  if (!scopes.length) return <p className="rounded-2xl p-4 text-sm" style={{ ...card, color: C.t2 }}>Налоговый учёт доступен владельцам бизнеса SkyKassa Business, продавцам Sky Market и исполнителям Sky GO с одобренной заявкой.</p>;
  const KIND: Record<string, string> = { business: 'Бизнес', seller: 'Магазин', executor: 'Sky GO' };
  return (
    <div className="space-y-3">
      <div><h2 className="text-lg font-bold" style={{ color: C.t1 }}>Sky Tax</h2><p className="text-xs" style={{ color: C.t3 }}>Чеки, передача сведений и отчёты — отдельно для каждого вашего бизнеса. Sky не смешивает ваши доходы со своими.</p></div>
      {scopes.length > 1 && <div className="flex flex-wrap gap-2">{scopes.map((x) => <button key={x.scope} type="button" onClick={() => setCur(x.scope)} className="rounded-xl px-3 py-2 text-xs font-semibold" style={cur === x.scope ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{KIND[x.kind] ?? x.kind}: {x.label}</button>)}</div>}
      {cur && <TaxPanel key={cur} scope={cur} />}
    </div>
  );
};
