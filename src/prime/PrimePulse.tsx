/* ===============================================================
   PRIME PULSE  -  реальные предложения и погашения для Prime
=============================================================== */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Gift, Star, Copy, Check, Clock, ChevronRight,
  Palette, Music2, Gamepad2, Film, Package, BookOpen, Trophy, Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import {
  apiPulseOffers, apiPulseRedeem, type PulseOffer, type PulseCategory,
} from './primePulseApi';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', amber:'var(--amber)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
};

const CAT_LABELS: Record<PulseCategory, string> = { game:'Игры', service:'Сервисы', promo:'Sky', fun:'Партнёры' };
const CAT_ICON: Record<PulseCategory, typeof Star> = { game:Gamepad2, service:Music2, promo:Star, fun:Gift };

/** Значок по бренду — приятнее, чем один и тот же на все карточки. */
const BRAND_ICON: Record<string, typeof Star> = {
  'Sky Music': Music2, 'Sky Video': Film, 'Sky Market': Package,
  'Sky Books': BookOpen, 'Sky Gaming': Gamepad2, 'Sky Prime': Trophy,
  'Sky Ads': Palette, 'Sky': Zap,
};

const fmtExpires = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'истекает';
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return 'меньше суток';
  if (days < 30) return `${days} дн.`;
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};

const OfferCard = ({ offer, onRedeemed }: { offer: PulseOffer; onRedeemed: (offerId: string, code: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = BRAND_ICON[offer.brand] ?? CAT_ICON[offer.category];
  const used = (offer.myRedemptions ?? 0) >= offer.maxPerUser;
  const expiresLabel = fmtExpires(offer.expiresAt);

  const redeem = async () => {
    setBusy(true); setError(null);
    const res = await apiPulseRedeem(offer.id);
    setBusy(false);
    if (!res.ok) { setError(res.reason); return; }
    setCode(res.code);
    onRedeemed(offer.id, res.code);
  };

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  return (
    <motion.div whileTap={{ scale:.98 }}
      className="rounded-2xl overflow-hidden cursor-pointer"
      onClick={() => setOpen(o => !o)}
      style={{ background:`linear-gradient(135deg,${offer.color[0]}22,${C.l1})`,
        border:`1px solid ${offer.color[0]}40` }}>
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
            style={{ background:`linear-gradient(135deg,${offer.color[0]},${offer.color[1]})` }}>
            <Icon size={20} style={{ color:'#fff' }}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <p className="text-sm font-bold leading-snug" style={{ color:C.t1 }}>{offer.title}</p>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full shrink-0"
                style={{ background:`${offer.color[0]}30`, color:offer.color[0] }}>
                {offer.valueLabel}
              </span>
            </div>
            <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>{offer.brand}</p>
          </div>
        </div>

        {open && (
          <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}>
            <p className="text-xs leading-relaxed mb-3" style={{ color:C.t2 }}>{offer.description}</p>

            {code && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-2"
                style={{ background:'rgba(0,0,0,0.3)', border:`1px solid ${C.border}` }}>
                <span className="font-mono text-sm font-bold flex-1" style={{ color:C.t1 }}>{code}</span>
                <motion.button whileTap={{ scale:.9 }} type="button" onClick={e => { e.stopPropagation(); copy(); }}
                  className="grid h-7 w-7 place-items-center rounded-lg transition-all"
                  style={{ background:copied?'rgba(34,197,94,0.2)':'var(--border)' }}>
                  {copied ? <Check size={13} style={{ color:'#22c55e' }}/> : <Copy size={13} style={{ color:C.t2 }}/>}
                </motion.button>
              </div>
            )}
            {error && <p className="text-[11px] mb-2" style={{ color:'var(--red)' }}>{error}</p>}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10px]" style={{ color:C.t3 }}>
                <Clock size={10}/> {expiresLabel ? `Действует: ${expiresLabel}` : 'Бессрочно'}
              </div>
              {!code && !used && (
                <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); void redeem(); }}
                  className="flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50" style={{ color:offer.color[0] }}>
                  {busy ? <Loader2 size={11} className="animate-spin"/> : null}
                  Активировать →
                </button>
              )}
              {!code && used && (
                <span className="text-[11px] font-semibold" style={{ color:C.t3 }}>Уже получено</span>
              )}
            </div>
          </motion.div>
        )}

        {!open && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px]" style={{ color:C.t3 }}>
              <Clock size={9}/> {expiresLabel ?? 'Бессрочно'}
            </div>
            {used ? (
              <span className="text-[10px] font-semibold" style={{ color:C.t3 }}>Получено</span>
            ) : (
              <ChevronRight size={13} style={{ color:C.t3 }}/>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const PrimePulse = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const [filter, setFilter] = useState<'all' | PulseCategory>('all');
  const [offers, setOffers] = useState<PulseOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await apiPulseOffers();
    setLoading(false);
    if (list) setOffers(list);
  }, []);

  useEffect(() => { if (isPrime) void load(); }, [isPrime, load]);

  const onRedeemed = (offerId: string) => {
    setOffers(list => list.map(o => o.id === offerId ? { ...o, myRedemptions: (o.myRedemptions ?? 0) + 1 } : o));
  };

  const filtered = offers.filter(o => filter === 'all' || o.category === filter);

  if (!isPrime) return (
    <div className="flex flex-col items-center justify-center gap-5 h-full px-6"
      style={{ background:C.bg }}>
      <div className="grid h-20 w-20 place-items-center rounded-3xl"
        style={{ background:'linear-gradient(135deg,#f59e0b22,#d97706)' }}>
          <Zap size={18} style={{ color:'var(--amber)' }}/>
      </div>
      <div className="text-center">
        <p className="text-xl font-black" style={{ color:C.t1 }}>Prime Pulse</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color:C.t2 }}>
          Эксклюзивные предложения и коды доступны только участникам Sky Prime.
        </p>
      </div>
      <div className="rounded-2xl px-5 py-4 w-full max-w-xs"
        style={{ background:'linear-gradient(135deg,#f59e0b18,#d9770610)', border:'1px solid rgba(245,158,11,0.3)' }}>
        <p className="text-sm font-bold text-center" style={{ color:C.amber }}>
          Оформите Prime в SkyMoney → Кошелёк
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl"
            style={{ background:'linear-gradient(135deg,#f59e0b,#d97706)' }}><Zap size={18} style={{ color:'#fff' }}/></div>
          <div>
            <p className="text-lg font-black" style={{ color:C.t1 }}>Prime Pulse</p>
            <p className="text-xs" style={{ color:C.amber }}>{offers.length} предложений для вас</p>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {(['all','game','service','promo','fun'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className="rounded-full px-3 py-1.5 text-[11px] font-semibold shrink-0 transition-all"
              style={{ background:filter===f?C.amber:'var(--border)',
                color:filter===f?'#000':C.t3 }}>
              {f==='all' ? 'Все' : CAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" style={{ color:C.t3 }}/></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm py-10" style={{ color:C.t3 }}>
            {offers.length === 0 ? 'Пока нет предложений' : 'В этой категории пусто'}
          </p>
        ) : (
          <AnimatePresence>
            {filtered.map(o => <OfferCard key={o.id} offer={o} onRedeemed={onRedeemed}/>)}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
