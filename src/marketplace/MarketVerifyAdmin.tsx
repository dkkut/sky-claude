/**
 * Админ-панель: проверка продавцов, модерация карточек, жалобы и
 * апелляции, правила допуска, заявки на ПВЗ.
 *
 * Кнопки рисуются по правам, которые сообщила сервер, но решает всё
 * равно сервер: каждое действие он проверяет заново и пишет в журнал.
 * Сотрудник проверки документов видит заявки и просит исправления;
 * одобряют, отклоняют и приостанавливают магазины — администраторы Market.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Eye, Check, X } from 'lucide-react';
import { C, inputStyle, fmtTime } from './ui';
import { countryName } from './countries';
import {
  apiAdminApplications, apiAdminApplication, apiAdminAppAction, apiAdminReviewDoc, apiAdminSellerAction,
  apiModerationQueue, apiModerationDetail, apiModerate, apiAdminReports, apiResolveReport,
  apiAdminAppeals, apiDecideAppeal, apiRules, apiSetCategoryRule, apiSetSetting,
  apiAdminPvzApps, apiAdminPvzApp, apiAdminPvzAction, openDoc, apiVerifyConfig,
  apiAdminSellers, apiAdminPvzPoints, apiAdminPvzPointAction, type SellerAdminRow, type PvzPointAdminRow,
  REPORT_REASONS, type AdminAppRow, type AdminAppDetail, type ModRow, type ModDetail, type ReportRow,
  type AdminAppeal, type RulesOverview, type PvzAppRow, type DocView, type VerifyConfig,
} from './verifyApi';
import { MOD_LABEL, MOD_TINT } from './ProductCompliance';
import { TransfersAdmin } from './Transfers';

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', own_application: 'Нельзя решать собственную заявку.',
  own_product: 'Нельзя решать вопросы по собственному товару.', docs_not_accepted: 'Сначала примите все обязательные документы.',
  reason_required: 'Укажите причину.', wrong_state: 'Состояние уже изменилось — обновите список.',
  listing_blocked: 'Карточка не проходит правила — её должен исправить продавец.',
  pvz_needs_ip_or_legal: 'Статус заявителя больше не подходит для ПВЗ.', already_closed: 'Уже закрыто.', own_target: 'Нельзя блокировать собственный объект.', bad_action: 'Неизвестное действие.',
  too_many_requests: 'Слишком часто. Подождите минуту.',
};
const errOf = (r: { error?: string; reason?: string }) => ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось.';

const card = { background: C.l1, border: `1px solid ${C.brd}` } as const;
const inp = 'w-full rounded-xl px-3 py-2 text-[12px]';

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
    style={{ background: on ? C.acc : C.l2, color: on ? '#fff' : C.t3 }}>{children}</button>
);

const Docs = ({ docs, onChanged, canReview = true }: { docs: DocView[]; onChanged: () => void; canReview?: boolean }) => {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const act = async (id: string, accept: boolean) => {
    let comment = '';
    if (!accept) { comment = window.prompt('Причина отклонения документа') ?? ''; if (comment.trim().length < 3) return; }
    setBusy(id);
    const r = await apiAdminReviewDoc(id, accept, comment);
    setBusy('');
    if (!r.ok) { setMsg(errOf(r)); return; }
    onChanged();
  };
  if (docs.length === 0) return <p className="text-[11px]" style={{ color: C.t3 }}>Документов нет.</p>;
  return (
    <div className="space-y-1.5">
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2 }}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold" style={{ color: C.t1 }}>{d.typeLabel}</p>
            <p className="truncate" style={{ color: C.t3 }} translate="no">{d.label} · {Math.ceil(d.bytes / 1024)} КБ</p>
            {d.comment && <p style={{ color: C.t2 }} translate="no">{d.comment}</p>}
          </div>
          <span className="font-bold" style={{ color: d.status === 'accepted' ? C.green : d.status === 'rejected' ? C.red : C.amber }}>
            {d.status === 'accepted' ? 'Принят' : d.status === 'rejected' ? 'Отклонён' : 'Ждёт'}
          </span>
          <button type="button" aria-label="Открыть" onClick={() => void openDoc(d.id)} style={{ color: C.acc }}><Eye size={14} /></button>
          {canReview && (
            <>
              <button type="button" disabled={busy === d.id} aria-label="Принять" onClick={() => void act(d.id, true)} style={{ color: C.green }}><Check size={15} /></button>
              <button type="button" disabled={busy === d.id} aria-label="Отклонить" onClick={() => void act(d.id, false)} style={{ color: C.red }}><X size={15} /></button>
            </>
          )}
        </div>
      ))}
      {msg && <p className="text-[11px]" style={{ color: C.red }}>{msg}</p>}
    </div>
  );
};

/** Строка с причиной и кнопками действий; причину требует сервер там, где нужно. */
const Actions = ({ actions, onRun }: {
  actions: { key: string; label: string; tone?: 'ok' | 'bad' | 'neutral'; needsText?: boolean }[];
  onRun: (key: string, text: string) => Promise<string | null>;
}) => {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (key: string) => {
    setBusy(true); setMsg('');
    const e = await onRun(key, text.trim());
    setBusy(false);
    if (e) setMsg(e); else setText('');
  };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder="Комментарий / причина решения"
        className={inp} style={inputStyle} />
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button key={a.key} type="button" disabled={busy} onClick={() => void run(a.key)}
            className="rounded-xl px-3 py-1.5 text-[11px] font-bold disabled:opacity-40"
            style={{ background: a.tone === 'ok' ? C.green : a.tone === 'bad' ? C.red : C.l2, color: a.tone ? '#fff' : C.t1 }}>
            {a.label}
          </button>
        ))}
      </div>
      {msg && <p className="text-[11px]" style={{ color: C.red }}>{msg}</p>}
    </div>
  );
};

/* ── Заявки продавцов ─────────────────────────────────────────────── */

const ApplicationDetail = ({ id, canDecide, onBack, onChanged }: { id: string; canDecide: boolean; onBack: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<AdminAppDetail | null>(null);
  const [cfg, setCfg] = useState<VerifyConfig | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [r, c] = await Promise.all([apiAdminApplication(id), apiVerifyConfig()]);
    if (r.ok) setD(r.data); else setErr(errOf(r));
    if (c.ok) setCfg(c.data);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="p-3 text-[12px]" style={{ color: C.red }}>{err}</div>;
  if (!d) return <Loader2 className="m-4 animate-spin" style={{ color: C.t3 }} />;
  const a = d.application;
  const labels = new Map((cfg?.kinds.find((k) => k.key === a.kind)?.fields ?? []).map((f) => [f.key, f.label]));
  const closed = ['approved', 'rejected'].includes(a.status);

  const run = async (key: string, text: string): Promise<string | null> => {
    if (['suspend', 'reinstate', 'reverify'].includes(key)) {
      const r = await apiAdminSellerAction(d.profileId, key as 'suspend', text);
      if (!r.ok) return errOf(r);
    } else {
      const missing = key === 'request_changes' ? text.split('\n').map((x) => x.trim()).filter(Boolean).slice(1) : undefined;
      const comment = key === 'request_changes' ? text.split('\n')[0] : text;
      const r = await apiAdminAppAction(id, key, { comment, missing });
      if (!r.ok) return errOf(r);
    }
    await load(); onChanged();
    return null;
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К списку</button>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }}>{a.kindLabel} · {a.requestType === 'change' ? 'смена статуса' : 'первичная заявка'}</p>
        <p className="text-[11px]" style={{ color: C.t3 }} translate="no">
          {d.seller?.shopName} · {d.seller?.name} @{d.seller?.username} · статус магазина: {d.seller?.verification}
        </p>
        <p className="text-[11px]" style={{ color: C.t3 }}>Подана: {fmtTime(a.submittedAt)} · {a.status}</p>
        {a.uncertain && <p className="text-[11px] font-bold" style={{ color: C.amber }}>Заявитель просит проверить вручную: не уверен в виде деятельности.</p>}
      </div>

      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Анкета</p>
        {Object.entries(a.fields ?? {}).map(([k, v]) => (
          <p key={k} className="text-[12px]" style={{ color: C.t2 }}>
            <span style={{ color: C.t3 }}>{labels.get(k) ?? k}:</span> <span translate="no">{typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v) || '—'}</span>
          </p>
        ))}
        <p className="text-[12px]" style={{ color: C.t2 }}><span style={{ color: C.t3 }}>Страна:</span> {countryName(a.sellerCountry)}</p>
        <p className="text-[12px]" style={{ color: C.t2 }}><span style={{ color: C.t3 }}>Деятельность:</span> {a.activities.join(', ')}</p>
        <p className="text-[12px]" style={{ color: C.t2 }}><span style={{ color: C.t3 }}>Категории:</span> {a.categories.join(', ') || '—'}</p>
        <p className="whitespace-pre-wrap text-[12px]" style={{ color: C.t2 }} translate="no">{a.activityDescription}</p>
        <p className="text-[10px]" style={{ color: C.t3 }}>Открытие реквизитов записано в журнал администраторов.</p>
      </div>

      <div className="space-y-2 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Документы</p>
        <p className="text-[10px]" style={{ color: C.t3 }}>
          Обязательные: {a.requiredDocs.map((r) => r.label).join('; ') || 'нет'}. Подлинность проверяется вручную — интеграции с ФНС и реестрами нет.
        </p>
        <Docs docs={a.docs} onChanged={() => void load()} />
      </div>

      {!closed && (
        <div className="rounded-2xl p-3" style={card}>
          <Actions onRun={run} actions={[
            ...(a.status === 'submitted' ? [{ key: 'start_review', label: 'Взять на проверку' }] : []),
            { key: 'request_changes', label: 'Запросить исправления', needsText: true },
            ...(canDecide ? [{ key: 'approve', label: 'Одобрить', tone: 'ok' as const }, { key: 'reject', label: 'Отклонить', tone: 'bad' as const }] : []),
          ]} />
          <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
            «Запросить исправления»: первая строка — комментарий, следующие строки — список недостающего.
            {!canDecide && ' Одобрять и отклонять заявки могут администраторы Market.'}
          </p>
        </div>
      )}

      {canDecide && (
        <div className="space-y-1 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Магазин</p>
          <Actions onRun={run} actions={[
            { key: 'suspend', label: 'Приостановить', tone: 'bad' },
            { key: 'reinstate', label: 'Возобновить' },
            { key: 'reverify', label: 'На повторную проверку' },
          ]} />
        </div>
      )}

      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История решений</p>
        {d.history.map((h, i) => (
          <p key={i} className="text-[11px]" style={{ color: C.t2 }}>
            {fmtTime(h.at)} · {h.by === 'staff' ? 'сотрудник' : h.by === 'seller' ? 'продавец' : h.by} · {h.action}
            {h.comment && <span style={{ color: C.t3 }} translate="no"> · {h.comment}</span>}
          </p>
        ))}
        {d.earlier.length > 0 && (
          <>
            <p className="pt-1 text-[11px] font-bold" style={{ color: C.t1 }}>Прежние заявки</p>
            {d.earlier.map((e) => (
              <p key={e.id} className="text-[11px]" style={{ color: C.t3 }}>{e.kind} · {e.status}{e.isCurrent ? ' · действующая' : ''} · {fmtTime(e.decidedAt)}</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

const ApplicationsTab = ({ canDecide }: { canDecide: boolean }) => {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState<AdminAppRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await apiAdminApplications(status);
    if (r.ok) { setItems(r.data.items); setErr(''); } else { setItems([]); setErr(errOf(r)); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  if (open) return <ApplicationDetail id={open} canDecide={canDecide} onBack={() => setOpen(null)} onChanged={() => void load()} />;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['submitted', 'Новые'], ['in_review', 'На проверке'], ['needs_changes', 'Ждут исправлений'], ['approved', 'Одобренные'], ['rejected', 'Отклонённые'], ['all', 'Все']] as const)
          .map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}
      </div>
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}
      {items === null && <Loader2 className="animate-spin" style={{ color: C.t3 }} />}
      {items?.length === 0 && !err && <p className="text-[12px]" style={{ color: C.t3 }}>Заявок нет.</p>}
      {items?.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{a.shopName} · {a.name} @{a.username}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            {a.kindLabel} · {a.requestType === 'change' ? 'смена статуса' : 'первичная'} · ИНН …{a.innTail || '—'} · {a.status} · {fmtTime(a.submittedAt)}
          </p>
        </button>
      ))}
    </div>
  );
};

/* ── Модерация товаров ────────────────────────────────────────────── */

const ProductDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const [d, setD] = useState<ModDetail | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiModerationDetail(id); if (r.ok) setD(r.data); else setErr(errOf(r)); }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <div className="p-3 text-[12px]" style={{ color: C.red }}>{err}</div>;
  if (!d) return <Loader2 className="m-4 animate-spin" style={{ color: C.t3 }} />;
  const p = d.product;
  const run = async (key: string, text: string) => {
    const r = await apiModerate(id, key, text);
    if (!r.ok) return errOf(r) + (r.data?.check ? ` ${r.data.check.blockers.map((b: { message: string }) => b.message).join(' ')}` : '');
    await load(); onChanged(); return null;
  };
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К списку</button>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{p.title}</p>
        <p className="text-[11px]" style={{ color: MOD_TINT[p.moderationStatus ?? 'draft'] }}>{MOD_LABEL[p.moderationStatus ?? 'draft']}</p>
        <p className="text-[11px]" style={{ color: C.t3 }} translate="no">Магазин: {d.sellerShop} · статус: {d.sellerTaxKind ?? '—'} · проверка: {d.sellerVerification}</p>
        <p className="text-[12px]" style={{ color: C.t2 }}>{p.price} ₽ · категория {p.category} · остаток {p.stock}</p>
        <p className="whitespace-pre-wrap text-[12px]" style={{ color: C.t2 }} translate="no">{p.description}</p>
        <p className="text-[12px]" style={{ color: C.t2 }}>
          Происхождение: {countryName(p.originCountry) || '—'} · Отправка из: {countryName(p.shipFromCountry) || '—'} · Товар находится: {countryName(p.itemLocationCountry) || '—'}
          {p.intlShipping ? ' · международная доставка' : ''}
        </p>
        {p.importInfo && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">Сведения о ввозе: {p.importInfo}</p>}
        {p.markingDeclared && <p className="text-[12px]" style={{ color: C.t2 }}>Маркировка: {({ not_required: 'не подлежит', required: 'подлежит', unsure: 'не уверен' } as Record<string, string>)[p.markingDeclared]}</p>}
        {d.openReports > 0 && <p className="text-[11px] font-bold" style={{ color: C.red }}>Открытых жалоб: {d.openReports}</p>}
      </div>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Проверка по правилам</p>
        {d.verdict.blockers.map((b) => <p key={b.code} className="text-[11px]" style={{ color: C.red }}>✕ {b.message}</p>)}
        {d.verdict.review.map((b) => <p key={b.code} className="text-[11px]" style={{ color: C.amber }}>• {b.message}</p>)}
        {d.verdict.ok && d.verdict.review.length === 0 && <p className="text-[11px]" style={{ color: C.green }}>Замечаний нет.</p>}
        <p className="text-[10px]" style={{ color: C.t3 }}>Таможенной и государственной проверки Sky не проводит; документы смотрит модератор вручную.</p>
      </div>
      <div className="space-y-2 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Документы товара</p>
        <Docs docs={d.docs} onChanged={() => void load()} />
      </div>
      <div className="rounded-2xl p-3" style={card}>
        <Actions onRun={run} actions={[
          { key: 'approve', label: 'Одобрить и опубликовать', tone: 'ok' },
          { key: 'request_changes', label: 'Запросить исправления' },
          { key: 'hide', label: 'Скрыть' },
          { key: 'block', label: 'Заблокировать', tone: 'bad' },
          { key: 're_review', label: 'На повторную проверку' },
        ]} />
      </div>
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История</p>
        {d.history.map((h, i) => (
          <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtTime(h.at)} · {h.by} · {h.action}{h.reason && <span style={{ color: C.t3 }} translate="no"> · {h.reason}</span>}</p>
        ))}
      </div>
    </div>
  );
};

const ProductsTab = () => {
  const [status, setStatus] = useState('pending');
  const [foreign, setForeign] = useState(false);
  const [items, setItems] = useState<ModRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await apiModerationQueue(status, foreign);
    if (r.ok) { setItems(r.data.items); setErr(''); } else { setItems([]); setErr(errOf(r)); }
  }, [status, foreign]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <ProductDetail id={open} onBack={() => setOpen(null)} onChanged={() => void load()} />;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['pending', 'На проверке'], ['needs_changes', 'Ждут исправлений'], ['published', 'Опубликованные'], ['hidden', 'Скрытые'], ['blocked', 'Заблокированные'], ['all', 'Все']] as const)
          .map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}
        <Chip on={foreign} onClick={() => setForeign((v) => !v)}>Иностранные</Chip>
      </div>
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}
      {items === null && <Loader2 className="animate-spin" style={{ color: C.t3 }} />}
      {items?.length === 0 && !err && <p className="text-[12px]" style={{ color: C.t3 }}>Карточек нет.</p>}
      {items?.map((p) => (
        <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{p.title}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            <span translate="no">{p.shopName}</span> · {MOD_LABEL[p.status]} · {p.foreign ? 'иностранный · ' : ''}{fmtTime(p.submittedAt)}
          </p>
        </button>
      ))}
    </div>
  );
};

/* ── Жалобы и апелляции ───────────────────────────────────────────── */

const ReportsTab = () => {
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [appeals, setAppeals] = useState<AdminAppeal[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [r, a] = await Promise.all([apiAdminReports('open'), apiAdminAppeals('open')]);
    if (r.ok) setReports(r.data.items); else { setReports([]); setErr(errOf(r)); }
    if (a.ok) setAppeals(a.data.items); else setAppeals([]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Жалобы</p>
      {reports === null && <Loader2 className="animate-spin" style={{ color: C.t3 }} />}
      {reports?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Открытых жалоб нет.</p>}
      {reports?.map((r) => (
        <div key={r.id} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">
            {r.targetType === 'product' ? r.productTitle : r.shopName}
          </p>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            {REPORT_REASONS[r.reason] ?? r.reason} · {r.status} · жалоб на объект: {r.openSame} · {fmtTime(r.createdAt)}
          </p>
          {r.details && <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{r.details}</p>}
          <Actions onRun={async (key, text) => {
            const [outcome, apply] = key.split(':');
            const x = await apiResolveReport(r.id, outcome, text, apply);
            if (!x.ok) return errOf(x);
            await load(); return null;
          }} actions={[
            { key: 'in_review', label: 'Взять в работу' },
            { key: 'dismissed', label: 'Отклонить' },
            { key: 'upheld', label: 'Подтвердить' },
            ...(r.targetType === 'product' ? [{ key: 'upheld:hide', label: 'Подтвердить и скрыть' }, { key: 'upheld:block', label: 'Подтвердить и заблокировать', tone: 'bad' as const }] : []),
          ]} />
        </div>
      ))}

      <p className="pt-2 text-[12px] font-bold" style={{ color: C.t1 }}>Апелляции продавцов</p>
      {appeals?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Открытых апелляций нет.</p>}
      {appeals?.map((a) => (
        <div key={a.id} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{a.shopName} · {a.subjectType}</p>
          <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{a.text}</p>
          <Actions onRun={async (key, text) => {
            const x = await apiDecideAppeal(a.id, key === 'accept', text);
            if (!x.ok) return errOf(x);
            await load(); return null;
          }} actions={[{ key: 'accept', label: 'Принять', tone: 'ok' }, { key: 'reject', label: 'Отклонить', tone: 'bad' }]} />
        </div>
      ))}
    </div>
  );
};

/* ── Правила допуска ──────────────────────────────────────────────── */

const CATEGORY_RU: Record<string, string> = {
  electronics: 'Электроника', clothing: 'Одежда', home: 'Дом', beauty: 'Красота', sports: 'Спорт',
  books: 'Книги', toys: 'Игрушки', food: 'Еда', flowers: 'Цветы', other: 'Другое',
};
const KIND_RU: Record<string, string> = { individual: 'Физлицо', npd: 'НПД', ip: 'ИП', legal: 'Юрлицо' };

const RulesTab = () => {
  const [rules, setRules] = useState<RulesOverview | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await apiRules(); if (r.ok) setRules(r.data); else setErr(errOf(r)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p className="text-[12px]" style={{ color: C.red }}>{err}</p>;
  if (!rules) return <Loader2 className="animate-spin" style={{ color: C.t3 }} />;

  const save = async (cat: string, patch: Record<string, unknown>) => {
    const c = rules.categories.find((x) => x.key === cat)!;
    const body = {
      allowedKinds: c.override?.allowedKinds ?? null, requiredDocs: c.override?.requiredDocs ?? [],
      manualReview: c.effective.manualReview, markingPossible: c.effective.markingPossible, disabled: c.effective.disabled, ...patch,
    };
    const r = await apiSetCategoryRule(cat, body);
    setMsg(r.ok ? 'Сохранено.' : errOf(r));
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Жёсткие ограничения (не настраиваются)</p>
        {rules.hardRules.map((h) => <p key={h} className="text-[11px]" style={{ color: C.t2 }}>• {h}</p>)}
        <p className="text-[10px]" style={{ color: C.t3 }}>
          Настройки ниже могут только сузить допуск и добавить требования. Это продуктовая политика Sky, а не юридическое заключение:
          перечни документов и категорий с маркировкой нужно сверять с действующим законодательством и юристом.
        </p>
      </div>

      <div className="space-y-2 rounded-2xl p-3" style={card}>
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Модерация</p>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
          Предмодерация:
          <select value={rules.settings.premoderation} onChange={async (e) => { const r = await apiSetSetting('premoderation', e.target.value); setMsg(r.ok ? 'Сохранено.' : errOf(r)); await load(); }}
            className="rounded-lg px-2 py-1 text-[12px]" style={inputStyle}>
            <option value="risky">Только спорные карточки</option><option value="all">Все карточки</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: C.t2 }}>
          Предел активных товаров у физлица:
          <input defaultValue={rules.settings.individualMaxProducts} inputMode="numeric" className="w-20 rounded-lg px-2 py-1 text-[12px]" style={inputStyle}
            onBlur={async (e) => { const n = Number(e.target.value); if (n === rules.settings.individualMaxProducts) return; const r = await apiSetSetting('individualMaxProducts', n); setMsg(r.ok ? 'Сохранено.' : errOf(r)); await load(); }} />
        </label>
      </div>

      {rules.categories.map((c) => (
        <div key={c.key} className="space-y-2 rounded-2xl p-3" style={card}>
          <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{CATEGORY_RU[c.key] ?? c.key}</p>
          <div className="flex flex-wrap gap-1.5">
            {rules.kinds.map((k) => {
              const allowedBase = (c.base.allowedKinds ?? rules.kinds).includes(k);
              const on = c.effective.allowedKinds.includes(k);
              return (
                <button key={k} type="button" disabled={!allowedBase}
                  onClick={() => void save(c.key, { allowedKinds: on ? c.effective.allowedKinds.filter((x) => x !== k) : [...c.effective.allowedKinds, k] })}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-30"
                  style={{ background: on ? C.accBg : C.l2, color: on ? C.acc : C.t3 }}>
                  {KIND_RU[k]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: C.t2 }}>
            <label className="flex items-center gap-1"><input type="checkbox" checked={c.effective.manualReview} disabled={c.base.manualReview} onChange={(e) => void save(c.key, { manualReview: e.target.checked })} /> Ручная проверка</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={c.effective.markingPossible} disabled={c.base.markingPossible} onChange={(e) => void save(c.key, { markingPossible: e.target.checked })} /> Возможна маркировка</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={c.effective.disabled} onChange={(e) => void save(c.key, { disabled: e.target.checked })} /> Категория закрыта</label>
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }}>
            Документы для новых товаров: {c.effective.docsWhenNew.map((d) => rules.docTypes[d]).join('; ') || 'не требуются'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {['certificate', 'permit', 'importer_info', 'origin_proof'].map((d) => {
              const on = c.effective.docsWhenNew.includes(d);
              const base = (c.base.docsWhenNew ?? []).includes(d);
              return (
                <button key={d} type="button" disabled={base}
                  onClick={() => void save(c.key, { requiredDocs: on ? (c.override?.requiredDocs ?? []).filter((x: string) => x !== d) : [...(c.override?.requiredDocs ?? []), d] })}
                  className="rounded-lg px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                  style={{ background: on ? C.accBg : C.l2, color: on ? C.acc : C.t3 }}>
                  {rules.docTypes[d]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {msg && <p className="text-[11px]" style={{ color: C.t2 }}>{msg}</p>}
    </div>
  );
};

/* ── Заявки на ПВЗ ────────────────────────────────────────────────── */

const PvzAppsTab = () => {
  const [status, setStatus] = useState('submitted');
  const [items, setItems] = useState<PvzAppRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [d, setD] = useState<Awaited<ReturnType<typeof apiAdminPvzApp>> | null>(null);
  const load = useCallback(async () => { const r = await apiAdminPvzApps(status); setItems(r.ok ? r.data.items : []); }, [status]);
  useEffect(() => { void load(); }, [load]);
  const loadOne = useCallback(async (id: string) => setD(await apiAdminPvzApp(id)), []);
  useEffect(() => { if (open) void loadOne(open); }, [open, loadOne]);

  if (open) {
    const a = d && d.ok ? d.data : null;
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => { setOpen(null); setD(null); }} className="text-[11px] font-semibold" style={{ color: C.acc }}>← К списку</button>
        {!a && <Loader2 className="animate-spin" style={{ color: C.t3 }} />}
        {a && (
          <>
            <div className="space-y-1 rounded-2xl p-3" style={card}>
              <p className="text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{a.application.title}</p>
              <p className="text-[12px]" style={{ color: C.t2 }} translate="no">{a.application.city}, {a.application.address} · {a.application.phone}</p>
              <p className="text-[12px]" style={{ color: C.t2 }}>
                Помещение: {a.application.premises.ownership === 'own' ? 'в собственности' : a.application.premises.ownership === 'rent' ? 'в аренде' : '—'}, {a.application.premises.areaM2 || '—'} м²
              </p>
              <p className="text-[11px]" style={{ color: C.t3 }}>Заявитель: {KIND_RU[a.applicantKind ?? ''] ?? '—'} · проверка продавца: {a.applicantVerification}</p>
              <p className="text-[11px]" style={{ color: C.t3 }}>Статус заявки: {a.application.status}</p>
            </div>
            <div className="space-y-2 rounded-2xl p-3" style={card}>
              <Docs docs={a.application.docs} onChanged={() => void loadOne(open)} />
            </div>
            {!['approved', 'rejected'].includes(a.application.status) && (
              <div className="rounded-2xl p-3" style={card}>
                <Actions onRun={async (key, text) => {
                  const r = await apiAdminPvzAction(open, key, { comment: key === 'request_changes' ? text.split('\n')[0] : text, missing: key === 'request_changes' ? text.split('\n').slice(1).filter(Boolean) : undefined });
                  if (!r.ok) return errOf(r);
                  await loadOne(open); void load(); return null;
                }} actions={[
                  ...(a.application.status === 'submitted' ? [{ key: 'start_review', label: 'Взять на проверку' }] : []),
                  { key: 'request_changes', label: 'Запросить исправления' },
                  { key: 'approve', label: 'Одобрить', tone: 'ok' as const },
                  { key: 'reject', label: 'Отклонить', tone: 'bad' as const },
                ]} />
              </div>
            )}
            <div className="space-y-1 rounded-2xl p-3" style={card}>
              <p className="text-[12px] font-bold" style={{ color: C.t1 }}>История</p>
              {a.history.map((h, i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>{fmtTime(h.at)} · {h.action}{h.comment && <span style={{ color: C.t3 }} translate="no"> · {h.comment}</span>}</p>)}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([['submitted', 'Новые'], ['in_review', 'На проверке'], ['needs_changes', 'Ждут исправлений'], ['approved', 'Одобренные'], ['rejected', 'Отклонённые'], ['all', 'Все']] as const)
          .map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}
      </div>
      {items === null && <Loader2 className="animate-spin" style={{ color: C.t3 }} />}
      {items?.length === 0 && <p className="text-[12px]" style={{ color: C.t3 }}>Заявок нет.</p>}
      {items?.map((a) => (
        <button key={a.id} type="button" onClick={() => setOpen(a.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }} translate="no">{a.title} · {a.city}</p>
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">{a.shopName} · {a.name} @{a.username} · {a.status} · {fmtTime(a.submittedAt)}</p>
        </button>
      ))}
    </div>
  );
};

/* ── Реестр магазинов и ПВЗ: идентификаторы и блокировка ───────────── */

const copyId = (id: string) => { try { void navigator.clipboard?.writeText(id); } catch { /* буфер недоступен */ } };

const IdTag = ({ id }: { id: string }) => (
  <button type="button" title="Скопировать ID" onClick={() => copyId(id)} translate="no"
    className="rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ background: C.l2, color: C.t2 }}>{id}</button>
);

const RegistryFilters = ({ q, setQ, status, setStatus, options }: { q: string; setQ: (v: string) => void; status: string; setStatus: (v: string) => void; options: [string, string][] }) => (
  <div className="space-y-2">
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: ID, название, @ник, город" className={inp} style={inputStyle} translate="no" />
    <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {options.map(([k, l]) => <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>)}
    </div>
  </div>
);

const SellersRegistry = () => {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState<SellerAdminRow[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await apiAdminSellers(q, status);
    if (r.ok) { setItems(r.data.items); setErr(''); } else { setItems([]); setErr(errOf(r)); }
  }, [q, status]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const act = async (s: SellerAdminRow, action: 'suspend' | 'reinstate') => {
    const reason = window.prompt(action === 'suspend' ? 'Причина блокировки магазина (увидит продавец)' : 'Комментарий к разблокировке') ?? '';
    if (reason.trim().length < 3) return;
    const r = await apiAdminSellerAction(s.id, action, reason.trim());
    if (!r.ok) { setErr(errOf(r)); return; }
    void load();
  };
  return (
    <div className="space-y-2">
      <RegistryFilters q={q} setQ={setQ} status={status} setStatus={setStatus} options={[['all', 'Все'], ['active', 'Работают'], ['verified', 'Проверены'], ['unverified', 'Не проверены'], ['suspended', 'Заблокированы']]} />
      {items && <p className="text-[11px]" style={{ color: C.t3 }}>Магазинов: {items.length}</p>}
      {err && <p role="alert" className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {!items ? <Loader2 className="animate-spin" size={16} /> : items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Магазинов не найдено.</p> : items.map((s) => (
        <div key={s.id} className="space-y-1.5 rounded-2xl p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{s.shopName}</p>
            <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: s.suspended ? 'rgba(239,68,68,0.12)' : C.l2, color: s.suspended ? C.red : C.t2 }}>{s.suspended ? 'Заблокирован' : s.verification}</span>
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">ID магазина: <IdTag id={s.id} /> · {s.owner} @{s.username} · товаров: {s.products}</p>
          {s.suspended && s.suspendReason && <p className="text-[11px]" style={{ color: C.red }}>Причина: <span translate="no">{s.suspendReason}</span></p>}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => copyId(s.id)} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: C.l2, color: C.t1 }}>Копировать ID</button>
            <button type="button" onClick={() => copyId(`@${s.username}`)} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: C.l2, color: C.t1 }} translate="no">@{s.username}</button>
            <button type="button" onClick={() => void act(s, s.suspended ? 'reinstate' : 'suspend')} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: s.suspended ? C.l2 : 'rgba(239,68,68,0.12)', color: s.suspended ? C.t1 : C.red }}>{s.suspended ? 'Разблокировать' : 'Заблокировать'}</button>
          </div>
        </div>
      ))}
    </div>
  );
};

const PvzRegistry = () => {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState<PvzPointAdminRow[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await apiAdminPvzPoints(q, status);
    if (r.ok) { setItems(r.data.items); setErr(''); } else { setItems([]); setErr(errOf(r)); }
  }, [q, status]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const act = async (p: PvzPointAdminRow, action: 'block' | 'unblock') => {
    const reason = window.prompt(action === 'block' ? 'Причина блокировки ПВЗ (увидит владелец)' : 'Комментарий к разблокировке') ?? '';
    if (reason.trim().length < 3) return;
    const r = await apiAdminPvzPointAction(p.id, action, reason.trim());
    if (!r.ok) { setErr(errOf(r)); return; }
    void load();
  };
  return (
    <div className="space-y-2">
      <RegistryFilters q={q} setQ={setQ} status={status} setStatus={setStatus} options={[['all', 'Все'], ['active', 'Работают'], ['blocked', 'Заблокированы']]} />
      {err && <p role="alert" className="text-[11px]" style={{ color: C.red }}>{err}</p>}
      {!items ? <Loader2 className="animate-spin" size={16} /> : items.length === 0 ? <p className="text-[12px]" style={{ color: C.t3 }}>Пунктов не найдено.</p> : items.map((p) => (
        <div key={p.id} className="space-y-1.5 rounded-2xl p-3" style={card}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{p.title}</p>
            <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold" style={{ background: p.blocked ? 'rgba(239,68,68,0.12)' : C.l2, color: p.blocked ? C.red : C.t2 }}>{p.blocked ? 'Заблокирован' : p.staffClosed ? 'Закрыт владельцем' : p.active ? 'Работает' : 'Не активирован'}</span>
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }} translate="no">ID ПВЗ: <IdTag id={p.id} /> · {p.city}, {p.address}{p.username ? ` · @${p.username}` : ''}</p>
          {p.blocked && p.blockReason && <p className="text-[11px]" style={{ color: C.red }}>Причина: <span translate="no">{p.blockReason}</span></p>}
          <button type="button" onClick={() => void act(p, p.blocked ? 'unblock' : 'block')} className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: p.blocked ? C.l2 : 'rgba(239,68,68,0.12)', color: p.blocked ? C.t1 : C.red }}>{p.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
        </div>
      ))}
    </div>
  );
};

/* ── Корень ───────────────────────────────────────────────────────── */

type Sub = 'apps' | 'products' | 'reports' | 'rules' | 'pvz' | 'shops' | 'points' | 'transfers';

export const MarketVerifyAdmin = ({ can }: { can: (perm: string) => boolean }) => {
  const market = can('market');
  const tabs: { key: Sub; label: string; show: boolean }[] = [
    { key: 'shops', label: 'Магазины (ID)', show: market },
    { key: 'apps', label: 'Заявки продавцов', show: can('seller_docs') || market },
    { key: 'products', label: 'Модерация товаров', show: can('market_moderation') || market },
    { key: 'reports', label: 'Жалобы и апелляции', show: can('market_moderation') || market },
    { key: 'pvz', label: 'Заявки ПВЗ', show: can('pvz_manage') || market },
    { key: 'points', label: 'Пункты ПВЗ (ID)', show: can('pvz_manage') || market },
    { key: 'transfers', label: 'Передачи', show: can('pvz_manage') || market },
    { key: 'rules', label: 'Правила допуска', show: market },
  ];
  const visible = tabs.filter((t) => t.show);
  const [sub, setSub] = useState<Sub>(visible[0]?.key ?? 'apps');
  if (visible.length === 0) return <p className="text-[12px]" style={{ color: C.t3 }}>Нет доступа.</p>;
  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {visible.map((t) => <Chip key={t.key} on={sub === t.key} onClick={() => setSub(t.key)}>{t.label}</Chip>)}
      </div>
      {sub === 'apps' && <ApplicationsTab canDecide={market} />}
      {sub === 'products' && <ProductsTab />}
      {sub === 'reports' && <ReportsTab />}
      {sub === 'pvz' && <PvzAppsTab />}
      {sub === 'shops' && <SellersRegistry />}
      {sub === 'points' && <PvzRegistry />}
      {sub === 'transfers' && <TransfersAdmin />}
      {sub === 'rules' && <RulesTab />}
    </div>
  );
};
