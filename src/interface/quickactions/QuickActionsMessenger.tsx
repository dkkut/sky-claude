/* ===========================================================
   PC Quick Actions — вкладка «Сообщения»: список чатов + быстрый
   текстовый ответ. Тот же реальный useMessengerStore, что и в обычном
   мессенджере — у overlay своё соединение (звука тут нет, поэтому
   ретранслировать через основное окно незачем, см. playerBridge.ts).
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Send, Users, ChevronLeft } from 'lucide-react';
import { useMessengerStore } from '@/messenger/store';
import type { ChatItem, MessageKind } from '@/messenger/types';

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  photo: '📷 Фото', voice: '🎤 Голосовое', 'video-note': '⚫ Видео', file: '📎 Файл',
  gift: '🎁 Подарок', prime_gift: '🎁 Подарок', poll: '📊 Опрос', location: '📍 Геопозиция',
};

const ChatThread = ({ chat, onBack }: { chat: ChatItem; onBack: () => void }) => {
  const allMessages = useMessengerStore(s => s.messages);
  const sendMessage = useMessengerStore(s => s.sendMessage);
  const setActiveChat = useMessengerStore(s => s.setActiveChat);
  const markRead = useMessengerStore(s => s.markRead);
  const [draft, setDraft] = useState('');

  useEffect(() => { setActiveChat(chat.id); markRead(chat.id); }, [chat.id, setActiveChat, markRead]);

  const thread = useMemo(() => allMessages.filter(m => m.chatId === chat.id && !m.deleted).slice(-8), [allMessages, chat.id]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage({ text });
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center gap-2 shrink-0">
        <button type="button" onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <ChevronLeft size={16} color="#fff" />
        </button>
        <p className="truncate text-[14px] font-bold text-white">{chat.name}</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl p-2 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {thread.length === 0 && <p className="text-center text-[12px] py-4" style={{ color: 'rgba(255,255,255,0.4)' }}>Сообщений пока нет</p>}
        {thread.map(m => (
          <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-1.5 text-[13px] ${m.fromMe ? 'self-end' : 'self-start'}`}
            style={{ background: m.fromMe ? 'var(--accent)' : 'rgba(255,255,255,0.08)', color: '#fff' }}>
            {m.kind === 'text' ? m.text : (KIND_LABEL[m.kind] ?? 'Сообщение')}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 shrink-0">
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="Быстрый ответ…" className="flex-1 rounded-xl px-3 py-2 text-[13px] text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }} />
        <button type="button" onClick={send} disabled={!draft.trim()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: draft.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.08)' }}>
          <Send size={15} color="#fff" />
        </button>
      </div>
    </div>
  );
};

export const QuickActionsMessenger = () => {
  const chats = useMessengerStore(s => s.chats);
  const allMessages = useMessengerStore(s => s.messages);
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const withLast = chats.filter(c => !c.archived).map(c => ({ chat: c, last: allMessages.filter(m => m.chatId === c.id).slice(-1)[0] }));
    return withLast.sort((a, b) => {
      if (!!a.chat.pinned !== !!b.chat.pinned) return a.chat.pinned ? -1 : 1;
      return (b.last?.timestamp ?? 0) - (a.last?.timestamp ?? 0);
    }).map(x => x.chat);
  }, [chats, allMessages]);

  const openChat = openId ? chats.find(c => c.id === openId) : null;
  if (openChat) return <ChatThread chat={openChat} onBack={() => setOpenId(null)} />;

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <MessageCircle size={32} color="rgba(255,255,255,0.3)" />
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Чатов пока нет</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {sorted.slice(0, 10).map(c => {
        const last = allMessages.filter(m => m.chatId === c.id).slice(-1)[0];
        const unread = last && !last.fromMe && last.status !== 'read';
        const preview = last ? (last.kind === 'text' ? last.text : (KIND_LABEL[last.kind] ?? 'Сообщение')) : 'Нет сообщений';
        return (
          <button key={c.id} type="button" onClick={() => setOpenId(c.id)}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left">
            <div className="relative h-10 w-10 shrink-0 rounded-full overflow-hidden"
              style={{ background: c.avatar ? `center/cover no-repeat url(${c.avatar})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
              {!c.avatar && <div className="grid h-full w-full place-items-center">{c.type === 'direct' ? <MessageCircle size={14} color="#fff" /> : <Users size={14} color="#fff" />}</div>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-white">{c.name}</p>
              <p className="truncate text-[12px]" style={{ color: unread ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: unread ? 700 : 400 }}>{preview}</p>
            </div>
            {unread && <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />}
          </button>
        );
      })}
    </div>
  );
};
