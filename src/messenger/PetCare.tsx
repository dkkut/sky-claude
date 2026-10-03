/* ===================================================================
   SKY PETS  -  уход за питомцем
   Tamagotchi-экран: реальные показатели/уровень/кулдауны с сервера
   (server/pets.mjs::careForPet) — ничего не считается в браузере.
=================================================================== */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Sparkles, Heart, Coins, ArrowUpCircle } from 'lucide-react';
import {
  apiMyPets, apiCareForPet, apiEvolvePet,
  CARE_ACTION_LABEL, CARE_ACTION_EMOJI, CARE_ACTION_COOLDOWN,
  type PetInstance, type CareAction,
} from './petsApi';
import { petVisual, RARITY_VISUAL } from './petVisuals';

const ACTIONS: CareAction[] = ['feed', 'play', 'pet', 'sleep', 'walk', 'toy'];
const ACTION_COLOR: Record<CareAction, string> = {
  feed: 'var(--amber)', play: '#10b981', pet: '#ec4899', sleep: '#8b5cf6', walk: '#22d3ee', toy: '#3b82f6',
};

const STAT_CFG = [
  { key: 'hunger' as const, label: 'Сытость', emoji: '🍖', color: 'var(--amber)' },
  { key: 'happiness' as const, label: 'Счастье', emoji: '💖', color: '#f43f5e' },
  { key: 'energy' as const, label: 'Энергия', emoji: '⚡', color: '#22d3ee' },
  { key: 'loyalty' as const, label: 'Привязанность', emoji: '🫶', color: '#a855f7' },
];

const xpForLevel = (level: number) => level * 200; // зеркало server/pets.mjs::xpForLevel (xp_per_level_base по умолчанию)
const STAGE_LABEL: Record<string, string> = { baby: 'Малыш', young: 'Юный', adult: 'Взрослый', special: 'Особый' };
const stageForLevel = (level: number) => (level >= 30 ? 'special' : level >= 15 ? 'adult' : level >= 5 ? 'young' : 'baby');

/* --- Частицы при действии ---------------------------------------- */
interface Particle { id: string; x: number; y: number; emoji: string }
const ParticleLayer = ({ particles }: { particles: Particle[] }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <AnimatePresence>
      {particles.map((p) => (
        <motion.div key={p.id}
          initial={{ x: p.x, y: p.y, opacity: 1, scale: 0.5 }}
          animate={{ y: p.y - 80 - Math.random() * 40, x: p.x + (Math.random() - 0.5) * 60, opacity: 0, scale: 1.4 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="absolute text-2xl select-none"
          style={{ transform: 'translate(-50%,-50%)' }}>
          {p.emoji}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

const StatBar = ({ label, emoji, value, color, flash }: { label: string; emoji: string; value: number; color: string; flash: boolean }) => {
  const low = value < 35; // STAT_MIN сервера — 20, поэтому порог тревоги чуть выше минимума
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{emoji}</span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</span>
        </div>
        <motion.span animate={flash ? { scale: [1, 1.4, 1] } : {}} className="text-[11px] font-bold tabular-nums"
          style={{ color: low ? 'var(--red)' : color }}>{Math.round(value)}</motion.span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-l3)' }}>
        <motion.div animate={{ width: `${value}%` }} transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ background: low ? 'linear-gradient(90deg,#f87171,#ef4444)' : `linear-gradient(90deg,${color}88,${color})` }} />
      </div>
    </div>
  );
};

interface PetCareProps {
  petId: string;
  onBack: () => void;
  /** Родитель (PetPanel/PetHouse) держит свой список питомцев — после
   *  любого действия отдаём обновлённого питомца, чтобы не разъезжались
   *  две копии одного состояния. */
  onPetUpdated?: (pet: PetInstance) => void;
}

export const PetCareScreen = ({ petId, onBack, onPetUpdated }: PetCareProps) => {
  const [pet, setPet] = useState<PetInstance | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<Record<CareAction, number>>({} as Record<CareAction, number>);
  const [busyAction, setBusyAction] = useState<CareAction | null>(null);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [particles, setParticles] = useState<Particle[]>([]);
  const [reaction, setReaction] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [petFrame, setPetFrame] = useState(0);
  const [, setTick] = useState(0);
  const petRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiMyPets();
    if (!r.ok || !r.data) { setLoadFailed(true); return; }
    const found = r.data.pets.find((p) => p.id === petId) ?? null;
    setPet(found);
    if (!found) setLoadFailed(true);
  }, [petId]);

  useEffect(() => { void load(); }, [load]);

  const visual = petVisual(pet?.typeId ?? '', pet?.type?.species);
  const cfg = RARITY_VISUAL[pet?.rarity ?? 'common'];

  /* Анимация питомца */
  useEffect(() => {
    const frames = visual.moods.idle;
    const t = setInterval(() => setPetFrame((f) => (f + 1) % frames.length), 900);
    return () => clearInterval(t);
  }, [visual]);

  /* Тик раз в секунду — только чтобы обновить отсчёт кулдауна на экране. */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const spawnParticles = (emoji: string) => {
    const rect = petRef.current?.getBoundingClientRect();
    const pRect = petRef.current?.parentElement?.getBoundingClientRect();
    if (!rect || !pRect) return;
    const cx = rect.left - pRect.left + rect.width / 2;
    const cy = rect.top - pRect.top + rect.height / 2;
    const now = Date.now();
    const newP: Particle[] = Array.from({ length: 6 }, (_, i) => ({
      id: `${now}-${i}`, x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 30, emoji,
    }));
    setParticles((p) => [...p, ...newP]);
    setTimeout(() => setParticles((p) => p.filter((x) => !newP.find((n) => n.id === x.id))), 1200);
  };

  const doAction = useCallback(async (action: CareAction) => {
    if (!pet || busyAction) return;
    const remaining = (cooldownUntil[action] ?? 0) - Date.now();
    if (remaining > 0) return;

    setBusyAction(action);
    const r = await apiCareForPet(pet.id, action);
    setBusyAction(null);

    if (!r.ok || !r.data || 'error' in r.data) {
      const remainingSeconds = (r.data && 'remainingSeconds' in r.data) ? r.data.remainingSeconds : undefined;
      if (remainingSeconds) setCooldownUntil((c) => ({ ...c, [action]: Date.now() + remainingSeconds * 1000 }));
      setToast('Рано — питомец пока отдыхает от этого');
      setTimeout(() => setToast(''), 1800);
      return;
    }

    const { pet: updated, coinsEarned, leveledUp } = r.data;
    setPet(updated);
    onPetUpdated?.(updated);
    setCooldownUntil((c) => ({ ...c, [action]: Date.now() + CARE_ACTION_COOLDOWN[action] * 1000 }));

    spawnParticles(CARE_ACTION_EMOJI[action]);
    const reactions: Record<CareAction, string> = { feed: '😋', play: '😸', pet: '🥰', sleep: '😴', walk: '🐾', toy: '🧸' };
    setReaction(reactions[action]);
    setTimeout(() => setReaction(null), 1800);

    const touched: Record<CareAction, string[]> = {
      feed: ['hunger', 'happiness', 'energy'], play: ['happiness', 'energy', 'hunger'], pet: ['happiness', 'loyalty'],
      sleep: ['energy', 'happiness'], walk: ['happiness', 'energy', 'loyalty'], toy: ['happiness'],
    };
    setFlashing(new Set(touched[action]));
    setTimeout(() => setFlashing(new Set()), 700);

    let msg = `${CARE_ACTION_LABEL[action]}: готово`;
    if (coinsEarned > 0) msg += ` · +${coinsEarned} 🪙`;
    if (leveledUp) msg += ` · новый уровень ${updated.level}! 🎉`;
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }, [pet, busyAction, cooldownUntil, onPetUpdated]);

  const doEvolve = useCallback(async () => {
    if (!pet) return;
    const r = await apiEvolvePet(pet.id);
    if (r.ok && r.data && 'pet' in r.data) {
      setPet(r.data.pet);
      onPetUpdated?.(r.data.pet);
      setToast(`Эволюция! Теперь ${STAGE_LABEL[r.data.pet.stage] ?? r.data.pet.stage} 🌟`);
      setTimeout(() => setToast(''), 2500);
    }
  }, [pet, onPetUpdated]);

  if (loadFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-2xl">🐾</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Не удалось загрузить питомца. Попробуй вернуться назад и выбрать его снова.</p>
        <button type="button" onClick={onBack} className="mt-2 rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Назад</button>
      </div>
    );
  }
  if (!pet) {
    return <div className="flex h-full items-center justify-center" style={{ color: 'var(--t3)' }}>Загрузка…</div>;
  }

  const xpNeeded = xpForLevel(pet.level);
  const xpPct = Math.min(100, (pet.xp / xpNeeded) * 100);
  const canEvolve = stageForLevel(pet.level) !== pet.stage
    && ['baby', 'young', 'adult', 'special'].indexOf(stageForLevel(pet.level)) > ['baby', 'young', 'adult', 'special'].indexOf(pet.stage);
  const moodFrames = visual.moods[pet.mood] ?? visual.moods.idle;

  const cdLeft = (action: CareAction) => {
    const rem = (cooldownUntil[action] ?? 0) - Date.now();
    if (rem <= 0) return null;
    const m = Math.ceil(rem / 60000);
    return m >= 60 ? `${Math.ceil(m / 60)}ч` : `${m}м`;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-l1)' }}>
        <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <ArrowLeft size={16} />
        </motion.button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>
            {pet.name}
            <span className="ml-2 text-[10px] font-normal" style={{ color: cfg.color }}>{cfg.label}</span>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
            {pet.type?.species ?? ''} · Ур. {pet.level} «{STAGE_LABEL[pet.stage] ?? pet.stage}»
          </p>
        </div>
        {canEvolve && (
          <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => void doEvolve()}
            className="flex items-center gap-1 rounded-2xl px-3 py-1.5" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <ArrowUpCircle size={12} style={{ color: '#f59e0b' }} />
            <span className="text-[11px] font-bold" style={{ color: '#f59e0b' }}>Эволюция</span>
          </motion.button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="relative mx-4 mt-4 rounded-3xl overflow-hidden"
          style={{ background: `radial-gradient(ellipse at 50% 80%, ${cfg.color}18 0%, var(--bg-l2) 70%)`, border: `1px solid ${cfg.color}30`, minHeight: 200 }}>
          <ParticleLayer particles={particles} />
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(3)].map((_, i) => (
              <motion.div key={i} animate={{ scale: [1, 1.15, 1], opacity: [0.06, 0.12, 0.06] }}
                transition={{ duration: 3 + i * 0.7, repeat: Infinity, delay: i * 0.9 }}
                className="absolute rounded-full"
                style={{ width: 80 + i * 40, height: 80 + i * 40, background: cfg.color, left: `${20 + i * 25}%`, top: `${30 + i * 10}%`, transform: 'translate(-50%,-50%)' }} />
            ))}
          </div>

          <div ref={petRef} className="relative flex flex-col items-center justify-center py-8 gap-2">
            <AnimatePresence>
              {reaction && (
                <motion.div initial={{ scale: 0, y: 10, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0, y: -20, opacity: 0 }}
                  className="absolute top-2 text-4xl select-none z-10">{reaction}</motion.div>
              )}
            </AnimatePresence>
            <motion.div
              animate={busyAction ? { scale: [1, 1.25, 0.9, 1.1, 1], rotate: [0, -8, 8, -4, 0] } : { y: [0, -8, 0] }}
              transition={busyAction ? { duration: 0.7, ease: 'easeInOut' } : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              className="text-7xl select-none" style={{ filter: `drop-shadow(0 0 20px ${cfg.glow})` }}>
              {moodFrames[petFrame % moodFrames.length]}
            </motion.div>
            <p className="text-xs font-bold" style={{ color: cfg.color }}>{pet.name}</p>
            <div className="flex gap-1 mt-1">
              {[...Array(5)].map((_, i) => (
                <motion.div key={i} animate={{ opacity: i < Math.ceil(pet.happiness / 20) ? 1 : 0.2 }} className="text-sm">❤️</motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-4 mt-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} style={{ color: cfg.color }} />
              <span className="text-[11px] font-bold" style={{ color: 'var(--t1)' }}>Уровень {pet.level} — {STAGE_LABEL[pet.stage] ?? pet.stage}</span>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{pet.xp} / {xpNeeded} XP</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
            <motion.div className="h-full rounded-full" animate={{ width: `${xpPct}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
              style={{ background: `linear-gradient(90deg,${cfg.color}80,${cfg.color})` }} />
          </div>
        </div>

        <div className="mx-4 mt-3 rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Состояние</p>
          {STAT_CFG.map((s) => (
            <StatBar key={s.key} label={s.label} emoji={s.emoji} value={pet[s.key]} color={s.color} flash={flashing.has(s.key)} />
          ))}
        </div>

        <AnimatePresence>
          {toast && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mx-4 mt-3 rounded-xl px-3 py-2 text-center text-[11px] font-semibold"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: 'var(--green)' }}>
              {toast}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mx-4 mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--t3)' }}>Уход</p>
          <div className="grid grid-cols-3 gap-2">
            {ACTIONS.map((action) => {
              const cd = cdLeft(action);
              const ready = !cd && busyAction === null;
              return (
                <motion.button key={action} type="button" whileTap={ready ? { scale: 0.85 } : {}}
                  disabled={!ready} onClick={() => void doAction(action)}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-3 relative overflow-hidden"
                  style={{
                    background: ready ? `${ACTION_COLOR[action]}14` : 'var(--bg-l2)',
                    border: `1.5px solid ${ready ? `${ACTION_COLOR[action]}50` : 'var(--border)'}`,
                    opacity: ready ? 1 : 0.55, cursor: ready ? 'pointer' : 'default',
                  }}>
                  {ready && (
                    <motion.div className="absolute inset-0 rounded-2xl" animate={{ opacity: [0, 0.15, 0] }}
                      transition={{ duration: 2, repeat: Infinity }} style={{ background: ACTION_COLOR[action] }} />
                  )}
                  <span className="text-2xl relative">{busyAction === action ? '⏳' : CARE_ACTION_EMOJI[action]}</span>
                  <span className="text-[9px] font-semibold relative" style={{ color: ready ? ACTION_COLOR[action] : 'var(--t3)' }}>
                    {CARE_ACTION_LABEL[action]}
                  </span>
                  {cd && <span className="text-[8px] relative" style={{ color: 'var(--t3)' }}>{cd}</span>}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="mx-4 mt-3 mb-4 rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <Coins size={13} style={{ color: '#f59e0b' }} />
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            Уход иногда приносит Pet Coins — шанс растёт с удачей питомца. Монеты настоящие: их можно потратить в Sky Skin Market.
          </p>
        </div>

        {STAT_CFG.filter((s) => pet[s.key] < 35).map((s) => (
          <motion.div key={s.key} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            className="mx-4 mb-2 rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
            <Heart size={12} style={{ color: 'var(--red)' }} />
            <p className="text-[11px] font-semibold" style={{ color: 'var(--red)' }}>{s.label} низкая — позаботься о {pet.name}!</p>
          </motion.div>
        ))}

        <div className="h-4" />
      </div>
    </div>
  );
};
