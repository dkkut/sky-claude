/* ===========================================================
   PC Quick Actions — корневая оболочка overlay-окна.
   Открывается по глобальному хоткею (Ctrl/Cmd+Shift+Space, см.
   electron/main.cjs) поверх всех окон. Только Electron — никогда не
   рендерится в вебе/Android/iOS/TV/Car (см. проверку в AppShell.tsx).

   Набор и порядок вкладок больше не захардкожен — его задаёт Quick
   Menu (server/quickmenu.mjs, настройка в Профиль → Настройки):
   какие разделы включены и в каком порядке, решает сам пользователь,
   этот файл только собирает панель по тому, что вернул сервер.
=========================================================== */
import { useEffect, useState, Suspense } from 'react';
import { Music2, MessageCircle, Clapperboard, Sparkles, Mic2, PawPrint, Gift, Video, BookOpen, Loader2 } from 'lucide-react';
import { lazyChunk } from '@/app/lazyChunk';
import { QuickActionsPlayer } from './QuickActionsPlayer';
import { QuickActionsMessenger } from './QuickActionsMessenger';
import { QuickActionsWatch } from './QuickActionsWatch';
import { QuickActionsAI } from './QuickActionsAI';
import { apiQuickMenuGet } from '@/quickmenu/quickMenuApi';

const SkyPodcasts = lazyChunk(() => import('@/podcasts/SkyPodcasts').then(m => ({ default: m.SkyPodcasts })));
const PetsScreen = lazyChunk(() => import('@/pets/PetsScreen').then(m => ({ default: m.PetsScreen })));
const SkyGiftsNFT = lazyChunk(() => import('@/gifts/SkyGiftsNFT').then(m => ({ default: m.SkyGiftsNFT })));
const SkyVideo = lazyChunk(() => import('@/extras/SkyVideo').then(m => ({ default: m.SkyVideo })));
const LibraryModule = lazyChunk(() => import('@/library/LibraryModule').then(m => ({ default: m.LibraryModule })));

type Tab = { key: string; label: string; icon: React.ReactNode; render: () => React.ReactNode };
/** Полный реестр — те же ключи, что в server/quickmenu.mjs ITEM_REGISTRY.
 *  Пункты, для которых ещё нет отдельного компактного вида под overlay,
 *  показывают тот же полноэкранный экран, что и везде в Sky — не второй
 *  дублирующий интерфейс, а тот же самый. */
const TAB_DEFS: Record<string, Tab> = {
  player:    { key: 'player',    label: 'Плеер',     icon: <Music2 size={16}/>,        render: () => <QuickActionsPlayer/> },
  messenger: { key: 'messenger', label: 'Сообщения', icon: <MessageCircle size={16}/>, render: () => <QuickActionsMessenger/> },
  watch:     { key: 'watch',     label: 'Кино',      icon: <Clapperboard size={16}/>,  render: () => <QuickActionsWatch/> },
  ai:        { key: 'ai',        label: 'Sky AI',    icon: <Sparkles size={16}/>,      render: () => <QuickActionsAI/> },
  podcasts:  { key: 'podcasts',  label: 'Подкасты',  icon: <Mic2 size={16}/>,          render: () => <SkyPodcasts/> },
  pets:      { key: 'pets',      label: 'Питомцы',   icon: <PawPrint size={16}/>,      render: () => <PetsScreen/> },
  gifts:     { key: 'gifts',     label: 'Подарки',   icon: <Gift size={16}/>,          render: () => <SkyGiftsNFT/> },
  skyvideo:  { key: 'skyvideo',  label: 'SkyVideo',  icon: <Video size={16}/>,         render: () => <SkyVideo/> },
  library:   { key: 'library',   label: 'Библиотека', icon: <BookOpen size={16}/>,     render: () => <LibraryModule/> },
};
/** Пока настройка ещё не пришла с сервера — сегодняшний вид по умолчанию. */
const FALLBACK_TABS: Tab[] = ['player', 'messenger', 'watch', 'ai'].map(k => TAB_DEFS[k]);

export const QuickActionsShell = () => {
  const [tabs, setTabs] = useState<Tab[]>(FALLBACK_TABS);
  const [tab, setTab] = useState('player');

  useEffect(() => {
    let cancelled = false;
    void apiQuickMenuGet().then(({ items }) => {
      if (cancelled) return;
      const enabled = items.filter(i => i.enabled).map(i => TAB_DEFS[i.key]).filter(Boolean);
      if (enabled.length) { setTabs(enabled); setTab(enabled[0].key); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Escape') { window.sky?.quickActions.hide(); return; }
      // Цифрами переключаем вкладки — но не когда человек печатает текст.
      if (!typing && e.key >= '1' && e.key <= '9' && Number(e.key) <= tabs.length) {
        setTab(tabs[Number(e.key) - 1].key);
        return;
      }
      if (!typing && (e.key === 'Tab')) {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.key === tab);
        const next = e.shiftKey ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
        setTab(tabs[next].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, tabs]);

  const active = tabs.find(t => t.key === tab) ?? tabs[0];

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden rounded-2xl" style={{ background: '#0e0e11', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex shrink-0 items-center gap-1 border-b p-1.5 overflow-x-auto" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        {tabs.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 transition-colors"
            style={{ background: tab === t.key ? 'rgba(255,255,255,0.08)' : 'transparent', color: tab === t.key ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}>
            {t.icon}
            <span className="text-[10px] font-bold whitespace-nowrap">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="grid h-full place-items-center"><Loader2 className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }}/></div>}>
          {active?.render()}
        </Suspense>
      </div>
    </div>
  );
};
