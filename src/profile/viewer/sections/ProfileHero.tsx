import { VerifiedBadge } from '@/verification/marks';
import { useState } from 'react';
import { Crown, Shield, Briefcase, Check, Copy, Globe, Clock, CalendarDays, Link2, Eye } from 'lucide-react';
import type { ProfileData } from '../useProfileData';
import { activeBanner } from '@/customization/selectors';
import { MOTIFS } from '@/customization/Decorative';

const PLATFORM_LABEL: Record<string, string> = { desktop: 'Компьютер', mobile: 'Телефон' };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });

export const ProfileHero = ({ data, onEdit }: { data: ProfileData; onEdit?: () => void }) => {
  const { account: acc } = data;
  const [copied, setCopied] = useState(false);
  if (!acc) return null;

  const copySkyId = () => {
    navigator.clipboard.writeText(acc.skyId ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const frameGlow = data.frame.glow;
  // Баннер из маркета кастомизации: надет — показываем его, иначе загруженная картинка, иначе стандартный.
  const equippedBanner = activeBanner(acc);
  const showEquipped = equippedBanner.id !== 'banner-default' && (data.isOwn || (acc.privacy?.showBanner ?? true));

  return (
    <div className="sky-card overflow-hidden" style={{ background: 'var(--profile-card-bg, var(--bg-l1))', border: '1px solid var(--profile-card-border, transparent)' }}>
      {/* -- Обложка -- */}
      <div className="h-24 sm:h-44 relative"
        style={{
          background: showEquipped ? equippedBanner.background
            : (acc.banner && (data.isOwn || (acc.privacy?.showBanner ?? true)))
              ? `url(${acc.banner}) center/cover`
              : 'linear-gradient(135deg,#2a3350,#1a2038)',
        }}>
        {showEquipped && (() => { const Motif = MOTIFS[equippedBanner.motif]; return <div className="absolute inset-0 pointer-events-none"><Motif accent={equippedBanner.accent2 ?? equippedBanner.accent} opacity={equippedBanner.motifOpacity} /></div>; })()}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,0)0%,rgba(0,0,0,.35)100%)' }} />
      </div>

      <div className="px-3.5 sm:px-6 pb-3.5 sm:pb-5">
        {/* -- Аватар -- */}
        <div className="-mt-9 sm:-mt-14 mb-2 sm:mb-3 flex items-end justify-between">
          <div className="relative rounded-full p-[2.5px] sm:p-[3px]" style={{ background: data.frame.ring, boxShadow: frameGlow }}>
            <div className="rounded-full p-[2.5px] sm:p-[3px]" style={{ background: 'var(--profile-card-bg, var(--bg-l1))' }}>
              {acc.avatar
                ? <img src={acc.avatar} alt="" className="w-16 h-16 sm:w-28 sm:h-28 rounded-full object-cover" />
                : (
                  <div className="w-16 h-16 sm:w-28 sm:h-28 rounded-full flex items-center justify-center text-white font-bold text-xl sm:text-3xl"
                    style={{ background: 'linear-gradient(135deg,#6e8eff,#a78bfa)' }}>
                    {acc.name[0]?.toUpperCase()}
                  </div>
                )}
            </div>
            {data.presence.visible && data.presence.online && (
              <span className="absolute bottom-0.5 right-0.5 sm:bottom-1 sm:right-1 w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full border-[3px] sm:border-4"
                style={{ background: 'var(--green)', borderColor: 'var(--bg-l1)' }} />
            )}
          </div>

          {data.isOwn && onEdit && (
            <button type="button" onClick={onEdit}
              className="mb-1 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-semibold sky-hover-lift"
              style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
              Редактировать
            </button>
          )}
        </div>

        {/* -- Имя и бейджи -- */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <h2 className="text-base sm:text-xl font-extrabold"
            style={{ color: (data.isOwn || (acc.privacy?.showNameCustomization ?? true)) ? (acc.nameColor || 'var(--t1)') : 'var(--t1)' }}>
            {acc.name}
          </h2>
          <VerifiedBadge type="user" id={acc.id} size={18} />
          {acc.nameSticker && (data.isOwn || (acc.privacy?.showNameCustomization ?? true)) && (
            <span className="text-base sm:text-lg leading-none">{acc.nameSticker}</span>
          )}
          {acc.isPrime && <Crown size={15} className="sm:hidden" style={{ color: 'var(--amber)' }} />}
          {acc.isPrime && <Crown size={17} className="hidden sm:block" style={{ color: 'var(--amber)' }} />}
          {acc.isPrimeBusiness && <Briefcase size={14} className="sm:hidden" style={{ color: '#60a5fa' }} />}
          {acc.isPrimeBusiness && <Briefcase size={16} className="hidden sm:block" style={{ color: '#60a5fa' }} />}
          {acc.isAdmin && <Shield size={14} className="sm:hidden" style={{ color: 'var(--accent)' }} />}
          {acc.isAdmin && <Shield size={16} className="hidden sm:block" style={{ color: 'var(--accent)' }} />}
        </div>
        <div className="text-[12.5px] sm:text-sm mt-0.5" style={{ color: 'var(--t3)' }}>@{acc.username}</div>

        {/* -- Custom status -- */}
        {(acc.customStatus || acc.statusEmoji) && (data.isOwn || (acc.privacy?.showCustomStatus ?? true)) && (
          <div className="mt-1.5 sm:mt-2 inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-medium"
            style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
            {acc.statusEmoji && <span>{acc.statusEmoji}</span>}
            {acc.customStatus}
          </div>
        )}

        {/* -- Presence -- */}
        {data.presence.visible && (
          <div className="mt-1.5 sm:mt-2 flex items-center gap-1.5 text-[11px] sm:text-xs" style={{ color: data.presence.online ? 'var(--green)' : 'var(--t3)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: data.presence.online ? 'var(--green)' : 'var(--t3)' }} />
            {data.presence.label}
            {data.presence.platform && <span style={{ color: 'var(--t3)' }}>· {PLATFORM_LABEL[data.presence.platform]}</span>}
          </div>
        )}

        {/* -- Bio -- */}
        {acc.bio && (data.isOwn || (acc.privacy?.showBio ?? true)) && (
          <p className="mt-2 sm:mt-3 text-[12.5px] sm:text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{acc.bio}</p>
        )}

        {/* -- Links -- */}
        {!!acc.links?.length && (data.isOwn || (acc.privacy?.showLinks ?? true)) && (
          <div className="mt-1.5 sm:mt-2 flex flex-col gap-1">
            {acc.links.map((l, i) => (
              <a key={i} href={l.startsWith('http') ? l : `https://${l}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-[12.5px] sm:text-sm truncate" style={{ color: 'var(--accent)' }}>
                <Link2 size={12} /> <span className="truncate">{l}</span>
              </a>
            ))}
          </div>
        )}

        {/* -- Meta grid -- */}
        <div className="mt-2.5 sm:mt-4 flex flex-wrap gap-x-3 sm:gap-x-4 gap-y-1 sm:gap-y-1.5 text-[10.5px] sm:text-xs" style={{ color: 'var(--t3)' }}>
          <button type="button" onClick={copySkyId} className="flex items-center gap-1 sky-hover-lift">
            {copied ? <Check size={11} style={{ color: 'var(--green)' }} /> : <Copy size={11} />}
            {acc.skyId ?? '—'}
          </button>
          <span className="flex items-center gap-1"><CalendarDays size={11} /> в Sky с {fmtDate(acc.createdAt)}</span>
          {acc.country && (data.isOwn || (acc.privacy?.showCountry ?? true)) && (
            <span className="flex items-center gap-1"><Globe size={11} /> {acc.country}{acc.language ? `, ${acc.language}` : ''}</span>
          )}
          {acc.timezone && (data.isOwn || (acc.privacy?.showTimezone ?? true)) && (
            <span className="flex items-center gap-1"><Clock size={11} /> {acc.timezone}</span>
          )}
          {acc.birthDate && (data.isOwn || (acc.privacy?.showBirthDate ?? true)) && (
            <span className="flex items-center gap-1"><CalendarDays size={11} /> {fmtDate(acc.birthDate)}</span>
          )}
          {data.isOwn && data.stats.profileViews > 0 && (
            <span className="flex items-center gap-1"><Eye size={11} /> {data.stats.profileViews} просмотров профиля</span>
          )}
        </div>
      </div>
    </div>
  );
};
