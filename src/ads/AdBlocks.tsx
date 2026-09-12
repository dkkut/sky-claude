/* ===============================================================
   SKY AD BLOCKS  -  реальные рекламные блоки по всему приложению
   Читают активные кампании из ads/store и показывают их
=============================================================== */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Megaphone, Pin } from 'lucide-react';
import { useAdsStore, type AdCampaign, type AdPlacement } from './store';

/* -- Banner Ad (лента, шапки) ------------------------------- */
export const BannerAd = ({ placement, className = '' }: { placement: AdPlacement; className?: string }) => {
  const { campaigns, update } = useAdsStore();
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);

  const ad = campaigns.find(c =>
    c.status === 'active' &&
    c.placement === placement &&
    new Date(c.endDate) > new Date()
  );

  useEffect(() => {
    if (ad && !shown) {
      setShown(true);
      // record impression
      update(ad.id, { impressions: ad.impressions + 1, ctr: ad.clicks > 0 ? parseFloat(((ad.clicks / (ad.impressions + 1)) * 100).toFixed(1)) : 0 });
    }
  }, [ad?.id]);

  if (!ad || dismissed) return null;

  const handleClick = () => {
    update(ad.id, { clicks: ad.clicks + 1, ctr: parseFloat(((ad.clicks + 1) / (ad.impressions || 1) * 100).toFixed(1)) });
    if (ad.linkUrl) window.open(ad.linkUrl, '_blank');
  };

  return (
    <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
      className={`relative overflow-hidden ${className}`}
      style={{ background:'linear-gradient(135deg,rgba(79,110,247,0.08),rgba(79,110,247,0.04))',
        border:'1px solid rgba(79,110,247,0.18)', borderRadius:16 }}>
      <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer" onClick={handleClick}>
        {ad.imageUrl && (
          <img src={ad.imageUrl} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0"/>
        )}
        {!ad.imageUrl && (
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
  const { campaigns, update } = useAdsStore();
  const [dismissed, setDismissed] = useState(false);

  const ad = campaigns.find(c =>
    c.status === 'active' &&
    (c.placement === 'bloom_feed' || c.placement === 'bloom_stories') &&
    new Date(c.endDate) > new Date()
  );

  useEffect(() => {
    if (ad) update(ad.id, { impressions: ad.impressions + 1 });
  }, [ad?.id]);

  if (!ad || dismissed) return null;

  const handleClick = () => {
    update(ad.id, { clicks: ad.clicks + 1, ctr: parseFloat(((ad.clicks + 1) / Math.max(1, ad.impressions) * 100).toFixed(1)) });
    if (ad.linkUrl) window.open(ad.linkUrl, '_blank');
  };

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
      <div className="cursor-pointer" onClick={handleClick}>
        {ad.imageUrl && (
          <img src={ad.imageUrl} alt="" className="w-full max-h-48 object-cover"/>
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
  const { campaigns, update } = useAdsStore();
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [canSkip, setCanSkip] = useState(false);

  const ad = campaigns.find(c =>
    c.status === 'active' &&
    c.placement === 'video_preroll' &&
    new Date(c.endDate) > new Date()
  );

  useEffect(() => {
    if (!ad) { onSkip(); return; }
    update(ad.id, { impressions: ad.impressions + 1 });
    const t = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(t); setCanSkip(true); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [ad?.id]);

  if (!ad) return null;

  const handleClick = () => {
    update(ad.id, { clicks: ad.clicks + 1 });
    if (ad.linkUrl) window.open(ad.linkUrl, '_blank');
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background:'#000' }}>
      {/* Ad content */}
      <div className="flex-1 relative cursor-pointer flex items-center justify-center" onClick={handleClick}
        style={{ background: ad.imageUrl ? 'transparent' : 'linear-gradient(135deg,#0f172a,#1e3a5f)' }}>
        {ad.imageUrl
          ? <img src={ad.imageUrl} alt="" className="w-full h-full object-cover"/>
          : <div className="text-center px-8">
              <Megaphone size={46} className="mx-auto mb-4 text-white/80"/>
              <p className="text-xl font-black text-white">{ad.title}</p>
              {ad.description && <p className="text-sm mt-2" style={{ color:'rgba(255,255,255,0.6)' }}>{ad.description}</p>}
            </div>
        }
        {/* Ad label */}
        <div className="absolute top-3 left-3 text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ background:'rgba(0,0,0,0.6)', color:'rgba(255,255,255,0.7)' }}>
          Реклама
        </div>
      </div>
      {/* Skip button */}
      <div className="absolute bottom-4 right-4">
        {canSkip ? (
          <motion.button whileTap={{ scale:.9 }} type="button" onClick={onSkip}
            initial={{ opacity:0, scale:.8 }} animate={{ opacity:1, scale:1 }}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
            style={{ background:'rgba(255,255,255,0.15)', color:'#fff', backdropFilter:'blur(8px)' }}>
            Пропустить →
          </motion.button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
            style={{ background:'rgba(0,0,0,0.6)', color:'rgba(255,255,255,0.6)' }}>
            Пропустить через {secondsLeft}
          </div>
        )}
      </div>
    </div>
  );
};

/* -- Channel Post Ad (текстовый пост в каналах) ------------- */
export const ChannelAdPost = () => {
  const { campaigns, update } = useAdsStore();
  const [dismissed, setDismissed] = useState(false);

  const ad = campaigns.find(c =>
    c.status === 'active' &&
    (c.placement === 'channel_post' || c.placement === 'channel_pin') &&
    new Date(c.endDate) > new Date()
  );

  useEffect(() => { if (ad) update(ad.id, { impressions: ad.impressions + 1 }); }, [ad?.id]);

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
      <div className="px-3 py-2.5 cursor-pointer"
        onClick={() => { update(ad.id, { clicks: ad.clicks+1 }); if(ad.linkUrl) window.open(ad.linkUrl,'_blank'); }}>
        <p className="text-sm font-semibold text-white">{ad.title}</p>
        {ad.description && <p className="text-xs mt-0.5" style={{ color:'rgba(255,255,255,0.5)' }}>{ad.description}</p>}
      </div>
    </div>
  );
};

/* -- No Ads state (if no active campaigns) ------------------- */
export const hasActiveAds = (placement: AdPlacement): boolean => {
  try {
    const campaigns = JSON.parse(localStorage.getItem('sky:ads:v1') || '[]');
    return campaigns.some((c: AdCampaign) =>
      c.status === 'active' && c.placement === placement && new Date(c.endDate) > new Date()
    );
  } catch { return false; }
};
