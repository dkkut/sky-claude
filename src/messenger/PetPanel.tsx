/* ===================================================================
   SKY PETS  -  панель питомцев для чата
   Отправляет анимированного питомца как "сообщение-стикер"
   Концепт: живые существа с состояниями, реакциями, уровнем дружбы —
   теперь на реальных данных сервера (server/pets.mjs, petEconomy.mjs),
   а не на локальном мок-каталоге (см. petsApi.ts).
=================================================================== */
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Coins } from 'lucide-react';
import { PetCareScreen } from './PetCare';
import {
  apiMyPets, apiPetTypes, apiPetWallet, apiCreatePet, apiSetActivePet,
  type PetInstance, type PetType, type PetMood,
} from './petsApi';
import { petVisual, RARITY_VISUAL } from './petVisuals';

export type { PetMood };

const PetCareInline = PetCareScreen;

/* -- Живой питомец в чате (превью, до отправки) --------------------- */
export const LivePet = ({ typeId, species, color, mood, onMoodEnd }: {
  typeId: string; species?: string; color: string; mood: PetMood; onMoodEnd: () => void;
}) => {
  const visual = petVisual(typeId, species);
  const frames = visual.moods[mood];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (frames.length === 0) return;
    let i = 0;
    const t = setInterval(() => {
      i++;
      if (i >= frames.length) { clearInterval(t); onMoodEnd(); return; }
      setFrame(i);
    }, 700);
    return () => clearInterval(t);
  }, [mood, frames.length, onMoodEnd]);

  return (
    <motion.div initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }}
      className="inline-flex flex-col items-center gap-1">
      <motion.div
        animate={{ y: [0, -6, 0], filter: [`drop-shadow(0 0 8px ${color}55)`, `drop-shadow(0 0 18px ${color}88)`, `drop-shadow(0 0 8px ${color}55)`] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        className="text-4xl select-none">
        {frames[frame]}
      </motion.div>
    </motion.div>
  );
};

/* -- Компонент «питомец в пузыре» (рендерится в MsgBody) ------------
   Всё, что нужно для отрисовки, присылается прямо в сообщении (typeId
   /mood/sound/petName/petColor) — сообщение могут увидеть другие
   участники чата, а они не обязаны знать чужой каталог/инстанс. */
export const PetBubble = ({ typeId, species, mood, sound, petName, petColor }: {
  typeId: string; species?: string; mood: PetMood; sound: string; petName: string; petColor: string;
}) => {
  const visual = petVisual(typeId, species);
  const frames = visual.moods[mood];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (frames.length === 0) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 800);
    return () => clearInterval(t);
  }, [mood, frames.length]);

  if (!typeId) return <span>{sound}</span>;

  return (
    <div className="flex flex-col items-center gap-2 py-2" style={{ minWidth: 100 }}>
      <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        className="text-5xl" style={{ filter: `drop-shadow(0 0 12px ${petColor}55)` }}>
        {frames[frame]}
      </motion.div>
      <p className="text-xs font-bold" style={{ color: petColor }}>{petName}</p>
      {sound && (
        <div className="rounded-full px-3 py-1 text-xs" style={{ background: `${petColor}18`, border: `1px solid ${petColor}35`, color: petColor }}>
          {sound}
        </div>
      )}
    </div>
  );
};

/* -- Главная панель выбора питомца ----------------------------------- */
interface PetPanelProps {
  onSend: (typeId: string, mood: PetMood, sound: string, petName: string, petColor: string) => void;
  onClose: () => void;
}

export const PetPanel = ({ onSend, onClose }: PetPanelProps) => {
  const [pets, setPets] = useState<PetInstance[] | null>(null);
  const [shopTypes, setShopTypes] = useState<PetType[] | null>(null);
  const [wallet, setWallet] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewMood, setPreviewMood] = useState<PetMood>('idle');
  const [tab, setTab] = useState<'my' | 'care' | 'shop'>('my');
  const [shopMsg, setSM] = useState('');
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [petsR, walletR] = await Promise.all([apiMyPets(), apiPetWallet()]);
    if (petsR.ok && petsR.data) {
      setPets(petsR.data.pets);
      const active = petsR.data.pets.find((p) => p.isActive) ?? petsR.data.pets[0];
      setSelected((cur) => cur ?? active?.id ?? null);
    }
    if (walletR.ok && walletR.data) setWallet(walletR.data.balance);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadShop = useCallback(async () => {
    const r = await apiPetTypes();
    if (r.ok && r.data) setShopTypes(r.data.types.filter((t) => t.availableFrom === 'shop'));
  }, []);
  useEffect(() => { if (tab === 'shop' && !shopTypes) void loadShop(); }, [tab, shopTypes, loadShop]);

  const pet = pets?.find((p) => p.id === selected) ?? null;
  const owned = pets ?? [];

  const handleSend = (mood: PetMood) => {
    if (!pet) return;
    const visual = petVisual(pet.typeId, pet.type?.species);
    const sound = visual.sounds[Math.floor(Math.random() * visual.sounds.length)];
    onSend(pet.typeId, mood, sound, pet.name, pet.type?.color ?? '#8b5cf6');
  };

  const selectPet = async (petId: string) => {
    setSelected(petId); setPreviewMood('idle');
    await apiSetActivePet(petId);
  };

  const adopt = async (type: PetType) => {
    setBuying(type.id); setSM('');
    const r = await apiCreatePet(type.id, true);
    setBuying(null);
    if (!r.ok || !r.data || 'error' in r.data) {
      setSM(r.data && 'error' in r.data && r.data.error === 'insufficient_coins' ? '❌ Недостаточно Pet Coins' : '❌ Не получилось');
      setTimeout(() => setSM(''), 2000);
      return;
    }
    setSM(`✓ ${type.name} теперь с тобой!`);
    setTimeout(() => setSM(''), 2000);
    setSelected(r.data.pet.id);
    setTab('my');
    void load();
  };

  const MOODS: { key: PetMood; label: string; emoji: string; color: string }[] = [
    { key: 'idle', label: 'Обычный', emoji: '😌', color: 'var(--t2)' },
    { key: 'happy', label: 'Радуется', emoji: '😊', color: 'var(--green)' },
    { key: 'excited', label: 'Восторг', emoji: '🤩', color: 'var(--amber)' },
    { key: 'sleepy', label: 'Устал', emoji: '😴', color: '#8b5cf6' },
    { key: 'love', label: 'Влюблён', emoji: '😻', color: '#f43f5e' },
  ];

  return (
    <motion.div initial={{ opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 8 }}
      className="absolute bottom-full right-0 mb-2 z-[200] flex flex-col overflow-hidden rounded-2xl"
      style={{ width: 320, maxHeight: 460, background: 'var(--bg-l1)', border: '1px solid var(--border-m)', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>

      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Питомцы</p>
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
            <Coins size={10} /> {wallet}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['my', 'care', 'shop'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className="px-3 py-1 text-xs font-semibold transition-all"
                style={{ background: tab === t ? 'var(--accent)' : 'transparent', color: tab === t ? '#fff' : 'var(--t2)' }}>
                {t === 'my' ? `Мои (${owned.length})` : t === 'care' ? 'Уход' : 'Магазин'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} style={{ color: 'var(--t3)' }}><X size={15} /></button>
        </div>
      </div>

      {tab === 'my' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {pets === null && <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--t3)' }}>Загрузка…</p>}

          <div className="flex gap-2 px-3 py-2 overflow-x-auto scroll-none">
            {owned.map((p) => {
              const rc = RARITY_VISUAL[p.rarity];
              const visual = petVisual(p.typeId, p.type?.species);
              const isSelected = p.id === selected;
              return (
                <motion.button key={p.id} type="button" whileTap={{ scale: 0.93 }}
                  onClick={() => void selectPet(p.id)}
                  className="shrink-0 flex flex-col items-center gap-1 rounded-2xl px-3 py-2"
                  style={{
                    background: isSelected ? `${rc.color}18` : 'var(--bg-l2)',
                    border: `1.5px solid ${isSelected ? rc.color : 'var(--border)'}`,
                    boxShadow: isSelected ? `0 0 12px ${rc.glow}` : 'none',
                  }}>
                  <motion.span className="text-2xl" animate={isSelected ? { y: [0, -3, 0] } : {}} transition={{ duration: 1.2, repeat: Infinity }}>
                    {visual.emoji}
                  </motion.span>
                  <span className="text-[9px] font-semibold" style={{ color: isSelected ? rc.color : 'var(--t3)' }}>{p.name}</span>
                </motion.button>
              );
            })}
          </div>

          {pet && (() => {
            const rc = RARITY_VISUAL[pet.rarity];
            const visual = petVisual(pet.typeId, pet.type?.species);
            return (
              <div className="flex-1 px-3 pb-3 space-y-3 overflow-y-auto">
                <div className="rounded-2xl p-4 flex items-center gap-4" style={{ background: `${rc.color}0d`, border: `1px solid ${rc.color}25` }}>
                  <motion.div animate={{ y: [0, -6, 0], filter: [`drop-shadow(0 0 8px ${rc.glow})`, `drop-shadow(0 0 20px ${rc.glow})`, `drop-shadow(0 0 8px ${rc.glow})`] }}
                    transition={{ duration: 1.4, repeat: Infinity }} className="text-5xl shrink-0 select-none">
                    {visual.moods[previewMood][0]}
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{pet.name}</p>
                      <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5" style={{ background: `${rc.color}22`, color: rc.color }}>
                        Ур.{pet.level} · {rc.label}
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed" style={{ color: 'var(--t3)' }}>{pet.type?.description ?? ''}</p>
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[9px] mb-1">
                        <span style={{ color: 'var(--t3)' }}>Привязанность</span>
                        <span style={{ color: pet.type?.color ?? rc.color }}>{pet.loyalty}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                        <motion.div className="h-full rounded-full" animate={{ width: `${pet.loyalty}%` }}
                          style={{ background: `linear-gradient(90deg,${pet.type?.color ?? rc.color}88,${pet.type?.color ?? rc.color})` }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--t3)' }}>Отправить</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {MOODS.map((m) => (
                      <motion.button key={m.key} type="button" whileTap={{ scale: 0.88 }}
                        onClick={() => handleSend(m.key)}
                        onMouseEnter={() => setPreviewMood(m.key)} onMouseLeave={() => setPreviewMood('idle')}
                        className="flex flex-col items-center gap-1 rounded-xl py-2" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                        <span className="text-lg">{m.emoji}</span>
                        <span className="text-[8px] font-medium" style={{ color: 'var(--t3)' }}>{m.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {pets !== null && owned.length === 0 && (
            <div className="flex-1 flex items-center justify-center pb-4">
              <div className="text-center space-y-2">
                <p className="text-3xl">🐾</p>
                <p className="text-xs" style={{ color: 'var(--t3)' }}>Зайди в магазин и возьми питомца!</p>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'care' && selected && (
        <div className="flex-1 overflow-hidden">
          <PetCareInline petId={selected} onBack={() => setTab('my')}
            onPetUpdated={(updated) => setPets((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? prev)} />
        </div>
      )}
      {tab === 'care' && !selected && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-2">
            <p className="text-2xl">🐾</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Сначала выбери питомца во вкладке «Мои»</p>
          </div>
        </div>
      )}

      {tab === 'shop' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {shopMsg && (
            <div className="rounded-xl px-3 py-2 text-xs font-bold text-center"
              style={{ background: shopMsg.startsWith('✓') ? 'rgba(34,197,94,.1)' : 'rgba(244,63,94,.1)', color: shopMsg.startsWith('✓') ? '#22c55e' : '#f43f5e' }}>
              {shopMsg}
            </div>
          )}
          {shopTypes === null && <p className="py-8 text-center text-xs" style={{ color: 'var(--t3)' }}>Загрузка…</p>}
          {shopTypes?.length === 0 && <p className="py-8 text-center text-xs" style={{ color: 'var(--t3)' }}>Магазин временно пуст.</p>}
          {shopTypes?.map((t) => {
            const rc = RARITY_VISUAL[t.rarity];
            const visual = petVisual(t.id, t.species);
            const already = owned.some((p) => p.typeId === t.id);
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: `1px solid ${rc.color}25` }}>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-3xl" style={{ background: `${rc.color}15`, boxShadow: `0 0 12px ${rc.glow}` }}>
                  {visual.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{t.name}</p>
                    <span className="text-[8px] font-bold rounded-full px-1.5 py-0.5" style={{ background: `${rc.color}20`, color: rc.color }}>{rc.label}</span>
                  </div>
                  <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color: 'var(--t3)' }}>{t.description}</p>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} type="button" disabled={buying === t.id || already}
                  onClick={() => void adopt(t)}
                  className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg,${rc.color},${rc.color}bb)` }}>
                  {already ? 'Есть' : buying === t.id ? '…' : `🪙${t.pricePetCoins ?? 0}`}
                </motion.button>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
