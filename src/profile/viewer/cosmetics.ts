/* ===============================================================
   PROFILE COSMETICS — тонкая совместимая обёртка
   Раньше здесь был небольшой фиксированный список рамок. Теперь это
   прокладка над общим каталогом src/customization/catalog/frames.ts:
   те же экспортируемые имена (FRAMES, FRAME_MAP, availableFrames,
   activeFrame), но с полноценной системой разблокировки — статические
   условия (Prime/стаж/сезон) И владение через инвентарь маркета.
=============================================================== */
import type { Account } from '@/core/auth/store';
import { FRAME_CATALOG, FRAME_MAP, type FrameItem } from '@/customization/catalog/frames';
import { useCustomization } from '@/customization/store';
import { meetsStaticUnlock } from '@/customization/types';

export type { FrameItem as FrameDef };
export const FRAMES = FRAME_CATALOG;
export { FRAME_MAP };

export function availableFrames(acc: Account): FrameItem[] {
  const { ownsItem } = useCustomization.getState();
  return FRAME_CATALOG.filter(f =>
    f.unlock.type === 'owned' ? ownsItem(acc.id, f.id) : meetsStaticUnlock(f.unlock, acc),
  );
}

export function activeFrame(acc: Account | undefined): FrameItem {
  if (!acc) return FRAME_MAP.none;
  const equippedId = useCustomization.getState().getEquipped(acc.id, 'frame') ?? acc.equippedFrame;
  const wanted = equippedId ? FRAME_MAP[equippedId] : undefined;
  if (wanted && availableFrames(acc).some(f => f.id === wanted.id)) return wanted;
  return FRAME_MAP.none;
}
