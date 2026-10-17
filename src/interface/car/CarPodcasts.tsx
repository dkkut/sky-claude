/* ===========================================================
   SKY CAR MODE — Подкасты.
   Тот же реальный плеер подкастов (usePlayer, @/podcasts/playerStore).
   Продолжить, новое в подписках и каталог: раньше без подписок экран
   был пустым, а плеер открывался за оболочкой Car и не был виден.
   Играет выпуск — управление в нижней полосе и на весь экран (CarNow).
=========================================================== */
import { useAuthStore } from '@/core/auth/store';
import { Crown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Podcast as PodcastIcon, ChevronLeft, RefreshCw } from 'lucide-react';
import { usePlayer } from '@/podcasts/playerStore';
import { apiContinue, apiNewFromSubscriptions, apiCatalog, apiEpisodes, apiMediaTicket, epCoverUrl, type Episode, type Podcast } from '@/podcasts/podcastApi';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './carTheme';

const cover = (hasCover: boolean, url: string) => (hasCover ? `center/cover no-repeat url(${url})` : 'linear-gradient(160deg,#2b2440,#12101f)');

const Row = ({ ep, active, onPlay }: { ep: Episode; active: boolean; onPlay: () => void }) => (
  <button type="button" onClick={onPlay}
    className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition-transform active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300" aria-label={ep.title}
    style={{ minHeight: 100, background: active ? 'rgba(139,124,255,0.22)' : 'transparent' }}>
    <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl" style={{ background: cover(ep.hasCover, epCoverUrl(ep.id)) }}>
      {!ep.hasCover && <div className="grid h-full w-full place-items-center"><PodcastIcon size={26} color="rgba(255,255,255,0.4)" /></div>}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[26px] font-bold" style={{ color: active ? '#d5ceff' : '#fff' }} translate="no">{ep.title}</p>
      <p className="truncate text-[19px]" style={{ color: 'rgba(255,255,255,0.55)' }} translate="no">{ep.podcastTitle ?? ''}</p>
    </div>
  </button>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <p className="mb-2 px-1 text-[18px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>{title}</p>
    <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>{children}</div>
  </section>
);

/* Подкасты входят в Sky Prime (сервер отвечает 403 без подписки). Оформить её пультом/в машине неудобно — подсказываем где. */
export const CarPodcasts = () => {
  const accounts = useAuthStore((s) => s.accounts);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const me = accounts.find((a) => a.id === currentUserId);
  if (!(me?.isPrime ?? false) && !(me?.isAdmin ?? false)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
        <Crown size={56} style={{ color: '#fbbf24' }} />
        <p className="text-3xl font-black text-white">Подкасты — только для Prime</p>
        <p className="text-xl" style={{ color: 'var(--t2)' }}>Оформите Sky Prime на телефоне или на сайте — здесь всё заработает само.</p>
      </div>
    );
  }
  return <CarPodcastsContent />;
};

const CarPodcastsContent = () => {
  const episode = usePlayer((s) => s.episode);
  const error = usePlayer((s) => s.error);
  const play = usePlayer((s) => s.play);

  const [cont, setCont] = useState<Episode[] | null>(null);
  const [fresh, setFresh] = useState<Episode[]>([]);
  const [shows, setShows] = useState<Podcast[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openShow, setOpenShow] = useState<Podcast | null>(null);
  const [eps, setEps] = useState<Episode[] | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    void apiMediaTicket();
    const [c, f, cat] = await Promise.all([apiContinue(), apiNewFromSubscriptions(), apiCatalog({ sort: 'popular', limit: 20 })]);
    setCont(c); setFresh(f); setShows(cat ?? []);
    if (cat === null) setFailed(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!openShow) { setEps(null); return; }
    let alive = true;
    void apiEpisodes(openShow.id, { limit: 40 }).then((l) => { if (alive) setEps(l ?? []); });
    return () => { alive = false; };
  }, [openShow]);

  /* Своё полноэкранное окно подкаста в Car не нужно: управление — в нижней полосе и в CarFullPlayer. */
  const start = (ep: Episode) => { void play(ep).then(() => usePlayer.getState().setExpanded(false)); };

  if (cont === null) return null;

  if (openShow) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={() => setOpenShow(null)} className="flex w-fit items-center gap-3 rounded-full px-6 text-[24px] font-bold text-white outline-none active:scale-95" style={{ minHeight: 72, background: CAR_GLASS, border: CAR_GLASS_BORDER }}>
          <ChevronLeft size={30} /> Назад
        </button>
        <p className="px-1 text-[30px] font-extrabold text-white" translate="no">{openShow.title}</p>
        {eps === null ? null : eps.length === 0
          ? <p className="px-1 text-[22px] text-white/60">В этом подкасте пока нет выпусков.</p>
          : <Section title="Выпуски">{eps.map((e) => <Row key={e.id} ep={{ ...e, podcastTitle: e.podcastTitle ?? openShow.title }} active={e.id === episode?.id} onPlay={() => start(e)} />)}</Section>}
      </div>
    );
  }

  const nothing = cont.length === 0 && fresh.length === 0 && (shows?.length ?? 0) === 0;
  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-3xl px-6 py-4 text-[22px] font-semibold text-rose-200" style={{ background: 'rgba(244,63,94,0.18)' }}>{error}</p>}
      {cont.length > 0 && <Section title="Продолжить">{cont.map((e) => <Row key={e.id} ep={e} active={e.id === episode?.id} onPlay={() => start(e)} />)}</Section>}
      {fresh.length > 0 && <Section title="Новое в подписках">{fresh.map((e) => <Row key={e.id} ep={e} active={e.id === episode?.id} onPlay={() => start(e)} />)}</Section>}
      {(shows?.length ?? 0) > 0 && (
        <Section title="Каталог подкастов">
          {shows!.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpenShow(p)} aria-label={p.title}
              className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition-transform active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 100 }}>
              <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl" style={{ background: p.accent ? `linear-gradient(160deg, ${p.accent}, #12101f)` : cover(false, '') }}>
                <div className="grid h-full w-full place-items-center"><PodcastIcon size={26} color="rgba(255,255,255,0.7)" /></div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[26px] font-bold text-white" translate="no">{p.title}</p>
                <p className="truncate text-[19px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{p.episodes} · {p.category}</p>
              </div>
            </button>
          ))}
        </Section>
      )}
      {(nothing || failed) && (
        <div className="flex flex-col items-center justify-center gap-4 py-12">
          <PodcastIcon size={56} color="rgba(255,255,255,0.35)" />
          <p className="text-[28px] font-bold text-white">{failed ? 'Не удалось загрузить подкасты' : 'Подкастов пока нет'}</p>
          <button type="button" onClick={() => void load()} className="flex items-center gap-3 rounded-full bg-white px-10 text-[24px] font-bold text-[#0b0b14] active:scale-95" style={{ minHeight: 80 }}><RefreshCw size={26} /> Обновить</button>
        </div>
      )}
    </div>
  );
};
