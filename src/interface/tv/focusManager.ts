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
  /** см. setScope() ниже — узел без scope участвует только пока
      активного scope нет вовсе (обычный экран, не модалка) */
  scope?: string;
}

type Direction = 'up' | 'down' | 'left' | 'right';

class FocusManagerImpl {
  private nodes = new Map<string, Node>();
  private focusedId: string | null = null;
  private listeners = new Set<() => void>();
  private enterListeners = new Map<string, () => void>();
  /** Активная модалка поверх экрана (LegalNotice, подтверждение выхода
      и т.п.): пока задана — стрелки/Enter видят только узлы с этим же
      scope, остальной экран под модалкой временно «не существует» для
      пульта. Без этого стрелка могла бы улететь под модалку — на
      обычной странице такого нет и не нужно, поэтому по умолчанию
      scope не задан и всё ведёт себя как раньше. */
  private activeScope: string | null = null;

  private eligible(node: Node) {
    if (node.disabled) return false;
    return this.activeScope == null ? true : node.scope === this.activeScope;
  }

  setScope(scope: string | null) {
    this.activeScope = scope;
    this.focusDefault();
    this.emit();
  }
  getScope() { return this.activeScope; }

  register(node: Node) {
    this.nodes.set(node.id, node);
    // если фокуса ещё нет вообще, либо он «утёк» на узел не из текущей
    // модалки (открылась новая поверх) — берём этот узел, если он
    // подходит под текущий scope
    if (this.focusedId === null && this.eligible(node)) this.setFocused(node.id);
    this.emit();
    return () => this.unregister(node.id);
  }

  unregister(id: string) {
    this.nodes.delete(id);
    if (this.focusedId === id) {
      this.focusedId = null;
      // передаём фокус любому оставшемуся подходящему под scope узлу,
      // чтобы он никогда не «пропадал»
      for (const n of this.nodes.values()) { if (this.eligible(n)) { this.focusedId = n.id; break; } }
    }
    this.emit();
  }

  getFocusedId() { return this.focusedId; }

  isFocused(id: string) { return this.focusedId === id; }

  subscribe(cb: () => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  private emit() { this.listeners.forEach(l => l()); }

  setFocused(id: string) {
    const node = this.nodes.get(id);
    if (!node || !this.eligible(node)) return;
    this.focusedId = id;
    this.emit();
  }

  /** Фокус на «логичный первый» элемент страницы (наименьший autoFocusPriority,
      либо самый верхний-левый, если приоритет не задан). Вызывается при
      монтировании каждого TV-экрана. */
  focusDefault(preferId?: string) {
    if (preferId && this.nodes.has(preferId) && this.eligible(this.nodes.get(preferId)!)) {
      this.setFocused(preferId);
      return;
    }
    let best: Node | null = null;
    for (const n of this.nodes.values()) {
      if (!this.eligible(n)) continue;
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
      if (id === this.focusedId || !this.eligible(node)) continue;
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

/** id элемента в фокусе (или null) — реактивно; нужен боковой панели, чтобы раскрываться. */
export const useTVFocusedId = () =>
  useSyncExternalStore(
    cb => tvFocusManager.subscribe(cb),
    () => tvFocusManager.getFocusedId(),
    () => null,
  );
