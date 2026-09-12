import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Plus, Users, Clock, Radio, Mic } from 'lucide-react';
import { useVoicePartyStore } from '../store';
import { CATEGORY_LABEL, CATEGORY_ICON } from '../types';
import type { VPCategory, VPRoom } from '../types';

const CATS = Object.keys(CATEGORY_LABEL) as VPCategory[];

export const RoomsList = ({ onOpenRoom, onCreate }: { onOpenRoom: (id: string) => void; onCreate: () => void }) => {
  const { liveRooms, popularRooms, scheduledRooms, roomsByCategory, searchRooms } = useVoicePartyStore();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<VPCategory | null>(null);

  const q = query.trim();
  const results = q ? searchRooms(q) : null;
  const live = cat ? roomsByCategory(cat) : liveRooms();
  const popular = popularRooms();
  const scheduled = scheduledRooms();

  const RoomCard = ({ r, big = false }: { r: VPRoom; big?: boolean }) => (
    <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => onOpenRoom(r.id)}
      className="w-full rounded-2xl p-3.5 text-left" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        {(() => { const Icon = CATEGORY_ICON[r.category]; return <Icon size={17} style={{ color:'var(--t2)' }}/>; })()}
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{r.title}</p>
        {!r.scheduledFor && (
          <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: 'var(--red)' }}>
            <Radio size={8}/>LIVE
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-[11.5px]" style={{ color: 'var(--t3)' }}>{r.description || CATEGORY_LABEL[r.category]}</p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {r.participants.slice(0,4).map(p => (
            <div key={p.id} className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-black text-white" style={{ background: p.avatarColor, border: '1.5px solid var(--bg-l1)' }}>{p.name[0]}</div>
          ))}
        </div>
        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--t3)' }}>
          {r.scheduledFor ? (
            <><Clock size={10}/>{new Date(r.scheduledFor).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</>
          ) : (
            <><Users size={10}/>{r.participants.length}/{r.maxParticipants}</>
          )}
        </span>
      </div>
    </motion.button>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black" style={{ color: 'var(--t1)' }}>
            <Mic size={18}/> Voice Party
          </h2>
          <motion.button type="button" whileTap={{ scale: 0.94 }} onClick={onCreate}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
            <Plus size={14}/>Комната
          </motion.button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <Search size={15} style={{ color: 'var(--t3)' }}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск комнат"
            className="flex-1 bg-transparent text-[13.5px] outline-none" style={{ color: 'var(--t1)' }}/>
        </div>
      </div>

      <div className="flex-1 px-4 py-2 space-y-4">
        {results ? (
          <div className="space-y-2">
            {results.length === 0 ? (
              <div className="sky-empty py-10">
                <div className="sky-empty-icon"><Search size={30}/></div>
                <p style={{ color: 'var(--t2)' }}>Ничего не найдено</p>
              </div>
            ) : results.map(r => <RoomCard key={r.id} r={r}/>)}
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              <button type="button" onClick={() => setCat(null)}
                className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: !cat ? 'var(--accent)' : 'var(--bg-l1)', color: !cat ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                Все
              </button>
              {CATS.map(c => (
                <button key={c} type="button" onClick={() => setCat(c)}
                  className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: cat === c ? 'var(--accent)' : 'var(--bg-l1)', color: cat === c ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                  {(() => { const Icon = CATEGORY_ICON[c]; return <Icon size={12} className="inline-block -mt-0.5 mr-1"/>; })()}{CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>

            {!cat && popular.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Популярные</p>
                <div className="space-y-2">{popular.map(r => <RoomCard key={r.id} r={r}/>)}</div>
              </div>
            )}

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{cat ? CATEGORY_LABEL[cat] : 'Сейчас в эфире'}</p>
              {live.length === 0 ? (
                <div className="sky-empty py-8">
                  <div className="sky-empty-icon"><Mic size={30}/></div>
                  <p style={{ color: 'var(--t2)' }}>Пока нет активных комнат</p>
                  <button type="button" onClick={onCreate} className="sky-btn-primary mt-2 px-5 py-2.5">Создать комнату</button>
                </div>
              ) : (
                <div className="space-y-2">{live.map(r => <RoomCard key={r.id} r={r}/>)}</div>
              )}
            </div>

            {scheduled.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Запланированные</p>
                <div className="space-y-2">{scheduled.map(r => <RoomCard key={r.id} r={r}/>)}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
