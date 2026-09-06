/* ======================================================================
   SKY GIFTS NFT  —  Витрина коллекционера
====================================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Music, Music2 as MusicOff, Pin, Check } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftBackground } from './backgrounds';
import { GiftCard } from './GiftCard';
import { GiftSlide, Segmented, EmptyState } from './shared';
import { ALL_BACKGROUNDS, BACKGROUND_LABELS } from './types';
import type { ShowcaseConfig } from './types';

const ANIM_LABELS: Record<ShowcaseConfig['openAnimation'], string> = { fade:'Растворение', rise:'Подъём', shatter:'Разлёт', unfold:'Разворот' };

export const Showcase = ({ userId, onClose, onOpenGift }: { userId: string; onClose: () => void; onOpenGift: (id:string) => void }) => {
  const me = useAuthStore(s => s.currentUserId);
  const { gifts, showcaseFor, updateShowcase } = useNftGiftsStore();
  const isOwn = me === userId;
  const config = showcaseFor(userId);
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);

  const owned = gifts.filter(g => g.ownerId === userId);
  const pinned = config.pinnedGiftIds.length ? owned.filter(g => config.pinnedGiftIds.includes(g.id)) : owned.slice(0,9);

  const initial = config.openAnimation==='rise' ? { opacity:0, y:60 } : config.openAnimation==='shatter' ? { opacity:0, scale:1.4 } : config.openAnimation==='unfold' ? { opacity:0, rotateX:-40 } : { opacity:0 };

  return (
    <GiftSlide open onClose={onClose} title="Витрина">
      <div className="relative">
        <div className="absolute inset-0 h-64 overflow-hidden"><GiftBackground theme={config.background} rarity="founder"/></div>
        <div className="relative pt-10 px-5 pb-6">
          <AnimatePresence>
            {!opened ? (
              <motion.button type="button" onClick={() => setOpened(true)} exit={{ opacity:0, scale:1.1 }}
                className="w-full h-40 rounded-3xl grid place-items-center" style={{ background:'rgba(0,0,0,0.35)', border:`1px solid ${C.brd}` }}>
                <p className="text-sm font-bold" style={{ color:'#fff' }}>Открыть витрину</p>
              </motion.button>
            ) : (
              <motion.div initial={initial} animate={{ opacity:1, y:0, scale:1, rotateX:0 }} transition={{ duration:0.6, ease:'easeOut' }}>
                <p className="text-xs" style={{ color:'rgba(255,255,255,0.8)' }}>{config.description}</p>

                <div className="grid mt-4 gap-3" style={{ gridTemplateColumns: config.layout==='spotlight' ? '1fr' : 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                  {pinned.length === 0 ? <EmptyState icon={Pin} title="Нет закреплённых подарков"/> : pinned.map(g => (
                    <div key={g.id} className="flex justify-center"><GiftCard gift={g} size={config.layout==='spotlight'?'lg':'sm'} onClick={() => onOpenGift(g.id)} showFavorite={false}/></div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {isOwn && (
        <div className="px-5 pb-8">
          <button type="button" onClick={() => setEditing(e=>!e)} className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>
            <Settings size={13}/> Настроить витрину
          </button>

          {editing && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>ФОН ВИТРИНЫ</p>
                <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
                  {ALL_BACKGROUNDS.map(b => (
                    <button key={b} type="button" onClick={() => updateShowcase(userId, { background: b })}
                      className="shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-full" style={{ background: config.background===b?C.accBg:C.l2, color: config.background===b?C.acc:C.t3 }}>
                      {BACKGROUND_LABELS[b]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>РАСПОЛОЖЕНИЕ</p>
                <Segmented value={config.layout} onChange={(v) => updateShowcase(userId, { layout: v })} options={[{key:'grid',label:'Сетка'},{key:'carousel',label:'Карусель'},{key:'spotlight',label:'Соло'}]}/>
              </div>
              <div>
                <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>АНИМАЦИЯ ОТКРЫТИЯ</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(Object.keys(ANIM_LABELS) as ShowcaseConfig['openAnimation'][]).map(a => (
                    <button key={a} type="button" onClick={() => updateShowcase(userId, { openAnimation: a })} className="rounded-lg py-1.5 text-[10px] font-bold" style={{ background: config.openAnimation===a?C.accBg:C.l2, color: config.openAnimation===a?C.acc:C.t3 }}>{ANIM_LABELS[a]}</button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => updateShowcase(userId, { musicOn: !config.musicOn })} className="w-full flex items-center justify-between rounded-xl p-3" style={{ background: C.l2 }}>
                <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: C.t1 }}>{config.musicOn ? <Music size={13}/> : <MusicOff size={13}/>} Музыкальное сопровождение</span>
                <span className="text-xs font-bold" style={{ color: config.musicOn?C.acc:C.t3 }}>{config.musicOn?'Включено':'Выключено'}</span>
              </button>
              <div>
                <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>ОПИСАНИЕ</p>
                <textarea value={config.description} onChange={e => updateShowcase(userId, { description: e.target.value })} rows={2}
                  className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
              </div>
              <div>
                <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>ЗАКРЕПЛЁННЫЕ ПОДАРКИ</p>
                <div className="grid grid-cols-2 gap-2">
                  {owned.map(g => {
                    const pinnedNow = config.pinnedGiftIds.includes(g.id);
                    return (
                      <button key={g.id} type="button"
                        onClick={() => updateShowcase(userId, { pinnedGiftIds: pinnedNow ? config.pinnedGiftIds.filter(id=>id!==g.id) : [...config.pinnedGiftIds, g.id] })}
                        className="flex items-center gap-2 rounded-xl p-2 text-left" style={{ background: pinnedNow?C.accBg:C.l2 }}>
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: pinnedNow?C.acc:C.l3 }}>{pinnedNow && <Check size={11} color="#fff"/>}</span>
                        <span className="text-[11px] truncate" style={{ color: pinnedNow?C.acc:C.t2 }}>{g.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </GiftSlide>
  );
};
