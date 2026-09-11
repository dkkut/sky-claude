/* ===========================================================
   SKY TV — TVHeader
   Компактная верхняя панель. Логотип + разделы + поиск + профиль.
=========================================================== */
import { Search as SearchIcon, User } from 'lucide-react';
import { TVFocusable } from './TVFocusable';
import type { TVScreen } from './tvNavStore';

const SECTIONS: { key: TVScreen['kind']; label: string }[] = [
  { key: 'home',      label: 'Главная'    },
  { key: 'movies',    label: 'Фильмы'     },
  { key: 'series',    label: 'Сериалы'    },
  { key: 'music',     label: 'Sky Music'  },
  { key: 'video',     label: 'SkyVideo'   },
  { key: 'channels',  label: 'Sky TV'     },
  { key: 'favorites', label: 'Избранное'  },
];

interface TVHeaderProps {
  active: TVScreen['kind'];
  onNavigate: (kind: typeof SECTIONS[number]['key']) => void;
  onSearch: () => void;
  onProfile: () => void;
}

export const TVHeader = ({ active, onNavigate, onSearch, onProfile }: TVHeaderProps) => (
  <div className="flex items-center gap-1 px-10 shrink-0" style={{ height: 76, background: 'linear-gradient(180deg, rgba(10,10,14,0.95), rgba(10,10,14,0.75))' }}>
    <p className="mr-8 text-[22px] font-extrabold shrink-0" style={{ color: 'var(--accent)' }}>Sky</p>

    {SECTIONS.map((s, i) => (
      <TVFocusable key={s.key} id={`nav-${s.key}`} onEnter={() => onNavigate(s.key)} autoFocusPriority={active === s.key ? -1 : undefined}>
        {({ focused }) => (
          <div className="mx-1 rounded-lg px-4 py-2 text-[15px] font-bold transition-colors"
            style={{
              color: focused ? '#fff' : active === s.key ? 'var(--accent)' : 'var(--t2)',
              background: focused ? 'var(--accent)' : 'transparent',
              boxShadow: focused ? '0 0 0 2px rgba(255,255,255,0.25)' : 'none',
            }}>
            {s.label}
          </div>
        )}
      </TVFocusable>
    ))}

    <div className="flex-1"/>

    <TVFocusable id="nav-search" onEnter={onSearch}>
      {({ focused }) => (
        <div className="grid h-11 w-11 place-items-center rounded-full mr-2" style={{ background: focused ? 'var(--accent)' : 'rgba(255,255,255,0.08)' }}>
          <SearchIcon size={19} color="#fff"/>
        </div>
      )}
    </TVFocusable>
    <TVFocusable id="nav-profile" onEnter={onProfile}>
      {({ focused }) => (
        <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: focused ? 'var(--accent)' : 'rgba(255,255,255,0.08)' }}>
          <User size={19} color="#fff"/>
        </div>
      )}
    </TVFocusable>
  </div>
);
