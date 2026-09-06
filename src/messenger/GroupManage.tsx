/* ===============================================================
   SKY MESSENGER — Управление группой
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Shield, Link2, UserCheck, History, Settings2, Copy, Trash2,
  Check, ChevronDown, Plus, AlertTriangle, MessageSquare, QrCode, BarChart2,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from './store';
import {
  useGroupStore, ROLE_LABEL, ROLE_COLOR, ROLE_ORDER, type GroupRole, type GroupSettings,
} from './groupStore';
import type { ChatItem } from './types';

const C = { l1: '#121215', l2: '#1e1e24', border: 'rgba(255,255,255,0.08)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)', red: 'var(--red)' };

type Tab = 'members' | 'invites' | 'requests' | 'log' | 'settings' | 'analytics';

export const GroupManage = ({ chat, onClose }: { chat: ChatItem; onClose: () => void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const myId = currentUserId ?? '';
  const {
    getRole, getPermissions, setRole, getSettings, updateSettings,
    logsFor,
    requestsFor, approveJoinRequest, rejectJoinRequest,
  } = useGroupStore();

  const [tab, setTab] = useState<Tab>('members');
  const myPerms = getPermissions(chat.id, myId, chat.ownerId);
  const settings = getSettings(chat.id);
  const requests = requestsFor(chat.id).filter(r => r.status === 'pending');

  const TABS: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'members',  label: 'Роли',        icon: Shield },
    ...(chat.type === 'channel' ? [{ key: 'analytics' as Tab, label: 'Аналитика', icon: BarChart2 }] : []),
    { key: 'invites',  label: 'Приглашения', icon: Link2 },
    { key: 'requests', label: 'Заявки',      icon: UserCheck, badge: requests.length || undefined },
    { key: 'log',      label: 'Журнал',      icon: History },
    { key: 'settings', label: 'Защита',      icon: Settings2 },
  ];

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
          <p className="flex-1 font-bold text-[16px]" style={{ color: C.t1 }}>Управление группой</p>
          <button type="button" onClick={onClose} style={{ color: C.t2 }}><X size={18} /></button>
        </div>

        <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0" style={{ borderColor: C.border }}>
          {TABS.map(t => (
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
            <div className="space-y-2">
              {!myPerms.canManageRoles && (
                <p className="text-xs mb-2" style={{ color: C.t3 }}>Только владелец и администраторы могут менять роли.</p>
              )}
              {(chat.participants ?? []).map(pid => {
                const acc = accounts.find(a => a.id === pid);
                if (!acc) return null;
                const role = getRole(chat.id, pid, chat.ownerId);
                const isOwnerRow = pid === chat.ownerId;
                return (
                  <div key={pid} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
                    {acc.avatar
                      ? <img src={acc.avatar} className="h-8 w-8 rounded-full object-cover shrink-0" alt="" />
                      : <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: '#6e8eff' }}>{acc.name[0]?.toUpperCase()}</div>}
                    <span className="flex-1 truncate text-sm" style={{ color: C.t1 }}>{acc.name}</span>
                    {isOwnerRow || !myPerms.canManageRoles ? (
                      <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: `${ROLE_COLOR[role]}22`, color: ROLE_COLOR[role] }}>{ROLE_LABEL[role]}</span>
                    ) : (
                      <RolePicker current={role} onChange={r => setRole(chat.id, pid, r)} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'invites' && (
            <InvitesTab groupId={chat.id} canInvite={myPerms.canInvite} />
          )}

          {tab === 'analytics' && chat.type === 'channel' && (
            <AnalyticsTab groupId={chat.id} />
          )}

          {tab === 'requests' && (
            <div className="space-y-2">
              {requestsFor(chat.id).length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Нет заявок на вступление</p>
              ) : requestsFor(chat.id).map(r => {
                const acc = accounts.find(a => a.id === r.userId);
                return (
                  <div key={r.id} className="rounded-xl p-3" style={{ background: C.l2 }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-semibold flex-1 truncate" style={{ color: C.t1 }}>{acc?.name ?? r.userId}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: r.status === 'pending' ? 'rgba(245,185,66,0.15)' : r.status === 'approved' ? 'rgba(52,199,89,0.15)' : 'rgba(224,85,95,0.15)',
                          color: r.status === 'pending' ? '#f5b942' : r.status === 'approved' ? '#34c759' : C.red }}>
                        {r.status === 'pending' ? 'На рассмотрении' : r.status === 'approved' ? 'Одобрена' : 'Отклонена'}
                      </span>
                    </div>
                    {r.answer && <p className="text-xs mb-2" style={{ color: C.t2 }}>«{r.answer}»</p>}
                    {r.status === 'pending' && myPerms.canApproveJoins && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => approveJoinRequest(r.id)}
                          className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white" style={{ background: C.accent }}>Одобрить</button>
                        <button type="button" onClick={() => rejectJoinRequest(r.id)}
                          className="flex-1 rounded-lg py-1.5 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.06)', color: C.t2 }}>Отклонить</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'log' && (
            <div className="space-y-1.5">
              {logsFor(chat.id).length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Журнал действий пуст</p>
              ) : logsFor(chat.id).map(l => (
                <div key={l.id} className="rounded-lg px-3 py-2" style={{ background: C.l2 }}>
                  <p className="text-xs" style={{ color: C.t1 }}>{l.text}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>
                    {accounts.find(a => a.id === l.actorId)?.name ?? 'Система'} · {new Date(l.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tab === 'settings' && (
            <SettingsTab groupId={chat.id} settings={settings} onChange={p => updateSettings(chat.id, p)} readOnly={!myPerms.canChangeInfo} />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

/* -- Role picker dropdown --------------------------------------- */
const RolePicker = ({ current, onChange }: { current: GroupRole; onChange: (r: GroupRole) => void }) => {
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
            className="absolute right-0 z-10 mt-1 rounded-xl overflow-hidden" style={{ background: '#252529', border: `1px solid ${C.border}` }}>
            {ROLE_ORDER.filter(r => r !== 'owner').map(r => (
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

/* -- Invites tab -------------------------------------------------- */
const InvitesTab = ({ groupId, canInvite }: { groupId: string; canInvite: boolean }) => {
  const { invitesFor, createInvite, revokeInvite } = useGroupStore();
  const [copied, setCopied] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const invites = invitesFor(groupId).filter(i => !i.revoked);
  const qrUrl = (code: string) => `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`https://sky.app/join/${code}`)}&bgcolor=ffffff&color=000000&qzone=1&format=svg`;

  const copy = (code: string) => {
    navigator.clipboard.writeText(`https://sky.app/join/${code}`);
    setCopied(code); setTimeout(() => setCopied(null), 1500);
  };

  return (
    <>
    <div className="space-y-2">
      {canInvite && (
        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => createInvite(groupId)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.accent }}>
            <Plus size={13} /> Постоянная ссылка
          </button>
          <button type="button" onClick={() => createInvite(groupId, { maxUses: 1, expiresInHours: 24 })}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>
            <Plus size={13} /> Одноразовая, 24ч
          </button>
        </div>
      )}
      {invites.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: C.t3 }}>Нет активных ссылок-приглашений</p>
      ) : invites.map(i => {
        const expired = i.expiresAt && new Date(i.expiresAt).getTime() < Date.now();
        const exhausted = i.maxUses != null && i.uses >= i.maxUses;
        return (
          <div key={i.id} className="rounded-xl p-3" style={{ background: C.l2 }}>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="flex-1 truncate text-xs font-mono" style={{ color: C.t1 }}>sky.app/join/{i.code}</p>
              <button type="button" onClick={() => setQrCode(i.code)} style={{ color: C.t2 }}>
                <QrCode size={14} />
              </button>
              <button type="button" onClick={() => copy(i.code)} style={{ color: copied === i.code ? '#34c759' : C.t2 }}>
                {copied === i.code ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button type="button" onClick={() => revokeInvite(i.id)} style={{ color: C.red }}><Trash2 size={14} /></button>
            </div>
            <div className="flex items-center gap-2 text-[10px]" style={{ color: (expired || exhausted) ? C.red : C.t3 }}>
              <span>{i.uses}{i.maxUses ? `/${i.maxUses}` : ''} использований</span>
              {i.expiresAt && <span>· до {new Date(i.expiresAt).toLocaleDateString('ru-RU')}</span>}
              {(expired || exhausted) && <span>· недействительна</span>}
            </div>
          </div>
        );
      })}
    </div>

    <AnimatePresence>
      {qrCode && (
        <motion.div className="fixed inset-0 z-[310] flex items-center justify-center p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setQrCode(null)}>
          <motion.div onClick={e => e.stopPropagation()}
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            className="rounded-3xl p-6 flex flex-col items-center gap-3" style={{ background: '#fff' }}>
            <img src={qrUrl(qrCode)} width={220} height={220} alt="QR" style={{ display: 'block' }} />
            <p className="text-xs font-mono text-center" style={{ color: '#0a0a0a' }}>sky.app/join/{qrCode}</p>
            <button type="button" onClick={() => setQrCode(null)}
              className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: C.accent }}>Закрыть</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
};

/* -- Channel analytics tab (реальные данные, без фейковых метрик) --- */
const AnalyticsTab = ({ groupId }: { groupId: string }) => {
  const { messages } = useMessengerStore();
  const posts = messages.filter(m => m.chatId === groupId && !m.deleted && m.kind !== 'system')
    .sort((a, b) => b.timestamp - a.timestamp);

  const totalViews     = posts.reduce((s, m) => s + (m.viewedBy?.length ?? 0), 0);
  const totalReactions = posts.reduce((s, m) => s + m.reactions.reduce((rs, r) => rs + r.userIds.length, 0), 0);
  const totalReplies   = messages.filter(m => m.chatId === groupId && posts.some(p => p.id === m.replyToId)).length;
  const avgViews       = posts.length ? Math.round(totalViews / posts.length) : 0;
  const engagementRate = totalViews > 0 ? Math.round(((totalReactions + totalReplies) / totalViews) * 100) : 0;

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-xl p-3" style={{ background: C.l2 }}>
      <p className="text-[10px] font-semibold" style={{ color: C.t3 }}>{label}</p>
      <p className="text-xl font-extrabold mt-0.5" style={{ color: C.t1 }}>{value}</p>
    </div>
  );

  if (posts.length === 0) {
    return <p className="text-xs text-center py-8" style={{ color: C.t3 }}>Пока нет публикаций для анализа</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Публикаций" value={posts.length} />
        <Stat label="Охват (просмотры)" value={totalViews} />
        <Stat label="Ср. просмотров/пост" value={avgViews} />
        <Stat label="Вовлечённость" value={`${engagementRate}%`} />
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide px-1 mb-2" style={{ color: C.t3 }}>По публикациям</p>
        <div className="space-y-1.5">
          {posts.slice(0, 30).map(m => {
            const reactCount = m.reactions.reduce((s, r) => s + r.userIds.length, 0);
            return (
              <div key={m.id} className="rounded-lg px-3 py-2" style={{ background: C.l2 }}>
                <p className="text-xs truncate mb-1" style={{ color: C.t1 }}>{m.text || `[${m.kind}]`}</p>
                <div className="flex items-center gap-3 text-[10px]" style={{ color: C.t3 }}>
                  <span>👁 {m.viewedBy?.length ?? 0}</span>
                  <span>❤️ {reactCount}</span>
                  <span>💬 {messages.filter(x => x.replyToId === m.id).length}</span>
                  <span className="ml-auto">{m.time}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* -- Anti-spam / anti-flood / anti-bot settings tab --------------- */
const SettingsTab = ({ settings, onChange, readOnly }: {
  groupId: string; settings: GroupSettings;
  onChange: (p: Partial<GroupSettings>) => void; readOnly: boolean;
}) => {
  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button type="button" disabled={readOnly} onClick={onToggle}
      className="relative h-6 w-11 rounded-full shrink-0 transition-colors disabled:opacity-40"
      style={{ background: on ? C.accent : 'rgba(255,255,255,0.14)' }}>
      <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white" animate={{ left: on ? 22 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
    </button>
  );
  const Row = ({ icon: Icon, label, sub, children }: { icon: any; label: string; sub?: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: C.l2 }}>
      <Icon size={16} style={{ color: C.t2 }} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: C.t1 }}>{label}</p>
        {sub && <p className="text-[11px] mt-0.5" style={{ color: C.t3 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide px-1" style={{ color: C.t3 }}>Антифлуд и антиспам</p>
      <Row icon={AlertTriangle} label="Антифлуд" sub={`Не более ${settings.antiFloodMaxPerMinute} сообщений в минуту от одного участника`}>
        <Toggle on={settings.antiFlood} onToggle={() => onChange({ antiFlood: !settings.antiFlood })} />
      </Row>
      <Row icon={Link2} label="Блокировать ссылки" sub="От участников без роли (только для member)">
        <Toggle on={settings.antiSpamLinks} onToggle={() => onChange({ antiSpamLinks: !settings.antiSpamLinks })} />
      </Row>
      <Row icon={Shield} label="Антибот" sub="Эвристическая проверка ника при вступлении">
        <Toggle on={settings.antiBot} onToggle={() => onChange({ antiBot: !settings.antiBot })} />
      </Row>

      <p className="text-[11px] font-bold uppercase tracking-wide px-1 pt-3" style={{ color: C.t3 }}>Вступление</p>
      <Row icon={UserCheck} label="Заявки на вступление" sub="Новых участников нужно подтверждать вручную">
        <Toggle on={settings.requireApproval} onToggle={() => onChange({ requireApproval: !settings.requireApproval })} />
      </Row>
      <Row icon={Shield} label="Капча при вступлении" sub="Простая проверка «я не бот»">
        <Toggle on={settings.captchaOnJoin} onToggle={() => onChange({ captchaOnJoin: !settings.captchaOnJoin })} />
      </Row>

      <p className="text-[11px] font-bold uppercase tracking-wide px-1 pt-3" style={{ color: C.t3 }}>Приветствие</p>
      <Row icon={MessageSquare} label="Приветственное сообщение" sub="Показывать новым участникам">
        <Toggle on={settings.welcomeEnabled} onToggle={() => onChange({ welcomeEnabled: !settings.welcomeEnabled })} />
      </Row>
      {settings.welcomeEnabled && (
        <textarea disabled={readOnly} value={settings.welcomeMessage} onChange={e => onChange({ welcomeMessage: e.target.value })}
          rows={2} placeholder="Текст приветствия..." className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none disabled:opacity-50"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.border}` }} />
      )}
    </div>
  );
};
