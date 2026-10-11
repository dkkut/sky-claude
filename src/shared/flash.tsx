/**
 * Короткое сообщение поверх любого экрана: «не получилось», «разрешите
 * микрофон». Раньше такие отказы показывались только внутри чата, а
 * в музыке и кино человек не видел ничего.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useSettings } from '@/settings/store';
import { useIslandStore } from '@/island/islandStore';

interface FlashState { text: string | null; id: number; show: (text: string) => void; hide: () => void }
export const useFlash = create<FlashState>((set) => ({
  text: null,
  id: 0,
  show: (text) => set((s) => ({ text, id: s.id + 1 })),
  hide: () => set({ text: null }),
}));
export const flash = (text: string) => useFlash.getState().show(text);

export const FlashLayer = () => {
  const text = useFlash((s) => s.text);
  const id = useFlash((s) => s.id);
  const hide = useFlash((s) => s.hide);
  const hosted = useIslandStore((st) => st.mounted);
  const islandOn = useSettings((st) => st.settings.islandMode !== 'side') && hosted;
  /* Остров включён — короткие сообщения показывает он сам: отдельная плашка вставала бы поверх капсулы. */
  useEffect(() => {
    if (!text || !islandOn) return;
    useIslandStore.getState().push({ kind: 'system', mergeKey: 'flash', title: text, ttl: 5000, color: '#8b7cff', userText: false });
    hide();
  }, [text, id, islandOn, hide]);
  useEffect(() => {
    if (!text || islandOn) return;
    const t = window.setTimeout(hide, 6000);
    return () => window.clearTimeout(t);
  }, [text, id, hide, islandOn]);
  if (!text || islandOn) return null;
  return (
    <div role="status" onClick={hide} data-keep-dark=""
      className="fixed left-3 right-3 z-[10100] mx-auto max-w-md rounded-2xl px-4 py-3 text-[13px] font-medium"
      style={{ top: 'calc(var(--safe-top) + 8px)', background: 'rgba(24,24,28,0.96)', color: '#ebebed', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
      {text}
    </div>
  );
};
