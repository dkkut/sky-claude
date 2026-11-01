/**
 * Экранная клавиатура на телефоне. Браузер по умолчанию либо накрывает страницу клавиатурой (iOS Safari,
 * Chrome с «resizes-visual»), либо прокручивает её, и весь интерфейс «уезжает» вверх вместе с панелью ввода.
 * Здесь мы следим за видимой областью (visualViewport) и, пока клавиатура открыта над полем ввода,
 * ужимаем корень приложения до этой области: шапка остаётся на месте, список сообщений сжимается,
 * а панель ввода садится прямо над клавиатурой. Нижняя панель вкладок на это время скрывается.
 * Переменные: --app-h (высота видимой области), --vv-top (сдвиг), --kb-h (высота клавиатуры); класс html.kb-open.
 */
const isEditable = (el: Element | null) => {
  if (!el) return false;
  const t = el as HTMLElement;
  if (t.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'color', 'image', 'reset'].includes(el.type) && !el.readOnly;
  return false;
};

export const startKeyboardInset = (): (() => void) => {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const root = document.documentElement;
  let raf = 0;

  const apply = () => {
    raf = 0;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const open = kb > 100 && isEditable(document.activeElement);
    root.classList.toggle('kb-open', open);
    root.style.setProperty('--kb-h', `${open ? kb : 0}px`);
    if (open) {
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
      // Страницу не должно прокручивать само: уезжать должно только то, что мы сжали.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    } else {
      root.style.removeProperty('--app-h');
      root.style.removeProperty('--vv-top');
    }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', () => setTimeout(schedule, 60));
  // Поворот экрана: сбросить устаревшие сдвиги, иначе верхняя панель оставалась за краем экрана.
  const onRotate = () => { root.style.removeProperty('--vv-top'); root.style.removeProperty('--app-h'); if (window.scrollY || window.scrollX) window.scrollTo(0, 0); setTimeout(schedule, 120); setTimeout(schedule, 500); };
  window.addEventListener('orientationchange', onRotate);
  window.addEventListener('resize', onRotate);
  schedule();
  return () => {
    window.removeEventListener('orientationchange', onRotate);
    window.removeEventListener('resize', onRotate);
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', schedule);
    if (raf) cancelAnimationFrame(raf);
    root.classList.remove('kb-open');
    root.style.removeProperty('--app-h'); root.style.removeProperty('--vv-top'); root.style.removeProperty('--kb-h');
  };
};
