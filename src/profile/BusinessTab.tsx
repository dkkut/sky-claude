import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  QrCode, TrendingUp, ShoppingBag, DollarSign, Users, BarChart2,
  Zap, Package, ArrowUpRight, ArrowDownRight, CheckCircle2,
  ChevronRight, X, Camera, RefreshCw, Shield, Clock, Eye,
  Star, Repeat2, CreditCard, PieChart, Tag, Plus, Minus,
  LayoutGrid, List, AlertCircle, Wifi, Hash, ExternalLink,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

/* ─── helpers ─────────────────────────────────────────────────────────── */
const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}М` :
  n >= 1_000     ? `${(n / 1_000).toFixed(1)}К` : String(n);

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n);

/* ─── seed data ───────────────────────────────────────────────────────── */
const SEED_PRODUCTS = [
  { id: 'p1', name: 'Sky Prime — 1 месяц',   price: 299,  sold: 312, stock: 999, category: 'subscription', status: 'active'   as const },
  { id: 'p2', name: 'Sky Prime — 3 месяца',  price: 749,  sold: 148, stock: 999, category: 'subscription', status: 'active'   as const },
  { id: 'p3', name: 'Пакет стикеров «Neon»', price: 129,  sold:  87, stock:  50, category: 'digital',      status: 'active'   as const },
  { id: 'p4', name: 'Игровой бустер ×2',     price:  99,  sold: 203, stock:  0,  category: 'gaming',       status: 'soldout'  as const },
  { id: 'p5', name: 'Sky Business Card',      price: 199,  sold:  41, stock: 200, category: 'digital',      status: 'draft'    as const },
];

const SEED_SUBS = [
  { id: 's1', plan: 'Базовый',    price: 149,  count: 1_204, color: '#4f6ef7' },
  { id: 's2', plan: 'Про',        price: 399,  count:   387, color: '#34d399' },
  { id: 's3', plan: 'Бизнес',     price: 999,  count:    52, color: '#f59e0b' },
];

const CHART_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const CHART_VALS = [41_200, 58_400, 47_800, 72_100, 89_300, 64_500, 95_600];
const MAX_V = Math.max(...CHART_VALS);

/* ─── QR scanner ──────────────────────────────────────────────────────── */
interface QRResult {
  id: string; type: 'ticket' | 'payment' | 'profile' | 'unknown';
  title: string; meta: string; valid: boolean; ts: string;
}

const FAKE_QR: QRResult[] = [
  { id: 'TKT-9A2F', type: 'ticket',  title: 'Билет: Sky Conference 2026', meta: 'VIP · Место A-12 · 15 мая 2026', valid: true,  ts: new Date().toISOString() },
  { id: 'PAY-3C1B', type: 'payment', title: 'Оплата: 1 490 ₽',            meta: 'Sky Market · Order #88231',      valid: true,  ts: new Date().toISOString() },
  { id: 'USR-7E4D', type: 'profile', title: 'Профиль: @artem_sky',         meta: 'Sky User · Prime',               valid: true,  ts: new Date().toISOString() },
  { id: 'TKT-XXXX', type: 'ticket',  title: 'Билет: неизвестное событие',  meta: 'Статус: недействителен',         valid: false, ts: new Date().toISOString() },
];

const QR_ICON: Record<QRResult['type'], string> = {
  ticket: '🎟️', payment: '💳', profile: '👤', unknown: '❓',
};

const QRScanner = ({ onClose }: { onClose: () => void }) => {
  const [phase, setPhase]   = useState<'idle' | 'scanning' | 'result'>('idle');
  const [result, setResult] = useState<QRResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory]   = useState<QRResult[]>(() => {
    try { return JSON.parse(localStorage.getItem('sky:qr-history') || '[]'); } catch { return []; }
  });
  const [tab, setTab] = useState<'scanner' | 'history'>('scanner');
  const timerRef = useRef<number | null>(null);

  const startScan = useCallback(() => {
    setPhase('scanning');
    setProgress(0);
    let p = 0;
    timerRef.current = window.setInterval(() => {
      p += 4;
      setProgress(p);
      if (p >= 100) {
        clearInterval(timerRef.current!);
        const r = FAKE_QR[Math.floor(Math.random() * FAKE_QR.length)];
        const entry = { ...r, ts: new Date().toISOString() };
        setResult(entry);
        setPhase('result');
        setHistory(h => {
          const next = [entry, ...h].slice(0, 20);
          localStorage.setItem('sky:qr-history', JSON.stringify(next));
          return next;
        });
      }
    }, 40);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="fixed inset-0 z-[600] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(12px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-l1)', border: '1px solid var(--border-m)', maxHeight: '90dvh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <div>
            <h3 className="text-base font-bold text-white">QR-сканер</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>Билеты, оплата, профили</p>
          </div>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/8"
            style={{ background: 'var(--bg-l3)' }}>
            <X size={15} style={{ color: 'var(--t2)' }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex mx-5 mb-4 rounded-2xl p-1 shrink-0" style={{ background: 'var(--bg-l3)' }}>
          {(['scanner', 'history'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className="flex-1 rounded-xl py-2 text-[12px] font-semibold transition-all"
              style={{
                background: tab === t ? 'var(--accent)' : 'rgba(0,0,0,0)',
                color: tab === t ? '#fff' : 'var(--t3)',
              }}>
              {t === 'scanner' ? '📷 Сканер' : `🕐 История (${history.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          {/* Scanner tab */}
          {tab === 'scanner' && (
            <div className="px-5 pb-6 flex flex-col items-center gap-4">

              {/* Viewfinder */}
              <div className="relative w-full max-w-[260px] aspect-square rounded-3xl overflow-hidden flex items-center justify-center"
                style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)' }}>

                {/* Corner marks */}
                {[['top-3 left-3', 'border-t-2 border-l-2 rounded-tl-xl'],
                  ['top-3 right-3', 'border-t-2 border-r-2 rounded-tr-xl'],
                  ['bottom-3 left-3', 'border-b-2 border-l-2 rounded-bl-xl'],
                  ['bottom-3 right-3', 'border-b-2 border-r-2 rounded-br-xl'],
                ].map(([pos, borders], i) => (
                  <div key={i} className={`absolute ${pos} w-6 h-6 ${borders}`}
                    style={{ borderColor: 'var(--accent)' }} />
                ))}

                {phase === 'idle' && (
                  <div className="flex flex-col items-center gap-3 text-center px-6">
                    <QrCode size={36} style={{ color: 'var(--t3)' }} />
                    <p className="text-xs" style={{ color: 'var(--t3)' }}>Наведи камеру на QR-код</p>
                  </div>
                )}

                {phase === 'scanning' && (
                  <>
                    {/* Laser sweep */}
                    <motion.div
                      className="absolute left-3 right-3 h-[2px] rounded-full"
                      style={{ background: 'linear-gradient(90deg,transparent,var(--accent),transparent)' }}
                      animate={{ top: ['10%', '90%', '10%'] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <div className="flex flex-col items-center gap-2">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                        <RefreshCw size={22} style={{ color: 'var(--accent)' }} />
                      </motion.div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Сканирование…</p>
                    </div>
                  </>
                )}

                {phase === 'result' && result && (
                  <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                    className="flex flex-col items-center gap-2 px-4 text-center">
                    <span className="text-4xl">{QR_ICON[result.type]}</span>
                    <motion.div
                      initial={{ scale: 0 }} animate={{ scale: 1 }}
                      transition={{ delay: 0.15, type: 'spring', stiffness: 500, damping: 30 }}>
                      {result.valid
                        ? <CheckCircle2 size={28} style={{ color: 'var(--green)' }} />
                        : <AlertCircle size={28} style={{ color: 'var(--red)' }} />}
                    </motion.div>
                  </motion.div>
                )}
              </div>

              {/* Progress bar */}
              {phase === 'scanning' && (
                <div className="w-full max-w-[260px] h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                  <motion.div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--accent)' }}
                    transition={{ ease: 'linear' }} />
                </div>
              )}

              {/* Result card */}
              <AnimatePresence>
                {phase === 'result' && result && (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="w-full rounded-2xl p-4"
                    style={{
                      background: result.valid ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
                      border: `1px solid ${result.valid ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                    }}>
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-2xl shrink-0 text-xl"
                        style={{ background: result.valid ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)' }}>
                        {QR_ICON[result.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{result.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--t2)' }}>{result.meta}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="flex items-center gap-1 text-[10px] font-semibold"
                            style={{ color: result.valid ? 'var(--green)' : 'var(--red)' }}>
                            {result.valid ? <><CheckCircle2 size={10} /> Действителен</> : <><AlertCircle size={10} /> Недействителен</>}
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--t3)' }}>#{result.id}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* CTA */}
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => { setPhase('idle'); setResult(null); if (phase === 'idle') startScan(); else if (phase === 'result') startScan(); }}
                className="w-full rounded-2xl py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2"
                style={{ background: phase === 'scanning' ? 'var(--bg-l3)' : 'var(--accent)' }}>
                {phase === 'scanning'
                  ? <><X size={15} /> Отмена</>
                  : phase === 'result'
                    ? <><RefreshCw size={15} /> Сканировать ещё</>
                    : <><Camera size={15} /> Начать сканирование</>}
              </motion.button>

              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--t3)' }}>
                <Shield size={11} /><span>QR привязан к уникальному ID · Проверка на сервере</span>
              </div>
            </div>
          )}

          {/* History tab */}
          {tab === 'history' && (
            <div className="px-5 pb-6 space-y-2">
              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Clock size={28} style={{ color: 'var(--t3)' }} />
                  <p className="text-sm" style={{ color: 'var(--t3)' }}>История пока пуста</p>
                </div>
              ) : history.map((r, i) => (
                <motion.div key={r.id + i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 rounded-2xl px-4 py-3"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <span className="text-xl shrink-0">{QR_ICON[r.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{r.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>
                      {new Date(r.ts).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })} · #{r.id}
                    </p>
                  </div>
                  <div className={`h-2 w-2 rounded-full shrink-0`}
                    style={{ background: r.valid ? 'var(--green)' : 'var(--red)' }} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* ─── KPI card ────────────────────────────────────────────────────────── */
const KpiCard = ({ icon: Icon, iconColor, label, value, delta, deltaLabel }: {
  icon: any; iconColor: string; label: string; value: string;
  delta?: number; deltaLabel?: string;
}) => (
  <div className="rounded-2xl p-4 flex flex-col gap-2"
    style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
    <div className="flex items-center justify-between">
      <div className="grid h-8 w-8 place-items-center rounded-xl"
        style={{ background: `${iconColor}18` }}>
        <Icon size={14} style={{ color: iconColor }} />
      </div>
      {delta !== undefined && (
        <span className="flex items-center gap-0.5 text-[11px] font-semibold"
          style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {Math.abs(delta)}%
        </span>
      )}
    </div>
    <div>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>{label}</p>
      {deltaLabel && <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{deltaLabel}</p>}
    </div>
  </div>
);

/* ─── Revenue chart ───────────────────────────────────────────────────── */
const RevenueChart = () => {
  const [hov, setHov] = useState<number | null>(null);
  const isMobile = useIsMobile();
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold text-white">Выручка</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>Последние 7 дней</p>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--green)' }}>
          <ArrowUpRight size={11} /> +18.4%
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-24">
        {CHART_VALS.map((v, i) => {
          const h = (v / MAX_V) * 100;
          const isHov = hov === i;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onMouseEnter={() => { if (!isMobile) setHov(i); }} onMouseLeave={() => { if (!isMobile) setHov(null); }}>
              {isHov && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="text-[9px] font-bold whitespace-nowrap rounded-lg px-1.5 py-0.5"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
                  {fmtMoney(v)}
                </motion.div>
              )}
              <motion.div
                className="w-full rounded-t-lg"
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
                style={{
                  background: isHov
                    ? 'var(--accent)'
                    : `linear-gradient(to top, rgba(79,110,247,0.7), rgba(79,110,247,0.3))`,
                  minHeight: 4,
                }}
              />
              <p className="text-[9px]" style={{ color: isHov ? 'var(--accent)' : 'var(--t3)' }}>{CHART_DAYS[i]}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Products table ──────────────────────────────────────────────────── */
const STATUS_MAP = {
  active:  { label: 'Активен',   color: 'var(--green)', bg: 'rgba(52,211,153,0.1)' },
  soldout: { label: 'Нет товара', color: 'var(--red)',   bg: 'rgba(248,113,113,0.1)' },
  draft:   { label: 'Черновик',  color: 'var(--t3)',    bg: 'rgba(255,255,255,0.06)' },
};

const MarketSection = () => {
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [items, setItems] = useState(SEED_PRODUCTS);

  const toggleStatus = (id: string) =>
    setItems(p => p.map(x => x.id === id
      ? { ...x, status: x.status === 'active' ? 'draft' : 'active' as any }
      : x));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-white">Мои товары</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>{items.length} позиций</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['list', 'grid'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)}
                className="grid h-7 w-7 place-items-center transition-colors"
                style={{ background: view === v ? 'var(--accent-bg)' : 'rgba(0,0,0,0)', color: view === v ? 'var(--accent)' : 'var(--t3)' }}>
                {v === 'list' ? <List size={12} /> : <LayoutGrid size={12} />}
              </button>
            ))}
          </div>
          <button type="button"
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            <Plus size={11} /> Добавить
          </button>
        </div>
      </div>

      <div className={view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
        {items.map((p, i) => {
          const st = STATUS_MAP[p.status];
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`rounded-2xl ${view === 'list' ? 'flex items-center gap-3 px-4 py-3' : 'p-3 flex flex-col gap-2'}`}
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <div className={`grid place-items-center rounded-xl shrink-0 ${view === 'list' ? 'h-10 w-10' : 'h-9 w-9'}`}
                style={{ background: 'var(--bg-l3)' }}>
                <Package size={view === 'list' ? 16 : 14} style={{ color: 'var(--t2)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--accent)' }}>{fmtMoney(p.price)}</span>
                  <span className="text-[10px]" style={{ color: 'var(--t3)' }}>Продано: {p.sold}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: st.bg, color: st.color }}>{st.label}</span>
                <button type="button" onClick={() => toggleStatus(p.id)}
                  className="grid h-6 w-6 place-items-center rounded-lg transition-colors hover:bg-white/8"
                  style={{ background: 'var(--bg-l3)' }}>
                  <Repeat2 size={10} style={{ color: 'var(--t3)' }} />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Monetization ────────────────────────────────────────────────────── */
const MonetizationSection = () => {
  const totalMRR = SEED_SUBS.reduce((s, x) => s + x.price * x.count, 0);
  const totalSubs = SEED_SUBS.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-white">Монетизация</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>Подписки и доход</p>
      </div>

      {/* MRR summary */}
      <div className="rounded-2xl p-4" style={{
        background: 'linear-gradient(135deg,rgba(79,110,247,0.12),rgba(52,211,153,0.06))',
        border: '1px solid rgba(79,110,247,0.2)',
      }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>MRR</p>
            <p className="text-2xl font-black text-white mt-0.5">{fmtMoney(totalMRR)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Подписчики</p>
            <p className="text-2xl font-black text-white mt-0.5">{fmt(totalSubs)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          {/* Plan ratio bar */}
          <div className="flex-1 h-1.5 rounded-full overflow-hidden flex">
            {SEED_SUBS.map(s => (
              <div key={s.id} style={{ width: `${(s.count / totalSubs) * 100}%`, background: s.color }} />
            ))}
          </div>
          <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--green)' }}>
            <ArrowUpRight size={10} />+6.2%
          </span>
        </div>
      </div>

      {/* Plans */}
      <div className="space-y-2">
        {SEED_SUBS.map((s, i) => (
          <motion.div key={s.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <div className="flex-1">
              <p className="text-[12px] font-semibold text-white">{s.plan}</p>
              <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtMoney(s.price)}/мес · {fmt(s.count)} подписчиков</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-bold text-white">{fmtMoney(s.price * s.count)}</p>
              <p className="text-[10px]" style={{ color: 'var(--t3)' }}>MRR</p>
            </div>
            <ChevronRight size={13} style={{ color: 'var(--t3)' }} />
          </motion.div>
        ))}
      </div>

      {/* CTA */}
      <button type="button"
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-colors"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
        <Plus size={14} /> Создать тариф
      </button>
    </div>
  );
};

/* ─── Analytics section ───────────────────────────────────────────────── */
const AnalyticsSection = () => {
  const funnelData = [
    { label: 'Показы',      value: 84_200, pct: 100 },
    { label: 'Клики',       value: 12_400, pct: 14.7 },
    { label: 'Корзина',     value:  3_800, pct:  4.5 },
    { label: 'Оплачено',    value:  1_643, pct:  1.95 },
  ];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-white">Аналитика</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>Воронка продаж · Вовлечённость</p>
      </div>

      <RevenueChart />

      {/* Funnel */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Воронка</p>
        {funnelData.map((f, i) => (
          <div key={f.label}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[12px] text-white">{f.label}</p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-white">{fmt(f.value)}</span>
                <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{f.pct}%</span>
              </div>
            </div>
            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
              <motion.div className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${f.pct}%` }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: 'easeOut' }}
                style={{
                  background: `linear-gradient(90deg, var(--accent), rgba(79,110,247,0.4))`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Top products */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <p className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Топ товаров</p>
        {SEED_PRODUCTS.filter(p => p.status === 'active').slice(0, 3).map((p, i) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
            <span className="text-[11px] font-black w-4 text-center shrink-0" style={{ color: 'var(--t3)' }}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white truncate">{p.name}</p>
              <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Продано: {p.sold}</p>
            </div>
            <p className="text-[12px] font-bold shrink-0" style={{ color: 'var(--accent)' }}>{fmtMoney(p.price * p.sold)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── Main BusinessTab export ─────────────────────────────────────────── */
type BizView = 'overview' | 'market' | 'monetization' | 'analytics';

export const BusinessTab = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const [view, setView] = useState<BizView>('overview');
  const [qrOpen, setQrOpen] = useState(false);

  const isPrimeBusiness = me?.isPrimeBusiness ?? false;

  const VIEWS: { key: BizView; label: string; icon: any }[] = [
    { key: 'overview',      label: 'Обзор',       icon: BarChart2  },
    { key: 'market',        label: 'Маркет',      icon: ShoppingBag },
    { key: 'monetization',  label: 'Монетизация', icon: DollarSign  },
    { key: 'analytics',     label: 'Аналитика',   icon: TrendingUp  },
  ];

  const kpiData = [
    { icon: DollarSign, iconColor: '#4f6ef7', label: 'Выручка за месяц',  value: fmtMoney(428_900), delta: 18,  deltaLabel: 'vs прошлый месяц' },
    { icon: Users,      iconColor: '#34d399', label: 'Всего подписчиков', value: fmt(1_643),        delta: 6,   deltaLabel: '+94 за неделю'    },
    { icon: ShoppingBag,iconColor: '#f59e0b', label: 'Продаж за месяц',   value: fmt(791),          delta: -3,  deltaLabel: '-24 vs пред. мес' },
    { icon: Eye,        iconColor: '#8b5cf6', label: 'Просмотры профиля', value: fmt(12_480),       delta: 31,  deltaLabel: 'за 30 дней'       },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* QR Modal */}
      <AnimatePresence>
        {qrOpen && <QRScanner onClose={() => setQrOpen(false)} />}
      </AnimatePresence>

      {/* Header */}
      <div className="shrink-0 px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Бизнес</h2>
              {isPrimeBusiness && (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(79,110,247,0.18)', color: 'var(--accent)' }}>
                  BUSINESS
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>Инструменты · Аналитика · QR</p>
          </div>

          {/* QR button */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            type="button"
            onClick={() => setQrOpen(true)}
            className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold text-white transition-all"
            style={{ background: 'var(--accent)', boxShadow: '0 4px 16px rgba(79,110,247,0.35)' }}>
            <QrCode size={15} />
            QR-сканер
          </motion.button>
        </div>

        {/* Sub-nav */}
        <div className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setView(key)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold whitespace-nowrap shrink-0 transition-all"
              style={{
                background: view === key ? 'var(--accent-bg)' : 'rgba(0,0,0,0)',
                color: view === key ? 'var(--accent)' : 'var(--t3)',
                border: view === key ? '1px solid rgba(79,110,247,0.2)' : '1px solid transparent',
              }}>
              <Icon size={11} strokeWidth={view === key ? 2.4 : 1.8} />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 h-px" style={{ background: 'var(--border)' }} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-8" style={{ scrollbarWidth: 'none' }}>
        <AnimatePresence mode="wait">
          <motion.div key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}>

            {/* Overview */}
            {view === 'overview' && (
              <div className="space-y-4">
                {/* Quick QR access */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setQrOpen(true)}
                  className="w-full rounded-2xl p-4 flex items-center gap-4 text-left transition-all"
                  style={{
                    background: 'linear-gradient(135deg,rgba(79,110,247,0.12),rgba(79,110,247,0.04))',
                    border: '1px solid rgba(79,110,247,0.22)',
                  }}>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl shrink-0"
                    style={{ background: 'rgba(79,110,247,0.15)' }}>
                    <QrCode size={22} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">Сканировать QR-код</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>
                      Билеты, оплата, бизнес-профили
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold"
                    style={{ background: 'var(--accent)', color: '#fff' }}>
                    <Camera size={11} /> Открыть
                  </div>
                </motion.button>

                {/* KPI grid */}
                <div className="grid grid-cols-2 gap-2">
                  {kpiData.map(k => <KpiCard key={k.label} {...k} />)}
                </div>

                <RevenueChart />

                {/* Quick links */}
                <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  {[
                    { icon: ShoppingBag, label: 'Управление товарами', sub: `${SEED_PRODUCTS.length} позиций`, view: 'market' as BizView },
                    { icon: CreditCard,  label: 'Настройка тарифов',   sub: `${SEED_SUBS.length} плана активны`, view: 'monetization' as BizView },
                    { icon: PieChart,    label: 'Подробная аналитика', sub: 'Воронка · Топ товаров · Отчёты', view: 'analytics' as BizView },
                  ].map((item, i) => (
                    <button key={item.label} type="button" onClick={() => setView(item.view)}
                      className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/4"
                      style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                      <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
                        style={{ background: 'var(--bg-l3)' }}>
                        <item.icon size={15} style={{ color: 'var(--accent)' }} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-[13px] font-semibold text-white">{item.label}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{item.sub}</p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--t3)' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {view === 'market'       && <MarketSection />}
            {view === 'monetization' && <MonetizationSection />}
            {view === 'analytics'    && <AnalyticsSection />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
