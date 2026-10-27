import React, { useEffect, useState } from 'react';
import { Gamepad2, Boxes, Rocket, ChevronRight } from 'lucide-react';
import { ServersSection } from './Servers';
import { GamesSection } from './Games';
import { CabinetSection } from './Cabinet';
import { Back, GLASS } from './ui';
import { useDownloads, launcherNative } from './native';

type View = 'hub' | 'gta' | 'minecraft' | 'games' | 'cabinet';
const CARDS: { key: Exclude<View, 'hub' | 'cabinet'>; title: string; text: string; Icon: typeof Gamepad2; grad: string }[] = [
  { key: 'gta', title: 'GTA V', text: 'Серверы, подключение, игровые профили', Icon: Gamepad2, grad: 'linear-gradient(135deg,#7c3aed,#db2777)' },
  { key: 'minecraft', title: 'Minecraft', text: 'Серверы, версии, профили запуска', Icon: Boxes, grad: 'linear-gradient(135deg,#059669,#0ea5e9)' },
  { key: 'games', title: 'Sky Game Launcher', text: 'Библиотека, магазин, загрузки и обновления игр', Icon: Rocket, grad: 'linear-gradient(135deg,#6366f1,#38bdf8)' },
];

/** Вкладка «Лаунчер» в «Прочее». Разделы подгружаются по требованию; пока вкладка закрыта, ни таймеров, ни подписок нет (всё внутри разделов и снимается при уходе). */
export const Launcher = () => {
  const [view, setView] = useState<View>('hub');
  const { start, stop } = useDownloads();
  useEffect(() => { if (launcherNative()) void start(); return () => { if (launcherNative()) stop(); }; }, [start, stop]);
  if (view === 'hub') {
    return (
      <div className="relative h-full overflow-y-auto px-4 pb-24 pt-4">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: 'radial-gradient(90% 60% at 20% 0%, rgba(139,92,246,.22), transparent 70%), radial-gradient(70% 50% at 100% 30%, rgba(56,189,248,.14), transparent 70%)' }} />
        <h1 className="text-[22px] font-black" style={{ color: 'var(--t1)' }}>Лаунчер</h1>
        <p className="mb-4 text-[12px]" style={{ color: 'var(--t3)' }}>Игры и серверы в одном месте</p>
        <ul className="grid gap-3">
          {CARDS.map((c) => (
            <li key={c.key}><button type="button" onClick={() => setView(c.key)} className="relative flex w-full items-center gap-4 overflow-hidden rounded-3xl p-5 text-left" style={GLASS}>
              <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.grad }} />
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: c.grad }}><c.Icon size={26} color="#fff" /></span>
              <span className="min-w-0 flex-1"><b className="block text-[17px]" style={{ color: 'var(--t1)' }}>{c.title}</b><span className="text-[12px]" style={{ color: 'var(--t2)' }}>{c.text}</span></span>
              <ChevronRight size={18} style={{ color: 'var(--t3)' }} />
            </button></li>))}
        </ul>
        {!launcherNative() && <p className="mt-4 text-[12px]" style={{ color: 'var(--t3)' }}>Установка и запуск игр работают в приложении Sky для Windows. В браузере и на телефоне доступны каталоги серверов, библиотека и кабинет разработчика.</p>}
      </div>
    );
  }
  const title = { gta: 'GTA V', minecraft: 'Minecraft', games: 'Sky Game Launcher', cabinet: 'Мои игры' }[view];
  return (
    <div className="flex h-full flex-col">
      {view !== 'games' && view !== 'cabinet' && <Back onClick={() => setView('hub')} title={title} />}
      {view === 'games' && <div className="px-4 pt-3"><button type="button" onClick={() => setView('hub')} className="text-[12px] underline" style={{ color: 'var(--t3)' }}>← Лаунчер</button></div>}
      <div className="min-h-0 flex-1">
        {view === 'gta' && <ServersSection kind="gta" />}
        {view === 'minecraft' && <ServersSection kind="minecraft" />}
        {view === 'games' && <GamesSection openCabinet={() => setView('cabinet')} />}
        {view === 'cabinet' && <CabinetSection onBack={() => setView('games')} />}
      </div>
    </div>
  );
};
