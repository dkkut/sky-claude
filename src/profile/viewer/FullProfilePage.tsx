import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, X, Ban, UserX, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useProfileViewer } from './store';
import { useSocialGraph } from './social';
import { useProfileData } from './useProfileData';
import { ProfileHero } from './sections/ProfileHero';
import { QuickActionsBar } from './sections/QuickActionsBar';
import { ActivitySection } from './sections/ActivitySection';
import { ShowcaseSection } from './sections/ShowcaseSection';
import { MusicSection } from './sections/MusicSection';
import { CollectionsSection } from './sections/CollectionsSection';
import { SocialSection } from './sections/SocialSection';
import { StatsSection } from './sections/StatsSection';
import { EditExtendedProfileSheet } from './EditExtendedProfileSheet';
import { activeProfileTheme } from '@/customization/selectors';
import { MOTIFS } from '@/customization/Decorative';

/**
 * Содержимое страницы профиля без оболочки (полноэкранной подложки и
 * верхней панели): тот же набор секций показывается и поверх приложения
 * у чужого профиля, и внутри раздела «Профиль» у своего.
 */
export const ProfileBody = ({ data }: { data: NonNullable<ReturnType<typeof useProfileData>> }) => {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {data.loading ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--t3)' }} />
        </div>
      ) : data.notFound ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center py-16">
          <UserX size={32} style={{ color: 'var(--t2)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--t2)' }}>Профиль не найден</p>
        </div>
      ) : (
        <div className="max-w-xl mx-auto px-2.5 sm:px-4 py-2.5 sm:py-4 space-y-2.5 sm:space-y-3">
          {data.relationship.isBlocked && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium"
              style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--red)' }}>
              <Ban size={14} /> Вы заблокировали этого пользователя
            </div>
          )}

          <ProfileHero data={data} onEdit={() => setEditing(true)} />
          <QuickActionsBar data={data} onEdit={() => setEditing(true)} />
          <ActivitySection data={data} />
          <ShowcaseSection data={data} />
          <MusicSection data={data} />
          <CollectionsSection data={data} />
          <SocialSection data={data} />
          <StatsSection data={data} />
        </div>
      )}

      {editing && data.account && (
        <EditExtendedProfileSheet account={data.account} onClose={() => setEditing(false)} />
      )}
    </>
  );
};

/** Свой профиль внутри раздела «Профиль»: та же страница, что видят другие. */
export const OwnProfileView = ({ userId }: { userId: string }) => {
  const data = useProfileData(userId);
  if (!data) return null;
  const theme = activeProfileTheme(data.account);
  return (
    <div style={{
      '--profile-card-bg': theme.cardBackground,
      '--profile-card-border': theme.cardBorder,
      '--profile-accent': theme.accent,
    } as React.CSSProperties}>
      <ProfileBody data={data} />
    </div>
  );
};

export const FullProfilePage = ({ userId }: { userId: string }) => {
  const stack = useProfileViewer(s => s.stack);
  const back  = useProfileViewer(s => s.back);
  const close = useProfileViewer(s => s.close);
  const viewerId = useAuthStore(s => s.currentUserId) ?? '';
  const recordView = useSocialGraph(s => s.recordView);

  const data = useProfileData(userId);

  useEffect(() => {
    if (userId && userId !== viewerId) recordView(userId, viewerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!data) return null;

  const canGoBack = stack.length > 1;
  const theme = activeProfileTheme(data.account);
  const Motif = MOTIFS[theme.motif];

  return (
    <motion.div
      key={userId}
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-0 z-[10000] flex flex-col"
      style={{
        background: theme.pageBackground,
        '--profile-card-bg': theme.cardBackground,
        '--profile-card-border': theme.cardBorder,
        '--profile-accent': theme.accent,
      } as React.CSSProperties}
    >
      {(theme.motifOpacity ?? 0) > 0 && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
          <Motif accent={theme.accent} opacity={theme.motifOpacity} />
        </div>
      )}

      {/* -- Top bar -- */}
      <div className="relative z-10 flex items-center justify-between px-2.5 sm:px-5 py-2 sm:py-3 shrink-0 sky-glass"
        style={{
          borderBottom: '1px solid var(--profile-card-border, var(--border))',
          paddingTop: 'calc(var(--safe-top) + 10px)',
        }}>
        {/* Слева — только «назад»: раньше без истории здесь стоял второй
            крестик, и в шапке их было два подряд. */}
        {canGoBack ? (
          <button type="button" onClick={back}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center sky-hover-lift"
            style={{ background: 'var(--profile-card-bg, var(--bg-l2))' }}>
            <ChevronLeft size={16} style={{ color: 'var(--t1)' }} />
          </button>
        ) : <span className="w-8 h-8 sm:w-9 sm:h-9" />}
        <span className="text-[13px] sm:text-sm font-semibold" style={{ color: 'var(--t1)' }}>
          {data.loading ? '' : data.notFound ? 'Профиль' : data.isOwn ? 'Мой профиль' : data.account?.name}
        </span>
        <button type="button" onClick={close}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center sky-hover-lift"
          style={{ background: 'var(--profile-card-bg, var(--bg-l2))' }}>
          <X size={16} style={{ color: 'var(--t2)' }} />
        </button>
      </div>

      {/* -- Content -- */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <ProfileBody data={data} />
      </div>
    </motion.div>
  );
};
