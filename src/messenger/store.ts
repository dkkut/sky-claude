import { create } from 'zustand';
import { ChatItem, MessageItem, MessageKind, ChatFolder, Report } from './types';
import { useAuthStore } from '@/core/auth/store';
import { wireSend } from '@/core/wire';

const W      = typeof window !== 'undefined';
const nowTs  = () => Date.now();
const nowFmt = () => new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
const pKey   = (id:string) => `sky:msg:v7:${id}`;
const getUid = () => useAuthStore.getState().currentUserId ?? '';

/**
 * Локальное хранилище — только кэш, чтобы список чатов не был пустым в
 * первую секунду после запуска и в офлайне. Источник истины — сервер:
 * при подключении его снимок заменяет всё, что здесь лежало.
 *
 * До этого переписка жила в localStorage целиком, и «отправленное»
 * сообщение существовало ровно в том браузере, где его набрали.
 */
const load = (uid:string) => {
  if(!W||!uid) return null;
  try{ return JSON.parse(localStorage.getItem(pKey(uid))||'null'); }catch{return null;}
};
const persist = (uid:string, data:object) => {
  if(!W||!uid) return;
  try{ localStorage.setItem(pKey(uid), JSON.stringify(data)); }catch{}
};

/** Человек в справочнике: то немногое, что нужно, чтобы его подписать. */
export interface Person { id:string; name:string; username:string; avatar?:string }

type Filter = 'all'|'unread'|'direct'|'group'|'channel'|'archived';

/** Идентификатор личного чата — тот же, что считает сервер (chats.mjs). */
export const directChatId = (a:string,b:string) => `dm-${[a,b].sort().join('~')}`;

interface S {
  chats:        ChatItem[];
  messages:     MessageItem[];
  people:       Record<string,Person>;
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
  connected:    boolean;
  synced:       boolean;
  /** Растёт при каждом открытии чата — даже если открыли тот же самый. */
  openSeq:      number;
  /** Чаты, для которых сервер уже сказал «раньше ничего нет». */
  historyDone:  Record<string, boolean>;
  loadingOlder: Record<string, boolean>;

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
  blockUser:     (userId:string)=>void;
  unblockUser:   (userId:string)=>void;
  loadOlder:     (chatId:string)=>void;
  leaveChat:     (chatId:string)=>void;
  addMember:     (chatId:string,userId:string)=>void;
  react:         (msgId:string,emoji:string)=>void;
  forward:       (id:string)=>MessageItem|null;
  markRead:      (chatId:string)=>void;
  startDM:       (person:Person)=>ChatItem|null;
  createChat:    (p:{name:string;type:'group'|'channel';description?:string;memberIds?:string[]})=>string;
  addParticipant:(chatId:string,userId:string,userName:string)=>void;
  addReport:     (p:Omit<Report,'id'|'createdAt'|'status'>)=>void;
  resolveReport: (id:string,status:Report['status'])=>void;
  setChatDraft:  (chatId:string,text:string)=>void;
  addQuickReply:    (text:string)=>void;
  removeQuickReply: (id:string)=>void;
  markChannelViewed: (chatId:string)=>void;

  /* ── Приезжает с сервера (socket.ts) ─────────────────────────────── */
  applyChats:     (chats:ChatItem[],people:Person[])=>void;
  applyChat:      (chat:ChatItem,people:Person[])=>void;
  dropChat:       (chatId:string)=>void;
  applyMessages:  (chatId:string,msgs:MessageItem[])=>void;
  applyIncoming:  (msg:MessageItem)=>void;
  applyConfirmed: (msg:MessageItem)=>void;
  applyEdited:    (id:string,text:string,editedAt?:string)=>void;
  applyDeleted:   (id:string)=>void;
  applyReaction:  (msgId:string,emoji:string,userId:string,removed:boolean)=>void;
  applyRead:      (ids:string[])=>void;
  applyOlder:     (chatId:string,msgs:MessageItem[],done:boolean)=>void;
  applyBlocked:   (ids:string[])=>void;
  applyChatGone:  (chatId:string)=>void;
  applyOnline:    (ids:Set<string>)=>void;
  setConnected:   (v:boolean)=>void;
  markSynced:     ()=>void;
}

const indexPeople = (list:Person[]):Record<string,Person> =>
  Object.fromEntries((list??[]).filter(p=>p?.id).map(p=>[p.id,p]));

const uid0 = getUid();
const saved = uid0 ? load(uid0) : null;

const _typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useMessengerStore = create<S>((set,get) => {
  const flush = () => {
    const uid = getUid(); if(!uid) return;
    const s = get();
    persist(uid, {
      chats:        s.chats,
      // blob:-ссылки живут только в текущей вкладке — сохранять их
      // бессмысленно, после перезагрузки они уже никуда не ведут.
      messages:     s.messages.map(m=>({...m,mediaUrl:m.mediaUrl?.startsWith('blob:')?undefined:m.mediaUrl})),
      people:       s.people,
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

  /* Тикер отложенных сообщений: когда наступает срок, сообщение
     действительно уходит на сервер, а не просто перестаёт быть серым. */
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
      due.forEach(m => wireSend({ type:'send-message', payload:{ chatId:m.chatId,
        message:{ ...m, isScheduled:false, scheduledAt:undefined } } }));
    }, 10000);
  }

  return {
    chats:        saved?.chats    ?? [],
    messages:     saved?.messages ?? [],
    people:       saved?.people   ?? {},
    reports:      saved?.reports  ?? [],
    blocked:      saved?.blocked  ?? [],
    typing:       {},
    activeChatId: saved?.activeChatId ?? '',
    search:       '',
    filter:       (saved?.filter      ?? 'all') as Filter,
    folder:       (saved?.folder      ?? 'all') as ChatFolder,
    replyToId:    null,
    editingId:    null,
    drafts:       saved?.drafts       ?? {},
    quickReplies: saved?.quickReplies ?? [],
    connected:    false,
    synced:       false,
    openSeq:      0,
    historyDone:  {},
    loadingOlder: {},

    // Счётчик растёт всегда, даже если открыли уже открытый чат: на
    // телефоне переход в окно переписки следит именно за ним.
    setActiveChat: id => { mut(s=>({activeChatId:id,replyToId:null,editingId:null,openSeq:s.openSeq+1})); },
    setSearch:     v  => set({search:v}),
    setFilter:     v  => mut(()=>({filter:v})),
    setFolder:     v  => mut(()=>({folder:v})),
    setReplyTo:    id => set({replyToId:id}),
    startEdit:     id => set({editingId:id}),

    // Индикатор набора гаснет сам через 4 секунды: вкладку могли просто
    // закрыть, и «печатает…» осталось бы висеть навсегда.
    setTyping:(chatId,user,on)=>{
      if(!chatId||!user) return;
      set(s=>{
        const prev=s.typing[chatId]??[];
        return{typing:{...s.typing,[chatId]:on?[...new Set([...prev,user])]:prev.filter(x=>x!==user)}};
      });
      const key=`${chatId}::${user}`;
      const existing=_typingTimers.get(key);
      if(existing){ clearTimeout(existing); _typingTimers.delete(key); }
      if(on){
        _typingTimers.set(key, setTimeout(()=>{
          _typingTimers.delete(key);
          set(s=>({typing:{...s.typing,[chatId]:(s.typing[chatId]??[]).filter(x=>x!==user)}}));
        },4000));
      }
    },

    sendMessage:({text,kind='text',mediaUrl,fileName,bytes,mimeType,once,spoiler,isSilent,selfDestruct,destroyAt,scheduledAt})=>{
      const val=text.trim();
      if(!val&&kind==='text') return null;
      const me=getUid();
      if(!me) return null;
      const {activeChatId,chats,blocked,replyToId}=get();
      if(!activeChatId) return null;
      const chat=chats.find(c=>c.id===activeChatId);
      // Запрет действует и на сервере — здесь только чтобы не рисовать
      // сообщение, которое всё равно не уйдёт.
      const peer=chat?.type==='direct'?(chat.participants??[]).find(p=>p!==me):undefined;
      if(peer&&blocked.includes(peer)) return null;
      const id=crypto.randomUUID();
      const isScheduled = !!scheduledAt && scheduledAt > Date.now();
      const msg:MessageItem={
        id,clientId:id,chatId:activeChatId,
        fromMe:true,authorId:me,
        kind,text:val,mediaUrl,fileName,bytes,mimeType,
        replyToId:replyToId??undefined,
        reactions:[],time:nowFmt(),timestamp:nowTs(),
        // «В очереди» до подтверждения сервера: раньше сообщение сразу
        // рисовалось отправленным, даже когда связи не было вовсе.
        status:'queued',
        once, spoiler, isSilent, selfDestruct, destroyAt,
        scheduledAt: isScheduled ? scheduledAt : undefined,
        isScheduled,
      };
      mut(s=>({messages:[...s.messages,msg],replyToId:null,editingId:null}));
      return msg; // отправку делает вызывающий через broadcast.message
    },

    /** Отправляет отложенное раньше срока. */
    sendScheduledNow: (id) => {
      const msg = get().messages.find(m=>m.id===id);
      if (!msg || !msg.isScheduled) return;
      mut(s=>({messages:s.messages.map(m=>m.id===id?{...m,isScheduled:false,scheduledAt:undefined,timestamp:nowTs(),time:nowFmt()}:m)}));
      wireSend({ type:'send-message', payload:{ chatId:msg.chatId,
        message:{ ...msg, isScheduled:false, scheduledAt:undefined } } });
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
    // Запрет теперь серверный: браузер только просит и показывает.
    blockUser:   id => wireSend({type:'block-user',payload:{userId:id}}),
    unblockUser: id => wireSend({type:'unblock-user',payload:{userId:id}}),

    /** Просит страницу переписки постарше той, что уже показана. */
    loadOlder: (chatId) => {
      const s = get();
      if (!chatId || s.historyDone[chatId] || s.loadingOlder[chatId]) return;
      const oldest = s.messages
        .filter(m => m.chatId === chatId && !m.isScheduled && m.status !== 'queued')
        .sort((a,b)=>a.timestamp-b.timestamp)[0];
      if (!oldest) return;
      set(st => ({ loadingOlder: { ...st.loadingOlder, [chatId]: true } }));
      wireSend({ type:'get-messages', payload:{ chatId, limit: 50, before: oldest.id } });
    },

    leaveChat: (chatId) => { if (chatId) wireSend({type:'leave-chat',payload:{chatId}}); },
    addMember: (chatId,userId) => {
      if (chatId && userId) wireSend({type:'add-member',payload:{chatId,userId}});
    },

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
      const m=get().messages.find(m=>m.id===id); if(!m) return null;
      return get().sendMessage({text:`↪ ${m.text}`,kind:m.kind,mediaUrl:m.mediaUrl,fileName:m.fileName});
    },

    markRead:chatId=>{
      if(!chatId) return;
      const has = get().messages.some(m=>m.chatId===chatId&&!m.fromMe&&m.status!=='read');
      mut(s=>({messages:s.messages.map(m=>
        m.chatId===chatId&&!m.fromMe&&m.status!=='read'?{...m,status:'read'}:m
      )}));
      // Сервер считает галочки у отправителя — сообщаем ему о прочтении.
      if(has) wireSend({type:'read-messages',payload:{chatId}});
    },

    /**
     * Открывает личный чат. Идентификатор выводится из пары собеседников
     * и совпадает с тем, что считает сервер: иначе у каждой стороны
     * получался бы свой чат и своя половина разговора.
     */
    startDM:person=>{
      const me=getUid(); if(!me||!person?.id||person.id===me) return null;
      const id=directChatId(me,person.id);
      const ex=get().chats.find(c=>c.id===id);
      if(ex){mut(st=>({activeChatId:ex.id,openSeq:st.openSeq+1}));return ex;}
      const nc:ChatItem={
        id,name:person.name,username:person.username,
        avatar:(person.name||'?').slice(0,2).toUpperCase(),online:false,
        type:'direct',participants:[me,person.id],folder:'social',
      };
      mut(s=>({
        chats:[nc,...s.chats],
        people:{...s.people,[person.id]:person},
        activeChatId:nc.id,
        openSeq:s.openSeq+1,
      }));
      return nc;
    },

    createChat:({name,type,description,memberIds=[]})=>{
      const me=getUid(); if(!me) return '';
      // Формат id проверяет и сервер: он должен совпадать с тем, что
      // разрешено в chats.mjs, иначе создание будет отклонено.
      const id=`${type}-${crypto.randomUUID().slice(0,8)}`;
      const nc:ChatItem={
        id,name,username:name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''),
        avatar:name.slice(0,2).toUpperCase(),online:false,type,
        members:memberIds.length+1,description,ownerId:me,
        participants:[me,...memberIds],folder:'social',
      };
      mut(s=>({chats:[nc,...s.chats],activeChatId:id,openSeq:s.openSeq+1}));
      return id;
    },

    /**
     * Локальная пометка о новом участнике. Состав чата на сервере
     * задаётся при создании; отдельной операции «добавить» пока нет,
     * поэтому здесь только запись в ленте, без прав в чате.
     */
    addParticipant:(chatId,userId,userName)=>{
      mut(s=>({
        chats:s.chats.map(c=>{
          if(c.id!==chatId) return c;
          if((c.participants??[]).includes(userId)) return c;
          return {...c,participants:[...(c.participants??[]),userId],members:(c.members??1)+1};
        }),
      }));
      import('./groupStore').then(({ useGroupStore }) => {
        useGroupStore.getState().log(chatId, 'member_joined',
          `${userName} присоединил${userName.endsWith('а')?'ась':'ся'} к группе`, userId);
      });
    },

    addReport:p=>{
      const r:Report={...p,id:`rep-${crypto.randomUUID()}`,createdAt:new Date().toISOString(),status:'pending'};
      mut(s=>({reports:[r,...s.reports]}));
    },
    resolveReport:(id,status)=>mut(s=>({reports:s.reports.map(r=>r.id===id?{...r,status}:r)})),

    setChatDraft: (chatId, text) => mut(s => ({
      drafts: text.trim() ? { ...s.drafts, [chatId]: text } : Object.fromEntries(Object.entries(s.drafts).filter(([k]) => k !== chatId)),
    })),

    addQuickReply: (text) => {
      const t = text.trim(); if (!t) return;
      mut(s => ({ quickReplies: [...s.quickReplies, { id: crypto.randomUUID(), text: t }] }));
    },
    removeQuickReply: (id) => mut(s => ({ quickReplies: s.quickReplies.filter(q => q.id !== id) })),

    markChannelViewed: (chatId) => {
      const uid = getUid(); if (!uid) return;
      mut(s => ({
        messages: s.messages.map(m =>
          m.chatId === chatId && !(m.viewedBy ?? []).includes(uid)
            ? { ...m, viewedBy: [...(m.viewedBy ?? []), uid] }
            : m),
      }));
    },

    /* ══ Данные с сервера ══════════════════════════════════════════════
       Снимок сервера — источник истины. Локально переживают его только
       отложенные сообщения: их ещё никто не отправлял.               */

    applyChats:(chats,people)=>mut(s=>{
      const fromServer=new Set(chats.map(c=>c.id));
      // Чат, который только что открыли, а сервер о нём ещё не знает
      // (создание висит в очереди), не выбрасываем: вместе с ним
      // пропало бы уже написанное в него сообщение.
      const pending=s.chats.filter(c=>!fromServer.has(c.id)
        && s.messages.some(m=>m.chatId===c.id&&(m.status==='queued'||m.isScheduled)));
      const all=[...pending,...chats];
      const ids=new Set(all.map(c=>c.id));
      return {
        chats:all,
        people:{...s.people,...indexPeople(people)},
        messages:s.messages.filter(m=>ids.has(m.chatId)||m.isScheduled),
        // Сам чат не выбираем: выбирал первый попавшийся, и на телефоне
        // нажатие по нему уже ничего не меняло — окно переписки не
        // открывалось вовсе. Пусто значит «ничего не открыто».
        activeChatId:ids.has(s.activeChatId)?s.activeChatId:'',
      };
    }),

    applyChat:(chat,people)=>mut(s=>({
      chats:s.chats.some(c=>c.id===chat.id)
        ? s.chats.map(c=>c.id===chat.id?{...c,...chat}:c)
        : [chat,...s.chats],
      people:{...s.people,...indexPeople(people)},
    })),

    dropChat:(chatId)=>mut(s=>({
      chats:s.chats.filter(c=>c.id!==chatId),
      messages:s.messages.filter(m=>m.chatId!==chatId),
      activeChatId:s.activeChatId===chatId?'':s.activeChatId,
    })),

    applyMessages:(chatId,msgs)=>{
      if(!chatId) return;
      mut(s=>({
        messages:[
          // Своё неотправленное и отложенное сохраняем: сервер о нём
          // ещё не знает, а выбросить — значит потерять написанное.
          ...s.messages.filter(m=>m.chatId!==chatId||m.isScheduled||m.status==='queued'),
          ...msgs.filter(m=>!s.messages.some(o=>o.id===m.id&&(o.isScheduled||o.status==='queued'))),
        ].sort((a,b)=>a.timestamp-b.timestamp),
      }));
    },

    applyIncoming:(msg)=>{
      if(!msg?.id) return;
      mut(s=>{
        if(s.messages.some(m=>m.id===msg.id)) return {};
        const isActive=s.activeChatId===msg.chatId;
        return {messages:[...s.messages,{...msg,status:msg.fromMe?msg.status:(isActive?'read':'delivered')}]
          .sort((a,b)=>a.timestamp-b.timestamp)};
      });
      // Открытый чат сразу отмечаем прочитанным — иначе у отправителя
      // сообщение так и висело бы недоставленным.
      if(!msg.fromMe && get().activeChatId===msg.chatId) {
        wireSend({type:'read-messages',payload:{chatId:msg.chatId}});
      }
    },

    applyConfirmed:(msg)=>{
      if(!msg?.id) return;
      mut(s=>({
        messages:s.messages.some(m=>m.id===msg.id)
          ? s.messages.map(m=>m.id===msg.id?{...m,...msg,mediaUrl:m.mediaUrl??msg.mediaUrl}:m)
          : [...s.messages,msg].sort((a,b)=>a.timestamp-b.timestamp),
      }));
    },

    applyEdited:(id,text,editedAt)=>mut(s=>({
      messages:s.messages.map(m=>m.id===id?{...m,text,editedAt:editedAt??nowFmt()}:m),
    })),

    applyDeleted:(id)=>mut(s=>({
      messages:s.messages.map(m=>m.id===id
        ?{...m,deleted:true,text:'Сообщение удалено',mediaUrl:undefined,reactions:[]}:m),
    })),

    applyReaction:(msgId,emoji,userId,removed)=>mut(s=>({
      messages:s.messages.map(m=>{
        if(m.id!==msgId) return m;
        const ex=m.reactions.find(r=>r.emoji===emoji);
        if(removed){
          if(!ex) return m;
          const ids=ex.userIds.filter(u=>u!==userId);
          return {...m,reactions:ids.length
            ?m.reactions.map(r=>r.emoji===emoji?{...r,userIds:ids}:r)
            :m.reactions.filter(r=>r.emoji!==emoji)};
        }
        if(!ex) return {...m,reactions:[...m.reactions,{emoji,userIds:[userId]}]};
        if(ex.userIds.includes(userId)) return m;
        return {...m,reactions:m.reactions.map(r=>r.emoji===emoji?{...r,userIds:[...r.userIds,userId]}:r)};
      }),
    })),

    /** Дописывает подгруженную страницу к началу ленты. */
    applyOlder:(chatId,msgs,done)=>{
      mut(s=>{
        const have = new Set(s.messages.map(m=>m.id));
        const fresh = msgs.filter(m=>!have.has(m.id));
        return {
          messages: [...fresh, ...s.messages].sort((a,b)=>a.timestamp-b.timestamp),
          historyDone: { ...s.historyDone, [chatId]: done || fresh.length === 0 },
          loadingOlder: { ...s.loadingOlder, [chatId]: false },
        };
      });
    },

    applyBlocked:(ids)=>mut(()=>({blocked:ids??[]})),

    /** Чат распущен или мы из него вышли. */
    applyChatGone:(chatId)=>mut(s=>({
      chats: s.chats.filter(c=>c.id!==chatId),
      messages: s.messages.filter(m=>m.chatId!==chatId),
      activeChatId: s.activeChatId===chatId ? '' : s.activeChatId,
    })),

    applyRead:(ids)=>{
      if(!ids?.length) return;
      const set2=new Set(ids);
      mut(s=>({messages:s.messages.map(m=>set2.has(m.id)&&m.fromMe?{...m,status:'read'}:m)}));
    },

    applyOnline:(ids)=>set(s=>({
      chats:s.chats.map(c=>{
        if(c.type!=='direct') return c;
        const online=(c.participants??[]).some(p=>p!==getUid()&&ids.has(p));
        return c.online===online?c:{...c,online};
      }),
    })),

    setConnected:(v)=>set({connected:v,...(v?{}:{synced:false})}),
    markSynced:()=>set({connected:true,synced:true}),
  };
});

/* --- Перезагрузка данных при смене аккаунта ------------------------------- */
export const reloadMessengerForUser = (uid: string) => {
  const saved2 = uid ? load(uid) : null;
  useMessengerStore.setState({
    chats:        saved2?.chats    ?? [],
    messages:     saved2?.messages ?? [],
    people:       saved2?.people   ?? {},
    reports:      saved2?.reports  ?? [],
    blocked:      saved2?.blocked  ?? [],
    activeChatId: saved2?.activeChatId ?? '',
    filter:       (saved2?.filter  ?? 'all') as Filter,
    folder:       (saved2?.folder  ?? 'all') as ChatFolder,
    search:       '',
    replyToId:    null,
    editingId:    null,
    typing:       {},
    drafts:       saved2?.drafts       ?? {},
    quickReplies: saved2?.quickReplies ?? [],
    connected:    false,
    synced:       false,
    openSeq:      0,
    historyDone:  {},
    loadingOlder: {},
  });
};
