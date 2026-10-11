/* ===============================================================
   OFFLINE CHATS — чаты без сети.
   Показывают сохранённую на устройстве переписку: в списке — последнее
   сообщение каждого чата. Написанное без связи ставится в очередь:
   сообщение остаётся в чате со значком часов и уходит на сервер само,
   как только соединение вернётся (см. messenger/socket.ts).
=============================================================== */
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Send, Check, CheckCheck, Clock, Search, MessageSquare } from 'lucide-react';
import { useMessengerStore } from '@/messenger/store';
import { broadcast } from '@/messenger/socket';
import { useAuthStore } from '@/core/auth/store';
import type { ChatItem, MessageItem, MessageKind } from '@/messenger/types';

const T = {
  bg: 'var(--bg)', panel: 'var(--bg-l1)', l2: 'var(--bg-l2)', border: 'var(--border)', accent: '#5b9bd1',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', mine: 'linear-gradient(135deg,#1d4ed8,#2563eb)', other: '#1e1e26',
};

const KIND: Partial<Record<MessageKind, string>> = {
  photo: 'Фото', voice: 'Голосовое', 'video-note': 'Видео', file: 'Файл', gift: 'Подарок', prime_gift: 'Подарок', poll: 'Опрос', location: 'Геопозиция', sticker: 'Стикер',
};
const previewOf = (m: MessageItem | undefined) => (!m ? '' : m.kind === 'text' ? m.text : (KIND[m.kind] ?? 'Сообщение'));
const isKind = (m: MessageItem | undefined) => !!m && m.kind !== 'text';

const Avatar = ({ name, size = 44 }: { name: string; size?: number }) => {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className="grid shrink-0 place-items-center font-bold text-white"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(135deg,hsl(${hue},65%,38%),hsl(${(hue + 40) % 360},70%,32%))`, fontSize: size * 0.4 }}>
      {name[0]?.toUpperCase()}
    </div>
  );
};

const Status = ({ m }: { m: MessageItem }) => (
  m.status === 'queued' ? <Clock size={11} style={{ color: T.t3 }} aria-label="Ждёт отправки" />
    : m.status === 'sent' ? <Check size={12} style={{ color: T.accent }} /> : <CheckCheck size={12} style={{ color: T.accent }} />
);

const OfflineChatWindow = ({ chat, onBack }: { chat: ChatItem; onBack: () => void }) => {
  const all = useMessengerStore((s) => s.messages);
  const setActive = useMessengerStore((s) => s.setActiveChat);
  const sendMessage = useMessengerStore((s) => s.sendMessage);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgs = useMemo(() => all.filter((m) => m.chatId === chat.id && !m.deleted && !m.isScheduled).sort((a, b) => a.timestamp - b.timestamp).slice(-200), [all, chat.id]);
  const waiting = msgs.filter((m) => m.fromMe && m.status === 'queued').length;

  useEffect(() => { setActive(chat.id); }, [chat.id, setActive]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setActive(chat.id);
    const msg = sendMessage({ text });
    if (msg) broadcast.message(msg); // без связи уйдёт в очередь и досылается после подключения
    setDraft('');
    taRef.current?.focus();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} className="flex h-full flex-col" style={{ background: T.bg }}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ background: T.panel, borderBottom: `1px solid ${T.border}` }}>
        <button type="button" onClick={onBack} aria-label="Назад" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5"><ChevronLeft size={20} style={{ color: T.t2 }} /></button>
        <Avatar name={chat.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ color: T.t1 }} translate="no">{chat.name}</p>
          <p className="text-[11px]" style={{ color: waiting ? T.accent : T.t3 }}>{waiting ? `Ждут отправки: ${waiting}` : 'Сохранённая переписка'}</p>
        </div>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4" style={{ background: T.bg, scrollbarWidth: 'none' }}>
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16"><MessageSquare size={36} style={{ color: T.t3 }} /><p className="text-sm" style={{ color: T.t2 }}>Сообщений пока нет</p></div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[78%]">
              <div className="px-3.5 py-2.5" style={{ background: m.fromMe ? T.mine : T.other, opacity: m.status === 'queued' ? 0.82 : 1, borderRadius: m.fromMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px' }}>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: m.fromMe ? '#fff' : T.t1 }} translate={isKind(m) ? undefined : 'no'}>{previewOf(m)}</p>
              </div>
              <div className={`mt-0.5 flex items-center gap-1 px-1 ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                <span className="text-[10px]" style={{ color: T.t3 }}>{m.time}</span>
                {m.fromMe && <Status m={m} />}
                {m.fromMe && m.status === 'queued' && <span className="text-[10px]" style={{ color: T.t3 }}>отправится при подключении</span>}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex shrink-0 items-end gap-2 px-3 py-3" style={{ background: T.panel, borderTop: `1px solid ${T.border}`, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex flex-1 items-end gap-2 rounded-[26px] px-4 py-2.5" style={{ background: T.l2, border: `1px solid ${T.border}`, minHeight: 46 }}>
          <textarea ref={taRef} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Сообщение"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Написать сообщение..." rows={1} className="flex-1 resize-none bg-transparent py-0.5 text-sm leading-relaxed outline-none"
            style={{ color: T.t1, maxHeight: 120, scrollbarWidth: 'none' }} />
        </div>
        <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={send} disabled={!draft.trim()} aria-label="Отправить"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40" style={{ background: T.accent, boxShadow: '0 4px 16px rgba(91,155,209,0.4)' }}>
          <Send size={18} className="text-white" style={{ marginLeft: 2 }} />
        </motion.button>
      </div>
    </motion.div>
  );
};

export const OfflineChats = () => {
  const chats = useMessengerStore((s) => s.chats);
  const all = useMessengerStore((s) => s.messages);
  const { currentUserId } = useAuthStore();
  const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => chats
    .filter((c) => !c.archived && (c.type !== 'direct' || (c.participants ?? []).includes(currentUserId ?? '')))
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .map((c) => {
      const mine = all.filter((m) => m.chatId === c.id && !m.deleted && !m.isScheduled);
      const last = mine.reduce<MessageItem | undefined>((a, m) => (!a || m.timestamp > a.timestamp ? m : a), undefined);
      return { chat: c, last, waiting: mine.filter((m) => m.fromMe && m.status === 'queued').length };
    })
    .sort((a, b) => (b.last?.timestamp ?? 0) - (a.last?.timestamp ?? 0)), [chats, all, currentUserId, search]);

  if (activeChat) return (
    <AnimatePresence mode="wait"><OfflineChatWindow key={activeChat.id} chat={activeChat} onBack={() => setActiveChat(null)} /></AnimatePresence>
  );

  return (
    <div className="flex h-full flex-col" style={{ background: T.bg }}>
      <div className="shrink-0 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2 rounded-full px-4 py-2.5" style={{ background: T.panel, border: `1px solid ${T.border}` }}>
          <Search size={14} style={{ color: T.t3 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск чатов..." aria-label="Поиск чатов" className="flex-1 bg-transparent text-sm outline-none" style={{ color: T.t1 }} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16"><MessageSquare size={40} style={{ color: T.t3 }} /><p className="text-sm" style={{ color: T.t2 }}>Нет доступных чатов</p></div>
        ) : rows.map(({ chat, last, waiting }) => (
          <button key={chat.id} type="button" onClick={() => setActiveChat(chat)} className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
            <Avatar name={chat.name} size={46} />
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: T.t1 }} translate="no">{chat.name}</p>
                {last && <span className="shrink-0 text-[10px]" style={{ color: T.t3 }}>{last.time}</span>}
              </div>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs" style={{ color: waiting ? T.accent : T.t3 }}>
                {last?.fromMe && last.status === 'queued' && <Clock size={11} className="shrink-0" />}
                <span className="truncate" translate={isKind(last) ? undefined : 'no'}>{last ? `${last.fromMe ? 'Вы: ' : ''}${previewOf(last)}` : 'Нет сообщений'}</span>
              </p>
            </div>
            {waiting > 0 && <span className="grid min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: T.accent }} aria-label="Ждут отправки" translate="no">{waiting}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};
