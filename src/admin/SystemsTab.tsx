/**
 * Вкладка «Состояние систем»: безопасность, Sky AI, Sky Prime и кэшбэк, Sky Gifts, партнёры.
 * Только реальные данные сервера (server/systemhealth.mjs, право `analytics`); секретов и содержимого
 * сообщений здесь нет. Если блок не посчитался — показывается ошибка блока, а не выдуманные числа.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, Loader2, ShieldCheck, Sparkles, Crown, Gift, Handshake, AlertTriangle } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', red: 'var(--red)', green: 'var(--green)', amber: '#f59e0b' };
const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'не было');
const gb = (b?: number | null) => (b == null ? '—' : `${(b / 1024 ** 3).toFixed(1)} ГБ`);

const Block = ({ icon, title, data, children }: { icon: ReactNode; title: string; data: D | undefined; children: (d: D) => ReactNode }) => (
  <section className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <p className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: C.t1 }}>{icon}{title}</p>
    {!data ? <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />
      : data.error ? <p className="flex items-center gap-1 text-[12px]" style={{ color: C.red }}><AlertTriangle size={13} />Не удалось посчитать: <span translate="no">{data.error}</span></p>
        : children(data)}
  </section>
);
const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'warn' | 'good' }) => (
  <div className="rounded-xl p-2" style={{ background: C.l2 }}>
    <p className="text-[10.5px]" style={{ color: C.t3 }}>{label}</p>
    <p className="text-[15px] font-black" style={{ color: tone === 'bad' ? C.red : tone === 'warn' ? C.amber : tone === 'good' ? C.green : C.t1 }}>{value}</p>
  </div>
);
const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>;
const bad = (n: number | null | undefined) => (n ? 'bad' as const : undefined);

export const SystemsTab = () => {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await apiCall<D>('/api/admin/analytics/systems');
    setBusy(false);
    if (r.ok && r.data) { setD(r.data); setErr(''); } else setErr(r.status === 403 ? 'Недостаточно прав.' : 'Не удалось получить состояние систем.');
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000); return () => window.clearInterval(t); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px]" style={{ color: C.t3 }}>Только реальные данные сервера. Обновляется раз в минуту{d?.at ? ` · ${when(d.at)}` : ''}.</p>
        <button type="button" aria-label="Обновить" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: C.l2 }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} style={{ color: C.t2 }} />}
        </button>
      </div>
      {err && <p className="text-[12px]" style={{ color: C.red }}>{err}</p>}

      <Block icon={<ShieldCheck size={15} />} title="Безопасность" data={d?.security}>{(s) => (<>
        {s.warnings.length === 0 ? <p className="text-[12px]" style={{ color: C.green }}>Активных предупреждений нет.</p>
          : <ul className="space-y-1">{s.warnings.map((w: D, i: number) => <li key={i} className="text-[12px]" style={{ color: w.level === 'critical' ? C.red : w.level === 'warn' ? C.amber : C.t2 }}>• {w.text}</li>)}</ul>}
        <Grid>
          <Stat label="Аккаунтов" value={fmt(s.accounts.total)} />
          <Stat label="С двухэтапной защитой" value={fmt(s.accounts.twoFactor)} />
          <Stat label="С PIN при смене IP" value={fmt(s.accounts.ipPin)} />
          <Stat label="Заморожено сейчас" value={fmt(s.accounts.frozenNow)} tone={s.accounts.frozenNow ? 'warn' : undefined} />
          <Stat label="Блок входа за 7 дн." value={fmt(s.suspicious.blockedLogins7d)} tone={s.suspicious.blockedLogins7d ? 'warn' : undefined} />
          <Stat label="Заблокировано по PIN" value={fmt(s.suspicious.pinLockedNow)} tone={s.suspicious.pinLockedNow ? 'warn' : undefined} />
          <Stat label="SSH: новые входы" value={s.ssh.paused ? 'приостановлены' : 'разрешены'} tone={s.ssh.paused ? 'warn' : 'good'} />
          <Stat label="SSH за 7 дн." value={Object.entries(s.ssh.requests7d).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'} />
        </Grid>
        <Grid>
          <Stat label="Хранилище" value={s.storage.emergency ? 'аварийно отключено' : s.storage.maintenance ? 'тех. работы' : 'работает'} tone={s.storage.emergency ? 'bad' : s.storage.maintenance ? 'warn' : 'good'} />
          <Stat label="Заполнение" value={s.storage.capacity ? `${s.storage.capacity.pct}% · ${gb(s.storage.capacity.used)} / ${gb(s.storage.capacity.total)}` : '—'} tone={s.storage.capacity && ['critical', 'block', 'full'].includes(s.storage.capacity.level) ? 'bad' : undefined} />
          <Stat label="Основное хранение" value={s.storage.primary?.enabled ? 'S3' : 'диск сервера'} />
          <Stat label="Карантин файлов" value={fmt(s.storage.quarantineHeld)} />
          <Stat label="Отказы подтверждения за 7 дн." value={fmt(s.confirmationErrors.sshDenied7d + s.confirmationErrors.sshExhausted7d + s.confirmationErrors.storageDenied7d)} tone={bad(s.confirmationErrors.sshExhausted7d)} />
          <Stat label="Последняя копия" value={when(s.backups.lastGoodAt)} tone={s.backups.lastGoodAt ? undefined : 'warn'} />
          <Stat label="Проверена" value={when(s.backups.lastVerifiedAt)} />
          <Stat label="Копии за 7 дн." value={Object.entries(s.backups.last7d).map(([k, v]) => `${k}: ${v}`).join(', ') || 'нет'} />
        </Grid>
        {s.criticalEvents.length > 0 && (<div><p className="mb-1 text-[11px] font-bold" style={{ color: C.t3 }}>ПОСЛЕДНИЕ СОБЫТИЯ (7 ДНЕЙ)</p>
          {s.criticalEvents.map((e: D, i: number) => <p key={i} className="text-[11.5px]" translate="no" style={{ color: e.level === 'critical' ? C.red : C.amber }}>{when(e.at)} · {e.level} · {e.kind}</p>)}</div>)}
      </>)}</Block>

      <Block icon={<Sparkles size={15} />} title="Sky AI" data={d?.ai}>{(a) => (
        <Grid>
          <Stat label="Провайдер" value={<span translate="no" className="text-[12px]">{a.chat.configured ? `${a.chat.provider}` : 'не настроен'}</span>} tone={a.chat.configured ? undefined : 'bad'} />
          <Stat label="Распознавание речи" value={a.stt.configured ? 'настроено' : 'не настроено'} />
          <Stat label="Токены сегодня" value={fmt(a.spend.today)} />
          <Stat label="Токены за месяц" value={fmt(a.spend.month)} />
          <Stat label="Лимит в сутки" value={a.spend.dailyLimit ? fmt(a.spend.dailyLimit) : 'без лимита'} />
          <Stat label="Лимит в месяц" value={a.spend.monthlyLimit ? fmt(a.spend.monthlyLimit) : 'без лимита'} />
          <Stat label="Ошибки за 15 мин" value={fmt(a.errors15m)} tone={bad(a.errors15m)} />
          <Stat label="Запросы / ошибки за 7 дн." value={`${fmt(a.requests7d)} / ${fmt(a.errors7d)}`} tone={bad(a.errors7d)} />
          <Stat label="Остаток у поставщика" value={a.quotaKnown ? 'известен' : 'неизвестно'} />
          <Stat label="Блокировка при лимите" value={a.blockWhenExhausted ? 'включена' : 'выключена'} />
        </Grid>)}</Block>

      <Block icon={<Crown size={15} />} title="Sky Prime и кэшбэк" data={d?.prime}>{(p) => (
        <Grid>
          <Stat label="Участников Prime" value={fmt(p.members)} />
          <Stat label="Кэшбэк" value={p.cashback.enabled ? 'включён' : 'выключен'} tone={p.cashback.enabled ? 'good' : undefined} />
          <Stat label="Начислено баллов" value={`${fmt(p.cashback.paidPoints)} (${fmt(p.cashback.paidCount)})`} />
          <Stat label="За этот месяц" value={fmt(p.cashback.paidThisMonth)} />
          <Stat label="Ожидает начисления" value={`${fmt(p.cashback.pendingPoints)} (${fmt(p.cashback.pendingCount)})`} />
          <Stat label="Просрочено к начислению" value={fmt(p.cashback.overdue)} tone={bad(p.cashback.overdue)} />
          <Stat label="Предел на человека в мес." value={fmt(p.cashback.monthlyCapPerPerson)} />
          <Stat label="Отменено за 30 дн." value={fmt(p.suspicious.cancelledCashback30d)} tone={p.suspicious.cancelledCashback30d ? 'warn' : undefined} />
          <Stat label="Наград в каталоге" value={`${fmt(p.rewards.active)} из ${fmt(p.rewards.total)}`} />
          <Stat label="Закончились" value={fmt(p.rewards.soldOut)} tone={p.rewards.soldOut ? 'warn' : undefined} />
          <Stat label="Обмены за 30 дн." value={Object.entries(p.rewards.redemptions30d).map(([k, v]) => `${k}: ${v}`).join(', ') || 'нет'} />
          <Stat label="Сбойных обменов" value={fmt(p.suspicious.failedRedemptions30d)} tone={bad(p.suspicious.failedRedemptions30d)} />
        </Grid>)}</Block>

      <Block icon={<Gift size={15} />} title="Sky Gifts" data={d?.gifts}>{(g) => (<>
        <Grid>
          <Stat label="Каталог" value={g.catalog?.total == null ? 'недоступен' : `${fmt(g.catalog.active)} из ${fmt(g.catalog.total)}`} tone={g.catalog?.total == null ? 'bad' : undefined} />
          <Stat label="Заказов подарков" value={fmt(g.ordersTotal)} />
          <Stat label="NFT выпущено" value={fmt(g.nft.materialized)} />
          <Stat label="У платформы / у людей" value={`${fmt(g.nft.mint)} / ${fmt(g.nft.realOwners)}`} />
          <Stat label="Покупок NFT за 7 дн." value={`${fmt(g.nft.purchases7d.count)} · ${fmt(g.nft.purchases7d.rub)} ₽`} />
          <Stat label="Оплачено, не выдано" value={fmt(g.problems.paidNotDelivered)} tone={bad(g.problems.paidNotDelivered)} />
          <Stat label="Застрявшие заказы" value={fmt(g.problems.stuckOrders)} tone={bad(g.problems.stuckOrders)} />
          <Stat label="Проблемы владения" value={fmt(g.problems.demoOwners + g.problems.unknownOwners + g.problems.staleListings)} tone={bad(g.problems.demoOwners + g.problems.unknownOwners + g.problems.staleListings)} />
        </Grid>
        <p className="text-[11px]" style={{ color: C.t3 }}>Заказы по статусам: {Object.entries(g.ordersByStatus).map(([k, v]) => `${k}: ${v}`).join(', ') || 'нет'}. Подробности и история — вкладка «Подарки» → «Диагностика».</p>
      </>)}</Block>

      <Block icon={<Handshake size={15} />} title="Партнёры" data={d?.partners}>{(p) => (
        <Grid>
          <Stat label="Активные" value={fmt(p.active)} tone={p.active ? 'good' : undefined} />
          <Stat label="Ждут проверки" value={fmt(p.review)} tone={p.review ? 'warn' : undefined} />
          <Stat label="Приостановлены" value={fmt(p.suspended)} tone={p.suspended ? 'warn' : undefined} />
          <Stat label="Черновики / архив" value={`${fmt(p.draft)} / ${fmt(p.archive)}`} />
          <Stat label="Истекает договор (14 дн.)" value={fmt(p.expiringPartners14d)} tone={p.expiringPartners14d ? 'warn' : undefined} />
          <Stat label="Истекают предложения (14 дн.)" value={fmt(p.expiringOffers14d)} tone={p.expiringOffers14d ? 'warn' : undefined} />
        </Grid>)}</Block>
    </div>
  );
};
