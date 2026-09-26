/* ===========================================================
   SKY CAR MODE — Сообщения.
   Список чатов и быстрый текстовый ответ через уже существующий
   useMessengerStore — тот же реальный мессенджер, второго не заводим.
   Специально нет голосового ввода/медиа/эмодзи: за рулём это лишнее
   и небезопасное отвлечение — только прочитать и коротко ответить.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Send, Users } from 'lucide-react';
import { useMessengerStore } from '@/messenger/store';
import type { ChatItem, MessageKind } from '@/messenger/types';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  photo: '📷 Фото', voice: '🎤 Голосовое', 'video-note': '⚫ Видео', file: '📎 Файл',
  gift: '🎁 Подарок', prime_gift: '🎁 Подарок', poll: '📊 Опрос', location: '📍 Геопозиция',
};

const previewOf = (chatId: string, messages: ReturnType<typeof useMessengerStore.getState>['messages']) => {
  const own = messages.filter(m => m.chatId === chatId && !m.deleted);
  const last = own[own.length - 1];
  if (!last) return { text: 'Нет сообщений', unread: false };
  const unread = !last.fromMe && last.status !== 'read';
  const text = last.kind === 'text' ? last.text : (KIND_LABEL[last.kind] ?? 'Сообщение');
  return { text, unread };
};

const ChatRow = ({ chat, preview, onOpen }: { chat: ChatItem; preview: { text: string; unread: boolean }; onOpen: () => void }) => (
  <button type="button" onClick={onOpen}
    className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.98]">
    <div className="relative h-14 w-14 shrink-0 rounded-full overflow-hidden"
      style={{ background: chat.avatar ? `center/cover no-repeat url(${chat.avatar})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
      {!chat.avatar && <div className="grid h-full w-full place-items-center">{chat.type === 'direct' ? <MessageCircle size={20} color="#fff" /> : <Users size={20} color="#fff" />}</div>}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[17px] font-bold text-white">{chat.name}</p>
      <p className="truncate text-[14px]" style={{ color: preview.unread ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: preview.unread ? 700 : 400 }}>{preview.text}</p>
    </div>
    {preview.unread && <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />}
  </button>
);

const ChatThread = ({ chat, onBack }: { chat: ChatItem; onBack: () => void }) => {
  const allMessages = useMessengerStore(s => s.messages);
  const sendMessage = useMessengerStore(s => s.sendMessage);
  const setActiveChat = useMessengerStore(s => s.setActiveChat);
  const markRead = useMessengerStore(s => s.markRead);
  const [draft, setDraft] = useState('');

  useEffect(() => { setActiveChat(chat.id); markRead(chat.id); }, [chat.id, setActiveChat, markRead]);

  const thread = useMemo(() => allMessages
    .filter(m => m.chatId === chat.id && !m.deleted)
    .slice(-12), [allMessages, chat.id]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage({ text });
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-3 shrink-0">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full text-white text-xl font-bold"
          style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>‹</button>
        <p className="text-[19px] font-extrabold text-white">{chat.name}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-3xl p-4 flex flex-col gap-2"
        style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
        {thread.length === 0 && <p className="text-center text-[14px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Сообщений пока нет</p>}
        {thread.map(m => (
          <div key={m.id} className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] ${m.fromMe ? 'self-end' : 'self-start'}`}
            style={{ background: m.fromMe ? 'var(--accent)' : 'rgba(255,255,255,0.08)', color: '#fff' }}>
            {m.kind === 'text' ? m.text : (KIND_LABEL[m.kind] ?? 'Сообщение')}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 shrink-0">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="Быстрый ответ…" className="flex-1 rounded-2xl px-5 py-4 text-[16px] text-white outline-none"
          style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }} />
        <button type="button" onClick={send} disabled={!draft.trim()}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: draft.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.08)' }}>
          <Send size={20} color="#fff" />
        </button>
      </div>
    </div>
  );
};

export const CarMessenger = () => {
  const chats = useMessengerStore(s => s.chats);
  const allMessages = useMessengerStore(s => s.messages);
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const withPreview = chats
      .filter(c => !c.archived)
      .map(c => ({ chat: c, last: allMessages.filter(m => m.chatId === c.id).slice(-1)[0] }));
    return withPreview.sort((a, b) => {
      if (!!a.chat.pinned !== !!b.chat.pinned) return a.chat.pinned ? -1 : 1;
      return (b.last?.timestamp ?? 0) - (a.last?.timestamp ?? 0);
    }).map(x => x.chat);
  }, [chats, allMessages]);

  const openChat = openId ? chats.find(c => c.id === openId) : null;
  if (openChat) return <ChatThread chat={openChat} onBack={() => setOpenId(null)} />;

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <MessageCircle size={40} color="rgba(255,255,255,0.35)" />
        <p className="text-[16px] font-bold text-white">Чатов пока нет</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
      {sorted.slice(0, 20).map(c => (
        <ChatRow key={c.id} chat={c} preview={previewOf(c.id, allMessages)} onOpen={() => setOpenId(c.id)} />
      ))}
    </div>
  );
};
