import { ExplicitBadge } from '@/labels/Labels';
/* ===========================================================
   SKY CONSOLE — главное меню.
   Верхняя панель, ряд крупных карточек сервисов, описание и
   действие выбранного, полка «Продолжить» из реальных данных
   (недосмотренные фильмы, история музыки, текущее воспроизведение).
   Ничего выдуманного: нет данных — пустое состояние.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Settings, Play, Pause, Music2, Film } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useNotifStore } from '@/notifications/store';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl } from '@/film/filmApi';
import { useMusicStore } from '@/music/serverStore';
import { useNowPlaying } from '@/island/mediaAdapter';
import { useConsoleStore } from './consoleStore';
import { SERVICES, openService, type Group } from './services';
import { consoleNav } from './input/nav';
import { ConsoleBackdrop } from './ConsoleProfilePicker';

const TABS: { key: 'all' | Group; label: string }[] = [
  { key: 'all', label: 'Главная' }, { key: 'games', label: 'Игры' }, { key: 'media', label: 'Медиа' }, { key: 'social', label: 'Общение' },
];

const Clock = () => {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return <span translate="no">{t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
};

let lastFocusKey: string | null = null;

export const ConsoleHome = () => {
  const account = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId));
  const unread = useNotifStore((s) => s.notifs.filter((n) => !n.read).length);
  const setSettingsOpen = useConsoleStore((s) => s.setSettingsOpen);
  const fx = useConsoleStore((s) => s.prefs.fx);
  const [tab, setTab] = useState<'all' | Group>('all');
  const [focusKey, setFocusKey] = useState<string>(lastFocusKey ?? SERVICES[0].key);
  const films = useFilmStore((s) => s.catalog);
  const progress = useFilmStore((s) => s.progressList);
  const loadFilm = useFilmStore((s) => s.load);
  const history = useMusicStore((s) => s.history);
  const loadMusic = useMusicStore((s) => s.load);
  const now = useNowPlaying();

  useEffect(() => { void loadFilm(); void loadMusic(); }, [loadFilm, loadMusic]);
  useEffect(() => { const t = setTimeout(() => consoleNav.focusAuto(), 80); return () => clearTimeout(t); }, [tab]);

  const list = useMemo(() => SERVICES.filter((s) => tab === 'all' || s.group === tab), [tab]);
  const focused = list.find((s) => s.key === focusKey) ?? list[0];

  const continueFilms = useMemo(() => progress
    .map((p) => ({ p, m: films.find((f) => f.id === p.movieId) }))
    .filter((x) => x.m && x.p.duration > 0 && x.p.position / x.p.duration < 0.95)
    .slice(0, 6), [progress, films]);
  const recentMusic = history.slice(0, 6);
  const heroPoster = focused.key === 'film' && continueFilms[0]?.m?.hasPoster ? posterUrl(continueFilms[0].m!.id) : null;
  const heroCover = focused.key === 'music' ? (now?.kind === 'music' ? now.cover : recentMusic[0]?.coverUrl) : null;
  const heroImg = heroPoster ?? heroCover ?? null;

  return (
    <div className="fixed inset-0 overflow-hidden text-white" data-keep-dark>
      <ConsoleBackdrop />
      {/* Фон сервиса: цвет меняется под выбранную карточку */}
      <AnimatePresence mode="sync">
        <motion.div key={focused.key + (heroImg ?? '')} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: fx === 'light' ? 0.01 : 0.6 }}
          style={{ background: `radial-gradient(90% 80% at 75% 20%, ${focused.color}55, transparent 62%)` }}>
          {heroImg && <div className="absolute inset-0 opacity-45" style={{ background: `center/cover url(${heroImg})`, maskImage: 'linear-gradient(to left, #000 20%, transparent 85%)', WebkitMaskImage: 'linear-gradient(to left, #000 20%, transparent 85%)' }} />}
          <focused.icon className="absolute -right-10 top-24 opacity-[0.07]" size={560} strokeWidth={1} aria-hidden />
        </motion.div>
      </AnimatePresence>

      <div className="absolute inset-0 flex flex-col px-[4.5vw] pb-[3.5vh] pt-[3vh]">
        {/* Верхняя панель */}
        <header className="flex items-center gap-8">
          <img src="/logo.png" alt="Sky" className="h-12 w-12 object-contain" draggable={false} />
          <nav role="tablist" aria-label="Разделы" className="flex items-center gap-2">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className="rounded-full px-5 py-2 text-[22px] outline-none" style={{ color: tab === t.key ? '#fff' : 'rgba(255,255,255,0.5)', fontWeight: tab === t.key ? 700 : 400, background: tab === t.key ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <button type="button" aria-label="Уведомления" onClick={() => openService('notifications')} className="relative grid h-12 w-12 place-items-center rounded-full outline-none" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <Bell size={24} />
              {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-[22px] place-items-center rounded-full bg-rose-500 px-1 text-[13px] font-bold" translate="no">{unread > 99 ? '99+' : unread}</span>}
            </button>
            <button type="button" aria-label="Настройки" onClick={() => setSettingsOpen(true)} className="grid h-12 w-12 place-items-center rounded-full outline-none" style={{ background: 'rgba(255,255,255,0.08)' }}><Settings size={24} /></button>
            <button type="button" aria-label="Профиль" onClick={() => setSettingsOpen(true)} className="flex items-center gap-3 rounded-full py-1 pl-1 pr-5 outline-none" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-violet-500 text-[16px] font-bold" style={account?.avatar ? { background: `center/cover url(${account.avatar})` } : undefined} translate="no">{!account?.avatar && (account?.name?.[0] ?? '?')}</span>
              <span className="max-w-[180px] truncate text-[20px]" translate="no">{account?.name}</span>
            </button>
            <span className="ml-2 text-[26px] font-light"><Clock /></span>
          </div>
        </header>

        {/* Ряд сервисов */}
        <div className="mt-[3vh] flex items-end gap-5 overflow-x-auto overflow-y-visible px-2 py-4 [scrollbar-width:none]" role="list" aria-label="Сервисы">
          {list.map((s) => (
            <button key={s.key} type="button" role="listitem" aria-label={s.label} data-console-autofocus={s.key === focused.key ? '' : undefined}
              onFocus={(e) => { setFocusKey(s.key); lastFocusKey = s.key; e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }} onClick={() => openService(s.key)}
              className="relative shrink-0 rounded-[28px] outline-none" style={{ width: 'clamp(110px, 10vw, 180px)', aspectRatio: '1' }}>
              <span className="console-zoom grid h-full w-full place-items-center rounded-[28px]" style={{ background: `linear-gradient(145deg, ${s.color}, ${s.color}88 60%, #0b0b24)`, boxShadow: '0 14px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.25)' }}>
                <s.icon size={64} strokeWidth={1.6} />
              </span>
            </button>
          ))}
        </div>

        {/* Описание выбранного */}
        <div className="mt-2 max-w-[48vw] px-3">
          <AnimatePresence mode="wait">
            <motion.div key={focused.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <h2 className="text-[clamp(34px,4.6vmin,60px)] font-bold leading-tight" translate="no">{focused.label}</h2>
              <p className="mt-2 text-[clamp(18px,2.2vmin,26px)] text-white/70">{focused.desc}</p>
              <button type="button" onClick={() => openService(focused.key)} className="mt-6 rounded-full px-12 py-3 text-[24px] font-bold text-[#0b0b14] outline-none" style={{ background: '#fff' }}>
                {focused.action}
              </button>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Продолжить: только реальные данные */}
        <section className="mt-auto" aria-label="Продолжить">
          <h3 className="mb-3 px-3 text-[22px] font-semibold text-white/80">Продолжить</h3>
          <div className="flex items-stretch gap-4 px-2 py-2">
            {now && (
              <button type="button" aria-label={now.title} onClick={() => now.open()} className="flex w-[360px] items-center gap-4 rounded-3xl p-3 text-left outline-none" style={{ background: 'rgba(255,255,255,0.09)' }}>
                <span className="console-zoom flex items-center gap-4">
                  <span className="grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/10" style={now.cover ? { background: `center/cover url(${now.cover})` } : undefined}>{!now.cover && <Music2 size={32} />}</span>
                  <span className="min-w-0"><span className="block truncate text-[22px] font-semibold" translate="no">{now.title}</span><span className="block truncate text-[16px] text-white/60" translate="no">{now.subtitle}</span>
                    <span className="mt-1 flex items-center gap-1 text-[14px] text-violet-300">{now.playing ? <Pause size={14} /> : <Play size={14} />}{now.playing ? 'Играет' : 'На паузе'}</span></span>
                </span>
              </button>
            )}
            {continueFilms.map(({ p, m }) => (
              <button key={p.movieId} type="button" aria-label={m!.title} onClick={() => openService('film', { itemId: p.movieId })} className="relative w-[220px] shrink-0 overflow-hidden rounded-3xl text-left outline-none" style={{ background: 'rgba(255,255,255,0.09)' }}>
                <span className="console-zoom block">
                  <span className="grid h-[124px] w-full place-items-center bg-white/5" style={m!.hasPoster ? { background: `center/cover url(${posterUrl(m!.id)})` } : undefined}>{!m!.hasPoster && <Film size={32} />}</span>
                  <span className="block truncate px-3 pt-2 text-[17px] font-semibold" translate="no">{m!.title}</span>
                  <span className="mx-3 mb-3 mt-1 block h-1 overflow-hidden rounded-full bg-white/15"><span className="block h-full rounded-full bg-rose-400" style={{ width: `${Math.min(100, (p.position / p.duration) * 100)}%` }} /></span>
                </span>
              </button>
            ))}
            {recentMusic.slice(0, 4).map((t) => (
              <button key={t.id} type="button" aria-label={t.title} onClick={() => openService('music')} className="w-[180px] shrink-0 overflow-hidden rounded-3xl text-left outline-none" style={{ background: 'rgba(255,255,255,0.09)' }}>
                <span className="console-zoom block">
                  <span className="grid h-[124px] w-full place-items-center bg-white/5" style={t.coverUrl ? { background: `center/cover url(${t.coverUrl})` } : undefined}>{!t.coverUrl && <Music2 size={32} />}</span>
                  <span className="block truncate px-3 pt-2 text-[17px] font-semibold" translate="no">{t.title}<ExplicitBadge show={t.explicit} /></span>
                  <span className="block truncate px-3 pb-3 text-[14px] text-white/55" translate="no">{t.artist}</span>
                </span>
              </button>
            ))}
            {!now && continueFilms.length === 0 && recentMusic.length === 0 && (
              <p className="px-3 py-6 text-[20px] text-white/50">Здесь появятся начатые фильмы и недавняя музыка.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
