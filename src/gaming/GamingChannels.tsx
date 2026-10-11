/* ===============================================================
   SKY GAMING CHANNELS  -  серверы, каналы, голос
   Всё настоящее: серверы, участники, роли и сообщения лежат на сервере
   (server/gameservers.mjs), новые сообщения приходят по WebSocket
   (gs:*). Голосовой канал — комната войс-пати: звук идёт P2P WebRTC
   между людьми, которые сейчас в канале.
=============================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Hash, Volume2, Plus, Users, Mic, MicOff, PhoneOff, Send, ChevronDown, ChevronRight,
  Trash2, X, Copy, LogOut, Search, Crown, Shield, ChevronLeft,
} from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { useAuthStore } from '@/core/auth/store';
import { flash } from '@/shared/flash';
import { useVoicePartyStore } from '@/voiceparty/store';
import { useGameServers } from './serversStore';
import {
  apiChannelVoice, apiKickMember, apiSetMemberRole, gsError, type GChannel, type GMember, type GChannelType,
} from './serversApi';

const C = {
  sidebar: 'var(--bg-l1)', content: 'var(--bg)', input: 'var(--bg-l2)',
  border: 'var(--border)', accent: '#5865f2',
  t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)',
};
const ICONS = ['🎮', '🔫', '🏆', '⚔️', '🎯', '🎲', '🌟', '🔥', '🛡️', '🚀', '👾', '🧩'];
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const memberWord = (n: number) => {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return 'участник';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'участника';
  return 'участников';
};

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
    <div className="max-h-[85vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl p-5"
      style={{ background: 'var(--bg-l3)', border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <p className="text-base font-bold" style={{ color: C.t1 }}>{title}</p>
        <button type="button" onClick={onClose} aria-label="Закрыть" style={{ color: C.t3 }}><X size={16} /></button>
      </div>
      {children}
    </div>
  </div>
);

const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none';
const inputStyle = { background: C.input, border: `1px solid ${C.border}`, color: C.t1 };

/* === MAIN ================================================ */
export const GamingChannels = () => {
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find((a) => a.id === currentUserId);
  const gs = useGameServers();
  const isMobile = useIsMobile();
  /* На телефоне список каналов и чат — два экрана: на трёх колонках чату остаётся ~150 px. */
  const [pane, setPane] = useState<'channels' | 'chat'>('channels');
  const showList = !isMobile || pane === 'channels';
  const showChat = !isMobile || pane === 'chat';
  const vp = useVoicePartyStore();
  const { detail, channelId, messages, mine, open, loaded } = gs;

  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<null | 'channel' | 'server' | 'members' | 'menu'>(null);
  const [tab, setTab] = useState<'find' | 'create' | 'code'>('find');
  const [chName, setChName] = useState(''); const [chType, setChType] = useState<GChannelType>('text');
  const [srvName, setSrvName] = useState(''); const [srvIcon, setSrvIcon] = useState('🎮');
  const [srvDesc, setSrvDesc] = useState(''); const [srvPublic, setSrvPublic] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void gs.load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  /* Страховка к WebSocket: число людей в голосовых и пропущенные сообщения. */
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void gs.refreshDetail(); }, 12000);
    return () => clearInterval(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const server = detail?.server ?? null;
  const channel = detail?.channels.find((c) => c.id === channelId) ?? null;
  const msgs = channelId ? messages[channelId] ?? [] : [];
  const isStaff = server?.myRole === 'owner' || server?.myRole === 'moderator';
  useEffect(() => { endRef.current?.scrollIntoView(); }, [msgs.length, channelId]);

  const voiceRoom = vp.activeRoom();
  const [joinedCh, setJoinedCh] = useState<string | null>(null);
  const voiceChannel = voiceRoom && joinedCh ? detail?.channels.find((c) => c.id === joinedCh) ?? null : null;
  const [voiceView, setVoiceView] = useState<string | null>(null);
  /* Исключили из комнаты или связь оборвалась — не висим на «Подключение…». */
  useEffect(() => {
    if (!joinedCh || vp.activeRoomId) return undefined;
    const t = setTimeout(() => { setJoinedCh(null); setVoiceView(null); }, 6000);
    return () => clearTimeout(t);
  }, [joinedCh, vp.activeRoomId]);
  const me2 = voiceRoom?.participants.find((p) => p.id === currentUserId);

  const roleColor = (id: string) => {
    const r = detail?.members.find((m) => m.id === id)?.role;
    return r === 'owner' ? 'var(--amber)' : r === 'moderator' ? '#22c55e' : C.t1;
  };

  const joinVoice = async (ch: GChannel) => {
    setVoiceView(ch.id); setPane('chat');
    if (voiceChannel?.id === ch.id) return;
    if (voiceRoom) vp.leaveRoom();
    const r = await apiChannelVoice(ch.id);
    if (!r.ok || !r.data) { flash(gsError(r.error)); setVoiceView(null); return; }
    setJoinedCh(ch.id);
    vp.joinRoom(r.data.roomId);
    setTimeout(() => void gs.refreshDetail(), 1200);
  };
  const leaveVoice = () => { vp.leaveRoom(); setJoinedCh(null); setVoiceView(null); setTimeout(() => void gs.refreshDetail(), 600); };

  const send = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    if (!(await gs.send(t))) setDraft(t);
  };

  const submitChannel = async () => {
    if (!chName.trim() || busy) return;
    setBusy(true);
    const ok = await gs.addChannel(chName.trim(), chType);
    setBusy(false);
    if (ok) { setChName(''); setChType('text'); setModal(null); }
  };

  const submitServer = async () => {
    if (srvName.trim().length < 2 || busy) return;
    setBusy(true);
    const ok = await gs.create({ name: srvName.trim(), icon: srvIcon, description: srvDesc.trim(), isPublic: srvPublic });
    setBusy(false);
    if (ok) { setSrvName(''); setSrvDesc(''); setModal(null); }
  };

  const submitCode = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    const ok = await gs.joinCode(code.trim());
    setBusy(false);
    if (ok) { setCode(''); setModal(null); }
  };

  const copyInvite = async () => {
    if (!server?.inviteCode) return;
    try { await navigator.clipboard.writeText(server.inviteCode); flash('Код приглашения скопирован'); }
    catch { flash(`Код приглашения: ${server.inviteCode}`); }
  };

  const manage = async (m: GMember, act: 'kick' | 'ban' | 'mod' | 'unmod') => {
    if (!server) return;
    const r = act === 'mod' || act === 'unmod'
      ? await apiSetMemberRole(server.id, m.id, act === 'mod' ? 'moderator' : 'member')
      : await apiKickMember(server.id, m.id, act === 'ban');
    if (!r.ok) { flash(gsError(r.error)); return; }
    void gs.refreshDetail();
  };

  /* ── Нет ни одного сервера: показываем, куда вступить ── */
  if (loaded && mine.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-4 py-5 space-y-4" style={{ background: C.content }}>
        <div className="text-center">
          <p className="text-lg font-black" style={{ color: C.t1 }}>Игровые серверы</p>
          <p className="mt-1 text-sm" style={{ color: C.t2 }}>Текстовые и голосовые каналы для вашей команды</p>
        </div>
        <button type="button" onClick={() => { setTab('create'); setModal('server'); }}
          className="w-full rounded-2xl py-3 text-sm font-bold text-white" style={{ background: C.accent }}>
          Создать свой сервер
        </button>
        <button type="button" onClick={() => { setTab('code'); setModal('server'); }}
          className="w-full rounded-2xl py-3 text-sm font-semibold" style={{ background: C.input, color: C.t1, border: `1px solid ${C.border}` }}>
          У меня есть код приглашения
        </button>
        {open.length > 0 && <p className="pt-2 text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t3 }}>Открытые серверы</p>}
        {open.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.sidebar, border: `1px solid ${C.border}` }}>
            <div className="text-3xl">{s.icon}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold" style={{ color: C.t1 }} translate="no">{s.name}</p>
              <p className="text-[11px]" style={{ color: C.t3 }}>{s.members} {memberWord(s.members)}</p>
            </div>
            <button type="button" onClick={() => void gs.join(s.id)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.accent }}>
              Вступить
            </button>
          </div>
        ))}
        {modal === 'server' && serverModal()}
      </div>
    );
  }

  function serverModal() {
    return (
      <Modal title="Серверы" onClose={() => setModal(null)}>
        <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: C.input }}>
          {([['find', 'Найти'], ['create', 'Создать'], ['code', 'По коду']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="rounded-lg py-1.5 text-xs font-semibold"
              style={{ background: tab === k ? C.accent : 'transparent', color: tab === k ? '#fff' : C.t3 }}>{l}</button>
          ))}
        </div>
        {tab === 'find' && (
          <div className="space-y-2">
            {open.length === 0 && <p className="py-4 text-center text-xs" style={{ color: C.t3 }}>Открытых серверов пока нет — создайте первый.</p>}
            {open.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl p-2" style={{ background: C.input }}>
                <span className="text-2xl">{s.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold" style={{ color: C.t1 }} translate="no">{s.name}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>{s.members} {memberWord(s.members)}</p>
                </div>
                <button type="button" onClick={async () => { if (await gs.join(s.id)) setModal(null); }}
                  className="rounded-lg px-3 py-1 text-[11px] font-bold text-white" style={{ background: C.accent }}>Вступить</button>
              </div>
            ))}
          </div>
        )}
        {tab === 'create' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {ICONS.map((ico) => (
                <button key={ico} type="button" onClick={() => setSrvIcon(ico)} className="grid h-9 w-9 place-items-center rounded-xl text-lg"
                  style={{ background: srvIcon === ico ? 'rgba(88,101,242,0.2)' : C.input, border: `1px solid ${srvIcon === ico ? C.accent : 'transparent'}` }}>{ico}</button>
              ))}
            </div>
            <input value={srvName} onChange={(e) => setSrvName(e.target.value)} maxLength={40} placeholder="Название сервера" className={inputCls} style={inputStyle} translate="no" />
            <input value={srvDesc} onChange={(e) => setSrvDesc(e.target.value)} maxLength={200} placeholder="Описание (необязательно)" className={inputCls} style={inputStyle} translate="no" />
            <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
              <input type="checkbox" checked={srvPublic} onChange={(e) => setSrvPublic(e.target.checked)} />
              Открытый: любой может найти и вступить. Закрытый — только по коду.
            </label>
            <button type="button" onClick={() => void submitServer()} disabled={srvName.trim().length < 2 || busy}
              className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.accent }}>Создать</button>
          </div>
        )}
        {tab === 'code' && (
          <div className="space-y-3">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} placeholder="Код приглашения" className={inputCls} style={inputStyle} />
            <button type="button" onClick={() => void submitCode()} disabled={!code.trim() || busy}
              className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.accent }}>Вступить</button>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <>
      <div className="flex h-full overflow-hidden" style={{ background: C.content }}>

        {/* -- Server list ------------------------------------ */}
        <div className="flex shrink-0 flex-col gap-2 overflow-y-auto p-2" style={{ width: 52, background: C.sidebar, scrollbarWidth: 'none' }}>
          {mine.map((sv) => (
            <motion.button key={sv.id} type="button" whileTap={{ scale: .9 }} onClick={() => { setPane('channels'); void gs.select(sv.id); }} title={sv.name}
              className="grid h-10 w-10 shrink-0 place-items-center text-xl transition-all"
              style={{
                background: server?.id === sv.id ? C.accent : 'var(--border)',
                borderRadius: server?.id === sv.id ? 14 : 24,
                boxShadow: server?.id === sv.id ? `0 4px 16px ${C.accent}50` : 'none',
              }}>{sv.icon}</motion.button>
          ))}
          <div className="mx-1 h-px" style={{ background: C.border }} />
          <button type="button" onClick={() => { setTab('find'); setModal('server'); }} title="Найти или создать сервер"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ color: '#22c55e' }}><Plus size={20} /></button>
        </div>

        {/* -- Channel sidebar -------------------------------- */}
        {server && detail && showList && (
          <div className={isMobile ? 'flex min-w-0 flex-1 flex-col overflow-hidden' : 'flex shrink-0 flex-col overflow-hidden'}
            style={{ width: isMobile ? undefined : 180, background: C.sidebar, borderRight: `1px solid ${C.border}` }}>
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-3" style={{ borderColor: C.border }}>
              <button type="button" className="min-w-0 text-left" onClick={() => setModal('menu')}>
                <p className="truncate text-sm font-bold" style={{ color: C.t1 }} translate="no">{server.name}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{server.members} {memberWord(server.members)}</p>
              </button>
              <div className="flex items-center gap-1">
                {isStaff && (
                  <button type="button" onClick={() => setModal('channel')} className="grid h-6 w-6 place-items-center rounded-md" title="Создать канал" style={{ color: C.t3 }}><Plus size={13} /></button>
                )}
                <button type="button" onClick={() => setModal('menu')} aria-label="Меню сервера" style={{ color: C.t3 }}><ChevronDown size={14} /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: 'none' }}>
              {detail.categories.map((cat) => (
                <div key={cat.id} className="mb-1">
                  <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }))} className="flex w-full items-center gap-1 px-3 py-1.5">
                    <ChevronRight size={10} style={{ color: C.t3, transform: collapsed[cat.id] ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .15s' }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t3 }} translate="no">{cat.name}</span>
                  </button>
                  {!collapsed[cat.id] && detail.channels.filter((ch) => ch.categoryId === cat.id).map((ch) => (
                    <div key={ch.id}>
                      <button type="button"
                        onClick={() => { if (ch.type === 'voice') void joinVoice(ch); else { setVoiceView(null); setPane('chat'); void gs.openChannel(ch.id); } }}
                        className="mx-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
                        style={{
                          width: 'calc(100% - 8px)',
                          background: channelId === ch.id && !voiceView ? `${C.accent}20` : voiceChannel?.id === ch.id ? 'rgba(34,197,94,0.12)' : 'transparent',
                          color: channelId === ch.id && !voiceView ? C.t1 : voiceChannel?.id === ch.id ? '#22c55e' : C.t2,
                        }}>
                        {ch.type === 'text' ? <Hash size={14} /> : ch.type === 'announce' ? <span className="text-xs">📢</span> : <Volume2 size={14} />}
                        <span className="flex-1 truncate text-left text-[12px] font-medium" translate="no">{ch.name}</span>
                        {ch.type === 'voice' && ch.voiceMembers.length > 0 && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>{ch.voiceMembers.length}</span>
                        )}
                      </button>
                      {ch.type === 'voice' && ch.voiceMembers.map((m) => (
                        <p key={m.id} className="truncate pl-9 pr-2 text-[11px]" style={{ color: C.t3 }} translate="no">{m.name}</p>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* User bar */}
            <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: C.border, background: 'rgba(0,0,0,0.08)' }}>
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: C.accent }} translate="no">{me?.name?.[0]}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold" style={{ color: C.t1 }} translate="no">{me?.name}</p>
                {voiceChannel ? <p className="text-[9px]" style={{ color: '#22c55e' }}>● В голосовом</p> : <p className="text-[9px]" style={{ color: C.t3 }}>В сети</p>}
              </div>
              {voiceChannel && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => vp.toggleMic()} title={me2?.muted ? 'Включить микрофон' : 'Выключить микрофон'}
                    className="grid h-6 w-6 place-items-center rounded"
                    style={{ color: me2?.muted ? 'var(--red)' : C.t3, background: me2?.muted ? 'rgba(239,68,68,0.2)' : 'transparent' }}>
                    {me2?.muted ? <MicOff size={13} /> : <Mic size={13} />}
                  </button>
                  <button type="button" onClick={leaveVoice} title="Выйти из голосового" className="grid h-6 w-6 place-items-center rounded" style={{ color: 'var(--red)' }}><PhoneOff size={13} /></button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -- Main content ----------------------------------- */}
        {showChat && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {isMobile && server && (
            <button type="button" onClick={() => setPane('channels')}
              className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-xs font-semibold" style={{ borderColor: C.border, color: C.accent }}>
              <ChevronLeft size={14} /> Каналы
            </button>
          )}
          {!server ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ color: C.t3 }}>
              {loaded ? 'Выберите сервер слева.' : 'Загрузка…'}
            </div>
          ) : voiceView && voiceChannel ? (
            <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 py-6">
              <Volume2 size={40} style={{ color: '#22c55e', opacity: .7 }} />
              <p className="text-base font-bold" style={{ color: C.t1 }} translate="no">{voiceChannel.name}</p>
              {!vp.micReady && <p className="text-center text-[11px]" style={{ color: C.t3 }}>Разрешите доступ к микрофону, чтобы вас слышали.</p>}
              <div className="w-full space-y-1.5">
                {(voiceRoom?.participants ?? []).map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.input, outline: p.speaking ? '2px solid #22c55e' : 'none' }}>
                    <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: p.avatarColor }} translate="no">{p.name[0]}</div>
                    <span className="flex-1 truncate text-sm" style={{ color: C.t1 }} translate="no">{p.name}</span>
                    {p.muted && <MicOff size={13} style={{ color: 'var(--red)' }} />}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => vp.toggleMic()} className="flex flex-col items-center gap-1.5">
                  <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: me2?.muted ? 'rgba(239,68,68,0.2)' : C.input }}>
                    {me2?.muted ? <MicOff size={22} style={{ color: 'var(--red)' }} /> : <Mic size={22} style={{ color: C.t2 }} />}
                  </div>
                  <span className="text-[10px]" style={{ color: C.t3 }}>{me2?.muted ? 'Включить' : 'Выключить'}</span>
                </button>
                <button type="button" onClick={leaveVoice} className="flex flex-col items-center gap-1.5">
                  <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.15)' }}><PhoneOff size={22} style={{ color: 'var(--red)' }} /></div>
                  <span className="text-[10px]" style={{ color: C.t3 }}>Выйти</span>
                </button>
              </div>
            </div>
          ) : voiceView ? (
            <div className="flex flex-1 items-center justify-center text-sm" style={{ color: C.t3 }}>Подключение к голосовому каналу…</div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3" style={{ borderColor: C.border }}>
                <Hash size={16} style={{ color: C.t3 }} />
                <p className="text-sm font-bold" style={{ color: C.t1 }} translate="no">{channel?.name ?? 'канал'}</p>
                <div className="flex-1" />
                <button type="button" onClick={() => setModal('members')} className="flex items-center gap-1" style={{ color: C.t3 }}>
                  <Users size={13} /><span className="text-[10px]">{server.members}</span>
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
                {channelId && gs.hasMore[channelId] && (
                  <button type="button" onClick={() => void gs.loadOlder()} className="mx-auto block text-xs font-semibold" style={{ color: C.accent }}>Показать более ранние</button>
                )}
                {msgs.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 opacity-60">
                    <Hash size={32} style={{ color: C.t3 }} />
                    <p className="text-sm" style={{ color: C.t3 }}>Здесь пока тихо. Напишите первым.</p>
                  </div>
                )}
                {msgs.map((msg, i) => {
                  const prev = msgs[i - 1];
                  const grouped = prev && prev.authorId === msg.authorId && new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300000;
                  const color = roleColor(msg.authorId);
                  const canDelete = msg.authorId === currentUserId || isStaff;
                  return (
                    <div key={msg.id} className="group flex gap-2.5">
                      {grouped ? <div className="w-8 shrink-0" /> : (
                        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: `${color === C.t1 ? 'rgba(88,101,242,.25)' : color}`, color: C.t1 }} translate="no">{msg.authorName[0]}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        {!grouped && (
                          <div className="mb-0.5 flex items-baseline gap-2">
                            <span className="text-sm font-bold" style={{ color }} translate="no">{msg.authorName}</span>
                            <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTime(msg.createdAt)}</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: C.t1 }} translate="no">{msg.text}</p>
                      </div>
                      {canDelete && (
                        <button type="button" onClick={() => void gs.removeMessage(msg.id)} aria-label="Удалить сообщение"
                          className="self-start opacity-40 hover:opacity-100" style={{ color: C.t3 }}><Trash2 size={13} /></button>
                      )}
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <div className="shrink-0 px-4 py-3">
                {channel?.type === 'announce' && !isStaff ? (
                  <p className="text-center text-xs" style={{ color: C.t3 }}>В этот канал пишут только владелец и модераторы.</p>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: C.input, border: `1px solid ${C.border}` }}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                      placeholder={`Сообщение в #${channel?.name ?? ''}`} className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.t1 }} />
                    <motion.button whileTap={{ scale: .9 }} type="button" onClick={() => void send()} disabled={!draft.trim()} aria-label="Отправить">
                      <Send size={16} style={{ color: draft.trim() ? C.accent : C.t3 }} />
                    </motion.button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {modal === 'server' && serverModal()}

      {modal === 'channel' && (
        <Modal title="Создать канал" onClose={() => setModal(null)}>
          <div className="grid grid-cols-3 gap-2">
            {([['text', '#', 'Текстовый'], ['voice', '🔊', 'Голосовой'], ['announce', '📢', 'Объявления']] as const).map(([t, ico, label]) => (
              <button key={t} type="button" onClick={() => setChType(t)} className="rounded-xl p-2.5 text-center"
                style={{ background: chType === t ? 'rgba(88,101,242,0.15)' : C.input, border: `1px solid ${chType === t ? C.accent : C.border}`, color: chType === t ? C.accent : C.t3 }}>
                <div className="mb-1 text-lg">{ico}</div><div className="text-[10px] font-semibold">{label}</div>
              </button>
            ))}
          </div>
          <input value={chName} onChange={(e) => setChName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submitChannel()}
            placeholder="Название канала" autoFocus maxLength={32} className={inputCls} style={inputStyle} translate="no" />
          <button type="button" onClick={() => void submitChannel()} disabled={!chName.trim() || busy}
            className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.accent }}>Создать</button>
        </Modal>
      )}

      {modal === 'members' && detail && (
        <Modal title={`Участники · ${detail.members.length}`} onClose={() => setModal(null)}>
          <div className="space-y-1.5">
            {detail.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: C.input }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold" style={{ color: roleColor(m.id) }} translate="no">{m.name}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>{m.role === 'owner' ? 'Владелец' : m.role === 'moderator' ? 'Модератор' : 'Участник'}</p>
                </div>
                {m.role === 'owner' && <Crown size={13} style={{ color: 'var(--amber)' }} />}
                {m.role === 'moderator' && <Shield size={13} style={{ color: '#22c55e' }} />}
                {isStaff && m.role !== 'owner' && m.id !== currentUserId && (server?.myRole === 'owner' || m.role === 'member') && (
                  <div className="flex gap-1">
                    {server?.myRole === 'owner' && (
                      <button type="button" onClick={() => void manage(m, m.role === 'moderator' ? 'unmod' : 'mod')}
                        className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.sidebar, color: C.t2 }}>{m.role === 'moderator' ? 'Снять' : 'В модеры'}</button>
                    )}
                    <button type="button" onClick={() => void manage(m, 'kick')} className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.sidebar, color: 'var(--red)' }}>Исключить</button>
                    <button type="button" onClick={() => void manage(m, 'ban')} className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: C.sidebar, color: 'var(--red)' }}>Бан</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modal === 'menu' && server && detail && (
        <Modal title={server.name} onClose={() => setModal(null)}>
          {server.description && <p className="text-xs" style={{ color: C.t2 }} translate="no">{server.description}</p>}
          <p className="text-[11px]" style={{ color: C.t3 }}>
            {server.isPublic ? 'Открытый сервер' : 'Закрытый сервер'} · {server.members} {memberWord(server.members)}
          </p>
          {isStaff && server.inviteCode && (
            <button type="button" onClick={() => void copyInvite()} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm"
              style={{ background: C.input, color: C.t1 }}>
              <span>Код приглашения: <b className="tracking-widest">{server.inviteCode}</b></span><Copy size={14} />
            </button>
          )}
          <button type="button" onClick={() => setModal('members')} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: C.input, color: C.t1 }}>
            <Search size={14} /> Участники
          </button>
          {isStaff && channel && channel.type !== 'voice' && (
            <button type="button" onClick={async () => { setModal(null); await gs.removeChannel(channel.id); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm" style={{ background: C.input, color: 'var(--red)' }}>
              <Trash2 size={14} /> Удалить канал #{channel.name}
            </button>
          )}
          {server.myRole === 'owner' ? (
            <button type="button" onClick={async () => { if (window.confirm('Удалить сервер вместе со всеми каналами и перепиской? Это нельзя отменить.')) { setModal(null); await gs.destroy(); } }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>
              <Trash2 size={14} /> Удалить сервер
            </button>
          ) : (
            <button type="button" onClick={async () => { setModal(null); await gs.leave(); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>
              <LogOut size={14} /> Покинуть сервер
            </button>
          )}
        </Modal>
      )}
    </>
  );
};
