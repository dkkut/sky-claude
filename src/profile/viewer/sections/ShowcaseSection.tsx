import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Gem, X, Settings, Check } from 'lucide-react';
import { useNftGiftsStore } from '@/gifts/nftStore';
import { GiftBackground } from '@/gifts/backgrounds';
import { GiftCard } from '@/gifts/GiftCard';
import { ALL_BACKGROUNDS, BACKGROUND_LABELS, RARITY_CONFIG, type BackgroundTheme, type Gift } from '@/gifts/types';
import { apiNftShowcase, apiNftSaveShowcase, type ShowcaseRemote } from '@/gifts/giftsApi';
import { flash } from '@/shared/flash';
import type { ProfileData } from '../useProfileData';

const EMPTY: ShowcaseRemote = { background: 'galaxy', layout: 'grid', description: '', pinned: [] };

/** Витрина коллекционера в профиле: красивая карточка с закреплёнными подарками; своя настраивается, чужая видна по правилам приватности. */
export const ShowcaseSection = ({ data }: { data: ProfileData }) => {
  const allGifts = useNftGiftsStore(s => s.gifts);
  const [state, setState] = useState<{ hidden: boolean; items: string[]; config: ShowcaseRemote } | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const r = await apiNftShowcase(data.userId);
    if (r) setState({ hidden: r.hidden, items: r.items.map(i => i.nftId), config: { ...EMPTY, ...r.config } });
  }, [data.userId]);
  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(allGifts.map(g => [g.id, g])), [allGifts]);
  if (!state || state.hidden) return null;
  const owned = state.items.map(id => byId.get(id)).filter((g): g is Gift => Boolean(g));
  if (owned.length === 0 && !data.isOwn) return null;
  const { config } = state;
  const pinned = config.pinned.length ? config.pinned.map(id => byId.get(id)).filter((g): g is Gift => Boolean(g)) : owned.slice(0, 6);
  const top = pinned[0];

  const save = async (patch: Partial<ShowcaseRemote>) => {
    const prev = state;
    setState({ ...state, config: { ...config, ...patch } });
    const r = await apiNftSaveShowcase(patch);
    if (!r.ok) { setState(prev); flash('Не удалось сохранить витрину'); }
  };

  return (
    <div className="relative overflow-hidden rounded-[28px]" style={{ border: '1px solid var(--profile-card-border, rgba(255,255,255,0.12))', boxShadow: '0 18px 50px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.14)' }}>
      <div className="absolute inset-0"><GiftBackground theme={config.background as BackgroundTheme} rarity={top?.rarity ?? 'founder'} /></div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.55))' }} />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(10px)' }}><Gem size={15} color="#fff" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white">Витрина коллекционера</p>
            <p className="truncate text-[11px] text-white/70" translate="no">{config.description || `В коллекции: ${owned.length}`}</p>
          </div>
          {data.isOwn && (
            <button type="button" onClick={() => { setOpen(true); setEditing(true); }} aria-label="Настроить витрину"
              className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}><Settings size={14} color="#fff" /></button>
          )}
        </div>

        {pinned.length === 0 ? (
          <p className="py-8 text-center text-xs text-white/70">{data.isOwn ? 'Закрепите подарки, чтобы показать их здесь' : 'Пока пусто'}</p>
        ) : (
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2 no-scrollbar" style={{ scrollSnapType: 'x mandatory' }}>
            {pinned.slice(0, 8).map(g => (
              <div key={g.id} className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                <GiftCard gift={g} size="sm" showFavorite={false} onClick={() => setOpen(true)} />
              </div>
            ))}
          </div>
        )}

        <button type="button" onClick={() => { setOpen(true); setEditing(false); }}
          className="mt-3 w-full rounded-2xl py-2.5 text-xs font-bold text-white" style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.22)', backdropFilter: 'blur(12px)' }}>
          {`Открыть витрину · ${owned.length}`}
        </button>
      </div>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div className="fixed inset-0 z-[10040] flex flex-col" style={{ background: 'var(--bg)' }}
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}>
              <div className="absolute inset-x-0 top-0 h-72 overflow-hidden"><GiftBackground theme={config.background as BackgroundTheme} rarity={top?.rarity ?? 'founder'} /></div>
              <div className="relative flex shrink-0 items-center gap-3 px-4 py-3" style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}>
                <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.4)' }}><X size={17} color="#fff" /></button>
                <p className="flex-1 truncate text-base font-black text-white">Витрина коллекционера</p>
                {data.isOwn && <button type="button" onClick={() => setEditing(e => !e)} className="rounded-full px-3 py-1.5 text-xs font-bold text-white" style={{ background: 'rgba(0,0,0,0.4)' }}>{editing ? 'Готово' : 'Настроить'}</button>}
              </div>
              <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-10">
                {editing && data.isOwn && (
                  <div className="mb-4 space-y-3 rounded-3xl p-4" style={{ background: 'rgba(8,10,24,0.72)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(18px)' }}>
                    <p className="text-[10px] font-bold uppercase text-white/60">Фон</p>
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                      {ALL_BACKGROUNDS.map(b => (
                        <button key={b} type="button" onClick={() => void save({ background: b })} className="shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-bold"
                          style={{ background: config.background === b ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: '#fff' }}>{BACKGROUND_LABELS[b]}</button>
                      ))}
                    </div>
                    <p className="text-[10px] font-bold uppercase text-white/60">Описание</p>
                    <input defaultValue={config.description} maxLength={160} placeholder="Например: моя коллекция редких подарков" aria-label="Описание витрины"
                      onBlur={(e) => { if (e.target.value !== config.description) void save({ description: e.target.value }); }}
                      className="w-full rounded-xl px-3 py-2 text-xs text-white outline-none" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    <p className="text-[10px] font-bold uppercase text-white/60">Что показывать в профиле (до 12)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {owned.map(g => {
                        const on = config.pinned.includes(g.id);
                        return (
                          <button key={g.id} type="button" onClick={() => void save({ pinned: on ? config.pinned.filter(x => x !== g.id) : [...config.pinned, g.id].slice(0, 12) })}
                            className="flex items-center gap-2 rounded-xl p-2 text-left" style={{ background: on ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)' }}>
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: on ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }}>{on && <Check size={11} color="#fff" />}</span>
                            <span className="truncate text-[11px] text-white" translate="no">{g.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {owned.length === 0 ? <p className="py-16 text-center text-sm text-white/70">В коллекции пока нет подарков</p> : (
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
                    {owned.map(g => (
                      <div key={g.id} className="flex flex-col items-center gap-1.5">
                        <GiftCard gift={g} size="sm" showFavorite={false} />
                        <span className="text-[10px] font-bold" style={{ color: RARITY_CONFIG[g.rarity].color }}>{`№${g.edition} из ${g.totalEdition}`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};
