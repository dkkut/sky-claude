import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { useProfileViewer } from './store';
import { FullProfilePage } from './FullProfilePage';

/**
 * Монтируется один раз в корне приложения (AppShell / MobileShell) —
 * рядом с NotifToastLayer / FloatingChatLayer. Слушает стек открытых
 * профилей и рисует полноэкранную страницу поверх ЛЮБОГО модуля,
 * независимо от того, из какого места платформы был клик по аватару.
 */
export const ProfileViewerLayer = () => {
  const stack = useProfileViewer(s => s.stack);
  const current = stack[stack.length - 1];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {current && <FullProfilePage key={current} userId={current} />}
    </AnimatePresence>,
    document.body,
  );
};
