/* ===========================================================
   SKY CAR — Сообщения. Настоящий мессенджер (useMessengerStore):
   читать и отвечать готовыми фразами одним нажатием. Свободного
   набора текста, медиа и эмодзи здесь нет намеренно — за рулём это
   отвлечение.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Users, Send, Phone } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useCallStore } from '@/calls/store';
import { CarVoice, CarVideoNote } from './CarMedia';
import { useMessengerStore } from '@/messenger/store';
import type { ChatItem, MessageKind } from '@/messenger/types';
import { CAR_ACCENT, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  photo: 'Фото', voice: 'Голосовое', 'video-note': 'Видео', file: 'Файл', gift: 'Подарок', prime_gift: 'Подарок', poll: 'Опрос', location: 'Геопозиция',
};
const QUICK = ['Я за рулём, отвечу позже', 'Перезвоню через 10 минут', 'Хорошо', 'Не могу говорить'];

const ChatRow = ({ chat, text, unread, onOpen }: { chat: ChatItem; text: string; unread: boolean; onOpen: () => void }) => (
  <button type="button" onClick={onOpen} aria-label={chat.name} className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 100 }}>
    <span className="grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-full" style={{ background: chat.avatar ? `center/cover no-repeat url(${chat.avatar})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
      {!chat.avatar && (chat.type === 'direct' ? <MessageCircle size={30} color="#fff" /> : <Users size={30} color="#fff" />)}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[26px] font-bold text-white" translate="no">{chat.name}</span>
      <span className="block truncate text-[20px]" style={{ color: unread ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: unread ? 700 : 400 }} translate={KIND_LABEL[text as MessageKind] ? undefined : 'no'}>{text}</span>
    </span>
    {unread && <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: CAR_ACCENT }} aria-label="Непрочитанное" />}
  </button>
);

const Thread = ({ chat, onBack }: { chat: ChatItem; onBack: () => void }) => {
  const all = useMessengerStore((s) => s.messages);
  const sendMessage = useMessengerStore((s) => s.sendMessage);
  const setActiveChat = useMessengerStore((s) => s.setActiveChat);
  const markRead = useMessengerStore((s) => s.markRead);
  const [sent, setSent] = useState('');
  const myId = useAuthStore((st) => st.currentUserId);
  const startCall = useCallStore((st) => st.startCall);
  const peerId = chat.type === 'direct' ? (chat.participants?.find((p) => p !== myId) ?? chat.id) : null;
  useEffect(() => { setActiveChat(chat.id); markRead(chat.id); }, [chat.id, setActiveChat, markRead]);
  const thread = useMemo(() => all.filter((m) => m.chatId === chat.id && !m.deleted).slice(-6), [all, chat.id]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center gap-4">
        <button type="button" onClick={onBack} aria-label="Назад" className="grid h-[72px] w-[72px] place-items-center rounded-full text-[34px] font-bold text-white" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER }}>‹</button>
        <p className="min-w-0 flex-1 truncate text-[30px] font-extrabold text-white" translate="no">{chat.name}</p>
        {peerId && (
          <button type="button" onClick={() => void startCall(peerId, chat.name, chat.avatar, 'voice')} aria-label="Позвонить" className="flex shrink-0 items-center gap-3 rounded-full px-8 text-[24px] font-bold text-[#0b0b14] outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 72, background: '#34d399' }}>
            <Phone size={28} /> Позвонить
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden rounded-[32px] p-5" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
        {thread.length === 0 && <p className="text-center text-[22px] text-white/45">Сообщений пока нет</p>}
        {thread.map((m) => (
          <div key={m.id} className={`max-w-[78%] rounded-3xl px-6 py-3 text-[24px] leading-snug ${m.fromMe ? 'self-end' : 'self-start'}`} style={{ background: m.fromMe ? CAR_ACCENT : 'rgba(255,255,255,0.1)', color: '#fff' }} translate={m.kind === 'text' ? 'no' : undefined}>
            {m.kind === 'text' ? m.text : m.kind === 'voice' ? <CarVoice msg={m} /> : m.kind === 'video-note' ? <CarVideoNote msg={m} /> : (KIND_LABEL[m.kind] ?? 'Сообщение')}
          </div>
        ))}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => { sendMessage({ text: q }); setSent(q); }} className="flex items-center justify-center gap-3 rounded-3xl px-4 text-[22px] font-semibold text-white outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-violet-300"
            style={{ minHeight: 80, background: sent === q ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.12)' }}>
            <Send size={22} /> {q}
          </button>
        ))}
      </div>
    </div>
  );
};

export const CarMessenger = () => {
  const chats = useMessengerStore((s) => s.chats);
  const all = useMessengerStore((s) => s.messages);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => chats.filter((c) => !c.archived).map((c) => {
    const own = all.filter((m) => m.chatId === c.id && !m.deleted);
    const last = own[own.length - 1];
    return { chat: c, last, text: !last ? 'Нет сообщений' : last.kind === 'text' ? last.text : (KIND_LABEL[last.kind] ?? 'Сообщение'), unread: !!last && !last.fromMe && last.status !== 'read' };
  }).sort((a, b) => (!!a.chat.pinned !== !!b.chat.pinned ? (a.chat.pinned ? -1 : 1) : (b.last?.timestamp ?? 0) - (a.last?.timestamp ?? 0))), [chats, all]);

  const open = openId ? chats.find((c) => c.id === openId) : null;
  if (open) return <Thread chat={open} onBack={() => setOpenId(null)} />;
  if (rows.length === 0) {
    return <div className="flex h-full flex-col items-center justify-center gap-3"><MessageCircle size={56} color="rgba(255,255,255,0.4)" /><p className="text-[28px] font-bold text-white">Чатов пока нет</p></div>;
  }
  return (
    <div className="h-full overflow-y-auto rounded-[32px] p-3" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR, scrollbarWidth: 'none' }}>
      {rows.slice(0, 20).map((r) => <ChatRow key={r.chat.id} chat={r.chat} text={r.text} unread={r.unread} onOpen={() => setOpenId(r.chat.id)} />)}
    </div>
  );
};
