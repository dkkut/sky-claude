/**
 * Sky Royalties — кабинет автора (внутри Sky Music Studio). Данные — только с сервера (server/royalties.mjs):
 * начислено, ожидает допуска, удержано на проверке и доступно к выводу показываются раздельно; выплата — заявкой, зачисление в кошелёк Sky.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { card: 'var(--bg-l1)', l2: 'var(--bg-l2)', border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rub = (k: number) => `${(k / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const ERR: Record<string, string> = {
  not_enrolled: 'Сначала подайте заявку на участие.', kyc_required: 'Нужна проверка личности и реквизитов.', below_minimum: 'Доступная сумма меньше минимальной для выплаты.',
  payout_open: 'У вас уже есть заявка на выплату.', not_rightsholder: 'Доли задаёт правообладатель трека.', sum_not_100: 'Сумма долей должна быть ровно 100 %.', proposal_open: 'Уже есть предложение, ожидающее ответа.',
  bad_parts: 'Проверьте участников и доли.', unknown_holder: 'Участник не найден.', not_allowed: 'Нет доступа.',
};
const PAY_STATUS: Record<string, string> = { requested: 'На рассмотрении', paid: 'Выплачено в кошелёк', rejected: 'Отклонено' };
const ENR: Record<string, string> = { new: 'На рассмотрении', approved: 'Участник', needs_info: 'Нужны данные', rejected: 'Отклонено' };

const Row = ({ k, v, hint }: { k: string; v: string; hint?: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
    <span style={{ color: C.t2 }}>{k}{hint && <span className="block text-[11px]" style={{ color: C.t3 }}>{hint}</span>}</span>
    <b style={{ color: C.t1 }}>{v}</b>
  </div>
);

export const RoyaltiesCabinet = () => {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiCall<D>('/api/royalties/cabinet').then((r) => { if (r.ok) setD(r.data!); else setErr(true); }), []);
  useEffect(() => { void load(); }, [load]);
  const post = async (path: string, body: D = {}) => {
    setBusy(true);
    const r = await apiCall<D>(path, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? 'ошибка'})`);
    await load();
    return r;
  };
  if (err) return <p style={{ color: C.red }}>Не удалось загрузить Sky Royalties.</p>;
  if (!d) return <p style={{ color: C.t3 }}>Загрузка…</p>;
  const b = d.balances as Record<string, number>;
  const enrolled = d.enrollment?.status === 'approved';
  const total = b.pending + b.available + b.held + b.unclaimed + b.reserved + b.paid;
  return (
    <div className="mb-4 rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <p className="text-base font-black" style={{ color: C.t1 }}>Sky Royalties</p>
      {!d.enabled && <p className="mt-1 text-xs" style={{ color: C.t3 }}>Начисления пока не запущены администрацией — расчёт появится после первого закрытого периода.</p>}

      {!enrolled && (
        <div className="mt-2 rounded-xl p-3 text-sm" style={{ background: C.l2, color: C.t2 }}>
          <p>Чтобы получать вознаграждение, подайте заявку: система проверит права на карточке музыканта, опубликованные треки и включённое роялти.</p>
          {d.enrollment && <p className="mt-1" style={{ color: C.t1 }}>Статус: {ENR[d.enrollment.status] ?? d.enrollment.status}{d.enrollment.reason ? ` — ${d.enrollment.reason}` : ''}</p>}
          <button type="button" disabled={busy} onClick={() => void post('/api/royalties/enroll').then((r) => r.ok && flash(r.data?.status === 'approved' ? 'Заявка одобрена' : 'Нужны дополнительные условия — причины показаны выше'))}
            className="mt-2 min-h-[44px] rounded-xl px-4 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Подать заявку</button>
        </div>
      )}

      <div className="mt-2">
        <Row k="Всего начислено и выплачено" v={rub(total)} hint="Сумма всех записей журнала, включая удержанное" />
        <Row k="Доступно к выводу" v={rub(b.available)} hint={`Минимум для выплаты — ${rub(d.minPayoutKopecks)}`} />
        <Row k="Ожидает выплаты" v={rub(b.pending)} hint={`Выпускается через ${d.holdDays} дн. после закрытия периода`} />
        <Row k="Удержано на проверке" v={rub(b.held)} hint="Подозрительные прослушивания: после проверки сумма вернётся вам или в общий фонд" />
        {b.unclaimed > 0 && <Row k="Ждёт допуска" v={rub(b.unclaimed)} hint="Появится после одобрения заявки и подтверждения прав" />}
        {b.reserved > 0 && <Row k="В выплате" v={rub(b.reserved)} />}
        <Row k="Уже выплачено" v={rub(b.paid)} />
        <Row k={`Прослушиваний в ${d.month.period}`} v={`${d.month.validPlays}${d.month.reviewPlays ? ` (+${d.month.reviewPlays} на проверке)` : ''}`} />
      </div>

      <div className="mt-3 rounded-xl p-3 text-sm" style={{ background: C.l2 }}>
        <p className="font-bold" style={{ color: C.t1 }}>Предположительное роялти за месяц</p>
        {d.estimate?.computed
          ? <p style={{ color: C.t1 }}>≈ {rub(d.estimate.estimateKopecks)} <span className="text-xs" style={{ color: C.t3 }}>(по периоду {d.estimate.basedOnPeriod})</span></p>
          : <p className="text-xs" style={{ color: C.t3 }}>Не рассчитано: пока нет закрытого периода.</p>}
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>{d.estimate?.note}</p>
      </div>

      {enrolled && (
        <div className="mt-3 space-y-2">
          {d.requireKyc && d.kyc !== 'verified' && (
            <div className="rounded-xl p-3 text-sm" style={{ background: C.l2, color: C.t2 }}>
              Для вывода нужна проверка личности и реквизитов (статус: {d.kyc === 'pending' ? 'на проверке' : d.kyc === 'rejected' ? 'отклонена' : 'не начата'}).
              {d.kyc !== 'pending' && <button type="button" disabled={busy} onClick={() => void post('/api/royalties/kyc').then(() => flash('Отправлено на проверку'))} className="ml-2 font-bold underline" style={{ color: C.acc }}>Отправить на проверку</button>}
            </div>
          )}
          <button type="button" disabled={busy || b.available < d.minPayoutKopecks}
            onClick={() => void post('/api/royalties/payout', { idemKey: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }).then((r) => r.ok && flash('Заявка на выплату создана'))}
            className="min-h-[44px] w-full rounded-xl px-4 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>Вывести на кошелёк Sky</button>
          <p className="text-[11px]" style={{ color: C.t3 }}>Выплата — целыми рублями в кошелёк Sky после подтверждения владельцем. На банковский счёт Sky пока не переводит.</p>
        </div>
      )}

      {d.tracks.length > 0 && <Section title="По трекам">{d.tracks.map((t: D) => <Row key={t.trackId} k={t.title} v={rub(t.earnedKopecks)} hint={t.heldKopecks ? `на проверке ${rub(t.heldKopecks)}` : undefined} />)}</Section>}
      {d.periods.length > 0 && <Section title="По периодам">{d.periods.map((p: D) => <Row key={p.period} k={p.period} v={rub(p.amountKopecks)} hint={p.heldKopecks ? `на проверке ${rub(p.heldKopecks)}` : undefined} />)}</Section>}
      {d.payouts.length > 0 && <Section title="Выплаты">{d.payouts.map((p: D) => <Row key={p.id} k={`${new Date(p.requestedAt).toLocaleDateString('ru-RU')} · ${PAY_STATUS[p.status] ?? p.status}`} v={rub(p.amountKopecks)} />)}</Section>}
      <Splits tracks={d.tracks} onChange={() => void load()} />
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-3"><p className="text-xs font-bold uppercase" style={{ color: C.t3 }}>{title}</p>{children}</div>
);

/** Доли соавторов по треку: предлагает правообладатель, каждый участник принимает сам; прежняя версия действует, пока не приняты все. */
const Splits = ({ tracks, onChange }: { tracks: D[]; onChange: () => void }) => {
  const [trackId, setTrackId] = useState('');
  const [hist, setHist] = useState<D | null>(null);
  const [rows, setRows] = useState<{ holderId: string; pct: string }[]>([{ holderId: '', pct: '100' }]);
  const open = (id: string) => { setTrackId(id); setHist(null); if (id) void apiCall<D>(`/api/royalties/splits/${encodeURIComponent(id)}`).then((r) => setHist(r.ok ? r.data! : { error: r.error })); };
  const act = async (path: string, body?: D) => { const r = await apiCall<D>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }); if (!r.ok) flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error})`); else open(trackId); onChange(); };
  if (!tracks.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase" style={{ color: C.t3 }}>Доли соавторов</p>
      <select value={trackId} onChange={(e) => open(e.target.value)} aria-label="Трек" className="mt-1 w-full rounded-lg px-2 py-2 text-sm" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.border}` }}>
        <option value="">Выберите трек…</option>{tracks.map((t) => <option key={t.trackId} value={t.trackId}>{t.title}</option>)}
      </select>
      {hist?.error && <p className="mt-1 text-xs" style={{ color: C.t3 }}>{ERR[hist.error] ?? 'Доли доступны правообладателю и участникам распределения.'}</p>}
      {hist?.versions && (
        <div className="mt-2 space-y-2 text-xs" style={{ color: C.t2 }}>
          {hist.versions.map((v: D) => (
            <div key={v.id} className="rounded-lg p-2" style={{ background: C.l2 }}>
              <b style={{ color: C.t1 }}>Версия {v.version} · {v.status === 'active' ? 'действует' : v.status === 'proposed' ? 'ждёт принятия' : v.status === 'superseded' ? 'заменена' : 'отклонена'}</b>
              {v.parts.map((p: D) => <div key={p.holderId} translate="no">{p.holderId} — {p.bp / 100} %{v.status === 'proposed' ? (p.accepted ? ' ✓' : ' …') : ''}</div>)}
              {v.status === 'proposed' && <div className="mt-1 flex gap-2">
                <button type="button" className="font-bold underline" onClick={() => void act(`/api/royalties/splits/${v.id}/accept`)}>Принять</button>
                <button type="button" className="font-bold underline" onClick={() => void act(`/api/royalties/splits/${v.id}/reject`)}>Отклонить</button>
                {v.proposedBy && <button type="button" className="underline" onClick={() => void act(`/api/royalties/splits/${v.id}/cancel`)}>Отозвать (если вы автор предложения)</button>}
              </div>}
            </div>))}
          {hist.rightsholder && (
            <div className="rounded-lg p-2" style={{ border: `1px solid ${C.border}` }}>
              <p className="mb-1 font-bold" style={{ color: C.t1 }}>Предложить новые доли (id профилей, сумма 100 %)</p>
              {rows.map((r, i) => (
                <div key={i} className="mb-1 flex gap-1">
                  <input value={r.holderId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, holderId: e.target.value } : x)))} placeholder="id профиля" aria-label="Профиль" className="min-w-0 flex-1 rounded px-2 py-1" style={{ background: C.card, color: C.t1, border: `1px solid ${C.border}` }} />
                  <input value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} inputMode="decimal" aria-label="Доля, %" className="w-16 rounded px-2 py-1" style={{ background: C.card, color: C.t1, border: `1px solid ${C.border}` }} />
                </div>))}
              <div className="flex gap-2">
                <button type="button" className="underline" onClick={() => setRows([...rows, { holderId: '', pct: '' }])}>+ участник</button>
                <button type="button" className="font-bold underline" onClick={() => void act('/api/royalties/splits', { trackId, parts: rows.map((r) => ({ holderId: r.holderId.trim(), bp: Math.round(Number(r.pct.replace(',', '.')) * 100) })) })}>Отправить предложение</button>
              </div>
            </div>)}
        </div>)}
    </div>
  );
};
