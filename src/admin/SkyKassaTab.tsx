/**
 * Вкладка «SkyKassa»: очередь заявок на пополнение, проверка, подтверждение владельцем, возвраты;
 * способы оплаты, реквизиты, партнёры и параметры. Сервер — server/skykassa*.mjs, права
 * `skykassa` (проверка) и `skykassa_settings` (настройки); зачисляет деньги только владелец.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, Check, X, Plus, History, Trash2, RefreshCw } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/skykassa';
const rub = (n: number) => `${Number(n).toLocaleString('ru-RU')} ₽`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Это действие доступно только владельцу.', self_review: 'Свою заявку проверять нельзя.',
  step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  no_second_factor: 'Нужна подтверждённая почта или аутентификатор.', bad_state: 'Действие недоступно в текущем статусе заявки.',
  reason_required: 'Укажите причину (от 5 знаков).', not_found: 'Не найдено.', processing_error: 'Ошибка при зачислении. Заявка помечена «Ошибка обработки».',
  refund_insufficient_funds: 'У человека на балансе уже нет этих денег — возврат невозможен.', bad_field: 'Проверьте заполнение поля.',
  bad_card: 'Номер карты неверный.', bad_phone: 'Номер телефона неверный.', bad_account: 'Номер счёта неверный (20 цифр или IBAN). Если это телефон или карта — выберите тип «Телефон (СБП)» или «Банковская карта».',
  bad_url: 'Адрес партнёра не подходит.', exists: 'Такой идентификатор уже есть.', code_already_used: 'Код пополнения уже активирован.',
  bad_amount: 'Неверная сумма.', refund_open: 'Возврат по платежу уже запрошен.', too_many_attempts: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string, extra?: { message?: string; field?: string }) => (extra?.message && e === 'bad_url' ? extra.message : (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`);

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: string, path: string, body?: unknown) => {
  const r = await apiCall<Data>(`${A}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return r.ok ? { ok: true as const, data: r.data as Data } : { ok: false as const, error: r.error, data: (r.data ?? {}) as Data };
};

const Wait = () => <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />;
const Btn = ({ children, onClick, disabled, tone = 'acc', title }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain'; title?: string }) => (
  <button type="button" title={title} disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Input = ({ label, value, onChange, type = 'text', placeholder, max }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string; max?: number }) => (
  <label className="block text-[11px]" style={{ color: C.t3 }}>{label}
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max} translate="no"
      className="mt-0.5 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} />
  </label>
);
const Check2 = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>
);

/* ── подтверждение личности ── */
const StepUp = ({ path, onCode, onCancel }: { path: string; onCode: (c: string) => void; onCancel: () => void }) => {
  const [method, setMethod] = useState<string | null>(null);
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    void call('POST', path, {}).then((r) => { if (!live) return; setBusy(false); if (r.ok) setMethod(String(r.data.method ?? 'email')); else setErr(errText(r.error)); });
    return () => { live = false; };
  }, [path]);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
      <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
      {busy && <Wait />}{err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {method && <p className="text-[11px]" style={{ color: C.t3 }}>{method === 'app' ? 'Код из приложения двухэтапной защиты.' : 'Код отправлен на почту, действует пять минут.'}</p>}
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения"
          className="flex-1 rounded-lg px-3 py-2 text-sm tracking-widest outline-none" style={field} />
        <Btn disabled={code.length < 6} onClick={() => onCode(code)}>Подтвердить</Btn>
      </div>
      <button type="button" onClick={onCancel} className="min-h-[36px] rounded-xl px-4 py-2 text-xs font-bold" style={{ background: C.l1, color: C.t2, border: `1px solid ${C.brd}` }}>Отмена</button>
    </div>
  );
};

/* ═══════════ Заявки ═══════════ */
const STATUS_ORDER = ['awaiting_review', 'in_review', 'need_info', 'awaiting_owner', 'error', 'refund_requested', 'refund_processing', 'completed', 'awaiting_payment', 'created', 'rejected', 'cancelled_user', 'cancelled_system', 'expired', 'refunded_partial', 'refunded_full', 'confirmed', 'crediting', 'user_reported'];
const TONE = (s: string) => (['completed'].includes(s) ? C.green : ['rejected', 'error'].includes(s) ? C.red : ['awaiting_owner', 'need_info', 'refund_requested'].includes(s) ? C.amber : C.acc);

const Queue = ({ owner }: { owner: boolean }) => {
  const [status, setStatus] = useState(''); const [q, setQ] = useState('');
  const [list, setList] = useState<Data | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call('GET', `/payments?${new URLSearchParams({ ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`);
    if (r.ok) setList(r.data); else flash(errText(r.error));
  }, [status, q]);
  useEffect(() => { void call('GET', '/status-labels').then((r) => { if (r.ok) setLabels(r.data.labels ?? {}); }); }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 20000); return () => window.clearInterval(t); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус" className="rounded-xl px-3 py-2 text-sm" style={field}>
          <option value="">Все статусы</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{labels[s] ?? s}{list?.counts?.[s] ? ` (${list.counts[s]})` : ''}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Номер заявки или @ник" aria-label="Поиск" className="min-w-[10rem] flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={field} />
        <Btn tone="plain" onClick={() => void load()}><RefreshCw size={13} /></Btn>
      </div>
      {!list && <Wait />}
      {list?.items?.length === 0 && <p className="text-sm" style={{ color: C.t3 }}>Заявок нет.</p>}
      {list?.items?.map((p: Data) => (
        <div key={p.id}>
          <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left" style={{ background: C.l1, border: `1px solid ${open === p.id ? C.acc : C.brd}` }} data-kk-row={p.number}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold" style={{ color: C.t1 }}><span translate="no">{p.number}</span> · {rub(p.amount)} <span className="text-[11px] font-normal" style={{ color: C.t3 }}>{p.destination === 'code' ? 'в код' : 'на баланс'}</span></p>
              <p className="truncate text-[11px]" style={{ color: C.t3 }} translate="no">@{p.username} · {p.methodTitle || '—'} · {p.app} · {dt(p.reportedAt ?? p.createdAt)}</p>
            </div>
            <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: `${TONE(p.status)}22`, color: TONE(p.status) }}>{p.statusLabel}</span>
          </button>
          {open === p.id && <PaymentCard id={p.id} owner={owner} onChanged={() => void load()} />}
        </div>
      ))}
    </div>
  );
};

type Pending = { action: string; extra: Data; path: 'step-up' | null; refund?: { id: string; kind: string } };

const PaymentCard = ({ id, owner, onChanged }: { id: string; owner: boolean; onChanged: () => void }) => {
  const [d, setD] = useState<Data | null>(null);
  const [note, setNote] = useState(''); const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<Pending | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await call('GET', `/payments/${id}`); if (r.ok) setD(r.data); else flash(errText(r.error)); }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (p: Pending, stepUpCode?: string) => {
    setBusy(true);
    const body = { ...p.extra, ...(stepUpCode ? { stepUpCode } : {}) };
    const r = p.refund
      ? await call('POST', `/payments/${id}/refunds/${p.refund.id}/${p.refund.kind}`, body)
      : p.action === 'refund' ? await call('POST', `/payments/${id}/refund`, body) : await call('POST', `/payments/${id}/act`, { action: p.action, ...body });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error, r.data)); if (!String(r.error).startsWith('step_up')) setPending(null); return; }
    setPending(null); setNote(''); setAmount(''); flash('Готово'); await load(); onChanged();
  };
  const go = (action: string, extra: Data = {}, needStep = false, refund?: Pending['refund']) => {
    const p: Pending = { action, extra, path: needStep ? 'step-up' : null, refund };
    if (needStep) setPending(p); else void run(p);
  };

  if (!d) return <div className="p-3"><Wait /></div>;
  const p = d.payment; const s = p.status; const sender = p.sender;
  const needNote = note.trim().length >= 5;
  const openRefund = (p.refunds ?? []).find((r: Data) => ['requested', 'processing'].includes(r.status));
  return (
    <div className="mt-1 space-y-3 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }} data-kk-card={p.number}>
      <div className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2" style={{ color: C.t2 }}>
        <span>Человек: <b translate="no" style={{ color: C.t1 }}>{d.user?.name} (@{d.user?.username})</b></span>
        <span>Сумма: <b style={{ color: C.t1 }}>{rub(p.amount)}</b>{p.fee > 0 ? ` (комиссия партнёра ${rub(p.fee)})` : ''}</span>
        <span>Способ: <b translate="no" style={{ color: C.t1 }}>{p.methodTitle || p.partnerTitle || '—'}</b></span>
        <span>Приложение: <b style={{ color: C.t1 }}>{p.app}</b></span>
        {p.requisites && <span className="sm:col-span-2" translate="no">Реквизит получателя: {p.requisites.recipient}, {p.requisites.identifier}; назначение: {p.requisites.purpose}</span>}
      </div>

      {sender && (
        <div className="rounded-lg p-2.5 text-[12px]" style={{ background: C.l2 }} translate="no">
          <p className="mb-1 font-bold" style={{ color: C.t1 }}>Данные отправителя (не доказательство оплаты)</p>
          <p style={{ color: C.t2 }}>{sender.fio} · {sender.idKind}: <b style={{ color: C.t1 }}>{sender.idNumber}</b>{Object.entries(sender.extra ?? {}).map(([k, v]) => ` · ${k}: ${String(v)}`)}</p>
          {sender.submitted && (sender.submitted.idNumber !== sender.idNumber || sender.submitted.fio !== sender.fio) && <p style={{ color: C.amber }}>При отправке было: {sender.submitted.fio} · {sender.submitted.idKind}: {sender.submitted.idNumber}</p>}
          {sender.changes?.map((c: Data, i: number) => <p key={i} style={{ color: C.amber }}>Изменено {dt(c.at)} (@{c.by}): «{c.reason}» → {c.after.fio}, {c.after.idNumber}</p>)}
        </div>
      )}

      {p.messages?.length > 0 && <div className="space-y-1 text-[12px]" translate="no">{p.messages.map((m: Data) => <p key={m.id} style={{ color: m.fromStaff ? C.acc : C.t2 }}>{m.fromStaff ? 'Администрация' : 'Человек'} · {dt(m.at)}: {m.body}</p>)}</div>}
      {p.refunds?.length > 0 && <div className="space-y-0.5 text-[12px]" style={{ color: C.t2 }}>{p.refunds.map((r: Data) => <p key={r.id} translate="no">Возврат {rub(r.amount)} — {r.status}{r.reason ? `: ${r.reason}` : ''}{r.declineReason ? ` (отказ: ${r.declineReason})` : ''}</p>)}</div>}

      <details className="text-[11px]" style={{ color: C.t3 }}>
        <summary className="cursor-pointer">Журнал статусов и решений</summary>
        <div className="mt-1 space-y-0.5" translate="no">
          {d.statusLog.map((l: Data, i: number) => <p key={i}>{dt(l.at)} · {l.from ?? '∅'} → <b>{l.to}</b> · {l.kind}{l.by ? ` @${l.by}` : ''}{l.reason ? ` · ${l.reason}` : ''}</p>)}
          {d.reviews.map((l: Data, i: number) => <p key={`r${i}`}>{dt(l.at)} · решение {l.decision}{l.by ? ` @${l.by}` : ''}{l.note ? ` · ${l.note}` : ''}</p>)}
        </div>
      </details>

      {/* действия */}
      <div className="space-y-2">
        {['in_review', 'need_info', 'awaiting_owner', 'refund_requested'].includes(s) || (s === 'completed') || (s === 'refunded_partial') ? (
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} translate="no" placeholder="Комментарий / причина / сообщение человеку"
            aria-label="Комментарий" className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none" style={field} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {s === 'awaiting_review' && <Btn disabled={busy} onClick={() => go('take')}>Взять в работу</Btn>}
          {s === 'in_review' && <Btn disabled={busy || !needNote} onClick={() => go('request_info', { message: note })}>Запросить сведения</Btn>}
          {s === 'in_review' && <Btn disabled={busy} onClick={() => go('forward', { note })}>Передать владельцу</Btn>}
          {['awaiting_review', 'in_review', 'need_info'].includes(s) && <Btn tone="red" disabled={busy || !needNote} onClick={() => go('reject', { reason: note })}>Отклонить</Btn>}
          {owner && s === 'awaiting_owner' && <Btn disabled={busy} title="Зачислить средства" onClick={() => go('owner_confirm', { note }, true)}><Check size={12} className="mr-1 inline" />Подтвердить и зачислить</Btn>}
          {owner && s === 'awaiting_owner' && <Btn tone="plain" disabled={busy} onClick={() => go('owner_return', { note })}>Вернуть на проверку</Btn>}
          {owner && ['awaiting_owner', 'error'].includes(s) && <Btn tone="red" disabled={busy || !needNote} onClick={() => go('owner_reject', { reason: note })}><X size={12} className="mr-1 inline" />Отклонить</Btn>}
          {owner && s === 'error' && <Btn disabled={busy} onClick={() => go('owner_retry', { note }, true)}>Повторить зачисление</Btn>}
          {['completed', 'refunded_partial'].includes(s) && <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="Сумма (пусто — весь остаток)" aria-label="Сумма возврата" className="w-44 rounded-lg px-2.5 py-1.5 text-xs outline-none" style={field} />}
          {['completed', 'refunded_partial'].includes(s) && <Btn tone="plain" disabled={busy || !needNote} onClick={() => go('refund', { reason: note, ...(amount ? { amount: Number(amount) } : {}) })}>Запросить возврат</Btn>}
          {owner && s === 'refund_requested' && openRefund && <Btn disabled={busy} onClick={() => go('process', {}, true, { id: openRefund.id, kind: 'process' })}>Принять возврат и списать</Btn>}
          {owner && s === 'refund_requested' && openRefund && <Btn tone="red" disabled={busy || !needNote} onClick={() => go('decline', { reason: note }, false, { id: openRefund.id, kind: 'decline' })}>Отклонить возврат</Btn>}
          {owner && s === 'refund_processing' && openRefund && <Btn disabled={busy} onClick={() => go('finish', {}, true, { id: openRefund.id, kind: 'finish' })}>Деньги возвращены</Btn>}
        </div>
        {!owner && ['awaiting_owner', 'error', 'refund_requested', 'refund_processing'].includes(s) && <p className="text-[11px]" style={{ color: C.t3 }}>Дальше решает владелец: зачисление и возвраты подтверждает только он.</p>}
        {busy && <Wait />}
        {pending?.path && <StepUp path="/step-up" onCode={(c) => void run(pending, c)} onCancel={() => setPending(null)} />}
      </div>
    </div>
  );
};

/* ═══════════ Способы, реквизиты ═══════════ */
const DESTS: [string, string][] = [['balance', 'на баланс'], ['code', 'код пополнения']];
const APPS = ['web', 'android', 'windows', 'ios', 'tv', 'console', 'car'];
const KINDS = ['card', 'phone', 'account', 'other'];

const MethodForm = ({ m, onDone }: { m: Data | null; onDone: () => void }) => {
  const [f, setF] = useState<Data>(() => ({
    title: m?.title ?? '', description: m?.description ?? '', instruction: m?.instruction ?? '', min: m?.min ?? 100, max: m?.max ?? 100000, sort: m?.sort ?? 100,
    enabled: m?.enabled ?? false, destinations: m?.destinations ?? ['balance', 'code'], apps: m?.apps ?? [], senderKinds: m?.senderKinds ?? KINDS, senderFields: m?.senderFields ?? [], kind: m?.kind ?? 'custom',
  }));
  const [step, setStep] = useState(false);
  const toggle = (k: string, v: string) => setF((o) => ({ ...o, [k]: o[k].includes(v) ? o[k].filter((x: string) => x !== v) : [...o[k], v] }));
  const save = async (code: string) => {
    const body = { ...f, min: Number(f.min), max: Number(f.max), sort: Number(f.sort), stepUpCode: code };
    const r = m ? await call('PUT', `/methods/${m.id}`, body) : await call('POST', '/methods', body);
    if (!r.ok) { flash(errText(r.error, r.data)); if (!String(r.error).startsWith('step_up')) setStep(false); return; }
    flash('Сохранено'); setStep(false); onDone();
  };
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
      <Input label="Название (видит человек)" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={80} />
      <Input label="Описание" value={f.description} onChange={(v) => setF({ ...f, description: v })} max={300} />
      <label className="block text-[11px]" style={{ color: C.t3 }}>Инструкция человеку
        <textarea value={f.instruction} onChange={(e) => setF({ ...f, instruction: e.target.value })} rows={3} maxLength={800} translate="no" className="mt-0.5 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} /></label>
      <div className="grid grid-cols-3 gap-2">
        <Input label="Мин., ₽" type="number" value={f.min} onChange={(v) => setF({ ...f, min: v })} />
        <Input label="Макс., ₽" type="number" value={f.max} onChange={(v) => setF({ ...f, max: v })} />
        <Input label="Порядок" type="number" value={f.sort} onChange={(v) => setF({ ...f, sort: v })} />
      </div>
      <div className="flex flex-wrap gap-3">{DESTS.map(([k, l]) => <Check2 key={k} label={l} value={f.destinations.includes(k)} onChange={() => toggle('destinations', k)} />)}</div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Приложения (ничего не выбрано — везде):</p>
      <div className="flex flex-wrap gap-3">{APPS.map((a) => <Check2 key={a} label={a} value={f.apps.includes(a)} onChange={() => toggle('apps', a)} />)}</div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Чем может переводить отправитель:</p>
      <div className="flex flex-wrap gap-3">{KINDS.map((a) => <Check2 key={a} label={a} value={f.senderKinds.includes(a)} onChange={() => toggle('senderKinds', a)} />)}</div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Дополнительные поля данных отправителя (PIN, CVV, пароли и коды из SMS запрещены):</p>
      {f.senderFields.map((x: Data, i: number) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2">
          <Input label="Ключ (a-z)" value={x.key} onChange={(v) => setF({ ...f, senderFields: f.senderFields.map((y: Data, j: number) => (j === i ? { ...y, key: v } : y)) })} max={30} />
          <Input label="Подпись" value={x.label} onChange={(v) => setF({ ...f, senderFields: f.senderFields.map((y: Data, j: number) => (j === i ? { ...y, label: v } : y)) })} max={60} />
          <Check2 label="обяз." value={Boolean(x.required)} onChange={(v) => setF({ ...f, senderFields: f.senderFields.map((y: Data, j: number) => (j === i ? { ...y, required: v } : y)) })} />
          <button type="button" aria-label="Убрать поле" onClick={() => setF({ ...f, senderFields: f.senderFields.filter((_: Data, j: number) => j !== i) })}><Trash2 size={14} style={{ color: C.red }} /></button>
        </div>
      ))}
      <Btn tone="plain" onClick={() => setF({ ...f, senderFields: [...f.senderFields, { key: '', label: '', type: 'text', required: false }] })}><Plus size={12} className="mr-1 inline" />Поле</Btn>
      <Check2 label="Способ включён" value={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
      {step ? <StepUp path="/settings-step-up" onCode={(c) => void save(c)} onCancel={() => setStep(false)} />
        : <div className="flex gap-2"><Btn disabled={f.title.trim().length < 2} onClick={() => setStep(true)}>Сохранить</Btn><Btn tone="plain" onClick={onDone}>Закрыть</Btn></div>}
    </div>
  );
};

const ID_KIND_RU: Record<string, string> = { account: 'Расчётный счёт', card: 'Банковская карта', phone: 'Телефон (СБП)', other: 'Другое' };
const ID_LABEL: Record<string, string> = { account: 'Расчётный счёт (20 цифр)', card: 'Номер карты (16–19 цифр)', phone: 'Номер телефона (+7 900 000-00-00)', other: 'Идентификатор (например, никнейм кошелька)' };
const BANK_LINES: Array<[string, string]> = [['bik', 'БИК'], ['corr', 'Корр. счёт'], ['inn', 'ИНН']];
/** БИК, корр. счёт и ИНН хранятся строками в «Пояснении», которое видит человек. */
const splitInstruction = (text: string) => {
  const out: Data = { bik: '', corr: '', inn: '', note: [] as string[] };
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(БИК|Корр\. счёт|ИНН):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1] === 'БИК' ? 'bik' : m[1] === 'ИНН' ? 'inn' : 'corr'] = m[2]; else if (line.trim()) out.note.push(line.trim());
  }
  return { bik: out.bik as string, corr: out.corr as string, inn: out.inn as string, note: (out.note as string[]).join('\n') };
};

const RequisiteForm = ({ r, methodId, onDone }: { r: Data | null; methodId: string; onDone: () => void }) => {
  const [f, setF] = useState<Data>(() => ({
    methodId, label: r?.label ?? '', recipient: r?.recipient ?? '', bank: r?.bank ?? '', idKind: r?.idKind ?? 'account', identifier: r?.identifier ?? '',
    purpose: r?.purpose ?? 'Пополнение Sky, заявка {number}', ...(() => { const x = splitInstruction(r?.instruction ?? ''); return { instruction: x.note, bik: x.bik, corr: x.corr, inn: x.inn }; })(), priority: r?.priority ?? 100, primary: r?.primary ?? false, enabled: r?.enabled ?? true,
    destinations: r?.destinations ?? null,
  }));
  const [step, setStep] = useState(false);
  const save = async (code: string) => {
    const bank = f.idKind === 'account' ? BANK_LINES.filter(([k]) => String(f[k] ?? '').trim()).map(([k, l]) => `${l}: ${String(f[k]).trim()}`) : [];
    const instruction = [...bank, String(f.instruction ?? '').trim()].filter(Boolean).join('\n').slice(0, 600);
    const body = { ...f, instruction, priority: Number(f.priority), stepUpCode: code };
    const res = r ? await call('PUT', `/requisites/${r.id}`, body) : await call('POST', '/requisites', body);
    if (!res.ok) { flash(errText(res.error, res.data)); if (!String(res.error).startsWith('step_up')) setStep(false); return; }
    flash('Сохранено'); setStep(false); onDone();
  };
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
      <Input label="Получатель (ФИО или организация)" value={f.recipient} onChange={(v) => setF({ ...f, recipient: v })} max={160} />
      <Input label="Банк" value={f.bank} onChange={(v) => setF({ ...f, bank: v })} max={120} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px]" style={{ color: C.t3 }}>Тип
          <select value={f.idKind} onChange={(e) => setF({ ...f, idKind: e.target.value })} className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
            {KINDS.map((k) => <option key={k} value={k}>{ID_KIND_RU[k] ?? k}</option>)}</select></label>
        <Input label={ID_LABEL[f.idKind] ?? 'Номер'} value={f.identifier} onChange={(v) => setF({ ...f, identifier: v })} max={64} />
      </div>
      {f.idKind === 'account' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input label="БИК банка (9 цифр)" value={f.bik} onChange={(v) => setF({ ...f, bik: v })} max={9} />
          <Input label="Корр. счёт (20 цифр)" value={f.corr} onChange={(v) => setF({ ...f, corr: v })} max={20} />
          <Input label="ИНН получателя" value={f.inn} onChange={(v) => setF({ ...f, inn: v })} max={12} />
        </div>
      )}
      <Input label="Назначение платежа ({number} — номер заявки)" value={f.purpose} onChange={(v) => setF({ ...f, purpose: v })} max={200} />
      <Input label="Пояснение для человека" value={f.instruction} onChange={(v) => setF({ ...f, instruction: v })} max={600} />
      <Input label="Приоритет (меньше — раньше)" type="number" value={f.priority} onChange={(v) => setF({ ...f, priority: v })} />
      <div className="flex flex-wrap gap-4">
        <Check2 label="Основной" value={f.primary} onChange={(v) => setF({ ...f, primary: v })} />
        <Check2 label="Включён" value={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
      </div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Уже созданные платежи сохраняют реквизиты, которые были показаны человеку.</p>
      {step ? <StepUp path="/settings-step-up" onCode={(c) => void save(c)} onCancel={() => setStep(false)} />
        : <div className="flex gap-2"><Btn disabled={f.recipient.trim().length < 3 || (!r && !f.identifier)} onClick={() => setStep(true)}>Сохранить</Btn><Btn tone="plain" onClick={onDone}>Закрыть</Btn></div>}
    </div>
  );
};

const Setup = () => {
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<string | null>(null);   // 'm:<id>' | 'm:new' | 'r:<id>' | 'r:new:<methodId>'
  const [hist, setHist] = useState<{ id: string; items: Data[] } | null>(null);
  const [del, setDel] = useState<{ kind: 'methods' | 'requisites'; id: string } | null>(null);
  const load = useCallback(async () => { const r = await call('GET', '/overview'); if (r.ok) setD(r.data); else flash(errText(r.error)); }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (kind: 'methods' | 'requisites', id: string, enabled: boolean) => {
    const r = await call('PUT', `/${kind}/${id}`, { enabled });
    if (!r.ok) { flash(errText(r.error, r.data)); return; }
    if (enabled) { flash('Для включения нужно подтверждение — откройте «Изменить» и сохраните.'); }
    void load();
  };
  if (!d) return <Wait />;
  const done = () => { setEdit(null); void load(); };
  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: C.t3 }}>Реквизиты и способы меняются только с подтверждением личности, каждое изменение пишется в журнал администрации и уведомляет владельца. Выключить можно без кода.</p>
      <Btn onClick={() => setEdit('m:new')}><Plus size={12} className="mr-1 inline" />Новый способ оплаты</Btn>
      {edit === 'm:new' && <MethodForm m={null} onDone={done} />}
      {d.methods.map((m: Data) => (
        <div key={m.id} className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }} data-kk-method={m.title}>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-bold" style={{ color: C.t1 }} translate="no">{m.title} <span className="text-[11px] font-normal" style={{ color: C.t3 }}>{rub(m.min)}–{rub(m.max)}</span></p>
            <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: m.enabled ? 'rgba(52,211,153,.15)' : C.l2, color: m.enabled ? C.green : C.t3 }}>{m.enabled ? 'Включён' : 'Выключен'}</span>
            {m.enabled && <Btn tone="plain" onClick={() => void toggle('methods', m.id, false)}>Выключить</Btn>}
            <Btn tone="plain" onClick={() => setEdit(edit === `m:${m.id}` ? null : `m:${m.id}`)}>Изменить</Btn>
            <button type="button" aria-label="Удалить способ" onClick={() => setDel({ kind: 'methods', id: m.id })}><Trash2 size={14} style={{ color: C.red }} /></button>
          </div>
          {edit === `m:${m.id}` && <MethodForm m={m} onDone={done} />}
          {d.requisites.filter((r: Data) => r.methodId === m.id).map((r: Data) => (
            <div key={r.id} className="rounded-lg p-2" style={{ background: C.l2 }}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-[12px]" style={{ color: C.t1 }} translate="no">{r.recipient} · {r.bank} · {r.masked}{r.primary ? ' · основной' : ''} · приоритет {r.priority}</p>
                <span className="text-[10px] font-bold" style={{ color: r.enabled ? C.green : C.t3 }}>{r.enabled ? 'включён' : 'выключен'}</span>
                {r.enabled && <Btn tone="plain" onClick={() => void toggle('requisites', r.id, false)}>Выключить</Btn>}
                <Btn tone="plain" onClick={() => setEdit(edit === `r:${r.id}` ? null : `r:${r.id}`)}>Изменить</Btn>
                <button type="button" aria-label="История реквизита" onClick={async () => { const h = await call('GET', `/requisites/${r.id}/history`); if (h.ok) setHist({ id: r.id, items: h.data.items }); }}><History size={14} style={{ color: C.t2 }} /></button>
                <button type="button" aria-label="Удалить реквизит" onClick={() => setDel({ kind: 'requisites', id: r.id })}><Trash2 size={14} style={{ color: C.red }} /></button>
              </div>
              {edit === `r:${r.id}` && <RequisiteForm r={r} methodId={m.id} onDone={done} />}
              {hist && hist.id === r.id && <div className="mt-1 space-y-0.5 text-[11px]" style={{ color: C.t3 }} translate="no">{hist.items.map((h, i) => <p key={i}>{dt(h.at)} @{h.by} · {h.action} {JSON.stringify(h.detail)}</p>)}</div>}
            </div>
          ))}
          <Btn tone="plain" onClick={() => setEdit(`r:new:${m.id}`)}><Plus size={12} className="mr-1 inline" />Реквизит</Btn>
          {edit === `r:new:${m.id}` && <RequisiteForm r={null} methodId={m.id} onDone={done} />}
        </div>
      ))}
      {del && (
        <DeleteConfirm onCancel={() => setDel(null)} onCode={async (code) => {
          const r = await call('DELETE', `/${del.kind}/${del.id}`, { stepUpCode: code });
          if (!r.ok) { flash(errText(r.error)); if (!String(r.error).startsWith('step_up')) setDel(null); return; }
          flash('Удалено (история платежей сохранена)'); setDel(null); void load();
        }} />
      )}
    </div>
  );
};

const DeleteConfirm = ({ onCode, onCancel }: { onCode: (c: string) => void; onCancel: () => void }) => (
  <div className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.red}` }}>
    <p className="text-xs font-bold" style={{ color: C.red }}>Удалить? Платежи, уже созданные с этим способом или реквизитом, не пострадают.</p>
    <StepUp path="/settings-step-up" onCode={onCode} onCancel={onCancel} />
  </div>
);

/* ═══════════ Партнёры ═══════════ */
const PartnerForm = ({ p, onDone }: { p: Data | null; onDone: () => void }) => {
  const [f, setF] = useState<Data>(() => ({
    id: p?.id ?? '', title: p?.title ?? '', logo: p?.logo ?? '', baseUrl: p?.baseUrl ?? '', min: p?.min ?? 100, max: p?.max ?? 100000, feePercent: p?.feePercent ?? 0, feeFixed: p?.feeFixed ?? 0,
    methods: (p?.methods ?? []).join(', '), note: p?.note ?? '', enabled: p?.enabled ?? false, sort: p?.sort ?? 100,
  }));
  const [step, setStep] = useState(false);
  const save = async (code: string) => {
    const body = { ...f, min: Number(f.min), max: Number(f.max), feePercent: Number(f.feePercent), feeFixed: Number(f.feeFixed), sort: Number(f.sort), methods: String(f.methods).split(',').map((x) => x.trim()).filter(Boolean), stepUpCode: code };
    const r = p ? await call('PUT', `/partners/${p.id}`, body) : await call('POST', '/partners', body);
    if (!r.ok) { flash(errText(r.error, r.data)); if (!String(r.error).startsWith('step_up')) setStep(false); return; }
    flash('Сохранено'); setStep(false); onDone();
  };
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
      {!p && <Input label="Идентификатор (латиница, например yookassa)" value={f.id} onChange={(v) => setF({ ...f, id: v.toLowerCase() })} max={31} />}
      <Input label="Название" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={80} />
      <Input label="Логотип (https-адрес или путь)" value={f.logo} onChange={(v) => setF({ ...f, logo: v })} max={300} />
      <Input label="Адрес API партнёра (https)" value={f.baseUrl} onChange={(v) => setF({ ...f, baseUrl: v })} max={300} />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Мин., ₽" type="number" value={f.min} onChange={(v) => setF({ ...f, min: v })} />
        <Input label="Макс., ₽" type="number" value={f.max} onChange={(v) => setF({ ...f, max: v })} />
        <Input label="Комиссия, %" type="number" value={f.feePercent} onChange={(v) => setF({ ...f, feePercent: v })} />
        <Input label="Комиссия фиксированная, ₽" type="number" value={f.feeFixed} onChange={(v) => setF({ ...f, feeFixed: v })} />
      </div>
      <Input label="Способы партнёра (через запятую: Карта, СБП)" value={f.methods} onChange={(v) => setF({ ...f, methods: v })} />
      <Input label="Заметка для людей" value={f.note} onChange={(v) => setF({ ...f, note: v })} max={300} />
      <Check2 label="Включён" value={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
      <p className="text-[11px]" style={{ color: C.t3 }}>Ключи и секреты вносятся только в окружение сервера (.env), здесь их нет и быть не может.</p>
      {step ? <StepUp path="/settings-step-up" onCode={(c) => void save(c)} onCancel={() => setStep(false)} />
        : <div className="flex gap-2"><Btn disabled={f.title.trim().length < 2 || (!p && f.id.length < 2)} onClick={() => setStep(true)}>Сохранить</Btn><Btn tone="plain" onClick={onDone}>Закрыть</Btn></div>}
    </div>
  );
};

const Partners = () => {
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await call('GET', '/overview'); if (r.ok) setD(r.data); else flash(errText(r.error)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Wait />;
  const done = () => { setEdit(null); void load(); };
  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: C.t3 }}>Партнёр считается подключённым, только если в окружении сервера заданы секрет и номер магазина. Платёж партнёра зачисляется лишь после того, как сервер сам проверил оплату у партнёра.</p>
      <Btn onClick={() => setEdit('new')}><Plus size={12} className="mr-1 inline" />Новый партнёр</Btn>
      {edit === 'new' && <PartnerForm p={null} onDone={done} />}
      {d.partners.length === 0 && <p className="text-sm" style={{ color: C.t3 }}>Партнёров нет.</p>}
      {d.partners.map((p: Data) => (
        <div key={p.id} className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }} data-kk-partner={p.id}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm font-bold" style={{ color: C.t1 }} translate="no">{p.title} <span className="text-[11px] font-normal" style={{ color: C.t3 }}>{p.id} · {rub(p.min)}–{rub(p.max)} · {p.feePercent}% + {rub(p.feeFixed)}</span></p>
            <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: p.connected ? 'rgba(52,211,153,.15)' : 'rgba(251,191,36,.15)', color: p.connected ? C.green : C.amber }}>{p.connected ? 'Подключён' : 'Не подключён'}</span>
            <span className="text-[10px] font-bold" style={{ color: p.enabled ? C.green : C.t3 }}>{p.enabled ? 'включён' : 'выключен'}</span>
          </div>
          {!p.connected && <p className="text-[11px]" style={{ color: C.amber }} translate="no">Нет в окружении сервера: {p.secretsMissing.join(', ') || 'адрес API'}{!p.baseUrl ? ' · не указан адрес API' : ''}</p>}
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">Адрес для событий: {p.webhookPath}{p.lastCheckAt ? ` · проверка ${dt(p.lastCheckAt)}: ${p.lastCheckOk ? 'связь есть' : p.lastCheckMsg || 'нет связи'}` : ' · связь не проверялась'}</p>
          <div className="flex flex-wrap gap-2">
            <Btn tone="plain" onClick={async () => { const r = await call('POST', `/partners/${p.id}/check`, {}); flash(r.ok ? (r.data.ok ? 'Связь есть' : `Нет связи: ${r.data.message}`) : errText(r.error)); void load(); }}>Проверить связь</Btn>
            {p.enabled && <Btn tone="plain" onClick={async () => { const r = await call('PUT', `/partners/${p.id}`, { enabled: false }); flash(r.ok ? 'Выключен' : errText(r.error, r.data)); void load(); }}>Выключить</Btn>}
            <Btn tone="plain" onClick={() => setEdit(edit === p.id ? null : p.id)}>Изменить</Btn>
            <Btn tone="red" onClick={() => setDel(p.id)}>Удалить</Btn>
          </div>
          {edit === p.id && <PartnerForm p={p} onDone={done} />}
        </div>
      ))}
      {del && <DeleteConfirm onCancel={() => setDel(null)} onCode={async (code) => {
        const r = await call('DELETE', `/partners/${del}`, { stepUpCode: code });
        if (!r.ok) { flash(errText(r.error)); if (!String(r.error).startsWith('step_up')) setDel(null); return; }
        flash('Удалено'); setDel(null); void load();
      }} />}
    </div>
  );
};

/* ═══════════ Параметры ═══════════ */
const Params = () => {
  const [s, setS] = useState<Data | null>(null);
  useEffect(() => { void call('GET', '/overview').then((r) => { if (r.ok) setS(r.data.settings); else flash(errText(r.error)); }); }, []);
  if (!s) return <Wait />;
  const save = async (patch: Data) => {
    const r = await call('PUT', '/settings', patch);
    if (!r.ok) { flash(errText(r.error, r.data)); return; }
    setS(r.data.settings); flash('Сохранено');
  };
  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${s.paused ? C.red : C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Приём новых платежей: {s.paused ? 'приостановлен' : 'идёт'}</p>
        <p className="text-[11px]" style={{ color: C.t3 }}>Уже созданные платежи завершаются как обычно.</p>
        <div className="mt-2"><Btn tone={s.paused ? 'acc' : 'red'} onClick={() => { if (s.paused || window.confirm('Приостановить приём новых платежей?')) void save({ paused: !s.paused }); }}>{s.paused ? 'Возобновить приём' : 'Приостановить приём'}</Btn></div>
      </div>
      <ParamsForm s={s} onSave={save} />
    </div>
  );
};
const ParamsForm = ({ s, onSave }: { s: Data; onSave: (p: Data) => Promise<void> }) => {
  const [f, setF] = useState<Data>(s);
  return (
    <div className="space-y-2 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <Input label="Сообщение при паузе (видят люди)" value={f.pauseMessage} onChange={(v) => setF({ ...f, pauseMessage: v })} max={300} />
      <Input label="Объявление на странице оплаты" value={f.notice} onChange={(v) => setF({ ...f, notice: v })} max={300} />
      <div className="grid grid-cols-2 gap-2">
        <Input label="Минимальная сумма, ₽" type="number" value={f.minAmount} onChange={(v) => setF({ ...f, minAmount: v })} />
        <Input label="Максимальная сумма, ₽" type="number" value={f.maxAmount} onChange={(v) => setF({ ...f, maxAmount: v })} />
        <Input label="Срок платежа, минут" type="number" value={f.ttlMinutes} onChange={(v) => setF({ ...f, ttlMinutes: v })} />
        <Input label="Срок кода пополнения, дней" type="number" value={f.codeTtlDays} onChange={(v) => setF({ ...f, codeTtlDays: v })} />
      </div>
      <Check2 label="Оплата через партнёров разрешена" value={f.partnersEnabled} onChange={(v) => setF({ ...f, partnersEnabled: v })} />
      <p className="text-[11px]" style={{ color: C.t3 }}>Доступность по приложениям:</p>
      <div className="flex flex-wrap gap-3">{APPS.map((a) => <Check2 key={a} label={a} value={f.apps[a] !== false} onChange={(v) => setF({ ...f, apps: { ...f.apps, [a]: v } })} />)}</div>
      <Btn onClick={() => void onSave({ ...f, minAmount: Number(f.minAmount), maxAmount: Number(f.maxAmount), ttlMinutes: Number(f.ttlMinutes), codeTtlDays: Number(f.codeTtlDays) })}>Сохранить параметры</Btn>
    </div>
  );
};

/* ═══════════ Вкладка ═══════════ */
export const SkyKassaTab = ({ owner, canReview, canSettings }: { owner: boolean; canReview: boolean; canSettings: boolean }) => {
  const tabs = [
    ...(canReview ? [{ key: 'queue', label: 'Заявки' }] : []),
    ...(canSettings ? [{ key: 'setup', label: 'Способы и реквизиты' }, { key: 'partners', label: 'Партнёры' }, { key: 'params', label: 'Параметры' }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.key ?? 'queue');
  return (
    <div className="space-y-3" data-skykassa-admin>
      <ScrollTabs>
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold"
            style={tab === t.key ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{t.label}</button>
        ))}
      </ScrollTabs>
      {tab === 'queue' && canReview && <Queue owner={owner} />}
      {tab === 'setup' && canSettings && <Setup />}
      {tab === 'partners' && canSettings && <Partners />}
      {tab === 'params' && canSettings && <Params />}
    </div>
  );
};
