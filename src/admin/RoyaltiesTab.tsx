/**
 * Вкладка «Sky Royalties»: фонды и параметры (только владелец, с кодом), выручка по периодам, закрытие периода, проверка подозрительных
 * прослушиваний, заявки и проверка личности авторов, выплаты (решает владелец), сверка и журнал. Сервер: server/royalties.mjs.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const A = '/api/admin/royalties';
const rub = (k: number) => `${(k / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  period_closed: 'Период закрыт — менять нельзя.', already_closed: 'Период уже закрыт.', period_not_finished: 'Период ещё не закончился.', no_confirmed_revenue: 'Нет подтверждённой выручки за период.',
  settings_incomplete: 'Не заданы доля музыки в Prime или процент фонда.', disabled: 'Начисления выключены в настройках.', self_review: 'Это решает другой человек.', bad_amount: 'Проверьте сумму.', bad_value: 'Проверьте значение.',
};
const SRC: Record<string, string> = { prime_music: 'Prime (доля музыки)', ad_free: 'Реклама (бесплатные)' };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="mb-2 text-sm font-black" style={{ color: C.t1 }}>{title}</p>{children}</section>
);
const In = ({ label, value, onChange, w = 'w-28' }: { label: string; value: unknown; onChange: (v: string) => void; w?: string }) => (
  <label className="text-[11px]" style={{ color: C.t3 }}>{label}<input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} /></label>
);

export const RoyaltiesTab = () => {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [codeAsked, setCodeAsked] = useState(false);
  const [form, setForm] = useState<D>({});
  const [rev, setRev] = useState<D>({ period: '', source: 'ad_free', country: '*', gross: '', refunds: '0' });
  const [recon, setRecon] = useState<D | null>(null);
  const load = useCallback(() => apiCall<D>(A).then((r) => { if (r.ok) setD(r.data!); else setErr(ERR[r.error ?? ''] ?? `Не удалось загрузить (${r.error})`); }), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d) return;
    const s = d.settings; setForm((f: D) => (Object.keys(f).length ? f : { primePool: s.primePoolBp / 100, adPool: s.adPoolBp == null ? '' : s.adPoolBp / 100, musicShare: s.musicShareBp == null ? '' : s.musicShareBp / 100, tax: s.taxBp / 100, store: s.storeBp / 100, payment: s.paymentBp / 100, minPayout: s.minPayoutKopecks / 100, holdDays: s.holdDays, requireKyc: s.requireKyc, enabled: s.enabled }));
  }, [d]);
  const call = async (method: string, path: string, body?: D, ok?: string) => {
    const r = await apiCall<D>(path, { method, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? 'ошибка'})`); return r; }
    if (ok) flash(ok); await load(); return r;
  };
  const owner = !!d?.isOwner;
  const withCode = async (fn: (c: string) => Promise<unknown>) => {
    if (!code) { const r = await apiCall(`${A}/step-up`, { method: 'POST' }); setCodeAsked(true); flash(r.ok ? 'Код отправлен' : 'Не удалось запросить код'); return; }
    const c = code; setCode(''); setCodeAsked(false); await fn(c);
  };
  if (err) return <p className="p-4 text-sm" style={{ color: C.red }}>{err}</p>;
  if (!d) return <p className="p-4 text-sm" style={{ color: C.t3 }}>Загрузка…</p>;
  const pct = (v: unknown) => Math.round(Number(String(v).replace(',', '.')) * 100);
  const saveSettings = () => withCode((c) => call('PUT', `${A}/settings`, {
    stepUpCode: c, enabled: !!form.enabled, requireKyc: !!form.requireKyc, primePoolBp: pct(form.primePool), adPoolBp: form.adPool === '' ? null : pct(form.adPool), musicShareBp: form.musicShare === '' ? null : pct(form.musicShare),
    taxBp: pct(form.tax), storeBp: pct(form.store), paymentBp: pct(form.payment), minPayoutKopecks: Math.round(Number(String(form.minPayout).replace(',', '.')) * 100), holdDays: Number(form.holdDays),
  }, 'Настройки сохранены'));
  return (
    <div className="space-y-1 p-3">
      <Card title="Состояние">
        <p className="text-xs" style={{ color: C.t2 }}>Период {d.currentPeriod}. Прослушиваний за месяц: валидных {d.stats.valid}, на проверке {d.stats.review}, отклонено {d.stats.invalid}. Начисления {d.settings.enabled ? 'включены' : 'выключены'}.</p>
        <div className="mt-2 flex gap-2"><Btn tone="plain" onClick={() => void apiCall<D>(`${A}/audit`).then((r) => flash(r.data?.ok ? `Журнал цел (${r.data.entries} записей)` : `Журнал нарушен на записи ${r.data?.brokenAt}`))}>Проверить журнал</Btn></div>
      </Card>

      {codeAsked && <Card title="Код подтверждения владельца"><div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код" className="rounded-lg px-3 py-2 text-sm tracking-widest" style={field} /><Btn disabled={code.length < 6} onClick={() => setCodeAsked(true)}>Код введён — нажмите действие ещё раз</Btn></div></Card>}

      <Card title="Параметры фонда (только владелец, с кодом)">
        <div className="flex flex-wrap items-end gap-2">
          <In label="Prime: % фонда" value={form.primePool} onChange={(v) => setForm({ ...form, primePool: v })} />
          <In label="Prime: доля музыки, %" value={form.musicShare} onChange={(v) => setForm({ ...form, musicShare: v })} />
          <In label="Реклама: % фонда" value={form.adPool} onChange={(v) => setForm({ ...form, adPool: v })} />
          <In label="Налоги, %" value={form.tax} onChange={(v) => setForm({ ...form, tax: v })} />
          <In label="Магазины приложений, %" value={form.store} onChange={(v) => setForm({ ...form, store: v })} />
          <In label="Платёжные комиссии, %" value={form.payment} onChange={(v) => setForm({ ...form, payment: v })} />
          <In label="Мин. выплата, ₽" value={form.minPayout} onChange={(v) => setForm({ ...form, minPayout: v })} />
          <In label="Удержание, дней" value={form.holdDays} onChange={(v) => setForm({ ...form, holdDays: v })} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs" style={{ color: C.t1 }}>
          <label><input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Начисления включены</label>
          <label><input type="checkbox" checked={!!form.requireKyc} onChange={(e) => setForm({ ...form, requireKyc: e.target.checked })} /> Требовать проверку личности для выплат</label>
          <Btn disabled={!owner} onClick={() => void saveSettings()}>Сохранить</Btn>
        </div>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Фонд Prime = выручка × доля музыки − налоги, комиссии, возвраты, затем × % фонда. Фонд бесплатных — отдельно, из рекламной выручки. Закрытые периоды параметры не меняют. Доля музыки пока не задана — без неё Prime не считается.</p>
      </Card>

      <Card title="Выручка периода">
        <div className="flex flex-wrap items-end gap-2">
          <In label="Период ГГГГ-ММ" value={rev.period} onChange={(v) => setRev({ ...rev, period: v })} />
          <label className="text-[11px]" style={{ color: C.t3 }}>Источник<select value={rev.source} onChange={(e) => setRev({ ...rev, source: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}><option value="ad_free">Реклама (бесплатные)</option><option value="prime_music">Prime</option></select></label>
          <In label="Страна (* — все)" value={rev.country} onChange={(v) => setRev({ ...rev, country: v })} w="w-20" />
          <In label="Валовая, ₽" value={rev.gross} onChange={(v) => setRev({ ...rev, gross: v })} />
          <In label="Возвраты, ₽" value={rev.refunds} onChange={(v) => setRev({ ...rev, refunds: v })} />
          <Btn onClick={() => void call('POST', `${A}/revenue`, { period: rev.period, source: rev.source, country: rev.country, grossKopecks: Math.round(Number(String(rev.gross).replace(',', '.')) * 100), refundsKopecks: Math.round(Number(String(rev.refunds).replace(',', '.')) * 100) }, 'Сохранено, ждёт подтверждения другим человеком')}>Внести</Btn>
          {rev.period && <Btn tone="plain" onClick={() => void apiCall<D>(`${A}/suggest/${rev.period}`).then((r) => flash(r.ok ? `Оплат Prime с кошелька: ${rub(r.data!.grossKopecks)} (ориентир)` : 'Нет данных'))}>Подсказка по Prime</Btn>}
        </div>
        <div className="mt-2 space-y-1">{d.revenue.map((r: D) => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span>{r.period} · {SRC[r.source]} · {r.country} · {rub(r.grossKopecks)} (возвр. {rub(r.refundsKopecks)}) · {r.status === 'confirmed' ? 'подтверждено' : 'черновик'}</span>
            {r.status === 'draft' && <Btn tone="plain" onClick={() => void call('POST', `${A}/revenue/${r.id}/confirm`, {}, 'Подтверждено')}>Подтвердить</Btn>}
          </div>))}</div>
      </Card>

      <Card title="Периоды">
        {d.periods.map((p: D) => (
          <div key={p.id} className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span>{p.id} · {p.status === 'closed' ? 'закрыт' : 'открыт'}{p.recon ? ` · фонд ${rub(Number(p.recon.fundTotal))}, нераспределено ${rub(Number(p.recon.unallocated))}` : ''}</span>
            <span className="flex gap-1">
              {p.status === 'closed' && <Btn tone="plain" onClick={() => void apiCall<D>(`${A}/reconcile/${p.id}`).then((r) => setRecon(r.data ?? null))}>Сверка</Btn>}
              {p.status !== 'closed' && owner && <Btn onClick={() => void withCode((c) => call('POST', `${A}/periods/${p.id}/close`, { stepUpCode: c }, 'Период закрыт'))}>Закрыть</Btn>}
            </span>
          </div>))}
        {d.revenue.length > 0 && owner && (
          <div className="mt-2 flex items-end gap-2"><In label="Закрыть период ГГГГ-ММ" value={form.closeId ?? ''} onChange={(v) => setForm({ ...form, closeId: v })} /><Btn onClick={() => void withCode((c) => call('POST', `${A}/periods/${form.closeId}/close`, { stepUpCode: c }, 'Период закрыт'))}>Закрыть</Btn></div>)}
        {recon && <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: C.l2, color: recon.ok ? C.t1 : C.red }}>Сверка: {recon.ok ? 'сходится' : `расхождение ${recon.diff}`} · фонд {rub(recon.fundTotal)} = начислено {rub(recon.accrued)} + удержано {rub(recon.heldNow)} + после проверки {rub(recon.releasedAfterReview)} + нераспределено {rub(recon.unallocated)} + возвращено {rub(recon.reclaimed)}</p>}
      </Card>

      <Card title="Проверка подозрительных прослушиваний">
        {d.review.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Очередь пуста.</p>}
        {d.review.map((q: D) => (
          <div key={q.listenerId} className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span><span translate="no">{q.listenerId}</span> · {q.plays} прослушиваний · признаки: {q.flags.join(', ')}</span>
            <span className="flex gap-1"><Btn tone="plain" onClick={() => void call('POST', `${A}/review`, { playIds: q.ids, verdict: 'valid' }, 'Признано валидным')}>Валидны</Btn><Btn tone="red" onClick={() => void call('POST', `${A}/review`, { playIds: q.ids, verdict: 'invalid' }, 'Отклонено')}>Накрутка</Btn></span>
          </div>))}
      </Card>

      <Card title="Заявки авторов и проверка личности">
        {d.enrollments.map((e: D) => (
          <div key={e.profile_id} className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span><span translate="no">{e.profile_id}</span> · {e.status}{e.reason ? ` — ${e.reason}` : ''}</span>
            <span className="flex gap-1"><Btn tone="plain" onClick={() => void call('POST', `${A}/enrollment`, { profileId: e.profile_id, status: 'approved' }, 'Одобрено')}>Одобрить</Btn><Btn tone="red" onClick={() => void call('POST', `${A}/enrollment`, { profileId: e.profile_id, status: 'rejected', reason: 'Отклонено сотрудником' }, 'Отклонено')}>Отклонить</Btn></span>
          </div>))}
        {d.kycPending.map((k: D) => (
          <div key={k.profile_id} className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span>Проверка личности: <span translate="no">{k.profile_id}</span></span>
            <span className="flex gap-1"><Btn tone="plain" onClick={() => void call('POST', `${A}/kyc`, { profileId: k.profile_id, status: 'verified' }, 'Личность подтверждена')}>Подтвердить</Btn><Btn tone="red" onClick={() => void call('POST', `${A}/kyc`, { profileId: k.profile_id, status: 'rejected' }, 'Отклонено')}>Отклонить</Btn></span>
          </div>))}
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Проверка личности и реквизитов — ручная: документы и банковские данные в Sky не собираются, сотрудник сверяет их вне системы и отмечает результат.</p>
      </Card>

      <Card title="Выплаты">
        {d.payouts.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Заявок нет.</p>}
        {d.payouts.map((p: D) => (
          <div key={p.id} className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span><span translate="no">{p.holderId}</span> · {rub(p.amountKopecks)} · {p.status === 'requested' ? 'ждёт решения' : p.status === 'paid' ? 'выплачено' : 'отклонено'}</span>
            {p.status === 'requested' && owner && <span className="flex gap-1"><Btn onClick={() => void withCode((c) => call('POST', `${A}/payouts/${p.id}/pay`, { stepUpCode: c }, 'Выплачено в кошелёк'))}>Выплатить</Btn><Btn tone="red" onClick={() => void withCode((c) => call('POST', `${A}/payouts/${p.id}/reject`, { stepUpCode: c }, 'Отклонено, сумма возвращена'))}>Отклонить</Btn></span>}
          </div>))}
      </Card>
    </div>
  );
};
