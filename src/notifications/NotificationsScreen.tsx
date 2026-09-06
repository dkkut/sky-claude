/**
 * NotificationsScreen  -  полноценный экран уведомлений.
 * Вкладки: Все / Чаты / Звонки / Реакции
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, Check, Trash2, MessageCircle, Phone, Heart,
  AtSign, Repeat2, UserPlus, Shield, X, BellOff
} from 'lucide-react';
import { useNotifStore, SkyNotif, NotifKind } from './store';
import { useModuleStore } from '@/data/state/modules';
import { useMessengerStore } from '@/messenger/store';

type Tab = 'all' | 'chats' | 'calls' | 'reactions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all',       label: 'Все'      },
  { key: 'chats',     label: 'Чаты'     },
  { key: 'calls',     label: 'Звонки'   },
  { key: 'reactions', label: 'Реакции'  },
];

const kindToTab = (k: NotifKind): Tab => {
  if (k === 'message' || k === 'mention') return 'chats';
  if (k === 'call_in' || k === 'call_missed') return 'calls';
  if (k === 'like' || k === 'comment' || k === 'repost' || k === 'follow') return 'reactions';
  return 'all';
};

const KindIcon = ({ kind, color }: { kind: NotifKind; color: string }) => {
  const p = { size: 15, color };
  if (kind === 'message')     return <MessageCircle {...p} />;
  if (kind === 'mention')     return <AtSign        {...p} />;
  if (kind === 'call_in')     return <Phone         {...p} />;
  if (kind === 'call_missed') return <Phone         {...p} style={{ color:'var(--red)' }} />;
  if (kind === 'like')        return <Heart         {...p} />;
  if (kind === 'comment')     return <MessageCircle {...p} />;
  if (kind === 'repost')      return <Repeat2       {...p} />;
  if (kind === 'follow')      return <UserPlus      {...p} />;
  return                             <Shield        {...p} />;
};

const kindLabel: Record<NotifKind, string> = {
  message:    'Сообщение',
  mention:    'Упоминание',
  call_in:    'Звонок',
  call_missed:'Пропущенный',
  like:       'Лайк',
  comment:    'Комментарий',
  repost:     'Репост',
  follow:     'Подписчик',
  system:     'Система',
};

const fmtTime = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60000)   return 'только что';
  if (diff < 3600000) return `${Math.floor(diff/60000)} мин`;
  if (diff < 86400000)return `${Math.floor(diff/3600000)} ч`;
  return `${Math.floor(diff/86400000)} д`;
};

const NotifRow = ({ notif }: { notif: SkyNotif }) => {
  const { markRead, dismiss } = useNotifStore();
  const setActiveModule = useModuleStore(s => s.setActiveModule);
  const setActiveChat   = useMessengerStore(s => s.setActiveChat);

  const handle = () => {
    markRead(notif.id);
    if (notif.chatId) { setActiveModule('messages'); setActiveChat(notif.chatId); }
    else if (['like','comment','repost','follow'].includes(notif.kind)) setActiveModule('bloom');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{    opacity: 0, x: 20 }}
      onClick={handle}
      className="group flex items-start gap-3 rounded-2xl px-4 py-3.5 cursor-pointer transition-colors"
      style={{ background: notif.read ? 'transparent' : 'rgba(79,110,247,0.05)' }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white"
          style={{ background: notif.color + '33', border: `1.5px solid ${notif.color}44` }}>
          <span style={{ color: notif.color }}>{notif.avatarLetter}</span>
        </div>
        {/* kind badge */}
        <div className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full"
          style={{ background: 'var(--bg-l2)', border: '1.5px solid var(--bg)' }}>
          <KindIcon kind={notif.kind} color={notif.color} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>
            {notif.title}
          </p>
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
            style={{ background: notif.color + '22', color: notif.color }}>
            {kindLabel[notif.kind]}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--t2)' }}>
          {notif.body}
        </p>
        <p className="mt-1 text-[10px]" style={{ color: 'var(--t3)' }}>
          {fmtTime(notif.timestamp)}
        </p>
      </div>

      {/* Unread dot + dismiss */}
      <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
        {!notif.read && (
          <div className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
        )}
        <button type="button"
          onClick={e => { e.stopPropagation(); dismiss(notif.id); }}
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--t3)' }}>
          <X size={13} />
        </button>
      </div>
    </motion.div>
  );
};

export const NotificationsScreen = () => {
  const [tab, setTab] = useState<Tab>('all');
  const { notifs, markAllRead, clearAll } = useNotifStore();

  // Авто-прочитать все при открытии экрана (через 1 сек)
  useEffect(() => {
    const t = setTimeout(markAllRead, 1000);
    return () => clearTimeout(t);
  }, []);

  const shown = tab === 'all' ? notifs : notifs.filter(n => kindToTab(n.kind) === tab);
  const unread = notifs.filter(n => !n.read).length;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg-l1)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-2xl"
            style={{ background: 'rgba(79,110,247,0.12)' }}>
            <Bell size={17} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--t1)' }}>Уведомления</h2>
            {unread > 0 && (
              <p className="text-xs" style={{ color: 'var(--t3)' }}>
                {unread} непрочитанных
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button type="button" onClick={markAllRead}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              <Check size={12} /> Прочитать все
            </button>
          )}
          {notifs.length > 0 && (
            <button type="button" onClick={clearAll}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ background: 'var(--bg-l3)', color: 'var(--t3)' }}>
              <Trash2 size={12} /> Очистить
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pb-3">
        {TABS.map(t => {
          const cnt = t.key === 'all'
            ? notifs.filter(n => !n.read).length
            : notifs.filter(n => kindToTab(n.kind) === t.key && !n.read).length;
          return (
            <button key={t.key} type="button"
              onClick={() => setTab(t.key)}
              className="relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                background: tab === t.key ? 'var(--accent)' : 'var(--bg-l2)',
                color:      tab === t.key ? '#fff' : 'var(--t2)',
                border: `1px solid ${tab === t.key ? 'transparent' : 'var(--border)'}`,
              }}>
              {t.label}
              {cnt > 0 && (
                <span className="grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[9px] font-bold"
                  style={{
                    background: tab === t.key ? 'rgba(255,255,255,0.25)' : 'var(--accent)',
                    color: '#fff',
                  }}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2">
        <AnimatePresence mode="popLayout">
          {shown.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center gap-3 py-24">
              <div className="grid h-16 w-16 place-items-center rounded-3xl"
                style={{ background: 'var(--bg-l2)' }}>
                <BellOff size={28} style={{ color: 'var(--t3)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--t3)' }}>Нет уведомлений</p>
            </motion.div>
          ) : (
            shown.map(n => <NotifRow key={n.id} notif={n} />)
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
