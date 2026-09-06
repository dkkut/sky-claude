import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Send, Users, Radio, Plus } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useMoney, fmt } from '@/wallet/store';

const Backdrop = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <AnimatePresence>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10030] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl overflow-hidden"
        style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        {children}
      </motion.div>
    </motion.div>
  </AnimatePresence>
);

const SheetHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
    <h3 className="font-bold text-base" style={{ color: 'var(--t1)' }}>{title}</h3>
    <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
      style={{ background: 'var(--bg-l2)' }}>
      <X size={16} style={{ color: 'var(--t2)' }} />
    </button>
  </div>
);

/* ================================================================ Жалоба */
const REPORT_REASONS = ['Спам', 'Оскорбления', 'Мошенничество', 'Ложный профиль', 'Нарушение правил Sky', 'Другое'];

export const ReportProfileSheet = ({ targetId, onClose }: { targetId: string; onClose: () => void }) => {
  const { addReport } = useMessengerStore();
  const { currentUserId } = useAuthStore();
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);

  const submit = () => {
    if (!reason || !currentUserId) return;
    addReport({ chatId: '', reporterId: currentUserId, reportedId: targetId, reason });
    setSent(true);
    setTimeout(onClose, 1100);
  };

  return (
    <Backdrop onClose={onClose}>
      <SheetHeader title="Пожаловаться на профиль" onClose={onClose} />
      {sent ? (
        <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)' }}>
            <Check size={22} style={{ color: 'var(--green)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Жалоба отправлена</p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Модерация Sky рассмотрит её в ближайшее время</p>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 space-y-1">
            {REPORT_REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{ background: reason === r ? 'rgba(91,155,209,0.15)' : 'transparent' }}>
                <div className="h-4 w-4 rounded-full border flex items-center justify-center shrink-0"
                  style={{ borderColor: reason === r ? 'var(--accent)' : 'var(--t3)' }}>
                  {reason === r && <div className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />}
                </div>
                <span className="text-sm" style={{ color: 'var(--t1)' }}>{r}</span>
              </button>
            ))}
          </div>
          <div className="px-4 pb-4 pt-1">
            <button type="button" disabled={!reason} onClick={submit}
              className="w-full py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40"
              style={{ background: 'var(--red)', color: '#fff' }}>
              Отправить жалобу
            </button>
          </div>
        </>
      )}
    </Backdrop>
  );
};

/* ============================================================ Sky Money */
export const TransferMoneySheet = ({ targetId, targetName, onClose }: { targetId: string; targetName: string; onClose: () => void }) => {
  const { currentUserId } = useAuthStore();
  const { getBalance, transfer } = useMoney();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const balance = currentUserId ? getBalance(currentUserId) : 0;
  const num = Number(amount);
  const valid = num > 0 && num <= balance;

  const submit = () => {
    if (!currentUserId || !valid) return;
    const ok = transfer(currentUserId, targetId, num);
    if (ok) { setDone(true); setTimeout(onClose, 1100); }
  };

  return (
    <Backdrop onClose={onClose}>
      <SheetHeader title={`Перевести ${targetName}`} onClose={onClose} />
      {done ? (
        <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)' }}>
            <Check size={22} style={{ color: 'var(--green)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{fmt(num)} отправлено</p>
        </div>
      ) : (
        <div className="px-5 py-4 space-y-4">
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: 'var(--t3)' }}>Доступно {fmt(balance)}</div>
            <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="0" inputMode="numeric"
              className="w-full bg-transparent text-center text-4xl font-bold outline-none"
              style={{ color: 'var(--t1)' }} />
          </div>
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Сообщение (необязательно)"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }} />
          <button type="button" disabled={!valid} onClick={submit}
            className="w-full py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            <Send size={15} /> Перевести
          </button>
          {num > balance && <p className="text-xs text-center" style={{ color: 'var(--red)' }}>Недостаточно средств</p>}
        </div>
      )}
    </Backdrop>
  );
};

/* ================================================== Пригласить в чат */
export const InviteToChatSheet = ({ targetId, targetName, kind, onClose }: {
  targetId: string; targetName: string; kind: 'group' | 'channel'; onClose: () => void;
}) => {
  const { currentUserId } = useAuthStore();
  const { chats, addParticipant, createChat } = useMessengerStore();
  const [invited, setInvited] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');

  const myChats = useMemo(
    () => chats.filter(c => c.type === kind && c.ownerId === currentUserId && !(c.participants ?? []).includes(targetId)),
    [chats, kind, currentUserId, targetId],
  );

  const invite = (chatId: string) => {
    addParticipant(chatId, targetId, targetName);
    setInvited(chatId);
    setTimeout(onClose, 900);
  };

  const createAndInvite = () => {
    if (!newName.trim()) return;
    const id = createChat({ name: newName.trim(), type: kind, memberIds: [targetId] });
    if (id) { setInvited(id); setTimeout(onClose, 900); }
  };

  const label = kind === 'group' ? 'группу' : 'канал';

  return (
    <Backdrop onClose={onClose}>
      <SheetHeader title={`Пригласить в ${label}`} onClose={onClose} />
      {invited ? (
        <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)' }}>
            <Check size={22} style={{ color: 'var(--green)' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{targetName} добавлен(а)</p>
        </div>
      ) : creatingNew ? (
        <div className="px-5 py-4 space-y-3">
          <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
            placeholder={kind === 'group' ? 'Название группы' : 'Название канала'}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }} />
          <button type="button" disabled={!newName.trim()} onClick={createAndInvite}
            className="w-full py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            Создать и пригласить
          </button>
        </div>
      ) : (
        <div className="px-3 py-2 max-h-[50vh] overflow-y-auto">
          {myChats.map(c => (
            <button key={c.id} type="button" onClick={() => invite(c.id)}
              className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl sky-hover-lift text-left">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                style={{ background: '#6e8eff' }}>
                {kind === 'group' ? <Users size={16} /> : <Radio size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate" style={{ color: 'var(--t1)' }}>{c.name}</div>
                <div className="text-xs" style={{ color: 'var(--t3)' }}>{c.members ?? (c.participants?.length ?? 0)} участников</div>
              </div>
            </button>
          ))}
          <button type="button" onClick={() => setCreatingNew(true)}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl sky-hover-lift text-left">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--bg-l2)' }}>
              <Plus size={16} style={{ color: 'var(--t2)' }} />
            </div>
            <div className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>
              Создать {kind === 'group' ? 'новую группу' : 'новый канал'}
            </div>
          </button>
          {myChats.length === 0 && (
            <p className="px-2 py-4 text-xs text-center" style={{ color: 'var(--t3)' }}>
              У вас пока нет {kind === 'group' ? 'групп' : 'каналов'}, где вы администратор
            </p>
          )}
        </div>
      )}
    </Backdrop>
  );
};
