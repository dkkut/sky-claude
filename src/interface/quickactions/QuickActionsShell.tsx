/* ===========================================================
   PC Quick Actions — корневая оболочка overlay-окна.
   Открывается по глобальному хоткею (Ctrl/Cmd+Shift+Space, см.
   electron/main.cjs) поверх всех окон. Только Electron — никогда не
   рендерится в вебе/Android/iOS/TV/Car (см. проверку в AppShell.tsx).
=========================================================== */
import { useEffect, useState } from 'react';
import { Music2, MessageCircle, Clapperboard, Sparkles } from 'lucide-react';
import { QuickActionsPlayer } from './QuickActionsPlayer';
import { QuickActionsMessenger } from './QuickActionsMessenger';
import { QuickActionsWatch } from './QuickActionsWatch';
import { QuickActionsAI } from './QuickActionsAI';

type Tab = 'player' | 'messenger' | 'watch' | 'ai';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'player', label: 'Плеер', icon: <Music2 size={16} /> },
  { key: 'messenger', label: 'Сообщения', icon: <MessageCircle size={16} /> },
  { key: 'watch', label: 'Кино', icon: <Clapperboard size={16} /> },
  { key: 'ai', label: 'Sky AI', icon: <Sparkles size={16} /> },
];

export const QuickActionsShell = () => {
  const [tab, setTab] = useState<Tab>('player');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Escape') { window.sky?.quickActions.hide(); return; }
      // Цифрами переключаем вкладки — но не когда человек печатает текст.
      if (!typing && e.key >= '1' && e.key <= '4') {
        setTab(TABS[Number(e.key) - 1].key);
        return;
      }
      if (!typing && (e.key === 'Tab')) {
        e.preventDefault();
        const idx = TABS.findIndex(t => t.key === tab);
        const next = e.shiftKey ? (idx - 1 + TABS.length) % TABS.length : (idx + 1) % TABS.length;
        setTab(TABS[next].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden rounded-2xl" style={{ background: '#0e0e11', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex shrink-0 items-center gap-1 border-b p-1.5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 transition-colors"
            style={{ background: tab === t.key ? 'rgba(255,255,255,0.08)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}>
            {t.icon}
            <span className="text-[10px] font-bold">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'player' && <QuickActionsPlayer />}
        {tab === 'messenger' && <QuickActionsMessenger />}
        {tab === 'watch' && <QuickActionsWatch />}
        {tab === 'ai' && <QuickActionsAI />}
      </div>
    </div>
  );
};
