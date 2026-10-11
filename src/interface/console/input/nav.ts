/* Единая «кнопка» управления: отсюда геймпад, клавиатура и экранная клавиатура
   двигают фокус, нажимают и возвращаются — в любом сервисе Sky. */
import { candidates, findBackButton, hasOpenDialog, isTextField, pick, scrollParent, type Dir } from './spatial';

type Listener = () => void;

class Nav {
  private current: HTMLElement | null = null;
  /** Элемент ввода, ради которого открыта экранная клавиатура. */
  private editTarget: HTMLElement | null = null;
  private kbListeners = new Set<Listener>();
  /** Подписчики «нужно вернуться на главную» (оболочка). */
  onHome: Listener = () => {};
  /** Если оболочка не нашла что закрыть — вернуться из сервиса. */
  onBackFallback: () => boolean = () => false;
  /** Запрос на переключение вкладок (LB/RB). */
  onShoulder: (d: -1 | 1) => void = () => {};
  /** Кнопка «воспроизведение/пауза» (X). */
  onMedia: Listener = () => {};

  private setFocus(el: HTMLElement | null) {
    if (this.current && this.current !== el) this.current.classList.remove('console-focused');
    this.current = el;
    if (!el) return;
    el.classList.add('console-focused');
    try { el.focus({ preventScroll: true }); } catch { /* неважно */ }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  focused(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a.isConnected) return a;
    return this.current && this.current.isConnected ? this.current : null;
  }

  /** Первый подходящий элемент: помеченный data-console-autofocus или самый верхний-левый. */
  focusAuto(root: ParentNode = document): boolean {
    const list = candidates(root);
    if (!list.length) return false;
    const preferred = list.find((e) => e.hasAttribute('data-console-autofocus'));
    if (preferred) { this.setFocus(preferred); return true; }
    const sorted = [...list].sort((a, b) => {
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      return Math.round(ra.top / 40) - Math.round(rb.top / 40) || ra.left - rb.left;
    });
    this.setFocus(sorted[0]);
    return true;
  }

  focusEl(el: HTMLElement | null) { this.setFocus(el); }

  /** Если текущий фокус пропал (данные обновились) — вернуть на ближайший. */
  ensureFocus() {
    const f = this.focused();
    if (f && candidates().includes(f)) return;
    this.focusAuto();
  }

  move(dir: Dir): boolean {
    const cur = this.focused();
    const el = cur?.closest<HTMLElement>('input[type=range]') ?? null;
    if (el && (dir === 'left' || dir === 'right')) {
      const r = el as HTMLInputElement;
      const step = Number(r.step) || 1;
      r.value = String(Number(r.value) + (dir === 'right' ? step : -step));
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const list = candidates();
    if (!cur || !list.includes(cur)) return this.focusAuto();
    const next = pick(cur.getBoundingClientRect(), dir, list, cur);
    if (next) { this.setFocus(next); return true; }
    if (dir === 'up' || dir === 'down') {
      const sp = scrollParent(cur);
      if (sp) {
        const before = sp.scrollTop;
        sp.scrollBy({ top: dir === 'down' ? vhStep() : -vhStep(), behavior: 'auto' });
        if (sp.scrollTop !== before) {
          requestAnimationFrame(() => {
            const again = pick(cur.getBoundingClientRect(), dir, candidates(), cur);
            if (again) this.setFocus(again);
          });
          return true;
        }
      }
    }
    return false;
  }

  scrollBy(dx: number, dy: number) {
    const cur = this.focused();
    const sp = scrollParent(cur ?? document.elementFromPoint(innerWidth / 2, innerHeight / 2));
    sp?.scrollBy({ left: dx, top: dy, behavior: 'auto' });
  }

  activate() {
    const el = this.focused();
    if (!el) { this.focusAuto(); return; }
    if (isTextField(el)) { this.openKeyboard(el); return; }
    if (el instanceof HTMLSelectElement) { try { el.showPicker?.(); } catch { /* нет */ } return; }
    el.click();
  }

  back() {
    if (this.editTarget) { this.closeKeyboard(); return; }
    const closer = findBackButton();
    if (closer) { closer.click(); return; }
    if (hasOpenDialog()) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return;
    }
    if (!this.onBackFallback()) this.onHome();
  }

  home() { this.closeKeyboard(); this.onHome(); }

  /* -- экранная клавиатура ------------------------------------------ */
  getEditTarget() { return this.editTarget; }
  openKeyboard(el: HTMLElement) { this.editTarget = el; this.kbListeners.forEach((l) => l()); }
  closeKeyboard() {
    if (!this.editTarget) return;
    const t = this.editTarget; this.editTarget = null;
    this.kbListeners.forEach((l) => l());
    requestAnimationFrame(() => { if (t.isConnected) this.setFocus(t); });
  }
  subscribeKeyboard(l: Listener) { this.kbListeners.add(l); return () => { this.kbListeners.delete(l); }; }
}

const vhStep = () => Math.round(innerHeight * 0.55);

export const consoleNav = new Nav();
