/** Знакомство с Sky после регистрации. Состояние хранит сервер (/api/onboarding): не повторяется на другом устройстве и при каждом входе. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { flash } from '@/shared/flash';
import { SERVICES, INTERESTS, byKey, type InterestKey } from './content';
import { ICONS, StatusChip, useAvailability } from './GuidePage';
import { apiOnboarding, apiOnboardingAct, type OnboardingState } from './guideApi';
import { OPEN_GUIDE_EVENT } from './nav';

type Phase = 'welcome' | 'steps' | 'interest' | 'done';
const TOTAL = SERVICES.length;

export const GuideOnboarding = () => {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.currentUserId);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [idx, setIdx] = useState(0);
  const [interest, setInterest] = useState<InterestKey | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [resume, setResume] = useState(false);
  const asked = useRef<string | null>(null);
  const avail = useAvailability();

  // Спросить сервер один раз на профиль за сеанс страницы. На ТВ, консоли и в машине не навязываем (пульт/геймпад): знакомство дождётся телефона.
  useEffect(() => {
    if (!authed || !userId) { setPhase(null); asked.current = null; return undefined; }
    if (asked.current === userId) return undefined;
    asked.current = userId;
    if (document.documentElement.dataset.skyMode) return undefined;
    let alive = true;
    void apiOnboarding().then((r) => {
      if (!alive || !r.ok || !r.data?.auto) return;
      const st: OnboardingState = r.data;
      setIdx(Math.min(st.step, TOTAL - 1)); setResume(st.status === 'started' && st.step > 0); setPhase('welcome');
    });
    return () => { alive = false; };
  }, [authed, userId]);

  // Ручной запуск (Профиль → «Познакомиться с Sky», кнопка на странице путеводителя).
  useEffect(() => {
    const on = () => { void apiOnboardingAct('restart').then((r) => { if (!r.ok) { flash('Не удалось запустить знакомство. Попробуйте ещё раз.'); return; } setIdx(0); setResume(false); setInterest(null); setPhase('welcome'); }); };
    window.addEventListener(OPEN_GUIDE_EVENT, on);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, on);
  }, []);

  const begin = useCallback(() => { void apiOnboardingAct('start'); setPhase('steps'); }, []);
  const go = useCallback((n: number) => { setIdx(n); void apiOnboardingAct('step', { step: n }); }, []);
  const next = () => (idx >= TOTAL - 1 ? (void apiOnboardingAct('step', { step: TOTAL }), setPhase('interest')) : go(idx + 1));
  const skip = (later = false) => { void apiOnboardingAct('skip').then((r) => { if (!r.ok) flash('Не удалось сохранить выбор.'); }); setPhase(null); setConfirmSkip(false); if (later) flash('Познакомиться с Sky можно позже: Профиль → «Познакомиться с Sky»'); };
  const finish = () => { void apiOnboardingAct('complete', interest ? { interest } : {}); setPhase(null); };

  useEffect(() => {
    if (!phase) return undefined;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') (phase === 'steps' || phase === 'interest') ? setConfirmSkip(true) : undefined; };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [phase]);
  if (!phase) return null;

  const s = SERVICES[idx]; const I = ICONS[s.key]; const rec = INTERESTS.find((x) => x.key === interest);
  return (
    <div data-keep-dark className="gd-root fixed inset-0 z-[10040] flex flex-col overflow-y-auto" role="dialog" aria-modal="true" aria-label="Знакомство с Sky"
      style={{ position: 'fixed', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>   {/* .gd-root задаёт position:relative и без этого перебивал бы Tailwind-овский fixed: знакомство рисовалось под приложением */}
      <div className="gd-stars" aria-hidden />
      {(phase === 'steps' || phase === 'interest') && (
        <div className="relative z-10 flex items-center justify-between gap-3 px-4 pt-3">
          <div className="flex-1" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={Math.min(idx + 1, TOTAL)} aria-label="Прогресс знакомства">
            <div className="mb-1 text-[12px] font-bold opacity-75">{phase === 'steps' ? `${idx + 1} из ${TOTAL}` : 'Последний шаг'}</div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.12)' }}><div className="h-full rounded-full" style={{ width: `${((phase === 'steps' ? idx + 1 : TOTAL) / TOTAL) * 100}%`, background: 'linear-gradient(90deg,#5b7cff,#c084fc)', transition: 'width .35s' }} /></div>
          </div>
          <button type="button" onClick={() => setConfirmSkip(true)} className="gd-btn gd-btn-ghost" style={{ minHeight: 44, padding: '0 14px' }} aria-label="Пропустить знакомство"><span className="hidden sm:inline">Пропустить знакомство</span><X size={18} className="sm:hidden" /></button>
        </div>)}

      <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-5 py-8">
        {phase === 'welcome' && (
          <div className="gd-fade text-center">
            <img src="/logo.png" alt="Sky" className="gd-pulse mx-auto mb-6 h-24 w-24 object-contain" draggable={false} />
            <h1 className="text-[clamp(28px,7vw,40px)] font-extrabold leading-tight">Добро пожаловать в Sky!</h1>
            <p className="mt-3 text-[16px] opacity-90">Ты стал частью экосистемы, в которой общение, творчество, развлечения и новые возможности объединены в одном месте.</p>
            <p className="mt-2 text-[14.5px] opacity-70">Давай познакомимся с Sky и найдём то, что подходит именно тебе.</p>
            <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="gd-btn" onClick={begin}>{resume ? 'Продолжить знакомство' : 'Начать знакомство'}<ArrowRight size={16} /></button>
              <button type="button" className="gd-btn gd-btn-ghost" onClick={() => skip(true)}>Позже</button>
            </div>
          </div>)}

        {phase === 'steps' && (
          <div key={s.key} className="gd-fade">
            <div className="gd-glass p-6" style={{ ['--gd-c' as string]: s.accent }}>
              <div className="mb-4 flex items-center justify-between"><span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `${s.accent}26`, color: s.accent }}><I size={28} /></span><StatusChip {...avail(s)} /></div>
              <div className="text-[13px] font-bold opacity-70">{s.title}</div>
              <h2 className="text-[24px] font-extrabold leading-tight">{s.heading}</h2>
              <p className="mt-2 text-[15px] opacity-85">{s.tagline}</p>
              <ul className="mt-4 space-y-2">{s.features.slice(0, 3).map((f) => <li key={f} className="flex gap-2 text-[14px]"><Check size={16} className="mt-0.5 shrink-0" style={{ color: s.accent }} /><span>{f}</span></li>)}</ul>
              <p className="mt-4 rounded-2xl p-3 text-[13.5px]" style={{ background: 'rgba(255,255,255,.06)' }}><b>Зачем это тебе:</b> {s.why}</p>
              {s.status === 'partial' && s.notYet && <p className="mt-3 text-[12.5px] opacity-70">{s.notYet[0]}</p>}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" className="gd-btn gd-btn-ghost" onClick={() => idx > 0 && go(idx - 1)} disabled={idx === 0}><ArrowLeft size={16} />Назад</button>
              <button type="button" className="gd-btn" onClick={next}>Далее<ArrowRight size={16} /></button>
            </div>
          </div>)}

        {phase === 'interest' && (
          <div className="gd-fade">
            <h2 className="text-[26px] font-extrabold">Что ты хочешь делать в Sky?</h2>
            <p className="mt-1 text-[14px] opacity-70">Можно пропустить — ничего не требуется.</p>
            <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Что ты хочешь делать в Sky?">
              {INTERESTS.map((x) => <button key={x.key} type="button" role="radio" aria-checked={interest === x.key} onClick={() => setInterest(x.key)} className={interest === x.key ? 'gd-btn' : 'gd-btn gd-btn-ghost'} style={{ minHeight: 44 }}>{x.label}</button>)}
            </div>
            {rec && <div className="gd-glass gd-fade mt-4 p-4"><p className="mb-3 text-[14px]">{rec.why}</p><div className="flex flex-wrap gap-2">{rec.services.map((k) => { const sv = byKey(k); const Ic = ICONS[k]; return <span key={k} className="gd-chip" style={{ color: sv.accent }}><Ic size={13} />{sv.title}</span>; })}</div></div>}
            <div className="mt-6 flex justify-between gap-3">
              <button type="button" className="gd-btn gd-btn-ghost" onClick={() => { setIdx(TOTAL - 1); setPhase('steps'); }}><ArrowLeft size={16} />Назад</button>
              <button type="button" className="gd-btn" onClick={() => setPhase('done')}>Продолжить<ArrowRight size={16} /></button>
            </div>
          </div>)}

        {phase === 'done' && (
          <div className="gd-fade text-center">
            <img src="/logo.png" alt="Sky" className="gd-pulse mx-auto mb-6 h-20 w-20 object-contain" draggable={false} />
            <h2 className="text-[clamp(26px,6vw,36px)] font-extrabold leading-tight">Теперь ты знаешь, с чего начать!</h2>
            <p className="mt-3 text-[15.5px] opacity-85">Исследуй Sky в собственном темпе, находи единомышленников и открывай новые возможности экосистемы.</p>
            <button type="button" className="gd-btn mt-7" onClick={finish}>Перейти в Sky<ArrowRight size={16} /></button>
          </div>)}
      </div>

      {confirmSkip && (
        <div className="fixed inset-0 z-[10060] grid place-items-center px-5" role="alertdialog" aria-modal="true" aria-label="Пропустить знакомство">
          <div className="absolute inset-0" style={{ background: 'rgba(3,4,14,.7)', backdropFilter: 'blur(6px)' }} onClick={() => setConfirmSkip(false)} />
          <div className="gd-glass gd-fade relative w-full max-w-[380px] p-6 text-center" style={{ background: 'linear-gradient(160deg, rgba(30,34,80,.95), rgba(12,13,40,.97))' }}>
            <p className="text-[16px] font-bold">Ты можешь познакомиться с возможностями Sky позже.</p>
            <p className="mt-1 text-[13px] opacity-70">Профиль → «Познакомиться с Sky».</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="gd-btn" onClick={() => setConfirmSkip(false)}>Продолжить знакомство</button>
              <button type="button" className="gd-btn gd-btn-ghost" onClick={() => skip()}>Пропустить</button>
            </div>
          </div>
        </div>)}
    </div>
  );
};
