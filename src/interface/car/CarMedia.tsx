/* Sky Car: голосовое слушается, «кружочек» смотрится, звонок — одной кнопкой.
   Крупные цели касания; вложения грузятся сразу (за рулём «нажмите, чтобы загрузить» не нужно). */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, X, Mic } from 'lucide-react';
import type { MessageItem } from '@/messenger/types';
import { useAttachment } from '@/messenger/mediaCache';
import { safeMediaUrl } from '@/messenger/safeUrl';
import { CAR_ACCENT, fmtTime } from './carTheme';

export const CarVoice = ({ msg }: { msg: MessageItem }) => {
  const { url, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(parseInt(msg.text || '0') || 0);
  useEffect(() => { if (withhold) request(); }, [withhold, request]);

  const toggle = () => {
    const a = ref.current; if (!a) return;
    if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); else { a.pause(); setPlaying(false); }
  };
  return (
    <div className="flex w-[min(420px,60vw)] items-center gap-4">
      <audio ref={ref} src={url} onLoadedMetadata={(e) => setDur(e.currentTarget.duration || dur)} onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} onEnded={() => { setPlaying(false); setCur(0); }} />
      <button type="button" onClick={toggle} disabled={!url} aria-label={playing ? 'Пауза' : 'Слушать голосовое'}
        className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-white outline-none active:scale-90 disabled:opacity-50 focus-visible:ring-4 focus-visible:ring-violet-300">
        {playing ? <Pause size={30} color="#0b0b14" fill="#0b0b14" /> : <Play size={30} color="#0b0b14" fill="#0b0b14" className="ml-1" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[20px] font-semibold text-white"><Mic size={20} /> Голосовое</div>
        <div className="my-2 h-[8px] overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white" style={{ width: `${dur ? Math.min(100, (cur / dur) * 100) : 0}%` }} /></div>
        <p className="text-[16px] tabular-nums text-white/80">{fmtTime(cur)} / {fmtTime(dur)}</p>
      </div>
    </div>
  );
};

const NoteViewer = ({ msg, onClose }: { msg: MessageItem; onClose: () => void }) => {
  const { url, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (withhold) request(); }, [withhold, request]);
  useEffect(() => { void ref.current?.play().catch(() => {}); }, [url]);
  const size = Math.min(window.innerHeight * 0.78, window.innerWidth * 0.6);
  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.94)' }} onClick={onClose} role="dialog" aria-modal="true" aria-label="Видеосообщение">
      <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute right-8 top-6 grid h-[84px] w-[84px] place-items-center rounded-full active:scale-90" style={{ background: 'rgba(255,255,255,0.16)' }}><X size={38} color="#fff" /></button>
      <video ref={ref} src={url} playsInline autoPlay onClick={(e) => { e.stopPropagation(); const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); }} onEnded={onClose}
        className="rounded-full object-cover" style={{ width: size, height: size, boxShadow: `0 0 0 6px ${CAR_ACCENT}` }} />
    </div>,
    document.body,
  );
};

export const CarVideoNote = ({ msg }: { msg: MessageItem }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Смотреть видеосообщение" className="flex items-center gap-4 rounded-full bg-white/15 py-3 pl-3 pr-8 outline-none active:scale-95 focus-visible:ring-4 focus-visible:ring-violet-300">
        <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full bg-white"><Play size={30} color="#0b0b14" fill="#0b0b14" className="ml-1" /></span>
        <span className="text-[22px] font-semibold text-white">Видеосообщение{parseInt(msg.text || '0') ? ` · ${fmtTime(parseInt(msg.text || '0'))}` : ''}</span>
      </button>
      {open && <NoteViewer msg={msg} onClose={() => setOpen(false)} />}
    </>
  );
};
