import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Mic, MicOff, Hand, Smile, MessageCircle, PhoneOff, MoreVertical,
  Crown, Shield, ShieldCheck, Pin, Send, X, Settings2, Monitor, Users as UsersIcon,
} from 'lucide-react';
import { useVoicePartyStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { REACTIONS, CATEGORY_ICON, CATEGORY_LABEL } from '../types';
import type { VPParticipant, VPRole } from '../types';

const ROLE_ICON: Partial<Record<VPRole, any>> = { owner: Crown, admin: ShieldCheck, moderator: Shield };
const ROLE_LABEL: Record<VPRole, string> = { owner:'Владелец', admin:'Администратор', moderator:'Модератор', speaker:'Спикер', listener:'Слушатель' };

export const RoomView = ({ roomId, onLeave }: { roomId: string; onLeave: () => void }) => {
  const {
    rooms, activeRoomId, joinRoom, leaveRoom, toggleMic, raiseHand, lowerHand, sendReaction, reactions,
    sendChatMessage, pinMessage, muteParticipant, promoteToSpeaker, demoteToListener, kickParticipant, banParticipant,
    updatePermissions, myRole, myParticipant, micReady,
  } = useVoicePartyStore();
  const { currentUserId } = useAuthStore();
  const room = rooms.find(r => r.id === roomId);
  const [panel, setPanel] = useState<'none'|'chat'|'participants'|'permissions'>('none');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showReactions, setShowReactions] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRoomId !== roomId) joinRoom(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [room?.messages.length]);

  if (!room) return null;
  const me = myParticipant();
  const role = myRole();
  const isMod = role === 'owner' || role === 'admin' || role === 'moderator';
  const pinned = room.messages.filter(m => m.pinned);

  const leave = () => { leaveRoom(); onLeave(); };

  return (
    <div className="relative flex h-full flex-col overflow-hidden" style={{ background: 'linear-gradient(160deg, #0d1120, #161226 60%, #0d1120)' }}>
      {/* Шапка */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={leave} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}><ArrowLeft size={16} className="text-white"/></button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[14.5px] font-bold text-white">
              {(() => { const Icon = CATEGORY_ICON[room.category]; return <Icon size={14} className="shrink-0"/>; })()}
              <span className="truncate">{room.title}</span>
            </p>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{room.participants.length} участников · {CATEGORY_LABEL[room.category]}</p>
          </div>
          {isMod && (
            <button type="button" onClick={() => setPanel('permissions')} className="rounded-full p-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <Settings2 size={15} className="text-white"/>
            </button>
          )}
        </div>
      </div>

      {/* Сетка участников */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {room.participants.map(p => (
            <ParticipantTile key={p.id} p={p} isMod={isMod} isMe={p.id === currentUserId}
              onMenu={() => setMenuFor(p.id)}/>
          ))}
        </div>
        {!micReady && (
          <p className="mt-4 text-center text-[11.5px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Микрофон недоступен — проверьте разрешения браузера, чтобы говорить в комнате
          </p>
        )}
      </div>

      {/* Плавающие реакции */}
      <div className="pointer-events-none absolute bottom-24 left-0 right-0 flex justify-center">
        <AnimatePresence>
          {reactions.slice(-6).map(r => (
            <motion.span key={r.id} initial={{ opacity: 1, y: 0, x: (Math.random()-0.5)*120 }} animate={{ opacity: 0, y: -140 }}
              transition={{ duration: 2.2 }} className="absolute text-3xl">{r.emoji}</motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/* Закреплённые сообщения */}
      {pinned.length > 0 && panel === 'none' && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)' }}>
          <Pin size={12} style={{ color: 'var(--amber)' }}/>
          <p className="truncate text-[11.5px]" style={{ color: '#fff' }}>{pinned[pinned.length-1].authorName}: {pinned[pinned.length-1].text}</p>
        </div>
      )}

      {/* Панель управления */}
      <div className="shrink-0 px-4 pb-5 pt-2">
        <div className="flex items-center justify-center gap-3">
          <CtrlBtn active={!me?.muted} onClick={toggleMic} activeColor="var(--green)">
            {me?.muted ? <MicOff size={18}/> : <Mic size={18}/>}
          </CtrlBtn>
          <CtrlBtn active={me?.handRaised} onClick={() => me?.handRaised ? lowerHand() : raiseHand()} activeColor="var(--amber)">
            <Hand size={18}/>
          </CtrlBtn>
          <div className="relative">
            <CtrlBtn active={showReactions} onClick={() => setShowReactions(v => !v)} activeColor="var(--accent)">
              <Smile size={18}/>
            </CtrlBtn>
            <AnimatePresence>
              {showReactions && (
                <motion.div initial={{ opacity:0, y:8, scale:0.9 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:8, scale:0.9 }}
                  className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-2xl p-2" style={{ background: 'rgba(20,20,30,0.95)' }}>
                  {REACTIONS.map(e => (
                    <button key={e} type="button" onClick={() => { sendReaction(e); setShowReactions(false); }} className="grid h-8 w-8 place-items-center rounded-xl text-lg hover:bg-white/10">{e}</button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <CtrlBtn active={panel === 'chat'} onClick={() => setPanel(v => v === 'chat' ? 'none' : 'chat')} activeColor="var(--accent)">
            <MessageCircle size={18}/>
          </CtrlBtn>
          <CtrlBtn active={panel === 'participants'} onClick={() => setPanel(v => v === 'participants' ? 'none' : 'participants')} activeColor="var(--accent)">
            <UsersIcon size={18}/>
          </CtrlBtn>
          <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={leave}
            className="grid h-12 w-12 place-items-center rounded-full text-white" style={{ background: 'var(--red)' }}>
            <PhoneOff size={18}/>
          </motion.button>
        </div>
      </div>

      {/* Панели снизу: чат / участники / разрешения */}
      <AnimatePresence>
        {panel !== 'none' && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
            className="absolute inset-x-0 bottom-0 z-30 flex h-[70%] flex-col rounded-t-3xl" style={{ background: '#14121f' }}>
            <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
              <p className="text-[14px] font-bold text-white">
                {panel === 'chat' ? 'Чат комнаты' : panel === 'participants' ? 'Участники' : 'Настройки комнаты'}
              </p>
              <button type="button" onClick={() => setPanel('none')}><X size={16} style={{ color: 'rgba(255,255,255,0.6)' }}/></button>
            </div>

            {panel === 'chat' && (
              <>
                <div className="flex-1 overflow-y-auto px-4 space-y-2">
                  {room.messages.length === 0 && <p className="py-8 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Пока нет сообщений</p>}
                  {room.messages.map(m => (
                    <div key={m.id} className="flex items-start gap-2 rounded-xl p-2.5" style={{ background: m.pinned ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.04)' }}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-bold" style={{ color: 'var(--accent)' }}>{m.authorName}</p>
                        <p className="text-[13px]" style={{ color: '#fff' }}>{m.text}</p>
                      </div>
                      {isMod && (
                        <button type="button" onClick={() => pinMessage(m.id)}><Pin size={12} style={{ color: m.pinned ? 'var(--amber)' : 'rgba(255,255,255,0.35)' }}/></button>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef}/>
                </div>
                <div className="shrink-0 p-3">
                  <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key==='Enter' && chatInput.trim()) { sendChatMessage(chatInput); setChatInput(''); } }}
                      placeholder="Написать в чат..." className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: '#fff' }}/>
                    <button type="button" onClick={() => { if (chatInput.trim()) { sendChatMessage(chatInput); setChatInput(''); } }}
                      className="grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--accent)' }}><Send size={13} className="text-white"/></button>
                  </div>
                </div>
              </>
            )}

            {panel === 'participants' && (
              <div className="flex-1 overflow-y-auto px-4 space-y-2">
                {room.participants.map(p => {
                  const RoleIcon = ROLE_ICON[p.role];
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-black text-white" style={{ background: p.avatarColor }}>{p.name[0]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-white">{p.name}</p>
                        <p className="flex items-center gap-1 text-[10.5px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          {RoleIcon && <RoleIcon size={9}/>}{ROLE_LABEL[p.role]}{p.muted && ' · без звука'}
                        </p>
                      </div>
                      {isMod && p.id !== currentUserId && (
                        <button type="button" onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}><MoreVertical size={15} style={{ color: 'rgba(255,255,255,0.5)' }}/></button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {panel === 'permissions' && (
              <div className="flex-1 overflow-y-auto px-4 space-y-3">
                <PermRow label="Кто может говорить" value={room.permissions.whoCanSpeak === 'everyone'}
                  onToggle={() => updatePermissions({ whoCanSpeak: room.permissions.whoCanSpeak === 'everyone' ? 'speakersOnly' : 'everyone' })}
                  sub={room.permissions.whoCanSpeak === 'everyone' ? 'Все участники' : 'Только спикеры'}/>
                <PermRow label="Кто может ставить реакции" value={room.permissions.whoCanReact === 'everyone'}
                  onToggle={() => updatePermissions({ whoCanReact: room.permissions.whoCanReact === 'everyone' ? 'speakersOnly' : 'everyone' })}
                  sub={room.permissions.whoCanReact === 'everyone' ? 'Все участники' : 'Только спикеры'}/>
                <PermRow label="Подтверждение права голоса" value={room.permissions.requireApprovalToSpeak}
                  onToggle={() => updatePermissions({ requireApprovalToSpeak: !room.permissions.requireApprovalToSpeak })}
                  sub="Новые участники входят слушателями"/>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Меню модерации участника */}
      <AnimatePresence>
        {menuFor && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setMenuFor(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-4" style={{ background: '#181524' }}>
              {[
                ['Выключить микрофон', () => muteParticipant(menuFor)],
                ['Сделать спикером', () => promoteToSpeaker(menuFor)],
                ['Перевести в слушатели', () => demoteToListener(menuFor)],
                ['Исключить из комнаты', () => kickParticipant(menuFor)],
                ['Заблокировать', () => banParticipant(menuFor)],
              ].map(([label, fn]) => (
                <button key={label as string} type="button" onClick={() => { (fn as () => void)(); setMenuFor(null); }}
                  className="block w-full rounded-xl px-4 py-3 text-left text-[13.5px] text-white hover:bg-white/5">{label as string}</button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CtrlBtn = ({ active, activeColor, onClick, children }: { active?: boolean; activeColor: string; onClick: () => void; children: React.ReactNode }) => (
  <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={onClick}
    className="grid h-12 w-12 place-items-center rounded-full text-white"
    style={{ background: active ? `${activeColor}30` : 'rgba(255,255,255,0.08)', border: active ? `1.5px solid ${activeColor}` : '1px solid rgba(255,255,255,0.1)', color: active ? activeColor : '#fff' }}>
    {children}
  </motion.button>
);

const PermRow = ({ label, sub, value, onToggle }: { label: string; sub: string; value: boolean; onToggle: () => void }) => (
  <button type="button" onClick={onToggle} className="flex w-full items-center justify-between rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
    <div className="text-left">
      <p className="text-[13px] font-semibold text-white">{label}</p>
      <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</p>
    </div>
    <span className="h-5 w-9 shrink-0 rounded-full p-0.5" style={{ background: value ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }}>
      <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: value ? 16 : 0 }}/>
    </span>
  </button>
);

const ParticipantTile = ({ p, isMod, isMe, onMenu }: { p: VPParticipant; isMod: boolean; isMe: boolean; onMenu: () => void }) => {
  const RoleIcon = ROLE_ICON[p.role];
  return (
    <button type="button" onClick={() => isMod && !isMe && onMenu()} className="flex flex-col items-center gap-1.5">
      <div className="relative">
        {p.speaking && (
          <motion.div className="absolute -inset-1.5 rounded-full" style={{ border: '2px solid var(--green)' }}
            animate={{ scale: [1, 1.08, 1], opacity: [0.8, 0.3, 0.8] }} transition={{ duration: 1.2, repeat: Infinity }}/>
        )}
        <div className="relative grid h-14 w-14 place-items-center rounded-full text-lg font-black text-white" style={{ background: p.avatarColor }}>
          {p.name[0]}
        </div>
        {p.muted && (
          <div className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full" style={{ background: 'var(--red)', border: '2px solid #14121f' }}>
            <MicOff size={9} className="text-white"/>
          </div>
        )}
        {p.handRaised && (
          <motion.div animate={{ rotate: [0,15,-15,0] }} transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1 }}
            className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full" style={{ background: 'var(--amber)' }}>
            <Hand size={11} style={{ color: '#14121f' }}/>
          </motion.div>
        )}
        {RoleIcon && (
          <div className="absolute -bottom-0.5 -left-0.5 grid h-5 w-5 place-items-center rounded-full" style={{ background: '#14121f', border: '1.5px solid var(--amber)' }}>
            <RoleIcon size={9} style={{ color: 'var(--amber)' }}/>
          </div>
        )}
      </div>
      <p className="max-w-[64px] truncate text-[10.5px] font-semibold text-white">{p.name.split(' ')[0]}</p>
    </button>
  );
};
