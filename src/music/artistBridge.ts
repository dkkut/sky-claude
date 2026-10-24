import { useModuleStore } from '@/data/state/modules';

/** Открыть карточку исполнителя из любого места (полноэкранный плеер живёт вне Sky Music).
 *  Имя запоминается до тех пор, пока Sky Music не смонтируется и не заберёт его. */
let pending: string | null = null;
export const takePendingArtist = (): string | null => { const a = pending; pending = null; return a; };

export const openArtistCard = (name: string) => {
  const n = (name || '').trim();
  if (!n) return;
  pending = n;
  const st = useModuleStore.getState();
  st.setPendingExtrasTab('music');
  st.setActiveModule('extras');
  window.dispatchEvent(new CustomEvent('sky:open-artist', { detail: n }));
};
