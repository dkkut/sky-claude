/* ===========================================================
   SKY CONSOLE — пространственная навигация по готовым интерфейсам.
   Не переписывает сервисы: смотрит на реально видимые
   интерактивные элементы страницы и переводит фокус по
   координатам. Закрытые модальным окном или соседним слоем
   элементы не участвуют — поэтому диалоги работают сами.
=========================================================== */

export type Dir = 'up' | 'down' | 'left' | 'right';

const SEL = [
  'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[role=button]', '[role=tab]', '[role=switch]', '[role=radio]', '[role=checkbox]', '[role=menuitem]',
  '[role=option]', '[role=slider]', '[tabindex]:not([tabindex="-1"])', '[data-console-focus]',
].join(',');

const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number', '']);

export const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return (el as HTMLElement).isContentEditable === true;
};

const vw = () => window.innerWidth;
const vh = () => window.innerHeight;

const onTop = (el: HTMLElement, r: DOMRect): boolean => {
  const pts: [number, number][] = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + Math.min(8, r.width / 3), r.top + Math.min(8, r.height / 3)],
    [r.right - Math.min(8, r.width / 3), r.bottom - Math.min(8, r.height / 3)],
  ];
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x > vw() || y > vh()) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (el === hit || el.contains(hit) || hit.contains(el))) return true;
  }
  return false;
};

export const isUsable = (el: HTMLElement): boolean => {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert],[data-console-ignore],[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 6 || r.height < 6) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > vh() || r.left > vw()) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || cs.display === 'none') return false;
  return onTop(el, r);
};

export const candidates = (root: ParentNode = document): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(SEL)).filter(isUsable);

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Лучший элемент в направлении; null — подходящего нет. */
export const pick = (from: DOMRect | null, dir: Dir, list: HTMLElement[], skip?: HTMLElement | null): HTMLElement | null => {
  const origin = from ?? new DOMRect(vw() / 2, vh() / 2, 1, 1);
  const c0 = center(origin);
  let best: HTMLElement | null = null; let bestCost = Infinity;
  for (const el of list) {
    if (el === skip) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    const dx = c.x - c0.x; const dy = c.y - c0.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (along < 4) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (across > along * 3.2 + 40) continue;
    const gap = dir === 'right' ? r.left - origin.right : dir === 'left' ? origin.left - r.right
      : dir === 'down' ? r.top - origin.bottom : origin.top - r.bottom;
    const overlap = dir === 'left' || dir === 'right'
      ? Math.min(origin.bottom, r.bottom) - Math.max(origin.top, r.top)
      : Math.min(origin.right, r.right) - Math.max(origin.left, r.left);
    const cost = Math.max(0, gap) + along * 0.25 + across * (overlap > 0 ? 0.6 : 2.4);
    if (cost < bestCost) { bestCost = cost; best = el; }
  }
  return best;
};

export const scrollParent = (el: Element | null): HTMLElement | null => {
  let n: Element | null = el;
  while (n && n !== document.body) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) return n as HTMLElement;
    n = n.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? null;
};

export const scrollableAt = (x: number, y: number): HTMLElement | null => scrollParent(document.elementFromPoint(x, y));

/** Читаемая метка кнопки закрытия/возврата в самом верхнем слое. */
const BACK_RE = /^(закрыть|назад|отмена|вернуться|close|back|cancel)$/i;
export const findBackButton = (): HTMLElement | null => {
  const all = candidates().filter((el) => {
    const label = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '').trim();
    return BACK_RE.test(label) || el.hasAttribute('data-console-back');
  });
  return all.length ? all[all.length - 1] : null;
};

export const hasOpenDialog = () => !!document.querySelector('[role=dialog],[aria-modal=true]');
