/* -- Мои треки  -  загрузка и управление -------------------- */
import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import type { Track } from '@/platform/store';
import { usePlatformStore } from '@/platform/store';
import { useAuthStore } from '@/core/auth/store';
import { toDurStr } from './utils';
import { TrackRow } from './MusicPrimitives';

interface Props {
  activeId: string | null;
  playing:  boolean;
  onPlay:   (t: Track, pool: Track[]) => void;
}

export const MyTracksTab = ({ activeId, playing, onPlay }: Props) => {
  const { tracks, addTrack, deleteTrack, toggleFavorite, favorites, submitForReview } = usePlatformStore();
  const { currentUserId } = useAuthStore();

  const [dragging, setDragging] = useState(false);
  const [pFile, setPFile]       = useState<File | null>(null);
  const [pUrl,  setPUrl]        = useState<string | null>(null);
  const [pDur,  setPDur]        = useState(0);
  const [title, setTitle]       = useState('');
  const [artist, setArtist]     = useState('');
  const [genre, setGenre]       = useState('');
  const [lyrics, setLyrics]     = useState('');
  const [saving, setSaving]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = tracks.filter(t => t.uploadedBy === currentUserId);

  // Revoke blob URL when form is cancelled or component unmounts
  const cancelUpload = () => {
    if (pUrl) URL.revokeObjectURL(pUrl);
    setPFile(null); setPUrl(null); setTitle(''); setArtist(''); setGenre(''); setLyrics('');
  };

  const processFile = async (f: File) => {
    if (!f.type.startsWith('audio/') && !f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a)$/i)) return;
    const url = URL.createObjectURL(f);
    const dur = await new Promise<number>(r => {
      const a = document.createElement('audio');
      a.onloadedmetadata = () => r(a.duration);
      a.onerror = () => r(0);
      a.src = url;
    });
    const base  = f.name.replace(/\.[^.]+$/, '');
    const parts = base.split(/\s*[-–—]\s*/);
    setTitle(parts.length > 1 ? parts.slice(1).join('-').trim() : base);
    setArtist(parts.length > 1 ? parts[0].trim() : '');
    setGenre(''); setLyrics('');
    setPFile(f); setPUrl(url); setPDur(dur);
  };

  const confirm = async () => {
    if (!pFile || !pUrl || !title.trim()) return;
    setSaving(true);
    const b64 = await new Promise<string>(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result as string);
      fr.readAsDataURL(pFile!);
    });
    addTrack({
      title: title.trim(), artist: artist.trim() || 'Неизвестный',
      genre: genre.trim() || 'Другое', lyrics: lyrics.trim() || undefined,
      duration: toDurStr(pDur), premium: false,
      sourceUrl: pUrl, fileName: pFile.name, mimeType: pFile.type,
      bytes: pFile.size, isLocal: true, uploadedBy: currentUserId!, status: 'private',
    }, b64);
    setPFile(null); setPUrl(null); setTitle(''); setArtist(''); setGenre(''); setLyrics('');
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Зона загрузки */}
      {!pFile && (
        <div className="mx-3 mb-3 shrink-0 flex flex-col items-center justify-center gap-2 rounded-2xl py-5 cursor-pointer"
          style={{
            background: dragging ? 'var(--accent-bg)' : 'rgba(255,255,255,0.02)',
            border:     `2px dashed ${dragging ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
          }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); }}
          onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }}/>
          <Upload size={20} style={{ color: dragging ? 'var(--accent)' : 'var(--t3)' }}/>
          <p className="text-xs text-center" style={{ color: dragging ? 'var(--accent)' : 'var(--t3)' }}>
            {dragging ? 'Отпустите файл' : 'MP3 · WAV · FLAC · OGG'}
          </p>
        </div>
      )}

      {/* Метаданные */}
      {pFile && (
        <div className="mx-3 mb-3 shrink-0 rounded-2xl p-3 space-y-2"
          style={{ background: 'rgba(79,110,247,0.08)', border: '1px solid rgba(79,110,247,0.2)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>✏️ Информация о треке</p>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название *"
            className="w-full rounded-xl px-3 py-2 text-xs text-white outline-none"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}/>
          <div className="grid grid-cols-2 gap-2">
            <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Исполнитель"
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}/>
            <input value={genre} onChange={e => setGenre(e.target.value)} placeholder="Жанр"
              className="rounded-xl px-3 py-2 text-xs text-white outline-none"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}/>
          </div>
          <textarea value={lyrics} onChange={e => setLyrics(e.target.value)} rows={3} placeholder="Текст песни (необязательно)"
            className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none leading-relaxed"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}/>
          <div className="flex gap-2">
            <button type="button" onClick={confirm} disabled={saving || !title.trim()}
              className="flex-1 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button type="button" onClick={cancelUpload}
              className="rounded-xl px-3 py-2 text-xs" style={{ color: 'var(--t3)', background: 'var(--bg-l2)' }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Список треков */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {mine.length === 0
          ? <p className="py-8 text-center text-xs" style={{ color: 'var(--t3)' }}>Загрузи свой первый трек ↑</p>
          : mine.map(t => (
              <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
                onPlay={() => onPlay(t, mine)} liked={favorites.includes(t.id)}
                onLike={() => toggleFavorite(t.id)} onAdd={() => {}} showStatus
                onSubmit={t.status === 'private' ? () => submitForReview(t.id) : undefined}
                onDelete={() => deleteTrack(t.id)}/>
            ))
        }
      </div>
    </div>
  );
};
