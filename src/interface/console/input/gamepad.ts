/* ===========================================================
   SKY CONSOLE — геймпад (Gamepad API, раскладка "standard") и клавиатура.
   Один опрос на всё приложение; события нажатий не дублируются
   (фронт нажатия + повтор только для направлений).
=========================================================== */
import { create } from 'zustand';
import { consoleNav } from './nav';
import { hasOpenDialog, isTextField } from './spatial';
import type { Dir } from './spatial';

export type PadStyle = 'playstation' | 'xbox' | 'generic';

export const useInputState = create<{ source: 'pad' | 'kb' | 'pointer'; style: PadStyle; connected: boolean }>(() => ({
  source: 'kb', style: 'generic', connected: false,
}));

const styleOf = (id: string): PadStyle =>
  /054c|sony|dualsense|dualshock|playstation|wireless controller/i.test(id) ? 'playstation'
    : /xbox|045e|microsoft|x-?input/i.test(id) ? 'xbox' : 'generic';

const REPEAT_FIRST = 380;
const REPEAT_NEXT = 115;
const DEAD = 0.55;
const SCROLL_DEAD = 0.25;

interface PadMem { pressed: boolean[]; heldSince: Record<string, number>; lastFire: Record<string, number> }

export const startGamepad = (): (() => void) => {
  const mem = new Map<number, PadMem>();
  let raf = 0;
  let stopped = false;

  const fire = (dir: Dir) => consoleNav.move(dir);

  const edge = (m: PadMem, i: number, down: boolean) => {
    const was = m.pressed[i]; m.pressed[i] = down;
    return down && !was;
  };

  const repeating = (m: PadMem, key: string, active: boolean, now: number, run: () => void) => {
    if (!active) { delete m.heldSince[key]; delete m.lastFire[key]; return; }
    if (m.heldSince[key] === undefined) { m.heldSince[key] = now; m.lastFire[key] = now; run(); return; }
    const since = now - m.heldSince[key];
    const gap = since < REPEAT_FIRST ? Infinity : REPEAT_NEXT;
    if (now - m.lastFire[key] >= gap) { m.lastFire[key] = now; run(); }
  };

  const poll = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(poll);
    if (document.visibilityState !== 'visible') return;
    const pads = (navigator.getGamepads?.() ?? []).filter(Boolean) as Gamepad[];
    const connected = pads.length > 0;
    if (useInputState.getState().connected !== connected) useInputState.setState({ connected });
    for (const pad of pads) {
      let m = mem.get(pad.index);
      if (!m) { m = { pressed: [], heldSince: {}, lastFire: {} }; mem.set(pad.index, m); }
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = (i: number) => pad.axes[i] ?? 0;
      const used = pad.buttons.some((x) => x.pressed) || Math.abs(ax(0)) > DEAD || Math.abs(ax(1)) > DEAD;
      if (used) {
        const st = styleOf(pad.id);
        const cur = useInputState.getState();
        if (cur.source !== 'pad' || cur.style !== st) useInputState.setState({ source: 'pad', style: st });
      }
      const left = b(14) || ax(0) < -DEAD; const right = b(15) || ax(0) > DEAD;
      const up = b(12) || ax(1) < -DEAD; const down = b(13) || ax(1) > DEAD;
      repeating(m, 'l', left && !right, now, () => fire('left'));
      repeating(m, 'r', right && !left, now, () => fire('right'));
      repeating(m, 'u', up && !down, now, () => fire('up'));
      repeating(m, 'd', down && !up, now, () => fire('down'));

      if (edge(m, 0, b(0))) consoleNav.activate();
      if (edge(m, 1, b(1))) consoleNav.back();
      if (edge(m, 2, b(2))) consoleNav.onMedia();
      if (edge(m, 3, b(3))) consoleNav.focusAuto();
      if (edge(m, 4, b(4))) consoleNav.onShoulder(-1);
      if (edge(m, 5, b(5))) consoleNav.onShoulder(1);
      if (edge(m, 9, b(9)) || edge(m, 16, b(16))) consoleNav.home();

      // Правый стик — прокрутка списка под фокусом.
      const sy = ax(3); const sx = ax(2);
      if (Math.abs(sy) > SCROLL_DEAD || Math.abs(sx) > SCROLL_DEAD) consoleNav.scrollBy(Math.abs(sx) > SCROLL_DEAD ? sx * 18 : 0, Math.abs(sy) > SCROLL_DEAD ? sy * 22 : 0);
    }
  };

  /* Клавиатура: те же действия — чтобы консоль работала и с физической клавиатурой. */
  const onKey = (e: KeyboardEvent) => {
    if (useInputState.getState().source !== 'kb') useInputState.setState({ source: 'kb' });
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const typing = isTextField(e.target as Element);
    const map: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const d = map[e.key];
    if (d && !typing) { e.preventDefault(); consoleNav.move(d); return; }
    // Escape в открытом диалоге закрывает сам диалог — второй раз не нажимаем.
    if (e.key === 'Escape' && !hasOpenDialog()) consoleNav.back();
    if (e.key === 'Backspace' && !typing) { e.preventDefault(); consoleNav.back(); }
    if (e.key === 'F1' || e.key === 'ContextMenu') { e.preventDefault(); consoleNav.home(); }
  };
  const onPointer = () => { if (useInputState.getState().source !== 'pointer') useInputState.setState({ source: 'pointer' }); };
  const onConnect = (e: GamepadEvent) => useInputState.setState({ connected: true, source: 'pad', style: styleOf(e.gamepad.id) });
  const onDisconnect = () => {
    const any = (navigator.getGamepads?.() ?? []).some(Boolean);
    useInputState.setState({ connected: any });
  };

  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('gamepadconnected', onConnect);
  window.addEventListener('gamepaddisconnected', onDisconnect);
  raf = requestAnimationFrame(poll);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('gamepadconnected', onConnect);
    window.removeEventListener('gamepaddisconnected', onDisconnect);
  };
};
