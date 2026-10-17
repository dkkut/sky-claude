/**
 * Мониторинг и аналитика — основная вкладка админки. Только реальные
 * данные сервера (server/analytics.mjs): онлайн по живым соединениям,
 * регистрации, сделки, покупки, состояние машины. Где данных ещё нет —
 * так и написано, а не нарисовано.
 */
import { visibleTick } from '@/shared/visibleTick';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Cpu, Database, Users, Handshake, ShoppingBag, Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

interface DayRow { day: string; n?: number; created?: number }
interface Overview {
  days: number; generatedAt: string; collectingSince: string | null;
  online: { now: number; sessions: number; peak24h: number; avg24h: number; series: { ts: string; avg: number; max: number }[] };
  users: { total: number; newInPeriod: number; newPrevPeriod: number; prime: number; activeToday: number; registrationsPerDay: DayRow[]; activePerDay: DayRow[] };
  deals: {
    garant: { created: number; completed: number; disputed: number; volume: number; createdPrev: number };
    market: { created: number; completed: number; cancelled: number; volume: number; createdPrev: number };
    garantPerDay: DayRow[]; marketPerDay: DayRow[];
  };
  purchases: { count: number; rubCount: number; rubSum: number; pointsCount: number; pointsSum: number; countPrev: number; byType: { type: string; count: number; sum: number; unit: 'rub' | 'points' }[]; perDay: DayRow[] };
}
interface Live {
  at: string; online: { users: number; sessions: number };
  metrics: {
    level: 0 | 1 | 2; uptimeSec: number;
    cpu: { cores: number; load1: number; load5: number; loadPerCore: number };
    memory: { machineTotal: number; machineFree: number; processRss: number };
    eventLoop: { p99Ms: number };
    disk: { totalBytes: number; freeBytes: number } | null;
    requests: { sinceStart: number; perSecond: number; errors5xx: number; errors4xx: number; medianMs: number | null; p95Ms: number | null };
    database: { ok: boolean; pingMs: number | null; pool: { total: number; idle: number; waiting: number } };
  };
  warnings: { level: 'warn' | 'critical'; text: string }[];
}

const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const fmt = (n: number) => n.toLocaleString('ru-RU');
const PURCHASE_LABEL: Record<string, string> = {
  prime: 'Prime', market: 'Market', music: 'Треки', market_subscription: 'Подписка продавца', market_promotion: 'Продвижение товара',
  pvz_subscription: 'Подписка ПВЗ', nft_purchase: 'Sky Gifts (NFT)', skin_purchase: 'Скины питомцев', ads: 'Реклама',
  garant_subscription: 'Подписка Garant', family_prime: 'Prime Family', prime_gift: 'Подарок Prime', stream_donation: 'Донаты',
  blox_purchase: 'Покупки в Sky Blox', points_spend: 'Траты баллов',
};

const Delta = ({ now, prev }: { now: number; prev: number }) => {
  if (prev === 0 && now === 0) return null;
  const pct = prev === 0 ? null : Math.round(((now - prev) / prev) * 100);
  const up = now >= prev;
  return <span className="text-[10px] font-bold" style={{ color: up ? 'var(--green)' : 'var(--red)' }}>{pct === null ? 'новое' : `${up ? '+' : ''}${pct}% к прошлому периоду`}</span>;
};

const Kpi = ({ icon: Icon, label, value, sub, extra }: { icon: typeof Users; label: string; value: string; sub?: string; extra?: React.ReactNode }) => (
  <div className="rounded-2xl p-3" style={card}>
    <div className="mb-1 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--t2)' }}><Icon size={13} />{label}</div>
    <p className="text-[22px] font-black leading-tight" style={{ color: 'var(--t1)' }}>{value}</p>
    {sub && <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>{sub}</p>}
    {extra}
  </div>
);

/** Столбики по дням. Ось и подписи — только то, что есть в данных. */
const Bars = ({ rows, color, height = 70 }: { rows: { day: string; v: number }[]; color: string; height?: number }) => {
  const max = Math.max(1, ...rows.map((r) => r.v));
  const w = 100 / Math.max(1, rows.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
        {rows.map((r, i) => {
          const h = (r.v / max) * (height - 4);
          return <rect key={r.day} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={Math.max(h, r.v ? 1 : 0)} rx={0.8} fill={color}><title>{`${r.day}: ${r.v}`}</title></rect>;
        })}
      </svg>
      <div className="flex justify-between text-[9px]" style={{ color: 'var(--t3)' }}><span>{rows[0]?.day.slice(5)}</span><span>{`макс. ${fmt(max)}`}</span><span>{rows[rows.length - 1]?.day.slice(5)}</span></div>
    </div>
  );
};

/** Линия онлайна за сутки: среднее по 15 минутам и пик. */
const OnlineLine = ({ series }: { series: Overview['online']['series'] }) => {
  if (series.length < 2) return <p className="py-6 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Замеры идут раз в минуту — график появится, когда наберётся хотя бы пара точек.</p>;
  const max = Math.max(1, ...series.map((p) => p.max));
  const t0 = new Date(series[0].ts).getTime(); const span = Math.max(1, new Date(series[series.length - 1].ts).getTime() - t0);
  const pts = (key: 'avg' | 'max') => series.map((p) => `${((new Date(p.ts).getTime() - t0) / span) * 100},${60 - (p[key] / max) * 56}`).join(' ');
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return (
    <div>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full" style={{ height: 90 }} role="img" aria-label="Онлайн за 24 часа">
        <polyline points={pts('max')} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <polyline points={pts('avg')} fill="none" stroke="var(--accent)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[9px]" style={{ color: 'var(--t3)' }}><span>{hhmm(series[0].ts)}</span><span>{`пик ${fmt(max)}`}</span><span>{hhmm(series[series.length - 1].ts)}</span></div>
    </div>
  );
};

const gb = (n: number) => `${(n / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
const Row = ({ l, v }: { l: string; v: string }) => <div className="flex justify-between text-[12px]"><span style={{ color: 'var(--t3)' }}>{l}</span><span style={{ color: 'var(--t1)' }}>{v}</span></div>;

export const MonitoringTab = () => {
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [ov, setOv] = useState<Overview | null>(null); const [live, setLive] = useState<Live | null>(null); const [err, setErr] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadOv = useCallback(async () => {
    const r = await apiCall<Overview>(`/api/admin/analytics/overview?days=${days}`);
    if (!alive.current) return;
    if (r.ok && r.data) { setOv(r.data); setErr(''); } else setErr(r.error === 'not_allowed' ? 'Недостаточно прав.' : 'Не удалось загрузить сводку.');
  }, [days]);
  const loadLive = useCallback(async () => { const r = await apiCall<Live>('/api/admin/analytics/live'); if (alive.current && r.ok && r.data) setLive(r.data); }, []);
  useEffect(() => { void loadOv(); const t = setInterval(visibleTick(() => loadOv()), 60_000); return () => clearInterval(t); }, [loadOv]);
  useEffect(() => { void loadLive(); const t = setInterval(visibleTick(() => loadLive()), 10_000); return () => clearInterval(t); }, [loadLive]);

  if (err && !ov) return <p className="p-4 text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>;
  if (!ov) return <div className="p-4"><Loader2 size={16} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>;
  const online = live?.online ?? { users: ov.online.now, sessions: ov.online.sessions };
  const m = live?.metrics;
  const sum = (rows: DayRow[], k: 'n' | 'created') => rows.map((r) => ({ day: r.day, v: (k === 'n' ? r.n : r.created) ?? 0 }));
  const level = m?.level ?? 0;

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-center gap-1.5">
        <p className="flex-1 text-[15px] font-black" style={{ color: 'var(--t1)' }}>Мониторинг и аналитика</p>
        {([7, 30, 90] as const).map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: days === d ? 'var(--accent)' : 'var(--bg-l2)', color: days === d ? '#fff' : 'var(--t2)' }}>{`${d} дн.`}</button>
        ))}
      </div>

      {live?.warnings.map((w, i) => <p key={i} className="rounded-xl px-3 py-2 text-[12px]" style={{ background: w.level === 'critical' ? 'var(--red-bg)' : 'var(--amber-bg)', color: w.level === 'critical' ? 'var(--red)' : 'var(--amber)' }}>{w.text}</p>)}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icon={Activity} label="Онлайн сейчас" value={fmt(online.users)} sub={`${fmt(online.sessions)} соединений · обновляется каждые 10 с`} />
        <Kpi icon={Users} label="Пользователей" value={fmt(ov.users.total)} sub={`Prime: ${fmt(ov.users.prime)}`}
          extra={<><p className="text-[10.5px]" style={{ color: 'var(--t2)' }}>{`+${fmt(ov.users.newInPeriod)} за ${days} дн.`}</p><Delta now={ov.users.newInPeriod} prev={ov.users.newPrevPeriod} /></>} />
        <Kpi icon={Handshake} label="Сделки за период" value={fmt(ov.deals.garant.created + ov.deals.market.created)} sub={`Garant ${fmt(ov.deals.garant.created)} · заказы Market ${fmt(ov.deals.market.created)}`}
          extra={<Delta now={ov.deals.garant.created + ov.deals.market.created} prev={ov.deals.garant.createdPrev + ov.deals.market.createdPrev} />} />
        <Kpi icon={ShoppingBag} label="Покупки за период" value={fmt(ov.purchases.count)} sub={`${fmt(ov.purchases.rubSum)} ₽ · ${fmt(ov.purchases.pointsSum)} баллов`}
          extra={<Delta now={ov.purchases.count} prev={ov.purchases.countPrev} />} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Онлайн за 24 часа</p>
          <p className="mb-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>{`Пик ${fmt(ov.online.peak24h)} · среднее ${fmt(ov.online.avg24h)}`}</p>
          <OnlineLine series={ov.online.series} />
          <p className="mt-1 text-[10px]" style={{ color: 'var(--t3)' }}>{ov.collectingSince ? `Замеры ведутся с ${new Date(ov.collectingSince).toLocaleString('ru-RU')}.` : 'Замеры ещё не начались.'}</p>
        </div>
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Активные по дням</p>
          <p className="mb-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>{`Сегодня подключались: ${fmt(ov.users.activeToday)}. Считаются с начала сбора — раньше данных нет.`}</p>
          <Bars rows={sum(ov.users.activePerDay, 'n')} color="var(--accent)" />
        </div>
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Регистрации по дням</p>
          <Bars rows={sum(ov.users.registrationsPerDay, 'n')} color="var(--green)" />
        </div>
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Покупки по дням</p>
          <Bars rows={sum(ov.purchases.perDay, 'n')} color="var(--amber)" />
        </div>
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Сделки Sky Garant</p>
          <p className="mb-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>{`Создано ${fmt(ov.deals.garant.created)} · завершено ${fmt(ov.deals.garant.completed)} · споров ${fmt(ov.deals.garant.disputed)} · оборот завершённых ${fmt(ov.deals.garant.volume)} ₽`}</p>
          <Bars rows={sum(ov.deals.garantPerDay, 'created')} color="var(--purple)" />
        </div>
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-1 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Заказы Sky Market</p>
          <p className="mb-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>{`Создано ${fmt(ov.deals.market.created)} · завершено ${fmt(ov.deals.market.completed)} · отменено ${fmt(ov.deals.market.cancelled)} · сумма завершённых ${fmt(ov.deals.market.volume)} ₽`}</p>
          <Bars rows={sum(ov.deals.marketPerDay, 'created')} color="var(--accent)" />
        </div>
      </div>

      <div className="rounded-2xl p-3" style={card}>
        <p className="mb-2 text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Покупки по видам</p>
        {ov.purchases.byType.length === 0 ? <p className="text-[11px]" style={{ color: 'var(--t3)' }}>За период покупок не было.</p> : (
          <div className="space-y-1">
            {ov.purchases.byType.map((t) => (
              <div key={t.type} className="flex items-center gap-2 text-[12px]">
                <span className="flex-1" style={{ color: 'var(--t2)' }}>{PURCHASE_LABEL[t.type] ?? t.type}</span>
                <span style={{ color: 'var(--t3)' }}>{`${fmt(t.count)} шт.`}</span>
                <span className="w-28 text-right font-semibold" style={{ color: 'var(--t1)' }}>{`${fmt(t.sum)} ${t.unit === 'points' ? 'баллов' : '₽'}`}</span>
              </div>))}
          </div>)}
        <p className="mt-2 text-[10px]" style={{ color: 'var(--t3)' }}>Рубли и баллы считаются отдельно, курса между ними нет. Пополнения и возвраты покупками не считаются.</p>
      </div>

      {m && (
        <div className="rounded-2xl p-3" style={card}>
          <p className="mb-2 text-[12px] font-bold" style={{ color: level === 2 ? 'var(--red)' : level === 1 ? 'var(--amber)' : 'var(--green)' }}>
            {`Сервер: ${['нормальная нагрузка', 'повышенная нагрузка', 'критическая нагрузка'][level]}`}</p>
          <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--t2)' }}><Cpu size={12} />Процессор и память</p>
              <Row l="Ядер" v={String(m.cpu.cores)} /><Row l="Загрузка (1 / 5 мин)" v={`${m.cpu.load1} / ${m.cpu.load5}`} /><Row l="На ядро" v={String(m.cpu.loadPerCore)} />
              <Row l="Память машины" v={`${gb(m.memory.machineTotal - m.memory.machineFree)} из ${gb(m.memory.machineTotal)}`} /><Row l="Задержка цикла событий (p99)" v={`${m.eventLoop.p99Ms} мс`} />
              <Row l="Диск" v={m.disk ? `свободно ${gb(m.disk.freeBytes)} из ${gb(m.disk.totalBytes)}` : 'недоступно'} />
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--t2)' }}><Database size={12} />API и база</p>
              <Row l="Запросов с запуска" v={fmt(m.requests.sinceStart)} /><Row l="В секунду" v={String(m.requests.perSecond)} />
              <Row l="Ошибки 5xx / 4xx" v={`${fmt(m.requests.errors5xx)} / ${fmt(m.requests.errors4xx)}`} /><Row l="Ответ (медиана / p95)" v={`${m.requests.medianMs ?? '—'} / ${m.requests.p95Ms ?? '—'} мс`} />
              <Row l="База данных" v={m.database.ok ? `доступна, ${m.database.pingMs} мс` : 'не отвечает'} /><Row l="Аптайм" v={`${Math.round(m.uptimeSec / 3600)} ч`} />
            </div>
          </div>
          <p className="mt-2 text-[10px]" style={{ color: 'var(--t3)' }}>Показатели измеряются на этом сервере; ошибки и время ответа — с последнего запуска процесса.</p>
        </div>
      )}
    </div>
  );
};
