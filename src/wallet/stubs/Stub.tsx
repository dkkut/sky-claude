/**
 * Общие части заглушек SkyCards и SkyCrypto (будущие сервисы SkyMoney): баннер недоступности и «мёртвая» зона.
 * Любое нажатие внутри <Dead> показывает «Недоступно, вкладка в разработке»; у элементов нет обработчиков действий,
 * поэтому никакой из них не может выполнить действие, открыть окно или отправить запрос. Живыми остаются только кнопка «Назад» и вся навигация Sky вокруг.
 * Здесь НЕТ ни запросов к серверу, ни данных: все цифры и карточки — условные, нарисованные кодом.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, FlaskConical } from 'lucide-react';

export const BETA_TEXT = 'Вкладка недоступна, она в бета разработке';

export const TAP_TEXT = 'Недоступно, вкладка в разработке';

/**
 * «Мёртвая» зона: любое нажатие внутри гасится и показывает короткую плашку «Недоступно, вкладка в разработке».
 * Обработчиков действий у внутренних элементов нет вообще, поэтому ни один из них ничего не выполняет и не отправляет.
 */
export const Dead = ({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => {
  const [toast, setToast] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const tap = (e: React.SyntheticEvent) => {
    e.preventDefault(); e.stopPropagation();
    setToast((n) => n + 1);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(0), 1900);
  };
  return (
    <div aria-disabled="true" className={className} style={{ userSelect: 'none', cursor: 'default', ...style }}
      onClickCapture={tap} onSubmitCapture={tap}>
      {children}
      {toast > 0 && (
        <div role="status" key={toast} className="stub-banner pointer-events-none fixed inset-x-0 bottom-24 z-[60] mx-auto w-fit max-w-[88vw] rounded-full px-5 py-3 text-sm font-bold"
          style={{ background: 'rgba(20,20,30,.92)', color: '#fff', border: '1px solid rgba(255,255,255,.2)', boxShadow: '0 12px 40px rgba(0,0,0,.5)', backdropFilter: 'blur(14px)' }}>{TAP_TEXT}</div>
      )}
    </div>
  );
};

/** Кнопка-«картинка»: выглядит как действие, но обработчика нет — нажатие ловит <Dead> и показывает плашку. */
export const Fake = ({ icon, label, tint }: { icon: ReactNode; label: string; tint: string }) => (
  <button type="button" className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-[11px] font-semibold text-white/85"
    style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)' }}>
    <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: `${tint}26`, border: `1px solid ${tint}55`, color: tint }}>{icon}</span>{label}
  </button>
);

/** Баннер: фирменный, с мягкой подсветкой и аккуратным появлением. `tint` — оттенок конкретной заглушки. */
export const BetaBanner = ({ tint }: { tint: string }) => (
  <div role="status" className="stub-banner mx-auto flex w-full max-w-3xl items-center gap-3 rounded-2xl px-4 py-3"
    style={{ background: `linear-gradient(135deg, ${tint}26, rgba(255,255,255,.05))`, border: `1px solid ${tint}55`, boxShadow: `0 0 28px ${tint}2e, inset 0 1px 0 rgba(255,255,255,.12)`, backdropFilter: 'blur(14px)' }}>
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${tint}30`, border: `1px solid ${tint}66` }}>
      <FlaskConical size={17} style={{ color: tint }} aria-hidden="true" />
    </span>
    <span className="text-sm font-bold leading-snug" style={{ color: '#fff' }}>{BETA_TEXT}</span>
  </div>
);

/** Верхняя панель: «Назад» (единственный живой элемент) и название. */
export const StubTop = ({ title, mark, onBack }: { title: string; mark: ReactNode; onBack: () => void }) => (
  <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
    <button type="button" onClick={onBack} aria-label="Назад" className="glass-btn round grid h-9 w-9 place-items-center"><ArrowLeft size={17} /></button>
    {mark}
    <span className="text-base font-extrabold tracking-tight text-white">{title}</span>
    <span className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.7)' }}>Бета</span>
  </div>
);
