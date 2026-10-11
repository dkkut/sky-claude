import { useState } from 'react';
import { Gift as GiftIcon, Trophy, CircleUserRound, Lock } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { GIFT_RARITY_COLOR, GIFT_RARITY_LABEL, type SentGift } from '@/gifts/store';
import { GiftBubble } from '@/gifts/SkyGifts';
import { giftMediaUrl } from '@/gifts/giftsApi';
import { SectionHead } from './Head';
import { availableFrames, FRAMES } from '../cosmetics';
import { RARITY_COLOR, RARITY_LABEL } from '@/customization/types';
import { useCustomization } from '@/customization/store';
import { availableProfileThemes, activeProfileTheme } from '@/customization/selectors';
import { PROFILE_THEME_CATALOG } from '@/customization/catalog/profileThemes';
import { MOTIFS } from '@/customization/Decorative';
import type { ProfileData } from '../useProfileData';

type GiftFilter = 'all' | 'exclusive' | 'limited' | 'seasonal';
const FILTERS: { id: GiftFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'exclusive', label: 'Эксклюзивные' },
  { id: 'limited', label: 'Лимитированные' },
  { id: 'seasonal', label: 'Сезонные' },
];

/** Подарок крупной красивой карточкой — той же, что в чате, с подробностями. */
const GiftModal = ({ gift, onClose }: { gift: SentGift; onClose: () => void }) => {
  const rc = GIFT_RARITY_COLOR[gift.giftRarity];
  return createPortal(
    <motion.div className="fixed inset-0 z-[600] flex items-center justify-center px-5"
      style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ scale: 0.8, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="relative w-full max-w-[320px] rounded-[32px] p-5 text-center"
        style={{ background: 'var(--bg-l1)', border: `1px solid ${rc}55`, boxShadow: `0 30px 80px ${rc}44, inset 0 1px 0 rgba(255,255,255,0.12)` }}
        onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Закрыть"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <X size={15} />
        </button>
        <div className="flex justify-center py-3" style={{ transform: 'scale(1.25)', transformOrigin: 'center', margin: '14px 0' }}>
          <GiftBubble gift={gift} fromMe={false} />
        </div>
        <p className="mt-4 text-lg font-black" style={{ color: 'var(--t1)' }} translate="no">{gift.giftName}</p>
        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: rc }}>{GIFT_RARITY_LABEL[gift.giftRarity]}</p>
        <div className="mt-3 space-y-1 rounded-2xl p-3 text-left text-xs" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <p>От: <b style={{ color: 'var(--t1)' }} translate="no">{gift.fromName}</b></p>
          <p>Дата: <b style={{ color: 'var(--t1)' }}>{new Date(gift.sentAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</b></p>
          {gift.message && <p className="pt-1 italic" style={{ color: 'var(--t1)' }} translate="no">«{gift.message}»</p>}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

export const hasCollections = (data: ProfileData) =>
  data.gifts.all.length > 0 || data.progression.achievements.length > 0 || data.isOwn;

export const CollectionsSection = ({ data }: { data: ProfileData }) => {
  const [filter, setFilter] = useState<GiftFilter>('all');
  const [tab, setTab] = useState<'gifts' | 'achievements' | 'frames' | 'theme'>('gifts');
  const [openGift, setOpenGift] = useState<SentGift | null>(null);
  const updateProfile = useAuthStore(s => s.updateProfile);
  const equip = useCustomization(s => s.equip);

  if (!hasCollections(data)) return null;
  const acc = data.account;
  if (!acc) return null;

  const list = data.gifts[filter];
  const myFrames = availableFrames(acc);
  const myThemes = availableProfileThemes(acc);
  const activeThemeId = activeProfileTheme(acc).id;

  return (
    <div className="sky-card p-3.5 sm:p-5" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
      <SectionHead icon={Trophy} title="Коллекции" />

      <div className="flex gap-1.5 mb-4 overflow-x-auto no-scrollbar">
        {(['gifts', 'achievements', 'frames', 'theme'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold shrink-0"
            style={{
              background: tab === t ? 'var(--accent)' : 'var(--bg-l2)',
              color: tab === t ? '#fff' : 'var(--t2)',
            }}>
            {t === 'gifts' ? `Подарки (${data.gifts.all.length})` : t === 'achievements' ? `Награды (${data.progression.achievements.length})` : t === 'frames' ? 'Рамки' : 'Тема профиля'}
          </button>
        ))}
      </div>

      {tab === 'gifts' && (
        <>
          <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
            {FILTERS.map(f => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0"
                style={{
                  background: filter === f.id ? 'var(--bg-l3)' : 'transparent',
                  color: filter === f.id ? 'var(--t1)' : 'var(--t3)',
                  border: '1px solid var(--border)',
                }}>
                {f.label} · {data.gifts[f.id].length}
              </button>
            ))}
          </div>
          {list.length === 0 ? (
            <div className="sky-empty py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>
              <GiftIcon size={22} className="mx-auto mb-2" style={{ color: 'var(--t3)' }} />
              Пока пусто
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {list.map(g => {
                const rc = GIFT_RARITY_COLOR[g.giftRarity];
                const media = giftMediaUrl(g.mediaId);
                return (
                  <motion.button key={g.id} type="button" whileTap={{ scale: 0.95 }} whileHover={{ y: -3 }}
                    onClick={() => setOpenGift(g)} aria-label={g.giftName}
                    className="relative overflow-hidden rounded-2xl p-3 flex flex-col items-center gap-1"
                    style={{ background: `linear-gradient(155deg, ${g.giftGrad[0]}, ${g.giftGrad[1]})`, border: `1.5px solid ${rc}66`,
                      boxShadow: `0 8px 22px ${rc}33, inset 0 1px 0 rgba(255,255,255,0.18)` }}>
                    <div className="absolute inset-x-0 top-0 h-1/2 pointer-events-none" style={{ background: 'linear-gradient(180deg,rgba(255,255,255,0.14),transparent)' }} />
                    {media && g.mediaKind !== 'video'
                      ? <img src={media} alt="" className="h-10 w-10 object-contain" />
                      : <div className="text-3xl" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}>{g.giftEmoji}</div>}
                    <div className="text-[10px] font-semibold text-center truncate w-full text-white" translate="no">{g.giftName}</div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'achievements' && (
        data.progression.achievements.length === 0 ? (
          <div className="sky-empty py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>
            <Trophy size={22} className="mx-auto mb-2" style={{ color: 'var(--t3)' }} />
            Наград пока нет
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {data.progression.achievements.map(a => {
              const Icon = a.icon;
              return (
                <div key={a.key} className="rounded-xl p-3 flex items-start gap-2" style={{ background: 'var(--bg-l2)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${a.tone}22` }}>
                    <Icon size={16} style={{ color: a.tone }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{a.label}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{a.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === 'frames' && (
        <div className="grid grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-0.5">
          {FRAMES.map(f => {
            const unlocked = myFrames.some(mf => mf.id === f.id);
            const active = (acc.equippedFrame ?? 'none') === f.id;
            return (
              <button key={f.id} type="button" disabled={!unlocked || !data.isOwn}
                onClick={() => data.isOwn && updateProfile({ equippedFrame: f.id })}
                title={unlocked ? f.description : f.obtainLabel}
                className="rounded-xl p-3 flex flex-col items-center gap-1.5 disabled:opacity-40"
                style={{ background: 'var(--bg-l2)', border: active ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: f.ring !== 'transparent' ? f.ring : 'var(--bg-l3)', boxShadow: unlocked ? f.glow : undefined }}>
                  {unlocked ? <CircleUserRound size={18} color="#fff" /> : <Lock size={14} color="#fff" />}
                </div>
                <span className="text-[10px] font-medium text-center leading-tight" style={{ color: 'var(--t2)' }}>{f.name}</span>
                <span className="text-[9px] font-semibold" style={{ color: RARITY_COLOR[f.rarity] }}>{RARITY_LABEL[f.rarity]}</span>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'theme' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[440px] overflow-y-auto pr-0.5">
          {PROFILE_THEME_CATALOG.map(t => {
            const unlocked = myThemes.some(mt => mt.id === t.id);
            const active = activeThemeId === t.id;
            const Motif = MOTIFS[t.motif];
            return (
              <button key={t.id} type="button" disabled={!unlocked || !data.isOwn}
                onClick={() => data.isOwn && equip(acc.id, 'profileTheme', t.id)}
                title={unlocked ? t.description : t.obtainLabel}
                className="relative rounded-xl overflow-hidden h-20 flex flex-col justify-end p-2 disabled:opacity-40"
                style={{ background: t.pageBackground, border: active ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
                {(t.motifOpacity ?? 0) > 0 && (
                  <div className="absolute inset-0"><Motif accent={t.accent} opacity={t.motifOpacity} /></div>
                )}
                {!unlocked && <Lock size={14} color="#fff" className="absolute top-2 right-2 z-10" />}
                <span className="relative z-10 text-[11px] font-bold text-white drop-shadow">{t.name}</span>
                <span className="relative z-10 text-[9px] font-semibold" style={{ color: RARITY_COLOR[t.rarity] }}>{RARITY_LABEL[t.rarity]}</span>
              </button>
            );
          })}
        </div>
      )}
      <AnimatePresence>{openGift && <GiftModal gift={openGift} onClose={() => setOpenGift(null)} />}</AnimatePresence>
    </div>
  );
};
