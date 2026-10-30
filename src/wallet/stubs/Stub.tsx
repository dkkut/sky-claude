/**
 * Общие части заглушек SkyCards и SkyCrypto (будущие сервисы SkyMoney): баннер недоступности и «мёртвая» зона.
 * Всё внутри <Dead> не принимает ни касаний, ни фокуса, ни клавиатуры (атрибут inert + pointer-events:none), поэтому никакой элемент
 * заглушки не может выполнить действие, открыть окно или отправить запрос. Живыми остаются только кнопка «Назад» и вся навигация Sky вокруг.
 * Здесь НЕТ ни запросов к серверу, ни данных: все цифры и карточки — условные, нарисованные кодом.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, FlaskConical } from 'lucide-react';

export const BETA_TEXT = 'Вкладка недоступна, она в бета разработке';

export const Dead = ({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.setAttribute('inert', ''); }, []);
  return (
    <div ref={ref} aria-disabled="true" className={className} style={{ pointerEvents: 'none', userSelect: 'none', cursor: 'default', ...style }}
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {children}
    </div>
  );
};

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
