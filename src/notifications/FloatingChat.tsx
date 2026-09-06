/**
 * FloatingChat  &  FloatingChatLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Мини-чат в правом нижнем углу.
 * • 300×400 px  (на мобайле — 100% ширины снизу)
 * • История сообщений из messenger/store
 * • Поле ввода + отправка (Enter / кнопка)
 * • Сворачивание / закрытие
 * • Несколько одновременных окон (до 3), сдвинуты горизонтально
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence }                  from 'framer-motion';
import { X, Minus, Send, MessageCircle }            from 'lucide-react';
import { useFloatingChatStore, FloatingChatEntry }  from './floatingChatStore';
import { useMessengerStore }                        from '@/messenger/store';
import { useAuthStore }                             from '@/core/auth/store';

/* ── Single floating chat window ────────────────────────────────────────── */
const W_WIDTH  = 300;
const W_HEIGHT = 400;
const W_GAP    = 12;
const W_BOTTOM = 20;
const W_RIGHT  = 20;

interface FloatingChatProps {
  entry:     FloatingChatEntry;
  index:     number;           // 0 = rightmost
}

const avatarGrad = (letter: string) => {
  const h = letter.charCodeAt(0) % 360;
  return `linear-gradient(135deg, hsl(${h},60%,38%), hsl(${(h+40)%360},65%,32%))`;
};

const FloatingChat = ({ entry, index }: FloatingChatProps) => {
  const { closeChat, toggleMin }          = useFloatingChatStore();
  const { chats, messages, setActiveChat, sendMessage, activeChatId } = useMessengerStore();
  const { accounts, currentUserId }       = useAuthStore();

  const chat      = chats.find(c => c.id === entry.chatId);
  const chatMsgs  = messages
    .filter(m => m.chatId === entry.chatId)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-50);

  const [text, setText]   = useState('');
  const [unread, setUnread] = useState(0);
  const bodyRef           = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);
  const prevCountRef      = useRef(chatMsgs.length);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!entry.minimized && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [chatMsgs.length, entry.minimized]);

  // Track unread while minimized
  useEffect(() => {
    if (entry.minimized && chatMsgs.length > prevCountRef.current) {
      setUnread(v => v + (chatMsgs.length - prevCountRef.current));
    }
    prevCountRef.current = chatMsgs.length;
  }, [chatMsgs.length, entry.minimized]);

  const handleOpen = () => {
    toggleMin(entry.chatId);
    setUnread(0);
  };

  const handleSend = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    // Temporarily switch active chat to send, then restore
    const prev = activeChatId;
    setActiveChat(entry.chatId);
    // Use setTimeout to let zustand update before sending
    setTimeout(() => {
      useMessengerStore.getState().sendMessage({ text: t });
      if (prev !== entry.chatId) setActiveChat(prev);
    }, 0);
    setText('');
    inputRef.current?.focus();
  }, [text, entry.chatId, activeChatId, setActiveChat]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Horizontal offset: each window shifts left
  const rightOffset = W_RIGHT + index * (W_WIDTH + W_GAP);
  const isMobile    = typeof window !== 'undefined' && window.innerWidth < 640;

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={{
        position:    'fixed',
        bottom:      W_BOTTOM,
        right:       isMobile ? 0 : rightOffset,
        width:       isMobile ? '100%' : W_WIDTH,
        zIndex:      9990 + index,
        display:     'flex',
        flexDirection: 'column',
        borderRadius: isMobile ? '20px 20px 0 0' : 16,
        overflow:    'hidden',
        boxShadow:   '0 8px 40px rgba(0,0,0,0.55)',
        border:      '1px solid rgba(255,255,255,0.09)',
        background:  'var(--bg-l1)',
        maxWidth:    isMobile ? '100%' : W_WIDTH,
      }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        onClick={entry.minimized ? handleOpen : undefined}
        className={`flex items-center gap-2.5 px-3 py-2.5 shrink-0 select-none ${entry.minimized ? 'cursor-pointer' : ''}`}
        style={{
          background:    'linear-gradient(135deg,rgba(79,110,247,0.18),rgba(79,110,247,0.08))',
          borderBottom:  entry.minimized ? 'none' : '1px solid var(--border)',
        }}>
        {/* Avatar */}
        <div className="relative shrink-0">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white"
            style={{ background: avatarGrad(entry.senderLetter) }}>
            {entry.senderLetter}
          </div>
          {chat?.online && (
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2"
              style={{ background: 'var(--green)', borderColor: 'var(--bg-l1)' }} />
          )}
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate text-white">{entry.senderName}</p>
          <p className="text-[10px]" style={{ color: chat?.online ? 'var(--green)' : 'var(--t3)' }}>
            {chat?.online ? 'В сети' : 'Не в сети'}
          </p>
        </div>

        {/* Badge when minimized */}
        <AnimatePresence>
          {entry.minimized && unread > 0 && (
            <motion.span
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold text-white"
              style={{ background: 'var(--accent)' }}>
              {unread > 9 ? '9+' : unread}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); toggleMin(entry.chatId); setUnread(0); }}
            className="grid h-6 w-6 place-items-center rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'var(--t3)' }}>
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); closeChat(entry.chatId); }}
            className="grid h-6 w-6 place-items-center rounded-lg transition-colors hover:bg-red-500/20"
            style={{ color: 'var(--t3)' }}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Body + Input (hidden when minimized) ───────────────────────── */}
      <AnimatePresence initial={false}>
        {!entry.minimized && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: W_HEIGHT - 48, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {/* Messages */}
            <div
              ref={bodyRef}
              className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
              style={{ scrollbarWidth: 'none', height: W_HEIGHT - 48 - 56 }}>
              {chatMsgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
                  <MessageCircle size={24} style={{ color: 'var(--t3)' }} />
                  <p className="text-xs text-center" style={{ color: 'var(--t3)' }}>Напиши первым!</p>
                </div>
              ) : chatMsgs.map((msg, i) => {
                const isMe     = msg.fromMe || msg.authorId === currentUserId;
                const sender   = accounts.find(a => a.id === msg.authorId);
                const showName = !isMe && i === 0 || (!isMe && chatMsgs[i-1]?.authorId !== msg.authorId);

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    {showName && (
                      <p className="text-[9px] font-semibold mb-0.5 px-1" style={{ color: 'var(--t3)' }}>
                        {sender?.name ?? entry.senderName}
                      </p>
                    )}
                    <div
                      className="max-w-[80%] rounded-2xl px-3 py-2 text-[12px] leading-snug"
                      style={{
                        background: isMe
                          ? 'var(--accent)'
                          : 'var(--bg-l3)',
                        color: isMe ? '#fff' : 'var(--t1)',
                        borderBottomRightRadius: isMe ? 4 : 16,
                        borderBottomLeftRadius:  isMe ? 16 : 4,
                        wordBreak: 'break-word',
                      }}>
                      {msg.kind === 'text'  ? msg.text :
                       msg.kind === 'photo' ? '📷 Фото' :
                       msg.kind === 'voice' ? '🎤 Голосовое' :
                       msg.kind === 'file'  ? `📎 ${msg.fileName ?? 'Файл'}` :
                       msg.text ?? ''}
                    </div>
                    <p className="text-[9px] mt-0.5 px-1" style={{ color: 'var(--t3)' }}>
                      {fmtTime(msg.timestamp)}
                      {isMe && (msg.status === 'read' ? ' ✓✓' : ' ✓')}
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 pb-3 pt-2 flex items-end gap-2"
              style={{ borderTop: '1px solid var(--border)' }}>
              <textarea
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="Сообщение..."
                rows={1}
                className="flex-1 resize-none rounded-2xl px-3 py-2 text-xs outline-none"
                style={{
                  background:  'var(--bg-l3)',
                  border:      '1px solid var(--border-m)',
                  color:       'var(--t1)',
                  maxHeight:   72,
                  lineHeight:  1.5,
                  scrollbarWidth: 'none',
                }}
              />
              <motion.button
                whileTap={{ scale: 0.88 }}
                type="button"
                onClick={handleSend}
                disabled={!text.trim()}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-all"
                style={{
                  background: text.trim() ? 'var(--accent)' : 'var(--bg-l3)',
                  color:      text.trim() ? '#fff' : 'var(--t3)',
                }}>
                <Send size={13} />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ── Layer — renders all open chats ─────────────────────────────────────── */
export const FloatingChatLayer = () => {
  const chats = useFloatingChatStore(s => s.chats);

  return (
    <>
      <AnimatePresence>
        {chats.map((entry, index) => (
          <FloatingChat
            key={entry.chatId}
            entry={entry}
            index={index}
          />
        ))}
      </AnimatePresence>
    </>
  );
};
