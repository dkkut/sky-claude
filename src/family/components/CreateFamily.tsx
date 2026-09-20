import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Users, Wallet, Target, Sparkles, Check, X, Mail } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';
import { ROLE_LABEL } from '../types';

const PERKS = [
  { icon: Wallet,  text: 'Общий счёт Sky Money с лимитами для детей' },
  { icon: Target,  text: 'Семейные цели и совместные накопления' },
  { icon: Sparkles,text: 'Общие баллы, кешбэк и достижения семьи' },
  { icon: Users,   text: 'До 8 участников, родительский контроль' },
];

/** Входящие приглашения показываются здесь же: пока своей семьи нет,
    это единственное, что можно сделать в Sky Family — принять чужое
    приглашение или создать свою. */
const IncomingInvitations = () => {
  const { invitations, acceptInvitation, rejectInvitation } = useFamilyStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (invitations.length === 0) return null;

  const accept = async (id: string) => {
    setBusyId(id); setError('');
    const r = await acceptInvitation(id);
    setBusyId(null);
    if (!r.ok) setError(r.error === 'member_limit' ? 'В семье уже нет мест' : r.error === 'expired' ? 'Приглашение устарело' : 'Не получилось принять приглашение');
  };
  const reject = async (id: string) => {
    setBusyId(id);
    await rejectInvitation(id);
    setBusyId(null);
  };

  return (
    <div className="mb-6 space-y-2.5">
      <p className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>
        <Mail size={13}/>Приглашения в семью
      </p>
      <AnimatePresence>
        {invitations.map(inv => (
          <motion.div key={inv.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-3.5" style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)' }}>
            <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>«{inv.familyName}»</p>
            <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>
              {inv.senderName ?? 'Владелец'} приглашает вас как «{ROLE_LABEL[inv.role]}»
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" disabled={busyId === inv.id} onClick={() => accept(inv.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                <Check size={13}/>Принять
              </button>
              <button type="button" disabled={busyId === inv.id} onClick={() => reject(inv.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold disabled:opacity-50"
                style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                <X size={13}/>Отклонить
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {error && <p className="text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  );
};

export const CreateFamily = () => {
  const { createFamily, invitations, load, loaded } = useFamilyStore();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const submit = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    const ok = await createFamily(name.trim());
    setCreating(false);
    if (!ok) setError('Не получилось создать семью — попробуйте ещё раз');
  };

  if (creating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <motion.div animate={{ scale: [1,1.15,1], rotate: [0,8,-8,0] }} transition={{ duration: 1.2, repeat: Infinity }} ><FamilyIcon kind="home" size={36} color="var(--accent)"/></motion.div>
        <p className="text-[13px]" style={{ color: 'var(--t3)' }}>Создаём пространство для вашей семьи…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
          className="grid h-20 w-20 place-items-center rounded-3xl text-4xl"
          style={{ background: 'linear-gradient(135deg, rgba(79,110,247,0.25), rgba(139,92,246,0.2))', boxShadow: '0 8px 30px rgba(79,110,247,0.35)' }}>
            <FamilyIcon kind="home" size={30} color="var(--accent)"/>
        </motion.div>
        <h1 className="mt-4 text-2xl font-black" style={{ color: 'var(--t1)' }}>Sky Family</h1>
        <p className="mt-1 max-w-xs text-[13px]" style={{ color: 'var(--t3)' }}>
          Единое цифровое пространство для всей семьи — общий счёт, цели, баллы и забота о близких
        </p>
      </div>

      {invitations.length > 0 && (
        <div className="mt-8"><IncomingInvitations/></div>
      )}

      <div className="mt-8 space-y-3">
        {PERKS.map((p, i) => (
          <motion.div key={p.text} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i*0.08 }}
            className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--accent-bg)' }}>
              <p.icon size={17} style={{ color: 'var(--accent)' }}/>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{p.text}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-8">
        <p className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Название семьи</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Семья Ивановых" maxLength={30}
          className="w-full rounded-2xl px-4 py-3.5 text-[14px] outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
      </div>

      {error && <p className="mt-2 text-[11.5px]" style={{ color: '#ef4444' }}>{error}</p>}

      <motion.button type="button" whileTap={name.trim() ? { scale: 0.98 } : {}} disabled={!name.trim()} onClick={submit}
        className="sky-btn-primary mt-4 w-full justify-center py-4 text-[14.5px] disabled:opacity-40">
        <Home size={16}/>Создать семью
      </motion.button>
      <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Можно создать только одну семейную группу · до 8 участников · до 2 взрослых-администраторов</p>
    </div>
  );
};
