/**
 * Правка своего трека: название, исполнитель, жанр, обложка, текст; удаление.
 * Доступно владельцу (сервер проверяет это сам). Цвета — от темы, чтобы поля
 * читались и в светлой, и в тёмной.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ImagePlus, Trash2, Loader, Music2 } from 'lucide-react';
import type { Track } from '@/platform/store';
import { useMusicStore } from './serverStore';
import { apiLyrics } from './musicApi';
import { flash } from '@/shared/flash';
import { LicensePicker } from './licenses';
import { useEffect } from 'react';

const MAX_COVER = 5 * 1024 * 1024;
const field: React.CSSProperties = { background: 'rgba(128,128,128,0.14)', color: 'var(--t1)', border: '1px solid rgba(128,128,128,0.35)' };

/** Уменьшить картинку до разумного размера: обложке не нужно 4000 пикселей. */
export const shrinkCover = async (blob: Blob, side = 800): Promise<Blob> => {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    return out && out.size < blob.size ? out : blob;
  } catch { return blob; }
};

export const TrackEditor = ({ track, onClose }: { track: Track; onClose: () => void }) => {
  const editTrack = useMusicStore((s) => s.editTrack);
  const setCover = useMusicStore((s) => s.setCover);
  const removeTrack = useMusicStore((s) => s.removeTrack);
  const live = useMusicStore((s) => s.tracks.find((t) => t.id === track.id)) ?? track;
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist === 'Неизвестный исполнитель' ? '' : track.artist);
  const [genre, setGenre] = useState(track.genre === 'Другое' ? '' : track.genre);
  const [license, setLicense] = useState(track.license ?? 'own');
  const [licenseSource, setLicenseSource] = useState(track.licenseSource ?? '');
  const [explicit, setExplicit] = useState(track.explicit === true);
  const [lyrics, setLyrics] = useState('');
  const [lyricsLoaded, setLyricsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void apiLyrics(track.id).then((r) => { if (alive) { setLyrics(r?.lyrics ?? ''); setLyricsLoaded(true); } });
    return () => { alive = false; };
  }, [track.id]);

  const pickCover = async (f: File) => {
    if (!f.type.startsWith('image/')) { flash('Нужна картинка: JPG, PNG или WebP'); return; }
    setCoverBusy(true);
    const small = await shrinkCover(f);
    if (small.size > MAX_COVER) { setCoverBusy(false); flash('Картинка слишком большая — до 5 МБ'); return; }
    const ok = await setCover(track.id, small);
    setCoverBusy(false);
    if (!ok) flash('Не удалось сохранить обложку. Попробуйте ещё раз.');
  };

  const save = async () => {
    if (!title.trim()) { flash('Укажите название'); return; }
    setBusy(true);
    const patch: Parameters<typeof editTrack>[1] = { title: title.trim(), artist: artist.trim() || 'Неизвестный исполнитель', genre: genre.trim() || 'Другое', license, licenseSource: licenseSource.trim(), explicit };
    if (lyricsLoaded) patch.lyrics = lyrics;
    const ok = await editTrack(track.id, patch);
    setBusy(false);
    if (!ok) { flash('Не удалось сохранить изменения. Попробуйте ещё раз.'); return; }
    onClose();
  };

  const del = async () => {
    if (!window.confirm('Удалить трек из коллекции? Это нельзя отменить.')) return;
    setBusy(true);
    const ok = await removeTrack(track.id);
    setBusy(false);
    if (!ok) { flash('Не удалось удалить трек. Попробуйте ещё раз.'); return; }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Изменить трек"
      style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] p-5 sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-elevated, var(--bg, #14141c))', color: 'var(--t1)', border: '1px solid rgba(128,128,128,0.3)' }}>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[16px] font-bold">Изменить трек</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(128,128,128,0.18)' }}><X size={16} /></button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: 'rgba(128,128,128,0.2)' }}>
            {live.coverUrl ? <img src={live.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={28} style={{ opacity: 0.5 }} />}
          </div>
          <div className="min-w-0 flex-1">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickCover(f); e.target.value = ''; }} />
            <button type="button" disabled={coverBusy} onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'rgba(128,128,128,0.2)' }}>
              {coverBusy ? <Loader size={14} className="animate-spin" /> : <ImagePlus size={14} />}{live.coverUrl ? 'Заменить обложку' : 'Добавить обложку'}
            </button>
            <p className="mt-1.5 text-[11px]" style={{ opacity: 0.6 }}>JPG, PNG или WebP</p>
          </div>
        </div>

        <label className="mb-1 block text-[12px] font-semibold" style={{ opacity: 0.7 }}>Название</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} translate="no" className="mb-3 w-full rounded-full px-4 py-2.5 text-[14px] outline-none" style={field} />
        <label className="mb-1 block text-[12px] font-semibold" style={{ opacity: 0.7 }}>Исполнитель</label>
        <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} translate="no" placeholder="Неизвестный исполнитель" className="mb-3 w-full rounded-full px-4 py-2.5 text-[14px] outline-none" style={field} />
        <label className="mb-1 block text-[12px] font-semibold" style={{ opacity: 0.7 }}>Жанр</label>
        <input value={genre} onChange={(e) => setGenre(e.target.value)} maxLength={60} translate="no" placeholder="Другое" className="mb-3 w-full rounded-full px-4 py-2.5 text-[14px] outline-none" style={field} />
        <div className="mb-3"><LicensePicker license={license} source={licenseSource} onChange={(l, src) => { setLicense(l); setLicenseSource(src); }} /></div>
        <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={explicit} onChange={(e) => setExplicit(e.target.checked)} />Пометка «E»: ненормативная лексика / 18+ (Explicit)</label>
        <label className="mb-1 block text-[12px] font-semibold" style={{ opacity: 0.7 }}>Текст песни</label>
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={5} translate="no" disabled={!lyricsLoaded} className="mb-4 w-full resize-none rounded-[20px] px-4 py-2.5 text-[14px] outline-none" style={field} />

        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void save()} className="flex-1 rounded-full py-3 text-[14px] font-bold disabled:opacity-50" style={{ background: '#4fe3d0', color: '#0a0a0f' }}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button type="button" disabled={busy} aria-label="Удалить трек" onClick={() => void del()} className="grid h-[46px] w-[46px] place-items-center rounded-full disabled:opacity-50" style={{ background: 'rgba(224,90,90,0.18)', color: '#e05a5a' }}><Trash2 size={18} /></button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
