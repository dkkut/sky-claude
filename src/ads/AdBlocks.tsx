/* ===============================================================
   SKY AD BLOCKS  -  реальные рекламные блоки по всему приложению
   Реклама приходит с сервера (/api/ads/serve) — Prime, регион,
   частотные ограничения и период кампании уже применены на сервере.
=============================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ExternalLink, Megaphone, Pin } from 'lucide-react';
import type { AdPlacement } from './store';
import { apiServeAd, apiRecordImpression, apiRecordClick, apiRecordView, type ServedAd } from './adsApi';

/** Общий хук: получает рекламу под площадку, один раз пишет показ,
 * отдаёт функцию клика, которая сама пишет клик и переходит по ссылке.
 * Экспортирован — тем же пользуются рекламные блоки в Feedback.tsx. */
export const useServedAd = (placement: AdPlacement) => {
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [ready, setReady] = useState(false);
  const impressionId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const served = await apiServeAd(placement);
      if (cancelled) return;
      setAd(served);
      setReady(true);
      if (served) {
        const id = await apiRecordImpression(served.campaignId, placement);
        if (!cancelled) impressionId.current = id;
      }
    })();
    return () => { cancelled = true; };
  }, [placement]);

  const click = async () => {
    if (!ad) return;
    const linkUrl = impressionId.current
      ? await apiRecordClick(ad.campaignId, impressionId.current, placement)
      : null;
    const url = linkUrl ?? ad.linkUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const view = (watchedSec: number) => { if (impressionId.current) void apiRecordView(impressionId.current, watchedSec); };
  return { ad, ready, click, view };
};

/* -- Banner Ad (лента, шапки) ------------------------------- */
export const BannerAd = ({ placement, className = '' }: { placement: AdPlacement; className?: string }) => {
  const { ad, click } = useServedAd(placement);
  const [dismissed, setDismissed] = useState(false);

  if (!ad || dismissed) return null;

  return (
    <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
      className={`relative overflow-hidden ${className}`}
      style={{ background:'linear-gradient(135deg,rgba(79,110,247,0.08),rgba(79,110,247,0.04))',
        border:'1px solid rgba(79,110,247,0.18)', borderRadius:16 }}>
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={click}>
        {ad.mediaUrl && (ad.format === 'video'
          ? <video src={ad.mediaUrl} muted className="h-10 w-10 rounded-xl object-cover shrink-0"/>
          : <img src={ad.mediaUrl} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0"/>
        )}
        {!ad.mediaUrl && (
          <div className="h-10 w-10 rounded-xl shrink-0 flex items-center justify-center"
            style={{ background:'rgba(79,110,247,0.15)' }}>
            <Megaphone size={18} style={{ color:'#818cf8' }}/>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background:'rgba(79,110,247,0.2)', color:'#818cf8' }}>Реклама</span>
          </div>
          <p className="text-sm font-semibold text-white truncate">{ad.title}</p>
          {ad.description && (
            <p className="text-[11px] truncate" style={{ color:'rgba(255,255,255,0.5)' }}>{ad.description}</p>
          )}
        </div>
        {ad.linkUrl && <ExternalLink size={13} style={{ color:'rgba(255,255,255,0.35)', flexShrink: 0 }}/>}
      </div>
      <button type="button" onClick={() => setDismissed(true)}
        className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full hover:bg-white/10"
        style={{ color:'rgba(255,255,255,0.35)' }}>
        <X size={10}/>
      </button>
    </motion.div>
  );
};

/* -- Feed Ad (Bloom лента  -  карточка среди постов) ---------- */
export const FeedAd = () => {
  const { ad, click } = useServedAd('bloom_feed');
  const [dismissed, setDismissed] = useState(false);

  if (!ad || dismissed) return null;

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
      className="relative overflow-hidden rounded-3xl mx-1"
      style={{ background:'linear-gradient(135deg,#0d1117,#161b22)', border:'1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor:'var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-full"
            style={{ background:'rgba(79,110,247,0.2)' }}>
            <Megaphone size={15} style={{ color:'#818cf8' }}/>
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Рекламный пост</p>
            <p className="text-[10px]" style={{ color:'rgba(255,255,255,0.4)' }}>Sky Ads</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ background:'rgba(79,110,247,0.15)', color:'#818cf8' }}>Реклама</span>
          <button type="button" onClick={() => setDismissed(true)}
            className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/10">
            <X size={11} style={{ color:'rgba(255,255,255,0.4)' }}/>
          </button>
        </div>
      </div>
      <div className="cursor-pointer" onClick={click}>
        {ad.mediaUrl && (ad.format === 'video'
          ? <video src={ad.mediaUrl} muted loop autoPlay playsInline className="w-full max-h-48 object-cover"/>
          : <img src={ad.mediaUrl} alt="" className="w-full max-h-48 object-cover"/>
        )}
        <div className="px-4 py-3">
          <p className="text-sm font-bold text-white">{ad.title}</p>
          {ad.description && (
            <p className="text-sm mt-1 leading-relaxed" style={{ color:'rgba(255,255,255,0.6)' }}>{ad.description}</p>
          )}
          {ad.linkUrl && (
            <div className="flex items-center gap-1.5 mt-2">
              <ExternalLink size={12} style={{ color:'var(--accent)' }}/>
              <span className="text-xs" style={{ color:'var(--accent)' }}>Узнать больше</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* -- Preroll Ad (перед видео) ------------------------------- */
export const PrerollAd = ({ onSkip }: { onSkip: () => void }) => {
  const { ad, ready, click, view } = useServedAd('video_preroll');
  const [canSkip, setCanSkip] = useState(false);
  const [left, setLeft] = useState(5);
  const vidRef = useRef<HTMLVideoElement>(null);
  const startedAt = useRef(0);
  const done = useRef(false);
  const isVideo = ad?.format === 'video' && !!ad.mediaUrl;
  // Пропуск открывается через 5 с (или через длительность, если ролик короче). Считаем реально прошедшее время показа.
  const skipAfter = Math.max(1, Math.min(5, ad?.durationSec ?? 5));

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const played = isVideo ? (vidRef.current?.currentTime ?? 0) : (Date.now() - startedAt.current) / 1000;
    view(played);
    onSkip();
  };

  useEffect(() => {
    if (!ready) return;
    if (!ad) { onSkip(); return; }
    startedAt.current = Date.now();
    setLeft(skipAfter);
    const t = setInterval(() => {
      const el = Math.floor((Date.now() - startedAt.current) / 1000);
      setLeft(Math.max(0, skipAfter - el));
      if (el >= skipAfter) setCanSkip(true);
      // раз в 5 секунд отправляем, сколько уже идёт видео: если вкладку закроют, часть просмотра не потеряется
      if (isVideo && el > 0 && el % 5 === 0) view(vidRef.current?.currentTime ?? 0);
    }, 1000);
    // для картинки/текста реклама сама заканчивается через 8 секунд
    const auto = !isVideo ? setTimeout(finish, 8000) : undefined;
    return () => { clearInterval(t); if (auto) clearTimeout(auto); if (!done.current && isVideo) view(vidRef.current?.currentTime ?? 0); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ad?.campaignId]);

  if (!ready || !ad) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background:'#000' }}>
      <div className="flex-1 relative cursor-pointer flex items-center justify-center" onClick={click}
        style={{ background: ad.mediaUrl ? 'transparent' : 'linear-gradient(135deg,#0f172a,#1e3a5f)' }}>
        {ad.mediaUrl
          ? (ad.format === 'video'
              ? <video ref={vidRef} src={ad.mediaUrl} autoPlay muted playsInline className="w-full h-full object-contain" onEnded={finish} onError={finish}/>
              : <img src={ad.mediaUrl} alt="" className="w-full h-full object-cover"/>)
          : <div className="text-center px-8">
              <Megaphone size={46} className="mx-auto mb-4 text-white/80"/>
              <p className="text-xl font-black text-white">{ad.title}</p>
              {ad.description && <p className="text-sm mt-2" style={{ color:'rgba(255,255,255,0.6)' }}>{ad.description}</p>}
            </div>
        }
        <div className="absolute top-3 left-3 text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ background:'rgba(0,0,0,0.6)', color:'rgba(255,255,255,0.7)' }}>
          Реклама{ad.durationSec ? ` · ${Math.round(ad.durationSec)} с` : ''}
        </div>
      </div>
      <div className="absolute bottom-4 right-4">
        {canSkip ? (
          <motion.button whileTap={{ scale:.9 }} type="button" onClick={finish}
            initial={{ opacity:0, scale:.8 }} animate={{ opacity:1, scale:1 }}
            className="flex items-center gap-2 rounded-xl px-4 text-sm font-bold" style={{ minHeight: 44, background:'rgba(255,255,255,0.15)', color:'#fff', backdropFilter:'blur(8px)' }}>
            Пропустить →
          </motion.button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
            style={{ background:'rgba(0,0,0,0.6)', color:'rgba(255,255,255,0.6)' }}>
            Пропустить через {left}
          </div>
        )}
      </div>
    </div>
  );
};

/* -- Channel Post Ad (текстовый пост в каналах) ------------- */
export const ChannelAdPost = () => {
  const { ad, click } = useServedAd('channel_post');
  const [dismissed, setDismissed] = useState(false);

  if (!ad || dismissed) return null;

  return (
    <div className="rounded-2xl overflow-hidden mx-2 my-2"
      style={{ background:'rgba(79,110,247,0.06)', border:'1px solid rgba(79,110,247,0.2)' }}>
      <div className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom:'1px solid rgba(79,110,247,0.1)' }}>
        <span className="text-[9px] font-bold flex items-center gap-1" style={{ color:'#818cf8' }}>
          <Pin size={9}/> Закреплённая реклама
        </span>
        <button type="button" onClick={() => setDismissed(true)}>
          <X size={10} style={{ color:'rgba(255,255,255,0.3)' }}/>
        </button>
      </div>
      <div className="px-3 py-2.5 cursor-pointer" onClick={click}>
        <p className="text-sm font-semibold text-white">{ad.title}</p>
        {ad.description && <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.5)' }}>{ad.description}</p>}
      </div>
    </div>
  );
};

/**
 * Есть ли сейчас активная реклама под площадку — для условного рендера
 * блока (например, не резервировать место под баннер, если рекламы
 * нет). Реальный ответ только у сервера; здесь — быстрый предзапрос
 * без записи показа (показ пишет сам компонент выше при монтировании).
 */
export const hasActiveAds = async (placement: AdPlacement): Promise<boolean> => {
  const ad = await apiServeAd(placement);
  return ad !== null;
};
