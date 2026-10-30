/**
 * Вкладка «ОФД»: справочная сводка по поступлениям, чекам и ориентировочному налогу за день или период. Право finance.
 * Честно: Sky НЕ подключён к оператору фискальных данных и не пробивает кассовые чеки; «чеки» здесь — квитанции о пополнении, отправленные на почту
 * (подтверждение операции Sky). Налог — расчёт по ставке, которую задаёт владелец (Email-коммуникации → Настройки отправителя); это не налоговая отчётность
 * и не консультация. Данные — только из базы: пополнения SkyKassa, покупки Prime, заказы Market / SkyKassa Business / Sky GO. Сервер — server/emailcomms.mjs (ofdSummary).
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t3: 'var(--t3)' };
interface Sum { from: string; to: string; today: string; tz: string; receiptsSent: number; orders: { market: number; business: number; go: number; total: number }; topupSum: number; feeSum: number; primeSum: number; revenue: number; taxBase: number; taxRatePct: number; includeTopups: boolean; tax: number; entries: { at: string; kind: 'topup' | 'prime'; ref: string; who: string | null; amount: number }[] }
const rub = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

export const OfdTab = () => {
  const [d, setD] = useState<Sum | null>(null); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await apiCall<Sum>(`/api/admin/ofd?from=${from}&to=${to || from}`);
    if (r.ok && r.data) { setD(r.data); setErr(''); } else setErr('Не удалось загрузить сводку');
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <div className="grid place-items-center py-10">{err ? <p style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  const box = { background: C.l1, border: `1px solid ${C.brd}` };
  const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => <div className="rounded-2xl p-3" style={box}><div className="text-xs" style={{ color: C.t3 }}>{k}</div><div className="mt-1 text-xl font-bold" style={{ color: C.t1 }}>{v}</div>{sub && <div className="mt-0.5 text-xs" style={{ color: C.t3 }}>{sub}</div>}</div>;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3 text-xs leading-relaxed" style={{ ...box, color: C.t3 }}>
        Справочная сводка. Sky не подключён к оператору фискальных данных и не пробивает кассовые чеки: «чеки» — квитанции о пополнении, отправленные на почту. Налог — ориентировочный расчёт по ставке из настроек, а не налоговая отчётность. Дата — по часовому поясу {d.tz}.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={from || d.from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl px-3 py-2 text-xs" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }} />
        <span style={{ color: C.t3 }}>—</span>
        <input type="date" value={to || d.to} onChange={(e) => setTo(e.target.value)} className="rounded-xl px-3 py-2 text-xs" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }} />
        <button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }} onClick={() => { setFrom(''); setTo(''); }}>Сегодня</button>
        <span className="text-xs" style={{ color: C.t3 }}>{d.from === d.to ? d.from : `${d.from} — ${d.to}`}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Отправлено чеков (квитанций)" v={String(d.receiptsSent)} sub="письма о пополнении, ушедшие на почту" />
        <Stat k="Заказов сделано" v={String(d.orders.total)} sub={`Market ${d.orders.market} · SkyKassa Business ${d.orders.business} · Sky GO ${d.orders.go}`} />
        <Stat k="Получено денег (пополнения)" v={rub(d.topupSum)} sub="зачислено на кошельки SkyMoney" />
        <Stat k="Выручка Sky" v={rub(d.revenue)} sub={`Prime ${rub(d.primeSum)} + комиссии ${rub(d.feeSum)}`} />
      </div>
      <div className="rounded-2xl p-3" style={box}>
        <div className="text-sm font-semibold" style={{ color: C.t1 }}>Налог (ориентировочно)</div>
        <div className="mt-1 text-2xl font-bold" style={{ color: C.t1 }}>{rub(d.tax)}</div>
        <div className="mt-1 text-xs" style={{ color: C.t3 }}>База {rub(d.taxBase)} × ставка {d.taxRatePct} %. {d.includeTopups ? 'В базу включены пополнения кошельков.' : 'Пополнения кошельков в базу не входят: это деньги людей на балансе, а не выручка, пока они не потрачены.'} Ставку и состав базы задаёт владелец; какая система налогообложения у вашей организации — вопрос к бухгалтеру.</div>
      </div>
      <div className="overflow-x-auto rounded-2xl" style={box}>
        <table className="w-full min-w-[560px] text-left text-xs" style={{ color: C.t1 }}>
          <thead style={{ color: C.t3 }}><tr>{['Время', 'Тип', 'Номер', 'Кто', 'Сумма'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>{d.entries.map((e, i) => <tr key={i} className="border-t" style={{ borderColor: C.brd }}><td className="px-3 py-2 whitespace-nowrap">{new Date(e.at).toLocaleString('ru-RU')}</td><td className="px-3 py-2">{e.kind === 'topup' ? 'Пополнение кошелька' : 'Покупка Sky Prime'}</td><td className="px-3 py-2">{e.ref}</td><td className="px-3 py-2">{e.who ? `@${e.who}` : '—'}</td><td className="px-3 py-2 font-semibold">{rub(e.amount)}</td></tr>)}</tbody>
        </table>
        {!d.entries.length && <p className="p-4 text-sm" style={{ color: C.t3 }}>Поступлений за выбранный период нет.</p>}
      </div>
    </div>
  );
};
