import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, FolderOpen, Package, Wifi } from 'lucide-react';
import { SkyCloud } from '@/os/SkyCloud';
import { getApiOrigin } from '@/core/nativeApp';
import { OfflineChats } from './OfflineChats';
import { OfflineMedia } from './OfflineMedia';
import { OfflineOrders } from './OfflineOrders';

type OfflineTab = 'chats' | 'orders' | 'media';

interface Props {
  onRetryOnline: () => void;
}

export const OfflineMode = ({ onRetryOnline }: Props) => {
  const [tab, setTab] = useState<OfflineTab>('chats');
  const [checking, setChecking] = useState(false);
  const [tried, setTried] = useState(false);
  /* Настоящая проверка: браузерный признак `onLine` врёт (Wi-Fi есть, интернета нет) — спрашиваем сервер. */
  const retry = async () => {
    setChecking(true);
    let ok = false;
    try { const r = await fetch(`${getApiOrigin()}/healthz`, { cache: 'no-store' }); ok = r.ok; } catch { ok = false; }
    setChecking(false); setTried(true);
    if (ok) onRetryOnline();
  };

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--bg)' }}>
      {/* Offline header */}
      <div className="shrink-0 px-4 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3 rounded-[26px] p-3.5"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(18px)' }}>
          <SkyCloud state={checking ? 'waiting' : 'offline'} size={72} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold leading-tight text-white">Нет подключения к интернету</p>
            <p className="mt-0.5 text-[12px] leading-snug" style={{ color: 'var(--t2)' }}>
              {tried && !checking ? 'Связи всё ещё нет. Проверьте Wi-Fi или мобильную сеть. ' : ''}Пока доступно то, что уже сохранено на устройстве: чаты, заказы и скачанное.
            </p>
            <motion.button type="button" onClick={retry} disabled={checking} whileTap={{ scale: 0.95 }}
              className="mt-2 flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold"
              style={{ background: '#fff', color: '#0a0a14', opacity: checking ? 0.7 : 1 }}>
              <Wifi size={13} />{checking ? 'Проверяем…' : 'Проверить снова'}
            </motion.button>
          </div>
        </div>

        {/* Tabs */}
        <div className="glass-pill mt-3 flex gap-0.5">
          {([
            { key: 'chats', label: 'Чаты', Icon: MessageCircle },
            { key: 'orders', label: 'Заказы', Icon: Package },
            { key: 'media', label: 'Медиа', Icon: FolderOpen },
          ] as { key: OfflineTab; label: string; Icon: typeof MessageCircle }[]).map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button key={key} type="button" onClick={() => setTab(key)}
                className="relative isolate flex flex-1 items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-colors"
                style={{ color: active ? 'var(--t1)' : 'var(--t3)', background: 'transparent', border: 0 }}>
                <Icon size={14} />
                {label}
                {active && (
                  <motion.div layoutId="offline-tab-indicator"
                    className="glass-lens absolute inset-0 -z-10"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
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
            {tab === 'orders' && <OfflineOrders />}
            {tab === 'media' && <OfflineMedia />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
