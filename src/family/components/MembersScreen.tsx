import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, UserPlus, Baby, Settings2, Trash2, Crown, LogOut, Search } from 'lucide-react';
import { useFamilyStore } from '../store';
import { apiSearchPeople, type DirectoryPerson } from '@/core/auth/api';
import { ROLE_LABEL } from '../types';

export const MembersScreen = ({ onBack }: { onBack: () => void }) => {
  const {
    family, isOwner, inviteMember, cancelInvitation, addChildMember, removeMember,
    leaveFamily, transferOwnership, updateMemberLimits, pendingInvitations, myMember,
  } = useFamilyStore();
  const owner = isOwner();
  const myAccountId = myMember()?.accountId;
  const [addMode, setAddMode] = useState<'none'|'real'|'child'>('none');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [childName, setChildName] = useState('');
  const [childRole, setChildRole] = useState<'child'|'teen'>('child');
  const [editing, setEditing] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!family) return null;
  const editingMember = family.members.find(m => m.id === editing);
  const pending = pendingInvitations;

  const show = (text: string) => { setToast(text); setTimeout(() => setToast(null), 2400); };

  const runSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const r = await apiSearchPeople(q.trim());
    setSearching(false);
    if (r.ok && r.data) setResults(r.data.people.filter(p => !family.members.some(m => m.accountId === p.id)));
  };

  const invite = async (recipientId: string, role: 'adult'|'teen'|'guest') => {
    setBusy(true);
    const r = await inviteMember(recipientId, role);
    setBusy(false);
    show(r.ok ? 'Приглашение отправлено' : r.error === 'adult_limit' ? 'Лимит взрослых участников' : r.error === 'member_limit' ? 'В семье уже нет мест' : r.error === 'recipient_in_family' ? 'Этот человек уже состоит в семье' : 'Не получилось пригласить');
    if (r.ok) { setAddMode('none'); setQuery(''); setResults([]); }
  };

  const submitChild = async () => {
    if (!childName.trim()) return;
    setBusy(true);
    const ok = await addChildMember(childName.trim(), childRole);
    setBusy(false);
    if (ok) { setAddMode('none'); setChildName(''); } else show('Не получилось добавить');
  };

  const doRemove = async (memberId: string) => {
    setBusy(true);
    await removeMember(memberId);
    setBusy(false);
  };

  const doLeave = async () => {
    setBusy(true);
    const r = await leaveFamily();
    setBusy(false);
    if (!r.ok) show(r.error === 'owner_must_transfer_or_close' ? 'Сначала передайте владение или закройте семью' : 'Не получилось выйти');
  };

  const doTransfer = async (memberId: string) => {
    setBusy(true);
    const r = await transferOwnership(memberId);
    setBusy(false);
    setTransferTarget(null);
    show(r.ok ? 'Владение передано' : 'Не получилось передать владение');
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Участники ({family.members.length}/{family.memberLimit})</h2>
        </div>
        {owner && family.members.length < family.memberLimit && (
          <button type="button" onClick={() => setAddMode('real')} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
            <Plus size={13} className="inline"/> Добавить
          </button>
        )}
      </div>

      <div className="flex-1 px-4 py-3 space-y-2.5">
        {owner && pending.length > 0 && (
          <div className="mb-1 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Ждут ответа</p>
            {pending.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px dashed var(--border)' }}>
                <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>Приглашение отправлено · {ROLE_LABEL[inv.role]}</p>
                <button type="button" onClick={() => cancelInvitation(inv.id)} className="text-[11px] font-bold" style={{ color: '#ef4444' }}>Отменить</button>
              </div>
            ))}
          </div>
        )}

        {family.members.map(m => (
          <div key={m.id} className="rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-black text-white" style={{ background: m.avatarColor }}>{m.name[0]}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{m.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{ROLE_LABEL[m.role]} · {m.points} баллов</p>
              </div>
              {(m.role === 'child' || m.role === 'teen') && (
                <button type="button" onClick={() => setEditing(m.id)} className="rounded-lg p-2" style={{ background: 'var(--bg-l2)' }}>
                  <Settings2 size={14} style={{ color: 'var(--t2)' }}/>
                </button>
              )}
              {owner && m.role !== 'owner' && m.accountId && (
                <button type="button" onClick={() => setTransferTarget(m.id)} className="rounded-lg p-2" style={{ background: 'var(--bg-l2)' }} title="Передать владение">
                  <Crown size={14} style={{ color: 'var(--amber)' }}/>
                </button>
              )}
              {owner && m.role !== 'owner' && (
                <button type="button" disabled={busy} onClick={() => doRemove(m.id)} className="rounded-lg p-2 disabled:opacity-40" style={{ background: 'var(--bg-l2)' }}>
                  <Trash2 size={14} style={{ color: 'var(--red)' }}/>
                </button>
              )}
              {!owner && m.role !== 'owner' && m.accountId === myAccountId && (
                <button type="button" disabled={busy} onClick={doLeave} className="rounded-lg p-2 disabled:opacity-40" style={{ background: 'var(--bg-l2)' }} title="Покинуть семью">
                  <LogOut size={14} style={{ color: 'var(--red)' }}/>
                </button>
              )}
            </div>
            {(m.role === 'child' || m.role === 'teen') && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {m.dailyLimit && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>Лимит/день: {m.dailyLimit} ₽</span>}
                {m.maxTransfer && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>Разовый лимит: {m.maxTransfer} ₽</span>}
                {m.canDepositOnly && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}>Только пополнение</span>}
              </div>
            )}
          </div>
        ))}

        {owner && (
          <p className="pt-2 text-center text-[11px]" style={{ color: 'var(--t3)' }}>
            Вы владелец — чтобы выйти из семьи, передайте владение другому участнику или закройте семью
          </p>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-[12.5px] font-semibold text-white" style={{ background: 'rgba(20,20,26,0.95)' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {transferTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setTransferTarget(null)}>
            <motion.div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <p className="mb-2 text-[14px] font-black" style={{ color: 'var(--t1)' }}>Передать владение семьёй?</p>
              <p className="mb-4 text-[12.5px]" style={{ color: 'var(--t3)' }}>
                Вы станете обычным взрослым участником, а {family.members.find(m => m.id === transferTarget)?.name} — владельцем семьи. Это необратимо без его согласия на обратную передачу.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTransferTarget(null)} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Отмена</button>
                <button type="button" disabled={busy} onClick={() => doTransfer(transferTarget)} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50" style={{ background: 'var(--amber)' }}>Передать</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {addMode !== 'none' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAddMode('none')}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Добавить участника</p>
                <button type="button" onClick={() => setAddMode('none')}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>

              {addMode === 'real' && (
                <>
                  <div className="mb-3 flex gap-2">
                    <button type="button" onClick={() => setAddMode('real')} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold text-white" style={{ background: 'var(--accent)' }}>
                      <UserPlus size={13}/>Аккаунт Sky
                    </button>
                    <button type="button" onClick={() => setAddMode('child')} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                      <Baby size={13}/>Ребёнок без входа
                    </button>
                  </div>
                  <div className="mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--bg-l2)' }}>
                    <Search size={14} style={{ color: 'var(--t3)' }}/>
                    <input value={query} onChange={e => void runSearch(e.target.value)} placeholder="Ник или имя в Sky"
                      className="flex-1 bg-transparent text-[13px] outline-none" style={{ color: 'var(--t1)' }}/>
                  </div>
                  {searching && <p className="py-4 text-center text-[12px]" style={{ color: 'var(--t3)' }}>Ищем…</p>}
                  {!searching && query.trim().length >= 2 && results.length === 0 && (
                    <p className="py-4 text-center text-[12.5px]" style={{ color: 'var(--t3)' }}>Никого не нашлось</p>
                  )}
                  {results.map(p => (
                    <div key={p.id} className="mb-2 flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)' }}>
                      <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-black text-white" style={{ background: 'linear-gradient(135deg,var(--accent),#8b5cf6)' }}>{p.name[0]}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>{p.name}</p>
                        <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>@{p.username}</p>
                      </div>
                      <button type="button" disabled={busy} onClick={() => invite(p.id, 'adult')}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-30" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }}>Взрослый</button>
                      <button type="button" disabled={busy} onClick={() => invite(p.id, 'teen')}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-30" style={{ background: 'var(--bg-l1)', color: 'var(--t1)' }}>Подросток</button>
                    </div>
                  ))}
                </>
              )}

              {addMode === 'child' && (
                <>
                  <div className="mb-3 flex gap-2">
                    <button type="button" onClick={() => setChildRole('child')} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: childRole==='child' ? 'var(--accent)' : 'var(--bg-l2)', color: childRole==='child' ? '#fff' : 'var(--t2)' }}>Ребёнок</button>
                    <button type="button" onClick={() => setChildRole('teen')} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: childRole==='teen' ? 'var(--accent)' : 'var(--bg-l2)', color: childRole==='teen' ? '#fff' : 'var(--t2)' }}>Подросток</button>
                  </div>
                  <input value={childName} onChange={e => setChildName(e.target.value)} placeholder="Имя ребёнка" maxLength={20}
                    className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Ребёнок без своего Sky ID — карточка внутри семьи, войти под ней нельзя. Автоматически включится Child Mode с базовыми лимитами — их можно изменить позже.</p>
                  <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={busy} onClick={submitChild} className="sky-btn-primary mt-4 w-full justify-center py-3.5 disabled:opacity-50">Добавить</motion.button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingMember && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setEditing(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Ограничения: {editingMember.name}</p>
                <button type="button" onClick={() => setEditing(null)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>

              <div className="space-y-3">
                <LimitRow label="Дневной лимит, ₽" value={editingMember.dailyLimit} onChange={v => updateMemberLimits(editingMember.id, { dailyLimit: v })}/>
                <LimitRow label="Разовый перевод, ₽" value={editingMember.maxTransfer} onChange={v => updateMemberLimits(editingMember.id, { maxTransfer: v })}/>
                <LimitRow label="Подтверждение свыше, ₽" value={editingMember.requireApprovalOver} onChange={v => updateMemberLimits(editingMember.id, { requireApprovalOver: v })}/>

                <button type="button" onClick={() => updateMemberLimits(editingMember.id, { canWithdraw: !editingMember.canWithdraw })}
                  className="flex w-full items-center justify-between rounded-2xl p-3.5" style={{ background: 'var(--bg-l2)' }}>
                  <span className="text-[13px]" style={{ color: 'var(--t1)' }}>Разрешить вывод средств</span>
                  <span className="h-5 w-9 rounded-full p-0.5" style={{ background: editingMember.canWithdraw ? 'var(--accent)' : 'var(--border)' }}>
                    <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: editingMember.canWithdraw ? 16 : 0 }}/>
                  </span>
                </button>
                <button type="button" onClick={() => updateMemberLimits(editingMember.id, { canDepositOnly: !editingMember.canDepositOnly })}
                  className="flex w-full items-center justify-between rounded-2xl p-3.5" style={{ background: 'var(--bg-l2)' }}>
                  <span className="text-[13px]" style={{ color: 'var(--t1)' }}>Только пополнение (без переводов)</span>
                  <span className="h-5 w-9 rounded-full p-0.5" style={{ background: editingMember.canDepositOnly ? 'var(--accent)' : 'var(--border)' }}>
                    <motion.span className="block h-4 w-4 rounded-full bg-white" animate={{ x: editingMember.canDepositOnly ? 16 : 0 }}/>
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LimitRow = ({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) => (
  <div>
    <p className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</p>
    <input value={value ?? ''} onChange={e => onChange(Number(e.target.value.replace(/\D/g,'')) || 0)} inputMode="numeric" placeholder="Без лимита"
      className="w-full rounded-2xl px-4 py-2.5 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
  </div>
);
