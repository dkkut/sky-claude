import { useState } from 'react';
import { Gift as GiftIcon, Trophy, CircleUserRound, Lock } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { GIFT_RARITY_COLOR } from '@/gifts/store';
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

export const hasCollections = (data: ProfileData) =>
  data.gifts.all.length > 0 || data.progression.achievements.length > 0 || data.isOwn;

export const CollectionsSection = ({ data }: { data: ProfileData }) => {
  const [filter, setFilter] = useState<GiftFilter>('all');
  const [tab, setTab] = useState<'gifts' | 'achievements' | 'frames' | 'theme'>('gifts');
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
              {list.map(g => (
                <div key={g.id} className="rounded-xl p-3 flex flex-col items-center gap-1"
                  style={{ background: `linear-gradient(160deg, ${g.giftGrad[0]}22, ${g.giftGrad[1]}11)`, border: `1px solid ${GIFT_RARITY_COLOR[g.giftRarity]}44` }}>
                  <div className="text-2xl">{g.giftEmoji}</div>
                  <div className="text-[10px] font-medium text-center truncate w-full" style={{ color: 'var(--t2)' }}>{g.giftName}</div>
                </div>
              ))}
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
    </div>
  );
};
