import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Crown, Gift, Loader2, Percent, Sparkles, Star, Ticket, Wallet, X } from 'lucide-react';
import {
  apiCodeCoupons, apiCodeHistory, apiRedeemCode, rewardText,
  type Coupon, type RedeemOk, type Redemption, type Reward,
} from './codesApi';

/* Экран «Sky Codes» в кошельке. Код проверяет и начисляет сервер; здесь —
   ввод, понятный результат и история. Ничего не считается на клиенте. */

const ERRORS: Record<string, string> = {
  invalid_code: 'Такого кода нет. Проверьте, нет ли опечатки.',
  too_many_attempts: 'Слишком много попыток. Подождите немного и попробуйте снова.',
  code_revoked: 'Этот код отозван и больше не действует.',
  code_expired: 'Срок действия кода истёк.',
  code_exhausted: 'Код уже использован — лимит активаций исчерпан.',
  already_redeemed: 'Вы уже активировали этот код.',
  item_already_owned: 'Этот предмет у вас уже есть — код остался нетронутым.',
  reward_unavailable: 'Награда сейчас недоступна. Код не потрачен — попробуйте позже.',
  reward_failed: 'Не удалось выдать награду. Код не потрачен — попробуйте позже.',
  activation_failed: 'Не получилось активировать код. Попробуйте ещё раз.',
  code_not_started: 'Этот код ещё не начал действовать. Попробуйте позже.',
  campaign_paused: 'Акция временно приостановлена. Код не потрачен.',
  campaign_ended: 'Акция закончилась.',
  campaign_user_limit: 'Вы уже использовали максимум кодов этой акции.',
  campaign_budget_exhausted: 'Награды этой акции закончились. Код не потрачен.',
  network: 'Нет связи с сервером. Код не потрачен.',
};

const ICON: Record<Reward['type'], typeof Wallet> = {
  balance: Wallet, points: Star, prime: Crown, item: Sparkles, discount: Percent,
};
const TINT: Record<Reward['type'], string> = {
  balance: 'var(--green)', points: 'var(--amber)', prime: 'var(--purple)',
  item: 'var(--accent)', discount: 'var(--accent)',
};
const KIND: Record<Reward['type'], string> = {
  balance: 'Пополнение баланса', points: 'Баллы', prime: 'Sky Prime',
  item: 'Цифровой предмет', discount: 'Промокод на скидку',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Показываем как SKY-XXXX-XXXX…, но принимаем любой ввод: нормализует сервер. */
const prettify = (v: string) => {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
  if (raw.startsWith('SKY') && raw.length > 3) {
    const body = raw.slice(3).match(/.{1,4}/g) ?? [];
    return ['SKY', ...body].join('-');
  }
  return raw;
};

const glass = {
  background: 'color-mix(in srgb, var(--bg-l2) 72%, transparent)',
  border: '1px solid var(--border)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
} as const;

const RewardBadge = ({ r, size = 40 }: { r: Reward; size?: number }) => {
  const Icon = ICON[r.type];
  const c = TINT[r.type];
  return (
    <div className="grid shrink-0 place-items-center rounded-2xl"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${c} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}>
      <Icon size={size * 0.46} style={{ color: c }} />
    </div>
  );
};

export const SkyCodes = ({ onClose, onRedeemed }: { onClose: () => void; onRedeemed?: () => void }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const [done, setDone] = useState<RedeemOk | null>(null);
  const [history, setHistory] = useState<Redemption[] | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const [h, c] = await Promise.all([apiCodeHistory(), apiCodeCoupons()]);
    if (h.ok) { setHistory(h.data.items); setLoadFailed(false); } else { setHistory([]); setLoadFailed(true); }
    if (c.ok) setCoupons(c.data.items);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async () => {
    if (inFlight.current || busy || wait > 0) return;
    const code = value.trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6) { setError('Введите код целиком.'); return; }
    inFlight.current = true; setBusy(true); setError(''); setDone(null);
    const r = await apiRedeemCode(code);
    inFlight.current = false; setBusy(false);
    if (r.ok) {
      setDone(r.data); setValue('');
      onRedeemed?.();
      void load();
      return;
    }
    const e = String(r.error ?? 'activation_failed');
    if (e === 'too_many_attempts') setWait(Math.min(Number(r.data?.retryAfter) || 60, 900));
    setError(ERRORS[e] ?? 'Не получилось активировать код. Попробуйте ещё раз.');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={onClose} aria-label="Закрыть"
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color: 'var(--t2)' }} />
        </button>
        <Ticket size={15} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Sky Codes</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Ввод */}
        <div className="relative overflow-hidden rounded-3xl p-5" style={glass}>
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full"
            style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--purple) 38%, transparent), transparent 70%)' }} />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full"
            style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 30%, transparent), transparent 70%)' }} />
          <div className="relative">
            <h2 className="text-lg font-bold" style={{ color: 'var(--t1)' }}>Есть код?</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--t3)' }}>
              Пополнение, Sky Prime, баллы, цифровые предметы или скидка — награда зависит от кода.
            </p>
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <input value={value} onChange={(e) => { setValue(prettify(e.target.value)); setError(''); }}
                autoComplete="off" autoCapitalize="characters" spellCheck={false} translate="no"
                placeholder="SKY-XXXX-XXXX-XXXX-XXXX" aria-label="Код"
                className="w-full rounded-2xl px-4 py-3.5 text-center font-mono text-base tracking-widest outline-none"
                style={{ background: 'color-mix(in srgb, var(--bg-l1) 70%, transparent)', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`, color: 'var(--t1)' }} />
              <button type="submit" disabled={busy || wait > 0 || value.length < 6}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--purple))' }}>
                {busy ? <><Loader2 size={16} className="animate-spin" /> Проверяем…</>
                  : wait > 0 ? `Повторите через ${wait} с`
                  : <><Gift size={16} /> Активировать</>}
              </button>
            </form>
            <AnimatePresence>
              {error && (
                <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mt-3 text-center text-xs font-medium" style={{ color: 'var(--red)' }}>
                  {error}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Успех */}
        <AnimatePresence>
          {done && (
            <motion.div initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-3xl p-5 text-center"
              style={{ ...glass, border: `1px solid color-mix(in srgb, ${TINT[done.reward.type]} 45%, transparent)` }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                className="mx-auto grid h-14 w-14 place-items-center rounded-full"
                style={{ background: 'color-mix(in srgb, var(--green) 18%, transparent)' }}>
                <Check size={26} style={{ color: 'var(--green)' }} />
              </motion.div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Код активирован</p>
              <p className="mt-1 text-xl font-bold" style={{ color: 'var(--t1)' }}>{rewardText(done.reward)}</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--t3)' }}>
                <span translate="no">{done.title}</span>
                {done.couponUntil ? ` · скидка действует до ${fmtDate(done.couponUntil)} — применится при покупке Prime` : ''}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Купоны */}
        {coupons.length > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-xs font-semibold" style={{ color: 'var(--t3)' }}>Ваши скидки</p>
            {coupons.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-2xl p-3" style={glass}>
                <RewardBadge r={{ type: 'discount', amount: 0, days: 0, item: null, percent: c.percent }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{`Скидка ${c.percent}% на Sky Prime`}</p>
                  <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{`до ${fmtDate(c.expiresAt)} · применится сама при покупке`}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* История */}
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold" style={{ color: 'var(--t3)' }}>История активаций</p>
          {history === null && (
            <div className="grid place-items-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>
          )}
          {history !== null && loadFailed && (
            <button type="button" onClick={() => void load()} className="w-full rounded-2xl p-4 text-xs" style={{ ...glass, color: 'var(--red)' }}>
              Не удалось загрузить историю. Нажмите, чтобы повторить.
            </button>
          )}
          {history !== null && !loadFailed && history.length === 0 && (
            <div className="rounded-2xl p-6 text-center text-xs" style={{ ...glass, color: 'var(--t3)' }}>
              Здесь появятся активированные коды.
            </div>
          )}
          {history?.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-2xl p-3" style={glass}>
              <RewardBadge r={h.reward} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{rewardText(h.reward)}</p>
                <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>
                  {KIND[h.reward.type]} · <span translate="no">{h.title}</span>
                </p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>
                  {fmtDate(h.redeemedAt)} · <span translate="no" className="font-mono">…{h.hint}</span>
                </p>
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: 'color-mix(in srgb, var(--green) 16%, transparent)', color: 'var(--green)' }}>
                Успешно
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
