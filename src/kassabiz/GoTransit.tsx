/** Sky для бизнеса → Sky GO → «Проезд»: продукты-билеты, проверка QR на борту, возвраты, статистика. Для организаций категории «Пассажирский транспорт». */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { Scanner } from '@/auth/DeviceLinkPhone';
import { transitOwner, transitErr, type TProduct, type TTicket, type TValidation } from '@/go/transitApi';
import { Btn, In, Stat, card, dt } from './ui';

const Box = ({ title, children }: { title: string; children: React.ReactNode }) => <div className="space-y-2 rounded-2xl p-4" style={card}><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>{title}</p>{children}</div>;
const KINDS: [string, string][] = [['single', 'Разовая поездка'], ['multi', 'Пакет поездок'], ['period', 'Проездной на срок']];

const Validator = () => {
  const [res, setRes] = useState<{ ok: boolean; text: string; sub?: string } | null>(null); const [manual, setManual] = useState(''); const [busy, setBusy] = useState(false);
  const check = useCallback(async (token: string) => {
    if (busy) return; setBusy(true);
    try {
      const r = await transitOwner.validate(token.trim());
      if (!r.ok) setRes({ ok: false, text: transitErr(r) });
      else { const d = r.data as TValidation; setRes({ ok: true, text: d.result === 'recent' ? `Пересадка: проверен ${d.minutesAgo ?? 0} мин назад` : 'Проезд разрешён', sub: `${d.name ?? ''}${d.ridesLeft != null ? ` · осталось поездок: ${d.ridesLeft}` : ''}` }); }
    } finally { setBusy(false); }
  }, [busy]);
  return (
    <Box title="Проверка билета на борту">
      <Scanner onCode={(t) => void check(t)} />
      <div className="flex gap-2"><div className="flex-1"><In label="Или вставьте код билета" value={manual} onChange={setManual} max={120} /></div><div className="self-end pb-0.5"><Btn tone="accent" disabled={!manual.trim() || busy} onClick={() => { void check(manual); setManual(''); }}>Проверить</Btn></div></div>
      {res && <div className="rounded-xl p-3 text-center" style={{ background: res.ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)', color: res.ok ? 'var(--green, #22c55e)' : 'var(--red)' }}><p className="text-lg font-black">{res.text}</p>{res.sub && <p className="text-sm" translate="no">{res.sub}</p>}</div>}
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>QR билета меняется каждые 30 секунд: устаревший код или скриншот не принимается. Разовый билет гасится сразу, у пакета списывается одна поездка, повторная отметка в течение 10 минут (пересадка) поездку не списывает.</p>
    </Box>
  );
};

const Products = () => {
  const [list, setList] = useState<TProduct[] | null>(null); const [f, setF] = useState({ name: '', kind: 'single', rides: '', validDays: '1', priceRub: '' }); const [no, setNo] = useState(false);
  const load = useCallback(() => { void transitOwner.products().then((r) => { if (r.ok) setList(r.data!.products); else if (r.error === 'not_transit') setNo(true); }); }, []); useEffect(load, [load]);
  if (no) return <p className="text-sm" style={{ color: 'var(--t2)' }}>{transitErr({ error: 'not_transit' })} Выберите категорию во вкладке «Карточка».</p>;
  const add = async () => {
    const r = await transitOwner.saveProduct(null, { name: f.name, kind: f.kind as TProduct['kind'], rides: f.rides ? Number(f.rides) : null, validDays: Number(f.validDays) || 1, priceRub: Number(f.priceRub) });
    if (!r.ok) return flash('Проверьте поля: название, цена, у пакета — число поездок'); setF({ name: '', kind: 'single', rides: '', validDays: '1', priceRub: '' }); load();
  };
  return (
    <Box title="Билеты, которые вы продаёте">
      {!list ? <Loader2 className="animate-spin" size={16} /> : list.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-2 text-sm" style={{ color: 'var(--t1)', opacity: p.active ? 1 : 0.5 }}>
          <span translate="no"><b>{p.name}</b> · {p.kindLabel}{p.rides ? ` ${p.rides}` : ''} · {p.validDays} дн. · {p.priceRub} ₽</span>
          <Btn small onClick={() => void transitOwner.saveProduct(p.id, { ...p, active: !p.active }).then(load)}>{p.active ? 'Снять с продажи' : 'Вернуть'}</Btn></div>))}
      <div className="grid grid-cols-2 gap-2">
        <In label="Название" value={f.name} onChange={(v) => setF({ ...f, name: v })} max={80} />
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Вид<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, validDays: e.target.value === 'single' ? '1' : '30' })} className="mt-0.5 block w-full rounded-lg px-2 py-2 text-sm" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        {f.kind === 'multi' && <In label="Число поездок" value={f.rides} onChange={(v) => setF({ ...f, rides: v.replace(/\D/g, '') })} max={3} />}
        <In label="Срок действия, дней" value={f.validDays} onChange={(v) => setF({ ...f, validDays: v.replace(/\D/g, '') })} max={3} /><In label="Цена, ₽" value={f.priceRub} onChange={(v) => setF({ ...f, priceRub: v.replace(/\D/g, '') })} max={6} />
      </div>
      <Btn tone="accent" onClick={() => void add()}>Добавить билет</Btn>
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Правка продукта не меняет уже проданные билеты. Оплату принимаете вы по реквизитам SkyKassa Business и подтверждаете во вкладке платежей — после этого у покупателя появляется QR.</p>
    </Box>
  );
};

const Refunds = () => {
  const [list, setList] = useState<TTicket[] | null>(null); const [why, setWhy] = useState('');
  const load = useCallback(() => { void transitOwner.tickets('refund_requested').then((r) => r.ok && setList(r.data!.tickets)); }, []); useEffect(load, [load]);
  if (!list || !list.length) return null;
  return (
    <Box title={`Запросы на возврат: ${list.length}`}>
      <In label="Причина отказа (если отказываете)" value={why} onChange={setWhy} max={200} />
      {list.map((t) => <div key={t.id} className="flex items-center justify-between gap-2 text-sm" style={{ color: 'var(--t1)' }}><span translate="no">{t.name} · {t.priceRub} ₽ · {dt(t.createdAt)}</span>
        <span className="flex gap-1"><Btn small tone="accent" onClick={() => void transitOwner.refund(t.id, true).then((r) => { flash(r.ok ? 'Одобрено. Верните деньги переводом.' : transitErr(r)); load(); })}>Одобрить</Btn>
          <Btn small tone="danger" onClick={() => void transitOwner.refund(t.id, false, why).then((r) => { flash(r.ok ? 'Отказано' : 'Укажите причину отказа'); load(); })}>Отказать</Btn></span></div>)}
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Sky деньги не возвращает: после одобрения билет гасится, а вернуть оплату вы должны сами (и отметить возврат платежа в SkyKassa Business).</p>
    </Box>
  );
};

const Stats = () => {
  const [s, setS] = useState<{ byStatus: Record<string, number>; validations30d: { ok: number; recent: number; rejected: number }; soldRub: number } | null>(null);
  useEffect(() => { void transitOwner.stats().then((r) => r.ok && setS(r.data!)); }, []);
  if (!s) return null;
  return <div className="grid grid-cols-2 gap-2"><Stat k="Продано на сумму, ₽" v={s.soldRub} sub="по подтверждённым оплатам" /><Stat k="Проверок за 30 дней" v={s.validations30d.ok + s.validations30d.recent} sub={`отклонено: ${s.validations30d.rejected}`} />
    <Stat k="Действующих билетов" v={s.byStatus.active ?? 0} /><Stat k="Использовано" v={s.byStatus.used ?? 0} /></div>;
};

export const GoTransit = () => <div className="space-y-3"><Stats /><Validator /><Refunds /><Products /></div>;
