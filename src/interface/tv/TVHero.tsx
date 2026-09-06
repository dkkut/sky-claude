/* ===========================================================
   SKY TV — TVHero
   Крупный hero-блок главной страницы. ~45% первого экрана.
=========================================================== */
import { Play, Info, Star } from 'lucide-react';
import { TVFocusable } from './TVFocusable';

interface TVHeroProps {
  title: string;
  description?: string;
  imageUrl?: string;
  rating?: number;
  genre?: string;
  year?: number;
  duration?: string;
  onWatch: () => void;
  onDetails: () => void;
}

export const TVHero = ({ title, description, imageUrl, rating, genre, year, duration, onWatch, onDetails }: TVHeroProps) => (
  <div className="relative w-full overflow-hidden rounded-2xl" style={{ height: '46vh', minHeight: 340 }}>
    <div className="absolute inset-0"
      style={{ background: imageUrl ? `center/cover no-repeat url(${imageUrl})` : 'linear-gradient(135deg,#242433,#0e0e14)' }}/>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(10,10,14,0.92) 0%, rgba(10,10,14,0.45) 55%, transparent 100%)' }}/>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(10,10,14,0.85) 0%, transparent 40%)' }}/>

    <div className="absolute inset-0 flex flex-col justify-end p-10 max-w-[52%]">
      <p className="text-[38px] font-extrabold leading-[1.05] mb-3 text-white" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>{title}</p>
      <div className="flex items-center gap-3 mb-3 text-[15px] font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {rating != null && <span className="flex items-center gap-1"><Star size={15} fill="#ffc93c" color="#ffc93c"/> {rating.toFixed(1)}</span>}
        {genre && <span>{genre}</span>}
        {year && <span>{year}</span>}
        {duration && <span>{duration}</span>}
      </div>
      {description && (
        <p className="text-[15px] leading-snug mb-6 line-clamp-2" style={{ color: 'rgba(255,255,255,0.65)' }}>{description}</p>
      )}
      <div className="flex items-center gap-3">
        <TVFocusable id="hero-watch" onEnter={onWatch} autoFocusPriority={0}>
          {({ focused }) => (
            <div className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-bold transition-transform"
              style={{ background: focused ? '#fff' : 'rgba(255,255,255,0.9)', color: '#0a0a0e', transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none' }}>
              <Play size={20} fill="#0a0a0e"/> Смотреть
            </div>
          )}
        </TVFocusable>
        <TVFocusable id="hero-details" onEnter={onDetails} autoFocusPriority={1}>
          {({ focused }) => (
            <div className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-bold transition-transform"
              style={{ background: focused ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)', color: '#fff', transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none' }}>
              <Info size={20}/> Подробнее
            </div>
          )}
        </TVFocusable>
      </div>
    </div>
  </div>
);
