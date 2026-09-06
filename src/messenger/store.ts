import { create } from 'zustand';
import { ChatItem, MessageItem, MessageKind, ChatFolder, Report } from './types';
import { Account, useAuthStore } from '@/core/auth/store';

const W      = typeof window !== 'undefined';
const nowTs  = () => Date.now();
const nowFmt = () => new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
const pKey   = (id:string) => `sky:msg:v6:${id}`;
const getUid = () => useAuthStore.getState().currentUserId ?? '';

const load = (uid:string) => {
  if(!W||!uid) return null;
  try{ return JSON.parse(localStorage.getItem(pKey(uid))||'null'); }catch{return null;}
};
const persist = (uid:string, data:object) => {
  if(!W||!uid) return;
  try{ localStorage.setItem(pKey(uid), JSON.stringify(data)); }catch{}
};

/* --- Глобальный ключ для синхронизации между аккаунтами --------------- */
const GLOBAL_KEY = 'sky:global:msgs:v1';
const loadGlobal = () => { try{ return JSON.parse(localStorage.getItem(GLOBAL_KEY)||'{}'); }catch{return{};} };
export const saveToGlobal = (msg: MessageItem) => {
  try{
    const g = loadGlobal();
    const msgs: MessageItem[] = g.messages||[];
    if(!msgs.find(m=>m.id===msg.id)){
      msgs.push(msg);
      if(msgs.length>2000) msgs.splice(0,msgs.length-2000);
      localStorage.setItem(GLOBAL_KEY, JSON.stringify({...g,messages:msgs}));
    }
  }catch{}
};

/* --- Seed ------------------------------------------------------------- */
const SEED_CHATS_BASE: ChatItem[] = [
  {id:'team-core',   name:'Core Raiders', username:'core_raiders', avatar:'CR', online:true,  pinned:true, type:'group',   members:9,    folder:'work'},
  {id:'arena-squad', name:'Arena Squad',  username:'arena_squad',  avatar:'AS', online:true,  type:'group',   members:5,    folder:'social'},
  {id:'patch-notes', name:'Patch Notes',  username:'patch_notes',  avatar:'PN', online:true,  muted:true, type:'channel', members:1240, folder:'news', description:'Обновления Sky'},
  {id:'dm-luna',     name:'Luna Nova',    username:'luna_nova',    avatar:'LN', online:false, type:'direct', participants:['acc-kutuzov','acc-luna']},
  {id:'dm-neo',      name:'Neo Driver',   username:'neon_driver',  avatar:'ND', online:true,  type:'direct', participants:['acc-kutuzov','acc-neo']},
];

/* Адаптируем seed-чаты под конкретного юзера:
   - Показываем только чаты где юзер  -  участник
   - Для DM меняем name/username/avatar на собеседника */
const ACCOUNTS_SEED: Record<string,{name:string;username:string;avatar:string}> = {
  'acc-kutuzov': {name:'Kutuzov',    username:'kutuzov',    avatar:'KU'},
  'acc-luna':    {name:'Luna Nova',  username:'luna_nova',  avatar:'LN'},
  'acc-neo':     {name:'Neo Driver', username:'neon_driver',avatar:'ND'},
};
const seedChatsFor = (uid: string): ChatItem[] => {
  return SEED_CHATS_BASE
    .filter(c => c.type !== 'direct' || (c.participants??[]).includes(uid))
    .map(c => {
      if (c.type !== 'direct') return c;
      const peerId = (c.participants??[]).find(p=>p!==uid) ?? '';
      const peer = ACCOUNTS_SEED[peerId];
      if (!peer) return c;
      return { ...c, name: peer.name, username: peer.username, avatar: peer.avatar };
    });
};
const SEED_CHATS = seedChatsFor('acc-kutuzov'); // default for backward compat
const ago = (m:number) => ({time:new Date(Date.now()-m*60000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()-m*60000});
const SEED_MSGS: MessageItem[] = [
  {id:'m1',clientId:'m1',chatId:'team-core',   fromMe:false,authorId:'acc-luna',   kind:'text',text:'Рейд в 21:00, подтверждаем состав 🗡️',reactions:[{emoji:'🔥',userIds:['acc-neo']}],status:'read',...ago(80)},
  {id:'m2',clientId:'m2',chatId:'team-core',   fromMe:true, authorId:'acc-kutuzov',kind:'text',text:'Я в деле, беру саппорт-роль.',         reactions:[],status:'read',...ago(78)},
  {id:'m4',clientId:'m4',chatId:'arena-squad', fromMe:false,authorId:'acc-neo',    kind:'text',text:'Завтра арена в 20:00? 🏟️',             reactions:[],status:'delivered',...ago(200)},
  {id:'m5',clientId:'m5',chatId:'dm-luna',     fromMe:false,authorId:'acc-luna',   kind:'text',text:'Привет! Как дела? ☀️',                 reactions:[],status:'read',time:'Вчера',timestamp:Date.now()-86400000},
  {id:'m6',clientId:'m6',chatId:'dm-neo',      fromMe:false,authorId:'acc-neo',    kind:'text',text:'Season 5: новые карты. Готов?',         reactions:[],status:'read',...ago(150)},
  {id:'m7',clientId:'m7',chatId:'patch-notes', fromMe:false,authorId:'system',     kind:'system',text:'📋 Sky v4  -  исправлены баги.',        reactions:[],status:'read',...ago(300)},
];

type Filter = 'all'|'unread'|'direct'|'group'|'channel'|'archived';

interface S {
  chats:        ChatItem[];
  messages:     MessageItem[];
  reports:      Report[];
  blocked:      string[];
  typing:       Record<string,string[]>;
  activeChatId: string;
  search:       string;
  filter:       Filter;
  folder:       ChatFolder;
  replyToId:    string|null;
  editingId:    string|null;
  drafts:       Record<string,string>;
  quickReplies: { id: string; text: string }[];

  setActiveChat: (id:string)=>void;
  setSearch:     (v:string)=>void;
  setFilter:     (v:Filter)=>void;
  setFolder:     (v:ChatFolder)=>void;
  setReplyTo:    (id:string|null)=>void;
  startEdit:     (id:string|null)=>void;
  setTyping:     (chatId:string,user:string,on:boolean)=>void;
  sendMessage:   (p:{text:string;kind?:MessageKind;mediaUrl?:string;fileName?:string;bytes?:number;mimeType?:string;once?:boolean;spoiler?:boolean;isSilent?:boolean;selfDestruct?:number;destroyAt?:number;scheduledAt?:number})=>MessageItem|null;
  sendScheduledNow: (id:string)=>void;
  cancelScheduled:  (id:string)=>void;
  editScheduled:    (id:string,text:string,scheduledAt:number)=>void;
  editMessage:   (id:string,text:string)=>void;
  deleteMessage: (id:string)=>void;
  pinMessage:    (id:string)=>void;
  toggleFavoriteMessage: (id:string)=>void;
  pinChat:       (id:string)=>void;
  archiveChat:   (id:string)=>void;
  muteChat:      (id:string)=>void;
  blockUser:     (username:string)=>void;
  react:         (msgId:string,emoji:string)=>void;
  forward:       (id:string)=>MessageItem|null;
  markRead:      (chatId:string)=>void;
  startDM:       (account:Account)=>ChatItem|null;
  createChat:    (p:{name:string;type:'group'|'channel';description?:string;memberIds?:string[]})=>string;
  addParticipant:(chatId:string,userId:string,userName:string)=>void;
  addReport:     (p:Omit<Report,'id'|'createdAt'|'status'>)=>void;
  resolveReport: (id:string,status:Report['status'])=>void;
  injectMessage: (msg:MessageItem)=>void;
  setChatDraft:  (chatId:string,text:string)=>void;
  addQuickReply:    (text:string)=>void;
  removeQuickReply: (id:string)=>void;
  markChannelViewed: (chatId:string)=>void;
}

const uid0 = getUid();
const saved = uid0 ? load(uid0) : null;

/* Подгружаем глобальные сообщения от других аккаунтов */
const globalMsgs: MessageItem[] = loadGlobal().messages||[];

const mergeMsgs = (own: MessageItem[], global: MessageItem[]): MessageItem[] => {
  const ids = new Set(own.map(m=>m.id));
  return [...own, ...global.filter(m=>!ids.has(m.id))];
};

const recomputeFromMe = (msgs: MessageItem[], uid: string): MessageItem[] =>
  msgs.map(m => ({ ...m, fromMe: m.authorId === uid && m.kind !== 'system' }));

const _typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useMessengerStore = create<S>((set,get) => {
  const flush = () => {
    const uid = getUid(); if(!uid) return;
    const s = get();
    persist(uid, {
      chats:        s.chats,
      messages:     s.messages.map(m=>({...m,mediaUrl:m.mediaUrl?.startsWith('blob:')?undefined:m.mediaUrl})),
      reports:      s.reports,
      blocked:      s.blocked,
      activeChatId: s.activeChatId,
      filter:       s.filter,
      folder:       s.folder,
      drafts:       s.drafts,
      quickReplies: s.quickReplies,
    });
  };

  const mut = (fn:(s:S)=>Partial<S>) => { set(s=>({...s,...fn(s)})); flush(); };

  const upStatus = (msgId:string, status:MessageItem['status']) =>
    mut(s=>({messages:s.messages.map(m=>m.id===msgId?{...m,status}:m)}));

  const deliver = (id:string) => {
    setTimeout(()=>upStatus(id,'delivered'),600+Math.random()*400);
    setTimeout(()=>upStatus(id,'read'),1600+Math.random()*800);
  };

  /* Реальный тикер отложенных сообщений — раз в 10с проверяет, не настало
     ли время отправки, и «доставляет» сообщение по-настоящему (а не
     просто визуально помечает как отправленное). */
  if (W) {
    setInterval(() => {
      const now = Date.now();
      const due = get().messages.filter(m => m.isScheduled && m.scheduledAt && m.scheduledAt <= now);
      if (due.length === 0) return;
      mut(s => ({
        messages: s.messages.map(m =>
          m.isScheduled && m.scheduledAt && m.scheduledAt <= now
            ? { ...m, isScheduled: false, scheduledAt: undefined, timestamp: nowTs(), time: nowFmt() }
            : m),
      }));
      due.forEach(m => deliver(m.id));
    }, 10000);
  }

  return {
    chats:        saved?.chats        ?? SEED_CHATS,
    messages:     recomputeFromMe(saved ? mergeMsgs(saved.messages??[], globalMsgs) : mergeMsgs(SEED_MSGS, globalMsgs), uid0 ?? ''),
    reports:      saved?.reports      ?? [],
    blocked:      saved?.blocked      ?? [],
    typing:       {},
    activeChatId: saved?.activeChatId ?? 'team-core',
    search:       '',
    filter:       (saved?.filter      ?? 'all') as Filter,
    folder:       (saved?.folder      ?? 'all') as ChatFolder,
    replyToId:    null,
    editingId:    null,
    drafts:       saved?.drafts       ?? {},
    quickReplies: saved?.quickReplies ?? [],

    setActiveChat: id => mut(()=>({activeChatId:id,replyToId:null,editingId:null})),
    setSearch:     v  => set({search:v}),
    setFilter:     v  => mut(()=>({filter:v})),
    setFolder:     v  => mut(()=>({folder:v})),
    setReplyTo:    id => set({replyToId:id}),
    startEdit:     id => set({editingId:id}),

    // Auto-expire typing indicator after 4s (handles closed tabs / network drops)
    setTyping:(chatId,user,on)=>{
      set(s=>{
        const prev=s.typing[chatId]??[];
        return{typing:{...s.typing,[chatId]:on?[...new Set([...prev,user])]:prev.filter(x=>x!==user)}};
      });
      const key=`${chatId}::${user}`;
      if(on){
        const existing=_typingTimers.get(key);
        if(existing) clearTimeout(existing);
        _typingTimers.set(key, setTimeout(()=>{
          _typingTimers.delete(key);
          set(s=>({typing:{...s.typing,[chatId]:(s.typing[chatId]??[]).filter(x=>x!==user)}}));
        },4000));
      } else {
        const existing=_typingTimers.get(key);
        if(existing){ clearTimeout(existing); _typingTimers.delete(key); }
      }
    },

    sendMessage:({text,kind='text',mediaUrl,fileName,bytes,mimeType,once,spoiler,isSilent,selfDestruct,destroyAt,scheduledAt})=>{
      const val=text.trim();
      if(!val&&kind==='text') return null;
      const me=getUid();
      if(!me) return null;
      const {activeChatId,chats,blocked,replyToId,messages}=get();
      const chat=chats.find(c=>c.id===activeChatId);
      if(chat&&blocked.includes(chat.username??'')) return null;
      const id=crypto.randomUUID();
      if(messages.some(m=>m.clientId===id)) return null;
      const isScheduled = !!scheduledAt && scheduledAt > Date.now();
      const msg:MessageItem={
        id,clientId:id,chatId:activeChatId,
        fromMe:true,authorId:me,
        kind,text:val,mediaUrl,fileName,bytes,mimeType,
        replyToId:replyToId??undefined,
        reactions:[],time:nowFmt(),timestamp:nowTs(),status:'sent',
        once, spoiler, isSilent, selfDestruct, destroyAt,
        scheduledAt: isScheduled ? scheduledAt : undefined,
        isScheduled,
      };
      mut(s=>({messages:[...s.messages,msg],replyToId:null,editingId:null}));
      // отложенные сообщения не «доставляем» сразу — они не входят в чат,
      // пока не наступит время (см. tickScheduled)
      if(!isScheduled) deliver(id);
      return msg; // возвращаем для BroadcastChannel в ChatWindow
    },

    /** Реально отправляет запланированное сообщение раньше срока, либо
        глобальный тикер делает то же самое сам, когда наступает время. */
    sendScheduledNow: (id) => {
      const msg = get().messages.find(m=>m.id===id);
      if (!msg || !msg.isScheduled) return;
      mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,isScheduled:false,scheduledAt:undefined,timestamp:nowTs(),time:nowFmt()}:m)}));
      deliver(id);
    },
    cancelScheduled: (id) => {
      mut(s=>({messages:s.messages.filter(m=>m.id!==id)}));
    },
    editScheduled: (id, text, scheduledAt) => {
      mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,text:text.trim(),scheduledAt}:m)}));
    },

    editMessage:(id,text)=>{
      const val=text.trim(); if(!val) return;
      mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,text:val,editedAt:nowFmt()}:m),editingId:null}));
    },

    deleteMessage:id=>mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,deleted:true,text:'Сообщение удалено',mediaUrl:undefined}:m)})),
    pinMessage:   id=>mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,pinned:!m.pinned}:m)})),
    toggleFavoriteMessage: id=>mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,favorited:!m.favorited}:m)})),
    pinChat:      id=>mut(s=>({chats:s.chats.map(c=>c.id===id?{...c,pinned:!c.pinned}:c)})),
    archiveChat:  id=>mut(s=>({chats:s.chats.map(c=>c.id===id?{...c,archived:!c.archived}:c)})),
    muteChat:     id=>mut(s=>({chats:s.chats.map(c=>c.id===id?{...c,muted:!c.muted}:c)})),
    blockUser:    u =>mut(s=>({blocked:s.blocked.includes(u)?s.blocked.filter(x=>x!==u):[...s.blocked,u]})),

    react:(msgId,emoji)=>{
      const me=getUid(); if(!me) return;
      mut(s=>({messages:s.messages.map(msg=>{
        if(msg.id!==msgId) return msg;
        const ex=msg.reactions.find(r=>r.emoji===emoji);
        if(!ex) return{...msg,reactions:[...msg.reactions,{emoji,userIds:[me]}]};
        const ids=ex.userIds.includes(me)?ex.userIds.filter(u=>u!==me):[...ex.userIds,me];
        return{...msg,reactions:ids.length===0?msg.reactions.filter(r=>r.emoji!==emoji):msg.reactions.map(r=>r.emoji===emoji?{...r,userIds:ids}:r)};
      })}));
    },

    forward:id=>{
      const m=get().messages.find(m=>m.id===id); if(!m) return;
      return get().sendMessage({text:`↪ ${m.text}`,kind:m.kind,mediaUrl:m.mediaUrl,fileName:m.fileName});
    },

    markRead:chatId=>mut(s=>({messages:s.messages.map(m=>
      m.chatId===chatId&&!m.fromMe&&m.status!=='read'?{...m,status:'read'}:m
    )})),

    startDM:account=>{
      const me=getUid(); if(!me||account.id===me) return null;
      const ex=get().chats.find(c=>c.type==='direct'&&c.participants?.includes(account.id)&&c.participants?.includes(me));
      if(ex){mut(()=>({activeChatId:ex.id}));return ex;}
      const nc:ChatItem={
        id:`dm-${account.id}`,name:account.name,username:account.username,
        avatar:account.name.slice(0,2).toUpperCase(),online:true,
        type:'direct',participants:[me,account.id],folder:'social',
      };
      mut(s=>({chats:[nc,...s.chats],activeChatId:nc.id}));
      return nc;
    },

    createChat:({name,type,description,memberIds=[]})=>{
      const me=getUid(); if(!me) return '';
      const id=`${type}-${crypto.randomUUID().slice(0,8)}`;
      const nc:ChatItem={
        id,name,username:name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''),
        avatar:name.slice(0,2).toUpperCase(),online:true,type,
        members:memberIds.length+1,description,ownerId:me,
        participants:[me,...memberIds],folder:'social',
      };
      const sys:MessageItem={
        id:crypto.randomUUID(),clientId:crypto.randomUUID(),chatId:id,
        fromMe:false,authorId:'system',kind:'system',
        text:`${type==='group'?'Группа':'Канал'} «${name}» создан`,
        reactions:[],time:nowFmt(),timestamp:nowTs(),status:'read',
      };
      mut(s=>({chats:[nc,...s.chats],messages:[...s.messages,sys],activeChatId:id}));
      return id;
    },

    addParticipant:(chatId,userId,userName)=>{
      const sys:MessageItem={
        id:crypto.randomUUID(),clientId:crypto.randomUUID(),chatId,
        fromMe:false,authorId:'system',kind:'system',
        text:`${userName} добавлен(а) в чат`,
        reactions:[],time:nowFmt(),timestamp:nowTs(),status:'read',
      };
      mut(s=>({
        chats:s.chats.map(c=>{
          if(c.id!==chatId) return c;
          if((c.participants??[]).includes(userId)) return c;
          return {...c,participants:[...(c.participants??[]),userId],members:(c.members??1)+1};
        }),
        messages:[...s.messages,sys],
      }));
      // Приветственное сообщение группы (если включено в настройках) —
      // читаем через глобальный доступ к groupStore, чтобы не тянуть
      // циклическую зависимость между модулями стора.
      import('./groupStore').then(({ useGroupStore }) => {
        const settings = useGroupStore.getState().getSettings(chatId);
        if (!settings.welcomeEnabled || !settings.welcomeMessage.trim()) return;
        const welcome:MessageItem={
          id:crypto.randomUUID(),clientId:crypto.randomUUID(),chatId,
          fromMe:false,authorId:'system',kind:'system',
          text:settings.welcomeMessage,
          reactions:[],time:nowFmt(),timestamp:nowTs(),status:'read',
        };
        mut(s=>({messages:[...s.messages,welcome]}));
        useGroupStore.getState().log(chatId, 'member_joined', `${userName} присоединил${userName.endsWith('а')?'ась':'ся'} к группе`, userId);
      });
    },

    addReport:p=>{
      const r:Report={...p,id:`rep-${crypto.randomUUID()}`,createdAt:new Date().toISOString(),status:'pending'};
      mut(s=>({reports:[r,...s.reports]}));
    },
    resolveReport:(id,status)=>mut(s=>({reports:s.reports.map(r=>r.id===id?{...r,status}:r)})),

    /* Вызывается из socket.ts при получении входящего сообщения */
    injectMessage:(msg:MessageItem)=>{
      const me = getUid();
      set(s=>{
        if(s.messages.find(m=>m.id===msg.id)) return {};
        const isActive = s.activeChatId===msg.chatId;
        const fromMe = msg.authorId === me && msg.kind !== 'system';
        return {messages:[...s.messages,{...msg,fromMe,status:isActive?'read':'delivered'}]};
      });
      flush();
    },

    setChatDraft: (chatId, text) => mut(s => ({
      drafts: text.trim() ? { ...s.drafts, [chatId]: text } : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== chatId)),
    })),

    addQuickReply: (text) => {
      const t = text.trim(); if (!t) return;
      mut(s => ({ quickReplies: [...s.quickReplies, { id: crypto.randomUUID(), text: t }] }));
    },
    removeQuickReply: (id) => mut(s => ({ quickReplies: s.quickReplies.filter(q => q.id !== id) })),

    /** Реальный трекинг просмотров канала: при открытии канала все уже
        загруженные посты помечаются просмотренными текущим пользователем
        (без дублей) — используется для честной аналитики охвата. */
    markChannelViewed: (chatId) => {
      const uid = getUid(); if (!uid) return;
      mut(s => ({
        messages: s.messages.map(m =>
          m.chatId === chatId && !(m.viewedBy ?? []).includes(uid)
            ? { ...m, viewedBy: [...(m.viewedBy ?? []), uid] }
            : m),
      }));
    },
  };
});

/* --- Перезагрузка данных при смене аккаунта ------------------------------- */
export const reloadMessengerForUser = (uid: string) => {
  const saved = uid ? load(uid) : null;
  const globalMsgs2: MessageItem[] = loadGlobal().messages || [];
  const raw = saved ? mergeMsgs(saved.messages ?? [], globalMsgs2) : mergeMsgs(SEED_MSGS, globalMsgs2);
  useMessengerStore.setState({
    chats:        saved?.chats    ?? seedChatsFor(uid),
    messages:     recomputeFromMe(raw, uid),
    reports:      saved?.reports  ?? [],
    blocked:      saved?.blocked  ?? [],
    activeChatId: saved?.activeChatId ?? 'team-core',
    filter:       (saved?.filter  ?? 'all') as Filter,
    folder:       (saved?.folder  ?? 'all') as any,
    search:       '',
    replyToId:    null,
    editingId:    null,
    typing:       {},
    drafts:       saved?.drafts       ?? {},
    quickReplies: saved?.quickReplies ?? [],
  });
};
