/* ===========================================================
   SKY CAR MODE — корневая оболочка.
   Принципы автомобильного интерфейса (минимализм, крупные цели
   касания, читаемость, минимум отвлечения), но со своим стилем Sky.
   НЕ Apple CarPlay и не Android Auto — интеграции с ними нет.
   Слева — панель разделов, справа — содержимое; управление музыкой
   всегда под рукой. Видео и чтение открыты, только когда автомобиль
   стоит (driveLogic.ts); свободного набора текста за рулём нет.
=========================================================== */
import { useHandoffStart } from '@/handoff/openContent';
import { useEffect, useState } from 'react';
import { Home, Music2, Mic2, MessageCircle, Sparkles, Users, LogOut, Clapperboard, BookOpen } from 'lucide-react';
import { setCarMode } from './useCarMode';
import { CarHome } from './CarHome';
import { CarMusic } from './CarMusic';
import { CarPodcasts } from './CarPodcasts';
import { CarMessenger } from './CarMessenger';
import { CarAI } from './CarAI';
import { CarCinema } from './CarCinema';
import { CarBooks } from './CarBooks';
import { CarNowBar, CarFullPlayer, useCarNow } from './CarNow';
import { CAR_ACCENT, CAR_BG, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';
import { NetBanner } from '@/shared/NetBanner';
import { PlayerEngine } from '@/player/PlayerEngine';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { NotifBridge } from '@/notifications/NotifBridge';
import { useMusicSync } from '@/music/useMusicSync';
import { useMusicStore } from '@/music/serverStore';
import { useAuthStore } from '@/core/auth/store';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';

export { CAR_BG, CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './carTheme';

export type CarScreen = 'home' | 'music' | 'podcasts' | 'cinema' | 'books' | 'messenger' | 'ai';

const DOCK: { key: CarScreen; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Главная', icon: Home },
  { key: 'music', label: 'Музыка', icon: Music2 },
  { key: 'podcasts', label: 'Подкасты', icon: Mic2 },
  { key: 'cinema', label: 'Кино', icon: Clapperboard },
  { key: 'books', label: 'Книги', icon: BookOpen },
  { key: 'messenger', label: 'Сообщения', icon: MessageCircle },
  { key: 'ai', label: 'Sky AI', icon: Sparkles },
];

const Clock = () => {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return <span translate="no">{t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
};

export const CarShell = () => {
  const [screen, setScreen] = useState<CarScreen>('home');
  const [menu, setMenu] = useState(false);
  const now = useCarNow();
  const me = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId));
  const loadMusic = useMusicStore((s) => s.load);
  useMusicSync();
  /* Передача с другого устройства: кино/видео и книги открываются в своих разделах (там и решается, можно ли показывать картинку). */
  const carOpen = useHandoffStart((st) => st.carOpen);
  useEffect(() => {
    if (!carOpen) return;
    if (carOpen.kind === 'film' || carOpen.kind === 'video') setScreen('cinema');
    else if (carOpen.kind === 'book') setScreen('books');
  }, [carOpen]);
  useEffect(() => { void loadMusic(); }, [loadMusic]);

  const switchProfile = () => {
    usePlayerStore.getState().clear();
    usePodcastPlayer.getState().close();
    useAuthStore.getState().switchProfile();
  };

  return (
    <div data-keep-dark="" className="fixed inset-0 z-[600] flex select-none overflow-hidden" style={{ background: CAR_BG }}>
      {/* Единственный реальный <audio> для музыки — тот же движок, что и в обычном интерфейсе. */}
      <PlayerEngine />
      <NotifBridge />
      <NetBanner />

      <nav aria-label="Разделы" className="flex w-[132px] shrink-0 flex-col items-center gap-3 overflow-y-auto py-5"  style={{ background: 'rgba(8,8,22,0.72)', borderRight: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
        <img src="/logo.png" alt="Sky" draggable={false} className="mb-1 h-12 w-12 shrink-0 object-contain [@media(max-height:560px)]:hidden" style={{ filter: 'drop-shadow(0 0 12px rgba(139,124,255,0.5))' }} />
        {DOCK.map((d) => {
          const on = screen === d.key;
          return (
            <button key={d.key} type="button" onClick={() => setScreen(d.key)} aria-label={d.label} aria-current={on ? 'page' : undefined}
              className="flex w-[108px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[26px] py-2 outline-none transition active:scale-95 focus-visible:ring-4 focus-visible:ring-violet-300"
              style={{ minHeight: 'clamp(68px, 12vh, 92px)', background: on ? 'rgba(139,124,255,0.28)' : 'transparent', border: on ? '1px solid rgba(179,167,255,0.5)' : '1px solid transparent' }}>
              <d.icon size={34} color={on ? '#fff' : 'rgba(255,255,255,0.6)'} strokeWidth={on ? 2.4 : 1.9} />
              <span className="text-[14px] font-semibold" style={{ color: on ? '#fff' : 'rgba(255,255,255,0.6)' }}>{d.label}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <p className="shrink-0 text-[20px] font-semibold text-white/85 [@media(max-height:560px)]:hidden"><Clock /></p>
        <button type="button" onClick={() => setMenu(true)} aria-label="Профиль" className="grid h-[72px] w-[72px] shrink-0 place-items-center overflow-hidden rounded-full text-[26px] font-bold text-white outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-violet-300"
          style={{ background: me?.avatar ? `center/cover url(${me.avatar})` : CAR_ACCENT }} translate="no">
          {!me?.avatar && (me?.name?.[0]?.toUpperCase() ?? '?')}
        </button>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          {screen === 'home' && <CarHome now={now} onOpen={setScreen} />}
          {screen === 'music' && <CarMusic />}
          {screen === 'podcasts' && <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}><CarPodcasts /></div>}
          {screen === 'cinema' && <CarCinema />}
          {screen === 'books' && <CarBooks />}
          {screen === 'messenger' && <CarMessenger />}
          {screen === 'ai' && <CarAI />}
        </div>
        {screen !== 'home' && <CarNowBar now={now} />}
      </main>

      <IncomingCallOverlay />
      <ActiveCallPanel />
      <MiniCallOverlay />
      <CallAudio />
      <CarFullPlayer now={now} />

      {menu && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Профиль" style={{ background: 'rgba(3,3,12,0.75)', backdropFilter: 'blur(8px)' }} onClick={() => setMenu(false)}>
          <div className="flex w-[560px] flex-col gap-4 rounded-[36px] p-8" style={{ background: 'rgba(16,14,36,0.98)', border: CAR_GLASS_BORDER }} onClick={(e) => e.stopPropagation()}>
            <p className="text-[28px] font-extrabold text-white" translate="no">{me?.name}</p>
            <button type="button" onClick={switchProfile} className="flex items-center gap-4 rounded-3xl px-6 text-[24px] font-semibold text-white" style={{ minHeight: 84, background: CAR_GLASS }}><Users size={30} /> Сменить профиль</button>
            <button type="button" onClick={() => setCarMode(false)} className="flex items-center gap-4 rounded-3xl px-6 text-[24px] font-semibold text-white" style={{ minHeight: 84, background: CAR_GLASS }}><LogOut size={30} /> Выйти из Car Mode</button>
            <button type="button" onClick={() => setMenu(false)} className="rounded-3xl px-6 text-[24px] font-semibold text-white/70" style={{ minHeight: 76 }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
};
