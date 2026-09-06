/**
 * NotifToast  —  всплывающие уведомления поверх любого экрана.
 * Автоматически скрываются через 4 секунды.
 * При клике на сообщение — открывает FloatingChat.
 */
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageCircle, Phone, Heart, Bell, AtSign, Repeat2, UserPlus, Shield } from 'lucide-react';
import { useNotifStore, SkyNotif, NotifKind } from './store';
import { useModuleStore }        from '@/data/state/modules';
import { useMessengerStore }     from '@/messenger/store';
import { useFloatingChatStore }  from './floatingChatStore';

const KindIcon = ({ kind }: { kind: NotifKind }) => {
  const s = { size: 13 };
  if (kind === 'message')      return <MessageCircle {...s} />;
  if (kind === 'mention')      return <AtSign        {...s} />;
  if (kind === 'call_in')      return <Phone         {...s} />;
  if (kind === 'call_missed')  return <Phone         {...s} />;
  if (kind === 'like')         return <Heart         {...s} />;
  if (kind === 'comment')      return <MessageCircle {...s} />;
  if (kind === 'repost')       return <Repeat2       {...s} />;
  if (kind === 'follow')       return <UserPlus      {...s} />;
  return                              <Shield        {...s} />;
};

const Toast = ({ notif, onDismiss }: { notif: SkyNotif; onDismiss: () => void }) => {
  const setActiveModule = useModuleStore(s => s.setActiveModule);
  const setActiveChat   = useMessengerStore(s => s.setActiveChat);
  const openChat        = useFloatingChatStore(s => s.openChat);

  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const handleClick = () => {
    if (notif.kind === 'message' || notif.kind === 'mention') {
      if (notif.chatId) {
        // Открываем floating mini-chat (не переключаем модуль)
        openChat(notif.chatId, notif.title, notif.avatarLetter);
      }
    } else if (notif.chatId) {
      setActiveModule('messages');
      setActiveChat(notif.chatId);
    } else if (notif.kind === 'like' || notif.kind === 'comment' || notif.kind === 'repost') {
      setActiveModule('bloom');
    }
    onDismiss();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.9 }}
      animate={{ opacity: 1, x: 0,  scale: 1   }}
      exit={{    opacity: 0, x: 60, scale: 0.9  }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={handleClick}
      className="flex items-start gap-3 rounded-2xl p-3 cursor-pointer select-none"
      style={{
        width:      300,
        background: 'var(--bg-l2)',
        border:     '1px solid var(--border-m)',
        boxShadow:  '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* Avatar */}
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
        style={{ background: notif.color, opacity: 0.85 }}>
        {notif.avatarLetter}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span style={{ color: notif.color }}><KindIcon kind={notif.kind} /></span>
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{notif.title}</p>
        </div>
        <p className="text-xs truncate" style={{ color: 'var(--t2)' }}>{notif.body}</p>
        {(notif.kind === 'message' || notif.kind === 'mention') && notif.chatId && (
          <p className="text-[10px] mt-1" style={{ color: 'var(--accent)' }}>
            Нажми, чтобы ответить →
          </p>
        )}
      </div>

      {/* Dismiss */}
      <button type="button" onClick={e => { e.stopPropagation(); onDismiss(); }}
        className="shrink-0 mt-0.5" style={{ color: 'var(--t3)' }}>
        <X size={12} />
      </button>
    </motion.div>
  );
};

export const NotifToastLayer = () => {
  const { toasts, dismissToast } = useNotifStore();

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence mode="sync">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <Toast notif={t} onDismiss={() => dismissToast(t.id)} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};
