/**
 * «Музыкальная карточка по фото»: человек выбирает снимок, Sky AI описывает его НАСТРОЕНИЕ (не людей на нём), по настроению подбираются
 * песни из каталога Sky. Это подбор по настроению и жанру, а не «узнавание» песни по картинке. Фото остаётся на устройстве как фон карточки;
 * для разбора оно один раз уходит ИИ (так же, как во вкладке «Изображение» Sky AI) и сразу удаляется, в историю чатов разбор не пишется.
 */
import { useEffect, useRef, useState } from 'react';
import { X, ImagePlus, Play, ListPlus } from 'lucide-react';
import { SkyCloud } from '@/os/SkyCloud';
import { SkyLoader } from '@/shared/SkyLoader';
import { flash } from '@/shared/flash';
import { apiAiUpload, apiAiAnalyzeImage } from '@/ai/aiApi';
import { apiTracks, toClientTrack } from './musicApi';
import { playMusicQueue } from './useMusicSync';
import { useMusicStore } from './serverStore';
import type { Track } from './types';

interface Result { title: string; mood: string; tracks: Track[] }

const PROMPT = `Посмотри на фото и опиши его настроение для подбора музыки. Не описывай людей и не делай выводов о них. Ответь ТОЛЬКО одним JSON без пояснений и без markdown:
{"title":"короткое название подборки до 40 знаков","mood":"одно предложение о настроении","genres":["до 3 музыкальных жанров"],"keywords":["до 4 слов: настроение, время суток, сцена"]}`;

const parse = (text: string): { title: string; mood: string; terms: string[] } | null => {
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { title?: unknown; mood?: unknown; genres?: unknown; keywords?: unknown };
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean).slice(0, 4) : []);
    const terms = [...arr(j.genres), ...arr(j.keywords)];
    if (!terms.length) return null;
    return { title: String(j.title ?? '').slice(0, 40) || 'Музыка по фото', mood: String(j.mood ?? '').slice(0, 240), terms };
  } catch { return null; }
};

export const PhotoCard = ({ onClose }: { onClose: () => void }) => {
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const cancel = useRef<(() => void) | null>(null);
  const createPlaylist = useMusicStore((s) => s.createPlaylist);
  const addToPlaylist = useMusicStore((s) => s.addToPlaylist);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  useEffect(() => () => { cancel.current?.(); }, []);   // отмена загрузки — только при закрытии окна, а не при смене фото

  const run = async (f: File) => {
    if (!f.type.startsWith('image/')) return setErr('Нужна картинка (JPEG, PNG или WebP).');
    if (f.size > 8 * 1048576) return setErr('Файл больше 8 МБ — выберите поменьше.');
    setErr(''); setRes(null); setBusy(true); setPhoto(URL.createObjectURL(f));
    const up = apiAiUpload(f, f.name || 'photo'); cancel.current = up.cancel;
    const u = await up.promise;
    if (!u.ok || !u.fileId) { setBusy(false); return setErr(u.reason ?? 'Не удалось загрузить фото.'); }
    const a = await apiAiAnalyzeImage(u.fileId, PROMPT, undefined, true);
    if (!a.ok) { setBusy(false); return setErr(a.reason); }
    const p = parse(a.text);
    if (!p) { setBusy(false); return setErr('Sky AI не смог описать настроение этого снимка. Попробуйте другое фото.'); }
    const seen = new Set<string>(); const tracks: Track[] = [];
    for (const term of p.terms) {
      const rows = await apiTracks({ q: term, limit: 8 });
      for (const r of rows ?? []) { if (!seen.has(r.id) && tracks.length < 12) { seen.add(r.id); tracks.push(toClientTrack(r)); } }
    }
    setBusy(false);
    if (!tracks.length) return setErr('В каталоге не нашлось песен под это настроение. Попробуйте другое фото.');
    setRes({ title: p.title, mood: p.mood, tracks });
  };

  const save = async () => {
    if (!res) return;
    const pl = await createPlaylist(res.title); if (!pl) return flash('Не удалось создать плейлист');
    for (const t of res.tracks) await addToPlaylist(pl.id, t.id);
    flash('Плейлист сохранён');
  };

  return (
    <div role="dialog" aria-label="Карточка по фото" data-keep-dark style={{ position: 'fixed', inset: 0, zIndex: 650, background: 'rgba(7,7,12,.94)', color: '#fff', overflowY: 'auto', padding: 'max(18px, env(safe-area-inset-top)) 16px 28px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <p style={{ flex: 1, margin: 0, fontSize: 21, fontWeight: 900 }}>Музыка по фото</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} style={{ width: 44, height: 44, borderRadius: 22, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.62)', lineHeight: 1.5 }}>Выберите фото — Sky AI поймёт настроение кадра и подберёт песни из каталога. Это подборка по настроению, а не распознавание песни. Фото уходит ИИ один раз и не сохраняется; людей на снимке ИИ не описывает.</p>

        {!res && !busy && (
          <label style={{ display: 'grid', placeItems: 'center', gap: 8, minHeight: 170, borderRadius: 26, border: '1.5px dashed rgba(255,255,255,.25)', cursor: 'pointer', background: 'rgba(255,255,255,.05)', textAlign: 'center', padding: 16 }}>
            <SkyCloud state="greeting" size={72} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800 }}><ImagePlus size={18} />Выбрать фото</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ''; }} />
          </label>)}
        {busy && <div style={{ display: 'grid', placeItems: 'center', minHeight: 170 }}><SkyLoader label="Слушаю настроение кадра…" /></div>}
        {err && <p role="alert" style={{ margin: 0, padding: '10px 14px', borderRadius: 16, background: 'rgba(239,68,68,.16)', border: '1px solid rgba(239,68,68,.35)', fontSize: 13 }}>{err}</p>}

        {res && (
          <div style={{ borderRadius: 28, overflow: 'hidden', border: '1px solid rgba(255,255,255,.14)', background: '#0f0b1d' }}>
            <div style={{ position: 'relative', minHeight: 190, backgroundImage: photo ? `linear-gradient(180deg,rgba(0,0,0,.15),rgba(10,8,24,.95)), url(${photo})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-end', padding: 18 }}>
              <div>
                <p translate="no" style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>{res.title}</p>
                <p translate="no" style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,.8)', lineHeight: 1.45 }}>{res.mood}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '12px 14px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { playMusicQueue(res.tracks, res.tracks[0].id); onClose(); }} style={{ minHeight: 44, padding: '0 20px', borderRadius: 999, border: 0, background: '#fff', color: '#0A0A10', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><Play size={16} fill="#0A0A10" />Слушать</button>
              <button type="button" onClick={() => void save()} style={{ minHeight: 44, padding: '0 18px', borderRadius: 999, border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.1)', color: '#fff', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><ListPlus size={16} />В плейлист</button>
              <button type="button" onClick={() => { setRes(null); setPhoto(null); }} style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, border: 0, background: 'transparent', color: 'rgba(255,255,255,.7)', fontWeight: 700, cursor: 'pointer' }}>Другое фото</button>
            </div>
            <div style={{ padding: '0 8px 12px' }}>
              {res.tracks.map((t) => (
                <button key={t.id} type="button" onClick={() => { playMusicQueue(res.tracks, t.id); onClose(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 0, background: 'transparent', color: '#fff', cursor: 'pointer', borderRadius: 14 }}>
                  <span translate="no" style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{t.title}</span><span translate="no" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{t.artist}</span>
                </button>))}
            </div>
          </div>)}
      </div>
    </div>
  );
};
