import { VerifiedBadge } from '@/verification/marks';
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Edit, X, Check, Pin, BellOff, Bell, Archive, ArchiveRestore, Users, Hash, UserPlus,
  ChevronRight, CheckCheck, Star, Shield, Trash2, MessageSquareDot, Ban} from 'lucide-react';
import { BannerAd } from '@/ads/AdBlocks';
import { useMessengerStore } from './store';
import { broadcast } from './socket';
import { useAuthStore } from '@/core/auth/store';
import type { MessageItem, ChatItem } from './types';
import { useModerationStore } from '@/shared/moderationStore';
import { openProfile } from '@/profile/viewer/store';
import { activeFrame } from '@/profile/viewer/cosmetics';
import { activeChatListStyle } from '@/customization/selectors';
import { usePeerCosmetics } from '@/customization/store';
import { useGamingAccounts } from '@/gaming/accounts';
import { usePeopleSearch } from './usePeopleSearch';
import { useAdminStore } from './adminStore';
import { useTrashStore } from './trashStore';
import { requestDelete } from '../island/deleteFlow';

const fmtTime = (ts: number) => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'вчера';
  if (now.getFullYear() === d.getFullYear())
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });
};

const AVATAR_COLORS = ['#2CA5E0','#E84393','#FF7043','#00BCD4','#7E57C2','#26A69A','#EC407A','#42A5F5'];
const avatarColor = (name: string) => AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const TgAvatar = ({ chat, size = 50, onClick, frame }: {
  chat: ChatItem; size?: number; onClick?: (e: React.MouseEvent) => void;
  frame?: { ring: string; glow?: string };
}) => (
  <div className="relative shrink-0" style={{ width: size, height: size }} onClick={onClick}>
    {frame && frame.ring !== 'transparent' && (
      <div className="absolute rounded-full" style={{ inset: -3, background: frame.ring, boxShadow: frame.glow }} />
    )}
    <div className="absolute flex items-center justify-center text-white font-bold select-none overflow-hidden"
      style={{ inset: 0, background: avatarColor(chat.name), fontSize: size * 0.4, borderRadius: size * 0.3 }}>
      {chat.type === 'group'   ? <Users size={size * 0.38} color="white" />
       : chat.type === 'channel' ? <Hash size={size * 0.38} color="white" />
       : (chat.avatar?.[0] || chat.name[0] || '?').toUpperCase()}
    </div>
    {chat.online && chat.type === 'direct' && (
      <span className="absolute bottom-0.5 right-0.5 rounded-full border-2"
        style={{ width: 12, height: 12, background: 'var(--green)', borderColor: 'var(--bg-l1)' }} />
    )}
  </div>
);

const MsgStatus = ({ msg }: { msg: MessageItem }) => {
  if (!msg.fromMe || msg.kind === 'system') return null;
  const color = msg.status === 'read' ? '#4FC3F7' : 'var(--t2)';
  return <CheckCheck size={15} className="shrink-0" style={{ color }} />;
};

const preview = (msg?: MessageItem): string => {
  if (!msg) return '';
  if (msg.deleted) return 'Сообщение удалено';
  if (msg.kind === 'photo') return 'Фото';
  if (msg.kind === 'voice') return 'Голосовое';
  if (msg.kind === 'video-note') return 'Видеосообщение';
  if (msg.kind === 'file') return msg.fileName ?? 'Файл';
  if (msg.kind === 'pet') return 'Питомец';
  if (msg.kind === 'sticker') return 'Стикер';
  if (msg.kind === 'system') return msg.text;
  return msg.text.length > 55 ? msg.text.slice(0, 55) + '...' : msg.text;
};

/* -- NewChatModal ------------------------------------------------ */
const NewChatModal = ({ onClose }: { onClose: () => void }) => {
  const { createChat, startDM, setActiveChat } = useMessengerStore();
  const [step, setStep]     = useState<'menu' | 'dm' | 'group' | 'channel'>('menu');
  const [name, setName]     = useState('');
  const [query, setQuery]   = useState('');
  const [members, setMembers] = useState<string[]>([]);
  // Людей ищем на сервере: локального списка «всех аккаунтов» больше
  // нет, и настоящего собеседника в нём всё равно не было.
  const { people: found, loading } = usePeopleSearch(query);
  // В группу сервер пускает только тех, с кем уже есть общий чат: иначе
  // достаточно было создать группу со списком чужих идентификаторов,
  // чтобы получить право писать этим людям и звонить им. Поэтому и
  // выбирать предлагаем из тех же людей.
  const known = useMessengerStore(s => s.people);
  const myId  = useAuthStore.getState().currentUserId;
  const contacts = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return Object.values(known)
      .filter(p => p.id !== myId)
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  }, [known, query, myId]);

  const goCreate = () => {
    if (!name.trim()) return;
    const id = createChat({ name: name.trim(), type: step === 'group' ? 'group' : 'channel', memberIds: members });
    const chat = useMessengerStore.getState().chats.find(c => c.id === id);
    if (chat) broadcast.newChat(chat);
    setActiveChat(id); onClose();
  };

  const toggleMember = (u: { id: string }) => {
    setMembers(m => m.includes(u.id) ? m.filter(x => x !== u.id) : [...m, u.id]);
  };
  const memberOptions = contacts;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="w-full max-w-sm rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-l2)', maxHeight: '75vh' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-3 px-4 py-3.5 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}>
          {step !== 'menu' && (
            <button type="button" onClick={() => setStep('menu')} className="text-sm font-medium"
              style={{ color: 'var(--accent)' }}>← Назад</button>
          )}
          <p className="flex-1 font-semibold" style={{ color: 'var(--t1)' }}>
            {step === 'menu' ? 'Новый чат' : step === 'dm' ? 'Написать' : step === 'group' ? 'Новая группа' : 'Новый канал'}
          </p>
          <button type="button" onClick={onClose} style={{ color: 'var(--t2)' }}><X size={18} /></button>
        </div>

        {step === 'menu' && (
          <div className="py-1.5">
            {([
              { icon: UserPlus, label: 'Написать личное',  sub: 'Выберите контакт',      key: 'dm'      as const, color: 'var(--accent)' },
              { icon: Users,    label: 'Создать группу',   sub: 'Несколько участников',   key: 'group'   as const, color: '#4CAF50' },
              { icon: Hash,     label: 'Создать канал',    sub: 'Для публикаций',         key: 'channel' as const, color: '#9C27B0' },
            ] as const).map(item => (
              <button key={item.key} type="button" onClick={() => setStep(item.key)}
                className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5">
                <div className="grid h-10 w-10 place-items-center rounded-full shrink-0"
                  style={{ background: `${item.color}22` }}>
                  <item.icon size={19} style={{ color: item.color }} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--t1)' }}>{item.label}</p>
                  <p className="text-xs" style={{ color: 'var(--t2)' }}>{item.sub}</p>
                </div>
                <ChevronRight size={15} style={{ color: 'var(--t2)' }} />
              </button>
            ))}
          </div>
        )}

        {step === 'dm' && (
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2.5 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
                <Search size={14} style={{ color: 'var(--t2)' }} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Поиск..." className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--t1)' }} />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {query.trim().length < 2 && (
                <p className="py-4 text-center text-xs" style={{ color: 'var(--t2)' }}>
                  Введите имя или @username
                </p>
              )}
              {query.trim().length >= 2 && loading && found.length === 0 && (
                <p className="py-4 text-center text-xs" style={{ color: 'var(--t2)' }}>Ищем…</p>
              )}
              {query.trim().length >= 2 && !loading && found.length === 0 && (
                <p className="py-4 text-center text-xs" style={{ color: 'var(--t2)' }}>Никого не нашли</p>
              )}
              {found.map(u => (
                <button key={u.id} type="button"
                  onClick={() => { const c = startDM(u); if (c) broadcast.newChat(c); onClose(); }}
                  className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: avatarColor(u.name) }}>{u.name[0]}</div>
                  <div className="flex-1 min-w-0 text-left">
                    <p translate="no" className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>{u.name}</p>
                    <p className="text-xs" style={{ color: 'var(--t2)' }}>@{u.username}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {(step === 'group' || step === 'channel') && (
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-4 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                placeholder={step === 'group' ? 'Название группы' : 'Название канала'}
                onKeyDown={e => e.key === 'Enter' && goCreate()}
                className="w-full bg-transparent text-base outline-none"
                style={{ color: 'var(--t1)', borderBottom: '2px solid #5b9bd1', paddingBottom: 6 }} />
            </div>
            <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-widest shrink-0"
              style={{ color: 'var(--t2)' }}>Участники</p>
            <div className="px-4 pb-2 shrink-0">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
                <Search size={14} style={{ color: 'var(--t2)' }} />
                <input value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Найти участника..." className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: 'var(--t1)' }} />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {memberOptions.length === 0 && (
                <p className="px-4 py-4 text-center text-xs" style={{ color: 'var(--t2)' }}>
                  Пока некого добавить: сначала напишите человеку лично
                </p>
              )}
              {memberOptions.map(u => (
                <button key={u.id} type="button"
                  onClick={() => toggleMember(u)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/5">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: avatarColor(u.name) }}>{u.name[0]}</div>
                  <div className="flex-1 min-w-0 text-left">
                    <p translate="no" className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>{u.name}</p>
                    <p className="text-xs" style={{ color: 'var(--t2)' }}>@{u.username}</p>
                  </div>
                  <div className="grid h-5 w-5 place-items-center rounded-full shrink-0"
                    style={{ background: members.includes(u.id) ? '#5b9bd1' : 'transparent', border: `2px solid ${members.includes(u.id) ? '#5b9bd1' : 'var(--t2)'}` }}>
                    {members.includes(u.id) && <Check size={11} color="white" />}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-4 py-3 shrink-0 border-t" style={{ borderColor: 'var(--border)' }}>
              <button type="button" onClick={goCreate} disabled={!name.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ background: 'var(--accent)' }}>
                Создать {step === 'group' ? `группу${members.length ? ` (${members.length + 1})` : ''}` : 'канал'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

/* -- Меню действий над чатом --------------------------------------
   Открывается удержанием на телефоне и правой кнопкой на компьютере.
   Над списком кнопок показывается сам чат: так видно, к чему они
   относятся, — иначе в длинном списке легко промахнуться строкой.

   Набор кнопок зависит от сегмента: в «Непрочитанных» первым делом
   нужно прочитать, в «Архиве» — вернуть из архива, в личных — открыть
   профиль или закрыть переписку, в группах — управление и выход. -- */

interface ChatAction {
  icon: any;
  label: string;
  fn: () => void;
  danger?: boolean;
  /** Кнопка на месте, но сейчас ничего не изменит. */
  idle?: boolean;
}

const ChatCtxMenu = ({ chatId, segment, anchor, onClose, onManage }: {
  chatId: string;
  segment: Filter;
  anchor: { x: number; y: number; width: number; top: number; height: number };
  onClose: () => void;
  onManage: (chatId: string) => void;
}) => {
  const { chats, messages, pinChat, muteChat, archiveChat, markRead, markUnread, leaveChat, deleteChatForAll } = useMessengerStore();
  const chat = chats.find(c => c.id === chatId);
  // Сколько в чате действительно непрочитанного — по нему решаем, какая
  // из двух кнопок сейчас что-то меняет.
  const unreadCount = useMemo(
    () => messages.filter(m => m.chatId === chatId && !m.fromMe && m.status !== 'read').length,
    [messages, chatId]);
  const myId = useAuthStore(st => st.currentUserId);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  if (!chat) return null;

  const isDirect = chat.type === 'direct';
  const isOwner  = chat.ownerId === myId;
  const runsChat = ['owner', 'admin', 'moderator'].includes(chat.myRole ?? 'member');
  const peerId   = isDirect ? chat.participants?.find(p => p !== myId) : undefined;

  const act = (fn: () => void) => () => { fn(); onClose(); };

  /* Общие для всех сегментов действия. */
  const pin: ChatAction = {
    icon: Pin, label: chat.pinned ? 'Открепить' : 'Закрепить', fn: act(() => pinChat(chatId)),
  };
  const sound: ChatAction = {
    icon: chat.muted ? Bell : BellOff,
    label: chat.muted ? 'Включить уведомления' : 'Отключить уведомления',
    fn: act(() => muteChat(chatId)),
  };
  const marked = Boolean(chat.markedUnread);
  const read: ChatAction = {
    icon: CheckCheck, label: 'Прочитать', fn: act(() => markRead(chatId)),
    idle: unreadCount === 0 && !marked,
  };
  const unread: ChatAction = {
    icon: MessageSquareDot, label: 'Пометить как новое', fn: act(() => markUnread(chatId)),
    idle: marked,
  };
  const toArchive: ChatAction = {
    icon: Archive, label: 'Архивировать', fn: act(() => archiveChat(chatId)),
  };
  const fromArchive: ChatAction = {
    icon: ArchiveRestore, label: 'Вернуть из архива', fn: act(() => archiveChat(chatId)),
  };
  const manage: ChatAction = {
    icon: Shield,
    label: chat.type === 'channel' ? 'Управление каналом' : 'Управление группой',
    fn: act(() => onManage(chatId)),
  };
  const profile: ChatAction = {
    icon: UserPlus, label: 'Открыть профиль', fn: act(() => { if (peerId) openProfile(peerId); }),
  };
  // Владелец группы или канала только удаляет чат у всех (с корзиной);
  // остальные уходят из него. В личном чате есть оба действия.
  const remove: ChatAction = {
    icon: Trash2,
    label: isDirect ? 'Убрать переписку у себя' : isOwner ? 'Удалить у всех' : 'Выйти из чата',
    danger: true,
    fn: () => (isOwner && !isDirect ? setConfirmTrash(true) : setConfirmLeave(true)),
  };
  const removeBoth: ChatAction = {
    icon: Trash2, label: 'Удалить у обоих', danger: true, fn: () => setConfirmTrash(true),
  };

  /* Свой набор на каждый сегмент. */
  const items: ChatAction[] =
      segment === 'archived' ? [fromArchive, pin, sound, read, unread, remove, ...(isDirect ? [removeBoth] : [])]
    : segment === 'unread'   ? [read, unread, pin, sound, toArchive, remove, ...(isDirect ? [removeBoth] : [])]
    : segment === 'direct'   ? [profile, pin, sound, read, unread, toArchive, remove, removeBoth]
    : segment === 'group'    ? [...(runsChat ? [manage] : []), pin, sound,
                                read, unread, toArchive, remove]
    : [pin, sound, read, unread, toArchive,
       ...(!isDirect && runsChat ? [manage] : []), remove, ...(isDirect ? [removeBoth] : [])];

  /* Размещение: меню под превью чата, а если внизу не помещается — над ним. */
  const vw = typeof window === 'undefined' ? 380 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 700 : window.innerHeight;
  const menuH = items.length * 46 + 16;
  const cardW = Math.min(anchor.width || vw - 24, vw - 24);
  const cardLeft = Math.max(12, Math.min(anchor.x, vw - cardW - 12));
  const below = anchor.top + anchor.height + 8;
  const fitsBelow = below + menuH < vh - 12;
  const menuTop = fitsBelow ? below : Math.max(12, anchor.top - menuH - 8);
  const cardTop = fitsBelow
    ? Math.min(anchor.top, vh - menuH - anchor.height - 24)
    : Math.max(12, menuTop + menuH + 8);

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60]"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }}>

      {/* Сам чат — чтобы было видно, над чем действия */}
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="fixed overflow-hidden rounded-2xl"
        style={{ left: cardLeft, top: cardTop, width: cardW,
                 background: 'var(--bg-l2)', boxShadow: '0 18px 50px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3">
          <TgAvatar chat={chat} size={46} />
          <div className="min-w-0 flex-1">
            <p translate="no" className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{chat.name}{chat.type !== 'direct' && <VerifiedBadge type={chat.type === 'channel' ? 'chat_channel' : 'chat_group'} id={chat.id} size={13} />}</p>
            <p className="truncate text-xs" style={{ color: 'var(--t3)' }}>
              {isDirect ? (chat.username ? `@${chat.username}` : 'Личная переписка')
                        : `${chat.members ?? chat.participants?.length ?? 0} участников`}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Кнопки */}
      <motion.div initial={{ scale: 0.94, opacity: 0, y: fitsBelow ? -8 : 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className="fixed overflow-hidden rounded-2xl py-1.5"
        style={{ left: cardLeft, top: menuTop, width: Math.min(cardW, 300),
                 background: 'var(--bg-l3)', border: '1px solid var(--border-m)',
                 boxShadow: '0 18px 50px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>
        {items.map(item => (
          <button key={item.label} type="button" onClick={item.fn} disabled={item.idle}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/5 disabled:hover:bg-transparent"
            style={{ color: item.danger ? 'var(--red)' : 'var(--t1)', opacity: item.idle ? 0.38 : 1,
                     cursor: item.idle ? 'default' : 'pointer' }}>
            <item.icon size={16} style={{ color: item.danger ? 'var(--red)' : 'var(--t2)' }} />
            {item.label}
          </button>
        ))}
      </motion.div>

      {/* Выход из чата спрашивается отдельно: отменить его нельзя */}
      <AnimatePresence>
        {confirmLeave && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }} onClick={e => { e.stopPropagation(); setConfirmLeave(false); }}>
            <div className="w-full max-w-xs rounded-2xl p-5"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}
              onClick={e => e.stopPropagation()}>
              <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--t1)' }}>
                {isDirect ? 'Убрать переписку у себя?' : 'Выйти из чата?'}
              </p>
              <p className="mb-4 text-xs" style={{ color: 'var(--t2)' }}>
                {isDirect ? 'У собеседника переписка останется. Написав снова, вы её вернёте.'
                  : 'Вернуться можно будет по приглашению.'}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmLeave(false)}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold"
                  style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
                <button type="button" onClick={() => { leaveChat(chatId); setConfirmLeave(false); onClose(); }}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold text-white"
                  style={{ background: 'var(--red)' }}>
                  {isDirect ? 'Убрать' : 'Выйти'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Удаление у всех: чат уходит в корзину */}
      <AnimatePresence>
        {confirmTrash && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }} onClick={e => { e.stopPropagation(); setConfirmTrash(false); }}>
            <div className="w-full max-w-xs rounded-2xl p-5"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}
              onClick={e => e.stopPropagation()}>
              <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--t1)' }}>
                {isDirect ? 'Удалить переписку у обоих?' : 'Удалить чат у всех?'}
              </p>
              <p className="mb-4 text-xs" style={{ color: 'var(--t2)' }}>
                {isDirect
                  ? 'Переписка исчезнет и у вас, и у собеседника. Вернуть её сможете вы оба из «Корзины» в любой момент: переписка сохраняется на сервере.'
                  : 'Чат исчезнет у всех участников. Вернуть его можно из «Корзины» в любой момент: переписка сохраняется на сервере.'}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmTrash(false)}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold"
                  style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
                <button type="button" onClick={() => { setConfirmTrash(false); onClose(); requestDelete({ id: `chat:${chatId}`, title: chats.find((c) => c.id === chatId)?.name ?? '', noun: 'чат', confirmed: true, run: async () => { deleteChatForAll(chatId); } }); }}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold text-white"
                  style={{ background: 'var(--red)' }}>Удалить</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
};

/* ===================================================================
   Корзина: удалённые у всех чаты, переписка сохраняется
=================================================================== */
const TrashList = () => {
  const items = useTrashStore(s => s.items);
  const loaded = useTrashStore(s => s.loaded);
  const restoreChat = useMessengerStore(s => s.restoreChat);
  return (
    <div className="px-3 py-2">
      <p className="mb-2 px-1 text-[11px]" style={{ color: 'var(--t2)' }}>
        Удалённые чаты и их переписка сохраняются, пока вы их не восстановите.
      </p>
      {loaded && items.length === 0 && (
        <p className="py-12 text-center text-sm" style={{ color: 'var(--t2)' }}>Корзина пуста</p>
      )}
      {items.map(c => (
        <div key={c.id} className="mb-1.5 flex items-center gap-3 rounded-2xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}><span translate="no">{c.name}</span></p>
            <p className="text-[11px]" style={{ color: 'var(--t2)' }}>{`Удалён ${new Date(c.trashedAt).toLocaleDateString()}`}</p>
          </div>
          {c.canRestore
            ? <button type="button" onClick={() => restoreChat(c.id)}
                className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>Восстановить</button>
            : <span className="shrink-0 text-[10px]" style={{ color: 'var(--t3, var(--t2))' }}>Вернёт владелец</span>}
        </div>
      ))}
    </div>
  );
};

/* ===================================================================
   ChatList
=================================================================== */
type Filter = 'all' | 'unread' | 'direct' | 'group' | 'archived' | 'trash';

export const ChatList = () => {
  const { chats, messages, activeChatId, setActiveChat, markRead, loadTrash } = useMessengerStore();
  const connected = useMessengerStore(s => s.connected);
  // accounts здесь только для косметики профиля (рамки, оформление);
  // поиск людей идёт на сервере.
  const { currentUserId, accounts } = useAuthStore();
  const { isBlocked: isChannelBlocked } = useModerationStore();
  const gamingActivity = useGamingAccounts(s => s.activity);
  const [search, setSearch]     = useState('');
  const [peopleQ, setPeopleQ]   = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNew, setShowNew]   = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [filter, setFilter]     = useState<Filter>('all');
  const [ctx, setCtx] = useState<
    { id: string; x: number; y: number; width: number; top: number; height: number } | null>(null);
  // Удержание: на телефоне правой кнопки нет, а меню нужно.
  const holdTimer = useRef<number | null>(null);
  const holdFrom  = useRef<{ x: number; y: number } | null>(null);
  const cancelHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    holdFrom.current = null;
  };
  const openMenuFor = (el: HTMLElement, id: string) => {
    const r = el.getBoundingClientRect();
    setCtx({ id, x: r.left, y: r.top, width: r.width, top: r.top, height: r.height });
    // Короткий отклик — как в системных меню удержания.
    try { navigator.vibrate?.(12); } catch { /* не поддерживается */ }
  };
  useEffect(() => cancelHold, []);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (showSearch) searchRef.current?.focus(); }, [showSearch]);

  const lastMsgMap = useMemo(() => {
    const map: Record<string, MessageItem> = {};
    for (const m of messages) { const p = map[m.chatId]; if (!p || m.timestamp > p.timestamp) map[m.chatId] = m; }
    return map;
  }, [messages]);

  const unreadMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of messages) if (!m.fromMe && m.status !== 'read') map[m.chatId] = (map[m.chatId] ?? 0) + 1;
    // Помеченный вручную считается непрочитанным, даже если новых
    // сообщений в нём нет: иначе «пометить как новое» ничего не меняло бы.
    for (const c of chats) if (c.markedUnread && !map[c.id]) map[c.id] = 1;
    return map;
  }, [messages, chats]);

  const totalUnread = Object.values(unreadMap).reduce((s, n) => s + n, 0);

  // Рамки и стиль строки у собеседников: данные на сервере, подтягиваем для всех личных чатов.
  usePeerCosmetics(chats.filter(c => c.type === 'direct').slice(0, 120).map(c => c.participants?.find(p => p !== currentUserId)));
  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return [...chats]
      .filter(c => {
        // Архив — отдельный сегмент. Раньше архивные отсеивались из всех
        // фильтров, а вкладки для них не было: чат исчезал навсегда.
        if (filter === 'trash') return false;
        if (filter === 'archived') return Boolean(c.archived);
        if (c.archived) return false;
        if (filter === 'unread')  return (unreadMap[c.id] ?? 0) > 0;
        if (filter === 'direct')  return c.type === 'direct';
        if (filter === 'group')   return c.type === 'group' || c.type === 'channel';
        return true;
      })
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (lastMsgMap[b.id]?.timestamp ?? 0) - (lastMsgMap[a.id]?.timestamp ?? 0);
      });
  }, [chats, search, filter, lastMsgMap, unreadMap]);

  // Поиск идёт на сервере — в браузере списка всех пользователей нет
  // и быть не должно.
  const { people: searched, loading: searching } = usePeopleSearch(peopleQ);
  const foundPeople = useMemo(
    () => searched.filter(u => u.id !== currentUserId).slice(0, 8),
    [searched, currentUserId],
  );

  const archivedCount = chats.filter(c => c.archived).length;
  // Вкладка архива показывается, только когда в нём что-то лежит:
  // пустой сегмент в списке только мешает.
  const FILTERS: [Filter, string][] = [
    ['all', 'Все'], ['unread', 'Непрочит.'], ['direct', 'Личные'], ['group', 'Группы'],
    ...(archivedCount > 0 ? [['archived', 'Архив'] as [Filter, string]] : []),
    ['trash', 'Корзина'],
  ];

  return (
    <aside className="flex w-full flex-col shrink-0 border-r overflow-hidden sm:w-[340px]"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>

      {/* Top bar */}
      <div className="flex items-center gap-1.5 px-4 pb-3 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}>
        <AnimatePresence mode="wait">
          {showSearch ? (
            <motion.div key="s" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }} className="flex flex-1 items-center gap-2 rounded-2xl px-3 py-2.5"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <Search size={14} style={{ color: 'var(--t2)' }} />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Поиск..." className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--t1)' }} />
              {search && <button type="button" onClick={() => setSearch('')} style={{ color: 'var(--t2)' }}><X size={13} /></button>}
            </motion.div>
          ) : (
            <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex items-center gap-2">
              <h1 className="text-[18px] font-bold tracking-tight" style={{ color: 'var(--t1)' }}>Сообщения</h1>
              {/* Пока связи нет, отправленное лежит в очереди — об этом
                  лучше сказать прямо, чем показывать вечную «галочку». */}
              {!connected && (
                <span className="text-[10px] font-medium rounded-full px-2 py-0.5"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t2)' }}>нет связи</span>
              )}
              {totalUnread > 0 && (
                <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
                  style={{ background: 'var(--accent)', color: '#fff', minWidth: 20, textAlign: 'center' }}>
                  {totalUnread}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <button type="button"
          onClick={() => { setShowSearch(s => !s); if (showSearch) { setSearch(''); setPeopleQ(''); } }}
          className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0"
          style={{ color: showSearch ? '#5b9bd1' : 'var(--t2)' }}>
          {showSearch ? <X size={17} /> : <Search size={17} />}
        </button>
        <button type="button" onClick={() => setShowFavorites(true)}
          className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0"
          style={{ color: 'var(--t2)' }}>
          <Star size={17} />
        </button>
        <button type="button" onClick={() => setShowNew(true)}
          className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0"
          style={{ color: 'var(--t2)' }}>
          <Edit size={17} />
        </button>
      </div>

      {/* People search */}
      <AnimatePresence>
        {showSearch && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-3 pb-2 shrink-0">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-1" style={{ background: 'var(--bg-l2)' }}>
              <UserPlus size={13} style={{ color: 'var(--t2)' }} />
              <input value={peopleQ} onChange={e => setPeopleQ(e.target.value)} placeholder="Найти @username..."
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--t1)' }} />
              {peopleQ && <button type="button" onClick={() => setPeopleQ('')} style={{ color: 'var(--t2)' }}><X size={12} /></button>}
            </div>
            <AnimatePresence>
              {foundPeople.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                  {foundPeople.map(u => (
                    <button key={u.id} type="button"
                      onClick={() => { const c = useMessengerStore.getState().startDM(u); if (c) broadcast.newChat(c); setShowSearch(false); setPeopleQ(''); }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                        style={{ background: avatarColor(u.name) }}
                        onClick={e => { e.stopPropagation(); openProfile(u.id); }}>{u.name[0]}</div>
                      <div className="flex-1 min-w-0 text-left">
                        <p translate="no" className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>{u.name}</p>
                        <p className="text-xs" style={{ color: 'var(--t2)' }}>@{u.username}</p>
                      </div>
                      <ChevronRight size={13} style={{ color: 'var(--accent)' }} />
                    </button>
                  ))}
                </motion.div>
              )}
              {peopleQ.trim().length >= 2 && foundPeople.length === 0 && (
                <p className="py-2 text-center text-xs" style={{ color: 'var(--t2)' }}>
                  {searching ? 'Ищем…' : 'Не найдено'}
                </p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter tabs */}
      <div className="flex gap-1.5 px-3 pb-2.5 shrink-0 overflow-x-auto scroll-none">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setFilter(k); if (k === 'trash') loadTrash(); }}
            className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition-all"
            style={{
              background: filter === k ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)',
              color: filter === k ? 'var(--accent)' : 'var(--t2)',
              border: `1px solid ${filter === k ? 'rgba(79,110,247,0.35)' : 'var(--border)'}`,
            }}>
            {l}{k === 'unread' && totalUnread > 0 ? ` · ${totalUnread}` : ''}
          </button>
        ))}
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }} onClick={() => setCtx(null)}>
        {filter === 'trash' && <TrashList />}
        {filter !== 'trash' && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <p className="text-sm" style={{ color: 'var(--t2)' }}>
              {search ? 'Ничего не найдено' : 'Нет чатов'}
            </p>
          </div>
        )}

        {filter !== 'trash' && visible.map(chat => {
          const last   = lastMsgMap[chat.id];
          const unread = unreadMap[chat.id] ?? 0;
          const active = activeChatId === chat.id;
          const peerId  = chat.type === 'direct' ? chat.participants?.find(p => p !== currentUserId) : undefined;
          const peerAcc = peerId ? accounts.find(a => a.id === peerId) : undefined;
          const peerFrame = peerAcc ? activeFrame(peerAcc) : undefined;
          const peerStyle = peerAcc ? activeChatListStyle(peerAcc) : undefined;

          return (
            <button key={chat.id} type="button"
              onClick={() => {
                // После удержания палец отрывается «щелчком» — открывать
                // при этом чат нельзя, иначе меню мигнёт и исчезнет.
                if (ctx) return;
                setActiveChat(chat.id); markRead(chat.id);
              }}
              onContextMenu={e => { e.preventDefault(); openMenuFor(e.currentTarget, chat.id); }}
              onTouchStart={e => {
                const t = e.touches[0];
                holdFrom.current = { x: t.clientX, y: t.clientY };
                const el = e.currentTarget;
                holdTimer.current = window.setTimeout(() => openMenuFor(el, chat.id), 450);
              }}
              onTouchMove={e => {
                // Палец поехал — это прокрутка, а не удержание.
                const t = e.touches[0]; const from = holdFrom.current;
                if (!from) return;
                if (Math.abs(t.clientX - from.x) > 10 || Math.abs(t.clientY - from.y) > 10) cancelHold();
              }}
              onTouchEnd={cancelHold}
              onTouchCancel={cancelHold}
              className="flex w-full items-center gap-3 px-4 py-3 transition-colors relative"
              style={{
                background: active ? 'var(--accent-bg)' : (peerStyle?.background ?? 'transparent'),
                border: peerStyle?.border, boxShadow: peerStyle?.glow,
                borderRadius: peerStyle?.border ? 14 : 0,
                margin: peerStyle?.border ? '2px 6px' : undefined,
              }}>
              {active && <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: 'var(--accent)' }}/>}
              {peerStyle?.leftBar && (
                <motion.div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full" style={{ background: peerStyle.leftBar }}
                  animate={peerStyle.animated ? { opacity: [0.6, 1, 0.6] } : undefined} transition={{ duration: 1.8, repeat: Infinity }} />
              )}

              <TgAvatar chat={chat} size={52} frame={peerFrame}
                onClick={chat.type === 'direct' ? (e) => {
                  e.stopPropagation();
                  if (peerId) openProfile(peerId);
                } : undefined} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {peerStyle?.badge && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold"
                        style={{ background: 'linear-gradient(135deg,#ffd66b,#f5a623)', color: '#000' }}>{peerStyle.badge}</span>
                    )}
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--t1)' }}>
                      <span translate="no">{chat.name}</span>
                    </span>
                    {chat.muted  && <BellOff size={12} style={{ color: 'var(--t2)', flexShrink: 0 }} />}
                    {chat.pinned && <Pin size={11} style={{ color: 'var(--t2)', flexShrink: 0 }} />}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {last && <MsgStatus msg={last} />}
                    <span className="text-[11px]" style={{ color: unread > 0 && !chat.muted ? '#5b9bd1' : 'var(--t2)' }}>
                      {last ? fmtTime(last.timestamp) : ''}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs truncate leading-snug" style={{ color: peerId && gamingActivity[peerId]?.isPlaying ? '#22c55e' : 'var(--t2)' }}>
                    {peerId && gamingActivity[peerId]?.isPlaying ? (
                      <>Играет в {gamingActivity[peerId]!.gameIcon} {gamingActivity[peerId]!.gameName}</>
                    ) : chat.type === 'channel' && isChannelBlocked('messenger-channel', chat.id) ? (
                      <span className="inline-flex items-center gap-1" style={{ color: '#ef4444' }}>
                        <Ban size={11}/> Канал заблокирован модерацией
                      </span>
                    ) : (
                      <>
                        {last?.fromMe && last.kind !== 'system' && (
                          <span style={{ color: active ? '#93c5fd' : 'var(--accent)' }}>Вы: </span>
                        )}
                        <span translate={last && !last.deleted && (last.kind === 'text' || !last.kind) ? 'no' : undefined}>{preview(last)}</span>
                      </>
                    )}
                  </p>
                  {unread > 0 && (
                    <span className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: chat.muted ? 'var(--t3)' : 'var(--accent)', minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10 }}>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {showNew && <NewChatModal onClose={() => setShowNew(false)} />}
        {ctx && (
          <ChatCtxMenu chatId={ctx.id} segment={filter} anchor={ctx}
            onClose={() => setCtx(null)}
            onManage={(id) => { setActiveChat(id); useAdminStore.getState().openManage(id); }} />
        )}
        {showFavorites && <FavoritesModal onClose={() => setShowFavorites(false)} />}
    </AnimatePresence>
    </aside>
  );
};

/* -- Избранные сообщения (across all chats) -------------------------- */
const FavoritesModal = ({ onClose }: { onClose: () => void }) => {
  const { messages, chats, toggleFavoriteMessage, setActiveChat } = useMessengerStore();
  const favorites = useMemo(() =>
    messages.filter(m => m.favorited && !m.deleted).sort((a, b) => b.timestamp - a.timestamp),
    [messages]);

  return (
    <motion.div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        className="w-full sm:w-[420px] sm:max-h-[70vh] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', maxHeight: '80vh' }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <Star size={17} style={{ color: 'var(--accent)' }} />
          <p className="flex-1 font-bold text-[16px]" style={{ color: 'var(--t1)' }}>Избранное</p>
          <button type="button" onClick={onClose} style={{ color: 'var(--t2)' }}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {favorites.length === 0 ? (
            <p className="text-xs text-center py-10" style={{ color: 'var(--t3)' }}>
              Здесь появятся сообщения, отмеченные звёздочкой из любого чата
            </p>
          ) : favorites.map(m => {
            const chat = chats.find(c => c.id === m.chatId);
            return (
              <button key={m.id} type="button"
                onClick={() => { setActiveChat(m.chatId); onClose(); }}
                className="w-full text-left rounded-2xl p-3 transition-colors hover:bg-white/5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>{chat?.name ?? 'Чат'}</p>
                  <button type="button" onClick={e => { e.stopPropagation(); toggleFavoriteMessage(m.id); }}>
                    <Star size={13} fill="currentColor" style={{ color: 'var(--accent)' }} />
                  </button>
                </div>
                <p className="text-sm truncate" style={{ color: 'var(--t1)' }}>{m.text || preview(m)}</p>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
};
