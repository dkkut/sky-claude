import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RoomsList } from './components/RoomsList';
import { CreateRoom } from './components/CreateRoom';
import { RoomView } from './components/RoomView';
import { useVoicePartyStore } from './store';

type View = { screen: 'list' } | { screen: 'create' } | { screen: 'room'; roomId: string };

interface Props {
  /** Комната, которую нужно открыть сразу же (например, авто-созданная
   *  сервером после подтверждения матча) — см. GamingModule.tsx. */
  autoRoomId?: string | null;
}

export const VoicePartyModule = ({ autoRoomId }: Props = {}) => {
  const [view, setView] = useState<View>(autoRoomId ? { screen: 'room', roomId: autoRoomId } : { screen: 'list' });
  const loadRooms = useVoicePartyStore((s) => s.loadRooms);
  useEffect(() => { void loadRooms(); }, [loadRooms]);
  // Пришла новая авто-комната (новый матч) — переходим в неё, даже если
  // сейчас открыт список или другая комната.
  useEffect(() => {
    if (autoRoomId) setView({ screen: 'room', roomId: autoRoomId });
  }, [autoRoomId]);

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence mode="wait">
        {view.screen === 'list' && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
            <RoomsList
              onOpenRoom={(id) => setView({ screen: 'room', roomId: id })}
              onCreate={() => setView({ screen: 'create' })}/>
          </motion.div>
        )}
        {view.screen === 'create' && (
          <motion.div key="create" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-0 h-full">
            <CreateRoom onBack={() => setView({ screen: 'list' })} onCreated={(id) => setView({ screen: 'room', roomId: id })}/>
          </motion.div>
        )}
        {view.screen === 'room' && (
          <motion.div key="room" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 h-full">
            <RoomView roomId={view.roomId} onLeave={() => setView({ screen: 'list' })}/>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
