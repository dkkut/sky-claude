import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useFamilyStore } from './store';
import { CreateFamily } from './components/CreateFamily';
import { FamilyHome } from './components/FamilyHome';
import { FamilyWallet } from './components/FamilyWallet';
import { FamilyGoals } from './components/FamilyGoals';
import { FamilyAchievements } from './components/FamilyAchievements';
import { MembersScreen } from './components/MembersScreen';
import { ApprovalsScreen } from './components/ApprovalsScreen';
import { FamilyPrime } from './components/FamilyPrime';
import { FamilyShoppingList } from './components/FamilyShoppingList';
import { FamilyStatistics } from './components/FamilyStatistics';
import { FamilyCalendar } from './components/FamilyCalendar';
import { FamilySecurity } from './components/FamilySecurity';
import { FamilyLocation } from './components/FamilyLocation';
import { FamilyAllowance } from './components/FamilyAllowance';
import { FamilySafe } from './components/FamilySafe';
import { FamilyCapsule } from './components/FamilyCapsule';
import { FamilyPermissions } from './components/FamilyPermissions';
import { FamilyAI } from './components/FamilyAI';
import { FamilyTravel } from './components/FamilyTravel';

type View = 'home'|'wallet'|'goals'|'achievements'|'members'|'approvals'|'prime'|'shopping'|'stats'|'calendar'|'security'|'location'|'allowance'|'safe'|'capsule'|'permissions'|'ai'|'travel';

export const FamilyModule = () => {
  const { family, loaded, load } = useFamilyStore();
  const [view, setView] = useState<View>('home');

  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  if (!loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} />
      </div>
    );
  }

  if (!family) return <CreateFamily/>;

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
            <FamilyHome onNav={setView}/>
          </motion.div>
        )}
        {view === 'wallet' && (
          <motion.div key="wallet" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyWallet onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'goals' && (
          <motion.div key="goals" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyGoals onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'achievements' && (
          <motion.div key="ach" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyAchievements onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'members' && (
          <motion.div key="members" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <MembersScreen onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'approvals' && (
          <motion.div key="approvals" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <ApprovalsScreen onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'prime' && (
          <motion.div key="prime" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyPrime onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'shopping' && (
          <motion.div key="shopping" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyShoppingList onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'stats' && (
          <motion.div key="stats" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyStatistics onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'calendar' && (
          <motion.div key="calendar" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyCalendar onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'security' && (
          <motion.div key="security" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilySecurity onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'location' && (
          <motion.div key="location" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyLocation onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'allowance' && (
          <motion.div key="allowance" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyAllowance onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'safe' && (
          <motion.div key="safe" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilySafe onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'capsule' && (
          <motion.div key="capsule" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyCapsule onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'permissions' && (
          <motion.div key="permissions" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyPermissions onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'ai' && (
          <motion.div key="ai" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyAI onBack={() => setView('home')}/>
          </motion.div>
        )}
        {view === 'travel' && (
          <motion.div key="travel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full" style={{ background: 'var(--bg)' }}>
            <FamilyTravel onBack={() => setView('home')}/>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
