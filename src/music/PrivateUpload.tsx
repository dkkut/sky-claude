/**
 * Загрузка в личную коллекцию.
 *
 * Отдельно от вкладки «Загрузить»: та ведёт к общему каталогу и
 * заканчивается публикацией, а здесь всё остаётся при владельце.
 * Загруженное сюда видит только он — сервер чужие закрытые треки не
 * отдаёт никому, ни списком, ни файлом.
 */
import { useRef, useState } from 'react';
import { Upload, Loader, Check, X, ImagePlus } from 'lucide-react';
import { parseBlob } from 'music-metadata';
import { useMusicStore } from './serverStore';
import { shrinkCover } from './TrackEditor';
import { LicensePicker } from './licenses';

/** Тот же потолок, что и на сервере: не гоняем файл впустую. */
const MAX_BYTES = 30 * 1024 * 1024;
const AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac|alac|caf)$/i;

export const PrivateUpload = () => {
  const upload = useMusicStore(st => st.upload);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [duration, setDuration] = useState(0);
  const [license, setLicense] = useState('own');
  const [licenseSource, setLicenseSource] = useState('');
  const [cover, setCover] = useState<Blob | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const setCoverBlob = (b: Blob | null) => {
    setCover(b);
    setCoverUrl((old) => { if (old) URL.revokeObjectURL(old); return b ? URL.createObjectURL(b) : null; });
  };
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null); setTitle(''); setArtist(''); setDuration(0); setCoverBlob(null); setLicense('own'); setLicenseSource('');
    setError(null); setDone(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (f: File) => {
    setError(null); setDone(false);
    if (!f.type.startsWith('audio/') && !AUDIO_RE.test(f.name)) {
      setError('Это не аудиофайл: нужен MP3, OGG, FLAC, WAV или M4A');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`Файл ${(f.size / 1024 / 1024).toFixed(1)} МБ — больше, чем можно загрузить (30 МБ)`);
      return;
    }
    setFile(f);

    // Длительность и теги: заполняем поля, но последнее слово за
    // человеком — теги в файлах часто врут.
    const url = URL.createObjectURL(f);
    const dur = await new Promise<number>(r => {
      const a = document.createElement('audio');
      a.onloadedmetadata = () => r(a.duration || 0);
      a.onerror = () => r(0);
      a.src = url;
    });
    URL.revokeObjectURL(url);
    setDuration(dur);

    let gotTitle = '', gotArtist = '';
    try {
      const meta = await parseBlob(f);
      gotTitle = meta.common.title ?? '';
      gotArtist = meta.common.artist ?? '';
      // Обложка, вшитая в сам файл, — берём её: так в коллекции не будет серых квадратов.
      const pic = meta.common.picture?.[0];
      if (pic?.data?.length) setCoverBlob(await shrinkCover(new Blob([pic.data], { type: pic.format || 'image/jpeg' })));
    } catch { /* файл без читаемых тегов — не беда */ }

    if (!gotTitle || !gotArtist) {
      // «Исполнитель - Название» в имени файла — самый частый случай.
      const base = f.name.replace(/\.[^.]+$/, '');
      const dash = base.split(/\s+[-–—]\s+/);
      if (dash.length > 1) {
        gotArtist ||= dash[0].trim();
        gotTitle  ||= dash.slice(1).join(' - ').trim();
      } else {
        gotTitle ||= base.trim();
      }
    }
    setTitle(gotTitle);
    setArtist(gotArtist);
  };

  const send = async () => {
    if (!file || !title.trim()) return;
    setBusy(true); setError(null);
    const res = await upload(file, {
      title: title.trim(),
      artist: artist.trim() || 'Неизвестный исполнитель',
      duration: Math.round(duration),
      license, licenseSource: licenseSource.trim() || undefined,
    });
    if (res.ok && res.id && cover) {
      const okCover = await useMusicStore.getState().setCover(res.id, cover);
      if (!okCover) setError('Трек сохранён, но обложку загрузить не удалось — добавьте её через «Изменить».');
    }
    setBusy(false);
    if (!res.ok) { setError(res.reason ?? 'Не получилось загрузить'); return; }
    setDone(true);
    setTimeout(reset, 1800);
  };

  return (
    <div className="rounded-2xl p-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void pick(f); }}/>

      {!file && (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12.5px] font-bold"
          style={{ background: '#fff', color: '#0a0a0f' }}>
          <Upload size={14}/>Загрузить в личную коллекцию
        </button>
      )}

      {file && !done && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[12px]" style={{ color: '#8a8f9a' }}>{file.name}</p>
            <button type="button" aria-label="Отменить выбор файла" onClick={reset}
              className="shrink-0 p-1" style={{ color: '#5c626e' }}><X size={14}/></button>
          </div>
          <input ref={coverRef} type="file" accept="image/*" className="hidden"
            onChange={async e => { const f = e.target.files?.[0]; if (f) setCoverBlob(await shrinkCover(f)); e.target.value = ''; }}/>
          <button type="button" onClick={() => coverRef.current?.click()} className="flex items-center gap-3 rounded-2xl p-1.5 pr-3 text-left"
            style={{ background: 'rgba(128,128,128,0.12)' }}>
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: 'rgba(128,128,128,0.25)' }}>
              {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover"/> : <ImagePlus size={18} style={{ opacity: 0.6 }}/>}
            </span>
            <span className="text-[12px] font-medium" style={{ color: 'var(--t1)' }}>{coverUrl ? 'Обложка выбрана — нажмите, чтобы заменить' : 'Добавить обложку (необязательно)'}</span>
          </button>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название" maxLength={200}
            className="w-full rounded-full px-4 py-2 text-[13px] outline-none"
            style={{ background: 'rgba(128,128,128,0.14)', color: 'var(--t1)', border: '1px solid rgba(128,128,128,0.35)' }}/>
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Исполнитель" maxLength={200}
            className="w-full rounded-full px-4 py-2 text-[13px] outline-none"
            style={{ background: 'rgba(128,128,128,0.14)', color: 'var(--t1)', border: '1px solid rgba(128,128,128,0.35)' }}/>
          <LicensePicker license={license} source={licenseSource} onChange={(l, src) => { setLicense(l); setLicenseSource(src); }}/>
          <button type="button" disabled={busy || !title.trim()} onClick={() => void send()}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12.5px] font-bold disabled:opacity-40"
            style={{ background: '#fff', color: '#0a0a0f' }}>
            {busy ? <><Loader size={14} className="animate-spin"/>Загружаем…</> : <><Upload size={14}/>Сохранить у себя</>}
          </button>
        </div>
      )}

      {done && (
        <p className="flex items-center justify-center gap-2 py-2 text-[12.5px] font-bold" style={{ color: '#4fe3d0' }}>
          <Check size={14}/>Трек в вашей коллекции
        </p>
      )}

      {error && (
        <p className="mt-2 text-[12px]" style={{ color: '#e05a5a' }}>{error}</p>
      )}
    </div>
  );
};
