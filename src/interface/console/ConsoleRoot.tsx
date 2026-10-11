/* Корень Sky Console: включает класс режима, опрос геймпада, экранную клавиатуру и подсказки кнопок. */
import { useEffect, type ReactNode } from 'react';
import './console.css';
import { startGamepad } from './input/gamepad';
import { useInputState } from './input/gamepad';
import { ConsoleKeyboard } from './input/ConsoleKeyboard';
import { useConsoleStore } from './consoleStore';
import { setForceDark } from '@/settings/store';

const GLYPH = {
  playstation: { select: '✕', back: '○', media: '□', home: 'OPTIONS' },
  xbox: { select: 'A', back: 'B', media: 'X', home: 'MENU' },
  generic: { select: 'A', back: 'B', media: 'X', home: 'START' },
} as const;

export const ConsoleLegend = ({ extra }: { extra?: { key: string; label: string }[] }) => {
  const { source, style } = useInputState();
  if (source === 'pointer') return null;
  const g = source === 'kb' ? { select: 'Enter', back: 'Esc', media: '', home: 'F1' } : GLYPH[style];
  return (
    <div className="pointer-events-none fixed bottom-5 right-8 z-[99990] flex items-center gap-5 text-[15px] font-semibold text-white/80" aria-hidden>
      {[{ k: g.select, l: 'Выбрать' }, { k: g.back, l: 'Назад' }, { k: g.home, l: 'Главная' }, ...(extra ?? []).map((e) => ({ k: e.key, l: e.label }))].map((x) => (
        <span key={x.l} className="flex items-center gap-2">
          <span className="grid min-w-[2rem] place-items-center rounded-full px-2 py-0.5 text-[13px] font-bold" style={{ background: 'rgba(255,255,255,0.18)' }} translate="no">{x.k}</span>
          {x.l}
        </span>
      ))}
    </div>
  );
};

export const ConsoleRoot = ({ children }: { children: ReactNode }) => {
  const fx = useConsoleStore((s) => s.prefs.fx);
  const source = useInputState((s) => s.source);
  useEffect(() => {
    document.body.classList.add('console-mode');
    setForceDark(true);
    const stop = startGamepad();
    return () => { stop(); setForceDark(false); document.body.classList.remove('console-mode', 'console-pad', 'console-light'); };
  }, []);
  useEffect(() => { document.body.classList.toggle('console-light', fx === 'light'); }, [fx]);
  useEffect(() => { document.body.classList.toggle('console-pad', source === 'pad'); }, [source]);
  return (
    <>
      {children}
      <ConsoleKeyboard />
      <ConsoleLegend />
    </>
  );
};
