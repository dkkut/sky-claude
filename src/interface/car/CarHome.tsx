/* ===========================================================
   SKY CAR MODE — главный экран.
   Крупная сетка из пяти существующих сервисов Sky (без изобретения
   новых): Музыка, Кино, Подкасты, Мессенджер, Sky AI.
=========================================================== */
import { Music2, Clapperboard, Podcast, MessageCircle, Sparkles } from 'lucide-react';
import { CarMiniPlayer } from './CarMiniPlayer';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

interface Props {
  onOpenMusic: () => void;
  onOpenCinema: () => void;
  onOpenPodcasts: () => void;
  onOpenMessenger: () => void;
  onOpenAI: () => void;
}

const Tile = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick}
    className="flex flex-col items-center justify-center gap-4 rounded-[32px] transition-transform active:scale-95"
    style={{
      background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR,
      minHeight: 190, boxShadow: '0 12px 40px rgba(79,46,138,0.25)',
    }}>
    <div className="grid h-20 w-20 place-items-center rounded-3xl" style={{ background: 'var(--accent)' }}>
      {icon}
    </div>
    <p className="text-[19px] font-extrabold text-white">{label}</p>
  </button>
);

export const CarHome = ({ onOpenMusic, onOpenCinema, onOpenPodcasts, onOpenMessenger, onOpenAI }: Props) => (
  <div className="flex h-full flex-col px-8 pt-6 pb-8 gap-6">
    <div className="pr-44">
      <CarMiniPlayer />
    </div>
    <div className="grid flex-1 grid-cols-3 gap-6 min-h-0">
      <Tile icon={<Music2 size={34} color="#fff" />} label="Музыка" onClick={onOpenMusic} />
      <Tile icon={<Clapperboard size={34} color="#fff" />} label="Кино" onClick={onOpenCinema} />
      <Tile icon={<Podcast size={34} color="#fff" />} label="Подкасты" onClick={onOpenPodcasts} />
      <Tile icon={<MessageCircle size={34} color="#fff" />} label="Сообщения" onClick={onOpenMessenger} />
      <Tile icon={<Sparkles size={34} color="#fff" />} label="Sky AI" onClick={onOpenAI} />
    </div>
  </div>
);
