import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle, Phone, Video, UserPlus, UserCheck, UserX, UserRoundCheck,
  Bell, Gift as GiftIcon, Users, Radio, Share2, Link2, Flag, Ban, EyeOff, Eye,
  MoreHorizontal, X,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useCallStore } from '@/calls/store';
import { useBloomStore } from '@/bloom/store';
import { useModuleStore } from '@/data/state/modules';
import { useSocialGraph } from '../social';
import { useProfileViewer } from '../store';
import type { ProfileData } from '../useProfileData';
import { GiftModal, type GiftModalProps } from '@/gifts/SkyGifts';
import { ReportProfileSheet, InviteToChatSheet } from '../ActionSheets';
import type { IconComponent } from '@/shared/icon';
import { shareOrigin } from '@/core/nativeApp';

const Pill = ({ icon: Icon, label, onClick, tone, primary }: {
  icon: IconComponent; label: string; onClick: () => void; tone?: string; primary?: boolean;
}) => (
  <button type="button" onClick={onClick}
    className="flex flex-col items-center gap-1 sm:gap-1.5 shrink-0 sky-hover-lift"
    style={{ minWidth: 56 }}>
    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center"
      style={{
        background: primary ? 'var(--accent)' : 'var(--bg-l2)',
        color: primary ? '#fff' : (tone ?? 'var(--t1)'),
      }}>
      <Icon size={17} />
    </div>
    <span className="text-[10px] sm:text-[11px] font-medium text-center leading-tight" style={{ color: tone ?? 'var(--t2)' }}>{label}</span>
  </button>
);

const Row = ({ icon: Icon, label, onClick, danger }: {
  icon: IconComponent; label: string; onClick: () => void; danger?: boolean;
}) => (
  <button type="button" onClick={onClick}
    className="w-full flex items-center gap-3 px-4 py-3 sky-hover-lift text-left">
    <Icon size={18} style={{ color: danger ? 'var(--red)' : 'var(--t2)' }} />
    <span className="text-sm font-medium" style={{ color: danger ? 'var(--red)' : 'var(--t1)' }}>{label}</span>
  </button>
);

export const QuickActionsBar = ({ data, onEdit }: { data: ProfileData; onEdit?: () => void }) => {
  const { currentUserId } = useAuthStore();
  const startDM = useMessengerStore(s => s.startDM);
  const blockUser = useMessengerStore(s => s.blockUser);
  const blocked = useMessengerStore(s => s.blocked);
  const startCall = useCallStore(s => s.startCall);
  const toggleHide = useBloomStore(s => s.toggleHide);
  const { sendFriendRequest, removeFriend, toggleFollow } = useSocialGraph();
  const close = useProfileViewer(s => s.close);

  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<'gift' | 'inviteGroup' | 'inviteChannel' | 'report' | null>(null);

  if (!data.account) return null;
  const acc = data.account;

  const goToChat = () => {
    startDM(acc);
    close();
    // Открыть чат — значит реально его показать, а не просто завести
    // запись в сторе: без переключения модуля человек остаётся там, где
    // был (например, в Bloom), и решает, что кнопка ничего не сделала.
    useModuleStore.getState().setActiveModule('messages');
  };

  const isBlocked = blocked.includes(acc.username);

  if (data.isOwn) {
    return (
      <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
        <Pill icon={Share2} label="Поделиться" onClick={() => shareProfile(acc.id, acc.name)} />
        <Pill icon={Link2} label="Скопировать" onClick={() => copyProfileLink(acc.id)} />
        {onEdit && <Pill icon={UserRoundCheck} label="Редактировать" onClick={onEdit} primary />}
      </div>
    );
  }

  const friendAction = () => {
    if (!currentUserId) return;
    if (data.relationship.friendStatus === 'friends') removeFriend(currentUserId, acc.id);
    else sendFriendRequest(currentUserId, acc.id);
  };
  const friendLabel =
    data.relationship.friendStatus === 'friends' ? 'Удалить из друзей' :
    data.relationship.friendStatus === 'pending_out' ? 'Заявка отправлена' :
    data.relationship.friendStatus === 'pending_in' ? 'Принять заявку' : 'Добавить в друзья';
  const FriendIcon =
    data.relationship.friendStatus === 'friends' ? UserX :
    data.relationship.friendStatus === 'pending_in' ? UserCheck : UserPlus;

  return (
    <>
      <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
        <Pill icon={MessageCircle} label="Написать" onClick={goToChat} primary />
        <Pill icon={Phone} label="Позвонить" onClick={() => { startCall(acc.id, acc.name, acc.avatar ?? acc.name[0], 'voice'); close(); }} />
        <Pill icon={Video} label="Видео" onClick={() => { startCall(acc.id, acc.name, acc.avatar ?? acc.name[0], 'video'); close(); }} />
        <Pill icon={FriendIcon} label={friendLabel} onClick={friendAction}
          tone={data.relationship.friendStatus === 'friends' ? 'var(--red)' : undefined} />
        <Pill icon={data.relationship.isFollowing ? Bell : UserPlus} label={data.relationship.isFollowing ? 'Подписан' : 'Подписаться'}
          onClick={() => currentUserId && toggleFollow(currentUserId, acc.id)}
          tone={data.relationship.isFollowing ? 'var(--accent)' : undefined} />
        <Pill icon={GiftIcon} label="Подарок" onClick={() => setSheet('gift')} />
        <Pill icon={MoreHorizontal} label="Ещё" onClick={() => setMore(true)} />
      </div>

      <AnimatePresence>
        {more && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10010] flex items-end sm:items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setMore(false)}>
            <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              onClick={e => e.stopPropagation()}
              className="w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl overflow-hidden"
              style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="font-bold text-base" style={{ color: 'var(--t1)' }}>Ещё</h3>
                <button type="button" onClick={() => setMore(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-l2)' }}>
                  <X size={16} style={{ color: 'var(--t2)' }} />
                </button>
              </div>
              <div className="py-1">
                <Row icon={Users} label="Пригласить в группу" onClick={() => { setMore(false); setSheet('inviteGroup'); }} />
                <Row icon={Radio} label="Пригласить в канал" onClick={() => { setMore(false); setSheet('inviteChannel'); }} />
                <Row icon={Share2} label="Поделиться профилем" onClick={() => { setMore(false); shareProfile(acc.id, acc.name); }} />
                <Row icon={Link2} label="Скопировать ссылку" onClick={() => { setMore(false); copyProfileLink(acc.id); }} />
                <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
                <Row icon={data.relationship.isHidden ? Eye : EyeOff} label={data.relationship.isHidden ? 'Показывать публикации' : 'Скрыть пользователя'}
                  onClick={() => { toggleHide(acc.id); setMore(false); }} />
                <Row icon={Flag} label="Пожаловаться" onClick={() => { setMore(false); setSheet('report'); }} danger />
                <Row icon={Ban} label={isBlocked ? 'Разблокировать' : 'Заблокировать'} onClick={() => { blockUser(acc.username); setMore(false); }} danger />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {sheet === 'gift' && (
        <GiftModalLauncher acc={acc} onClose={() => setSheet(null)} />
      )}
      {sheet === 'inviteGroup' && <InviteToChatSheet targetId={acc.id} targetName={acc.name} kind="group" onClose={() => setSheet(null)} />}
      {sheet === 'inviteChannel' && <InviteToChatSheet targetId={acc.id} targetName={acc.name} kind="channel" onClose={() => setSheet(null)} />}
      {sheet === 'report' && <ReportProfileSheet targetId={acc.id} targetName={acc.name} onClose={() => setSheet(null)} />}
    </>
  );
};

/** Гарантирует существование чата с получателем и открывает модалку отправки подарка. */
const GiftModalLauncher = ({ acc, onClose }: { acc: NonNullable<ProfileData['account']>; onClose: () => void }) => {
  const startDM = useMessengerStore(s => s.startDM);
  const [chatId, setChatId] = useState<string | null>(null);

  // startDM изменяет стор — вызываем это в эффекте, а не во время рендера.
  useEffect(() => {
    const chat = startDM(acc);
    setChatId(chat?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc.id]);

  if (!chatId) return null;
  const props: GiftModalProps = { chatId, toUserId: acc.id, toName: acc.name, onClose, onSent: () => {} };
  return <GiftModal {...props} />;
};

function shareProfile(userId: string, name: string) {
  const url = `${shareOrigin()}/u/${userId}`;
  if (typeof navigator !== 'undefined' && navigator.share) {
    navigator.share({ title: `Профиль ${name} в Sky`, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).catch(() => {});
  }
}
function copyProfileLink(userId: string) {
  const url = `${shareOrigin()}/u/${userId}`;
  navigator.clipboard.writeText(url).catch(() => {});
}
