/* ===================================================================
   SKY TV  —  Live TV channels via YouTube embeds
   Real working streams: Russia + USA channels
=================================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv2, Globe, Radio } from 'lucide-react';

interface TvChannel {
  id:       string;
  name:     string;
  country:  'RU' | 'US' | 'INT';
  category: string;
  ytId:     string;   // YouTube channel ID for live_stream embed
  logo:     string;   // emoji fallback
  color:    string;
}

const CHANNELS: TvChannel[] = [
  // ── RUSSIA ──────────────────────────────────────────────
  { id:'rt_en',   name:'RT News',           country:'RU', category:'Новости',  ytId:'UCpwvZG87M7_HSSpHVHZzN_g', logo:'📡', color:'#cc0000' },
  { id:'rt_ru',   name:'RT на русском',     country:'RU', category:'Новости',  ytId:'UCkjEHOSUQOvdM1Gq42rIhAA', logo:'📺', color:'#cc0000' },
  { id:'otr',     name:'ОТР',               country:'RU', category:'Культура', ytId:'UCxd5EM6bq8nNTy-TtKZBgFA', logo:'🎭', color:'#1a56db' },
  { id:'dw_ru',   name:'DW на русском',     country:'RU', category:'Новости',  ytId:'UCd_h6FMuBtEzFVMwZZXtPfg', logo:'🌐', color:'#d32f2f' },
  // ── USA / INTERNATIONAL ───────────────────────────────────
  { id:'abc',     name:'ABC News Live',     country:'US', category:'News',    ytId:'UCBi2mrWuNuyYy4gbM6fU18Q', logo:'🔵', color:'#0033a0' },
  { id:'bloomberg',name:'Bloomberg TV',     country:'US', category:'Business', ytId:'UCIALMKvObZNtJ6AmdCLP7Hg', logo:'📈', color:'#000000' },
  { id:'france24', name:'France 24 EN',     country:'INT',category:'News',    ytId:'UCQfwfsi5VrQ8yKZ-UWmAoBg', logo:'🇫🇷', color:'#001689' },
  { id:'aljazeera',name:'Al Jazeera',       country:'INT',category:'News',    ytId:'UCNye-wNBqNL5ZzHSJdq7S2Q', logo:'🌍', color:'#d4882a' },
  { id:'dw_en',   name:'DW News',           country:'INT',category:'News',    ytId:'UCknLrEdhRCp1aegoMqRaCZg', logo:'🇩🇪', color:'#c8102e' },
  { id:'euronews',name:'Euronews',          country:'INT',category:'News',    ytId:'UCW5OrCpDpQH4UWGJZQM6m6Q', logo:'🇪🇺', color:'#0032a0' },
  { id:'cgtn',    name:'CGTN',              country:'INT',category:'News',    ytId:'UCbOYMpTHv74rj-6oObBFwkA', logo:'🇨🇳', color:'#c80000' },
  { id:'nasa',    name:'NASA TV',           country:'US', category:'Science', ytId:'UCLA_DiR1FfKNvjuUpBHmylQ', logo:'🚀', color:'#0b3d91' },
];

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
};

export const SkyTV = () => {
  const [active,   setActive]   = useState<TvChannel | null>(null);
  const [filter,   setFilter]   = useState<'all' | 'RU' | 'US' | 'INT'>('all');
  const [loading,  setLoading]  = useState(false);

  const shown = filter === 'all'
    ? CHANNELS
    : CHANNELS.filter(c => c.country === filter);

  const openChannel = (ch: TvChannel) => {
    setLoading(true);
    setActive(ch);
  };

  // Build working YouTube embed — prefer direct video ID if known, fallback to live_stream
  const ytSrc = (ch: TvChannel) => {
    const base = 'https://www.youtube-nocookie.com/embed/';
    // Use live_stream channel embed
    return `${base}live_stream?channel=${ch.ytId}&autoplay=1&rel=0&modestbranding=1&enablejsapi=0`;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>

      {/* ── Player ──────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {active ? (
          <motion.div key={active.id}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="shrink-0 relative"
            style={{ aspectRatio: '16/9', maxHeight: '42vh', background: '#000' }}>
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-3"
                style={{ background: '#000' }}>
                <div className="relative">
                  <div className="w-12 h-12 rounded-full"
                    style={{ border: `2px solid ${active.color}40`, borderTopColor: active.color,
                      animation: 'spin 0.8s linear infinite' }}/>
                  <span className="absolute inset-0 flex items-center justify-center text-xl">
                    {active.logo}
                  </span>
                </div>
                <p className="text-sm font-semibold text-white">{active.name}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Подключение к эфиру...</p>
              </div>
            )}
            <iframe
              key={active.id}
              src={ytSrc(active)}
              title={active.name}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 w-full h-full"
              style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.5s' }}
              onLoad={() => setLoading(false)}
              onError={() => setLoading(false)}
            />
          </motion.div>
        ) : (
          <motion.div key="placeholder"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="shrink-0 flex flex-col items-center justify-center gap-3"
            style={{ aspectRatio: '16/9', maxHeight: '42vh', background: '#050508',
              borderBottom: '1px solid var(--border)' }}>
            <Tv2 size={40} style={{ color: 'var(--t3)', opacity: 0.4 }}/>
            <p className="text-sm font-medium" style={{ color: 'var(--t3)' }}>
              Выберите канал для просмотра
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Now playing bar ─────────────────────────────── */}
      {active && (
        <div className="flex items-center gap-3 px-4 py-2.5 shrink-0"
          style={{ background: 'var(--bg-l1)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1.5">
            <motion.div className="h-2 w-2 rounded-full"
              style={{ background: '#ef4444' }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}/>
            <span className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: '#ef4444' }}>LIVE</span>
          </div>
          <span className="text-[10px]"
            style={{ color: 'var(--t1)', fontWeight: 600 }}>{active.logo} {active.name}</span>
          <span className="text-[10px]"
            style={{ color: 'var(--t3)' }}>{active.category}</span>
          <button type="button" onClick={() => { setActive(null); setLoading(false); }}
            className="ml-auto text-[10px] font-semibold px-2 py-1 rounded-md"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)' }}>
            Стоп
          </button>
        </div>
      )}

      {/* ── Filter tabs ─────────────────────────────────── */}
      <div className="flex gap-1.5 px-4 py-2.5 shrink-0 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--border)', scrollbarWidth: 'none' }}>
        {([['all','🌐 Все'],['RU','🇷🇺 Россия'],['US','🇺🇸 США'],['INT','🌍 Мир']] as const).map(([k,l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
            style={{
              background: filter === k ? 'var(--accent)' : 'var(--bg-l2)',
              color:      filter === k ? '#fff' : 'var(--t3)',
              border:    `1px solid ${filter === k ? 'transparent' : 'var(--border)'}`,
            }}>{l}</button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--t3)', whiteSpace: 'nowrap' }}>
          <Radio size={11}/> {CHANNELS.length} каналов
        </div>
      </div>

      {/* ── Channel grid ────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="grid grid-cols-2 gap-2 p-4 pb-6">
          {shown.map(ch => {
            const isOn = active?.id === ch.id;
            return (
              <motion.button key={ch.id} type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => openChannel(ch)}
                className="flex flex-col items-start gap-2.5 rounded-2xl p-3.5 text-left transition-all relative overflow-hidden"
                style={{
                  background: isOn ? `${ch.color}15` : 'var(--bg-l1)',
                  border: `1.5px solid ${isOn ? ch.color + '60' : 'var(--border)'}`,
                  boxShadow: isOn ? `0 4px 20px ${ch.color}25` : 'none',
                }}>
                {/* Live pulse if selected */}
                {isOn && (
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                    <motion.div className="h-1.5 w-1.5 rounded-full"
                      style={{ background: '#ef4444' }}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}/>
                    <span className="text-[8px] font-black uppercase tracking-widest"
                      style={{ color: '#ef4444' }}>LIVE</span>
                  </div>
                )}
                {/* Logo */}
                <div className="flex h-10 w-10 items-center justify-center rounded-xl text-2xl"
                  style={{ background: isOn ? `${ch.color}20` : 'var(--bg-l2)',
                    border: `1px solid ${isOn ? ch.color + '40' : 'var(--border)'}` }}>
                  {ch.logo}
                </div>
                {/* Info */}
                <div className="w-full pr-6">
                  <p className="text-[12px] font-bold leading-tight"
                    style={{ color: isOn ? '#fff' : 'var(--t1)' }}>
                    {ch.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px]"
                      style={{ color: isOn ? `${ch.color}` : 'var(--t3)' }}>
                      {ch.category}
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        background: ch.country === 'RU' ? 'rgba(204,0,0,0.12)' :
                                    ch.country === 'US' ? 'rgba(0,51,160,0.12)' : 'rgba(255,255,255,0.06)',
                        color:      ch.country === 'RU' ? '#f87171' :
                                    ch.country === 'US' ? '#93c5fd' : 'var(--t3)',
                      }}>
                      {ch.country === 'RU' ? 'RU' : ch.country === 'US' ? 'US' : '🌍'}
                    </span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
