/* ===========================================================
   SKY TV — глобальный обработчик клавиш пульта/клавиатуры.
   Монтируется один раз в TVShell. В режиме 'player' стрелки влево/
   вправо перематывают видео вместо навигации по фокусу — так и
   должно быть внутри плеера согласно ТЗ.
=========================================================== */
import { useEffect } from 'react';
import { tvFocusManager } from './focusManager';

export interface TVKeyHandlers {
  mode?: 'nav' | 'player';
  enabled?: boolean;
  onBack?: () => void;
  onPlayPause?: () => void;
  onSeek?: (deltaSeconds: number) => void;
  onShowControls?: () => void;
}

export const useTVKeyBindings = (handlers: TVKeyHandlers) => {
  useEffect(() => {
    if (handlers.enabled === false) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const player = handlers.mode === 'player';
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (player) handlers.onShowControls?.(); else tvFocusManager.move('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (player) handlers.onShowControls?.(); else tvFocusManager.move('down');
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onSeek?.(-10); } else tvFocusManager.move('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onSeek?.(10); } else tvFocusManager.move('right');
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onPlayPause?.(); if (tvFocusManager.getFocusedId()) tvFocusManager.activate(); }
          else tvFocusManager.activate();
          break;
        case 'Escape':
        case 'Backspace':
        case 'GoBack':
          e.preventDefault(); handlers.onBack?.();
          break;
        case 'MediaPlayPause':
          e.preventDefault(); handlers.onPlayPause?.();
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
};
