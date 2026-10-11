/**
 * Аналитика канала Sky Video — экран автора. Только настоящие данные сервера (server/skyvideo.mjs, channelAnalytics):
 * подписчики, просмотры, лайки, комментарии, новые зрители по дням, последнее видео, лучшие Shorts.
 * Графика за время до начала сбора нет — это сказано на экране.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, Eye, ThumbsUp, MessageSquare, Film, Loader2 } from 'lucide-react';
import { apiSkyVideoAnalytics, thumbnailUrl, type ChannelAnalytics, type ServerVideo } from './skyVideoApi';

const V = { bg: 'var(--bg)', bg1: 'var(--bg-l1)', bg2: 'var(--bg-l2)', border: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', accent: 'var(--accent)' };
const num = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.0', '')} млн` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')} тыс.` : String(n));
const ago = (iso?: string) => {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  return d < 86400000 ? 'сегодня' : `${Math.floor(d / 86400000)} дн. назад`;
};

const Metric = ({ icon: Icon, value, label }: { icon: typeof Eye; value: number; label: string }) => (
  <div className="min-w-0 flex-1 px-2 text-left" style={{ borderLeft: `1px solid ${V.border}` }}>
    <Icon size={22} style={{ color: V.t1 }} />
    <p className="mt-2 text-[22px] font-bold" style={{ color: V.t1 }}>{num(value)}</p>
    <p className="text-[12px]" style={{ color: V.t3 }}>{label}</p>
  </div>
);

const Chart = ({ data }: { data: { day: string; views: number }[] }) => {
  const max = Math.max(1, ...data.map((d) => d.views));
  return (
    <div>
      <div className="flex h-[70px] items-end gap-[3px]" role="img" aria-label="Новые зрители по дням">
        {data.map((d) => (
          <div key={d.day} title={`${d.day}: ${d.views}`} className="flex-1 rounded-t-[3px]"
            style={{ height: d.views ? `${Math.max(6, (d.views / max) * 100)}%` : 3, background: d.views ? '#1d78d8' : V.border }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px]" style={{ color: V.t3 }}>
        <span>{new Date(data[0].day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
        <span>{new Date(data[data.length - 1].day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
};

const Thumb = ({ v, className, style }: { v: ServerVideo; className?: string; style?: React.CSSProperties }) => (
  <div className={`relative overflow-hidden ${className ?? ''}`} style={{ background: V.bg2, ...style }}>
    {v.hasThumbnail && <img src={thumbnailUrl(v.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
  </div>
);

export const ChannelAnalyticsView = ({ name, avatar, onBack, onOpenVideo }: { name: string; avatar?: string | null; onBack: () => void; onOpenVideo?: (v: ServerVideo) => void }) => {
  const [d, setD] = useState<ChannelAnalytics | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void apiSkyVideoAnalytics().then((r) => { if (r) setD(r); else setFailed(true); }); }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto" style={{ background: V.bg, scrollbarWidth: 'none' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Назад" className="grid h-9 w-9 place-items-center rounded-full" style={{ background: V.bg2 }}><ChevronLeft size={20} style={{ color: V.t1 }} /></button>
      </div>
      <div className="px-4 pb-10">
        <h1 className="text-[32px] font-extrabold leading-tight" style={{ color: V.t1 }}>Аналитика</h1>
        <p className="mb-5 text-[13px]" style={{ color: V.t3 }}>За все время</p>
        {!d && !failed && <Loader2 size={20} className="animate-spin" style={{ color: V.t3 }} />}
        {failed && <p className="text-[13px]" style={{ color: V.t3 }}>Не удалось загрузить аналитику. Попробуйте позже.</p>}
        {d && (
          <div className="space-y-7">
            <div className="flex items-center gap-4">
              {avatar ? <img src={avatar} alt="" className="h-[72px] w-[72px] rounded-full object-cover" /> : <div className="grid h-[72px] w-[72px] place-items-center rounded-full text-[28px] font-bold text-white" style={{ background: V.accent }} translate="no">{name[0]?.toUpperCase()}</div>}
              <div><p className="text-[30px] font-extrabold leading-none" style={{ color: V.t1 }}>{num(d.subscribers)}</p><p className="mt-1 text-[16px]" style={{ color: V.t3 }}>Подписчики</p></div>
            </div>

            <div className="flex">
              <Metric icon={Eye} value={d.views} label="Просмотры" />
              <Metric icon={ThumbsUp} value={d.likes} label="Отметки «Нравится»" />
              <Metric icon={MessageSquare} value={d.comments} label="Комментарии" />
              <Metric icon={Film} value={d.videos} label="Видео" />
            </div>

            <section>
              <h2 className="mb-3 text-[20px] font-bold" style={{ color: V.t1 }}>Новые зрители</h2>
              <div className="flex items-end justify-between gap-4">
                <div className="shrink-0"><p className="text-[24px] font-bold" style={{ color: V.t1 }}>{num(d.last7)}</p><p className="text-[13px]" style={{ color: V.t3 }}>Последние 7 дней</p></div>
                <div className="min-w-0 flex-1"><Chart data={d.perDay.slice(-14)} /></div>
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: V.t3 }}>
                {d.trackingSince ? `Считаем уникальных зрителей на ролик с ${new Date(d.trackingSince).toLocaleDateString('ru-RU')}.` : 'Просмотров пока нет — график появится вместе с первыми зрителями.'}
              </p>
            </section>

            {d.lastVideo && (
              <section>
                <h2 className="mb-3 text-[20px] font-bold" style={{ color: V.t1 }}>Последнее видео</h2>
                <button type="button" onClick={() => onOpenVideo?.(d.lastVideo!)} className="flex w-full gap-4 rounded-2xl p-3 text-left" style={{ background: V.bg1, border: `1px solid ${V.border}` }}>
                  <Thumb v={d.lastVideo} className="shrink-0 rounded-xl" style={{ width: 120, aspectRatio: d.lastVideo.height && d.lastVideo.width && d.lastVideo.height >= d.lastVideo.width ? '9/16' : '16/9' }} />
                  <div className="min-w-0 flex-1 self-center">
                    <p className="line-clamp-2 text-[16px] font-bold" style={{ color: V.t1 }} translate="no">{d.lastVideo.title}</p>
                    <p className="mt-1 text-[12px]" style={{ color: V.t3 }}>{ago(d.lastVideo.publishedAt ?? d.lastVideo.createdAt)}</p>
                    <p className="mt-3 flex items-center gap-2 text-[15px]" style={{ color: V.t1 }}><Eye size={16} /> {num(d.lastVideo.views)}</p>
                    <p className="mt-1 flex items-center gap-2 text-[15px]" style={{ color: V.t1 }}><ThumbsUp size={16} /> {num(d.lastVideo.likes)}</p>
                  </div>
                </button>
              </section>
            )}

            {d.topShorts.length > 0 && (
              <section>
                <h2 className="mb-3 text-[20px] font-bold" style={{ color: V.t1 }}>Лучшие Shorts</h2>
                <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                  {d.topShorts.map((v) => (
                    <button key={v.id} type="button" onClick={() => onOpenVideo?.(v)} className="shrink-0 text-left" style={{ width: 120 }}>
                      <Thumb v={v} className="rounded-xl" style={{ width: 120, aspectRatio: '9/16' }} />
                      <p className="mt-1 text-[12px] font-semibold" style={{ color: V.t1 }}><Eye size={12} className="mr-1 inline" />{num(v.views)}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
