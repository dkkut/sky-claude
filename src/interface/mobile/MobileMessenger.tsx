import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatList } from '@/messenger/ChatList';
import { ChatWindow } from '@/messenger/ChatWindow';
import { useMessengerStore } from '@/messenger/store';
import { SwipeBackView } from './SwipeBackView';

/** На десктопе список и окно чата всегда показаны рядом (там всегда есть
 *  activeChatId — архитектурно чат «всегда выбран»). На мобильном нам нужна
 *  классическая навигация список → чат, поэтому отслеживаем ИЗМЕНЕНИЕ
 *  activeChatId (пользователь тапнул по чату в списке) и переключаем экран,
 *  не трогая внутреннюю логику ChatList/ChatWindow. */
export const MobileMessenger = () => {
  const activeChatId = useMessengerStore(s => s.activeChatId);
  // Следим за счётчиком открытий, а не за самим идентификатором: чат
  // может быть уже выбран в сторе, и тогда нажатие по нему не меняло
  // ничего — список так и оставался на экране.
  const openSeq = useMessengerStore(s => s.openSeq);
  const prevSeq = useRef(openSeq);
  const [view, setView] = useState<'list'|'chat'>('list');

  useEffect(() => {
    if (openSeq !== prevSeq.current) {
      prevSeq.current = openSeq;
      if (activeChatId) setView('chat');
    }
  }, [openSeq, activeChatId]);

  // Чат исчез (вышли из него или его распустили) — возвращаемся к списку.
  useEffect(() => { if (!activeChatId) setView('list'); }, [activeChatId]);

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {view === 'list' ? (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
            <ChatList />
          </motion.div>
        ) : (
          <motion.div key="chat" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }} className="absolute inset-0 h-full">
            <SwipeBackView onBack={() => setView('list')}>
              <ChatWindow onBack={() => setView('list')} />
            </SwipeBackView>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
