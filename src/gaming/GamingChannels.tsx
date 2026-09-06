/* ===============================================================
   SKY GAMING CHANNELS  -  как Discord
   Серверы · Голосовые комнаты · Текстовые каналы · Роли
=============================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Hash, Volume2, Plus, Users, Crown, Settings, Mic, MicOff,
  Headphones, PhoneOff, Send, ChevronDown, ChevronRight, Shield,
  Gamepad2, Swords, MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { create } from 'zustand';

/* -- Types ------------------------------------------------ */
interface GChannel {
  id: string; name: string; type: 'text' | 'voice' | 'announce';
  categoryId: string; position: number; memberCount?: number;
}
interface GCategory { id: string; name: string; collapsed: boolean; }
interface GServer {
  id: string; name: string; icon: string;
  ownerId: string; members: string[];
  categories: GCategory[]; channels: GChannel[];
  roles: { id:string; name:string; color:string; memberIds:string[] }[];
  createdAt: string;
}
interface GMessage { id:string; channelId:string; authorId:string; authorName:string; text:string; timestamp:number; }

interface GamingChannelsState {
  servers: GServer[];
  messages: Record<string, GMessage[]>;   // channelId → messages
  voiceChannelId: string | null;           // joined voice channel
  voiceMuted: boolean;
  voiceDeaf: boolean;

  joinServer:     (serverId: string, userId: string) => void;
  leaveServer:    (serverId: string, userId: string) => void;
  sendMsg:        (channelId: string, authorId: string, authorName: string, text: string) => void;
  joinVoice:      (channelId: string) => void;
  leaveVoice:     () => void;
  toggleMute:     () => void;
  toggleDeaf:     () => void;
  createChannel:  (serverId: string, categoryId: string, name: string, type: 'text'|'voice') => GChannel;
  createServer:   (name: string, icon: string, ownerId: string) => GServer;
  deleteChannel:  (serverId: string, channelId: string) => void;
  broadcastMsg:   (channelId: string, msg: GMessage) => void;
}

/* -- Seed servers ------------------------------------------- */
const SEED_SERVERS: GServer[] = [
  {
    id: 'gs-csgo', name: 'CS2 Russia', icon: '🔫',
    ownerId: 'neo', members: ['kutuzov','luna_nova','neo'],
    createdAt: new Date().toISOString(),
    categories: [
      { id:'cat-1', name:'ИНФОРМАЦИЯ', collapsed:false },
      { id:'cat-2', name:'ОБЩЕНИЕ',    collapsed:false },
      { id:'cat-3', name:'ГОЛОСОВЫЕ',  collapsed:false },
    ],
    channels: [
      { id:'ch-rules',    name:'правила',      type:'announce', categoryId:'cat-1', position:0 },
      { id:'ch-general',  name:'общий',        type:'text',     categoryId:'cat-2', position:1 },
      { id:'ch-cs2',      name:'cs2-тактики',  type:'text',     categoryId:'cat-2', position:2 },
      { id:'ch-lfg',      name:'поиск-игроков',type:'text',     categoryId:'cat-2', position:3 },
      { id:'ch-voice1',   name:'Лобби #1',     type:'voice',    categoryId:'cat-3', position:4, memberCount:2 },
      { id:'ch-voice2',   name:'Лобби #2',     type:'voice',    categoryId:'cat-3', position:5, memberCount:0 },
      { id:'ch-voice-mm', name:'Matchmaking',  type:'voice',    categoryId:'cat-3', position:6, memberCount:1 },
    ],
    roles: [
      { id:'r-owner', name:'Владелец',  color:'var(--amber)', memberIds:['neo'] },
      { id:'r-mod',   name:'Модератор', color:'#22c55e', memberIds:['kutuzov'] },
      { id:'r-member',name:'Участник',  color:'var(--t2)', memberIds:['luna_nova'] },
    ],
  },
  {
    id: 'gs-dota', name: 'Dota 2 CIS', icon: '🏆',
    ownerId: 'kutuzov', members: ['kutuzov','luna_nova'],
    createdAt: new Date().toISOString(),
    categories: [
      { id:'cat-d1', name:'ОБЩЕЕ',    collapsed:false },
      { id:'cat-d2', name:'ГОЛОСОВЫЕ',collapsed:false },
    ],
    channels: [
      { id:'ch-dota-gen', name:'общий',     type:'text',  categoryId:'cat-d1', position:0 },
      { id:'ch-dota-meta',name:'мета',      type:'text',  categoryId:'cat-d1', position:1 },
      { id:'ch-dota-v1',  name:'Lobby',     type:'voice', categoryId:'cat-d2', position:2, memberCount:3 },
    ],
    roles: [
      { id:'r-d-owner', name:'Владелец', color:'var(--amber)', memberIds:['kutuzov'] },
    ],
  },
];

const SEED_MSGS: Record<string,GMessage[]> = {
  'ch-general': [
    { id:'m1', channelId:'ch-general', authorId:'neo', authorName:'Neo',
      text:'Всем привет! Кто идёт на MM?', timestamp: Date.now()-120000 },
    { id:'m2', channelId:'ch-general', authorId:'kutuzov', authorName:'Kutuzov',
      text:'Я в деле, ищем ещё 2 человек', timestamp: Date.now()-60000 },
  ],
  'ch-dota-gen': [
    { id:'m3', channelId:'ch-dota-gen', authorId:'luna_nova', authorName:'Luna Nova',
      text:'Кто хочет сыграть? Рейтинг ~3к MMR', timestamp: Date.now()-90000 },
  ],
};

const SK = 'sky:gchannels:v1';
const loadGC = () => { try { return JSON.parse(localStorage.getItem(SK)||'{}'); } catch { return {}; } };
const saveGC = (msgs: Record<string,GMessage[]>) => {
  try { localStorage.setItem(SK, JSON.stringify(msgs)); } catch {}
};

export const useGamingChannels = create<GamingChannelsState>((set, get) => {
  const stored = loadGC();

  // Cross-tab real-time via BroadcastChannel
  if (typeof window !== 'undefined') {
    try {
      const bc = new BroadcastChannel('sky:gchannels:rt');
      bc.onmessage = (e) => {
        const { type, channelId, msg } = e.data ?? {};
        if (type === 'msg' && channelId && msg) {
          set(s => {
            const msgs = { ...s.messages, [channelId]: [...(s.messages[channelId]??[]).filter(m=>m.id!==msg.id), msg] };
            return { messages: msgs };
          });
        }
      };
    } catch {}
  }

  return {
    servers:       SEED_SERVERS,
    messages:      { ...SEED_MSGS, ...(stored.messages ?? {}) },
    voiceChannelId:null, voiceMuted:false, voiceDeaf:false,

    joinServer: (serverId, userId) => {
      set(s => ({ servers: s.servers.map(sv =>
        sv.id === serverId && !sv.members.includes(userId)
          ? { ...sv, members:[...sv.members, userId] } : sv
      )}));
    },
    leaveServer: (serverId, userId) => {
      set(s => ({ servers: s.servers.map(sv =>
        sv.id === serverId ? { ...sv, members:sv.members.filter(m=>m!==userId) } : sv
      )}));
    },
    sendMsg: (channelId, authorId, authorName, text) => {
      if (!text.trim()) return;
      const msg: GMessage = {
        id: `gm-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        channelId, authorId, authorName, text: text.trim(), timestamp: Date.now(),
      };
      set(s => {
        const prev = s.messages[channelId] ?? [];
        // Deduplicate by id just in case
        const next = [...prev.filter(m => m.id !== msg.id), msg];
        const msgs = { ...s.messages, [channelId]: next };
        saveGC({ messages: msgs });
        return { messages: msgs };
      });
    },
    joinVoice:  (id) => set({ voiceChannelId: id }),
    leaveVoice: ()  => set({ voiceChannelId:null, voiceMuted:false, voiceDeaf:false }),
    toggleMute: ()  => set(s => ({ voiceMuted: !s.voiceMuted })),
    toggleDeaf: ()  => set(s => ({ voiceDeaf: !s.voiceDeaf })),

    createChannel: (serverId, categoryId, name, type) => {
      const ch: GChannel = {
        id: `ch-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
        name: name.toLowerCase().replace(/[^a-zа-яё0-9-_]/gi, '-').replace(/-+/g, '-').slice(0, 32),
        type, categoryId, position: Date.now(), memberCount: 0,
      };
      set(s => ({
        servers: s.servers.map(sv =>
          sv.id === serverId ? { ...sv, channels: [...sv.channels, ch] } : sv
        )
      }));
      return ch;
    },

    createServer: (name, icon, ownerId) => {
      const ts = Date.now();
      const catText  = `cat-${ts}-text`;
      const catVoice = `cat-${ts}-voice`;
      const sv: GServer = {
        id: `gs-${ts}`, name, icon, ownerId, members: [ownerId],
        createdAt: new Date().toISOString(),
        categories: [
          { id: catText,  name: 'ТЕКСТОВЫЕ', collapsed: false },
          { id: catVoice, name: 'ГОЛОСОВЫЕ', collapsed: false },
        ],
        channels: [
          { id: `ch-${ts}-gen`, name: 'общий', type: 'text',  categoryId: catText,  position: 0 },
          { id: `ch-${ts}-voc`, name: 'Лобби', type: 'voice', categoryId: catVoice, position: 1, memberCount: 0 },
        ],
        roles: [{ id: 'r-owner', name: 'Владелец', color: 'var(--amber)', memberIds: [ownerId] }],
      };
      set(s => ({ servers: [...s.servers, sv] }));
      return sv;
    },

    deleteChannel: (serverId, channelId) => {
      set(s => ({ servers: s.servers.map(sv =>
        sv.id === serverId ? { ...sv, channels: sv.channels.filter(ch => ch.id !== channelId) } : sv
      )}));
    },

    broadcastMsg: (channelId, msg) => {
      // BroadcastChannel for cross-tab sync
      try {
        const bc = new BroadcastChannel('sky:gchannels:rt');
        bc.postMessage({ type: 'msg', channelId, msg });
        bc.close();
      } catch {}
      set(s => {
        const msgs = { ...s.messages, [channelId]: [...(s.messages[channelId]??[]), msg] };
        saveGC({ messages: msgs });
        return { messages: msgs };
      });
    },
  };
});

/* --- Helpers ---------------------------------------------- */
const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru', { hour:'2-digit', minute:'2-digit' });
};
const roleColor = (server: GServer, userId: string) =>
  server.roles.find(r => r.memberIds.includes(userId) && r.color !== 'var(--t2)')?.color ?? 'var(--t1)';

const C = {
  sidebar:'#111115', content:'#16161a', input:'#1c1c22',
  border:'var(--border)', accent:'#5865f2',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
};

/* === MAIN GAMING CHANNELS ================================ */
export const GamingChannels = () => {
  const { currentUserId, accounts } = useAuthStore();
  const { servers, messages, sendMsg, joinVoice, leaveVoice, voiceChannelId, voiceMuted, voiceDeaf,
    toggleMute, toggleDeaf, joinServer, createChannel, createServer } = useGamingChannels();
  const me = accounts.find(a => a.id === currentUserId);

  const [serverId, setServerId] = useState(servers[0]?.id ?? '');
  const [channelId, setChannelId] = useState('ch-general');
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string,boolean>>({});
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [newChName, setNewChName] = useState('');
  const [newChType, setNewChType] = useState<'text'|'voice'>('text');
  const [showCreateSrv, setShowCreateSrv] = useState(false);
  const [newSrvName, setNewSrvName] = useState('');
  const [newSrvIcon, setNewSrvIcon] = useState('🎮');
  const msgEndRef = useRef<HTMLDivElement>(null);

  const handleCreateChannel = () => {
    if (!newChName.trim() || !server) return;
    const catId = newChType === 'voice'
      ? server.categories.find(cat => cat.name.toLowerCase().includes('голос'))?.id
        ?? server.categories.find(cat => cat.name.toLowerCase().includes('voice'))?.id
        ?? server.categories[server.categories.length - 1]?.id
        ?? server.categories[0]?.id
      : server.categories.find(cat => !cat.name.toLowerCase().includes('голос') && !cat.name.toLowerCase().includes('voice'))?.id
        ?? server.categories[0]?.id;
    if (!catId) return;
    const ch = createChannel(serverId, catId, newChName.trim(), newChType);
    if (newChType === 'text') setChannelId(ch.id);
    setNewChName('');
    setNewChType('text');
    setShowCreateCh(false);
  };

  const handleCreateServer = () => {
    if (!newSrvName.trim() || !currentUserId) return;
    const sv = createServer(newSrvName.trim(), newSrvIcon, currentUserId);
    setServerId(sv.id);
    setNewSrvName(''); setShowCreateSrv(false);
  };

  const handleSend = () => {
    if (!draft.trim() || !currentUserId || !me) return;
    const msg: GMessage = { id:`gm-${Date.now()}`, channelId, authorId:currentUserId, authorName:me.name, text:draft.trim(), timestamp:Date.now() };
    sendMsg(channelId, currentUserId, me.name, draft.trim());
    // Broadcast to other tabs
    try { const bc=new BroadcastChannel('sky:gchannels:rt'); bc.postMessage({type:'msg',channelId,msg}); bc.close(); } catch {}
    setDraft('');
  };

  const server  = servers.find(s => s.id === serverId);
  const channel = server?.channels.find(c => c.id === channelId);
  const msgs    = messages[channelId] ?? [];

  useEffect(() => { msgEndRef.current?.scrollIntoView(); }, [msgs.length, channelId]);

  const send = () => {
    if (!draft.trim() || !currentUserId || !me) return;
    sendMsg(channelId, currentUserId, me.name, draft.trim());
    setDraft('');
  };

  const isMember = server?.members.includes(currentUserId ?? '') ?? false;

  return (
    <>
    <div className="flex h-full overflow-hidden" style={{ background:C.content }}>

      {/* -- Server list (left strip) ----------------------- */}
      <div className="flex flex-col gap-2 p-2 shrink-0 overflow-y-auto"
        style={{ width:52, background:'#0d0d10', scrollbarWidth:'none' }}>
        {servers.map(sv => (
          <motion.button key={sv.id} type="button" whileTap={{ scale:.9 }}
            onClick={() => { setServerId(sv.id); setChannelId(sv.channels.find(c=>c.type==='text')?.id ?? ''); }}
            title={sv.name}
            className="grid h-10 w-10 place-items-center rounded-2xl text-xl shrink-0 transition-all"
            style={{
              background: serverId===sv.id ? C.accent : 'var(--border)',
              borderRadius: serverId===sv.id ? '14px' : '24px',
              boxShadow: serverId===sv.id ? `0 4px 16px ${C.accent}50` : 'none',
            }}>
            {sv.icon}
          </motion.button>
        ))}
        <div className="h-px mx-1" style={{ background:'rgba(255,255,255,0.1)' }}/>
        <button type="button" onClick={() => setShowCreateSrv(true)}
          className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-green-500/20 transition-colors shrink-0"
          title="Создать сервер" style={{ color:'#22c55e' }}>
          <Plus size={20}/>
        </button>
      </div>

      {/* -- Channel sidebar -------------------------------- */}
      {server && (
        <div className="flex flex-col shrink-0 overflow-hidden"
          style={{ width:180, background:C.sidebar, borderRight:`1px solid ${C.border}` }}>
          {/* Server name */}
          <div className="flex items-center justify-between px-3 py-3 border-b shrink-0"
            style={{ borderColor:C.border }}>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate" style={{ color:C.t1 }}>{server.name}</p>
              <p className="text-[10px]" style={{ color:C.t3 }}>{server.members.length} участников</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setShowCreateCh(true)}
                className="grid h-6 w-6 place-items-center rounded-md transition-colors hover:bg-white/10"
                title="Создать канал" style={{ color:C.t3 }}>
                <Plus size={13}/>
              </button>
              <ChevronDown size={14} style={{ color:C.t3 }}/>
            </div>
          </div>

          {/* Channels */}
          <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth:'none' }}>
            {server.categories.map(cat => (
              <div key={cat.id} className="mb-1">
                <button type="button"
                  onClick={() => setCollapsed(c => ({ ...c, [cat.id]: !c[cat.id] }))}
                  className="flex items-center gap-1 w-full px-3 py-1.5">
                  <ChevronRight size={10} style={{ color:C.t3,
                    transform: collapsed[cat.id] ? 'rotate(0deg)' : 'rotate(90deg)',
                    transition:'transform 0.15s' }}/>
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:C.t3 }}>
                    {cat.name}
                  </span>
                </button>
                {!collapsed[cat.id] && server.channels
                  .filter(ch => ch.categoryId === cat.id)
                  .map(ch => (
                    <motion.button key={ch.id} type="button" whileTap={{ scale:.97 }}
                      onClick={() => { if(ch.type==='voice'){joinVoice(ch.id);}else{setChannelId(ch.id);} }}
                      className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-lg mx-1 transition-all"
                      style={{
                        width:'calc(100% - 8px)',
                        background: channelId===ch.id ? `${C.accent}20` : voiceChannelId===ch.id ? 'rgba(34,197,94,0.12)' : 'transparent',
                        color: channelId===ch.id ? C.t1 : voiceChannelId===ch.id ? '#22c55e' : C.t2,
                      }}>
                      {ch.type==='text' ? <Hash size={14}/> : ch.type==='announce' ? <span className="text-xs">📢</span> : <Volume2 size={14}/>}
                      <span className="text-[12px] font-medium truncate flex-1 text-left">{ch.name}</span>
                      {ch.type==='voice' && ch.memberCount && ch.memberCount > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background:'rgba(34,197,94,0.2)', color:'#22c55e' }}>
                          {ch.memberCount}
                        </span>
                      )}
                    </motion.button>
                  ))
                }
              </div>
            ))}
          </div>

          {/* User bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t shrink-0"
            style={{ borderColor:C.border, background:'rgba(0,0,0,0.2)' }}>
            <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white shrink-0"
              style={{ background:C.accent }}>{me?.name[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate text-white">{me?.name}</p>
              {voiceChannelId
                ? <p className="text-[9px]" style={{ color:'#22c55e' }}>● В голосовом</p>
                : <p className="text-[9px]" style={{ color:C.t3 }}>В сети</p>
              }
            </div>
            <div className="flex gap-1">
              {voiceChannelId ? (
                <>
                  <button type="button" onClick={toggleMute}
                    className="grid h-6 w-6 place-items-center rounded" title="Мут"
                    style={{ color:voiceMuted?'var(--red)':C.t3, background:voiceMuted?'rgba(239,68,68,0.2)':'transparent' }}>
                    {voiceMuted ? <MicOff size={13}/> : <Mic size={13}/>}
                  </button>
                  <button type="button" onClick={leaveVoice}
                    className="grid h-6 w-6 place-items-center rounded hover:bg-red-500/20"
                    title="Выйти" style={{ color:'var(--red)' }}>
                    <PhoneOff size={13}/>
                  </button>
                </>
              ) : (
                <button type="button" onClick={toggleMute}
                  className="grid h-6 w-6 place-items-center rounded hover:bg-white/5"
                  style={{ color:C.t3 }}>
                  <Mic size={13}/>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* -- Main content ----------------------------------- */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {!isMember && server ? (
          /* Join prompt */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <div className="text-5xl">{server.icon}</div>
            <div className="text-center">
              <p className="text-lg font-black text-white">{server.name}</p>
              <p className="text-sm mt-1" style={{ color:C.t2 }}>{server.members.length} участников</p>
            </div>
            <motion.button whileTap={{ scale:.96 }} type="button"
              onClick={() => currentUserId && joinServer(server.id, currentUserId)}
              className="rounded-2xl px-8 py-3 text-sm font-bold text-white"
              style={{ background:C.accent }}>
              Присоединиться к серверу
            </motion.button>
          </div>
        ) : channel?.type === 'voice' || voiceChannelId ? (
          /* Voice channel UI */
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <Volume2 size={48} style={{ color:'#22c55e', opacity:0.6 }}/>
            <p className="text-base font-bold" style={{ color:C.t1 }}>
              {voiceChannelId ? `Голосовой канал: ${server?.channels.find(c=>c.id===voiceChannelId)?.name}` : 'Голосовой канал'}
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={toggleMute}
                className="flex flex-col items-center gap-1.5">
                <div className="grid h-12 w-12 place-items-center rounded-full"
                  style={{ background: voiceMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)' }}>
                  {voiceMuted ? <MicOff size={22} style={{ color:'var(--red)' }}/> : <Mic size={22} style={{ color:C.t2 }}/>}
                </div>
                <span className="text-[10px]" style={{ color:C.t3 }}>{voiceMuted?'Вкл':'Выкл'}</span>
              </button>
              <button type="button" onClick={leaveVoice}
                className="flex flex-col items-center gap-1.5">
                <div className="grid h-12 w-12 place-items-center rounded-full"
                  style={{ background:'rgba(239,68,68,0.15)' }}>
                  <PhoneOff size={22} style={{ color:'var(--red)' }}/>
                </div>
                <span className="text-[10px]" style={{ color:C.t3 }}>Выйти</span>
              </button>
            </div>
          </div>
        ) : (
          /* Text channel */
          <>
            {/* Channel header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0"
              style={{ borderColor:C.border, background:C.content }}>
              <Hash size={16} style={{ color:C.t3 }}/>
              <p className="text-sm font-bold" style={{ color:C.t1 }}>{channel?.name ?? 'канал'}</p>
              <div className="flex-1"/>
              <div className="flex items-center gap-1" style={{ color:C.t3 }}>
                <Users size={13}/>
                <span className="text-[10px]">{server?.members.length}</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ scrollbarWidth:'none' }}>
              {msgs.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 opacity-50">
                  <Hash size={32} style={{ color:C.t3 }}/>
                  <p className="text-sm" style={{ color:C.t3 }}>Начало канала #{channel?.name}</p>
                </div>
              )}
              {msgs.map((msg, i) => {
                const prev = msgs[i-1];
                const grouped = prev && prev.authorId === msg.authorId && msg.timestamp - prev.timestamp < 300000;
                const color = server ? roleColor(server, msg.authorId) : C.t1;
                return (
                  <div key={msg.id} className={grouped ? 'flex gap-2.5 hover:bg-white/[0.02] rounded-lg px-2 py-0.5 -mx-2' : 'flex gap-2.5'}>
                    {!grouped && (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white mt-0.5"
                        style={{ background:`${color}30` }}>
                        {msg.authorName[0]}
                      </div>
                    )}
                    {grouped && <div className="w-8 shrink-0"/>}
                    <div className="flex-1 min-w-0">
                      {!grouped && (
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-sm font-bold" style={{ color }}>{msg.authorName}</span>
                          <span className="text-[10px]" style={{ color:C.t3 }}>{fmtTime(msg.timestamp)}</span>
                        </div>
                      )}
                      <p className="text-sm leading-relaxed" style={{ color:C.t1 }}>{msg.text}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef}/>
            </div>

            {/* Input */}
            <div className="px-4 py-3 shrink-0">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background:C.input, border:`1px solid ${C.border}` }}>
                <input value={draft} onChange={e=>setDraft(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} }}
                  placeholder={`Сообщение в #${channel?.name}`}
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color:C.t1 }}/>
                <motion.button whileTap={{ scale:.9 }} type="button" onClick={send} disabled={!draft.trim()}>
                  <Send size={16} style={{ color:draft.trim()?C.accent:C.t3 }}/>
                </motion.button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>

  {/* Create Channel Modal */}
  {showCreateCh && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={() => setShowCreateCh(false)}>
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl p-5 space-y-4" style={{ background:'#1e1e24', border:'1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>
        <p className="text-base font-bold" style={{ color: C.t1 }}>Создать канал</p>
        <div className="grid grid-cols-2 gap-2">
          {(['text','voice'] as const).map(t => (
            <button key={t} type="button" onClick={() => setNewChType(t)}
              className="rounded-xl p-3 text-center transition-all"
              style={{ background: newChType===t ? 'rgba(88,101,242,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${newChType===t ? 'rgba(88,101,242,0.5)' : 'rgba(255,255,255,0.08)'}`,
                color: newChType===t ? C.accent : C.t3 }}>
              <div className="text-xl mb-1">{t==='text'?'#':'🔊'}</div>
              <div className="text-xs font-semibold">{t==='text'?'Текстовый':'Голосовой'}</div>
            </button>
          ))}
        </div>
        <input value={newChName} onChange={e=>setNewChName(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&handleCreateChannel()}
          placeholder="Название канала" autoFocus
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:C.t1 }}/>
        <div className="flex gap-2">
          <button type="button" onClick={()=>setShowCreateCh(false)}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ background:'rgba(255,255,255,0.06)', color:C.t3 }}>Отмена</button>
          <button type="button" onClick={handleCreateChannel} disabled={!newChName.trim()}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: C.accent }}>Создать</button>
        </div>
      </div>
    </div>
  )}

  {/* Create Server Modal */}
  {showCreateSrv && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={() => setShowCreateSrv(false)}>
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl p-5 space-y-4" style={{ background:'#1e1e24', border:'1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}>
        <p className="text-base font-bold" style={{ color: C.t1 }}>Создать сервер</p>
        <div className="flex gap-2 flex-wrap">
          {['🎮','🔫','🏆','⚔️','🎯','🎲','🌟','🔥'].map(ico => (
            <button key={ico} type="button" onClick={()=>setNewSrvIcon(ico)}
              className="w-10 h-10 rounded-xl text-xl grid place-items-center transition-all"
              style={{ background: newSrvIcon===ico ? 'rgba(88,101,242,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${newSrvIcon===ico ? 'rgba(88,101,242,0.5)' : 'transparent'}` }}>
              {ico}
            </button>
          ))}
        </div>
        <input value={newSrvName} onChange={e=>setNewSrvName(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&handleCreateServer()}
          placeholder="Название сервера" autoFocus
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:C.t1 }}/>
        <div className="flex gap-2">
          <button type="button" onClick={()=>setShowCreateSrv(false)}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
            style={{ background:'rgba(255,255,255,0.06)', color:C.t3 }}>Отмена</button>
          <button type="button" onClick={handleCreateServer} disabled={!newSrvName.trim()}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: C.accent }}>Создать</button>
        </div>
      </div>
    </div>
  )}
  </>
  );
};
