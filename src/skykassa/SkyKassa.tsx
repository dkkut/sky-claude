/* ===============================================================
   SKYKASSA — платёжная страница Sky.
   Открывается внутри приложения при пополнении кошелька; баланс один —
   кошелёк Sky. Клиент ничего не решает: сумму, статус, реквизиты,
   проверку и зачисление определяет сервер.
=============================================================== */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Copy, Check, Clock, ShieldCheck, Wallet, Ticket, History, Landmark, Send, Info,
  AlertTriangle, Loader2, ExternalLink, LifeBuoy, RotateCcw, Sparkles, ChevronRight, X, Lock,
} from 'lucide-react';
import { NATIVE_APP, isElectron } from '@/core/nativeApp';
import { useConsoleMode } from '@/interface/console/consoleMode';
import { useDeviceMode } from '@/interface/tv/useDeviceMode';
import { useCarMode } from '@/interface/car/useCarMode';
import { useMoney } from '@/wallet/store';
import {
  kkConfig, kkOptions, kkCreate, kkGet, kkList, kkChoose, kkSender, kkSenderChange, kkReport, kkCancel, kkReply,
  kkRefund, kkSupport, kkError, newIdemKey,
  type Payment, type Options, type Config, type Destination, type IdKind, type HistoryItem, type SenderField,
} from './api';

/* ── Оформление: космос, фиолетовое небо, «жидкое стекло» ── */
const V = { violet: '#8b5cf6', violet2: '#a78bfa', sky: '#60a5fa', green: '#34d399', amber: '#fbbf24', red: '#f87171' };
const glass: CSSProperties = {
  background: 'linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))',
  border: '1px solid rgba(255,255,255,0.14)',
  backdropFilter: 'blur(22px) saturate(140%)', WebkitBackdropFilter: 'blur(22px) saturate(140%)',
  boxShadow: '0 10px 40px rgba(10,5,40,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
};
const fieldStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)', color: '#fff',
};
const primaryBtn: CSSProperties = {
  background: 'linear-gradient(135deg,#7c3aed,#6366f1 55%,#38bdf8)', color: '#fff',
  boxShadow: '0 8px 28px rgba(99,102,241,0.45), inset 0 1px 0 rgba(255,255,255,0.35)',
};

const rub = (n: number) => `${Number(n).toLocaleString('ru-RU')} ₽`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const APP_LABEL: Record<string, string> = {
  web: 'Sky Web', android: 'Sky Android', windows: 'Sky Windows', ios: 'Sky iOS', tv: 'Sky TV', console: 'Sky Console', car: 'Sky Car',
};

const STATUS_TONE: Record<string, string> = {
  completed: V.green, refunded_full: V.violet2, refunded_partial: V.violet2,
  rejected: V.red, cancelled_user: '#94a3b8', cancelled_system: '#94a3b8', expired: '#94a3b8', error: V.red,
  need_info: V.amber, awaiting_payment: V.sky, created: V.sky,
};
const ACTIVE = new Set(['user_reported', 'awaiting_review', 'in_review', 'need_info', 'awaiting_owner', 'confirmed', 'crediting', 'refund_requested', 'refund_processing']);

/* ── Определение «из какого приложения» ── */
const useSourceApp = (): string => {
  const consoleMode = useConsoleMode();
  const deviceMode = useDeviceMode();
  const car = useCarMode();
  return useMemo(() => {
    if (consoleMode) return 'console';
    if (deviceMode === 'tv') return 'tv';
    if (car) return 'car';
    if (isElectron()) return 'windows';
    if (NATIVE_APP) return /iP(hone|ad|od)/.test(navigator.userAgent) ? 'ios' : 'android';
    return 'web';
  }, [consoleMode, deviceMode, car]);
};

/* ── Мелкие кирпичи ── */
const Glass = ({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
  <div className={`rounded-3xl p-4 ${className}`} style={{ ...glass, ...style }}>{children}</div>
);
const Label = ({ children }: { children: ReactNode }) => (
  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(196,181,253,0.8)' }}>{children}</p>
);
const Err = ({ children }: { children?: ReactNode }) => (children ? (
  <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: V.red }}><AlertTriangle size={13} className="mt-0.5 shrink-0" />{children}</p>
) : null);
const Chip = ({ status, label }: { status: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
    style={{ background: `${STATUS_TONE[status] ?? V.violet2}22`, color: STATUS_TONE[status] ?? V.violet2, border: `1px solid ${STATUS_TONE[status] ?? V.violet2}55` }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_TONE[status] ?? V.violet2 }} />{label}
  </span>
);
const Row = ({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{k}</span>
    <span className={`text-right font-semibold ${mono ? 'font-mono' : ''}`} style={{ color: '#fff', wordBreak: 'break-word' }}>{v}</span>
  </div>
);
const Spinner = () => <Loader2 size={18} className="animate-spin" />;

const CopyRow = ({ k, v, big = false }: { k: string; v: string; big?: boolean }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(v); } catch {
      const ta = document.createElement('textarea'); ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* нет доступа к буферу */ } ta.remove();
    }
    setDone(true); window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="min-w-0">
        <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{k}</div>
        <div translate="no" className={`${big ? 'text-lg' : 'text-sm'} break-all font-semibold text-white`}>{v}</div>
      </div>
      <button type="button" onClick={copy} aria-label={`Скопировать: ${k}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: done ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.1)', color: done ? V.green : '#fff' }}>
        {done ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
};

const useCountdown = (iso: string | null, active: boolean, onZero: () => void) => {
  const [left, setLeft] = useState(0);
  const cb = useRef(onZero); cb.current = onZero;
  useEffect(() => {
    if (!iso || !active) return undefined;
    let fired = false;
    const tick = () => {
      const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && !fired) { fired = true; cb.current(); }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [iso, active]);
  return left;
};
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ── Экран «Средства зачислены» ── */
const Credited = ({ p, onDone }: { p: Payment; onDone: () => void }) => (
  <div className="flex flex-col items-center gap-5 py-6 text-center">
    <div className="relative grid h-28 w-28 place-items-center">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full" style={{ border: `2px solid ${V.green}` }}
          initial={{ scale: 0.6, opacity: 0.7 }} animate={{ scale: 1.7, opacity: 0 }} transition={{ duration: 2.2, delay: i * 0.6, repeat: Infinity, ease: 'easeOut' }} />
      ))}
      <motion.div initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'linear-gradient(135deg,#10b981,#34d399)', boxShadow: '0 0 50px rgba(52,211,153,0.6)' }}>
        <Check size={40} color="#fff" strokeWidth={3} />
      </motion.div>
    </div>
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
      <h2 className="text-2xl font-black text-white">{p.destination === 'code' ? 'Код пополнения готов' : 'Средства успешно зачислены'}</h2>
      <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Зачисление из SkyKassa</p>
      <p className="mt-2 text-4xl font-black" style={{ color: V.green }}>+{rub(p.amount)}</p>
    </motion.div>
    <Glass className="w-full text-left">
      <Row k="Номер операции" v={<span translate="no">{p.number}</span>} mono />
      <Row k="Дата" v={dt(p.creditedAt)} />
      <Row k="Куда зачислено" v={p.destination === 'code' ? 'Код пополнения' : 'Баланс SkyMoney'} />
      {p.balanceAfter != null && <Row k="Баланс после зачисления" v={rub(p.balanceAfter)} />}
    </Glass>
    <button type="button" onClick={onDone} className="w-full rounded-2xl py-3.5 text-sm font-bold" style={primaryBtn}>Готово</button>
  </div>
);

/* ── Форма данных отправителя ── */
interface SenderState { fio: string; idKind: IdKind; idNumber: string; extra: Record<string, string>; confirmed: boolean }
const KIND_LABEL: Record<IdKind, string> = { card: 'Номер карты', phone: 'Телефон', account: 'Номер счёта', other: 'Другое' };
const KIND_HINT: Record<IdKind, string> = { card: '0000 0000 0000 0000', phone: '+7 900 000-00-00', account: '20 цифр или IBAN', other: 'Идентификатор отправителя' };

const SenderForm = ({ fields, kinds, value, onChange, errors }: {
  fields: SenderField[]; kinds: IdKind[]; value: SenderState; onChange: (v: SenderState) => void; errors: Record<string, string>;
}) => {
  const set = (patch: Partial<SenderState>) => onChange({ ...value, ...patch });
  const fmtCard = (s: string) => s.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
        Укажите данные отправителя, с которого вы будете переводить деньги. Это поможет администрации проверить поступление и сопоставить его с вашей заявкой
      </p>
      <div>
        <label className="mb-1 block text-xs" style={{ color: 'rgba(255,255,255,0.6)' }} htmlFor="kk-fio">ФИО отправителя</label>
        <input id="kk-fio" translate="no" autoComplete="name" value={value.fio} onChange={(e) => set({ fio: e.target.value })} maxLength={120}
          placeholder="Иванов Иван Иванович" className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
        <Err>{errors.fio}</Err>
      </div>
      <div>
        <span className="mb-1 block text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>Чем будете переводить</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => set({ idKind: k, idNumber: '' })}
              className="rounded-xl px-2 py-2 text-xs font-semibold"
              style={value.idKind === k ? { background: 'rgba(139,92,246,0.35)', border: '1px solid rgba(167,139,250,0.8)', color: '#fff' } : { ...fieldStyle, color: 'rgba(255,255,255,0.7)' }}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <Err>{errors.idKind}</Err>
      </div>
      <div>
        <label className="mb-1 block text-xs" style={{ color: 'rgba(255,255,255,0.6)' }} htmlFor="kk-num">{KIND_LABEL[value.idKind]} отправителя</label>
        <input id="kk-num" translate="no" inputMode={value.idKind === 'other' ? 'text' : 'tel'} autoComplete="off" value={value.idNumber}
          onChange={(e) => set({ idNumber: value.idKind === 'card' ? fmtCard(e.target.value) : e.target.value })} maxLength={64}
          placeholder={KIND_HINT[value.idKind]} className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
        <Err>{errors.idNumber}</Err>
      </div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-xs" style={{ color: 'rgba(255,255,255,0.6)' }} htmlFor={`kk-x-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
          {f.type === 'select' ? (
            <select id={`kk-x-${f.key}`} value={value.extra[f.key] ?? ''} onChange={(e) => set({ extra: { ...value.extra, [f.key]: e.target.value } })}
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle}>
              <option value="">Выберите</option>
              {(f.options ?? []).map((o) => <option key={o} value={o} style={{ color: '#000' }}>{o}</option>)}
            </select>
          ) : (
            <input id={`kk-x-${f.key}`} translate="no" inputMode={f.type === 'digits' ? 'numeric' : 'text'} maxLength={f.maxLen ?? 120}
              value={value.extra[f.key] ?? ''} onChange={(e) => set({ extra: { ...value.extra, [f.key]: e.target.value } })}
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
          )}
          <Err>{errors[f.key]}</Err>
        </div>
      ))}
      <label className="flex cursor-pointer items-start gap-2.5 text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
        <input type="checkbox" checked={value.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500" />
        <span>Подтверждаю, что данные отправителя верны</span>
      </label>
      <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <Lock size={12} className="mt-0.5 shrink-0" />
        Мы никогда не просим PIN-код, CVV/CVC, пароль от банка и коды из SMS. Введённые данные — не доказательство оплаты: перевод проверяет администрация.
      </p>
    </div>
  );
};

const emptySender = (kinds: IdKind[]): SenderState => ({ fio: '', idKind: kinds[0] ?? 'card', idNumber: '', extra: {}, confirmed: false });

/* ═════════════ ГЛАВНЫЙ КОМПОНЕНТ ═════════════ */
type View = 'start' | 'method' | 'pay' | 'detail' | 'history' | 'credited';

export const SkyKassa = ({ onClose, initialPaymentId }: { onClose: () => void; initialPaymentId?: string | null }) => {
  const app = useSourceApp();
  const refreshMoney = useMoney((s) => s.refresh);
  const [view, setView] = useState<View>(initialPaymentId ? 'detail' : 'start');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cfgErr, setCfgErr] = useState('');
  const [dest, setDest] = useState<Destination>('balance');
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState<Payment | null>(null);
  const [opts, setOpts] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sender, setSender] = useState<SenderState>(emptySender(['card', 'phone', 'account', 'other']));
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const idem = useRef(newIdemKey());
  const prevStatus = useRef<string | null>(null);

  /* Настройки платформы */
  useEffect(() => {
    let live = true;
    void kkConfig().then((r) => { if (!live) return; if (r.ok) setCfg(r.data); else setCfgErr(kkError(r.error)); });
    return () => { live = false; };
  }, []);

  /* Открыть платёж по ссылке (возврат от партнёра, уведомление, история) */
  const load = useCallback(async (id: string, refresh = false) => {
    const r = await kkGet(id, refresh);
    if (r.ok) { setPay(r.data.payment); return r.data.payment; }
    setError(kkError(r.error, r.field, r.message));
    return null;
  }, []);
  useEffect(() => { if (initialPaymentId) void load(initialPaymentId, true); }, [initialPaymentId, load]);

  /* Живое обновление статуса */
  useEffect(() => {
    if (!pay || !['detail', 'pay'].includes(view)) return undefined;
    const partnerWait = pay.kind === 'partner' && pay.status === 'awaiting_payment';
    if (!ACTIVE.has(pay.status) && !partnerWait) return undefined;
    const t = window.setInterval(() => { if (!document.hidden) void load(pay.id, partnerWait); }, partnerWait ? 6000 : 8000);
    return () => window.clearInterval(t);
  }, [pay?.id, pay?.status, pay?.kind, view, load]);

  /* Зачисление произошло, пока человек смотрел на экран → анимация */
  useEffect(() => {
    if (!pay) return;
    if (prevStatus.current && prevStatus.current !== 'completed' && pay.status === 'completed') {
      setView('credited'); void refreshMoney();
    }
    prevStatus.current = pay.status;
  }, [pay?.status, pay, refreshMoney]);

  const num = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const min = cfg?.minAmount ?? 100; const max = cfg?.maxAmount ?? 100000;
  const quick = [200, 500, 1000, 2000, 5000, 10000].filter((a) => a >= min && a <= max);
  const paused = Boolean(cfg?.paused) || cfg?.apps?.[app] === false;

  /* 1 → 2: сервер создаёт платёжную сессию */
  const start = async () => {
    setError(''); setBusy(true);
    const c = await kkCreate({ amount: num, destination: dest, app, idemKey: idem.current });
    if (!c.ok) { setBusy(false); setError(kkError(c.error, c.field, c.message)); return; }
    const o = await kkOptions(c.data.payment.amount, dest, app);
    setBusy(false);
    setPay(c.data.payment); setOpts(o.ok ? o.data : null);
    if (!o.ok) setError(kkError(o.error));
    setView('method');
  };

  const chooseDirect = async (methodId: string) => {
    if (!pay) return; setError(''); setBusy(true);
    const r = await kkChoose(pay.id, { mode: 'direct', methodId });
    setBusy(false);
    if (!r.ok) { setError(kkError(r.error, r.field, r.message)); return; }
    setPay(r.data.payment); setSender(emptySender(r.data.payment.senderConfig?.kinds ?? ['card', 'phone', 'account', 'other'])); setFieldErrors({}); setView('pay');
  };
  const choosePartner = async (partnerId: string) => {
    if (!pay) return; setError(''); setBusy(true);
    const r = await kkChoose(pay.id, { mode: 'partner', partnerId });
    setBusy(false);
    if (!r.ok) { setError(kkError(r.error, r.field, r.message)); return; }
    setPay(r.data.payment); setView('pay');
  };

  const mapFieldError = (e?: string, f?: string): boolean => {
    if (!f) return false;
    setFieldErrors({ [f]: kkError(e, f) }); return true;
  };

  /* «Перевод совершён»: сохранить данные отправителя → отправить на проверку */
  const submitTransfer = async () => {
    if (!pay) return; setError(''); setFieldErrors({}); setBusy(true);
    const s = await kkSender(pay.id, { ...sender, confirmed: sender.confirmed });
    if (!s.ok) { setBusy(false); if (!mapFieldError(s.error, s.field)) setError(kkError(s.error, s.field, s.message)); return; }
    if (!sender.confirmed) { setBusy(false); setError(kkError('sender_not_confirmed')); return; }
    const r = await kkReport(pay.id, pay.amount);
    setBusy(false);
    if (!r.ok) { setError(kkError(r.error, r.field, r.message)); return; }
    setPay(r.data.payment); setView('detail');
  };

  const cancelPay = async () => {
    if (!pay) return;
    if (!window.confirm('Отменить платёж?')) return;
    setBusy(true); const r = await kkCancel(pay.id); setBusy(false);
    if (!r.ok) { setError(kkError(r.error)); return; }
    setPay(r.data.payment); setView('detail');
  };

  const openHistory = async () => {
    setView('history'); setHistory(null);
    const r = await kkList();
    setHistory(r.ok ? r.data.items : []);
    if (!r.ok) setError(kkError(r.error));
  };

  const back = () => {
    setError('');
    if (view === 'method') { setView('start'); return; }
    if (view === 'pay') { setView('method'); if (pay && opts) return; setView('start'); return; }
    if (view === 'detail' || view === 'history' || view === 'credited') { if (view === 'credited') void refreshMoney(); onClose(); return; }
    onClose();
  };

  return (
    <div data-keep-dark className="relative flex h-full min-h-0 w-full flex-col overflow-hidden text-white"
      style={{ background: 'radial-gradient(120% 80% at 20% -10%, #3b1d8f 0%, #150a3a 45%, #07051a 100%)' }}>
      {/* звёзды и свечение */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full blur-3xl" style={{ background: 'rgba(124,58,237,0.35)' }} />
        <div className="absolute -right-20 bottom-16 h-80 w-80 rounded-full blur-3xl" style={{ background: 'rgba(56,189,248,0.2)' }} />
        {Array.from({ length: 28 }).map((_, i) => (
          <span key={i} className="absolute rounded-full bg-white" style={{
            left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, width: (i % 3) + 1, height: (i % 3) + 1, opacity: 0.25 + (i % 4) * 0.12,
          }} />
        ))}
      </div>

      {/* шапка */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 px-4 py-3">
        <button type="button" onClick={back} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-2xl" style={glass}>
          {view === 'start' || view === 'history' || view === 'detail' || view === 'credited' ? <X size={18} /> : <ArrowLeft size={18} />}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#38bdf8)' }}><Sparkles size={16} /></span>
          <div className="min-w-0">
            <div className="text-base font-black leading-tight" style={{ color: '#fff' }}>SkyKassa</div>
            <div className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Пополнение из приложения: <span>{APP_LABEL[app]}</span></div>
          </div>
        </div>
        {view !== 'history' && (
          <button type="button" onClick={openHistory} aria-label="История платежей" className="grid h-10 w-10 place-items-center rounded-2xl" style={glass}><History size={18} /></button>
        )}
      </header>

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-8" style={{ scrollbarWidth: 'none' }}>
        <div className="mx-auto w-full max-w-md space-y-3">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm" style={{ background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.45)', color: '#fecaca' }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="space-y-3">

              {/* ───── 1. Сумма и назначение ───── */}
              {view === 'start' && (
                <>
                  {cfgErr && <Err>{cfgErr}</Err>}
                  {cfg?.notice && <Glass className="flex items-start gap-2 text-sm"><Info size={16} className="mt-0.5 shrink-0" style={{ color: V.sky }} /><span>{cfg.notice}</span></Glass>}
                  {paused && (
                    <Glass className="flex items-start gap-2 text-sm" style={{ borderColor: 'rgba(251,191,36,0.5)' }}>
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: V.amber }} />
                      <span>{cfg?.message || 'Пополнение временно недоступно.'}</span>
                    </Glass>
                  )}
                  <div>
                    <Label>Куда зачислить</Label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {([['balance', 'На баланс', 'Сразу на SkyMoney', Wallet], ['code', 'Код пополнения', 'Получите код Sky Codes', Ticket]] as const).map(([id, t, s, Icon]) => (
                        <button key={id} type="button" onClick={() => setDest(id)} className="rounded-3xl p-3.5 text-left transition"
                          style={dest === id ? { ...glass, borderColor: 'rgba(167,139,250,0.9)', boxShadow: '0 0 0 2px rgba(139,92,246,0.45), 0 10px 40px rgba(10,5,40,0.45)' } : glass}>
                          <Icon size={20} style={{ color: dest === id ? V.violet2 : 'rgba(255,255,255,0.6)' }} />
                          <div className="mt-2 text-sm font-bold">{t}</div>
                          <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{s}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Сумма пополнения</Label>
                    <div className="relative">
                      <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                        placeholder={`от ${min.toLocaleString('ru-RU')}`} aria-label="Сумма пополнения в рублях"
                        className="w-full rounded-3xl px-5 py-4 pr-12 text-3xl font-black outline-none" style={fieldStyle} />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl font-black" style={{ color: V.violet2 }}>₽</span>
                    </div>
                    <p className="mt-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{`От ${rub(min)} до ${rub(max)} · валюта: российский рубль`}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {quick.map((a) => (
                        <button key={a} type="button" onClick={() => setAmount(String(a))} className="rounded-full px-3.5 py-1.5 text-xs font-semibold" style={num === a ? { background: 'rgba(139,92,246,0.4)', border: '1px solid rgba(167,139,250,0.8)' } : fieldStyle}>
                          {a.toLocaleString('ru-RU')} ₽
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" disabled={busy || paused || num < min || num > max} onClick={start}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold disabled:opacity-40" style={primaryBtn}>
                    {busy ? <Spinner /> : <>Продолжить <ChevronRight size={16} /></>}
                  </button>
                  <p className="flex items-center justify-center gap-1.5 text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    <ShieldCheck size={13} />Сумма и назначение проверяются на сервере Sky
                  </p>
                </>
              )}

              {/* ───── 2. Способ оплаты ───── */}
              {view === 'method' && pay && (
                <>
                  <Glass>
                    <Row k="Сумма" v={rub(pay.amount)} />
                    <Row k="Валюта" v="RUB · российский рубль" />
                    <Row k="Приложение" v={APP_LABEL[pay.app] ?? pay.app} />
                    <Row k="Назначение" v={pay.destination === 'code' ? 'Код пополнения' : 'Баланс SkyMoney'} />
                    <Row k="Заявка" v={<span translate="no">{pay.number}</span>} mono />
                  </Glass>
                  {opts?.settings.notice && <Glass className="text-sm">{opts.settings.notice}</Glass>}
                  <div>
                    <Label>Прямая оплата с подтверждением</Label>
                    <p className="mb-2 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>Вы переводите деньги по реквизитам, администрация проверяет поступление и зачисляет средства.</p>
                    <div className="space-y-2.5">
                      {(opts?.direct ?? []).map((m) => (
                        <button key={m.id} type="button" disabled={busy} onClick={() => chooseDirect(m.id)} className="flex w-full items-center gap-3 rounded-3xl p-3.5 text-left" style={glass}>
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgba(139,92,246,0.25)' }}><Landmark size={20} style={{ color: V.violet2 }} /></span>
                          <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{m.title}</span><span className="block text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{m.description}</span></span>
                          <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />
                        </button>
                      ))}
                      {opts && opts.direct.length === 0 && <Glass className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Способы прямой оплаты для этой суммы пока не настроены.</Glass>}
                    </div>
                  </div>
                  <div>
                    <Label>Оплата через платёжного партнёра</Label>
                    <div className="space-y-2.5">
                      {(opts?.partners ?? []).map((p) => (
                        <button key={p.id} type="button" disabled={busy || !p.available} onClick={() => choosePartner(p.id)}
                          className="flex w-full items-center gap-3 rounded-3xl p-3.5 text-left disabled:opacity-60" style={glass}>
                          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: 'rgba(56,189,248,0.2)' }}>
                            {p.logo ? <img src={p.logo} alt="" className="h-full w-full object-contain" /> : <Send size={20} style={{ color: V.sky }} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold" translate="no">{p.title}</span>
                            {p.available
                              ? <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.6)' }} translate="no">{p.methods.length ? `${p.methods.join(', ')} · ` : ''}<span translate="yes">{`комиссия ${rub(p.fee)} · к оплате ${rub(p.total)}`}</span></span>
                              : <span className="block text-xs" style={{ color: V.amber }}>{p.status === 'not_connected' ? 'Не подключён' : 'Временно недоступен'}</span>}
                          </span>
                          {p.available && <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                        </button>
                      ))}
                      {opts && opts.partners.length === 0 && <Glass className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Платёжные партнёры пока не подключены.</Glass>}
                    </div>
                  </div>
                  {busy && <div className="flex justify-center py-2"><Spinner /></div>}
                  <button type="button" onClick={cancelPay} className="w-full rounded-2xl py-3 text-sm font-semibold" style={{ ...fieldStyle, color: 'rgba(255,255,255,0.75)' }}>Отменить платёж</button>
                </>
              )}

              {/* ───── 3. Реквизиты / партнёр ───── */}
              {view === 'pay' && pay && pay.kind === 'direct' && pay.requisites && (
                <PayDirect pay={pay} sender={sender} setSender={setSender} fieldErrors={fieldErrors} busy={busy}
                  onSubmit={submitTransfer} onCancel={cancelPay} onExpire={() => void load(pay.id)} />
              )}
              {view === 'pay' && pay && pay.kind === 'partner' && (
                <PayPartner pay={pay} onCancelled={() => setView('detail')} onCheck={() => void load(pay.id, true)} />
              )}

              {/* ───── Карточка платежа ───── */}
              {view === 'detail' && pay && (
                <Detail pay={pay} reload={() => load(pay.id)} setError={setError} onNew={() => { idem.current = newIdemKey(); setPay(null); setAmount(''); setView('start'); }}
                  onCancel={cancelPay} />
              )}
              {view === 'detail' && !pay && !error && <div className="flex justify-center py-10"><Spinner /></div>}

              {view === 'credited' && pay && <Credited p={pay} onDone={() => { void refreshMoney(); onClose(); }} />}

              {/* ───── История ───── */}
              {view === 'history' && (
                <>
                  <Label>История пополнений</Label>
                  {history === null && <div className="flex justify-center py-10"><Spinner /></div>}
                  {history?.length === 0 && <Glass className="text-center text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Пополнений через SkyKassa пока не было.</Glass>}
                  {history?.map((h) => (
                    <button key={h.id} type="button" onClick={async () => { setView('detail'); setPay(null); await load(h.id); }}
                      className="flex w-full items-center gap-3 rounded-3xl p-3.5 text-left" style={glass}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-black">{rub(h.amount)}</span>
                          <Chip status={h.status} label={h.statusLabel} />
                        </div>
                        <div className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                          <span translate="no">{h.number}</span> · {dt(h.createdAt)} · {h.destination === 'code' ? 'код пополнения' : 'на баланс'}
                        </div>
                      </div>
                      <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />
                    </button>
                  ))}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

/* ── Экран реквизитов с данными отправителя ── */
const PayDirect = ({ pay, sender, setSender, fieldErrors, busy, onSubmit, onCancel, onExpire }: {
  pay: Payment; sender: SenderState; setSender: (s: SenderState) => void; fieldErrors: Record<string, string>; busy: boolean;
  onSubmit: () => void; onCancel: () => void; onExpire: () => void;
}) => {
  const r = pay.requisites!;
  const left = useCountdown(pay.expiresAt, pay.status === 'awaiting_payment', onExpire);
  const kinds = pay.senderConfig?.kinds ?? (['card', 'phone', 'account', 'other'] as IdKind[]);
  return (
    <>
      <Glass style={{ borderColor: 'rgba(167,139,250,0.5)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(196,181,253,0.8)' }}>{r.methodTitle}</div>
            <div className="text-3xl font-black">{rub(r.amount)}</div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-1 text-xs" style={{ color: left < 120 ? V.amber : 'rgba(255,255,255,0.6)' }}><Clock size={13} />осталось</div>
            <div className="font-mono text-2xl font-black" style={{ color: left < 120 ? V.amber : '#fff' }}>{mmss(left)}</div>
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{`Переведите ровно ${rub(r.amount)} (${r.currency}) — иначе заявку не удастся сопоставить.`}</p>
      </Glass>
      <div className="space-y-2">
        <Label>Реквизиты получателя</Label>
        <CopyRow k="Получатель" v={r.recipient} />
        {r.bank && <CopyRow k="Банк" v={r.bank} />}
        <CopyRow k={r.idKind === 'card' ? 'Номер карты' : r.idKind === 'phone' ? 'Номер телефона' : r.idKind === 'account' ? 'Расчётный счёт' : 'Реквизит'} v={r.identifier} big />
        <CopyRow k="Сумма перевода" v={String(r.amount)} />
        <CopyRow k="Назначение платежа / сообщение" v={r.purpose} />
        <CopyRow k="Номер заявки" v={pay.number} />
      </div>
      {r.instruction && (
        <Glass className="flex items-start gap-2 text-sm"><Info size={16} className="mt-0.5 shrink-0" style={{ color: V.sky }} /><span className="whitespace-pre-line">{r.instruction}</span></Glass>
      )}
      <Glass>
        <Label>Данные отправителя</Label>
        <SenderForm fields={pay.senderConfig?.fields ?? []} kinds={kinds} value={sender} onChange={setSender} errors={fieldErrors} />
      </Glass>
      <button type="button" disabled={busy || left === 0} onClick={onSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold disabled:opacity-40" style={primaryBtn}>
        {busy ? <Spinner /> : <><Send size={16} />Перевод совершён</>}
      </button>
      <button type="button" disabled={busy} onClick={onCancel} className="w-full rounded-2xl py-3 text-sm font-semibold" style={{ ...fieldStyle, color: 'rgba(255,255,255,0.75)' }}>Отменить платёж</button>
    </>
  );
};

/* ── Оплата через партнёра ── */
const PayPartner = ({ pay, onCheck, onCancelled }: { pay: Payment; onCheck: () => void; onCancelled: () => void }) => {
  void onCancelled;
  const left = useCountdown(pay.expiresAt, pay.status === 'awaiting_payment', onCheck);
  return (
    <>
      <Glass style={{ borderColor: 'rgba(96,165,250,0.5)' }}>
        <div className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(147,197,253,0.9)' }}>Платёжный партнёр</div>
        <div className="text-lg font-black" translate="no">{pay.partnerTitle}</div>
        <div className="mt-2">
          <Row k="Зачислится на баланс" v={rub(pay.amount)} />
          <Row k="Комиссия партнёра" v={rub(pay.fee)} />
          <Row k="Итого к оплате" v={<span className="text-lg">{rub(pay.total)}</span>} />
        </div>
        {left > 0 && <p className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{`Страница оплаты активна ещё ${mmss(left)}`}</p>}
      </Glass>
      {pay.partnerUrl && (
        <a href={pay.partnerUrl} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold" style={primaryBtn}>
          <ExternalLink size={16} />Перейти к оплате
        </a>
      )}
      <button type="button" onClick={onCheck} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold" style={{ ...fieldStyle, color: 'rgba(255,255,255,0.85)' }}>
        <RotateCcw size={15} />Проверить оплату
      </button>
      <p className="text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Статус проверяется на сервере у партнёра. Возврат на эту страницу сам по себе оплату не подтверждает.</p>
    </>
  );
};

/* ── Карточка платежа: статус, переписка, код, возврат ── */
const STATUS_HINT: Record<string, string> = {
  created: 'Платёж создан. Выберите способ оплаты.',
  awaiting_payment: 'Ожидаем оплату.',
  user_reported: 'Вы сообщили о переводе.',
  awaiting_review: 'Заявка отправлена. Ожидает проверки администрацией — обычно это недолго. Мы пришлём уведомление.',
  in_review: 'Администрация проверяет поступление.',
  awaiting_owner: 'Проверка пройдена. Ожидает окончательного подтверждения владельцем.',
  confirmed: 'Платёж подтверждён.',
  crediting: 'Зачисление обрабатывается.',
  completed: 'Платёж завершён.',
  need_info: 'Администрации нужны дополнительные сведения — ответьте ниже.',
  rejected: 'Заявка отклонена.',
  cancelled_user: 'Платёж отменён вами.',
  cancelled_system: 'Платёж отменён системой.',
  expired: 'Срок действия платежа истёк. Если вы не переводили деньги, ничего делать не нужно.',
  error: 'При обработке произошла ошибка. Администрация уже видит её — деньги не потеряны, обратитесь в поддержку, если статус не меняется.',
  refund_requested: 'Возврат запрошен и ждёт решения.',
  refund_processing: 'Возврат обрабатывается.',
  refunded_partial: 'Часть средств возвращена.',
  refunded_full: 'Средства возвращены полностью.',
};

const Detail = ({ pay, reload, setError, onNew, onCancel }: {
  pay: Payment; reload: () => Promise<unknown>; setError: (s: string) => void; onNew: () => void; onCancel: () => void;
}) => {
  const [reply, setReply] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [showRefund, setShowRefund] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [chg, setChg] = useState<SenderState>(emptySender(pay.senderConfig?.kinds ?? ['card', 'phone', 'account', 'other']));
  const [chgReason, setChgReason] = useState('');
  const [chgErrors, setChgErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string; field?: string; message?: string }>, after?: () => void) => {
    setBusy(true); setError('');
    const r = await fn(); setBusy(false);
    if (!r.ok) { setError(kkError(r.error, r.field, r.message)); return false; }
    after?.(); await reload(); return true;
  };
  const inReview = ['awaiting_review', 'in_review', 'need_info'].includes(pay.status);

  return (
    <>
      <Glass>
        <div className="flex items-center justify-between gap-3">
          <span className="text-3xl font-black">{rub(pay.amount)}</span>
          <Chip status={pay.status} label={pay.statusLabel} />
        </div>
        <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>{STATUS_HINT[pay.status] ?? ''}</p>
        {pay.rejectReason && <p className="mt-2 rounded-xl p-2.5 text-sm" translate="no" style={{ background: 'rgba(248,113,113,0.14)', color: '#fecaca' }}>{pay.rejectReason}</p>}
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <Row k="Заявка" v={<span translate="no">{pay.number}</span>} mono />
          <Row k="Создана" v={dt(pay.createdAt)} />
          <Row k="Приложение" v={APP_LABEL[pay.app] ?? pay.app} />
          <Row k="Способ" v={<span translate="no">{pay.methodTitle || pay.partnerTitle || '—'}</span>} />
          <Row k="Назначение" v={pay.destination === 'code' ? 'Код пополнения' : 'Баланс SkyMoney'} />
          {pay.fee > 0 && <Row k="Комиссия партнёра" v={rub(pay.fee)} />}
          {pay.sender && <Row k="Отправитель" v={<span translate="no">{pay.sender.fio}, {pay.sender.idMasked}</span>} />}
          {pay.creditedAt && <Row k="Зачислено" v={dt(pay.creditedAt)} />}
          {pay.balanceAfter != null && <Row k="Баланс после" v={rub(pay.balanceAfter)} />}
          {pay.refundedTotal > 0 && <Row k="Возвращено" v={rub(pay.refundedTotal)} />}
        </div>
      </Glass>

      {pay.code && (
        <Glass style={{ borderColor: 'rgba(52,211,153,0.5)' }}>
          <Label>Код пополнения</Label>
          {pay.code.value ? (
            <>
              <div translate="no" className="break-all text-center font-mono text-xl font-black tracking-wider" style={{ color: V.green }}>{pay.code.value}</div>
              <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold" style={fieldStyle}
                onClick={async () => { try { await navigator.clipboard.writeText(pay.code!.value!); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* нет доступа */ } }}>
                {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Скопировано' : 'Скопировать код'}
              </button>
              <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{'Активируйте код в «Кошелёк → Sky Codes». Он одноразовый.'}{pay.code.expiresAt ? ` Действует до ${dt(pay.code.expiresAt)}.` : ''}</p>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{pay.code.used ? 'Код уже активирован.' : 'Срок действия кода истёк.'}</p>
          )}
        </Glass>
      )}

      {pay.messages.length > 0 && (
        <Glass>
          <Label>Переписка по заявке</Label>
          <div className="space-y-2">
            {pay.messages.map((m) => (
              <div key={m.id} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.fromStaff ? '' : 'ml-auto'}`} translate="no"
                style={m.fromStaff ? { background: 'rgba(139,92,246,0.25)' } : { background: 'rgba(255,255,255,0.1)' }}>
                <div className="text-[10px] opacity-60">{m.fromStaff ? 'Администрация' : 'Вы'} · {dt(m.at)}</div>
                {m.body}
              </div>
            ))}
          </div>
        </Glass>
      )}

      {pay.status === 'need_info' && (
        <Glass>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} rows={3} translate="no" placeholder="Ваш ответ"
            className="w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
          <button type="button" disabled={busy || reply.trim().length < 2} className="mt-2 w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-40" style={primaryBtn}
            onClick={() => void act(() => kkReply(pay.id, reply), () => setReply(''))}>Отправить ответ</button>
        </Glass>
      )}

      {inReview && pay.sender && (
        <Glass>
          <button type="button" className="w-full text-left text-sm font-semibold" onClick={() => setShowChange((v) => !v)}>
            {showChange ? 'Скрыть' : 'Изменить данные отправителя'}
          </button>
          {showChange && (
            <div className="mt-3 space-y-3">
              <SenderForm fields={pay.senderConfig?.fields ?? []} kinds={pay.senderConfig?.kinds ?? ['card', 'phone', 'account', 'other']} value={chg} onChange={setChg} errors={chgErrors} />
              <input value={chgReason} onChange={(e) => setChgReason(e.target.value)} maxLength={300} placeholder="Причина изменения" translate="no"
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Изменение записывается отдельно: администрация видит прежние данные, новые, время и причину.</p>
              <button type="button" disabled={busy} className="w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-40" style={primaryBtn}
                onClick={async () => {
                  setChgErrors({}); setBusy(true);
                  const r = await kkSenderChange(pay.id, { ...chg, reason: chgReason }); setBusy(false);
                  if (!r.ok) { if (r.field) setChgErrors({ [r.field]: kkError(r.error, r.field) }); else setError(kkError(r.error, r.field, r.message)); return; }
                  setShowChange(false); setChgReason(''); await reload();
                }}>Сохранить изменение</button>
            </div>
          )}
        </Glass>
      )}

      {pay.refunds.length > 0 && (
        <Glass>
          <Label>Возвраты</Label>
          {pay.refunds.map((f) => (
            <div key={f.id} className="py-1 text-sm">
              <Row k={dt(f.at)} v={`${rub(f.amount)} · ${f.status === 'done' ? 'выполнен' : f.status === 'declined' ? 'отклонён' : f.status === 'processing' ? 'обрабатывается' : 'запрошен'}`} />
              {f.declineReason && <p className="text-xs" translate="no" style={{ color: '#fecaca' }}>{f.declineReason}</p>}
            </div>
          ))}
        </Glass>
      )}

      {['completed', 'refunded_partial'].includes(pay.status) && (
        <Glass>
          <button type="button" className="w-full text-left text-sm font-semibold" onClick={() => setShowRefund((v) => !v)}>{showRefund ? 'Скрыть' : 'Запросить возврат'}</button>
          {showRefund && (
            <div className="mt-3 space-y-2">
              <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} maxLength={300} translate="no" placeholder="Причина возврата"
                className="w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none" style={fieldStyle} />
              <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Возврат решает владелец. Сумма вернётся тем же способом после списания зачисленного со SkyMoney.</p>
              <button type="button" disabled={busy || refundReason.trim().length < 5} className="w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-40" style={primaryBtn}
                onClick={() => void act(() => kkRefund(pay.id, refundReason), () => { setShowRefund(false); setRefundReason(''); })}>Отправить запрос</button>
            </div>
          )}
        </Glass>
      )}

      <div className="flex flex-col gap-2">
        {pay.canCancel && <button type="button" disabled={busy} onClick={onCancel} className="w-full rounded-2xl py-3 text-sm font-semibold" style={{ ...fieldStyle, color: 'rgba(255,255,255,0.8)' }}>Отменить платёж</button>}
        <button type="button" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold" style={{ ...fieldStyle, color: 'rgba(255,255,255,0.8)' }}
          onClick={async () => {
            setBusy(true); const r = await kkSupport(pay.id); setBusy(false);
            if (!r.ok) { setError(kkError(r.error)); return; }
            setError(''); await reload();
            window.alert('Обращение в поддержку создано. Ответ придёт в раздел «Поддержка» профиля.');
          }}>
          <LifeBuoy size={15} />{pay.ticketId ? 'Обращение в поддержку создано' : 'Написать в поддержку по этому платежу'}
        </button>
        <button type="button" onClick={onNew} className="w-full rounded-2xl py-3 text-sm font-bold" style={primaryBtn}>Новое пополнение</button>
      </div>
    </>
  );
};
