import { create } from 'zustand';
import { flash } from '@/shared/flash';
import {
  apiServers, apiServer, apiCreateServer, apiJoinServer, apiJoinByCode, apiLeaveServer, apiDeleteServer,
  apiCreateChannel, apiDeleteChannel, apiChannelMessages, apiSendMessage, apiDeleteMessage, gsError,
  type ServerLite, type ServerDetail, type GMessage, type GChannelType,
} from './serversApi';

interface GSState {
  mine: ServerLite[];
  open: ServerLite[];
  loaded: boolean;
  activeId: string | null;
  detail: ServerDetail | null;
  channelId: string | null;
  messages: Record<string, GMessage[]>;
  hasMore: Record<string, boolean>;
  sending: boolean;

  load: () => Promise<void>;
  select: (serverId: string) => Promise<void>;
  refreshDetail: () => Promise<void>;
  openChannel: (channelId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  send: (text: string) => Promise<boolean>;
  removeMessage: (id: string) => Promise<void>;
  create: (b: { name: string; icon: string; description?: string; isPublic: boolean }) => Promise<boolean>;
  join: (serverId: string) => Promise<boolean>;
  joinCode: (code: string) => Promise<boolean>;
  leave: () => Promise<void>;
  destroy: () => Promise<void>;
  addChannel: (name: string, type: GChannelType) => Promise<boolean>;
  removeChannel: (id: string) => Promise<void>;

  applyMessage: (serverId: string, m: GMessage) => void;
  applyMessageDeleted: (channelId: string, id: string) => void;
  applyChanged: (serverId: string) => void;
  applyRemoved: (serverId: string) => void;
}

const firstTextChannel = (d: ServerDetail) =>
  d.channels.find((c) => c.type === 'text')?.id ?? d.channels.find((c) => c.type === 'announce')?.id ?? null;

export const useGameServers = create<GSState>((set, get) => ({
  mine: [], open: [], loaded: false,
  activeId: null, detail: null, channelId: null,
  messages: {}, hasMore: {}, sending: false,

  load: async () => {
    const r = await apiServers();
    if (!r.ok || !r.data) { set({ loaded: true }); return; }
    set({ mine: r.data.mine, open: r.data.open, loaded: true });
    const { activeId } = get();
    if (activeId && !r.data.mine.some((s) => s.id === activeId)) set({ activeId: null, detail: null, channelId: null });
    if (!get().activeId && r.data.mine[0]) await get().select(r.data.mine[0].id);
  },

  select: async (serverId) => {
    const r = await apiServer(serverId);
    if (!r.ok || !r.data) { flash(gsError(r.error)); return; }
    const keep = get().channelId;
    const stillThere = keep && r.data.channels.some((c) => c.id === keep && c.type !== 'voice');
    set({ activeId: serverId, detail: r.data, channelId: stillThere ? keep : firstTextChannel(r.data) });
    const ch = get().channelId;
    if (ch) await get().openChannel(ch);
  },

  refreshDetail: async () => {
    const id = get().activeId;
    if (!id) return;
    const r = await apiServer(id);
    if (r.ok && r.data) set({ detail: r.data });
    else if (r.error === 'not_member' || r.error === 'not_found') get().applyRemoved(id);
    const ch = get().channelId;
    if (ch) {
      const m = await apiChannelMessages(ch);
      if (m.ok && m.data) set((s) => ({ messages: { ...s.messages, [ch]: m.data!.messages } }));
    }
  },

  openChannel: async (channelId) => {
    set({ channelId });
    const r = await apiChannelMessages(channelId);
    if (r.ok && r.data) {
      set((s) => ({ messages: { ...s.messages, [channelId]: r.data!.messages }, hasMore: { ...s.hasMore, [channelId]: !!r.data!.hasMore } }));
    } else if (!r.ok) flash(gsError(r.error));
  },

  loadOlder: async () => {
    const ch = get().channelId;
    const first = ch ? get().messages[ch]?.[0] : null;
    if (!ch || !first) return;
    const r = await apiChannelMessages(ch, first.createdAt);
    if (r.ok && r.data) {
      set((s) => ({
        messages: { ...s.messages, [ch]: [...r.data!.messages, ...(s.messages[ch] ?? [])] },
        hasMore: { ...s.hasMore, [ch]: !!r.data!.hasMore },
      }));
    }
  },

  send: async (text) => {
    const ch = get().channelId;
    if (!ch || !text.trim() || get().sending) return false;
    set({ sending: true });
    const r = await apiSendMessage(ch, text);
    set({ sending: false });
    if (!r.ok || !r.data) { flash(gsError(r.error)); return false; }
    get().applyMessage(get().activeId ?? '', r.data.message);
    return true;
  },

  removeMessage: async (id) => {
    const r = await apiDeleteMessage(id);
    if (!r.ok) { flash(gsError(r.error)); return; }
    const ch = get().channelId;
    if (ch) get().applyMessageDeleted(ch, id);
  },

  create: async (b) => {
    const r = await apiCreateServer(b);
    if (!r.ok || !r.data) { flash(gsError(r.error)); return false; }
    await get().load();
    await get().select(r.data.id);
    return true;
  },

  join: async (serverId) => {
    const r = await apiJoinServer(serverId);
    if (!r.ok) { flash(gsError(r.error)); return false; }
    await get().load();
    await get().select(serverId);
    return true;
  },

  joinCode: async (code) => {
    const r = await apiJoinByCode(code);
    if (!r.ok || !r.data) { flash(gsError(r.error)); return false; }
    await get().load();
    await get().select(r.data.serverId);
    return true;
  },

  leave: async () => {
    const id = get().activeId;
    if (!id) return;
    const r = await apiLeaveServer(id);
    if (!r.ok) { flash(gsError(r.error)); return; }
    set({ activeId: null, detail: null, channelId: null });
    await get().load();
  },

  destroy: async () => {
    const id = get().activeId;
    if (!id) return;
    const r = await apiDeleteServer(id);
    if (!r.ok) { flash(gsError(r.error)); return; }
    set({ activeId: null, detail: null, channelId: null });
    await get().load();
  },

  addChannel: async (name, type) => {
    const id = get().activeId;
    if (!id) return false;
    const r = await apiCreateChannel(id, { name, type });
    if (!r.ok || !r.data) { flash(gsError(r.error)); return false; }
    await get().refreshDetail();
    if (type !== 'voice') await get().openChannel(r.data.id);
    return true;
  },

  removeChannel: async (id) => {
    const r = await apiDeleteChannel(id);
    if (!r.ok) { flash(gsError(r.error)); return; }
    await get().select(get().activeId ?? '');
  },

  applyMessage: (_serverId, m) => set((s) => {
    const list = s.messages[m.channelId];
    if (!list) return s;
    if (list.some((x) => x.id === m.id)) return s;
    return { messages: { ...s.messages, [m.channelId]: [...list, m] } };
  }),
  applyMessageDeleted: (channelId, id) => set((s) => ({
    messages: { ...s.messages, [channelId]: (s.messages[channelId] ?? []).filter((m) => m.id !== id) },
  })),
  applyChanged: (serverId) => {
    if (get().activeId === serverId) void get().refreshDetail();
    void apiServers().then((r) => { if (r.ok && r.data) set({ mine: r.data.mine, open: r.data.open }); });
  },
  applyRemoved: (serverId) => {
    if (get().activeId === serverId) set({ activeId: null, detail: null, channelId: null });
    void get().load();
  },
}));
