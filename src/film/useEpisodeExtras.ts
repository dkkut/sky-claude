/* Серия, заставка, субтитры — общий слой для плееров с пультом (ТВ, консоль).
   Для обычного фильма без субтитров ничего не запрашивает. */
import { useEffect, useState, useCallback, type RefObject } from 'react';
import type { ServerMovie } from './filmApi';
import { apiNextEpisode, apiSubtitles, apiSubtitleBlobUrl, type SubtitleTrack } from './seriesApi';

export const useEpisodeExtras = (movie: ServerMovie | null | undefined, vRef: RefObject<HTMLVideoElement | null>, cur: number) => {
  const [nextEp, setNextEp] = useState<ServerMovie | null>(null);
  const [tracks, setTracks] = useState<(SubtitleTrack & { url: string })[]>([]);
  const [subLang, setSubLang] = useState<string | null>(null);
  const id = movie?.id, seriesId = movie?.seriesId, bytes = movie?.bytes ?? 0, subs = movie?.subtitles ?? 0;

  useEffect(() => {
    setNextEp(null);
    if (!id || !seriesId) return;
    let alive = true;
    void apiNextEpisode(id).then(n => { if (alive) setNextEp(n); });
    return () => { alive = false; };
  }, [id, seriesId]);

  useEffect(() => {
    let alive = true; const urls: string[] = [];
    setTracks([]); setSubLang(null);
    if (id && bytes > 0 && (subs > 0 || seriesId)) {
      void apiSubtitles(id).then(async list => {
        const out: (SubtitleTrack & { url: string })[] = [];
        for (const t of list) { const u = await apiSubtitleBlobUrl(id, t.lang); if (u) { urls.push(u); out.push({ ...t, url: u }); } }
        if (alive) setTracks(out);
      });
    }
    return () => { alive = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [id, bytes, subs, seriesId]);

  useEffect(() => {
    const v = vRef.current; if (!v) return;
    const apply = () => { for (const tt of Array.from(v.textTracks)) tt.mode = tt.language === subLang ? 'showing' : 'disabled'; };
    apply();
    const t = window.setTimeout(apply, 300);
    return () => clearTimeout(t);
  }, [subLang, tracks, vRef]);

  const inIntro = !!movie && movie.introStart != null && movie.introEnd != null && cur >= movie.introStart && cur < movie.introEnd - 1;
  const skipIntro = useCallback(() => { const v = vRef.current; if (v && movie?.introEnd != null) v.currentTime = movie.introEnd; }, [vRef, movie?.introEnd]);
  /** Следующая дорожка по кругу: выкл → первая → … → выкл. */
  const cycleSubtitles = useCallback(() => {
    if (!tracks.length) return;
    const i = subLang ? tracks.findIndex(t => t.lang === subLang) : -1;
    setSubLang(i + 1 < tracks.length ? tracks[i + 1].lang : null);
  }, [tracks, subLang]);
  const subLabel = subLang ? (tracks.find(t => t.lang === subLang)?.label ?? subLang) : null;

  return { nextEp, tracks, subLang, subLabel, inIntro, skipIntro, cycleSubtitles };
};
