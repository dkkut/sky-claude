/**
 * Экран «только для Prime» — один на все платные разделы (Sky Music, Sky Film, подкасты, книги, режим «Код» в Sky AI).
 * Экран — вежливость: доступ закрывает сервер (`prime_required`), цены здесь только для показа.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Crown, Music2, Film, Mic, BookOpen, Code2 } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { qrSvg } from '@/shared/qr';
import { NATIVE_APP } from '@/core/nativeApp';
import { API_ORIGIN } from '@/core/nativeApp';
import { isLimitedSurface, primeLinkUrl, useEntitlements } from '@/prime/entitlements';

export type PrimeService = 'music' | 'film' | 'podcasts' | 'books' | 'code';

const SERVICES: Record<PrimeService, { Icon: typeof Music2; label: string; text: string }> = {
  music:    { Icon: Music2,   label: 'Sky Music',    text: 'Каталог, своя коллекция и загрузка треков входят в подписку Sky Prime.' },
  film:     { Icon: Film,     label: 'Sky Film',     text: 'Вся кинотека, 4K качество и совместный просмотр доступны с подпиской Sky Prime.' },
  podcasts: { Icon: Mic,      label: 'Sky Podcasts', text: 'Каталог подкастов, подписки, продолжение с того же места и публикация своих выпусков входят в подписку Sky Prime.' },
  books:    { Icon: BookOpen, label: 'Sky Books',    text: 'Каталог аудиокниг, полка и публикация своих книг входят в подписку Sky Prime.' },
  code:     { Icon: Code2,    label: 'Sky AI · Код', text: 'Помощник по коду — написать, объяснить и исправить — входит в подписку Sky Prime. Обычный чат работает без неё.' },
};

/** ТВ, консоль и машина: подписка оформляется только с телефона. Экран ждёт и сам открывается, когда сервер подтвердит Prime. */
export const PhoneOnly = ({ service }: { service?: PrimeService }) => {
  const { Icon, label, text } = service ? SERVICES[service] : { Icon: Crown, label: 'Sky Prime', text: 'Подписка открывает Sky Music, Sky Film, подкасты, книги и режим «Код» в Sky AI на всех ваших устройствах.' };
  const reloadSession = useAuthStore((st) => st.reloadSession);
  const refresh = useEntitlements((st) => st.refresh);
  const url = primeLinkUrl(NATIVE_APP ? API_ORIGIN : window.location.origin);
  const svg = useMemo(() => qrSvg(url, { size: 200, quietZone: 2 }), [url]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const e = await refresh();
      if (alive && e?.prime.active) await reloadSession();   // профиль узнает о Prime, экран раздела откроется сам
    };
    const id = window.setInterval(() => { if (!document.hidden) void tick(); }, 5000);
    const onVis = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh, reloadSession]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center" data-prime-phone-only>
      <div className="relative">
        <div className="grid h-20 w-20 place-items-center rounded-3xl" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Icon size={36} style={{ color: 'var(--t2)' }} />
        </div>
        <div className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}><Crown size={14} className="text-white" /></div>
      </div>
      <p className="text-xl font-black text-white">{service ? `${label} — только для Prime` : label}</p>
      <p className="max-w-md text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{text}</p>
      <p className="max-w-md text-base font-bold" style={{ color: 'var(--t1)' }}>Для оформления или управления подпиской откройте приложение Sky на телефоне.</p>
      <div className="rounded-2xl bg-white p-3" role="img" aria-label="QR-код: открыть Sky Prime на телефоне" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="max-w-sm text-xs" style={{ color: 'var(--t3)' }}>Наведите камеру телефона на QR-код. В коде только адрес Sky — ни входа, ни платёжных данных в нём нет. Когда подписка будет оформлена, этот экран откроется сам.</p>
    </div>
  );
};

export const PrimeGate = ({ service }: { service: PrimeService }) => {
  if (isLimitedSurface()) return <PhoneOnly service={service} />;
  return <PurchaseGate service={service} />;
};

const PurchaseGate = ({ service }: { service: PrimeService }) => {
  const PLANS = [
    { days:30,  label:'1 месяц', price:'399 ₽' },
    { days:365, label:'1 год',   price:'3 790 ₽', popular:true },
    { days:730, label:'2 года',  price:'6 990 ₽' },
  ];
  // Цены здесь только для показа: считает и списывает сервер по своей
  // таблице, поэтому подделать сумму в запросе нельзя.
  const PRICES: Record<number, number> = { 30:399, 365:3790, 730:6990 };
  const { currentUserId, purchasePrime } = useAuthStore();
  const { getBalance } = useMoney();
  const balance = getBalance(currentUserId ?? '');
  const [chosen, setChosen] = useState(365);
  const [err,    setErr]    = useState('');
  const [busy,   setBusy]   = useState(false);
  const [done,   setDone]   = useState(false);

  const price  = PRICES[chosen];

  const buy = async () => {
    setErr(''); setBusy(true);
    // Подписку выписывает сервер: он же списывает деньги и он же потом
    // решает, отдавать ли музыку. Прежняя кнопка выдавала Prime прямо в
    // браузере — экран открывался, а сервер отказывал.
    const res = await purchasePrime('standard', chosen);
    setBusy(false);
    if (!res.ok) { setErr(res.reason ?? 'Не получилось оформить подписку'); return; }
    setDone(true);
  };

  const { Icon, label, text } = SERVICES[service];

  if (done) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:20 }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 12px 40px rgba(245,158,11,0.4)' }}>
        <Crown size={36} className="text-white"/>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Sky Prime активен!</p>
        <p className="text-sm mt-2" style={{ color:'var(--t2)' }}>
          Добро пожаловать в {label}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-5 py-6 gap-5">
      {/* Icon */}
      <div className="relative">
        <div className="grid h-20 w-20 place-items-center rounded-3xl"
          style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }}>
          <Icon size={36} style={{ color:'var(--t2)' }}/>
        </div>
        <div className="absolute -top-2 -right-2 grid h-8 w-8 place-items-center rounded-full"
          style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
          <Crown size={14} className="text-white"/>
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <p className="text-xl font-black text-white">{label}  -  только для Prime</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color:'var(--t2)', maxWidth:300 }}>
          {text}
        </p>
      </div>

      {/* Plans */}
      <div className="w-full space-y-2.5 max-w-xs">
        {PLANS.map(plan => (
          <motion.button key={plan.days} type="button"
            whileTap={{ scale:0.97 }}
            onClick={() => setChosen(plan.days)}
            className="relative flex items-center justify-between w-full rounded-2xl px-4 py-3.5 transition-all"
            style={{
              background: chosen===plan.days
                ? plan.popular ? 'rgba(245,158,11,0.15)' : 'rgba(79,110,247,0.12)'
                : 'rgba(255,255,255,0.04)',
              border: chosen===plan.days
                ? `1.5px solid ${plan.popular ? 'rgba(245,158,11,0.5)' : 'rgba(79,110,247,0.5)'}`
                : '1.5px solid rgba(255,255,255,0.07)',
            }}>
            {plan.popular && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background:'linear-gradient(135deg,#f59e0b,#fb923c)' }}>
                ВЫГОДНО
              </span>
            )}
            <div className="flex items-center gap-2.5">
              <div className="grid h-5 w-5 place-items-center rounded-full"
                style={{ border:`2px solid ${chosen===plan.days ? (plan.popular?'var(--amber)':'var(--accent)') : 'rgba(255,255,255,0.2)'}` }}>
                {chosen===plan.days && (
                  <div className="h-2.5 w-2.5 rounded-full"
                    style={{ background: plan.popular?'var(--amber)':'var(--accent)' }}/>
                )}
              </div>
              <span className="text-sm font-semibold text-white">{plan.label}</span>
            </div>
            <span className="text-sm font-bold"
              style={{ color: plan.popular ? 'var(--amber)' : 'var(--t1)' }}>{plan.price}</span>
          </motion.button>
        ))}
      </div>

      {/* Balance */}
      <div className="w-full max-w-xs rounded-2xl px-4 py-2.5 flex items-center justify-between"
        style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <span className="text-xs" style={{ color:'var(--t3)' }}>Баланс SkyMoney</span>
        <span className="text-sm font-bold" style={{ color: balance >= price ? 'var(--green)' : 'var(--red)' }}>
          {balance.toLocaleString('ru')} ₽
        </span>
      </div>

      {err && (
        <motion.p initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }}
          className="text-xs text-center leading-relaxed" style={{ color:'var(--red)', maxWidth:280 }}>
          {err}
        </motion.p>
      )}

      {/* CTA */}
      <motion.button whileTap={{ scale:0.97 }} type="button" onClick={() => void buy()} disabled={busy}
        className="w-full max-w-xs rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
        {busy ? 'Оформляем…' : (
          <span className="inline-flex items-center justify-center gap-2">
            <Crown size={15}/> Оформить Prime за {PRICES[chosen].toLocaleString('ru')} ₽
          </span>
        )}
      </motion.button>

      <p className="text-xs text-center" style={{ color:'var(--t3)' }}>
        Списывается с баланса SkyMoney · Нет рекламы · Отменить в любой момент
      </p>
    </div>
  );
};
