/**
 * Sky Pets — экран питомца: 3D-окно по центру, статус, действия.
 * Стиль — Liquid Glass, Sky purple/space, без вида типового чат-бота.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Heart, Utensils, Shirt, Store, Sparkles, Loader2 } from 'lucide-react';
import { Pet3DViewer } from './Pet3DViewer';
import {
  apiPetsMe, apiPetsRename, apiPetsInteract, apiPetsChangeType, apiPetsSetSkin, apiPetsMeta, apiPetsGetSkin,
  type Pet, type PetSkin,
} from './petsApi';
import { PetsMarket } from './PetsMarket';
import { useModuleStore } from '@/data/state/modules';

const TYPE_LABEL: Record<string, string> = { dragon: 'Дракон', cat: 'Кот', robot: 'Робот', phoenix: 'Феникс' };

export const PetsScreen = () => {
  const [pet, setPet] = useState<Pet | null>(null);
  const [activeSkin, setActiveSkin] = useState<PetSkin | null>(null);
  const [petTypes, setPetTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [showTypes, setShowTypes] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pendingPetsMarket, setPendingPetsMarket } = useModuleStore();

  // Голосовая команда «покажи маркет скинов» доносит сюда намерение
  // сразу открыть маркет — тем же приёмом, что pendingExtrasTab.
  useEffect(() => {
    if (pendingPetsMarket) { setShowMarket(true); setPendingPetsMarket(false); }
  }, [pendingPetsMarket, setPendingPetsMarket]);

  const load = async () => {
    const [p, meta] = await Promise.all([apiPetsMe(), apiPetsMeta()]);
    setPet(p);
    setPetTypes(meta.petTypes);
    setActiveSkin(p?.activeSkinId ? await apiPetsGetSkin(p.activeSkinId) : null);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const xpForLevel = (level: number) => (level - 1) * 100;
  const xpProgress = pet ? (pet.experience - xpForLevel(pet.level)) / 100 : 0;

  const doInteract = async (action: 'feed' | 'play') => {
    if (!pet || busy) return;
    setBusy(true);
    const r = await apiPetsInteract(action);
    setBusy(false);
    if (r.ok) setPet(r.pet);
  };

  const startRename = () => { setName(pet?.name ?? ''); setRenaming(true); };
  const saveRename = async () => {
    const r = await apiPetsRename(name.trim());
    if (r.ok) setPet(r.pet);
    setRenaming(false);
  };

  const changeType = async (type: string) => {
    const r = await apiPetsChangeType(type);
    if (r.ok) { setPet(r.pet); setActiveSkin(null); }
    setShowTypes(false);
  };

  if (loading) {
    return <div className="grid h-full place-items-center"><Loader2 className="animate-spin" style={{ color: 'var(--accent)' }}/></div>;
  }
  if (!pet) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(139,92,246,0.12), transparent 60%)' }}>
      <div className="flex items-center justify-between px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#a855f7,#ec4899)' }}>
            <Sparkles size={16} className="text-white"/>
          </div>
          <div>
            <h2 className="text-sm font-black" style={{ color: 'var(--t1)' }}>Питомец</h2>
            <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{TYPE_LABEL[pet.type] ?? pet.type} · уровень {pet.level}</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowMarket(true)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
          <Store size={13}/> Маркет скинов
        </button>
      </div>

      <div style={{ height: 300 }} className="shrink-0">
        <Pet3DViewer petType={pet.type} modelUrl={activeSkin?.modelUrl}/>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="flex items-center justify-between">
          {renaming ? (
            <div className="flex flex-1 items-center gap-2">
              <input value={name} onChange={e => setName(e.target.value)} maxLength={32} autoFocus
                onKeyDown={e => e.key === 'Enter' && void saveRename()}
                className="flex-1 rounded-xl px-3 py-1.5 text-sm outline-none"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <button type="button" onClick={() => void saveRename()} className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Готово</button>
            </div>
          ) : (
            <button type="button" onClick={startRename} className="flex items-center gap-1.5">
              <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{pet.name}</p>
              <Pencil size={13} style={{ color: 'var(--t3)' }}/>
            </button>
          )}
          {activeSkin && (
            <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
              {activeSkin.name}
            </span>
          )}
        </div>

        <div>
          <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--t3)' }}>
            <span>Опыт</span><span>{pet.experience - xpForLevel(pet.level)}/100</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-l2)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, xpProgress * 100))}%`, background: 'linear-gradient(90deg,#a855f7,#ec4899)' }}/>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => void doInteract('feed')} disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
            <Utensils size={14}/> Покормить
          </button>
          <button type="button" onClick={() => void doInteract('play')} disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
            <Heart size={14}/> Поиграть
          </button>
        </div>

        {pet.ownedSkinIds.length > 0 && (
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Мои скины</p>
            <div className="flex flex-wrap gap-2">
              {pet.ownedSkinIds.map(id => (
                <button key={id} type="button"
                  onClick={async () => { const r = await apiPetsSetSkin(id); if (r.ok) { setPet(r.pet); setActiveSkin(await apiPetsGetSkin(id)); } }}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: pet.activeSkinId === id ? 'rgba(168,85,247,0.2)' : 'var(--bg-l2)',
                    border: `1px solid ${pet.activeSkinId === id ? '#a855f7' : 'var(--border)'}`,
                    color: pet.activeSkinId === id ? '#a855f7' : 'var(--t2)',
                  }}>
                  <Shirt size={11} className="inline mr-1"/>{id === pet.activeSkinId ? 'Надет' : 'Надеть'}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="button" onClick={() => setShowTypes(true)}
          className="w-full text-center text-xs font-medium py-1.5" style={{ color: 'var(--t3)' }}>
          Сменить питомца
        </button>
      </div>

      <AnimatePresence>
        {showTypes && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={() => setShowTypes(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}
              className="w-full max-w-xs rounded-2xl p-4 space-y-2" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <p className="text-sm font-bold mb-1" style={{ color: 'var(--t1)' }}>Сменить питомца</p>
              <p className="text-[11px] mb-2" style={{ color: 'var(--t3)' }}>Уровень и опыт сохранятся, скин сбросится — скины привязаны к виду.</p>
              {petTypes.map(t => (
                <button key={t} type="button" onClick={() => void changeType(t)}
                  className="w-full rounded-xl py-2.5 text-sm font-semibold text-left px-3"
                  style={{ background: pet.type === t ? 'rgba(168,85,247,0.15)' : 'var(--bg-l2)', color: pet.type === t ? '#a855f7' : 'var(--t1)' }}>
                  {TYPE_LABEL[t] ?? t}
                </button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMarket && (
          <PetsMarket
            myPetType={pet.type}
            onClose={() => setShowMarket(false)}
            onBought={() => void load()}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
