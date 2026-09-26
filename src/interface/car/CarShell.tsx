/* ===========================================================
   SKY CAR MODE — корневая оболочка.
   Стиль: Sky + Liquid Glass + современная автомобильная мультимедиа-
   система — НЕ копия CarPlay, крупные элементы, минимум отвлечения,
   тёмный интерфейс, фиолетово-синий акцент Sky.

   Не второй набор сервисов: главный экран открывает существующие
   Музыку/Кино/Подкасты/Мессенджер/Sky AI через их же сторы и API —
   здесь только другая, крупная оболочка над ними.
=========================================================== */
import { useState } from 'react';
import { setCarMode } from './useCarMode';
import { CarHome } from './CarHome';
import { CarMusic } from './CarMusic';
import { CarCinema } from './CarCinema';
import { CarPodcasts } from './CarPodcasts';
import { CarMessenger } from './CarMessenger';
import { CarAI } from './CarAI';
import { CarMiniPlayer } from './CarMiniPlayer';
import { TVPlayer, type TVPlayerSource } from '@/interface/tv/TVPlayer';
import { PlayerEngine } from '@/player/PlayerEngine';

export type CarScreen =
  | { kind: 'home' }
  | { kind: 'music' }
  | { kind: 'cinema' }
  | { kind: 'podcasts' }
  | { kind: 'messenger' }
  | { kind: 'ai' }
  | { kind: 'player'; source: TVPlayerSource };

export const CAR_BG = 'linear-gradient(165deg,#0a0a14 0%,#12101f 45%,#161029 100%)';
export const CAR_GLASS = 'rgba(255,255,255,0.06)';
export const CAR_GLASS_BORDER = '1px solid rgba(255,255,255,0.10)';
export const CAR_BLUR = 'blur(28px) saturate(160%)';

export const CarShell = () => {
  const [screen, setScreen] = useState<CarScreen>({ kind: 'home' });

  const goHome = () => setScreen({ kind: 'home' });
  const openPlayer = (source: TVPlayerSource) => setScreen({ kind: 'player', source });

  return (
    <div className="fixed inset-0 z-[600] overflow-hidden select-none" style={{ background: CAR_BG }}>
      {/* Единственный реальный <audio> для музыки — тот же движок, что и
          в обычном интерфейсе, чтобы не завести второй параллельный плеер
          (см. PlayerEngine.tsx). Подкаст-элемент живёт вне React и не
          требует отдельного монтирования. */}
      <PlayerEngine />

      {screen.kind !== 'player' && (
        <button type="button" onClick={() => setCarMode(false)}
          className="absolute top-5 right-5 z-20 rounded-full px-5 py-3 text-[15px] font-bold text-white"
          style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          Выйти из Car Mode
        </button>
      )}

      {screen.kind === 'home' && (
        <CarHome
          onOpenMusic={() => setScreen({ kind: 'music' })}
          onOpenCinema={() => setScreen({ kind: 'cinema' })}
          onOpenPodcasts={() => setScreen({ kind: 'podcasts' })}
          onOpenMessenger={() => setScreen({ kind: 'messenger' })}
          onOpenAI={() => setScreen({ kind: 'ai' })}
        />
      )}

      {screen.kind === 'music' && (
        <CarScreenFrame title="Музыка" onBack={goHome}><CarMusic /></CarScreenFrame>
      )}
      {screen.kind === 'cinema' && (
        <CarScreenFrame title="Кино" onBack={goHome}><CarCinema onPlay={openPlayer} /></CarScreenFrame>
      )}
      {screen.kind === 'podcasts' && (
        <CarScreenFrame title="Подкасты" onBack={goHome}><CarPodcasts /></CarScreenFrame>
      )}
      {screen.kind === 'messenger' && (
        <CarScreenFrame title="Сообщения" onBack={goHome}><CarMessenger /></CarScreenFrame>
      )}
      {screen.kind === 'ai' && (
        <CarScreenFrame title="Sky AI" onBack={goHome} noScroll><CarAI /></CarScreenFrame>
      )}

      {screen.kind === 'player' && (
        <TVPlayer source={screen.source} onBack={goHome} />
      )}
    </div>
  );
};

/** Общая рамка экрана: заголовок + «Назад» + мини-плеер сверху, крупные отступы. */
const CarScreenFrame = ({ title, onBack, children, noScroll }: {
  title: string; onBack: () => void; children: React.ReactNode; noScroll?: boolean;
}) => (
  <div className="flex h-full flex-col">
    <div className="flex items-center gap-4 px-8 pt-6 pb-4 shrink-0">
      <button type="button" onClick={onBack}
        className="grid h-14 w-14 place-items-center rounded-full text-white text-2xl font-bold"
        style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
        ‹
      </button>
      <p className="text-[26px] font-extrabold text-white">{title}</p>
      <div className="flex-1" />
      <div className="w-[360px]"><CarMiniPlayer compact /></div>
    </div>
    <div className={noScroll ? 'flex-1 min-h-0 px-8 pb-6' : 'flex-1 min-h-0 overflow-y-auto px-8 pb-6'}>
      {children}
    </div>
  </div>
);
