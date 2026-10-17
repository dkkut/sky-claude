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
  /** Вверх / вниз / «следующая» в плеере: главное действие (пропуск заставки, следующая серия) и субтитры. */
  onPrimaryAction?: () => void;
  onSubtitles?: () => void;
  onNext?: () => void;
}

/** Настоящий текстовый ввод в фокусе (TVSearch — единственное место в
    Sky TV, где реальный физический ввод печатает прямо в <input>).
    Стрелки влево/вправо, Backspace и пробел там должны редактировать
    текст как обычно, а не улетать в пультовую навигацию — иначе с
    подключённой клавиатурой нельзя было бы ни двигать курсор по
    введённому запросу, ни стереть букву, ни вставить пробел. */
const isTypingTarget = () => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
};

export const useTVKeyBindings = (handlers: TVKeyHandlers) => {
  useEffect(() => {
    if (handlers.enabled === false) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const player = handlers.mode === 'player';
      const typing = !player && isTypingTarget();
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onPrimaryAction?.(); }
          else { (document.activeElement as HTMLElement | null)?.blur(); tvFocusManager.move('up'); }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onSubtitles?.(); }
          else { (document.activeElement as HTMLElement | null)?.blur(); tvFocusManager.move('down'); }
          break;
        case 'ArrowLeft':
          if (typing) break; // курсор по тексту — как обычно
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onSeek?.(-10); } else tvFocusManager.move('left');
          break;
        case 'ArrowRight':
          if (typing) break;
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onSeek?.(10); } else tvFocusManager.move('right');
          break;
        case 'Enter':
        case ' ':
          if (typing) break; // отправку/пробел в поле уже обрабатывает сам input
          e.preventDefault();
          if (player) { handlers.onShowControls?.(); handlers.onPlayPause?.(); if (tvFocusManager.getFocusedId()) tvFocusManager.activate(); }
          else tvFocusManager.activate();
          break;
        case 'Escape':
          e.preventDefault(); handlers.onBack?.();
          break;
        case 'Backspace':
        case 'GoBack':
          if (e.key === 'Backspace' && typing) break; // стирает букву, а не «назад»
          e.preventDefault(); handlers.onBack?.();
          break;
        case 'MediaPlayPause':
          e.preventDefault(); handlers.onPlayPause?.();
          break;
        case 'MediaTrackNext':
          e.preventDefault(); handlers.onNext?.();
          break;
        case 'ClosedCaption':
        case 'ColorF1':
          e.preventDefault(); handlers.onSubtitles?.();
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
};
