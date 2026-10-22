/** «Путеводитель по Sky» / «Исследовать Sky»: страница-знакомство с экосистемой. Работает и внутри приложения (вкладка Sky), и отдельно по адресу /guide без входа. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Flower2, Orbit, Briefcase, Gamepad2, PlayCircle, Clapperboard, Wallet, X, ChevronDown, ArrowRight, Check, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useModuleClosures } from '@/core/moduleClosures';
import { SERVICES, INTERESTS, MONEY_STEPS, MONEY_CASES, MONEY_REFUND_NOTE, MONEY_REFUND_DETAIL, byKey, type GuideService, type GuideLink, type InterestKey, type ServiceKey } from './content';
import { goTo, openGuide } from './nav';

export const ICONS: Record<ServiceKey, LucideIcon> = { messenger: MessageCircle, bloom: Flower2, sky: Orbit, business: Briefcase, games: Gamepad2, video: PlayCircle, studio: Clapperboard, money: Wallet };

/** Доступность сервиса сейчас: закрыт администрацией / частично / доступен. */
export const useAvailability = () => {
  const closed = useModuleClosures((s) => s.closed);
  useEffect(() => { void useModuleClosures.getState().load(); }, []);
  return (s: { closedKey?: string; status: 'available' | 'partial'; statusNote?: string }) =>
    s.closedKey && closed[s.closedKey] ? { label: 'Временно недоступен', tone: 'warn' as const } :
    s.status === 'partial' ? { label: s.statusNote ?? 'Частично', tone: 'mid' as const } : { label: 'Доступно', tone: 'ok' as const };
};
const TONE = { ok: '#34d399', mid: '#fbbf24', warn: '#fb7185' };

export const StatusChip = ({ label, tone }: { label: string; tone: 'ok' | 'mid' | 'warn' }) => (
  <span className="gd-chip" style={{ color: TONE[tone] }}>{tone === 'ok' ? <Check size={12} /> : <Clock size={12} />}{label}</span>
);

/** Кнопка перехода: внутри приложения — в настоящий раздел, на отдельной странице — в точку входа Sky. */
export const useOpen = (standalone: boolean) => {
  const authed = useAuthStore((s) => s.isAuthenticated && !!s.currentUserId);
  return (l: GuideLink) => { if (standalone || !authed) window.location.assign('/'); else goTo(l.go); };
};

const EcoMap = ({ onPick }: { onPick: (k: ServiceKey) => void }) => {
  const nodes = useMemo(() => SERVICES.map((s, i) => { const a = (i / SERVICES.length) * Math.PI * 2 - Math.PI / 2; return { s, x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 }; }), []);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]" role="group" aria-label="Схема экосистемы Sky">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <g className="gd-orbit">{[38, 27].map((r, i) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(160,170,255,.22)" strokeWidth=".3" strokeDasharray={i ? '1 2' : '0'} />)}</g>
        {nodes.map(({ s, x, y }) => <line key={s.key} x1="50" y1="50" x2={x} y2={y} stroke={s.accent} strokeOpacity=".35" strokeWidth=".35" />)}
      </svg>
      <div className="gd-glass gd-pulse absolute left-1/2 top-1/2 grid h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full">
        <img src="/logo.png" alt="Sky" className="h-[58%] w-[58%] object-contain" draggable={false} />
      </div>
      {nodes.map(({ s, x, y }) => { const I = ICONS[s.key]; return (
        <button key={s.key} type="button" onClick={() => onPick(s.key)} aria-label={s.title} title={s.title}
          className="gd-glass gd-card absolute grid h-[15%] w-[15%] min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
          style={{ left: `${x}%`, top: `${y}%`, ['--gd-c' as string]: s.accent, color: s.accent }}><I size={20} /></button>); })}
    </div>
  );
};

const Detail = ({ s, standalone, onClose }: { s: GuideService; standalone: boolean; onClose: () => void }) => {
  const avail = useAvailability()(s); const open = useOpen(standalone); const I = ICONS[s.key];
  const [caseOpen, setCaseOpen] = useState<number | null>(null);
  const closed = avail.tone === 'warn';
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={s.title} onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(3,4,14,.7)', backdropFilter: 'blur(6px)' }} />
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()} className="gd-glass gd-fade relative max-h-[88vh] w-full max-w-[640px] overflow-y-auto rounded-b-none p-5 sm:rounded-b-[26px] sm:p-7" style={{ background: 'linear-gradient(160deg, rgba(30,34,80,.92), rgba(12,13,40,.95))', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full gd-btn-ghost gd-btn" style={{ padding: 0 }}><X size={18} /></button>
        <div className="mb-3 flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `${s.accent}26`, color: s.accent }}><I size={24} /></span>
          <div><div className="text-[13px] font-bold opacity-70">{s.title}</div><h3 className="text-[21px] font-extrabold leading-tight">{s.heading}</h3></div></div>
        <p className="mb-3 text-[15px] opacity-90">{s.tagline}</p>
        <div className="mb-4"><StatusChip {...avail} /></div>
        <p className="mb-3 text-[14px] opacity-80">{s.why}</p>
        <ul className="mb-4 space-y-2">{s.features.map((f) => <li key={f} className="flex gap-2 text-[14px]"><Check size={16} className="mt-0.5 shrink-0" style={{ color: s.accent }} /><span>{f}</span></li>)}</ul>
        {s.notYet && <div className="mb-4 rounded-2xl p-3 text-[13px]" style={{ background: 'rgba(251,191,36,.10)', border: '1px solid rgba(251,191,36,.25)' }}><b>Что важно знать.</b><ul className="mt-1 list-disc space-y-1 pl-4 opacity-90">{s.notYet.map((n) => <li key={n}>{n}</li>)}</ul></div>}
        {s.key === 'money' && (
          <div className="mb-4 space-y-3">
            <div className="rounded-2xl p-3 text-[13px]" style={{ background: 'rgba(34,211,238,.10)', border: '1px solid rgba(34,211,238,.28)' }}><b>{MONEY_REFUND_NOTE}</b><p className="mt-1 opacity-85">{MONEY_REFUND_DETAIL}</p></div>
            <ol className="space-y-2">{MONEY_STEPS.map((st, i) => <li key={st.t} className="flex gap-3 text-[13.5px]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: 'rgba(255,255,255,.12)' }}>{i + 1}</span><span><b>{st.t}.</b> {st.d}</span></li>)}</ol>
            <div className="text-[12.5px] opacity-70">Статусы заявки: «Ожидает подтверждения», «Проверяется», «Зачислено», «Отклонено», «Возврат оформляется», «Возвращено».</div>
            <div className="space-y-1.5">{MONEY_CASES.map((c, i) => (
              <div key={c.q} className="rounded-2xl" style={{ background: 'rgba(255,255,255,.05)' }}>
                <button type="button" onClick={() => setCaseOpen(caseOpen === i ? null : i)} aria-expanded={caseOpen === i} className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-left text-[13.5px] font-semibold"><span>{c.q}</span><ChevronDown size={16} style={{ transform: caseOpen === i ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /></button>
                {caseOpen === i && <p className="px-3 pb-3 text-[13px] opacity-85">{c.a}</p>}
              </div>))}</div>
          </div>)}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="gd-btn" disabled={closed} onClick={() => open(s.cta)}>{standalone ? 'Войти в Sky' : s.cta.label}<ArrowRight size={16} /></button>
          {!standalone && s.more?.map((m) => <button key={m.label} type="button" className="gd-btn gd-btn-ghost" onClick={() => open(m)}>{m.label}</button>)}
        </div>
        {standalone && <p className="mt-3 text-[12.5px] opacity-65">Чтобы открыть раздел, войди в Sky или зарегистрируйся — знакомство с путеводителем входа не требует.</p>}
      </div>
    </div>
  );
};

const Interests = ({ standalone, onPick }: { standalone: boolean; onPick: (k: ServiceKey) => void }) => {
  const [sel, setSel] = useState<InterestKey | null>(null);
  const it = INTERESTS.find((x) => x.key === sel);
  return (
    <section className="relative mx-auto w-full max-w-[1040px] px-4 py-10" aria-labelledby="gd-int">
      <h2 id="gd-int" className="mb-1 text-[24px] font-extrabold">Что ты хочешь делать в Sky?</h2>
      <p className="mb-4 text-[14px] opacity-70">Выбери — подскажем, с чего начать. Ничего не сохраняется{standalone ? '.' : ' и не обязательно.'}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Что ты хочешь делать в Sky?">
        {INTERESTS.map((x) => <button key={x.key} type="button" role="radio" aria-checked={sel === x.key} onClick={() => setSel(x.key)} className={sel === x.key ? 'gd-btn' : 'gd-btn gd-btn-ghost'} style={{ minHeight: 44 }}>{x.label}</button>)}
      </div>
      {it && <div className="gd-glass gd-fade mt-4 p-4"><p className="mb-3 text-[14px]">{it.why}</p>
        <div className="grid gap-2 sm:grid-cols-2">{it.services.map((k) => { const s = byKey(k); const I = ICONS[k]; return (
          <button key={k} type="button" onClick={() => onPick(k)} className="gd-glass gd-card flex items-center gap-3 p-3" style={{ ['--gd-c' as string]: s.accent, borderRadius: 18 }}>
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `${s.accent}26`, color: s.accent }}><I size={20} /></span>
            <span className="min-w-0"><span className="block text-[14px] font-bold">{s.title}</span><span className="block truncate text-[12.5px] opacity-70">{s.heading}</span></span></button>); })}</div></div>}
    </section>
  );
};

export const GuidePage = ({ standalone = false }: { standalone?: boolean }) => {
  const [pick, setPick] = useState<ServiceKey | null>(null);
  const grid = useRef<HTMLElement>(null);
  const avail = useAvailability();
  const authed = useAuthStore((s) => s.isAuthenticated && !!s.currentUserId);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { if (standalone) document.title = 'Путеводитель по Sky'; }, [standalone]);
  const chosen = pick ? byKey(pick) : null;
  return (
    <div data-keep-dark className={`gd-root ${standalone ? 'min-h-screen' : 'h-full overflow-y-auto'}`} style={{ paddingTop: standalone ? 'env(safe-area-inset-top)' : undefined }}>
      <div className="gd-stars" aria-hidden />
      <header className="relative mx-auto grid w-full max-w-[1040px] items-center gap-8 px-4 pb-8 pt-12 md:grid-cols-2 md:pt-16">
        <div className="gd-fade">
          <span className="gd-chip mb-4">Путеводитель по Sky</span>
          <h1 className="text-[clamp(30px,6vw,52px)] font-extrabold leading-[1.05]">Знакомься. Создавай. Открывай Sky.</h1>
          <p className="mt-4 max-w-[460px] text-[16px] opacity-80">Одна экосистема. Множество возможностей. Найди свой путь в Sky.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className="gd-btn" onClick={() => grid.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })}>Исследовать экосистему<ChevronDown size={16} /></button>
            {!standalone && authed && <button type="button" className="gd-btn gd-btn-ghost" onClick={openGuide}>Пройти знакомство</button>}
          </div>
        </div>
        <EcoMap onPick={setPick} />
      </header>

      <Interests standalone={standalone} onPick={setPick} />

      <section ref={grid} className="relative mx-auto w-full max-w-[1040px] scroll-mt-4 px-4 py-6" aria-labelledby="gd-svc">
        <h2 id="gd-svc" className="mb-4 text-[24px] font-extrabold">Сервисы Sky</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s, i) => { const I = ICONS[s.key]; const a = avail(s); return (
            <button key={s.key} type="button" onClick={() => setPick(s.key)} className="gd-glass gd-card gd-fade flex flex-col gap-2 p-5" style={{ ['--gd-c' as string]: s.accent, animationDelay: reduce ? '0s' : `${i * 60}ms` }}>
              <div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ background: `${s.accent}26`, color: s.accent }}><I size={22} /></span><StatusChip {...a} /></div>
              <div className="text-[17px] font-extrabold">{s.title}</div>
              <div className="text-[13.5px] opacity-75">{s.tagline}</div>
              <ul className="mt-1 space-y-1 text-[12.5px] opacity-80">{s.features.slice(0, 3).map((f) => <li key={f} className="flex gap-1.5"><Check size={13} className="mt-0.5 shrink-0" style={{ color: s.accent }} /><span>{f}</span></li>)}</ul>
              <span className="mt-auto inline-flex items-center gap-1 pt-2 text-[13px] font-bold" style={{ color: s.accent }}>Подробнее<ArrowRight size={14} /></span>
            </button>); })}
        </div>
      </section>

      <section className="relative mx-auto w-full max-w-[760px] px-4 pb-20 pt-12 text-center">
        <div className="gd-glass p-7">
          <h2 className="text-[26px] font-extrabold">Это только начало</h2>
          <p className="mx-auto mt-3 max-w-[560px] text-[14.5px] opacity-80">Sky развивается, чтобы объединять всё больше возможностей в одной экосистеме. Общайся, находи тиммейтов, создавай контент, развивай собственные проекты и открывай новые возможности вместе с Sky.</p>
          <button type="button" className="gd-btn mt-5" onClick={() => (standalone || !authed ? window.location.assign('/') : goTo({ module: 'messages' }))}>Начать пользоваться Sky<ArrowRight size={16} /></button>
        </div>
      </section>
      {chosen && <Detail s={chosen} standalone={standalone || !authed} onClose={() => setPick(null)} />}
    </div>
  );
};
