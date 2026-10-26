import { create } from 'zustand';

export type NotifKind =
  | 'message' | 'mention' | 'call_in' | 'call_missed'
  | 'like' | 'comment' | 'repost' | 'follow' | 'system' | 'gift';

export interface SkyNotif {
  id:           string;
  kind:         NotifKind;
  title:        string;
  body:         string;
  avatarLetter: string;
  color:        string;
  timestamp:    number;
  read:         boolean;
  chatId?:      string;
  postId?:      string;
}

interface NotifState {
  notifs:       SkyNotif[];
  toasts:       SkyNotif[];
  push:         (n: Omit<SkyNotif, 'id' | 'timestamp' | 'read'>) => void;
  markRead:     (id: string) => void;
  markAllRead:  () => void;
  dismiss:      (id: string) => void;
  clearAll:     () => void;
  dismissToast: (id: string) => void;
}

/* -- Per-user storage ---------------------------------------------------- */
const W   = typeof window !== 'undefined';
const nk  = (uid: string) => `sky:notifs:v2:${uid}`;

// Удаляем старый глобальный ключ
if (W) { try { localStorage.removeItem('sky:notifs:v1'); } catch {} }

const getUid = (): string => {
  if (!W) return '';
  try { return JSON.parse(localStorage.getItem('sky:auth:v4:session') || '{}').id || ''; } catch { return ''; }
};

const loadFor  = (uid: string): SkyNotif[] => {
  if (!W || !uid) return [];
  try { return JSON.parse(localStorage.getItem(nk(uid)) || '[]'); } catch { return []; }
};
const saveFor  = (uid: string, n: SkyNotif[]) => {
  if (!W || !uid) return;
  try { localStorage.setItem(nk(uid), JSON.stringify(n.slice(0, 300))); } catch {}
};

/* -- Seed только для kutuzov (admin) ------------------------------------ */
const SEED: SkyNotif[] = [
  { id:'sn1', kind:'message',     title:'Luna Nova',  body:'Привет! Как дела? ☀️',             avatarLetter:'L', color:'var(--accent)', timestamp:Date.now()-7200000,   read:false, chatId:'dm-luna' },
  { id:'sn2', kind:'call_missed', title:'Пропущенный',body:'Звонок от Neo Driver',             avatarLetter:'N', color:'#f87171',       timestamp:Date.now()-14400000,  read:false },
  { id:'sn3', kind:'like',        title:'Neo Driver', body:'Оценил ваш пост в Bloom',          avatarLetter:'N', color:'#f87171',       timestamp:Date.now()-86400000,  read:true  },
  { id:'sn4', kind:'comment',     title:'Luna Nova',  body:'Прокомментировала: «Го! 🔥»',      avatarLetter:'L', color:'var(--accent)', timestamp:Date.now()-90000000,  read:true  },
  { id:'sn5', kind:'system',      title:'Sky V5.1.1 beta',     body:'Звонки и чаты работают отлично!',  avatarLetter:'S', color:'#34d399',       timestamp:Date.now()-172800000, read:true  },
];

const initUid     = getUid();
const storedNotifs = loadFor(initUid);
const initial      = storedNotifs.length
  ? storedNotifs
  : (initUid === 'acc-kutuzov' ? SEED : []);

const NBC = W && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('sky:notifs:bc:v2') : null;

export const useNotifStore = create<NotifState>((set, get) => {
  if (NBC) {
    NBC.onmessage = (e) => {
      const { type, notif, forUid } = e.data ?? {};
      if (type === 'push' && notif) {
        const uid = getUid();
        if (forUid && forUid !== uid) return; // чужое уведомление
        set(s => {
          if (s.notifs.find(n => n.id === notif.id)) return {};
          const next = [notif, ...s.notifs].slice(0, 300);
          saveFor(uid, next);
          return { notifs: next, toasts: [notif, ...s.toasts].slice(0, 3) };
        });
      }
    };
  }

  return {
    notifs: initial,
    toasts: [],

    push: (data) => {
      const uid   = getUid();
      const notif: SkyNotif = { ...data, id: crypto.randomUUID(), timestamp: Date.now(), read: false };
      set(s => {
        const next = [notif, ...s.notifs].slice(0, 300);
        saveFor(uid, next);
        return { notifs: next, toasts: [notif, ...s.toasts].slice(0, 3) };
      });
      NBC?.postMessage({ type: 'push', notif, forUid: uid });
    },

    markRead:    (id) => set(s => { const n = s.notifs.map(x => x.id===id ? {...x,read:true} : x); saveFor(getUid(),n); return {notifs:n}; }),
    markAllRead: ()   => set(s => { const n = s.notifs.map(x => ({...x,read:true})); saveFor(getUid(),n); return {notifs:n}; }),
    dismiss:     (id) => set(s => { const n = s.notifs.filter(x => x.id!==id); saveFor(getUid(),n); return {notifs:n}; }),
    clearAll:    ()   => { saveFor(getUid(),[]); set({notifs:[]}); },
    dismissToast:(id) => set(s => ({ toasts: s.toasts.filter(t => t.id!==id) })),
  };
});

/* -- Перезагрузка при смене аккаунта ------------------------------------ */
export const reloadNotifsForUser = (uid: string) => {
  const stored = loadFor(uid);
  const notifs = stored.length
    ? stored
    : (uid === 'acc-kutuzov' ? SEED : []);
  useNotifStore.setState({ notifs, toasts: [] });
};
