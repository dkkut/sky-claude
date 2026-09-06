/* ===========================================================
   SKY TV — Focus Manager
   Единая система пространственной навигации пультом: регистрирует
   все TVFocusable-элементы на экране и вычисляет, куда переходит
   фокус при ←/→/↑/↓, по их реальным координатам на экране.
=========================================================== */
import { useSyncExternalStore } from 'react';

interface Node {
  id: string;
  el: HTMLElement;
  disabled?: boolean;
  onEnter?: () => void;
  /** приоритет при авто-фокусе страницы: чем меньше, тем раньше */
  autoFocusPriority?: number;
}

type Direction = 'up' | 'down' | 'left' | 'right';

class FocusManagerImpl {
  private nodes = new Map<string, Node>();
  private focusedId: string | null = null;
  private listeners = new Set<() => void>();
  private enterListeners = new Map<string, () => void>();

  register(node: Node) {
    this.nodes.set(node.id, node);
    // если фокуса ещё нет вообще — сразу берём первый зарегистрированный
    if (this.focusedId === null) this.setFocused(node.id);
    this.emit();
    return () => this.unregister(node.id);
  }

  unregister(id: string) {
    this.nodes.delete(id);
    if (this.focusedId === id) {
      this.focusedId = null;
      // передаём фокус любому оставшемуся узлу, чтобы он никогда не «пропадал»
      const next = this.nodes.values().next().value as Node | undefined;
      if (next) this.focusedId = next.id;
    }
    this.emit();
  }

  getFocusedId() { return this.focusedId; }

  isFocused(id: string) { return this.focusedId === id; }

  subscribe(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  private emit() { this.listeners.forEach(l => l()); }

  setFocused(id: string) {
    const node = this.nodes.get(id);
    if (!node || node.disabled) return;
    this.focusedId = id;
    this.emit();
  }

  /** Фокус на «логичный первый» элемент страницы (наименьший autoFocusPriority,
      либо самый верхний-левый, если приоритет не задан). Вызывается при
      монтировании каждого TV-экрана. */
  focusDefault(preferId?: string) {
    if (preferId && this.nodes.has(preferId) && !this.nodes.get(preferId)!.disabled) {
      this.setFocused(preferId);
      return;
    }
    let best: Node | null = null;
    for (const n of this.nodes.values()) {
      if (n.disabled) continue;
      if (!best) { best = n; continue; }
      const bp = best.autoFocusPriority, np = n.autoFocusPriority;
      if (np != null && (bp == null || np < bp)) { best = n; continue; }
      if (np == null && bp == null) {
        const br = best.el.getBoundingClientRect(), nr = n.el.getBoundingClientRect();
        if (nr.top < br.top - 4 || (Math.abs(nr.top - br.top) <= 4 && nr.left < br.left)) best = n;
      }
    }
    if (best) this.setFocused(best.id);
  }

  activate() {
    if (!this.focusedId) return;
    const node = this.nodes.get(this.focusedId);
    node?.onEnter?.();
  }

  /** Геометрический поиск ближайшего кандидата в заданном направлении
      по реальным DOM-координатам на момент нажатия — устойчиво к
      скроллу каруселей, анимациям и динамическим спискам. */
  move(direction: Direction) {
    if (!this.focusedId) { this.focusDefault(); return; }
    const current = this.nodes.get(this.focusedId);
    if (!current) { this.focusDefault(); return; }
    const cRect = current.el.getBoundingClientRect();
    const cx = cRect.left + cRect.width / 2;
    const cy = cRect.top + cRect.height / 2;

    let best: { id: string; score: number } | null = null;
    for (const [id, node] of this.nodes) {
      if (id === this.focusedId || node.disabled) continue;
      const r = node.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // не смонтирован визуально
      const nx = r.left + r.width / 2;
      const ny = r.top + r.height / 2;
      const dx = nx - cx, dy = ny - cy;

      let primary: number, cross: number, ok: boolean;
      switch (direction) {
        case 'right': ok = dx > 4;  primary = dx; cross = dy; break;
        case 'left':  ok = dx < -4; primary = -dx; cross = dy; break;
        case 'down':  ok = dy > 4;  primary = dy; cross = dx; break;
        case 'up':    ok = dy < -4; primary = -dy; cross = dx; break;
      }
      if (!ok) continue;
      // штраф за смещение по перпендикулярной оси — предпочитаем то, что
      // визуально «прямо» в нужном направлении, а не по диагонали
      const score = primary + Math.abs(cross) * 2.2;
      if (!best || score < best.score) best = { id, score };
    }
    if (best) this.setFocused(best.id);
  }
}

export const tvFocusManager = new FocusManagerImpl();

/** true, если ИМЕННО этот id сейчас в фокусе — реактивно. */
export const useTVFocused = (id: string) =>
  useSyncExternalStore(
    cb => tvFocusManager.subscribe(cb),
    () => tvFocusManager.isFocused(id),
    () => false,
  );
