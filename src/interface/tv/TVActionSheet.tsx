/* ===========================================================
   SKY TV — шторка действий над карточкой (пультом нет «правой кнопки»).
   Открывается по OK на карточке коллекции; Back закрывает её, а не уходит
   с экрана. Фокус заперт внутри (scope), пока шторка открыта.
=========================================================== */
import { useEffect } from 'react';
import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';

export interface SheetAction { label: string; run: () => void | Promise<void>; danger?: boolean; keepOpen?: boolean }
interface SheetState {
  data: { title: string; subtitle?: string; actions: SheetAction[] } | null;
  show: (d: NonNullable<SheetState['data']>) => void;
  /** true — шторка была открыта и закрылась. */
  close: () => boolean;
}

export const useTVSheet = create<SheetState>((set, get) => ({
  data: null,
  show: (d) => set({ data: d }),
  close: () => { const was = !!get().data; if (was) set({ data: null }); return was; },
}));

const SCOPE = 'tv-sheet';

export const TVActionSheetHost = () => {
  const data = useTVSheet((s) => s.data);
  useEffect(() => {
    if (!data) return undefined;
    tvFocusManager.setScope(SCOPE);
    return () => { tvFocusManager.setScope(null); };
  }, [data]);
  return (
    <AnimatePresence>
      {data && (
        <motion.div className="fixed inset-0 z-[450] flex items-center justify-center" role="dialog" aria-modal="true" aria-label={data.title}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ background: 'rgba(3,3,12,0.78)', backdropFilter: 'blur(8px)' }}>
          <motion.div initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} className="w-[640px] rounded-[32px] p-8"
            style={{ background: 'rgba(14,14,34,0.98)', border: '1px solid rgba(160,150,255,0.28)' }}>
            <p className="truncate text-[30px] font-extrabold text-white" translate="no">{data.title}</p>
            {data.subtitle && <p className="mb-5 truncate text-[18px] text-white/55" translate="no">{data.subtitle}</p>}
            <div className="mt-4 flex flex-col gap-3">
              {data.actions.map((a, i) => (
                <TVFocusable key={a.label} id={`sheet-${i}`} scope={SCOPE} autoFocusPriority={i} onEnter={() => { const r = a.run(); if (!a.keepOpen) useTVSheet.getState().close(); void r; }}>
                  {({ focused }) => (
                    <div className="rounded-2xl px-6 py-4 text-[22px] font-semibold" style={{
                      background: focused ? (a.danger ? '#d6405f' : '#7c6cff') : 'rgba(255,255,255,0.09)', color: focused ? '#fff' : a.danger ? '#ff8aa0' : '#fff',
                      boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9)' : 'none', transition: 'all .12s' }}>
                      {a.label}
                    </div>
                  )}
                </TVFocusable>
              ))}
              <TVFocusable id="sheet-close" scope={SCOPE} autoFocusPriority={99} onEnter={() => useTVSheet.getState().close()}>
                {({ focused }) => <div className="rounded-2xl px-6 py-4 text-[22px] font-semibold text-white/70" style={{ background: focused ? 'rgba(255,255,255,0.2)' : 'transparent', boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9)' : 'none' }}>Закрыть</div>}
              </TVFocusable>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
