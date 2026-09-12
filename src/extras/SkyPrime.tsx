import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Crown, Check, Star, Zap, Shield, Music2, Film, Radio, Sparkles, Gift, TrendingUp, X } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMoney, fmt as fmtMoney, reloadWalletForUser } from '@/wallet/store';
import { usePlatformStore } from '@/platform/store';
import { REWARDS, TIER_LIST, tierFor, lifetimePointsOf, progressToNextTier, earnPrimePoints, redeemPrimeReward } from '@/prime/pointsStore';
import { useRegionStore } from '@/region/store';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

const FEATURES = [
  { icon: Music2, title: 'Музыка без рекламы', desc: 'Весь каталог Sky Music без ограничений', prime: true },
  { icon: Film, title: 'Sky Film HD', desc: 'Фильмы и сериалы в качестве 4K', prime: true },
  { icon: Radio, title: 'Live-трансляции', desc: 'Запускай стримы без лимитов', prime: true },
  { icon: Shield, title: 'Приватные истории', desc: 'Close Friends и расширенная аналитика', prime: true },
  { icon: Star, title: 'Значок Prime', desc: 'Золотой значок рядом с именем', prime: true },
  { icon: Sparkles, title: 'AI-ассистент', desc: 'Умный помощник в чатах и контенте', prime: true },
  { icon: Zap, title: 'Приоритетная поддержка', desc: 'Ответ команды в течение 2 часов', prime: true },
  { icon: Crown, title: 'Ранний доступ', desc: 'Новые функции раньше всех', prime: true },
];

const PLANS = [
  { id: 'month', label: 'Месяц', price: '299₽', period: '/мес', days: 30, popular: false },
  { id: 'year', label: 'Год', price: '1990₽', period: '/год', sub: 'Экономия 598₽', days: 365, popular: true },
  { id: 'forever', label: 'Навсегда', price: '4990₽', period: '', sub: 'Разовая оплата', days: 36500, popular: false },
];

const PointsCard = ({ isPrime }: { isPrime: boolean }) => {
  const { currentUserId } = useAuthStore();
  const { getPoints } = useMoney(); // без селектора => компонент реактивен на любые изменения кошелька
  const [showRewards, setShowRewards] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const uid = currentUserId ?? '';
  const points = getPoints(uid);
  const lifetime = lifetimePointsOf(uid);
  const curTier = tierFor(lifetime);
  const { next, pct, remaining } = progressToNextTier(lifetime);

  const handleRedeem = async (id: string, title: string) => {
    const ok = await redeemPrimeReward(id);
    setToast(ok ? `Обменяно: ${title} ✓` : useMoney.getState().lastError ?? 'Недостаточно баллов');
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div className={isMobile ? 'mb-4 rounded-xl p-3.5' : 'mb-8 rounded-2xl p-5'} style={{ background: 'rgba(14,16,26,0.6)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: curTier.color }}>{curTier.label}</p>
            {isPrime && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber)' }}>x2 баллы</span>}
          </div>
          <p className={isMobile ? 'mt-1 text-lg font-black text-white' : 'mt-1 text-2xl font-black text-white'}>{points.toLocaleString('ru')} <span className="text-sm font-medium" style={{ color: 'var(--t3)' }}>баллов</span></p>
        </div>
        <div className={isMobile ? 'grid h-9 w-9 place-items-center rounded-xl text-xl' : 'grid h-12 w-12 place-items-center rounded-2xl text-xl'} style={{ background: `${curTier.color}20` }}>
          <Sparkles size={isMobile ? 16 : 20} style={{ color: curTier.color }}/>
        </div>
      </div>

      {next && (
        <div className={isMobile ? 'mt-3' : 'mt-4'}>
          <div className="mb-1.5 flex items-center justify-between text-[11px]" style={{ color: 'var(--t3)' }}>
            <span>До {next.label}</span><span>{remaining.toLocaleString('ru')} баллов</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <motion.div className="h-full rounded-full" style={{ background: next.color }}
              initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }}/>
          </div>
        </div>
      )}

      <div className={isMobile ? 'mt-2.5 flex items-center gap-1.5' : 'mt-3 flex items-center gap-1.5'}>
        {TIER_LIST.map(t => (
          <div key={t.key} className="flex flex-1 flex-col items-center gap-1">
            <div className="h-1 w-full rounded-full" style={{ background: lifetime >= t.min ? t.color : 'rgba(255,255,255,0.08)' }}/>
            <span className="text-[9px] font-semibold" style={{ color: curTier.key === t.key ? t.color : 'var(--t3)' }}>{t.label}</span>
          </div>
        ))}
      </div>

      <div className={isMobile ? 'mt-3 flex gap-1.5' : 'mt-4 flex gap-2'}>
        <button type="button" onClick={() => setShowRewards(true)}
          className={isMobile ? 'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] font-bold text-white' : 'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold text-white'}
          style={{ background: 'var(--accent)' }}>
          <Gift size={13}/>Каталог наград
        </button>
        <button type="button" onClick={() => earnPrimePoints(isPrime ? 200 : 100, 'Демо-начисление')}
          className={isMobile ? 'flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11.5px] font-bold' : 'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-bold'}
          style={{ background: 'var(--bg-l2, rgba(255,255,255,0.06))', color: 'var(--t2)' }}>
          <TrendingUp size={13}/>+баллы
        </button>
      </div>

      {!isMobile && (
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          Баллы начисляются за покупки в Sky Market и активность на платформе
          {isPrime ? ' — с двойным множителем для Prime-подписчиков.' : '. Оформи Prime, чтобы получать баллы x2.'}
        </p>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="mt-3 rounded-xl px-3 py-2 text-center text-[12px] font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRewards && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setShowRewards(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()}
              className={isMobile ? 'max-h-[75vh] w-full overflow-y-auto rounded-t-2xl p-3.5' : 'max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5'} style={{ background: '#12141c' }}>
              <div className={isMobile ? 'mb-3 flex items-center justify-between' : 'mb-4 flex items-center justify-between'}>
                <p className={isMobile ? 'text-sm font-black text-white' : 'text-base font-black text-white'}>Каталог наград</p>
                <button type="button" onClick={() => setShowRewards(false)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <div className={isMobile ? 'space-y-2' : 'space-y-2.5'}>
                {REWARDS.map(r => (
                  <div key={r.id} className={isMobile ? 'flex items-center gap-2.5 rounded-xl p-2.5' : 'flex items-center gap-3 rounded-2xl p-3'} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className={isMobile ? 'grid h-9 w-9 shrink-0 place-items-center rounded-lg' : 'grid h-11 w-11 shrink-0 place-items-center rounded-xl'} style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <r.Icon size={isMobile ? 17 : 20} style={{ color: 'var(--amber)' }}/>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-white">{r.title}</p>
                      <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{r.desc}</p>
                    </div>
                    <button type="button" onClick={() => handleRedeem(r.id, r.title)}
                      disabled={points < r.cost}
                      className="shrink-0 rounded-xl px-3 py-2 text-[11.5px] font-bold disabled:opacity-35"
                      style={{ background: 'var(--accent)', color: '#fff' }}>
                      {r.cost} б.
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const SkyPrime = () => {
  const { accounts, currentUserId, purchasePrime, cancelPrime } = useAuthStore();
  const { grantPrime: grantPlatformPrime, revokePrime } = usePlatformStore();
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const { formatPrice, isWorldwide } = useRegionStore();
  const isMobile = useIsMobile();

  const { getBalance } = useMoney();
  const walletBalance = getBalance(currentUserId ?? '');

  const PRICES: Record<number, number> = { 30: 400, 365: 3790, 730: 6990 };

  // Покупку проводит сервер: он берёт цену из своей таблицы, списывает
  // с кошелька профиля и только потом выписывает подписку. Раньше списание
  // и выдача шли из браузера, а результат списания даже не проверялся —
  // Prime доставался бесплатно.
  const handleBuy = async (days: number) => {
    if (buying) return;
    setBuying(true); setBuyError(null);
    const res = await purchasePrime(
      days === 30 ? 'month' : days === 365 ? 'year' : 'two_years', days,
    );
    setBuying(false);
    if (!res.ok) { setBuyError(res.reason ?? 'Не удалось оформить подписку'); return; }
    await reloadWalletForUser(currentUserId ?? null);
    grantPlatformPrime(days);
  };

  const handleCancel = async () => {
    const res = await cancelPrime();
    if (res.ok) revokePrime();
  };

  if (isPrime) return (
    <div className={isMobile ? 'flex h-full flex-col items-center overflow-y-auto p-3' : 'flex h-full flex-col items-center overflow-y-auto p-6'}>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md">
        {/* Активный Prime */}
        <div className={isMobile ? 'mb-3.5 overflow-hidden rounded-xl p-4 text-center' : 'mb-6 overflow-hidden rounded-xl p-6 text-center'}
          style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(251,191,36,0.1), rgba(245,158,11,0.05))', border: '1px solid rgba(245,158,11,0.3)' }}>
          <Crown size={isMobile ? 34 : 48} style={{ color: 'var(--amber)', margin: isMobile ? '0 auto 8px' : '0 auto 12px' }} />
          <h2 className={isMobile ? 'text-lg font-bold text-white' : 'text-2xl font-bold text-white'}>Sky Prime активен</h2>
          {me?.primeUntil && (
            <p className="mt-1 text-sm" style={{ color: '#92400e' }}>
              До {new Date(me.primeUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
          {!isMobile && <p className="mt-3 text-sm" style={{ color: 'var(--t2)' }}>Ты используешь все возможности платформы</p>}
        </div>

        {/* Баллы и бонусы */}
        <PointsCard isPrime={true}/>

        {/* Список привилегий */}
        <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
          {FEATURES.map(f => (
            <div key={f.title} className={isMobile ? 'flex items-center gap-2.5 rounded-xl px-3 py-2.5' : 'flex items-center gap-3 rounded-2xl px-4 py-3'}
              style={{ background: 'rgba(14,16,26,0.6)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className={isMobile ? 'grid h-8 w-8 shrink-0 place-items-center rounded-xl' : 'grid h-9 w-9 shrink-0 place-items-center rounded-2xl'}
                style={{ background: 'rgba(245,158,11,0.1)' }}>
                <f.icon size={isMobile ? 14 : 16} style={{ color: 'var(--amber)' }} />
              </div>
              <div className="flex-1">
                <p className={isMobile ? 'text-[13px] font-medium text-white' : 'text-sm font-medium text-white'}>{f.title}</p>
                {!isMobile && <p className="text-xs" style={{ color: 'var(--t3)' }}>{f.desc}</p>}
              </div>
              <Check size={16} style={{ color: '#22c55e' }} />
            </div>
          ))}
        </div>

        <button type="button" onClick={handleCancel}
          className={isMobile ? 'mt-4 w-full rounded-xl py-2.5 text-[13px]' : 'mt-6 w-full rounded-2xl py-3 text-sm'} style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--t3)' }}>
          Отменить подписку
        </button>
      </motion.div>
    </div>
  );

  return (
    <div className={isMobile ? 'flex h-full flex-col items-center overflow-y-auto p-3' : 'flex h-full flex-col items-center overflow-y-auto p-6'}>
      <div className="w-full max-w-md">
        {/* Заголовок */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className={isMobile ? 'mb-4 text-center' : 'mb-8 text-center'}>
          <div className={isMobile ? 'mx-auto mb-2.5 grid h-14 w-14 place-items-center rounded-xl' : 'mx-auto mb-4 grid h-20 w-20 place-items-center rounded-xl'}
            style={{ background: 'linear-gradient(135deg, #f59e0b, #fbbf24)', boxShadow: '0 12px 40px rgba(245,158,11,0.35)' }}>
            <Crown size={isMobile ? 26 : 36} className="text-white" />
          </div>
          <h1 className={isMobile ? 'text-xl font-black text-white' : 'text-3xl font-black text-white'}>Sky Prime</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }}>Разблокируй весь потенциал платформы</p>
        </motion.div>

        {/* Баллы и бонусы */}
        <PointsCard isPrime={false}/>

        {/* Фичи */}
        <div className={isMobile ? 'mb-4 grid grid-cols-2 gap-2' : 'mb-8 grid grid-cols-2 gap-3'}>
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={isMobile ? 'rounded-xl p-2.5' : 'rounded-2xl p-3'}
              style={{ background: 'rgba(14,16,26,0.6)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <f.icon size={isMobile ? 15 : 18} style={{ color: 'var(--amber)', marginBottom: isMobile ? 6 : 8 }} />
              <p className={isMobile ? 'text-[11.5px] font-semibold text-white' : 'text-xs font-semibold text-white'}>{f.title}</p>
              <p className={isMobile ? 'mt-0.5 text-[9.5px]' : 'mt-0.5 text-[10px]'} style={{ color: 'var(--t3)' }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Планы */}
        <div className={isMobile ? 'space-y-2' : 'space-y-3'}>
          {PLANS.map((plan, i) => (
            <motion.button key={plan.id} type="button"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.06 }}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              onClick={() => handleBuy(plan.days)} disabled={buying}
              className={isMobile ? 'relative w-full overflow-hidden rounded-xl p-3.5 text-left' : 'relative w-full overflow-hidden rounded-xl p-5 text-left'}
              style={{
                background: plan.popular ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(251,191,36,0.1))' : 'rgba(14,16,26,0.6)',
                border: plan.popular ? '1px solid rgba(245,158,11,0.4)' : '1px solid rgba(255,255,255,0.07)',
              }}>
              {plan.popular && (
                <span className={isMobile ? 'absolute right-3 top-3 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white' : 'absolute right-4 top-4 rounded-full px-2 py-0.5 text-[10px] font-bold text-white'}
                  style={{ background: 'rgba(245,158,11,0.8)' }}>ВЫГОДНО</span>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className={isMobile ? 'text-[13px] font-semibold text-white' : 'font-semibold text-white'}>{plan.label}</p>
                  {plan.sub && <p className="text-xs" style={{ color: 'var(--amber)' }}>{plan.sub}</p>}
                </div>
                <div className="text-right">
                  <span className={isMobile ? 'text-lg font-black text-white' : 'text-2xl font-black text-white'}>{plan.price}</span>
                  <span className="text-sm" style={{ color: 'var(--t3)' }}>{plan.period}</span>
                  {!isWorldwide() && useRegionStore.getState().code !== 'RU' && (
                    <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>≈ {formatPrice(parseInt(plan.price))}</p>
                  )}
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        {buyError && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mt-3 text-center text-xs leading-snug" style={{ color: 'var(--red)' }} role="alert">
            {buyError}
          </motion.p>
        )}

        {/* Wallet balance check */}
        <div className={isMobile ? 'mt-3 rounded-xl px-3 py-2.5 flex items-center gap-2.5' : 'mt-4 rounded-2xl px-4 py-3 flex items-center gap-3'}
          style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize:16 }}>💳</span>
          <div className="flex-1">
            <p className="text-xs font-semibold text-white">Баланс SkyMoney</p>
            <p className="text-xs" style={{ color:'var(--t3)' }}>
              Доступно: <span style={{ color: walletBalance > 0 ? 'var(--green)' : 'var(--t2)' }}>
                {walletBalance.toLocaleString('ru')} ₽
              </span>
            </p>
          </div>
          {walletBalance < 400 && (
            <p className="text-[10px] px-2 py-1 rounded-full" style={{ background:'rgba(248,113,113,0.15)', color:'var(--red)' }}>
              Недостаточно
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
