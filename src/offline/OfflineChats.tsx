/* ===============================================================
   OFFLINE CHATS  -  обычные чаты без сервера
   Сообщения идут через BroadcastChannel + localStorage
=============================================================== */
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Send, Check, Search, MessageSquare } from 'lucide-react';
import { useMessengerStore } from '@/messenger/store';
import { useAuthStore } from '@/core/auth/store';
import type { ChatItem } from '@/messenger/types';

const T = {
  bg: 'var(--bg)', panel: 'var(--bg-l1)', l2: 'var(--bg-l2)',
  border: 'var(--border)', accent: '#5b9bd1',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
  mine: 'linear-gradient(135deg,#1d4ed8,#2563eb)', other: '#1e1e26',
};

interface OffMsg {
  id: string; chatId: string; authorId: string;
  text: string; timestamp: number;
}

const SK = 'sky:offline:msgs:v2';
const BC_CHANNEL = 'sky:offline:bc';

const loadMsgs = (): OffMsg[] => {
  try { return JSON.parse(localStorage.getItem(SK) || '[]'); } catch { return []; }
};
const saveMsgs = (msgs: OffMsg[]) => {
  try { localStorage.setItem(SK, JSON.stringify(msgs.slice(-500))); } catch {}
};

const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BC_CHANNEL) : null;

const Avatar = ({ name, size = 44 }: { name: string; size?: number }) => {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className="grid shrink-0 place-items-center font-bold text-white"
      style={{
        width: size, height: size, borderRadius: size * 0.3,
        background: `linear-gradient(135deg,hsl(${hue},65%,38%),hsl(${(hue+40)%360},70%,32%))`,
        fontSize: size * 0.4,
      }}>
      {name[0]?.toUpperCase()}
    </div>
  );
};

const OfflineChatWindow = ({ chat, onBack }: { chat: ChatItem; onBack: () => void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const [msgs, setMsgs] = useState<OffMsg[]>([]);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMsgs(loadMsgs().filter(m => m.chatId === chat.id));
  }, [chat.id]);

  useEffect(() => {
    if (!bc) return;
    const handler = (e: MessageEvent) => {
      const msg = e.data as OffMsg;
      if (msg?.chatId === chat.id) {
        setMsgs(prev => prev.find(m => m.id === msg.id)
          ? prev
          : [...prev, msg].sort((a, b) => a.timestamp - b.timestamp));
      }
    };
    bc.addEventListener('message', handler);
    return () => bc.removeEventListener('message', handler);
  }, [chat.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const send = () => {
    const text = draft.trim();
    if (!text || !currentUserId) return;
    const msg: OffMsg = {
      id: `om-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      chatId: chat.id, authorId: currentUserId,
      text, timestamp: Date.now(),
    };
    const all = loadMsgs();
    all.push(msg);
    saveMsgs(all);
    setMsgs(prev => [...prev, msg]);
    bc?.postMessage(msg);
    setDraft('');
    taRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }} className="flex flex-col h-full" style={{ background: T.bg }}>

      <div className="flex shrink-0 items-center gap-3 px-4 py-3"
        style={{ background: T.panel, borderBottom: `1px solid ${T.border}` }}>
        <button type="button" onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={20} style={{ color: T.t2 }}/>
        </button>
        <Avatar name={chat.name} size={36}/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: T.t1 }}>{chat.name}</p>
          <p className="text-[11px]" style={{ color: T.t3 }}>офлайн-чат</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5"
        style={{ background: T.bg, scrollbarWidth: 'none' }}>
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16">
            <MessageSquare size={36} style={{ color: T.t3 }}/>
            <p className="text-sm" style={{ color: T.t2 }}>Начните переписку</p>
          </div>
        )}
        {msgs.map(msg => {
          const fromMe = msg.authorId === currentUserId;
          const author = accounts.find(a => a.id === msg.authorId);
          const hue = [...(author?.name ?? 'U')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
          return (
            <div key={msg.id} className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
              {!fromMe && (
                <div className="w-6 h-6 shrink-0 self-end mb-0.5 mr-1.5 grid place-items-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: `hsl(${hue},55%,38%)` }}>
                  {(author?.name ?? 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="max-w-[68%]">
                <div className="px-3.5 py-2.5"
                  style={{
                    background: fromMe ? T.mine : T.other,
                    borderRadius: fromMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    boxShadow: fromMe ? '0 2px 8px rgba(37,99,235,0.3)' : 'none',
                  }}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                    style={{ color: fromMe ? '#ffffff' : T.t1 }}>
                    {msg.text}
                  </p>
                </div>
                <div className={`flex items-center gap-1 mt-0.5 px-1 ${fromMe ? 'justify-end' : 'justify-start'}`}>
                  <span className="text-[10px]" style={{ color: T.t3 }}>{fmtTime(msg.timestamp)}</span>
                  {fromMe && <Check size={12} style={{ color: T.accent }}/>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      <div className="shrink-0 px-3 py-3 flex items-end gap-2"
        style={{ background: T.panel, borderTop: `1px solid ${T.border}` }}>
        <div className="flex flex-1 items-end gap-2 rounded-3xl px-4 py-2.5"
          style={{ background: T.l2, border: `1px solid ${T.border}`, minHeight: 46 }}>
          <textarea ref={taRef} value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={onKey} placeholder="Написать сообщение..." rows={1}
            className="flex-1 resize-none bg-transparent py-0.5 text-sm outline-none leading-relaxed"
            style={{ color: T.t1, maxHeight: 120, scrollbarWidth: 'none' as const }}/>
        </div>
        <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={send}
          disabled={!draft.trim()}
          className="grid h-11 w-11 place-items-center rounded-full shrink-0 disabled:opacity-40"
          style={{ background: T.accent, boxShadow: '0 4px 16px rgba(91,155,209,0.4)' }}>
          <Send size={18} className="text-white" style={{ marginLeft: 2 }}/>
        </motion.button>
      </div>
    </motion.div>
  );
};

export const OfflineChats = () => {
  const { chats } = useMessengerStore();
  const { currentUserId, accounts } = useAuthStore();
  const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
  const [search, setSearch] = useState('');

  const directs = useMemo(() =>
    chats.filter(c =>
      c.type === 'direct' &&
      !c.archived &&
      c.participants?.includes(currentUserId ?? '')
    ).filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())),
  [chats, currentUserId, search]);

  if (activeChat) return (
    <AnimatePresence mode="wait">
      <OfflineChatWindow key={activeChat.id} chat={activeChat} onBack={() => setActiveChat(null)}/>
    </AnimatePresence>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: T.bg }}>
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5"
          style={{ background: T.panel, border: `1px solid ${T.border}` }}>
          <Search size={14} style={{ color: T.t3 }}/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск чатов..." className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: T.t1 }}/>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {directs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <MessageSquare size={40} style={{ color: T.t3 }}/>
            <p className="text-sm" style={{ color: T.t2 }}>Нет доступных чатов</p>
          </div>
        ) : directs.map(chat => {
          const recipientId = chat.participants?.find(p => p !== currentUserId);
          const recipient = accounts.find(a => a.id === recipientId);
          return (
            <button key={chat.id} type="button" onClick={() => setActiveChat(chat)}
              className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
              <Avatar name={chat.name} size={44}/>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold truncate" style={{ color: T.t1 }}>{chat.name}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: T.t3 }}>
                  {recipient ? `@${recipient.username}` : 'Прямой чат'}
                </p>
              </div>
              <ChevronLeft size={16} className="rotate-180" style={{ color: T.t3 }}/>
            </button>
          );
        })}
      </div>
    </div>
  );
};
