/* ===========================================================
   SKY TV — TVFocusable
   Базовая обёртка для ЛЮБОГО интерактивного элемента TV-интерфейса.
   Регистрируется в focusManager, отдаёт наружу флаг focused для
   визуального focus state, поддерживает disabled/onEnter/hover мышью.
=========================================================== */
import { useEffect, useId, useRef } from 'react';
import { tvFocusManager, useTVFocused } from './focusManager';

export interface TVFocusableRenderProps {
  focused: boolean;
}

interface TVFocusableProps {
  id?: string;
  disabled?: boolean;
  autoFocusPriority?: number;
  /** см. focusManager.ts::setScope — узел модалки (LegalNotice,
      подтверждение выхода), недоступный стрелкам, пока модалка не
      активный scope. Обычным TV-экранам это не нужно. */
  scope?: string;
  onEnter: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: (p: TVFocusableRenderProps) => React.ReactNode;
}

/** Внутри — обычный <div>: фокус здесь наш, программный (не нативный DOM
    focus), поэтому работает одинаково что с пультом, что с эмуляцией
    клавиатурой в браузере, без зависимости от tabIndex-порядка. */
export const TVFocusable = ({ id: idProp, disabled, autoFocusPriority, scope, onEnter, className, style, children }: TVFocusableProps) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const ref = useRef<HTMLDivElement>(null);
  const focused = useTVFocused(id);
  /* onEnter держим в ref: у большинства вызовов это новая стрелка на каждый рендер, и перерегистрация узла
     (с «передачей фокуса любому оставшемуся» при снятии) крала бы фокус на каждом обновлении экрана. */
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;

  useEffect(() => {
    if (!ref.current) return;
    const unregister = tvFocusManager.register({ id, el: ref.current, disabled, onEnter: () => enterRef.current(), autoFocusPriority, scope });
    return unregister;
  }, [id, disabled, autoFocusPriority, scope]);

  return (
    <div
      ref={ref}
      data-tv-focusable={id}
      onClick={() => { if (!disabled) { tvFocusManager.setFocused(id); onEnter(); } }}
      onMouseEnter={() => { if (!disabled) tvFocusManager.setFocused(id); }}
      className={className}
      style={{ ...style, cursor: disabled ? 'default' : 'pointer', outline: 'none' }}>
      {children({ focused })}
    </div>
  );
};
