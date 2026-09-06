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
  onEnter: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: (p: TVFocusableRenderProps) => React.ReactNode;
}

/** Внутри — обычный <div>: фокус здесь наш, программный (не нативный DOM
    focus), поэтому работает одинаково что с пультом, что с эмуляцией
    клавиатурой в браузере, без зависимости от tabIndex-порядка. */
export const TVFocusable = ({ id: idProp, disabled, autoFocusPriority, onEnter, className, style, children }: TVFocusableProps) => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const ref = useRef<HTMLDivElement>(null);
  const focused = useTVFocused(id);

  useEffect(() => {
    if (!ref.current) return;
    const unregister = tvFocusManager.register({ id, el: ref.current, disabled, onEnter, autoFocusPriority });
    return unregister;
  }, [id, disabled, onEnter, autoFocusPriority]);

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
