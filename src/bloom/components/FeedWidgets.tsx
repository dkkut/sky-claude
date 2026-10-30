import { useEffect, useState } from 'react';
import { Music2, Sun, Cloud, CloudFog, CloudRain, CloudSnow, CloudLightning, MapPinOff } from 'lucide-react';
import { useBloomStore } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { usePlayerStore } from '@/player/playerStore';
import { useModuleStore } from '@/data/state/modules';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { Av } from './Primitives';
import { apiWeather, apiCurrency, type WeatherNow, type WeatherKind, type CurrencyRate } from '../weatherApi';

const WEATHER_ICON: Record<WeatherKind, typeof Sun> = {
  clear: Sun, cloudy: Cloud, fog: CloudFog, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
};

/** Реальная позиция браузера — один раз за монтирование виджета, без
 *  повторных запросов: если человек отказал, честно молчим о погоде,
 *  а не подставляем выдуманный город. */
function useBrowserLocation() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setDenied(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setDenied(true),
      { timeout: 8000, maximumAge: 10 * 60_000 },
    );
  }, []);
  return { coords, denied };
}

const Widget = ({ children, minWidth, onClick, compact }: { children: React.ReactNode; minWidth: number; onClick?: () => void; compact?: boolean }) => (
  <div onClick={onClick}
    className={compact ? 'shrink-0 rounded-xl px-2.5 py-2' : 'shrink-0 rounded-2xl px-3.5 py-2.5'}
    style={{ minWidth, background: 'var(--bg-l2)', border: '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default' }}>
    {children}
  </div>
);
const WLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{children}</p>
);

export const FeedWidgets = () => {
  const suggested = useBloomStore(s => s.suggested);
  const trendingTags = useBloomStore(s => s.trendingTags);
  const loadSuggested = useBloomStore(s => s.loadSuggested);
  const loadTrending = useBloomStore(s => s.loadTrending);
  const { accounts } = useAuthStore();
  const { item, isPlaying } = usePlayerStore();
  const { setActiveModule, setPendingExtrasTab } = useModuleStore();
  const isMobile = useIsMobile();

  const { coords, denied } = useBrowserLocation();
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [rates, setRates] = useState<CurrencyRate[]>([]);

  useEffect(() => { void loadSuggested(); void loadTrending(); }, [loadSuggested, loadTrending]);
  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    void apiWeather(coords.lat, coords.lon).then(w => { if (!cancelled) setWeather(w); });
    return () => { cancelled = true; };
  }, [coords]);
  useEffect(() => { void apiCurrency().then(setRates); }, []);

  const goMusic = () => { setPendingExtrasTab('music'); setActiveModule('extras'); };

  const activity = suggested.slice(0, 2).map(id => accounts.find(a => a.id === id)).filter(Boolean);
  const tags = trendingTags.slice(0, 3);
  const mw = (desktop: number) => isMobile ? Math.round(desktop * 0.72) : desktop;

  return (
    <div className="border-b" style={{ borderColor: 'var(--border)' }}>
      <div className={isMobile ? 'flex gap-2 overflow-x-auto px-3 py-2' : 'flex gap-2.5 overflow-x-auto px-4 py-3'} style={{ scrollbarWidth: 'none' }}>

        <Widget minWidth={mw(110)} compact={isMobile}>
          <WLabel>Погода</WLabel>
          {weather ? (
            <>
              {(() => { const Icon = WEATHER_ICON[weather.kind]; return <Icon size={16} style={{ color: 'var(--t2)' }}/>; })()}
              <p className="mt-1 text-sm font-extrabold" style={{ color: 'var(--t1)' }}>{weather.tempC >= 0 ? '+' : ''}{Math.round(weather.tempC)}°</p>
              <p className="truncate text-[9px]" style={{ color: 'var(--t3)' }}>{weather.city ?? '—'}</p>
              <p className="truncate text-[8px]" style={{ color: 'var(--t3)' }} translate="no">MET Norway</p>
            </>
          ) : denied ? (
            <>
              <MapPinOff size={16} style={{ color: 'var(--t3)' }}/>
              <p className="mt-1 text-[10px] leading-tight" style={{ color: 'var(--t3)' }}>Нет доступа к геопозиции</p>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Определяем…</p>
          )}
        </Widget>

        <Widget minWidth={mw(150)} onClick={goMusic} compact={isMobile}>
          <WLabel><span className="inline-flex items-center gap-1"><Music2 size={10}/>Музыка</span></WLabel>
          {item ? (
            <>
              <p className="truncate text-[12px] font-bold" style={{ color: 'var(--t1)' }}>{item.title}</p>
              <p className="truncate text-[10px]" style={{ color: 'var(--t3)' }}>{item.author}</p>
              {isPlaying && (
                <div className="mt-1.5 flex items-end gap-[3px]" style={{ height: 12 }}>
                  {[0,1,2,3].map(i => (
                    <span key={i} className="w-[2.5px] rounded-full" style={{
                      background: 'var(--accent)', height: '100%',
                      animation: `music-pulse ${0.5+i*0.1}s ${i*0.07}s ease-in-out infinite`,
                    }}/>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Ничего не играет</p>
          )}
        </Widget>

        {rates.length > 0 && (
          <Widget minWidth={mw(130)} compact={isMobile}>
            <WLabel>Валюты</WLabel>
            {rates.map(r => (
              <div key={r.code} className="flex items-center justify-between mb-0.5">
                <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{r.code}</span>
                <span className="text-[10px] font-bold" style={{ color: r.changePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(1)}%
                </span>
              </div>
            ))}
          </Widget>
        )}

        {activity.length > 0 && (
          <Widget minWidth={mw(175)} compact={isMobile}>
            <WLabel>Активность</WLabel>
            {activity.map(a => a && (
              <div key={a.id} className="flex items-center gap-1.5 mb-1 last:mb-0">
                <Av name={a.name} size={5}/>
                <span className="truncate text-[10px]" style={{ color: 'var(--t3)' }}>
                  <span className="font-semibold" style={{ color: 'var(--t1)' }}>{a.name.split(' ')[0]}</span> опубликовал(а) пост
                </span>
              </div>
            ))}
          </Widget>
        )}

        {tags.length > 0 && (
          <Widget minWidth={mw(140)} compact={isMobile}>
            <WLabel>В тренде</WLabel>
            {tags.map(([tag], i) => (
              <p key={tag} className="truncate text-[11px] mb-0.5 last:mb-0" style={{ color: i===0 ? 'var(--accent)' : 'var(--t1)', fontWeight: i===0 ? 700 : 400 }}>#{tag}</p>
            ))}
          </Widget>
        )}

      </div>
    </div>
  );
};
