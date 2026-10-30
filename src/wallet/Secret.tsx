/**
 * «Скрывать сумму на экране» (Настройки SkyMoney): прячет ВСЕ суммы кошелька — рубли, баллы, валютные счета, историю.
 * Нажатие на скрытую сумму показывает её на 10 секунд с отсчётом, потом снова прячет. Показ общий: открывается всё сразу,
 * чтобы не нажимать на каждую цифру. Только оформление на этом устройстве — данные с сервера приходят как раньше.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { readHideBalance } from './MoneySettings';

const REVEAL_MS = 10_000;
let until = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const emit = () => listeners.forEach((f) => f());
const startTimer = () => {
  if (timer) return;
  timer = setInterval(() => { if (Date.now() >= until) { until = 0; if (timer) { clearInterval(timer); timer = null; } } emit(); }, 250);
};
const reveal = () => { until = Date.now() + REVEAL_MS; startTimer(); emit(); };

/** Скрыта ли сумма сейчас и сколько секунд осталось до повторного скрытия (0 — не показана временно). */
export const useSecret = () => {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f); window.addEventListener('sky:money-hide', f);
    return () => { listeners.delete(f); window.removeEventListener('sky:money-hide', f); };
  }, []);
  const setting = readHideBalance();
  const left = until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
  return { hidden: setting && left === 0, left: setting ? left : 0, setting };
};

/** Сумма, которую можно скрыть. `mask` — чем заменить (по умолчанию точки). */
export const Secret = ({ children, mask = '••••' }: { children: ReactNode; mask?: string }) => {
  const { hidden, left } = useSecret();
  if (hidden) {
    return <button type="button" onClick={(e) => { e.stopPropagation(); reveal(); }} aria-label="Показать сумму на 10 секунд" title="Нажмите, чтобы показать на 10 секунд"
      className="cursor-pointer select-none rounded-md px-1 tracking-widest" style={{ background: 'rgba(127,127,127,.18)', color: 'inherit' }}>{mask}</button>;
  }
  return <>{children}{left > 0 && <span aria-live="off" className="ml-1.5 align-middle text-[10px] font-semibold tabular-nums opacity-60">{left} с</span>}</>;
};
