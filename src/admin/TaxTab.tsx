/**
 * Вкладка «Sky Tax» в админке: обзор, налоговый учёт самого Sky (режим, интеграция, операции — через общую панель TaxPanel), предприниматели (только просмотр: их настройки меняет владелец учёта),
 * документы с поиском, журнал. Право `tax`; включение реальной передачи и настройки Sky — только владелец с кодом подтверждения. Сервер — server/taxcore.mjs, server/routes/tax.mjs.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';
import { TaxPanel, DocsList, LogList, type Subject } from '@/tax/TaxPanel';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)' };
const card = { background: C.l1, border: `1px solid ${C.brd}` };
const fld = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
interface SubjectRow extends Subject { ops: number; pending: number; failed: number }
interface Overview { global: { liveEnabled: boolean; dueHours: number; notifyErrors: boolean }; counts: { total: number; docs: number; refunds: number; overdue: number; issued: number; pending: number; queued: number; failed: number; rejected: number; notRequired: number }; subjects: SubjectRow[]; isOwner: boolean }
type Sec = 'overview' | 'sky' | 'business' | 'docs' | 'log';
const KIND_RU: Record<string, string> = { sky: 'Sky', business: 'Бизнес', seller: 'Магазин Market', executor: 'Sky GO' };
const TAX_RU: Record<string, string> = { npd: 'Самозанятый (НПД)', ip: 'ИП', ooo: 'ООО' };
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const rub = (n: number) => `${Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

export const TaxTab = () => {
  const [ov, setOv] = useState<Overview | null>(null); const [sec, setSec] = useState<Sec>('overview'); const [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await apiCall<Overview>('/api/admin/tax/overview'); if (r.ok && r.data) { setOv(r.data); setErr(''); } else setErr('Нет доступа или сервер не ответил'); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!ov) return <div className="grid place-items-center py-10">{err ? <p style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  return (
    <div className="min-w-0 space-y-3">
      <ScrollTabs>{([['overview', 'Обзор'], ['sky', 'Sky'], ['business', 'Предприниматели'], ['docs', 'Документы'], ['log', 'Журнал']] as [Sec, string][]).map(([k, l]) => (
        <button key={k} type="button" onClick={() => setSec(k)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold" style={sec === k ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>{l}</button>))}</ScrollTabs>
      {sec === 'overview' && <OverviewView ov={ov} reload={load} />}
      {sec === 'sky' && <TaxPanel scope="sky" sky />}
      {sec === 'business' && <Entrepreneurs rows={ov.subjects.filter((s) => s.kind !== 'sky')} />}
      {sec === 'docs' && <AllDocs />}
      {sec === 'log' && <AllLog />}
    </div>
  );
};

const OverviewView = ({ ov, reload }: { ov: Overview; reload: () => void }) => {
  const c = ov.counts; const [code, setCode] = useState(''); const [asked, setAsked] = useState(false);
  const ask = async () => { const r = await apiCall('/api/admin/tax/step-up', { method: 'POST', body: JSON.stringify({ purpose: 'tax_live' }) }); if (r.ok) { setAsked(true); flash('Введите код из приложения-аутентификатора'); } else flash('Не удалось запросить код'); };
  const setLive = async (liveEnabled: boolean) => {
    if (liveEnabled && !window.confirm('Включить реальную передачу сведений и формирование чеков для всей экосистемы? Делайте это только после проверки юридической схемы, подключения официальных интеграций и тестирования.')) return;
    const r = await apiCall('/api/admin/tax/global', { method: 'PUT', body: JSON.stringify({ liveEnabled, stepUpCode: code.trim() }) });
    if (r.ok) { flash(liveEnabled ? 'Реальная передача включена' : 'Реальная передача выключена'); setCode(''); setAsked(false); reload(); } else flash(r.error === 'owner_only' ? 'Только владелец.' : r.error === 'step_up_invalid' ? 'Код не подошёл.' : 'Не получилось');
  };
  const Stat = ({ k, v, c: col }: { k: string; v: number; c?: string }) => <div className="rounded-2xl p-3" style={card}><div className="text-xs" style={{ color: C.t3 }}>{k}</div><div className="mt-1 text-2xl font-bold" style={{ color: col ?? C.t1 }}>{v}</div></div>;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ ...card, borderLeft: `4px solid ${ov.global.liveEnabled ? '#12a76a' : '#f5a524'}` }}>
        <div className="text-sm font-bold" style={{ color: C.t1 }}>Реальная передача сведений: {ov.global.liveEnabled ? 'ВКЛЮЧЕНА' : 'выключена'}</div>
        <p className="mt-1 text-xs leading-5" style={{ color: C.t3 }}>Пока выключено, ни один чек не формируется и ничего не передаётся: операции копятся в очереди. Включение — только владелец, с кодом подтверждения, и ещё отдельно для каждого учёта (Sky и каждого предпринимателя). Юридическая схема и официальные интеграции должны быть проверены заранее.</p>
        {ov.isOwner && <div className="mt-2 flex flex-wrap items-end gap-2"><button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }} onClick={ask}>{asked ? 'Выслать код ещё раз' : 'Запросить код'}</button><input className="rounded-xl px-3 py-2 text-sm" style={fld} placeholder="Код" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /><button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: ov.global.liveEnabled ? '#e5484d' : C.acc, color: '#fff' }} onClick={() => setLive(!ov.global.liveEnabled)}>{ov.global.liveEnabled ? 'Выключить' : 'Включить'}</button></div>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat k="Всего операций" v={c.total} /><Stat k="Документов сформировано" v={c.docs} c="#12a76a" /><Stat k="Успешно передано" v={c.issued} c="#12a76a" /><Stat k="Ожидают подтверждения" v={c.pending} c="#f5a524" />
        <Stat k="В очереди / у интеграции" v={c.queued} c="#4f6ef7" /><Stat k="Ошибки" v={c.failed} c={c.failed ? '#e5484d' : undefined} /><Stat k="Возвраты" v={c.refunds} /><Stat k="Срок на исходе" v={c.overdue} c={c.overdue ? '#e5484d' : undefined} />
        <Stat k="Отклонено" v={c.rejected} /><Stat k="Чек не требуется" v={c.notRequired} />
      </div>
      <p className="text-[11px] leading-4" style={{ color: C.t3 }}>«Чек не требуется» — пополнения SkyMoney, обмен, транзит и другие операции, которые не являются доходом. Sky не подключён к ФНС напрямую: передача идёт только через подключённые официальные интеграции или ручной ввод выданного чека.</p>
    </div>
  );
};

const Entrepreneurs = ({ rows }: { rows: SubjectRow[] }) => {
  const [open, setOpen] = useState<SubjectRow | null>(null);
  if (open) return <Detail s={open} back={() => setOpen(null)} />;
  if (!rows.length) return <p className="rounded-2xl p-4 text-sm" style={{ ...card, color: C.t3 }}>Предприниматели ещё не подключили Sky Tax.</p>;
  return (
    <div className="space-y-2">{rows.map((s) => (
      <button key={s.scope} type="button" onClick={() => setOpen(s)} className="w-full rounded-2xl p-3 text-left" style={card}>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold" style={{ color: C.t1 }}>{s.name || s.scope}</span><span className="text-[11px]" style={{ color: C.t3 }}>{KIND_RU[s.kind]}</span><span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: s.enabled ? 'color-mix(in srgb, #12a76a 16%, transparent)' : C.l2, color: s.enabled ? '#12a76a' : C.t3 }}>{s.enabled ? 'учёт включён' : 'выключен'}</span></div>
        <div className="mt-1 text-xs" style={{ color: C.t2 }}>{s.taxStatus ? TAX_RU[s.taxStatus] : 'статус не указан'}{s.innLast4 ? ` · ИНН …${s.innLast4}` : ''} · режим: {s.mode === 'auto' ? 'автоматически' : 'ручная обработка'} · интеграция: {s.integration ? s.integration.title : 'не подключена'} · передача {s.live ? 'включена' : 'не включена'}</div>
        <div className="mt-1 text-[11px]" style={{ color: C.t3 }}>Операций: {s.ops} · ждут: {s.pending} · ошибок: {s.failed}</div>
      </button>))}</div>
  );
};
const Detail = ({ s, back }: { s: SubjectRow; back: () => void }) => {
  const [ops, setOps] = useState<{ id: string; sourceLabel: string; amountRub: number; statusLabel: string; paidAt: string; docNumber: string | null; lastError: string | null }[]>([]); const [docs, setDocs] = useState<React.ComponentProps<typeof DocsList>['docs']>([]); const [log, setLog] = useState<React.ComponentProps<typeof LogList>['rows']>([]);
  useEffect(() => { const q = encodeURIComponent(s.scope); void apiCall<{ ops: typeof ops }>(`/api/admin/tax/ops?scope=${q}`).then((r) => r.ok && r.data && setOps(r.data.ops)); void apiCall<{ docs: typeof docs }>(`/api/admin/tax/docs?scope=${q}`).then((r) => r.ok && r.data && setDocs(r.data.docs)); void apiCall<{ log: typeof log }>(`/api/admin/tax/log?scope=${q}`).then((r) => r.ok && r.data && setLog(r.data.log)); }, [s.scope]);
  return (
    <div className="space-y-3">
      <button type="button" onClick={back} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>← К списку</button>
      <div className="rounded-2xl p-3 text-xs" style={{ ...card, color: C.t2 }}><b style={{ color: C.t1 }}>{s.name}</b> · {KIND_RU[s.kind]} · {s.taxStatus ? TAX_RU[s.taxStatus] : '—'} · режим: {s.mode === 'auto' ? 'автоматически после продажи' : 'ручная обработка'}. Просмотр: настройки и документы предпринимателя меняет только он сам.</div>
      <h3 className="text-sm font-bold" style={{ color: C.t1 }}>История операций</h3>
      <div className="space-y-1">{ops.map((o) => <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs" style={card}><b style={{ color: C.t1 }}>{rub(o.amountRub)}</b><span style={{ color: C.t2 }}>{o.sourceLabel}</span><span style={{ color: C.t3 }}>{o.statusLabel}{o.docNumber ? ` · чек № ${o.docNumber}` : ''}</span>{o.lastError && <span style={{ color: '#e5484d' }}>{o.lastError}</span>}<span className="ml-auto" style={{ color: C.t3 }}>{dt(o.paidAt)}</span></div>)}{!ops.length && <p className="text-sm" style={{ color: C.t3 }}>Операций нет.</p>}</div>
      <h3 className="text-sm font-bold" style={{ color: C.t1 }}>Документы</h3><DocsList docs={docs} canOperate={false} />
      <h3 className="text-sm font-bold" style={{ color: C.t1 }}>Журнал</h3><LogList rows={log} />
    </div>
  );
};

const AllDocs = () => {
  const [docs, setDocs] = useState<React.ComponentProps<typeof DocsList>['docs'] | null>(null); const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ docs: NonNullable<typeof docs> }>(`/api/admin/tax/docs?q=${encodeURIComponent(q)}&from=${from}&to=${to}`); if (r.ok && r.data) setDocs(r.data.docs); }, [q, from, to]);
  useEffect(() => { void load(); }, [load]);
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><input className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs" style={fld} placeholder="Номер чека, номер операции" value={q} onChange={(e) => setQ(e.target.value)} /><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="rounded-xl px-3 py-2 text-xs" style={fld} value={to} onChange={(e) => setTo(e.target.value)} /></div>{docs ? <DocsList docs={docs} canOperate={false} /> : <Loader2 className="mx-auto animate-spin" size={18} />}</div>;
};
const AllLog = () => { const [rows, setRows] = useState<React.ComponentProps<typeof LogList>['rows']>([]); useEffect(() => { void apiCall<{ log: typeof rows }>('/api/admin/tax/log?limit=200').then((r) => r.ok && r.data && setRows(r.data.log)); }, []); return <LogList rows={rows} />; };
