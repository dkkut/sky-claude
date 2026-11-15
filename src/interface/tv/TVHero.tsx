/* ===========================================================
   SKY TV — TVHero
   Широкий блок главной: фон — афиша на всю ширину (размытая), справа
   чёткая афиша, слева — название и сведения. Меняется вслед за
   фокусом пульта (какой фильм выбран в ряду — тот и показан).
   Данные только настоящие: чего у фильма нет, того не рисуем.
=========================================================== */
import { Play, Info } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { TVFocusable } from './TVFocusable';

interface TVHeroProps {
  /** Ключ — id фильма: смена запускает плавный переход. */
  movieKey: string;
  title: string;
  description?: string;
  imageUrl?: string;
  rating?: number;
  genre?: string;
  year?: number;
  country?: string;
  ageRating?: string;
  duration?: string;
  onWatch: () => void;
  onDetails: () => void;
  /** Ряд под сведениями (премьеры), прижат к низу блока. */
  children?: React.ReactNode;
}

const glass = { background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', backdropFilter: 'blur(14px)' } as const;

export const TVHero = ({ movieKey, title, description, imageUrl, rating, genre, year, country, ageRating, duration, onWatch, onDetails, children }: TVHeroProps) => (
  <div className="relative w-full overflow-hidden" style={{ height: 640 }}>
    <AnimatePresence mode="sync">
      <motion.div key={movieKey} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
        <div className="absolute inset-0" style={{
          background: imageUrl ? `center/cover no-repeat url(${imageUrl})` : 'linear-gradient(135deg,#2a2150,#0e0e1c)',
          filter: imageUrl ? 'blur(46px) saturate(1.35) brightness(.8)' : undefined, transform: 'scale(1.25)',
        }} />
        {imageUrl && (
          <div className="absolute inset-y-0 right-0" style={{
            width: '58%', background: `right center/contain no-repeat url(${imageUrl})`,
            WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)', maskImage: 'linear-gradient(90deg, transparent 0%, #000 38%)',
          }} />
        )}
      </motion.div>
    </AnimatePresence>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(8,8,22,0.94) 0%, rgba(8,8,22,0.55) 48%, rgba(8,8,22,0.1) 100%)' }} />
    <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, rgba(8,8,22,0.97) 0%, rgba(8,8,22,0.3) 42%, transparent 70%)' }} />

    <div className="absolute inset-x-0 top-0 flex flex-col px-14 pt-14" style={{ maxWidth: '62%' }}>
      <AnimatePresence mode="wait">
        <motion.div key={movieKey} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
          <p translate="no" className="line-clamp-2 font-black uppercase leading-[1.02] text-white"
            style={{ fontSize: title.length > 22 ? 44 : 60, letterSpacing: '-0.01em', textShadow: '0 4px 24px rgba(0,0,0,0.55)' }}>{title}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[16px] font-semibold" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {rating != null && <span className="rounded-md px-2 py-0.5 text-[15px] font-extrabold text-[#06210f]" style={{ background: '#5eead4' }}>{rating.toFixed(1)}</span>}
            {year && <span>{year}</span>}
            {country && <span translate="no">{country}</span>}
            {genre && <span translate="no">{genre}</span>}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {duration && <span>{duration}</span>}
            {ageRating && <span className="rounded-md px-2 py-0.5 text-[13px] font-bold" style={glass}>{ageRating}</span>}
          </div>
          {description && <p translate="no" className="mt-4 line-clamp-3 max-w-[760px] text-[17px] leading-snug" style={{ color: 'rgba(255,255,255,0.78)' }}>{description}</p>}
        </motion.div>
      </AnimatePresence>
      <div className="mt-6 flex items-center gap-3">
        <TVFocusable id="hero-watch" onEnter={onWatch} autoFocusPriority={0}>
          {({ focused }) => (
            <div className="flex items-center gap-2 rounded-2xl px-7 py-3.5 text-[18px] font-extrabold transition-transform"
              style={{ background: '#fff', color: '#0a0a14', transform: focused ? 'scale(1.07)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px #b3a7ff, 0 0 32px rgba(139,124,255,.55)' : 'none' }}>
              <Play size={21} fill="#0a0a14" /> Смотреть
            </div>
          )}
        </TVFocusable>
        <TVFocusable id="hero-details" onEnter={onDetails} autoFocusPriority={1}>
          {({ focused }) => (
            <div className="flex items-center gap-2 rounded-2xl px-7 py-3.5 text-[18px] font-extrabold text-white transition-transform"
              style={{ ...glass, background: focused ? 'rgba(255,255,255,0.26)' : glass.background, transform: focused ? 'scale(1.07)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px #b3a7ff, 0 0 32px rgba(139,124,255,.55)' : 'none' }}>
              <Info size={21} /> Подробнее
            </div>
          )}
        </TVFocusable>
      </div>
    </div>

    {children && <div className="absolute inset-x-0 bottom-0 px-14 pb-5">{children}</div>}
  </div>
);
