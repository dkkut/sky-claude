/** Фото и баннер карточки музыканта: показ (запрос с токеном → blob) и загрузка для владельца карточки / владельца сервиса. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { apiBlob, apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

type Kind = 'photo' | 'banner';
const LIMIT: Record<Kind, number> = { photo: 300 * 1024, banner: 600 * 1024 };
const SIZE: Record<Kind, [number, number]> = { photo: [512, 512], banner: [1400, 460] };
const ERR: Record<string, string> = { image_too_large: 'Файл слишком большой даже после сжатия.', bad_image: 'Нужна картинка PNG, JPEG или WebP.', not_allowed: 'Нет прав менять эту карточку.', too_many_requests: 'Слишком часто. Подождите.' };

export const useCardImage = (cardId: string, kind: Kind, has: boolean, rev = 0) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true; let u: string | null = null;
    if (!has) { setUrl(null); return; }
    void apiBlob(`/api/music/artist-cards/${cardId}/image/${kind}`).then((r) => { if (on && r.ok && r.blob) { u = URL.createObjectURL(r.blob); setUrl(u); } });
    return () => { on = false; if (u) URL.revokeObjectURL(u); };
  }, [cardId, kind, has, rev]);
  return url;
};

/** Сжать картинку до нужного размера (обрезка по центру) и уложиться в предел: JPEG, качество снижается. */
const prepare = async (file: File, kind: Kind): Promise<string | null> => {
  const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) return null;
  const [w, h] = SIZE[kind]; const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  const k = Math.max(w / bmp.width, h / bmp.height); const dw = bmp.width * k; const dh = bmp.height * k;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  for (const q of [0.88, 0.78, 0.66, 0.54, 0.42]) {
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= LIMIT[kind]) return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(blob); });
  }
  return null;
};

export const CardImageEditor = ({ cardId, hasPhoto, hasBanner, onChanged }: { cardId: string; hasPhoto: boolean; hasBanner: boolean; onChanged: () => void }) => {
  const [rev, setRev] = useState(0); const [busy, setBusy] = useState<Kind | null>(null);
  const fp = useRef<HTMLInputElement>(null); const fb = useRef<HTMLInputElement>(null);
  const photo = useCardImage(cardId, 'photo', hasPhoto, rev); const banner = useCardImage(cardId, 'banner', hasBanner, rev);
  const upload = useCallback(async (kind: Kind, file: File | undefined) => {
    if (!file) return; setBusy(kind);
    const dataUrl = await prepare(file, kind);
    if (!dataUrl) { setBusy(null); return flash(ERR.bad_image); }
    const r = await apiCall(`/api/music/artist-cards/${cardId}/image/${kind}`, { method: 'PUT', body: JSON.stringify({ dataUrl }) });
    setBusy(null); if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не получилось загрузить.');
    flash('Сохранено'); setRev((x) => x + 1); onChanged();
  }, [cardId, onChanged]);
  const remove = async (kind: Kind) => { const r = await apiCall(`/api/music/artist-cards/${cardId}/image/${kind}`, { method: 'DELETE' }); if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не получилось.'); setRev((x) => x + 1); onChanged(); };
  const box = (kind: Kind, url: string | null, has: boolean, ref: React.RefObject<HTMLInputElement>, title: string) => (
    <div className="space-y-1.5">
      <p className="text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{title}</p>
      <div className={`grid place-items-center overflow-hidden ${kind === 'photo' ? 'h-24 w-24 rounded-2xl' : 'h-24 w-full rounded-xl'}`} style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={22} style={{ color: 'var(--t3)' }} />}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ''; }} />
      <div className="flex gap-2">
        <button type="button" disabled={busy === kind} onClick={() => ref.current?.click()} className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{has ? 'Заменить' : 'Загрузить'}</button>
        {has && <button type="button" aria-label="Убрать" onClick={() => void remove(kind)} className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'var(--bg-l3)' }}><Trash2 size={13} style={{ color: 'var(--red)' }} /></button>}
      </div>
    </div>
  );
  return <div className="space-y-3">{box('banner', banner, hasBanner, fb, 'Баннер')}{box('photo', photo, hasPhoto, fp, 'Фото')}</div>;
};
