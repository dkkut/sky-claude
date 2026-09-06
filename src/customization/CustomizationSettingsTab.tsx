import { useState } from 'react';
import { Lock, ShoppingBag, PawPrint } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useCustomization } from './store';
import type { ItemCategory } from './types';
import { FRAME_CATALOG } from './catalog/frames';
import { BANNER_CATALOG } from './catalog/banners';
import { PROFILE_THEME_CATALOG } from './catalog/profileThemes';
import { CHAT_LIST_STYLE_CATALOG } from './catalog/chatListStyles';
import { MOTIFS } from './Decorative';
import { CustomizationMarket } from './Marketplace';
import { PETS } from '@/messenger/petData';

const Row = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-5">
    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--t3)' }}>{title}</p>
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">{children}</div>
  </div>
);

export const CustomizationSettingsTab = () => {
  const { currentUserId, accounts, updateProfile } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const { owned, equipped, equip } = useCustomization();
  const [market, setMarket] = useState(false);

  if (!me) return null;
  const isUnlocked = (unlock: any): boolean => {
    if (unlock.type === 'owned') return (owned[me.id] ?? []).includes(unlock.__id);
    if (unlock.type === 'default') return true;
    if (unlock.type === 'prime') return !!me.isPrime;
    if (unlock.type === 'business') return !!me.isPrimeBusiness;
    if (unlock.type === 'admin') return !!me.isAdmin;
    if (unlock.type === 'tenure') return Math.floor((Date.now() - new Date(me.createdAt).getTime()) / 86_400_000) >= unlock.days;
    if (unlock.type === 'season') { const n = Date.now(); return n >= new Date(unlock.from).getTime() && n <= new Date(unlock.to).getTime(); }
    return false;
  };
  const unlocked = (id: string, unlock: any) => isUnlocked({ ...unlock, __id: id });

  const eq = (cat: ItemCategory) => equipped[me.id]?.[cat];

  return (
    <div className="p-4 sm:p-6">
      <p className="text-sm mb-5" style={{ color: 'var(--t2)' }}>
        Оформление, которое видят другие пользователи в переписке с тобой и в твоём профиле. Применяется сразу, без перезагрузки.
      </p>

      <Row title="Тема профиля">
        {PROFILE_THEME_CATALOG.map(t => {
          const u = unlocked(t.id, t.unlock);
          const active = (eq('profileTheme') ?? 'theme-sky') === t.id;
          const Motif = MOTIFS[t.motif];
          return (
            <button key={t.id} type="button" disabled={!u} onClick={() => equip(me.id, 'profileTheme', t.id)}
              className="relative shrink-0 w-20 h-14 rounded-xl overflow-hidden disabled:opacity-40"
              style={{ background: t.pageBackground, border: active ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
              {(t.motifOpacity ?? 0) > 0 && <div className="absolute inset-0"><Motif accent={t.accent} opacity={t.motifOpacity} /></div>}
              {!u && <Lock size={12} color="#fff" className="absolute top-1.5 right-1.5 z-10" />}
              <span className="absolute bottom-1 left-1.5 text-[9px] font-bold text-white drop-shadow z-10">{t.name}</span>
            </button>
          );
        })}
      </Row>

      <Row title="Баннер верхней панели чата">
        {BANNER_CATALOG.map(b => {
          const u = unlocked(b.id, b.unlock);
          const active = (eq('banner') ?? 'banner-default') === b.id;
          const Motif = MOTIFS[b.motif];
          return (
            <button key={b.id} type="button" disabled={!u} onClick={() => equip(me.id, 'banner', b.id)}
              className="relative shrink-0 w-24 h-12 rounded-full overflow-hidden disabled:opacity-40"
              style={{ background: b.background, border: active ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
              {(b.motifOpacity ?? 0) > 0 && <div className="absolute inset-0"><Motif accent={b.accent2 ?? b.accent} opacity={b.motifOpacity} /></div>}
              {!u && <Lock size={11} color="#fff" className="absolute top-1 right-1.5 z-10" />}
              <span className="absolute bottom-1 left-2 text-[9px] font-bold text-white drop-shadow z-10">{b.name}</span>
            </button>
          );
        })}
      </Row>

      <Row title="Рамка аватара">
        {FRAME_CATALOG.filter(f => f.id !== 'none').map(f => {
          const u = unlocked(f.id, f.unlock);
          const active = (me.equippedFrame ?? 'none') === f.id;
          return (
            <button key={f.id} type="button" disabled={!u}
              onClick={() => updateProfile({ equippedFrame: f.id })}
              className="relative shrink-0 flex flex-col items-center gap-1 disabled:opacity-40">
              <div className="relative w-12 h-12">
                <div className="absolute rounded-full" style={{ inset: -2, background: f.ring, boxShadow: u ? f.glow : undefined }} />
                <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-l3)', border: active ? '2px solid var(--accent)' : 'none' }}>
                  {!u && <Lock size={11} style={{ color: '#fff' }} />}
                </div>
              </div>
              <span className="text-[9px]" style={{ color: 'var(--t3)' }}>{f.name}</span>
            </button>
          );
        })}
      </Row>

      <Row title="Оформление в списке чатов">
        {CHAT_LIST_STYLE_CATALOG.filter(s => s.id !== 'cls-default').map(s => {
          const u = unlocked(s.id, s.unlock);
          const active = eq('chatListStyle') === s.id;
          return (
            <button key={s.id} type="button" disabled={!u} onClick={() => equip(me.id, 'chatListStyle', s.id)}
              className="relative shrink-0 w-24 h-9 rounded-lg overflow-hidden disabled:opacity-40 flex items-center px-2"
              style={{ background: s.background ?? 'var(--bg-l3)', border: active ? '2px solid var(--accent)' : (s.border ?? '1px solid var(--border)'), boxShadow: s.glow }}>
              {s.leftBar && <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full" style={{ background: s.leftBar }} />}
              {!u && <Lock size={11} color="var(--t2)" className="absolute top-1 right-1.5" />}
              <span className="text-[9px] font-medium truncate" style={{ color: 'var(--t2)' }}>{s.name}</span>
            </button>
          );
        })}
      </Row>

      <Row title="Питомец">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl shrink-0" style={{ background: 'var(--bg-l2)' }}>
          <PawPrint size={16} style={{ color: 'var(--t2)' }} />
          <span className="text-xs" style={{ color: 'var(--t2)' }}>{PETS.length} питомцев доступно в разделе «Питомцы» меню чата</span>
        </div>
      </Row>

      <button type="button" onClick={() => setMarket(true)}
        className="w-full mt-2 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        <ShoppingBag size={16} /> Все предметы маркета
      </button>

      {market && <CustomizationMarket onClose={() => setMarket(false)} />}
    </div>
  );
};
