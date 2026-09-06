import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, FolderOpen, Wifi, WifiOff } from 'lucide-react';
import { OfflineChats } from './OfflineChats';
import { OfflineMedia } from './OfflineMedia';

type OfflineTab = 'chats' | 'media';

interface Props {
  onRetryOnline: () => void;
}

export const OfflineMode = ({ onRetryOnline }: Props) => {
  const [tab, setTab] = useState<OfflineTab>('chats');

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg)' }}>
      {/* Offline header */}
      <div className="shrink-0 px-4 pt-4 pb-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-full"
              style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)' }}>
              <WifiOff size={15} style={{ color: 'var(--red)' }} />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-tight">Sky · Офлайн</p>
              <p className="text-[11px]" style={{ color: 'var(--t2)' }}>Ограниченный доступ</p>
            </div>
          </div>
          <motion.button type="button" onClick={onRetryOnline}
            whileTap={{ scale: 0.94 }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(79,110,247,0.12)', border: '1px solid rgba(79,110,247,0.25)', color: 'var(--accent)' }}>
            <Wifi size={12} />
            Переподключить
          </motion.button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-3">
          {([
            { key: 'chats', label: 'Чаты', Icon: MessageCircle },
            { key: 'media', label: 'Медиа', Icon: FolderOpen },
          ] as { key: OfflineTab; label: string; Icon: typeof MessageCircle }[]).map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button key={key} type="button" onClick={() => setTab(key)}
                className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: active ? 'rgba(79,110,247,0.15)' : 'transparent',
                  color:      active ? 'var(--accent)' : 'var(--t2)',
                  border:     `1px solid ${active ? 'rgba(79,110,247,0.3)' : 'transparent'}`,
                }}>
                <Icon size={14} />
                {label}
                {active && (
                  <motion.div layoutId="offline-tab-indicator"
                    className="absolute inset-0 rounded-xl"
                    style={{ background: 'rgba(79,110,247,0.08)' }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, x: tab === 'chats' ? -12 : 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === 'chats' ? 12 : -12 }}
            transition={{ duration: 0.18 }}
            className="h-full">
            {tab === 'chats' && <OfflineChats />}
            {tab === 'media' && <OfflineMedia />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
