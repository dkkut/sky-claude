import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Search, Globe2, MapPin, X, Check, Navigation } from 'lucide-react';
import { useRegionStore, allCountries, findCountry } from './store';

const GLOBE_DOTS = Array.from({ length: 90 }, (_, i) => ({
  x: (i * 47) % 100, y: Math.floor(i / 12) * 11 + ((i * 13) % 8),
}));

export const RegionPicker = ({ onClose }: { onClose: () => void }) => {
  const { code, autoDetect, saved, setRegion, setWorldwide, setAutoDetect, removeSaved, detectedCountry } = useRegionStore();
  const [query, setQuery] = useState('');

  const countries = allCountries();
  const popular = countries.filter(c => c.popular);
  const savedCountries = saved.map(c => findCountry(c)).filter(c => c.code !== 'WW');
  const q = query.trim().toLowerCase();
  const filtered = q ? countries.filter(c => c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q) || c.code.toLowerCase() === q) : countries;
  const sorted = useMemo(() => [...filtered].sort((a,b) => a.name.localeCompare(b.name,'ru')), [filtered]);
  const detected = detectedCountry();

  const Row = ({ c }: { c: typeof countries[number] }) => (
    <button type="button" onClick={() => setRegion(c.code)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.03]">
      <span className="text-xl">{c.flag}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--t1)' }}>{c.name}</p>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{c.currency} · {c.currencySymbol}</p>
      </div>
      {code === c.code && <Check size={16} style={{ color: 'var(--accent)' }}/>}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--bg)' }}>

      <div className="shrink-0 px-4 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Регион</h2>
        </div>

        {/* Стилизованный «глобус» */}
        <div className="relative mt-3 overflow-hidden rounded-3xl" style={{ height: 120, background: 'linear-gradient(160deg, #0d1526, #131b30 60%, #0d1526)' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 30% 30%, rgba(79,110,247,0.25), transparent 60%)' }}/>
          <svg viewBox="0 0 100 60" className="absolute inset-0 h-full w-full opacity-70">
            {GLOBE_DOTS.map((d,i) => <circle key={i} cx={d.x} cy={d.y % 60} r={0.7} fill="rgba(255,255,255,0.18)"/>)}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-3xl">{findCountry(code).flag}</span>
            <p className="text-[13px] font-bold text-white">{findCountry(code).name}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <Search size={15} style={{ color: 'var(--t3)' }}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск страны"
            className="flex-1 bg-transparent text-[13.5px] outline-none" style={{ color: 'var(--t1)' }}/>
          {query && <button type="button" onClick={() => setQuery('')}><X size={13} style={{ color: 'var(--t3)' }}/></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {!q && (
          <>
            <button type="button" onClick={setWorldwide}
              className="mb-3 flex w-full items-center gap-3 rounded-2xl p-3.5" style={{ background: code === 'WW' ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1.5px solid ${code === 'WW' ? 'var(--accent)' : 'var(--border)'}` }}>
              <Globe2 size={20} style={{ color: code === 'WW' ? 'var(--accent)' : 'var(--t2)' }}/>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>Весь мир</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Глобальный контент без региональных фильтров</p>
              </div>
              {code === 'WW' && <Check size={16} style={{ color: 'var(--accent)' }}/>}
            </button>

            <button type="button" onClick={() => setAutoDetect(!autoDetect)}
              className="mb-4 flex w-full items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <Navigation size={18} style={{ color: autoDetect ? 'var(--accent)' : 'var(--t3)' }}/>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>Автоопределение региона</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Определено: {detected.flag} {detected.name}</p>
              </div>
              <span className="h-5 w-9 shrink-0 rounded-full p-0.5" style={{ background: autoDetect ? 'var(--accent)' : 'var(--border)' }}>
                <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: autoDetect ? 16 : 0 }} transition={{ type:'spring', stiffness:500, damping:30 }}/>
              </span>
            </button>

            {savedCountries.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Недавние</p>
                <div className="flex flex-wrap gap-2">
                  {savedCountries.map(c => (
                    <button key={c.code} type="button" onClick={() => setRegion(c.code)}
                      className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: code === c.code ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1px solid ${code === c.code ? 'var(--accent)' : 'var(--border)'}` }}>
                      <span>{c.flag}</span><span className="text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Популярные страны</p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {popular.map(c => (
                <button key={c.code} type="button" onClick={() => setRegion(c.code)}
                  className="flex items-center gap-2.5 rounded-2xl p-3" style={{ background: code === c.code ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1px solid ${code === c.code ? 'var(--accent)' : 'var(--border)'}` }}>
                  <span className="text-lg">{c.flag}</span>
                  <span className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--t1)' }}>{c.name}</span>
                </button>
              ))}
            </div>

            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Все страны</p>
          </>
        )}

        <div className="space-y-0.5">
          {sorted.length === 0 ? (
            <p className="py-8 text-center text-[12.5px]" style={{ color: 'var(--t3)' }}>Страна не найдена</p>
          ) : sorted.map(c => <Row key={c.code} c={c}/>)}
        </div>
      </div>
    </motion.div>
  );
};
