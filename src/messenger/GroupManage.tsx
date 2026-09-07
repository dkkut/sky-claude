/* ===============================================================
   SKY MESSENGER — Управление группой и каналом

   Всё, что здесь показано, приходит с сервера и меняется на сервере.
   Роль нужна только чтобы нарисовать нужные кнопки: любое нажатие всё
   равно проходит проверку прав на сервере, и отказ виден словами.
=============================================================== */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Shield, Link2, UserCheck, History, Settings2, Copy, Trash2,
  Check, ChevronDown, Plus, AlertTriangle, BarChart2, Ban, VolumeX, Eye,
} from 'lucide-react';
import { useMessengerStore } from './store';
import {
  useAdminStore, ROLE_LABEL, ROLE_COLOR, ASSIGNABLE, canDo,
  type ChatRole, type ChatSettings,
} from './adminStore';
import type { ChatItem } from './types';

const C = { l1: '#121215', l2: '#1e1e24', border: 'rgba(255,255,255,0.08)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)', red: 'var(--red)' };

type Tab = 'members' | 'invites' | 'requests' | 'log' | 'settings' | 'analytics';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const GroupManage = ({ chat, onClose }: { chat: ChatItem; onClose: () => void }) => {
  const isChannel = chat.type === 'channel';
  const myRole = (chat.myRole ?? 'member') as ChatRole;
  const people = useMessengerStore(s => s.people);
  const messages = useMessengerStore(s => s.messages);

  const {
    settings, members, invites, requests, log, notice,
    loadSettings, loadMembers, loadInvites, loadRequests, loadLog,
    saveSettings, setRole, kick, ban, mute, createInvite, revokeInvite, decideJoin, notify,
  } = useAdminStore();

  const [tab, setTab] = useState<Tab>('members');

  const cfg = settings[chat.id];
  const memberBox = members[chat.id];
  const chatInvites = invites[chat.id] ?? [];
  const chatRequests = requests[chat.id] ?? [];
  const chatLog = log[chat.id] ?? [];

  // Всё тянем с сервера при открытии: показывать старое из памяти —
  // значит показывать то, чего, возможно, уже нет.
  useEffect(() => {
    loadSettings(chat.id);
    loadMembers(chat.id);
    if (canDo(myRole, 'invite'))       loadInvites(chat.id);
    if (canDo(myRole, 'approveJoins')) loadRequests(chat.id);
    if (canDo(myRole, 'restrict'))     loadLog(chat.id);
  }, [chat.id, myRole]);

  // Сообщение об отказе гасим само — оно относится к последнему нажатию.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => notify(null), 3500);
    return () => clearTimeout(t);
  }, [notice, notify]);

  const nameOf = (id: string) => people[id]?.name ?? 'Участник';

  const TABS: { key: Tab; label: string; icon: any; badge?: number; show: boolean }[] = [
    { key: 'members',  label: isChannel ? 'Подписчики' : 'Участники', icon: Shield, show: true },
    { key: 'analytics', label: 'Охват', icon: BarChart2, show: isChannel && canDo(myRole, 'restrict') },
    { key: 'invites',  label: 'Ссылки', icon: Link2, show: canDo(myRole, 'invite') },
    { key: 'requests', label: 'Заявки', icon: UserCheck, show: canDo(myRole, 'approveJoins'),
      badge: chatRequests.length || undefined },
    { key: 'log',      label: 'Журнал', icon: History, show: canDo(myRole, 'restrict') },
    { key: 'settings', label: isChannel ? 'Канал' : 'Защита', icon: Settings2, show: true },
  ];
  const visibleTabs = TABS.filter(t => t.show);

  return (
    <motion.div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        className="w-full sm:w-[480px] sm:max-h-[78vh] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: C.l1, border: `1px solid ${C.border}`, maxHeight: '85vh' }}>

        <div className="flex items-center gap-2 px-5 py-4 border-b shrink-0" style={{ borderColor: C.border }}>
          <Shield size={17} style={{ color: C.accent }} />
          <p className="flex-1 font-bold text-[16px]" style={{ color: C.t1 }}>
            {isChannel ? 'Управление каналом' : 'Управление группой'}
          </p>
          <span className="text-[11px] font-bold px-2 py-1 rounded-full shrink-0"
            style={{ background: `${ROLE_COLOR[myRole]}22`, color: ROLE_COLOR[myRole] }}>
            {ROLE_LABEL[myRole]}
          </span>
          <button type="button" onClick={onClose} style={{ color: C.t2 }}><X size={18} /></button>
        </div>

        <AnimatePresence>
          {notice && (
            <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-5 py-2 text-xs font-medium shrink-0"
              style={{ background: 'rgba(224,85,95,0.12)', color: C.red }}>
              {notice}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0" style={{ borderColor: C.border }}>
          {visibleTabs.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors"
              style={{ background: tab === t.key ? C.accent : 'transparent', color: tab === t.key ? '#fff' : C.t2 }}>
              <t.icon size={13} /> {t.label}
              {!!t.badge && (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: C.red }}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'members' && (
            <MembersTab chatId={chat.id} isChannel={isChannel} myRole={myRole}
              box={memberBox} nameOf={nameOf}
              onRole={(uid, r) => setRole(chat.id, uid, r)}
              onKick={uid => kick(chat.id, uid)}
              onBan={uid => ban(chat.id, uid)}
              onMute={(uid, min) => mute(chat.id, uid, min)} />
          )}

          {tab === 'analytics' && <ReachTab chatId={chat.id} messages={messages} />}

          {tab === 'invites' && (
            <InvitesTab invites={chatInvites}
              onCreate={opts => createInvite(chat.id, opts)}
              onRevoke={code => revokeInvite(code)} />
          )}

          {tab === 'requests' && (
            <RequestsTab requests={chatRequests} nameOf={nameOf}
              onDecide={(uid, ok) => decideJoin(chat.id, uid, ok)} />
          )}

          {tab === 'log' && (
            <div className="space-y-1.5">
              {chatLog.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Журнал пуст</p>
              ) : chatLog.map(l => (
                <div key={l.id} className="rounded-lg px-3 py-2" style={{ background: C.l2 }}>
                  <p className="text-xs" style={{ color: C.t1 }}>{l.detail}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>
                    {nameOf(l.actorId)}
                    {l.targetId ? ` → ${nameOf(l.targetId)}` : ''} · {fmtWhen(l.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tab === 'settings' && (
            <SettingsTab isChannel={isChannel} settings={cfg}
              readOnly={!canDo(myRole, 'changeInfo')}
              onChange={patch => saveSettings(chat.id, patch)} />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

/* -- Участники ---------------------------------------------------- */
const MembersTab = ({ chatId, isChannel, myRole, box, nameOf, onRole, onKick, onBan, onMute }: {
  chatId: string; isChannel: boolean; myRole: ChatRole;
  box?: { members?: any[]; hidden?: boolean; count?: number };
  nameOf: (id: string) => string;
  onRole: (uid: string, r: ChatRole) => void;
  onKick: (uid: string) => void;
  onBan: (uid: string) => void;
  onMute: (uid: string, minutes: number) => void;
}) => {
  if (!box) return <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Загружаем…</p>;

  // В канале список аудитории закрыт от обычных читателей — сервер его
  // просто не отдаёт, и здесь честно об этом говорим.
  if (box.hidden) {
    return (
      <div className="text-center py-10">
        <Eye size={22} style={{ color: C.t3 }} className="mx-auto mb-2" />
        <p className="text-sm font-semibold" style={{ color: C.t1 }}>{box.count} подписчиков</p>
        <p className="text-xs mt-1" style={{ color: C.t3 }}>
          Список виден только администраторам канала
        </p>
      </div>
    );
  }

  const list = box.members ?? [];
  return (
    <div className="space-y-2">
      {!canDo(myRole, 'manageRoles') && (
        <p className="text-xs mb-2" style={{ color: C.t3 }}>
          Менять роли могут владелец и администраторы.
        </p>
      )}
      {list.map(m => {
        const muted = m.mutedUntil && new Date(m.mutedUntil) > new Date();
        const canTouch = canDo(myRole, 'restrict') && m.role !== 'owner';
        return (
          <div key={m.id} className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                style={{ background: '#6e8eff' }}>{(m.name?.[0] ?? '?').toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm" style={{ color: C.t1 }}>{m.name}</p>
                <p className="truncate text-[11px]" style={{ color: C.t3 }}>@{m.username}</p>
              </div>
              {m.role === 'owner' || !canDo(myRole, 'manageRoles') ? (
                <span className="text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{ background: `${ROLE_COLOR[m.role as ChatRole]}22`, color: ROLE_COLOR[m.role as ChatRole] }}>
                  {ROLE_LABEL[m.role as ChatRole]}
                </span>
              ) : (
                <RolePicker current={m.role} onChange={r => onRole(m.id, r)} />
              )}
            </div>
            {canTouch && (
              <div className="flex gap-1.5 mt-2">
                <button type="button" onClick={() => onMute(m.id, muted ? 0 : 60)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.05)', color: muted ? '#f5b942' : C.t2 }}>
                  <VolumeX size={11} /> {muted ? 'Вернуть голос' : 'Час без права писать'}
                </button>
                <button type="button" onClick={() => onKick(m.id)}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.05)', color: C.t2 }}>
                  {isChannel ? 'Отписать' : 'Исключить'}
                </button>
                {canDo(myRole, 'ban') && (
                  <button type="button" onClick={() => onBan(m.id)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold"
                    style={{ background: 'rgba(224,85,95,0.12)', color: C.red }}>
                    <Ban size={11} /> Заблокировать
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* -- Выбор роли --------------------------------------------------- */
const RolePicker = ({ current, onChange }: { current: ChatRole; onChange: (r: ChatRole) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
        style={{ background: `${ROLE_COLOR[current]}22`, color: ROLE_COLOR[current] }}>
        {ROLE_LABEL[current]} <ChevronDown size={11} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 z-10 mt-1 rounded-xl overflow-hidden"
            style={{ background: '#252529', border: `1px solid ${C.border}` }}>
            {ASSIGNABLE.map(r => (
              <button key={r} type="button" onClick={() => { onChange(r); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs whitespace-nowrap hover:brightness-125"
                style={{ color: ROLE_COLOR[r] }}>
                {current === r && <Check size={11} />} {ROLE_LABEL[r]}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* -- Ссылки-приглашения ------------------------------------------- */
const InvitesTab = ({ invites, onCreate, onRevoke }: {
  invites: any[];
  onCreate: (opts: { maxUses?: number; expiresInHours?: number }) => void;
  onRevoke: (code: string) => void;
}) => {
  const [copied, setCopied] = useState('');
  const link = (code: string) => `${location.origin}/?join=${code}`;

  return (
    <div className="space-y-2">
      <p className="text-xs mb-1" style={{ color: C.t3 }}>
        По ссылке человек входит сам. Так в чат нельзя затащить без спроса —
        и так же приглашают тех, с кем ещё нет общей переписки.
      </p>
      <button type="button" onClick={() => onCreate({})}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white"
        style={{ background: C.accent }}>
        <Plus size={15} /> Новая ссылка
      </button>

      {invites.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: C.t3 }}>Ссылок пока нет</p>
      )}

      {invites.map(inv => {
        const dead = inv.revoked
          || (inv.expiresAt && new Date(inv.expiresAt) <= new Date())
          || (inv.maxUses && inv.uses >= inv.maxUses);
        return (
          <div key={inv.code} className="rounded-xl p-3" style={{ background: C.l2, opacity: dead ? 0.5 : 1 }}>
            <div className="flex items-center gap-2">
              <p className="flex-1 truncate font-mono text-[11px]" style={{ color: C.t2 }}>{link(inv.code)}</p>
              <button type="button"
                onClick={() => { navigator.clipboard?.writeText(link(inv.code)); setCopied(inv.code); setTimeout(() => setCopied(''), 1500); }}
                style={{ color: copied === inv.code ? '#34c759' : C.t2 }}>
                {copied === inv.code ? <Check size={14} /> : <Copy size={14} />}
              </button>
              {!inv.revoked && (
                <button type="button" onClick={() => onRevoke(inv.code)} style={{ color: C.red }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
              {dead ? 'Не действует' : 'Действует'} · использована {inv.uses} раз
              {inv.maxUses ? ` из ${inv.maxUses}` : ''}
            </p>
          </div>
        );
      })}
    </div>
  );
};

/* -- Заявки ------------------------------------------------------- */
const RequestsTab = ({ requests, nameOf, onDecide }: {
  requests: any[]; nameOf: (id: string) => string;
  onDecide: (userId: string, approve: boolean) => void;
}) => (
  <div className="space-y-2">
    {requests.length === 0 ? (
      <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Заявок нет</p>
    ) : requests.map(r => (
      <div key={r.userId} className="rounded-xl p-3" style={{ background: C.l2 }}>
        <p className="text-sm font-semibold mb-1" style={{ color: C.t1 }}>{nameOf(r.userId)}</p>
        {r.answer && <p className="text-xs mb-2" style={{ color: C.t2 }}>«{r.answer}»</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => onDecide(r.userId, true)}
            className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white" style={{ background: C.accent }}>
            Одобрить
          </button>
          <button type="button" onClick={() => onDecide(r.userId, false)}
            className="flex-1 rounded-lg py-1.5 text-[11px] font-bold"
            style={{ background: 'rgba(255,255,255,0.06)', color: C.t2 }}>
            Отклонить
          </button>
        </div>
      </div>
    ))}
  </div>
);

/* -- Охват канала ------------------------------------------------- */
const ReachTab = ({ chatId, messages }: { chatId: string; messages: any[] }) => {
  const posts = messages
    .filter(m => m.chatId === chatId && !m.deleted && m.kind !== 'system')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30);

  if (posts.length === 0) {
    return <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Записей пока нет</p>;
  }

  const best = Math.max(1, ...posts.map(p => p.views ?? 0));
  return (
    <div className="space-y-2">
      <p className="text-xs mb-1" style={{ color: C.t3 }}>
        Считаются разные читатели, а не открытия: перечитывание запись не накручивает.
      </p>
      {posts.map(p => (
        <div key={p.id} className="rounded-xl p-3" style={{ background: C.l2 }}>
          <div className="flex items-center gap-2">
            <p className="flex-1 truncate text-xs" style={{ color: C.t1 }}>{p.text || 'Вложение'}</p>
            <span className="flex items-center gap-1 text-[11px] font-bold shrink-0" style={{ color: C.accent }}>
              <Eye size={11} /> {p.views ?? 0}
            </span>
          </div>
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.round(((p.views ?? 0) / best) * 100)}%`, background: C.accent }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/* -- Настройки ---------------------------------------------------- */
const Row = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
    <div className="flex-1 min-w-0">
      <p className="text-sm" style={{ color: C.t1 }}>{title}</p>
      {hint && <p className="text-[11px] mt-0.5" style={{ color: C.t3 }}>{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const Toggle = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={() => onChange(!on)}
    className="relative rounded-full transition-colors disabled:opacity-40"
    style={{ width: 40, height: 23, background: on ? C.accent : 'rgba(255,255,255,0.14)' }}>
    <span className="absolute rounded-full bg-white transition-transform"
      style={{ width: 19, height: 19, top: 2, left: 2, transform: on ? 'translateX(17px)' : undefined }} />
  </button>
);

const SettingsTab = ({ isChannel, settings, readOnly, onChange }: {
  isChannel: boolean; settings?: ChatSettings; readOnly: boolean;
  onChange: (patch: Partial<ChatSettings>) => void;
}) => {
  if (!settings) return <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Загружаем…</p>;
  const set = (patch: Partial<ChatSettings>) => { if (!readOnly) onChange(patch); };

  return (
    <div className="space-y-2">
      {readOnly && (
        <p className="flex items-center gap-1.5 text-xs mb-1" style={{ color: '#f5b942' }}>
          <AlertTriangle size={12} /> Менять настройки могут владелец и администраторы
        </p>
      )}

      {isChannel ? (
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
          <p className="text-sm" style={{ color: C.t1 }}>Пишут только администраторы</p>
          <p className="text-[11px] mt-0.5" style={{ color: C.t3 }}>
            Это и делает канал каналом — переключить нельзя. Нужен общий
            разговор — создайте группу.
          </p>
        </div>
      ) : (
        <Row title="Пишут только администраторы"
          hint="Обычные участники смогут только читать">
          <Toggle on={settings.whoCanPost === 'admins'} disabled={readOnly}
            onChange={v => set({ whoCanPost: v ? 'admins' : 'all' })} />
        </Row>
      )}

      <Row title="Вступление по заявке" hint="Вошедшего по ссылке нужно будет одобрить">
        <Toggle on={settings.requireApproval} disabled={readOnly}
          onChange={v => set({ requireApproval: v })} />
      </Row>

      {settings.requireApproval && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
          <p className="text-xs mb-1.5" style={{ color: C.t2 }}>Вопрос перед вступлением</p>
          <input value={settings.joinQuestion} disabled={readOnly}
            onChange={e => set({ joinQuestion: e.target.value })}
            placeholder="Например: откуда вы о нас узнали?"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: C.t1, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }} />
        </div>
      )}

      <Row title="Приветствие новому участнику">
        <Toggle on={settings.welcomeEnabled} disabled={readOnly}
          onChange={v => set({ welcomeEnabled: v })} />
      </Row>

      {settings.welcomeEnabled && (
        <div className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
          <textarea value={settings.welcomeMessage} disabled={readOnly} rows={2}
            onChange={e => set({ welcomeMessage: e.target.value })}
            placeholder="Добро пожаловать!"
            className="w-full resize-none bg-transparent text-sm outline-none" style={{ color: C.t1 }} />
        </div>
      )}

      {!isChannel && (
        <>
          <Row title="Не пропускать ссылки" hint="От участников без роли — чтобы не было рассылок">
            <Toggle on={settings.antiSpamLinks} disabled={readOnly}
              onChange={v => set({ antiSpamLinks: v })} />
          </Row>

          <Row title="Ограничить поток сообщений"
            hint={`Не больше ${settings.antiFloodPerMin} в минуту от одного участника`}>
            <Toggle on={settings.antiFlood} disabled={readOnly}
              onChange={v => set({ antiFlood: v })} />
          </Row>

          {settings.antiFlood && (
            <div className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
              <p className="text-xs mb-2" style={{ color: C.t2 }}>
                Сообщений в минуту: {settings.antiFloodPerMin}
              </p>
              <input type="range" min={1} max={60} value={settings.antiFloodPerMin} disabled={readOnly}
                onChange={e => set({ antiFloodPerMin: Number(e.target.value) })}
                className="w-full" />
            </div>
          )}

          <div className="rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
            <p className="text-sm" style={{ color: C.t1 }}>Медленный режим</p>
            <p className="text-[11px] mt-0.5 mb-2" style={{ color: C.t3 }}>
              {settings.slowModeSec === 0
                ? 'Выключен'
                : `Пауза ${settings.slowModeSec} с между сообщениями одного участника`}
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {[0, 10, 30, 60, 300].map(sec => (
                <button key={sec} type="button" disabled={readOnly}
                  onClick={() => set({ slowModeSec: sec })}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-40"
                  style={{
                    background: settings.slowModeSec === sec ? C.accent : 'rgba(255,255,255,0.05)',
                    color: settings.slowModeSec === sec ? '#fff' : C.t2,
                  }}>
                  {sec === 0 ? 'Выкл' : sec < 60 ? `${sec} с` : `${sec / 60} мин`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
