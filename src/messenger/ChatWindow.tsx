import {
  FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState, useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, Video, Search, MoreVertical, Paperclip, Mic, Square, Images, PawPrint, Gift, ShoppingCart,
  Send, X, Pencil, Trash2, Pin, Forward, Check, CheckCheck, FileText, Camera,
  ChevronDown, ChevronLeft, Flag, BellOff, Archive, UserMinus, UserPlus, Reply, Palette, Settings2, BarChart2, Crown,
  Copy, Smile, Ban, Play, Radio, Users, Info, Clock, Star, Zap, Plus, Wand2, Loader2, Lock, MessagesSquare, Shield, LogOut, Eye, EyeOff, Download, MicOff,
  AlertTriangle, Hand,
} from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { useModerationStore } from '@/shared/moderationStore';
import { ContentWarningGate, BlockedChannelBadge } from '@/shared/ContentWarningGate';
import { useMessengerStore } from './store';
import { useCallStore }      from '@/calls/store';
import { useAuthStore }      from '@/core/auth/store';
import { MessageItem, MessageKind } from './types';
import { broadcast }         from './socket';
import { safeMediaUrl }      from './safeUrl';
import { useAttachment }     from './mediaCache';
import { apiUploadFile, MAX_FILE_BYTES } from '@/core/auth/api';
import { PetBubble } from './PetPanel';
import { PetHouse }          from './PetHouse';
import { SpoilerText, OnceViewText, SelfDestructTimer, PollBubble, MsgOptionsPanel, CreatePollModal } from './MsgFeatures';
import { LiquidCursor, ThemePicker } from './LiquidCursor';
import { useChatTheme } from './themes';
import { useSettings } from '@/settings/store';
import { apiSupportStatus } from '@/moderation/supportApi';
import { GiftModal, GiftMarket } from '@/gifts/SkyGifts';
import { GiftPrimeModal } from '@/gifts/GiftPrime';
import { GiftMessageCard, PrimeGiftMessageCard } from '@/gifts/GiftMessageCards';
import { AiSummarizeButton, AiTranscribeButton, AiVideoNoteButton, AiSuggestReplies, AiTranslateButton } from '@/ai/SkyAI';
// Правка черновика — запрос к серверу, а не экранный элемент, поэтому
// живёт в слое вызовов Sky AI.
import { runAiComposerAction, type AiComposerAction } from '@/ai/aiApi';
import { GroupManage } from './GroupManage';
import { useAdminStore, canDo } from './adminStore';
import { GameActivityBadge } from '@/gaming/GamingUI';
import { useGamingAccounts } from '@/gaming/accounts';
import { openProfile } from '@/profile/viewer/store';
import { ListSheet, entriesFromIds } from '@/profile/viewer/ListSheet';
import { activeFrame } from '@/profile/viewer/cosmetics';
import { activeBanner } from '@/customization/selectors';
import { MOTIFS, type MotifName } from '@/customization/Decorative';

const BannerMotif = ({ motif, accent, opacity }: { motif: MotifName; accent: string; opacity?: number }) => {
  const Motif = MOTIFS[motif];
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Motif accent={accent} opacity={opacity} />
    </div>
  );
};
import { HashInlineMenu, BotChatOverlay, BotsBrowser, InlineConfirm } from '@/bots/SkyBots';

/* -- constants ---------------------------------------------------- */
const REACTS  = ['👍','❤️','🔥','😂','😮','😢','👏'];
const EMOJIS  = [
  '😀','😂','🥲','😍','😎','🤩','🥳','😅','🤔','😬','😤','🫡','😴','🙈','💀','🤯',
  '👍','👎','❤️','🔥','✨','💯','🎉','🤝','⚡','💜','💙','💚','🎮','🚀','🌟','🏆',
];
const fmtS = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtB = (b?: number) => !b ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/**
 * Видимый ли текст в черновике — не то же самое, что просто непустой
 * после trim(). Мобильная клавиатура (автокоррекция, голосовой ввод)
 * иногда оставляет невидимые Unicode-символы (zero-width space и
 * похожие) после удаления видимого текста: поле выглядит пустым, но
 * draft.trim() всё равно truthy — кнопка «Отправить» не уступает место
 * кнопке микрофона, хотя человек её не видит и не печатает. trim() их
 * не убирает, они не входят в Unicode White_Space.
 */
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const hasVisibleText = (s: string) => s.replace(INVISIBLE_RE, '').trim().length > 0;

/* -- TG colours --------------------------------------------------- */
const TG = {
  bg:          '#0d0d0f',
  panel:       '#121215',
  input:       '#1c1c20',
  mine:        '#2b5278',
  other:       '#1c1c22',
  accent:      'var(--accent)',
  text:        'var(--t1)',
  sub:         'var(--t2)',
  border:      'var(--border)',
  read:        '#4FC3F7',
};

/* -- Rich text renderer ------------------------------------------- */
const RT = ({ t }: { t: string }) => {
  const parts = t.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|@\w+|https?:\/\/\S+)/g).filter(Boolean);
  return (
    <>{parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
      if (/^\*[^*]+\*$/.test(p))     return <em key={i}>{p.slice(1, -1)}</em>;
      if (/^`[^`]+`$/.test(p))       return <code key={i} className="rounded px-1 font-mono text-[12px]" style={{ background: 'rgba(0,0,0,0.35)' }}>{p.slice(1, -1)}</code>;
      if (/^@\w+$/.test(p))          return <span key={i} style={{ color: 'var(--accent)' }}>{p}</span>;
      if (/^https?:\/\//.test(p))    return <a key={i} href={p} target="_blank" rel="noreferrer" className="underline" style={{ color: '#6ab4f5' }}>{p}</a>;
      return <span key={i}>{p}</span>;
    })}</>
  );
};

/**
 * Заглушка вместо вложения, когда авто-загрузка выключена.
 * Нажатие качает именно этот файл — настройку не меняет.
 */
const TapToLoad = ({ onLoad, label, round = false, size }: {
  onLoad: () => void; label: string; round?: boolean; size?: number;
}) => (
  <button type="button" onClick={(e) => { e.stopPropagation(); onLoad(); }}
    className={`flex flex-col items-center justify-center gap-1.5 transition-colors hover:brightness-125 ${round ? 'rounded-full' : 'rounded-xl'}`}
    style={{
      width: size ?? 200, height: size ?? 150,
      background: 'rgba(0,0,0,0.35)', border: '1px dashed var(--border)', color: 'var(--t2)',
    }}>
    <Download size={20} />
    <span className="text-[11px]">{label}</span>
  </button>
);

/* -- Message status ticks ----------------------------------------- */
/**
 * Галочки на своих сообщениях. Настройка «Уведомления о прочтении»
 * убирает их с экрана — раньше тумблер стоял, но галочки показывались
 * всегда.
 *
 * Это про показ, а не про приватность: собеседник по-прежнему знает,
 * что сообщение прочитано. Скрыть это от него можно было бы только на
 * сервере, и настройка называлась бы иначе.
 */
const Ticks = ({ s, fromMe }: { s: string; fromMe: boolean }) => {
  const show = useSettings(st => st.settings.showReadReceipts);
  if (!fromMe || !show) return null;
  if (s === 'read')      return <CheckCheck size={15} style={{ color: '#4FC3F7' }} />;
  if (s === 'delivered') return <CheckCheck size={15} style={{ color: 'var(--t2)' }} />;
  return <Check size={15} style={{ color: 'var(--t2)' }} />;
};

/* -- Voice bubble ------------------------------------------------- */
const VoiceBubble = ({ msg, fromMe }: { msg: MessageItem; fromMe: boolean }) => {
  const { url: media, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const [playing, setPlaying] = useState(false);
  const [pct, setPct]         = useState(0);
  const [dur, setDur]         = useState(0);
  const [speed, setSpeed]     = useState(1);
  const ref = useRef<HTMLAudioElement>(null);
  const bars = useRef(Array.from({ length: 30 }, () => 20 + Math.random() * 70));
  const { getTheme } = useChatTheme();
  const _theme = getTheme();
  const accent = fromMe ? '#8ac4f0' : _theme.accent;

  if (withhold) return <TapToLoad onLoad={request} label="Загрузить голосовое" size={56} />;

  return (
    // Ширина от экрана, а не фиксированные 200–280px: пузырь сам стоит в
    // колонке max-w-[68%], и на узком телефоне жёсткий minWidth выталкивал
    // голосовое за край интерфейса.
    <div className="flex items-center gap-2.5 min-w-0 max-w-full" style={{ width: 'min(260px, 52vw)' }}>
      <audio ref={ref} src={media}
        onLoadedMetadata={e => setDur(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setPct(0); }}
        onTimeUpdate={e => { const a = e.currentTarget; if (a.duration) setPct(a.currentTime / a.duration * 100); }} />
      <button type="button"
        onClick={() => { if (!ref.current) return; playing ? ref.current.pause() : ref.current.play(); setPlaying(!playing); }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all"
        style={{ background: playing ? `${accent}30` : `${accent}18` }}>
        {playing
          ? <div className="flex items-end gap-0.5 h-3">
              {[0, 1, 2].map(i => (
                <motion.div key={i} className="w-0.5 rounded-full"
                  style={{ background: accent }}
                  animate={{ height: ['3px', '12px', '3px'] }}
                  transition={{ duration: 0.45, delay: i * 0.12, repeat: Infinity }} />
              ))}
            </div>
          : <Mic size={15} style={{ color: accent }} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="relative h-7 cursor-pointer"
          onClick={e => { if (!ref.current) return; const r = e.currentTarget.getBoundingClientRect(); ref.current.currentTime = ((e.clientX - r.left) / r.width) * (dur || 0); }}>
          <div className="absolute inset-0 flex items-center gap-px">
            {bars.current.map((h, i) => (
              <div key={i} className="flex-1 rounded-full"
                style={{ height: `${h}%`, background: (i / bars.current.length * 100) < pct ? accent : `${accent}40` }} />
            ))}
          </div>
        </div>
        <div className="mt-0.5 flex items-center justify-between">
          <p className="text-[11px]" style={{ color: fromMe ? `${accent}99` : 'var(--t2)' }}>
            {fmtS(Math.floor(dur > 0 ? pct / 100 * dur : 0))} / {fmtS(Math.floor(dur || parseInt(msg.text || '0')))}
          </p>
          <button type="button" aria-label="Скорость воспроизведения"
            onClick={() => { const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1; setSpeed(next); if (ref.current) ref.current.playbackRate = next; }}
            className="rounded-full px-1.5 text-[10px] font-bold" style={{ background: `${accent}22`, color: accent }}>
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
};

/* -- File bubble -------------------------------------------------- */
const FileBubble = ({ msg, fromMe }: { msg: MessageItem; fromMe: boolean }) => {
  const { url: media, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const { getTheme } = useChatTheme();
  const _theme2 = getTheme();
  const accent = fromMe ? '#8ac4f0' : _theme2.accent;
  return (
    <a href={media ?? '#'} download={msg.fileName}
      onClick={(e) => { if (withhold) { e.preventDefault(); request(); } }}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:brightness-110"
      style={{ background: fromMe ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.15)', minWidth: 180, maxWidth: 260 }}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}20` }}>
        <FileText size={20} style={{ color: accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: fromMe ? 'var(--t1)' : 'var(--t1)' }}>{msg.fileName}</p>
        <p className="text-[11px]" style={{ color: 'var(--t2)' }}>
          {withhold ? `${fmtB(msg.bytes)} · нажмите, чтобы загрузить` : fmtB(msg.bytes)}
        </p>
      </div>
    </a>
  );
};


/* -- Video Note (кружочек) ------------------------------------------- */
/* Какой формат запишет именно этот браузер. Раньше стоял жёсткий webm: на
   iPhone он не поддерживается, видео-кружок не записывался вовсе («нет
   доступа к камере»), а голосовое уходило с mp4-данными под именем .webm. */
const pickRecMime = (list: string[]) =>
  (typeof MediaRecorder === 'undefined' ? undefined : list.find(m => MediaRecorder.isTypeSupported(m))) ?? '';
const extFor = (mime: string, video: boolean) =>
  mime.includes('mp4') ? (video ? 'mp4' : 'm4a') : mime.includes('ogg') ? 'ogg' : 'webm';

/* -- Видео-кружок на весь экран ----------------------------------- */
const VideoNoteViewer = ({ msg, onClose, onReply, onForward, onDelete }: {
  msg: MessageItem; onClose: () => void;
  onReply: () => void; onForward: () => void; onDelete: () => void;
}) => {
  const { url: media } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const [menu, setMenu] = useState(false);
  const SIZE = typeof window === 'undefined' ? 320 : Math.min(window.innerWidth * 0.92, window.innerHeight * 0.7, 520);
  const R = SIZE / 2 - 4;
  const CIRC = 2 * Math.PI * R;

  useEffect(() => {
    const v = ref.current; if (!v) return;
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [media, onClose]);

  const toggle = () => {
    const v = ref.current; if (!v) return;
    if (v.paused) v.play().then(() => setPlaying(true)).catch(() => {}); else { v.pause(); setPlaying(false); }
  };

  const item = (label: string, run: () => void, danger = false) => (
    <button type="button" onClick={() => { setMenu(false); run(); }}
      className="flex w-full items-center px-4 py-3 text-sm text-left hover:bg-white/10"
      style={{ color: danger ? '#f87171' : '#fff' }}>{label}</button>
  );

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10050] flex flex-col items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.94)' }} onClick={onClose}>
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-3"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 10px)' }} onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Закрыть"
          className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
          <X size={18} color="#fff" />
        </button>
        <div className="relative">
          <button type="button" onClick={() => setMenu(v => !v)} aria-label="Действия"
            className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
            <MoreVertical size={18} color="#fff" />
          </button>
          {menu && (
            <div className="absolute right-0 top-12 z-10 overflow-hidden rounded-2xl shadow-2xl"
              style={{ background: 'rgba(30,32,40,0.98)', border: '1px solid rgba(255,255,255,0.12)', minWidth: 190 }}>
              {item('Ответить', () => { onReply(); onClose(); })}
              {item('Переслать', () => { onForward(); onClose(); })}
              {media && (
                <a href={media} download={msg.fileName || 'video-note'} onClick={() => setMenu(false)}
                  className="flex w-full items-center px-4 py-3 text-sm hover:bg-white/10" style={{ color: '#fff' }}>Скачать</a>
              )}
              {msg.fromMe && item('Удалить', () => { onDelete(); onClose(); }, true)}
            </div>
          )}
        </div>
      </div>

      <div className="relative cursor-pointer select-none" style={{ width: SIZE, height: SIZE }}
        onClick={e => { e.stopPropagation(); toggle(); }}>
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <video ref={ref} src={media} playsInline className="h-full w-full object-cover"
            onTimeUpdate={e => { const v = e.currentTarget; if (v.duration) setPct(v.currentTime / v.duration); }}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setPct(0); if (ref.current) ref.current.currentTime = 0; }} />
        </div>
        <svg className="pointer-events-none absolute inset-0" width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={4} />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#fff" strokeWidth={4}
            strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - pct)} strokeLinecap="round" />
        </svg>
        {!playing && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <Play size={28} fill="white" style={{ color: 'white', marginLeft: 4 }} />
            </div>
          </div>
        )}
      </div>
      <p className="mt-4 text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{msg.text}</p>
    </motion.div>,
    document.body,
  );
};

const VideoNoteBubble = ({ msg, fromMe, onOpen }: { msg: MessageItem; fromMe: boolean; onOpen: () => void }) => {
  const { url: media, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const ref  = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct]         = useState(0);
  const { getTheme } = useChatTheme();
  const _theme3 = getTheme();
  const accent = fromMe ? _theme3.accent : '#8bc8f0';
  const SIZE = 200;
  const R    = SIZE / 2 - 4;
  const CIRC = 2 * Math.PI * R;

  // Тап открывает кружок на весь экран, а не играет в 200-пиксельном круге.
  const toggle = onOpen;
  void setPlaying;

  if (!msg.mediaUrl) return (
    <div className="flex items-center justify-center rounded-full text-xs"
      style={{ width: SIZE, height: SIZE, background: 'rgba(0,0,0,0.4)', color: 'var(--t2)' }}>
      Нет видео
    </div>
  );

  if (withhold) return <TapToLoad onLoad={request} label="Загрузить видео" round size={SIZE} />;

  return (
    <div className="relative cursor-pointer select-none" style={{ width: SIZE, height: SIZE }}
      onClick={toggle}>
      {/* circular clip */}
      <div className="absolute inset-0 rounded-full overflow-hidden"
        style={{ boxShadow: `0 0 0 2.5px ${accent}55` }}>
        <video ref={ref} src={media ? `${media}#t=0.1` : media} playsInline muted preload="metadata"
          className="w-full h-full object-cover"
          onTimeUpdate={e => {
            const v = e.currentTarget;
            if (v.duration) setPct(v.currentTime / v.duration);
          }}
          onEnded={() => { setPlaying(false); setPct(0); if (ref.current) ref.current.currentTime = 0; }}
        />
      </div>

      {/* SVG progress ring */}
      <svg className="absolute inset-0 pointer-events-none" width={SIZE} height={SIZE}
        style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={3} />
        <circle cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none" stroke={accent} strokeWidth={3}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
      </svg>

      {/* Play/pause overlay */}
      <AnimatePresence>
        {!playing && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute inset-0 flex items-center justify-center rounded-full pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.35)' }}>
            <div className="grid h-12 w-12 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
              <Play size={22} fill="white" style={{ color: 'white', marginLeft: 3 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Duration */}
      <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
          {msg.text}
        </span>
      </div>
      {/* Time + ticks overlay - bottom right of circle */}
      <div className="absolute bottom-1 right-0 flex items-center gap-0.5 pointer-events-none pr-1">
        <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
          {msg.time}
        </span>
      </div>
    </div>
  );
};

/* -- Photo bubble ------------------------------------------------- */
const PhotoBubble = ({ msg }: { msg: MessageItem }) => {
  const { url: media, withhold, request } = useAttachment(safeMediaUrl(msg.mediaUrl));
  const [open, setOpen] = useState(false);
  if (withhold) return <TapToLoad onLoad={request} label="Загрузить фото" />;
  return (
    <>
      <div className="rounded-xl overflow-hidden cursor-zoom-in" style={{ maxWidth: 280 }}
        onClick={() => setOpen(true)}>
        <img src={media} alt="photo"
          className="block w-full object-cover max-h-72" style={{ maxWidth: 280 }} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.9)' }} onClick={() => setOpen(false)}>
            <img src={media} alt="photo" className="max-w-full max-h-full rounded-xl object-contain" />
            <button type="button" className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.15)' }}>
              <X size={18} className="text-white" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

/* -- Reaction bar ------------------------------------------------- */
const ReactionBar = ({ reactions, onReact, myId }: {
  reactions: MessageItem['reactions']; onReact: (e: string) => void; myId: string;
}) => {
  const [reactors, setReactors] = useState<{ emoji: string; ids: string[] } | null>(null);
  const [burst, setBurst] = useState<{ key: number; emoji: string } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const burstKey = useRef(0);

  if (!reactions?.length) return null;
  const total = reactions.filter(r => r.userIds.length > 0);
  if (!total.length) return null;

  const startPress = (emoji: string, ids: string[]) => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; setReactors({ emoji, ids }); }, 450);
  };
  const endPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };

  const react = (emoji: string, alreadyMine: boolean) => {
    onReact(emoji);
    if (!alreadyMine) { burstKey.current += 1; setBurst({ key: burstKey.current, emoji }); }
  };

  return (
    <>
      <div className="flex flex-wrap gap-1 mt-1">
        {total.map(r => {
          const mine = r.userIds.includes(myId);
          return (
            <motion.button key={r.emoji} type="button"
              whileTap={{ scale: 0.85 }}
              animate={mine ? { scale: [1, 1.28, 1] } : { scale: 1 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              onClick={() => { if (longPressed.current) { longPressed.current = false; return; } react(r.emoji, mine); }}
              onPointerDown={() => startPress(r.emoji, r.userIds)}
              onPointerUp={endPress} onPointerLeave={endPress}
              className="relative flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
              style={{
                background: mine ? 'rgba(91,155,209,0.3)' : 'var(--border)',
                border: `1px solid ${mine ? 'rgba(91,155,209,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: mine ? 'var(--accent)' : 'var(--t1)',
              }}>
              {r.emoji} {r.userIds.length > 1 && r.userIds.length}
              <AnimatePresence>
                {burst?.emoji === r.emoji && (
                  <motion.span key={burst.key}
                    initial={{ opacity: 1, y: 0, scale: 0.8 }}
                    animate={{ opacity: 0, y: -26, scale: 1.6 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.55, ease: 'easeOut' }}
                    onAnimationComplete={() => setBurst(b => (b?.key === burst.key ? null : b))}
                    className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 text-base">
                    {r.emoji}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
      {reactors && (
        <ListSheet title={`Отреагировали ${reactors.emoji}`} entries={entriesFromIds(reactors.ids)} onClose={() => setReactors(null)} />
      )}
    </>
  );
};

/* -- Emoji picker ------------------------------------------------- */
const EmojiPicker = ({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <motion.div ref={ref} initial={{ opacity: 0, scale: 0.88, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, y: 8 }}
      className="absolute bottom-full right-0 mb-2 z-40 rounded-2xl p-2.5 shadow-2xl"
      style={{ background: '#1e2c3a', border: '1px solid rgba(255,255,255,0.1)', width: 260 }}>
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map(e => (
          <button key={e} type="button" onClick={() => { onPick(e); onClose(); }}
            className="grid h-7 w-7 place-items-center rounded-lg text-base transition-all hover:scale-110 hover:bg-white/10">
            {e}
          </button>
        ))}
      </div>
    </motion.div>
  );
};

/* -- Context menu for message ------------------------------------- */
const MsgCtxMenu = ({ msg, myId, onReply, onEdit, onCopy, onForward, onPin, onFavorite, onDelete, onReport, onReact, onClose }: {
  msg: MessageItem; myId: string;
  onReply: () => void; onEdit: () => void; onCopy: () => void;
  onForward: () => void; onPin: () => void; onFavorite: () => void; onDelete: () => void;
  onReport: () => void; onReact: (e: string) => void; onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [morePicker, setMorePicker] = useState(false);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const items = [
    { icon: Reply,   label: 'Ответить',   fn: onReply },
    ...(msg.fromMe ? [{ icon: Pencil, label: 'Изменить', fn: onEdit }] : []),
    { icon: Copy,    label: 'Копировать', fn: onCopy },
    { icon: Forward, label: 'Переслать',  fn: onForward },
    { icon: Pin,     label: msg.pinned ? 'Открепить' : 'Закрепить', fn: onPin },
    { icon: Star,    label: msg.favorited ? 'Убрать из избранного' : 'В избранное', fn: onFavorite },
    ...(msg.fromMe || myId === 'acc-kutuzov'
      ? [{ icon: Trash2, label: 'Удалить', fn: onDelete, danger: true }]
      : [{ icon: Flag, label: 'Пожаловаться', fn: onReport, danger: false }]),
  ];

  return (
    <div ref={ref} className="absolute z-50" style={{ [msg.fromMe ? 'right' : 'left']: 0, bottom: '100%', marginBottom: 4 }}>
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.12 }}
        className="py-1.5 rounded-xl shadow-2xl overflow-hidden"
        style={{ minWidth: 180, background: '#1e2c3a', border: '1px solid rgba(255,255,255,0.1)' }}>
        {/* Quick react row — любой эмодзи из REACTS + кнопка «ещё» на весь список */}
        <div className="flex items-center gap-1 px-3 py-2 border-b relative" style={{ borderColor: 'var(--border)' }}>
          {REACTS.map(e => (
            <button key={e} type="button"
              className="text-lg transition-transform hover:scale-125"
              onClick={() => { onReact(e); onClose(); }}>
              {e}
            </button>
          ))}
          <button type="button" onClick={() => setMorePicker(v => !v)}
            className="ml-1 grid h-6 w-6 place-items-center rounded-full text-xs transition-transform hover:scale-110"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--t2)' }}>
            +
          </button>
          <AnimatePresence>
            {morePicker && (
              <EmojiPicker onPick={e => { onReact(e); onClose(); }} onClose={() => setMorePicker(false)} />
            )}
          </AnimatePresence>
        </div>
        {items.map(item => (
          <button key={item.label} type="button"
            onClick={() => { item.fn(); onClose(); }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
            style={{ color: (item as any).danger ? 'var(--red)' : 'var(--t1)' }}>
            <item.icon size={15} style={{ color: (item as any).danger ? 'var(--red)' : 'var(--t2)' }} /> {item.label}
          </button>
        ))}
      </motion.div>
    </div>
  );
};

/* -- Message bubble ----------------------------------------------- */
const Bubble = ({ msg, replyTo, authorName, myId, onReply, onEdit, onDelete, onPin, onFavorite, onForward, onReact, onReport, onPickSuggestion, replyCount, onOpenThread }: {
  msg: MessageItem; replyTo?: MessageItem; authorName: string; myId: string;
  onReply: () => void; onEdit: () => void; onDelete: () => void;
  onPin: () => void; onFavorite: () => void; onForward: () => void;
  onReact: (e: string) => void; onReport: () => void;
  onPickSuggestion: (text: string) => void;
  replyCount?: number; onOpenThread?: () => void;
}) => {
  const [showCtx, setShowCtx] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [hover,   setHover]   = useState(false);
  const isMobile = useIsMobile();
  const longPressTimer = useRef<number | null>(null);
  const fromMe = msg.fromMe;
  // Get theme inside Bubble so it works as module-level component
  const { getTheme } = useChatTheme();
  const theme = getTheme(msg.chatId);

  if (msg.kind === 'system') return (
    <div className="flex justify-center my-2">
      <span className="rounded-full px-4 py-1.5 text-[11px] font-medium" style={{ background: 'var(--border)', color: 'var(--t2)' }}>
        {msg.text}
      </span>
    </div>
  );

  const bubbleBg = fromMe
    ? theme.mine  // sent bubble from theme
    : theme.other; // received bubble from theme
  // Clean rounded bubbles (no tail), like MAX/modern messengers

  return (
    <div data-compact-row className={`flex mb-0.5 ${fromMe ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => { if (!isMobile) setHover(true); }} onMouseLeave={() => { if (!isMobile) setHover(false); }}>
      <div className="relative max-w-[68%] group">
        {/* hover actions — только на десктопе, на тач-экранах нет надёжного hover */}
        <AnimatePresence>
          {hover && !showCtx && !isMobile && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className={`absolute top-1 z-10 flex items-center gap-0.5 ${fromMe ? 'right-full mr-1.5' : 'left-full ml-1.5'}`}>
              <button type="button" onClick={onReply}
                className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10"
                style={{ background: 'rgba(14,22,33,0.85)' }}>
                <Reply size={13} style={{ color: 'var(--t2)' }} />
              </button>
              <button type="button" onClick={() => setShowCtx(true)}
                className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10"
                style={{ background: 'rgba(14,22,33,0.85)' }}>
                <MoreVertical size={13} style={{ color: 'var(--t2)' }} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* context menu */}
        <AnimatePresence>
          {showCtx && (
            <MsgCtxMenu msg={msg} myId={myId}
              onReply={() => { onReply(); setShowCtx(false); }}
              onEdit={() => { onEdit(); setShowCtx(false); }}
              onCopy={() => { navigator.clipboard.writeText(msg.text); setShowCtx(false); }}
              onForward={() => { onForward(); setShowCtx(false); }}
              onPin={() => { onPin(); setShowCtx(false); }}
              onFavorite={() => { onFavorite(); setShowCtx(false); }}
              onDelete={() => { onDelete(); setShowCtx(false); }}
              onReport={() => { onReport(); setShowCtx(false); }}
              onReact={e => onReact(e)}
              onClose={() => setShowCtx(false)} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {noteOpen && msg.kind === 'video-note' && (
            <VideoNoteViewer msg={msg} onClose={() => setNoteOpen(false)}
              onReply={onReply} onForward={onForward} onDelete={onDelete}/>
          )}
        </AnimatePresence>

        {/* author label for groups */}
        {!fromMe && authorName && (
          <button type="button" onClick={() => openProfile(msg.authorId)}
            className="text-xs font-semibold mb-0.5 px-1 text-left sky-hover-lift" style={{ color: theme.accent }}>
            {authorName}
          </button>
        )}

        {/* reply quote */}
        {replyTo && (
          <div className={`rounded-xl rounded-b-none px-3 py-2 mb-0.5 border-l-[3px]`}
            style={{ background: fromMe ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.15)', borderColor: theme.accent }}>
            <p className="text-xs font-semibold" style={{ color: theme.accent }}>
              {replyTo.fromMe ? 'Вы' : authorName}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--t2)' }}>
              {replyTo.kind === 'photo' ? 'Фото' : replyTo.kind === 'voice' ? 'Голосовое' : replyTo.kind === 'video-note' ? 'Видео-кружок' : replyTo.text?.slice(0, 60)}
            </p>
          </div>
        )}

        {/* video-note renders as standalone circle, no bubble */}
        {msg.kind === 'video-note' && (
          <div className="relative"
            onTouchStart={isMobile ? () => { longPressTimer.current = window.setTimeout(() => setShowCtx(true), 420); } : undefined}
            onTouchEnd={isMobile ? () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); } : undefined}
            onTouchMove={isMobile ? () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); } : undefined}>
            <VideoNoteBubble msg={msg} fromMe={fromMe} onOpen={() => setNoteOpen(true)}/>
            {/* На тач-экранах нет hover, а долгое нажатие не очевидно: кнопка
                действий всегда на виду. */}
            <button type="button" aria-label="Действия" onClick={() => setShowCtx(true)}
              className="absolute right-0 top-0 grid h-8 w-8 place-items-center rounded-full"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
              <MoreVertical size={15} color="#fff" />
            </button>
            {/* Адрес записи нужен по-настоящему: расшифровка теперь
                настоящая, а не заготовленный текст после паузы. */}
            <AiVideoNoteButton duration={parseInt(msg.text||'0')||15} msgId={msg.id} mediaUrl={msg.mediaUrl}/>
          </div>
        )}

        {/* bubble (all other kinds) */}
        {msg.kind !== 'video-note' && (
        <div className={`relative px-3.5 py-2.5`}
          style={{
            borderRadius: fromMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            background: bubbleBg,
            boxShadow: fromMe ? '0 2px 8px rgba(37,99,235,0.3)' : 'none',
          }}
          onTouchStart={isMobile ? () => {
            longPressTimer.current = window.setTimeout(() => setShowCtx(true), 420);
          } : undefined}
          onTouchEnd={isMobile ? () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); } : undefined}
          onTouchMove={isMobile ? () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); } : undefined}>

          {/* content */}
          {msg.kind === 'photo'      && <PhotoBubble msg={msg} />}
          {msg.kind === 'voice'      && (
            <div className="min-w-0 max-w-full">
              <div className="flex items-start gap-1">
                <VoiceBubble msg={msg} fromMe={fromMe}/>
                <button type="button" aria-label="Действия" onClick={() => setShowCtx(true)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ color: 'var(--t2)' }}>
                  <MoreVertical size={15} />
                </button>
              </div>
              <AiTranscribeButton duration={parseInt(msg.text||'0')||30} msgId={msg.id} mediaUrl={msg.mediaUrl}/>
            </div>
          )}
          {msg.kind === 'file'       && <FileBubble  msg={msg} fromMe={fromMe} />}
          {msg.kind === 'pet'   && (() => {
            try {
              // typeId/petName/petColor присылаются прямо в сообщении (не из
              // локального каталога): отправитель и получатель могут быть
              // разными людьми, а значит разными владельцами питомцев —
              // инстанс отправителя получателю не виден и не должен быть.
              const d = JSON.parse(msg.text);
              return <PetBubble typeId={d.typeId ?? d.petId ?? ''} mood={d.mood} sound={d.sound} petName={d.petName ?? ''} petColor={d.petColor ?? theme.accent} />;
            } catch { return null; }
          })()}
          {msg.kind === 'gift' && (
            msg.giftInstanceId
              ? <GiftMessageCard instanceId={msg.giftInstanceId} fromMe={fromMe}/>
              : null
          )}
          {msg.kind === 'prime_gift' && (
            msg.primeGiftInstanceId
              ? <PrimeGiftMessageCard instanceId={msg.primeGiftInstanceId} fromMe={fromMe}/>
              : null
          )}
          {msg.kind === 'text' && !msg.deleted && (() => {
            if (msg.spoiler) return <SpoilerText text={msg.text} color={theme.otherText}/>;
            if (msg.once)    return <OnceViewText msg={msg} fromMe={fromMe} color={theme.otherText}/>;
            return (
              <div>
                <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: theme.otherText }}>
                  <RT t={msg.text}/>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <AiSummarizeButton text={msg.text} minLength={300}/>
                  <AiTranslateButton text={msg.text}/>
                </div>
                {!fromMe && <AiSuggestReplies text={msg.text} onPick={onPickSuggestion}/>}
              </div>
            );
          })()}
          {msg.kind === 'poll' && msg.poll && (
            <PollBubble poll={msg.poll} msgId={msg.id} fromMe={fromMe}/>
          )}
          {msg.deleted && (
            <p className="text-[13px] italic flex items-center gap-1.5" style={{ color: 'var(--t2)' }}><Ban size={13} /> Сообщение удалено</p>
          )}

          {/* time + status row */}
          {msg.selfDestruct && msg.selfDestruct > 0 && !msg.deleted && (
            <SelfDestructTimer msg={msg} fromMe={fromMe}/>
          )}
          <div className={`flex items-center gap-1 mt-1 ${fromMe ? 'justify-end' : 'justify-start'}`}>
            {msg.isSilent && <BellOff size={10} style={{ color:'var(--t2)' }}/>}
            {msg.editedAt && <span className="text-[10px]" style={{ color: fromMe ? 'rgba(255,255,255,0.55)' : 'var(--t2)' }}>изм.</span>}
            {/* Охват записи канала: считает сервер, и считает разных
                читателей, а не открытия. */}
            {typeof msg.views === 'number' && msg.views > 0 && (
              <span className="flex items-center gap-0.5 text-[11px]"
                style={{ color: fromMe ? 'rgba(255,255,255,0.5)' : 'var(--t2)' }}>
                <Eye size={10} /> {msg.views}
              </span>
            )}
            <span className="text-[11px]" style={{ color: fromMe ? 'rgba(255,255,255,0.5)' : 'var(--t2)' }}>{msg.time}</span>
            <Ticks s={msg.status} fromMe={fromMe} />
          </div>
        </div>
        )}

        {/* reactions */}
        {msg.reactions?.some(r => r.userIds.length > 0) && (
          <ReactionBar reactions={msg.reactions} onReact={onReact} myId={myId} />
        )}
        {!!replyCount && (
          <button type="button" onClick={onOpenThread}
            className="mt-1 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:brightness-110"
            style={{ background: 'rgba(91,155,209,0.14)', color: 'var(--accent)' }}>
            <MessagesSquare size={11}/> {replyCount} {replyCount === 1 ? 'ответ' : replyCount < 5 ? 'ответа' : 'ответов'}
          </button>
        )}
      </div>
    </div>
  );
};

/* -- Report modal ------------------------------------------------- */
const ReportModal = ({ chatId, onClose }: { chatId: string; onClose: () => void }) => {
  const { addReport } = useMessengerStore();
  const { currentUserId } = useAuthStore();
  const [reason, setReason] = useState('');
  const REASONS = ['Спам', 'Оскорбления', 'Мошенничество', 'Нарушение правил', 'Другое'];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
        className="w-full max-w-xs rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-l1)' }}
        onClick={e => e.stopPropagation()}>
        <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="font-semibold" style={{ color: 'var(--t1)' }}>Пожаловаться</p>
        </div>
        <div className="px-4 py-3 space-y-1">
          {REASONS.map(r => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5"
              style={{ background: reason === r ? 'rgba(91,155,209,0.15)' : 'transparent' }}>
              <div className="h-4 w-4 rounded-full border flex items-center justify-center shrink-0"
                style={{ borderColor: reason === r ? 'var(--accent)' : 'var(--t2)' }}>
                {reason === r && <div className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />}
              </div>
              <span className="text-sm" style={{ color: 'var(--t1)' }}>{r}</span>
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: 'var(--border)', color: 'var(--t1)' }}>Отмена</button>
          <button type="button" disabled={!reason}
            onClick={() => { addReport({ chatId, reporterId: currentUserId ?? '', reason, comment: '' }); onClose(); }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>Отправить</button>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* ===================================================================
   ChatWindow  -  main component
=================================================================== */
export const ChatWindow = ({ onBack }: { onBack?: () => void } = {}) => {
  const isMobile = useIsMobile();
  const {
    chats, messages, activeChatId, sendMessage, react, addReport,
    blockUser: blockChatUser, unblockUser: unblockChatUser, loadOlder, leaveChat: leaveChatOnServer,
    replyToId, setReplyTo, editingId, startEdit,
    editMessage, deleteMessage, pinMessage, forward,
    typing: typingMap, setTyping, markRead, blocked,
    sendScheduledNow, cancelScheduled, toggleFavoriteMessage,
    drafts, setChatDraft, quickReplies, addQuickReply, removeQuickReply, markChannelViewed,
  } = useMessengerStore();
  const { accounts, currentUserId } = useAuthStore();
  // Имена собеседников приходят с сервера вместе с чатами: локальный
  // список accounts знает только тех, кто заведён в этом браузере, и
  // реальный участник группы подписывался бы в нём «Пользователь».
  const people = useMessengerStore(s => s.people);
  const nameOf = (id?: string) =>
    (id && (accounts.find(a => a.id === id)?.name ?? people[id]?.name)) || '';
  const startCall = useCallStore(s => s.startCall);

  const [draft, setDraft]           = useState('');
  const draftRef                    = useRef('');
  const [showHash, setShowHash]     = useState(false);
  const [hashQ, setHashQ]           = useState('');
  const [openBot, setOpenBot]       = useState<any>(null);
  /* Вызов inline-бота ждёт подтверждения человека: бот предлагает
     текст, отправляет его сам человек. Здесь лежит то, что он набрал. */
  const [inlineAsk, setInlineAsk]   = useState<{ trigger: string; query: string } | null>(null);
  const [recording, setRecording]   = useState(false);
  const [recKind,    setRecKind]     = useState<'voice'|'video-note'>('voice');
  const [recSec, setRecSec]         = useState(0);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState<string | null>(null);
  const [uploadPct, setUploadPct]   = useState(0);
  const [showScroll, setShowScroll] = useState(false);
  const [showInfo,   setShowInfo]   = useState(false);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showEmoji,  setShowEmoji]  = useState(false);
  const [showPets,   setShowPets]   = useState(false);
  const [showGifts,  setShowGifts]  = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [showTheme,  setShowTheme]  = useState(false);
  const [showMsgOpts, setShowMsgOpts] = useState(false);
  const [showGiftPrime, setShowGiftPrime] = useState(false);
  const [showPoll,    setShowPoll]    = useState(false);
  const [msgOptions,  setMsgOptions]  = useState({
    once: false, spoiler: false, silent: false,
    selfDestruct: 0, scheduled: false, scheduledAt: '',
  });
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const { getTheme } = useChatTheme();
  const theme = getTheme(activeChatId ?? undefined);
  const [showAttach, setShowAttach] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [addingQuickReply, setAddingQuickReply] = useState(false);
  const [newQuickReply, setNewQuickReply] = useState('');
  const [recError,   setRecError]   = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ,    setSearchQ]    = useState('');
  type SearchFilter = 'all' | 'photo' | 'video' | 'file' | 'voice' | 'link';
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all');
  const [showScheduled, setShowScheduled] = useState(false);

  const taRef     = useRef<HTMLTextAreaElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const msgRefs   = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRef   = useRef<HTMLInputElement>(null);
  const imgRef    = useRef<HTMLInputElement>(null);
  const camRef    = useRef<HTMLInputElement>(null);
  const recRef      = useRef<MediaRecorder | null>(null);
  const previewRef  = useRef<HTMLVideoElement | null>(null);

  // Attach camera stream to preview element after React renders it
  // This runs AFTER the video element is mounted in DOM (recording && recKind==='video-note')
  useEffect(() => {
    if (recording && recKind === 'video-note' && previewRef.current && recStream.current) {
      const vid = previewRef.current;
      vid.srcObject = recStream.current;
      // Force play - some browsers need explicit play after srcObject assignment
      const tryPlay = () => {
        const p = vid.play();
        if (p) p.catch(() => {});
      };
      if (vid.readyState >= 1) { tryPlay(); }
      else { vid.onloadedmetadata = () => tryPlay(); }
    }
  }, [recording, recKind]);
  const recStream = useRef<MediaStream | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const recTimer  = useRef<number | null>(null);
  const recSecRef = useRef(0);
  const cancelRef = useRef(false);
  const typTimer  = useRef<number | null>(null);

  const chat     = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
  const chatMsgs = useMemo(() => messages.filter(m => m.chatId === activeChatId && !m.isScheduled).sort((a, b) => a.timestamp - b.timestamp), [messages, activeChatId]);
  const scheduledMsgs = useMemo(() => messages.filter(m => m.chatId === activeChatId && m.isScheduled).sort((a, b) => (a.scheduledAt??0) - (b.scheduledAt??0)), [messages, activeChatId]);
  const channelModBlocked  = useModerationStore(s => chat ? s.isBlocked('messenger-channel', chat.id) : false);
  const channelBlockReason = useModerationStore(s => chat ? s.blockReason('messenger-channel', chat.id) : undefined);
  const channelWarning     = useModerationStore(s => chat ? s.warningFor('messenger-channel', chat.id) : null);
  const channelAcked       = useModerationStore(s => chat ? s.isAcknowledged('messenger-channel', chat.id) : true);
  const msgMap   = useMemo(() => Object.fromEntries(chatMsgs.map(m => [m.id, m])), [chatMsgs]);
  const replyCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of chatMsgs) { if (m.replyToId) map[m.replyToId] = (map[m.replyToId] ?? 0) + 1; }
    return map;
  }, [chatMsgs]);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState('');
  const [showGroupManage, setShowGroupManage] = useState(false);
  // Управление можно позвать из списка чатов удержанием — панель живёт
  // здесь, поэтому просьба приходит через общий стор.
  const manageFor = useAdminStore(s => s.manageFor);
  const clearManage = useAdminStore(s => s.openManage);
  // Настройки этого устройства: Enter для отправки, «печатает…»,
  // галочки прочтения, авто-загрузка медиа.
  const appSettings = useSettings(st => st.settings);
  // «Запрет говорить» выдаёт администратор, и знает о нём сервер.
  // Показываем словами, иначе человек просто упирался бы в отказы на
  // каждое голосовое и не понимал, почему.
  const [voiceBlock, setVoiceBlock] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => { void apiSupportStatus().then(r => {
      if (alive) setVoiceBlock(r.restrictions.mutedUntil ?? null);
    }); };
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // Отказ сервера показываем словами и гасим сами.
  const postNotice = useAdminStore(s => s.notice);
  const clearNotice = useAdminStore(s => s.notify);
  useEffect(() => {
    if (!postNotice) return;
    const t = setTimeout(() => clearNotice(null), 4000);
    return () => clearTimeout(t);
  }, [postNotice, clearNotice]);
  useEffect(() => {
    if (manageFor && manageFor === activeChatId) { setShowGroupManage(true); clearManage(null); }
  }, [manageFor, activeChatId, clearManage]);

  const pinned   = useMemo(() => chatMsgs.filter(m => m.pinned && !m.deleted), [chatMsgs]);
  const loadingOlder = useMessengerStore(s => s.loadingOlder);
  const markViewed = useAdminStore(s => s.markViewed);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // В канале считаем охват: сообщаем серверу, какие записи мы увидели.
  // Он считает разных читателей, поэтому перечитывание ничего не
  // накручивает.
  useEffect(() => {
    if (chat?.type !== 'channel') return;
    const unseen = chatMsgs.filter(m => !m.fromMe && !m.deleted && m.kind !== 'system').map(m => m.id);
    if (unseen.length === 0) return;
    const t = setTimeout(() => markViewed(chat.id, unseen.slice(-100)), 900);
    return () => clearTimeout(t);
  }, [chat?.id, chat?.type, chatMsgs.length, markViewed]);

  useLayoutEffect(() => {
    const el = listRef.current;
    const keep = keepScroll.current;
    if (!el || !keep) return;
    if (el.scrollHeight === keep.before) return;
    el.scrollTop = keep.top + (el.scrollHeight - keep.before);
    keepScroll.current = null;
  }, [chatMsgs.length]);
  const typing   = typingMap[activeChatId] ?? [];
  const replyMsg = replyToId ? msgMap[replyToId] : null;
  const editMsg  = editingId ? msgMap[editingId] : null;
  const myId     = currentUserId ?? '';
  // Дописанная сверху страница смещает ленту: запоминаем высоту до
  // вставки, чтобы вернуть взгляд на то же сообщение.
  const keepScroll = useRef<{ before: number; top: number } | null>(null);
  // Запрет ведёт сервер и хранит по идентификатору профиля: ник можно
  // сменить, а запрет от этого сниматься не должен.
  const peerIdForBlock = chat?.type === 'direct'
    ? (chat.participants ?? []).find(p => p !== myId) : undefined;
  const isBlocked = !!peerIdForBlock && blocked.includes(peerIdForBlock);
  const isPrime = accounts.find(a => a.id === currentUserId)?.isPrime ?? false;
  const [aiComposerBusy, setAiComposerBusy] = useState<AiComposerAction | null>(null);
  const [dictating, setDictating] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleDictation = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript;
      if (chunk.trim()) onDraftChange((draftRef.current ? draftRef.current + ' ' : '') + chunk.trim());
    };
    rec.onerror = () => { setDictating(false); };
    rec.onend = () => { setDictating(false); };
    recognitionRef.current = rec;
    rec.start();
    setDictating(true);
  };

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  const URL_RE = /https?:\/\/[^\s]+/i;
  const filteredMsgs = useMemo(() => {
    let list = chatMsgs;
    if (searchFilter !== 'all') {
      list = list.filter(m => {
        if (searchFilter === 'link') return URL_RE.test(m.text || '');
        if (searchFilter === 'video') return m.kind === 'video-note' || m.mimeType?.startsWith('video/');
        if (searchFilter === 'file')  return m.kind === 'file';
        if (searchFilter === 'photo') return m.kind === 'photo';
        if (searchFilter === 'voice') return m.kind === 'voice';
        return true;
      });
    }
    if (!searchQ.trim()) return list;
    const q = searchQ.toLowerCase();
    return list.filter(m => m.text.toLowerCase().includes(q) || m.fileName?.toLowerCase().includes(q));
  }, [chatMsgs, searchQ, searchFilter]);

  /* scroll to bottom on new messages */
  const prevLen = useRef(0);
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    const newMsgs = chatMsgs.length > prevLen.current;
    prevLen.current = chatMsgs.length;
    if (near || newMsgs) el.scrollTo({ top: el.scrollHeight, behavior: newMsgs ? 'smooth' : 'auto' });
  }, [chatMsgs.length]);

  const prevChatIdRef = useRef(activeChatId);
  useEffect(() => {
    const prevId = prevChatIdRef.current;
    if (prevId !== activeChatId) {
      setChatDraft(prevId, draftRef.current);
      const restored = useMessengerStore.getState().drafts[activeChatId] ?? '';
      setDraft(restored); draftRef.current = restored;
      prevChatIdRef.current = activeChatId;
    }
    markRead(activeChatId);
    if (chat?.type === 'channel') markChannelViewed(activeChatId);
  }, [activeChatId]);
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  /* cleanup on unmount */
  const blobUrls = useRef<string[]>([]);
  useEffect(() => () => {
    if (recTimer.current) clearInterval(recTimer.current);
    if (typTimer.current) clearTimeout(typTimer.current);
    recStream.current?.getTracks().forEach(t => t.stop());
    // revoke all blob URLs created in this chat session
    blobUrls.current.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    // сохраняем черновик текущего чата при выходе из мессенджера
    useMessengerStore.getState().setChatDraft(prevChatIdRef.current, draftRef.current);
  }, []);

  /* submit */
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = draftRef.current.trim();
    const { editingId: eid, messages: msgs } = useMessengerStore.getState();
    const em = eid ? msgs.find(m => m.id === eid) : null;
    if ((!hasVisibleText(t) && !em) || isBlocked) return;
    if (em) {
      editMessage(em.id, t); broadcast.edit(em.id, t, 'изм.'); startEdit(null);
    } else {
      // ── Bot command detection (#commandname @target) ──────────────
      /*
       * Разбор вызова «#триггер …».
       *
       * Набор символов тот же, что принимает сервер при настройке
       * триггера: латиница, цифры, подчёркивание и кириллица. \w сюда
       * не годится — он не знает кириллицы, и «#погода» никогда бы не
       * сработала, хотя завести такой триггер сервер позволяет.
       */
      const botCmdMatch = t.match(/^#([A-Za-z0-9_А-Яа-яЁё]+)(?:\s+(@\S+))?(.*)$/);
      if (botCmdMatch) {
        const [, cmdName, mention, rest] = botCmdMatch;
        const botTexts: Record<string, (m?: string, r?: string) => string> = {
          hug:      (m, r) => `${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} отправил${r??''} виртуальные обнимашки ${m??'всем'} 🤗`,
          kiss:     (m, r) => `${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} отправил${r??''} воздушный поцелуй ${m??'всем'} 😘`,
          gift:     (m, r) => `🎁 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} подарил${r??''} подарок ${m??'всем'}!`,
          wave:     (m, r) => `👋 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} машет рукой ${m??''}`,
          congrats: (m, r) => `🎉 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} поздравляет ${m??'всех'}!`,
          slap:     (m, r) => `👋 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} шлёпает ${m??'кого-то'} по плечу`,
          dance:    (m)    => `💃 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} танцует ${m??''}`,
          dice:     ()     => `🎲 Выпало: **${Math.ceil(Math.random()*6)}**`,
          flip:     ()     => `🪙 ${Math.random()>.5 ? '⬆️ Орёл' : '⬇️ Решка'}`,
          love:     (m)    => `❤️ ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} любит ${m??'всех'}`,
          lol:      ()     => `😂 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} смеётся до слёз`,
          shrug:    ()     => `🤷 ${accounts.find(a=>a.id===currentUserId)?.name ?? 'Кто-то'} пожимает плечами`,
        };
        const handler = botTexts[cmdName.toLowerCase()];
        if (handler) {
          const botText = handler(mention, rest.trim() ? ` (${rest.trim()})` : undefined);
          const msg = sendMessage({ text: botText, kind: 'text' });
          if (msg) broadcast.message(msg);
          setDraft(''); draftRef.current = ''; setReplyTo(null);
          requestAnimationFrame(() => taRef.current?.focus());
          return;
        }
        /*
         * Не встроенная команда — значит это вызов inline-бота.
         *
         * Ничего не отправляем: спрашиваем сервер бота и показываем
         * человеку, что тот предложил. Отправит он сам, нажав кнопку в
         * окне подтверждения, — и сообщение уйдёт от его имени.
         */
        setInlineAsk({
          trigger: cmdName,
          query: `${mention ? `${mention} ` : ''}${rest}`.trim(),
        });
        setDraft(''); draftRef.current = '';
        return;
      }
      // ── Normal message ────────────────────────────────────────────
      const extraFields: Record<string,any> = {};
      if (msgOptions.once)         extraFields.once        = true;
      if (msgOptions.spoiler)      extraFields.spoiler     = true;
      if (msgOptions.silent)       extraFields.isSilent    = true;
      if (msgOptions.selfDestruct) {
        extraFields.selfDestruct = msgOptions.selfDestruct;
        extraFields.destroyAt    = Date.now() + msgOptions.selfDestruct*1000;
      }
      if (msgOptions.scheduled && msgOptions.scheduledAt) {
        const ts = new Date(msgOptions.scheduledAt).getTime();
        if (!isNaN(ts) && ts > Date.now()) extraFields.scheduledAt = ts;
      }
      const msg = sendMessage({ text: t, kind: 'text', ...extraFields });
      if (msg) {
        broadcast.message(msg);
        // Монетки питомцу за переписку
        try {
          const _pc = JSON.parse(localStorage.getItem('sky:pet:coins:v1') || '{}');
          _pc[currentUserId ?? ''] = (_pc[currentUserId ?? ''] ?? 0) + 1;
          localStorage.setItem('sky:pet:coins:v1', JSON.stringify(_pc));
        } catch {}
      }
    }
    setDraft(''); draftRef.current = ''; setReplyTo(null);
    setChatDraft(activeChatId, '');
    setMsgOptions({ once: false, spoiler: false, silent: false, selfDestruct: 0, scheduled: false, scheduledAt: '' });
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // «Enter для отправки» — настройка этого устройства. Выключена —
    // Enter переносит строку, а отправляет только кнопка. Раньше
    // тумблер стоял в настройках и не значил ничего.
    if (e.key === 'Enter' && !e.shiftKey && appSettings.enterToSend) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { setReplyTo(null); startEdit(null); setDraft(''); draftRef.current = ''; }
  };

  const onDraftChange = (v: string) => {
    setDraft(v); draftRef.current = v;
    if (!chat) return;
    const me = useAuthStore.getState().accounts.find(a => a.id === myId);
    const uname = me?.username ?? people[myId ?? '']?.username ?? 'Вы';
    // Выключенный тумблер «Печатает…» означает «не сообщать о себе».
    // Скрыть можно только своё: чужой статус решает чужое устройство.
    const tellTyping = appSettings.showTyping;
    if (tellTyping) { setTyping(chat.id, uname, true); broadcast.typing(chat.id, uname, true); }
    if (typTimer.current) clearTimeout(typTimer.current);
    typTimer.current = window.setTimeout(() => {
      if (tellTyping) { setTyping(chat.id, uname, false); broadcast.typing(chat.id, uname, false); }
      setChatDraft(chat.id, draftRef.current); // debounced сохранение черновика
    }, 1500);
    // Inline # bot menu detection
    const lastHash = v.lastIndexOf('#');
    if (lastHash >= 0 && (lastHash === 0 || v[lastHash-1] === ' ' || v[lastHash-1] === '\n')) {
      setHashQ(v.slice(lastHash+1));
      setShowHash(true);
    } else {
      setShowHash(false);
      setHashQ('');
    }
  };

  /**
   * Отправка вложения: сперва файл уходит на сервер, и только потом
   * рядом с сообщением появляется ссылка на него.
   *
   * Раньше здесь была ссылка вида blob:, действительная ровно в той
   * вкладке, где файл выбрали: получатель не видел ничего, и на другом
   * устройстве отправителя тоже ничего не было.
   */
  const sendAttachment = async (
    file: File | Blob,
    { kind, text, fileName }: { kind: MessageKind; text: string; fileName: string },
  ) => {
    if (!chat) return;
    if (file.size > MAX_FILE_BYTES) {
      setRecError('Файл больше 10 МБ'); setTimeout(() => setRecError(''), 3000);
      return;
    }
    const asFile = file instanceof File ? file : new File([file], fileName, { type: file.type });
    setUploading(fileName); setUploadPct(20);

    const res = await apiUploadFile(chat.id, asFile);
    if (!res.ok || !res.data?.file) {
      setUploading(null); setUploadPct(0);
      setRecError(res.reason ?? 'Не удалось отправить файл');
      setTimeout(() => setRecError(''), 3500);
      return;
    }
    setUploadPct(90);

    // Локальная ссылка нужна только чтобы отправитель сразу видел
    // вложение; в сообщение она не уходит — сервер соберёт адрес сам.
    const preview = URL.createObjectURL(asFile);
    blobUrls.current.push(preview);
    const m = sendMessage({
      text, kind, mediaUrl: preview, fileName,
      bytes: asFile.size, mimeType: res.data.file.mime,
    });
    if (m) broadcast.message({ ...m, fileId: res.data.file.id } as any);
    setUploadPct(100);
    setTimeout(() => { setUploading(null); setUploadPct(0); }, 400);
  };

  const sendFile = async (file: File) => {
    const isMedia = file.type.startsWith('image/') || file.type.startsWith('video/');
    await sendAttachment(file, {
      kind: isMedia ? 'photo' : 'file', text: file.name, fileName: file.name,
    });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStream.current = stream; recChunks.current = []; cancelRef.current = false;
      const mime = pickRecMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']);
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = e => { if (e.data.size > 0) recChunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (!cancelRef.current && recChunks.current.length) {
          const real = rec.mimeType || mime || 'audio/webm';
          const blob = new Blob(recChunks.current, { type: real.split(';')[0] });
          const sec = recSecRef.current;
          void sendAttachment(blob, {
            kind: 'voice', text: fmtS(sec), fileName: `voice-${Date.now()}.${extFor(real, false)}`,
          });
        }
        recStream.current = null; setRecSec(0); recSecRef.current = 0;
      };
      rec.start(); recRef.current = rec; setRecKind('voice'); setRecording(true);
      recTimer.current = window.setInterval(() => { recSecRef.current++; setRecSec(s => s + 1); }, 1000);
    } catch { setRecError('Нет доступа к микрофону'); setTimeout(() => setRecError(''), 3000); }
  };

  const stopRec   = () => { if (recTimer.current) clearInterval(recTimer.current); setRecording(false); recRef.current?.stop(); };

  /* Video note (кружочек) */
  const startVideoNote = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 400, height: 400 }, audio: true });
      recStream.current = stream; recChunks.current = []; cancelRef.current = false;
      const mime = pickRecMime(['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']);
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = e => { if (e.data.size > 0) recChunks.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (!cancelRef.current && recChunks.current.length) {
          const real = rec.mimeType || mime || 'video/webm';
          const blob = new Blob(recChunks.current, { type: real.split(';')[0] });
          const sec = recSecRef.current;
          void sendAttachment(blob, {
            kind: 'video-note', text: fmtS(sec), fileName: `video-note-${Date.now()}.${extFor(real, true)}`,
          });
        }
        recStream.current = null; setRecSec(0); recSecRef.current = 0;
      };
      rec.start(); recRef.current = rec; setRecKind('video-note'); setRecording(true);
      // srcObject attached in useEffect after React renders the <video> element
      recTimer.current = window.setInterval(() => { recSecRef.current++; setRecSec(s => s + 1); }, 1000);
    } catch { setRecError('Нет доступа к камере'); setTimeout(() => setRecError(''), 3000); }
  };
  const cancelRec = () => {
    cancelRef.current = true;
    if (recTimer.current) clearInterval(recTimer.current);
    recRef.current?.stop(); recStream.current?.getTracks().forEach(t => t.stop());
    if (previewRef.current) { previewRef.current.srcObject = null; }
    setRecording(false); setRecSec(0); recSecRef.current = 0;
  };

  const jumpTo = (id: string) => {
    const el = msgRefs.current[id]; if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.3s';
    el.style.background = 'rgba(91,155,209,0.2)';
    setTimeout(() => { if (el) el.style.background = ''; }, 1400);
  };

  // Настройки чата читаем до возврата «чат не выбран»: хук, вызванный
  // через раз, роняет весь мессенджер.
  const chatSettings = useAdminStore(s => s.settings[chat?.id ?? '']);

  if (!chat) return (
    <div className="flex flex-1 items-center justify-center" style={{ background: '#0d0d0f' }}>
      <div className="text-center space-y-4">
        <div className="grid h-20 w-20 place-items-center rounded-full mx-auto"
          style={{ background: 'rgba(91,155,209,0.08)', border: '1px solid rgba(91,155,209,0.15)' }}>
          <MessagesSquare size={34} style={{ color:'var(--t3)' }}/>
        </div>
        <div>
          <p className="text-base font-semibold" style={{ color: 'var(--t1)' }}>Sky Messenger</p>
          <p className="text-sm mt-1" style={{ color: 'var(--t2)' }}>Выберите чат чтобы начать</p>
        </div>
      </div>
    </div>
  );

  /* peer id for calls */
  const peerId   = chat.type === 'direct' ? (chat.participants?.find(p => p !== myId) ?? chat.id) : chat.id;
  const peerAcc  = accounts.find(a => a.id === peerId);
  const peerName = peerAcc?.name ?? chat.name;
  const peerAv   = (peerAcc?.name?.[0] ?? chat.avatar?.[0] ?? '?').toUpperCase();
  const peerFrame = activeFrame(peerAcc);
  const peerBanner = activeBanner(peerAcc);

  // Право писать: у канала — только у тех, кто им управляет; у группы
  // ещё и настройка «пишут только администраторы». Решает всё равно
  // сервер, здесь мы лишь не показываем поле, которое ответит отказом.
  const runsChat = ['owner', 'admin', 'moderator'].includes(chat.myRole ?? 'member');
  const canPost = chat.type === 'direct' ? true
    : chat.type === 'channel' ? runsChat
    : (chatSettings?.whoCanPost === 'admins' ? runsChat : true);

  if (chat.type === 'channel') {
    const modBlocked = channelModBlocked;
    if (modBlocked) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6" style={{ background: '#0d0d0f' }}>
          <BlockedChannelBadge reason={channelBlockReason}/>
        </div>
      );
    }
    if (channelWarning && !channelAcked) {
      return (
        <ContentWarningGate domain="messenger-channel" targetId={chat.id}>
          <></>
        </ContentWarningGate>
      );
    }
  }

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: theme.bg, backgroundImage: theme.bgImage !== 'none' ? theme.bgImage : undefined, backgroundSize: theme.bgSize }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) sendFile(f); }}>

      {/* Drag overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-50 grid place-items-center rounded-lg border-2 border-dashed"
            style={{ background: 'var(--accent-bg)', borderColor: 'var(--accent)' }}>
            <div className="text-center">
              
              <p className="font-semibold" style={{ color: theme.accent }}>Отпустите для отправки</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Header --------------------------------------------------- */}
      <div className="shrink-0 px-2 sm:px-4 pt-2 sm:pt-3"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <header className="flex items-center gap-2">
          {isMobile && onBack && (
            <button type="button" onClick={onBack}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full sky-glass transition-colors hover:bg-white/10"
              style={{ color: 'var(--t1)', background: 'var(--bg-l2)' }}><ChevronLeft size={18} /></button>
          )}

          <div className="relative flex-1 min-w-0 flex items-center gap-2 sm:gap-3 rounded-full sky-glass overflow-hidden pl-1.5 pr-1.5 py-1.5"
            style={{ background: chat.type === 'direct' ? peerBanner.background : 'rgba(20,20,26,0.55)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {chat.type === 'direct' && peerBanner.id !== 'banner-default' && (
              <BannerMotif motif={peerBanner.motif} accent={peerBanner.accent2 ?? peerBanner.accent} opacity={peerBanner.motifOpacity} />
            )}
            <div className="relative z-10 flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer rounded-full py-0.5"
              onClick={() => chat.type === 'direct' ? openProfile(peerId) : setShowInfo(v => !v)}>
              {chat.type === 'direct' && (
                <div className="relative shrink-0 w-8 h-8 sm:w-9 sm:h-9">
                  {peerFrame.ring !== 'transparent' && (
                    <div className="absolute rounded-full" style={{ inset: -3, background: peerFrame.ring, boxShadow: peerFrame.glow }} />
                  )}
                  {peerAcc?.avatar
                    ? <img src={peerAcc.avatar} alt="" className="absolute inset-0 w-full h-full rounded-full object-cover" />
                    : (
                      <div className="absolute inset-0 rounded-full flex items-center justify-center text-white text-xs sm:text-sm font-bold"
                        style={{ background: 'linear-gradient(135deg,#6e8eff,#a78bfa)' }}>{peerAv}</div>
                    )}
                </div>
              )}
              {chat.type !== 'direct' && (
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6e8eff,#a78bfa)' }}>
                  {chat.type === 'channel' ? <Radio size={14} /> : <Users size={14} />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[14px] sm:text-[16px] font-bold truncate leading-tight" style={{ color: '#fff' }}>{chat.name}</p>
                {typing.length > 0 ? (
                  <p className="text-xs truncate" style={{ color: theme.accent }}>
                    {typing.join(', ')} печатает...
                  </p>
                ) : chat.type === 'direct' ? (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <GameActivityBadge userId={peerId}/>
                    {!useGamingAccounts.getState().isPlaying(peerId) && (
                      <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
                        {chat.online ? 'в сети' : 'был(а) недавно'}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {`${chat.members ?? (chat.participants?.length ?? 2)} ${chat.type === 'channel' ? 'подписчиков' : 'участников'}`}
                  </p>
                )}
              </div>
            </div>

            {chat.type === 'direct' && (
              <button type="button" onClick={() => startCall(peerId, peerName, peerAv, 'voice')}
                className="relative z-10 grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15"
                style={{ background: peerBanner.accent, color: '#fff' }}><Phone size={15} /></button>
            )}
            <button type="button" onClick={() => setMenuOpen(v => !v)}
              className="relative z-10 grid h-8 w-8 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15"
              style={{ background: chat.type === 'direct' ? peerBanner.accent : 'rgba(255,255,255,0.12)', color: '#fff' }}><MoreVertical size={16} /></button>
          </div>
        </header>

        {/* -- Скрытое меню действий чата (собрано из бывших отдельных иконок) -- */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="mt-2 ml-auto w-60 rounded-2xl sky-glass overflow-hidden"
              style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              {[
                { icon: Search, label: 'Поиск в чате', fn: () => { setSearchOpen(o => !o); setMenuOpen(false); } },
                ...(chat.type === 'direct' ? [{ icon: Video, label: 'Видеозвонок', fn: () => { startCall(peerId, peerName, peerAv, 'video'); setMenuOpen(false); } }] : []),
                { icon: PawPrint, label: 'Питомцы', fn: () => { setShowPets(v => !v); setMenuOpen(false); } },
                { icon: Gift, label: 'Отправить подарок', fn: () => { setShowGifts(true); setMenuOpen(false); } },
                { icon: ShoppingCart, label: 'Магазин подарков', fn: () => { setShowMarket(true); setMenuOpen(false); } },
                ...(chat.type === 'direct' ? [{ icon: Crown, label: 'Подарить Prime', fn: () => { setShowGiftPrime(true); setMenuOpen(false); }, tone: 'var(--amber)' }] : []),
                { icon: Palette, label: 'Тема чата', fn: () => { setShowTheme(true); setMenuOpen(false); } },
                // Управление лежало только внутри «Информации» — на два
                // нажатия глубже, чем всё остальное, и никем не находилось.
                ...(chat.type !== 'direct' ? [{
                  icon: Shield,
                  label: chat.type === 'channel' ? 'Управление каналом' : 'Управление группой',
                  fn: () => { setShowGroupManage(true); setMenuOpen(false); },
                }] : []),
                { icon: Info, label: chat.type === 'direct' ? 'Информация о чате' : 'Информация и участники', fn: () => { setShowInfo(v => !v); setMenuOpen(false); } },
                // Выйти из чата было нельзя вовсе: начатую кем-то
                // переписку не получалось закрыть.
                { icon: LogOut,
                  label: chat.type === 'direct' ? 'Убрать переписку у себя'
                       : chat.ownerId === myId ? 'Удалить чат' : 'Выйти из чата',
                  fn: () => { setConfirmLeave(true); setMenuOpen(false); },
                  tone: 'var(--red)' },
              ].map((item, i) => (
                <button key={i} type="button" onClick={item.fn}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
                  style={{ color: (item as any).tone ?? 'var(--t1)' }}>
                  <item.icon size={16} style={{ color: (item as any).tone ?? 'var(--t2)' }} />
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* -- Pet House overlay ---------------------------------------- */}
      <AnimatePresence>
        {showPets && (
          <PetHouse
            onClose={() => setShowPets(false)}
            onSendSticker={(typeId, mood, sound, petName, petColor) => {
              const m = sendMessage({ text: JSON.stringify({ typeId, mood, sound, petName, petColor }), kind: 'pet' });
              if (m) broadcast.message(m);
              setShowPets(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* -- Search bar ----------------------------------------------- */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="shrink-0 border-b overflow-hidden"
            style={{ borderColor: theme.border, background: theme.panel }}>
            <div className="flex items-center gap-2 px-4 py-2">
              <Search size={14} style={{ color: 'var(--t2)' }} />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="Поиск в чате..." autoFocus
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.otherText }} />
              {searchQ && <span className="text-xs" style={{ color: 'var(--t2)' }}>{filteredMsgs.length}</span>}
              <button type="button" onClick={() => { setSearchOpen(false); setSearchQ(''); setSearchFilter('all'); }} style={{ color: 'var(--t2)' }}><X size={15} /></button>
            </div>
            <div className="flex items-center gap-1.5 px-4 pb-2.5 overflow-x-auto">
              {([
                ['all',   'Всё'],
                ['photo', 'Фото'],
                ['video', 'Видео'],
                ['file',  'Файлы'],
                ['voice', 'Голосовые'],
                ['link',  'Ссылки'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setSearchFilter(key)}
                  className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: searchFilter === key ? theme.accent : 'rgba(255,255,255,0.06)',
                    color: searchFilter === key ? '#fff' : 'var(--t2)',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Pinned message ------------------------------------------- */}
      <AnimatePresence>
        {pinned.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 px-2 sm:px-4 pt-2 overflow-hidden">
            <button type="button" onClick={() => jumpTo(pinned[pinned.length - 1].id)}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] sky-glass"
              style={{ background: 'rgba(20,20,26,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: theme.accent }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: theme.accent }}>Закреплённое сообщение</p>
                <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{pinned[pinned.length - 1].text}</p>
              </div>
              <Pin size={16} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Scheduled messages bar ------------------------------------ */}
      <AnimatePresence>
        {scheduledMsgs.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 px-2 sm:px-4 pt-2 overflow-hidden">
            <button type="button" onClick={() => setShowScheduled(true)}
              className="w-full flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04] sky-glass"
              style={{ background: 'rgba(20,20,26,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: theme.accent }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: theme.accent }}>
                  {scheduledMsgs.length} отложенн{scheduledMsgs.length === 1 ? 'ое' : 'ых'} сообщени{scheduledMsgs.length === 1 ? 'е' : 'я'}
                </p>
                <p className="truncate text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Ближайшее — {new Date(scheduledMsgs[0].scheduledAt!).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                </p>
              </div>
              <Clock size={16} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Scheduled messages panel ----------------------------------- */}
      <AnimatePresence>
        {showScheduled && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="absolute inset-y-0 right-0 z-20 flex flex-col border-l overflow-hidden w-full sm:w-[320px]"
            style={{ background: '#121215', borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 border-b shrink-0"
              style={{ borderColor: theme.border, paddingLeft: 16, paddingRight: 16, paddingBottom: 12, paddingTop: 'calc(var(--safe-top) + 12px)' }}>
              <p className="flex-1 font-semibold" style={{ color: theme.otherText }}>Отложенные сообщения</p>
              <button type="button" onClick={() => setShowScheduled(false)} style={{ color: 'var(--t2)' }}><X size={17} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {scheduledMsgs.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--t3)' }}>Нет отложенных сообщений</p>
              ) : scheduledMsgs.map(m => (
                <div key={m.id} className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-sm mb-2" style={{ color: theme.otherText }}>{m.text}</p>
                  <p className="text-[11px] font-semibold mb-2.5" style={{ color: theme.accent }}>
                    {new Date(m.scheduledAt!).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => sendScheduledNow(m.id)}
                      className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white" style={{ background: theme.accent }}>
                      Отправить сейчас
                    </button>
                    <button type="button" onClick={() => cancelScheduled(m.id)}
                      className="flex-1 rounded-lg py-1.5 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t2)' }}>
                      Отменить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Group management ------------------------------------------ */}
      <AnimatePresence>
        {showGroupManage && chat.type !== 'direct' && (
          <GroupManage chat={chat} onClose={() => setShowGroupManage(false)} />
        )}
      </AnimatePresence>

      {/* -- Thread panel (ветка обсуждения) --------------------------- */}
      <AnimatePresence>
        {threadRootId && msgMap[threadRootId] && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="absolute inset-y-0 right-0 z-30 flex flex-col border-l overflow-hidden w-full sm:w-[380px]"
            style={{ background: '#121215', borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 border-b shrink-0"
              style={{ borderColor: theme.border, paddingLeft: 16, paddingRight: 16, paddingBottom: 12, paddingTop: 'calc(var(--safe-top) + 12px)' }}>
              <MessagesSquare size={16} style={{ color: theme.accent }} />
              <p className="flex-1 font-semibold" style={{ color: theme.otherText }}>Ветка обсуждения</p>
              <button type="button" onClick={() => setThreadRootId(null)} style={{ color: 'var(--t2)' }}><X size={17} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {(() => {
                const root = msgMap[threadRootId];
                const replies = chatMsgs.filter(m => m.replyToId === threadRootId).sort((a, b) => a.timestamp - b.timestamp);
                const Row = ({ m, isRoot }: { m: MessageItem; isRoot?: boolean }) => (
                  <div className="rounded-2xl p-3" style={{ background: isRoot ? 'rgba(91,155,209,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isRoot ? 'rgba(91,155,209,0.25)' : 'rgba(255,255,255,0.06)'}` }}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: theme.accent }}>
                      {m.fromMe ? 'Вы' : (nameOf(m.authorId) || 'Пользователь')}
                    </p>
                    <p className="text-sm" style={{ color: theme.otherText }}>{m.deleted ? 'Сообщение удалено' : m.text}</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>{m.time}</p>
                  </div>
                );
                return (
                  <>
                    <Row m={root} isRoot />
                    {replies.length === 0 ? (
                      <p className="text-xs text-center py-6" style={{ color: 'var(--t3)' }}>Пока нет ответов в этой ветке</p>
                    ) : replies.map(r => <Row key={r.id} m={r} />)}
                  </>
                );
              })()}
            </div>
            <div className="shrink-0 border-t p-3 flex items-center gap-2" style={{ borderColor: theme.border }}>
              <input value={threadDraft} onChange={e => setThreadDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && threadDraft.trim()) {
                  setReplyTo(threadRootId);
                  const m = sendMessage({ text: threadDraft, kind: 'text' });
                  if (m) broadcast.message(m);
                  setThreadDraft('');
                } }}
                placeholder="Ответить в ветке..." className="flex-1 rounded-xl px-3 py-2 text-sm bg-transparent outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', color: theme.otherText }} />
              <button type="button" disabled={!threadDraft.trim()}
                onClick={() => {
                  setReplyTo(threadRootId);
                  const m = sendMessage({ text: threadDraft, kind: 'text' });
                  if (m) broadcast.message(m);
                  setThreadDraft('');
                }}
                className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-40" style={{ background: theme.accent }}>
                <Send size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Info panel (right sidebar style) ------------------------- */}
      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="absolute inset-y-0 right-0 z-20 flex flex-col border-l overflow-hidden w-full sm:w-[280px]"
            style={{ background: '#121215', borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 border-b shrink-0"
              style={{ borderColor: theme.border, paddingLeft: 16, paddingRight: 16, paddingBottom: 12, paddingTop: 'calc(var(--safe-top) + 12px)' }}>
              <p className="flex-1 font-semibold" style={{ color: theme.otherText }}>Информация</p>
              <button type="button" onClick={() => setShowInfo(false)} style={{ color: 'var(--t2)' }}><X size={17} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="grid h-20 w-20 place-items-center rounded-full text-3xl font-bold text-white"
                  style={{ background: '#2563eb' }}>{chat.avatar?.[0]?.toUpperCase()}</div>
                <p className="text-base font-semibold" style={{ color: theme.otherText }}>{chat.name}</p>
                <p className="text-xs" style={{ color: 'var(--t2)' }}>
                  {chat.type === 'direct' ? `@${chat.username}` : `${chat.members ?? (chat.participants?.length ?? 0)} участников`}
                </p>
              </div>
              {chat.description && (
                <div className="rounded-xl p-3" style={{ background: '#1e1e24' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--t2)' }}>Описание</p>
                  <p className="text-sm" style={{ color: theme.otherText }}>{chat.description}</p>
                </div>
              )}

              {chat.type !== 'direct' && (chat.participants?.length ?? 0) > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ background: '#1e1e24' }}>
                  <p className="text-xs font-semibold px-3 pt-3 pb-1" style={{ color: 'var(--t2)' }}>
                    Участники · {chat.participants!.length}
                  </p>
                  <div className="py-1">
                    {chat.participants!.map(pid => {
                      const pAcc = accounts.find(a => a.id === pid);
                      if (!pAcc) return null;
                      return (
                        <button key={pid} type="button"
                          onClick={() => { setShowInfo(false); openProfile(pid); }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/5">
                          {pAcc.avatar
                            ? <img src={pAcc.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                            : <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: '#6e8eff' }}>{pAcc.name[0]?.toUpperCase()}</div>}
                          <span className="text-sm truncate flex-1 text-left" style={{ color: theme.otherText }}>{pAcc.name}</span>
                          {pid === chat.ownerId && <span className="text-[10px] font-semibold" style={{ color: 'var(--amber)' }}>владелец</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1 pt-2">
                {[
                  ...(chat.type === 'direct' ? [
                    { icon: UserPlus, label: 'Открыть профиль', fn: () => { setShowInfo(false); openProfile(peerId); } },
                  ] : []),
                  ...(chat.type !== 'direct' ? [
                    { icon: Shield, label: chat.type === 'channel' ? 'Управление каналом' : 'Управление группой', fn: () => { setShowGroupManage(true); } },
                  ] : []),
                  { icon: BellOff, label: chat.online ? 'Онлайн' : 'Оффлайн', sub: '' },
                  { icon: Archive, label: 'Архивировать', fn: () => { useMessengerStore.getState().archiveChat(activeChatId); setShowInfo(false); } },
                  ...(chat.type === 'direct' ? [
                    { icon: isBlocked ? UserPlus : UserMinus, label: isBlocked ? 'Разблокировать' : 'Заблокировать', danger: true, fn: () => useMessengerStore.getState().blockUser(chat.username) },
                  ] : []),
                  { icon: Flag, label: 'Пожаловаться', fn: () => { setShowReport(true); setShowInfo(false); }, danger: true },
                ].map((item, i) => (
                  <button key={i} type="button" onClick={(item as any).fn}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5"
                    style={{ color: (item as any).danger ? 'var(--red)' : 'var(--t1)' }}>
                    <item.icon size={16} style={{ color: (item as any).danger ? 'var(--red)' : 'var(--t2)' }} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Подтверждение выхода из чата ------------------------------ */}
      <AnimatePresence>
        {confirmLeave && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setConfirmLeave(false)}>
            <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} exit={{ scale: 0.94 }}
              className="w-full max-w-xs rounded-2xl p-5"
              style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}
              onClick={e => e.stopPropagation()}>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--t1)' }}>
                {chat.type === 'direct' ? 'Убрать переписку у себя?'
                 : chat.ownerId === myId ? 'Удалить чат?' : 'Выйти из чата?'}
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--t2)' }}>
                {chat.type === 'direct'
                  ? 'Чат пропадёт у вас на всех устройствах. У собеседника переписка останется; вернуться можно, написав ему снова.'
                  : chat.ownerId === myId
                    ? 'Чат и вся переписка пропадут у всех участников.'
                    : 'Вы перестанете получать сообщения этого чата.'}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmLeave(false)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t1)' }}>Отмена</button>
                <button type="button"
                  onClick={() => { leaveChatOnServer(chat.id); setConfirmLeave(false); }}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--red)' }}>
                  {chat.type !== 'direct' && chat.ownerId === myId ? 'Удалить' : 'Убрать'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Messages -------------------------------------------------- */}
      <div
        className="flex-1 relative overflow-y-auto px-4 py-3 scroll-none sky-chat-font"
        style={{ background: theme.bg }}
        ref={(el) => { (listRef as any).current = el; (chatAreaRef as any).current = el; }}
        onScroll={() => {
          const el = listRef.current; if (!el) return;
          setShowScroll(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
          // Долистали до верха — просим у сервера страницу постарше.
          // Без этого переписка обрывалась на последних пятидесяти
          // сообщениях: всё, что раньше, было недоступно совсем.
          if (el.scrollTop < 120 && chat) {
            const before = el.scrollHeight;
            keepScroll.current = { before, top: el.scrollTop };
            loadOlder(chat.id);
          }
        }}>
        {chat && loadingOlder[chat.id] && (
          <p className="py-2 text-center text-xs" style={{ color: 'var(--t2)' }}>Загружаем…</p>
        )}
        <LiquidCursor
          containerRef={chatAreaRef as React.RefObject<HTMLElement>}
          color={theme.liquidColor}
        />
        {/* Safety warning for unknown users */}
        {chat?.type === 'direct' && !isBlocked && (() => {
          const peerMsgs = messages.filter(m => m.chatId === activeChatId && !m.fromMe && !m.deleted);
          const myMsgs   = messages.filter(m => m.chatId === activeChatId && m.fromMe);
          const isNew    = peerMsgs.length <= 3 && myMsgs.length === 0;
          if (!isNew) return null;
          return (
            <div className="mb-3 rounded-2xl overflow-hidden"
              style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.22)' }}>
              <div className="px-4 py-3">
                <div className="flex items-start gap-2.5 mb-2.5">
                  <AlertTriangle size={17} className="shrink-0 mt-0.5" style={{ color:'var(--amber)' }}/>
                  <div>
                    <p className="text-xs font-bold" style={{ color:'var(--amber)' }}>Незнакомый пользователь</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color:'rgba(245,158,11,0.65)' }}>
                      Будьте осторожны  -  не переходите по ссылкам и не передавайте личные данные.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => addReport({ chatId:activeChatId??'', messageId:messages.filter(m=>m.chatId===activeChatId&&!m.fromMe)[0]?.id??'', reporterId:myId??'', reportedId:peerId??'', reason:'Мошенничество', comment:'Незнакомый пользователь' })}
                    className="flex-1 rounded-xl py-2 text-[11px] font-bold"
                    style={{ background:'rgba(245,158,11,0.15)', color:'var(--amber)', border:'1px solid rgba(245,158,11,0.3)' }}>
                    <Flag size={13} className="inline mr-1.5"/>Пожаловаться
                  </button>
                  <button type="button"
                    onClick={() => (isBlocked ? unblockChatUser(peerId ?? '') : blockChatUser(peerId ?? ''))}
                    className="flex-1 rounded-xl py-2 text-[11px] font-bold"
                    style={{ background:'rgba(239,68,68,0.1)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.2)' }}>
                    <Ban size={13} className="inline mr-1.5"/>Заблокировать
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {filteredMsgs.length === 0 && !searchQ && searchFilter === 'all' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Hand size={28} className="mx-auto opacity-20 mb-2" style={{ color:'var(--t3)' }}/>
              <p className="text-sm" style={{ color: 'var(--t2)' }}>Напишите первым</p>
            </div>
          </div>
        )}
        {filteredMsgs.length === 0 && (searchQ || searchFilter !== 'all') && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm" style={{ color: 'var(--t2)' }}>Ничего не найдено</p>
          </div>
        )}

        {filteredMsgs.map((msg, i) => {
          const prev     = filteredMsgs[i - 1];
          const showDate = !prev || new Date(prev.timestamp).toDateString() !== new Date(msg.timestamp).toDateString();
          const replyTo  = msg.replyToId ? msgMap[msg.replyToId] : undefined;
          const acc      = !msg.fromMe ? accounts.find(a => a.id === msg.authorId) : null;
          const author   = !msg.fromMe ? nameOf(msg.authorId) : '';
          const isGroup  = chat.type === 'group' || chat.type === 'channel';

          const dateLabel = () => {
            const d = new Date(msg.timestamp), now = new Date();
            if (d.toDateString() === now.toDateString()) return 'Сегодня';
            const y = new Date(now); y.setDate(now.getDate() - 1);
            if (d.toDateString() === y.toDateString()) return 'Вчера';
            return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
          };

          return (
            <div key={msg.id} ref={el => { msgRefs.current[msg.id] = el; }} style={{ transition: 'background 0.4s' }}>
              {showDate && (
                <div className="flex justify-center my-3">
                  <span className="rounded-full px-4 py-1 text-xs font-medium"
                    style={{ background: 'rgba(14,22,33,0.85)', color: 'var(--t2)', backdropFilter: 'blur(8px)' }}>
                    {dateLabel()}
                  </span>
                </div>
              )}
              <Bubble
                msg={msg} replyTo={replyTo}
                authorName={isGroup ? author : ''}
                myId={myId}
                onReply={() => { setReplyTo(msg.id); taRef.current?.focus(); }}
                onEdit={() => { startEdit(msg.id); setDraft(msg.text); draftRef.current = msg.text; taRef.current?.focus(); }}
                onDelete={() => { deleteMessage(msg.id); broadcast.delete(msg.id); }}
                onPin={() => pinMessage(msg.id)}
                onFavorite={() => toggleFavoriteMessage(msg.id)}
                onForward={() => { const m = forward(msg.id); if (m) broadcast.message(m); }}
                onReact={e => { react(msg.id, e); broadcast.react(msg.id, e, myId); }}
                onReport={() => setShowReport(true)}
                onPickSuggestion={t => { setDraft(t); draftRef.current=t; taRef.current?.focus(); }}
                replyCount={replyCounts[msg.id]}
                onOpenThread={() => setThreadRootId(msg.id)}
              />
            </div>
          );
        })}

        {/* Typing */}
        <AnimatePresence>
          {typing.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex mt-1">
              <div className="flex items-center gap-1.5 rounded-2xl px-4 py-2.5" style={{ background: '#1e1e26' }}>
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--t2)' }}
                    animate={{ y: [0, -5, 0] }}
                    transition={{ duration: 0.7, delay: i * 0.15, repeat: Infinity }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scroll down button */}
      <AnimatePresence>
        {showScroll && (() => {
          const unreadBelow = chatMsgs.filter(m => !m.fromMe && m.status !== 'read').length;
          return (
            <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }} type="button"
              onClick={() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }}
              className="absolute bottom-28 right-5 z-10 flex flex-col items-center"
              style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }}>
              {unreadBelow > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}
                  className="mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                  style={{ background: theme.accent, minWidth: 28, textAlign: 'center' }}>
                  {unreadBelow > 99 ? '99+' : unreadBelow}
                </motion.span>
              )}
              <div className="grid h-10 w-10 place-items-center rounded-full"
                style={{ background: '#1e1e24', border: '1px solid rgba(255,255,255,0.1)' }}>
                <ChevronDown size={18} style={{ color: theme.otherText }} />
              </div>
            </motion.button>
          );
        })()}
      </AnimatePresence>

      {/* Upload bar */}
      <AnimatePresence>
        {uploading && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="shrink-0 border-t px-4 py-2" style={{ borderColor: theme.border, background: theme.panel }}>
            <div className="flex items-center gap-2 mb-1">
              <p className="flex-1 truncate text-xs" style={{ color: 'var(--t2)' }}>{uploading}</p>
              <span className="text-xs" style={{ color: 'var(--t2)' }}>{uploadPct}%</span>
            </div>
            <div className="h-0.5 rounded-full overflow-hidden" style={{ background: theme.border }}>
              <motion.div className="h-full rounded-full" style={{ background: theme.accent }}
                animate={{ width: `${uploadPct}%` }} transition={{ duration: 0.2 }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record error toast */}
      <AnimatePresence>
        {recError && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="shrink-0 px-4 py-2 text-sm text-center"
            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)',
              borderTop: '1px solid rgba(239,68,68,0.2)' }}>
            {recError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recording bar */}
      <AnimatePresence>
        {recording && recKind === 'voice' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 border-t px-4 py-3 flex items-center gap-3"
            style={{ borderColor: theme.border, background: theme.panel }}>
            <motion.div className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: '#ef4444' }}
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }} />
            <span className="font-mono text-sm shrink-0" style={{ color: '#ef4444', minWidth: 40 }}>{fmtS(recSec)}</span>
            <div className="flex flex-1 items-end gap-[2px] h-7">
              {[...Array(30)].map((_, i) => (
                <motion.div key={i} className="flex-1 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.55)', minWidth: 2 }}
                  animate={{ height: ['20%', `${25 + Math.random()*65}%`, '20%'] }}
                  transition={{ duration: 0.25 + Math.random()*0.35, repeat: Infinity, delay: i*0.02 }} />
              ))}
            </div>
            <button type="button" onClick={cancelRec}
              className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors hover:bg-white/10"
              style={{ color: 'var(--t2)' }}>
              Отмена
            </button>
            <motion.button type="button" whileTap={{ scale: 0.93 }} onClick={stopRec}
              className="shrink-0 grid h-9 w-9 place-items-center rounded-full"
              style={{ background: '#ef4444' }}>
              <Square size={13} fill="white" style={{ color: 'white' }} />
            </motion.button>
          </motion.div>
        )}
        {recording && recKind === 'video-note' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="shrink-0 border-t flex flex-col items-center gap-3 py-4"
            style={{ borderColor: theme.border, background: theme.panel }}>
            {/* circular camera preview */}
            <div className="relative" style={{ width: 120, height: 120 }}>
              <div className="absolute inset-0 rounded-full overflow-hidden"
                style={{ boxShadow: '0 0 0 3px rgba(239,68,68,0.6)' }}>
                <video ref={previewRef} muted playsInline autoPlay
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)', display: 'block', background: '#000' }} />
              </div>
              {/* countdown ring */}
              <svg className="absolute inset-0 pointer-events-none" width={120} height={120}
                style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={60} cy={60} r={56} fill="none"
                  stroke="rgba(239,68,68,0.2)" strokeWidth={3} />
                <motion.circle cx={60} cy={60} r={56} fill="none"
                  stroke="#ef4444" strokeWidth={3} strokeLinecap="round"
                  strokeDasharray={2*Math.PI*56}
                  animate={{ strokeDashoffset: [0, 2*Math.PI*56] }}
                  transition={{ duration: 60, ease: 'linear' }} />
              </svg>
              {/* rec dot */}
              <motion.div className="absolute top-2 right-2 h-3 w-3 rounded-full"
                style={{ background: '#ef4444' }}
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }} />
              {/* timer */}
              <div className="absolute bottom-1 left-0 right-0 flex justify-center">
                <span className="rounded-full px-2 text-[11px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{fmtS(recSec)}</span>
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--t2)' }}>Запись видео-кружка...</p>
            <div className="flex items-center gap-4">
              <button type="button" onClick={cancelRec}
                className="px-4 py-1.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/10"
                style={{ color: 'var(--t2)' }}>
                Отмена
              </button>
              <motion.button type="button" whileTap={{ scale: 0.93 }} onClick={stopRec}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: '#ef4444' }}>
                <Square size={12} fill="white" style={{ color: 'white' }} /> Отправить
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply / Edit bar */}
      <AnimatePresence>
        {(replyMsg || editMsg) && !recording && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 border-t flex items-center gap-3 px-4 py-2.5"
            style={{ borderColor: theme.border, background: theme.panel }}>
            <div className="flex-1 border-l-2 pl-3 min-w-0" style={{ borderColor: theme.accent }}>
              <p className="text-xs font-semibold" style={{ color: theme.accent }}>
                {editMsg ? 'Редактирование' : `Ответ: ${replyMsg?.fromMe ? 'Вы' : nameOf(replyMsg?.authorId)}`}
              </p>
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--t2)' }}>
                {editMsg?.text ?? replyMsg?.text}
              </p>
            </div>
            <button type="button" style={{ color: 'var(--t2)' }}
              onClick={() => { setReplyTo(null); if (editMsg) { startEdit(null); setDraft(''); draftRef.current = ''; } }}>
              <X size={17} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Почему сообщение не ушло ----------------------------------
           Причину называет сервер: правила чата проверяются там, а не
           здесь, и здесь мы только показываем ответ. */}
      <AnimatePresence>
        {postNotice && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 flex items-center gap-2 px-4 pt-2 overflow-hidden">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold w-full"
              style={{ background: 'rgba(224,85,95,0.12)', color: 'var(--red)' }}>
              <Shield size={13} /> {postNotice}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Запрет говорить: показываем словами и с датой, а не отказом на
          каждое голосовое. Текстом писать при этом можно. */}
      {voiceBlock && (
        <div className="shrink-0 px-4 pt-2">
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <MicOff size={14} style={{ color: 'var(--amber)', marginTop: 1, flexShrink: 0 }} />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: 'var(--amber)' }}>
                Голосовые и звонки временно недоступны
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>
                Ограничение действует до{' '}
                {new Date(voiceBlock).toLocaleString('ru-RU',
                  { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.
                Писать сообщениями можно.
              </p>
            </div>
          </div>
        </div>
      )}

      {!canPost && (
        <footer className="shrink-0 px-4 py-4 border-t text-center sky-chat-font"
          style={{ borderColor: theme.border, background: theme.panel }}>
          <p className="text-[13px]" style={{ color: 'var(--t2)' }}>
            {chat.type === 'channel'
              ? 'Это канал — здесь публикуют его администраторы'
              : 'Сейчас в группе пишут только администраторы'}
          </p>
        </footer>
      )}

      {/* -- AI composer tools: исправить текст / сменить тон -------- */}
      <AnimatePresence>
        {draft.trim().length >= 12 && !recording && !isBlocked && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 flex items-center gap-1.5 px-4 pt-2 overflow-x-auto"
            style={{ background: theme.panel }}>
            {!isPrime ? (
              <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold" style={{ background: 'rgba(168,85,247,0.08)', color: '#a855f7' }}>
                <Lock size={11}/> AI-инструменты текста — только для Prime
              </div>
            ) : ([
              ['fix', 'Исправить', Wand2],
              ['tone-friendly', 'Дружелюбнее', Smile],
              ['tone-formal', 'Официальнее', Info],
              ['tone-short', 'Короче', ChevronLeft],
            ] as const).map(([action, label, Icon]) => (
              <button key={action} type="button" disabled={!!aiComposerBusy}
                onClick={async () => {
                  setAiComposerBusy(action);
                  try { const r = await runAiComposerAction(action, draftRef.current); onDraftChange(r); } catch {}
                  setAiComposerBusy(null);
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
                {aiComposerBusy === action ? <Loader2 size={11} className="animate-spin"/> : <Icon size={11}/>} {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {/* В канале читателю писать нечем: право решает сервер, и
          показывать поле ввода, которое всё равно ответит отказом, —
          только путать. */}
      {!recording && canPost && (
        <footer className="shrink-0 px-3 py-3 border-t sky-chat-font" style={{ borderColor: theme.border, background: theme.panel }}>
          {isBlocked && (
            <p className="mb-2 text-center text-xs font-medium" style={{ color: 'var(--red)' }}>
              Пользователь заблокирован
            </p>
          )}

          <input ref={imgRef} type="file" accept="image/*,video/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ''; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ''; }} />
          <input ref={fileRef} type="file" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) sendFile(f); e.target.value = ''; }} />

          <div className="flex items-end gap-2">
            {/* Attach popup button */}
            <div className="relative mb-1 shrink-0">
              {/* Msg options */}
              <div className="relative mb-1 shrink-0">
                <motion.button type="button" whileTap={{ scale:0.9 }}
                  onClick={() => setShowMsgOpts(v => !v)}
                  disabled={isBlocked}
                  className="grid h-9 w-9 place-items-center rounded-full transition-all disabled:opacity-40"
                  style={{ color: (msgOptions.once||msgOptions.spoiler||msgOptions.silent||msgOptions.selfDestruct>0||msgOptions.scheduled) ? theme.accent : 'var(--t2)',
                    background: showMsgOpts ? `${theme.accent}20` : 'transparent' }}>
                  <Settings2 size={18}/>
                </motion.button>
                <AnimatePresence>
                  {showMsgOpts && (
                    <MsgOptionsPanel
                      options={msgOptions}
                      onChange={o => setMsgOptions(o)}
                      onClose={() => setShowMsgOpts(false)}
                    />
                  )}
                </AnimatePresence>
              </div>

              <motion.button type="button" whileTap={{ scale: 0.9 }}
                onClick={() => { setShowQuickReplies(v => !v); setShowAttach(false); setShowEmoji(false); setShowPets(false); }}
                disabled={isBlocked}
                className="grid h-9 w-9 place-items-center rounded-full transition-all disabled:opacity-40"
                style={{ color: showQuickReplies ? theme.accent : 'var(--t2)',
                  background: showQuickReplies ? `${theme.accent}20` : 'transparent' }}>
                <Zap size={17} />
              </motion.button>
              <AnimatePresence>
                {showQuickReplies && (
                  <motion.div initial={{ opacity: 0, scale: 0.88, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.88, y: 8 }}
                    className="absolute bottom-full left-0 mb-2 z-[200] rounded-2xl overflow-hidden"
                    style={{ background: '#1e2c3a', border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.6)', minWidth: 260, maxWidth: 320 }}>
                    <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                      <p className="text-xs font-bold" style={{ color: 'var(--t1)' }}>Быстрые ответы</p>
                      <button type="button" onClick={() => setAddingQuickReply(true)} style={{ color: theme.accent }}>
                        <Plus size={15} />
                      </button>
                    </div>
                    {addingQuickReply && (
                      <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                        <input autoFocus value={newQuickReply} onChange={e => setNewQuickReply(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { addQuickReply(newQuickReply); setNewQuickReply(''); setAddingQuickReply(false); } if (e.key === 'Escape') { setAddingQuickReply(false); setNewQuickReply(''); } }}
                          placeholder="Текст шаблона..." className="flex-1 bg-transparent text-xs outline-none px-1"
                          style={{ color: 'var(--t1)' }} />
                        <button type="button" onClick={() => { addQuickReply(newQuickReply); setNewQuickReply(''); setAddingQuickReply(false); }}
                          className="rounded-lg px-2 py-1 text-[11px] font-bold text-white" style={{ background: theme.accent }}>OK</button>
                      </div>
                    )}
                    <div className="max-h-64 overflow-y-auto">
                      {quickReplies.length === 0 && !addingQuickReply ? (
                        <p className="px-4 py-4 text-xs text-center" style={{ color: 'var(--t3)' }}>Нет сохранённых шаблонов</p>
                      ) : quickReplies.map(q => (
                        <div key={q.id} className="group flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.06]">
                          <button type="button" onClick={() => { onDraftChange(q.text); setShowQuickReplies(false); taRef.current?.focus(); }}
                            className="flex-1 text-left truncate" style={{ color: 'var(--t1)' }}>{q.text}</button>
                          <button type="button" onClick={() => removeQuickReply(q.id)}
                            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--red)' }}>
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button type="button" whileTap={{ scale: 0.9 }}
                onClick={() => { setShowAttach(v => !v); setShowEmoji(false); setShowPets(false); }}
                disabled={isBlocked}
                className="grid h-9 w-9 place-items-center rounded-full transition-all disabled:opacity-40"
                style={{ color: showAttach ? theme.accent : 'var(--t2)',
                  background: showAttach ? `${theme.accent}20` : 'transparent' }}>
                <motion.div animate={{ rotate: showAttach ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                  <Paperclip size={18} />
                </motion.div>
              </motion.button>
              <AnimatePresence>
                {showAttach && (
                  <motion.div initial={{ opacity: 0, scale: 0.88, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.88, y: 8 }}
                    className="absolute bottom-full left-0 mb-2 z-[200] rounded-2xl overflow-hidden"
                    style={{ background: '#1e2c3a', border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.6)', minWidth: 200 }}>
                    {[
                      ...(isMobile ? [{ icon: Camera, label: 'Камера', action: () => { camRef.current?.click(); setShowAttach(false); } }] : []),
                      { icon: Images,    label: 'Фото / Видео',  action: () => { imgRef.current?.click(); setShowAttach(false); } },
                      { icon: FileText,  label: 'Файл',          action: () => { fileRef.current?.click(); setShowAttach(false); } },
                      { icon: BarChart2, label: 'Опрос',         action: () => { setShowPoll(true); setShowAttach(false); } },
                    ].map(({ icon: Icon, label, action }) => (
                      <button key={label} type="button" onClick={action}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.06]"
                        style={{ color: 'var(--t1)' }}>
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                          style={{ background: 'rgba(91,155,209,0.15)' }}>
                          <Icon size={17} style={{ color: theme.accent }} />
                        </div>
                        {label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Text input */}
            <div className="relative flex flex-1 items-end gap-2 rounded-3xl px-4 py-2.5"
              style={{ background: theme.inputBg, border: `1px solid ${theme.border}`, minHeight: 46 }}>
              {/* Hash Bot Menu */}
              <AnimatePresence>{showHash && (
                <HashInlineMenu
                  query={hashQ}
                  onSelect={(bot: any) => {
                    setShowHash(false);
                    if ('__browse__' in bot) { setOpenBot({ __browse__: true }); return; }
                    /* Подставляем триггер, а не ник: по триггеру бот и
                       вызывается. Человек допишет запрос и нажмёт Enter. */
                    const lastHash = draftRef.current.lastIndexOf('#');
                    const newDraft = `${draftRef.current.slice(0, lastHash)}#${bot.trigger} `;
                    setDraft(newDraft); draftRef.current = newDraft;
                    taRef.current?.focus();
                  }}
                  onClose={() => setShowHash(false)}
                />
              )}</AnimatePresence>
              {openBot && !openBot.__browse__ && (
                <BotChatOverlay bot={openBot} onClose={() => setOpenBot(null)} />
              )}
              {inlineAsk && activeChatId && createPortal(
                <InlineConfirm
                  chatId={activeChatId}
                  trigger={inlineAsk.trigger}
                  query={inlineAsk.query}
                  fromName={accounts.find(a => a.id === currentUserId)?.name ?? ''}
                  onDone={() => { setInlineAsk(null); requestAnimationFrame(() => taRef.current?.focus()); }}
                  onClose={() => setInlineAsk(null)}
                />,
                document.body,
              )}
              {openBot && openBot.__browse__ && createPortal(
                <div style={{position:'fixed',inset:0,zIndex:999,background:'var(--bg)',display:'flex',flexDirection:'column'}}>
                  <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 20px',borderBottom:'1px solid var(--border)'}}>
                    <button type="button" onClick={()=>setOpenBot(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--accent)',display:'flex',alignItems:'center',gap:6,fontSize:13,fontWeight:600}}>
                      ← Назад
                    </button>
                  </div>
                  <div style={{flex:1,overflow:'hidden'}}>
                    <BotsBrowser onClose={()=>setOpenBot(null)}/>
                  </div>
                </div>,
                document.body
              )}
              <textarea ref={taRef} value={draft} onChange={e => onDraftChange(e.target.value)} onKeyDown={onKey}
                placeholder={isBlocked ? 'Заблокировано' : editMsg ? 'Редактировать...' : 'Написать сообщение...'}
                disabled={isBlocked} rows={1}
                className="flex-1 resize-none bg-transparent py-1 text-sm outline-none leading-relaxed disabled:opacity-40"
                style={{ color: theme.otherText, maxHeight: 160 }} />

              {(('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)) && (
                <motion.button type="button" whileTap={{ scale: 0.9 }} disabled={isBlocked}
                  onClick={toggleDictation}
                  title="Голосовой ввод — диктовка текста"
                  className="grid h-9 w-9 shrink-0 place-items-center self-end mb-0.5 rounded-full transition-all disabled:opacity-40"
                  style={{ color: dictating ? '#fff' : 'var(--t2)', background: dictating ? 'var(--red)' : 'transparent' }}>
                  {dictating ? <Square size={14} fill="#fff"/> : <Mic size={17} />}
                </motion.button>
              )}

              {/* Pets moved to header → PetHouse */}

              {/* Emoji */}
              <div className="relative mb-0.5 shrink-0">
                <button type="button" onClick={() => { setShowEmoji(v => !v); setShowAttach(false); }} disabled={isBlocked}
                  className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-40"
                  style={{ color: showEmoji ? theme.accent : 'var(--t2)' }}>
                  <Smile size={18} />
                </button>
                <AnimatePresence>
                  {showEmoji && (
                    <EmojiPicker
                      onPick={e => { setDraft(d => d + e); draftRef.current = draftRef.current + e; taRef.current?.focus(); }}
                      onClose={() => setShowEmoji(false)} />
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Send / Mic */}
            <div className="mb-0.5 shrink-0">
              {hasVisibleText(draft)
                ? <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => submit()}
                    disabled={isBlocked}
                    className="grid h-11 w-11 place-items-center rounded-full disabled:opacity-40"
                    style={{ background: theme.accent, boxShadow: `0 4px 16px ${theme.liquidColor}` }}>
                    <Send size={18} className="text-white" style={{ marginLeft: 2 }} />
                  </motion.button>
                : <div className="flex items-center gap-1">
                    <motion.button type="button" whileTap={{ scale: 0.9 }}
                      onClick={startVideoNote} disabled={isBlocked}
                      title="Видео-кружок"
                      className="grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-40"
                      style={{ color: 'var(--t2)' }}>
                      <Video size={18} />
                    </motion.button>
                    <motion.button type="button" whileTap={{ scale: 0.9 }}
                      onClick={startRec} disabled={isBlocked}
                      title="Голосовое"
                      className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-40"
                      style={{ color: 'var(--t2)' }}>
                      <Mic size={20} />
                    </motion.button>
                  </div>}
            </div>
          </div>
        </footer>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showReport && <ReportModal chatId={activeChatId} onClose={() => setShowReport(false)} />}
      </AnimatePresence>
    {/* Active msg options badge */}
    {(msgOptions.once||msgOptions.spoiler||msgOptions.silent||msgOptions.selfDestruct>0) && (
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 pointer-events-none"
        style={{ background:'rgba(91,155,209,0.15)', border:'1px solid rgba(91,155,209,0.3)' }}>
        {msgOptions.once    && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color:theme.accent }}><Eye size={10}/>Однократно</span>}
        {msgOptions.spoiler && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color:theme.accent }}><EyeOff size={10}/>Спойлер</span>}
        {msgOptions.silent  && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color:theme.accent }}><BellOff size={10}/>Тихо</span>}
        {msgOptions.selfDestruct>0 && <span className="text-[10px]" style={{ color:'var(--amber)' }}>⏱ {msgOptions.selfDestruct}с</span>}
      </div>
    )}

    {/* Gift Prime Modal - portal */}
    {showGiftPrime && chat?.type === 'direct' && createPortal(
      <AnimatePresence>
        <GiftPrimeModal
          toUserId={peerId ?? ''}
          toName={peerName}
          onClose={() => setShowGiftPrime(false)}
        />
      </AnimatePresence>,
      document.body
    )}

    {/* Create Poll Modal */}
    <AnimatePresence>
      {showPoll && (
        <CreatePollModal
          onClose={() => setShowPoll(false)}
          onSend={(poll) => {
            const m = sendMessage({ text: poll.question, kind: 'poll', poll } as any);
            if (m) broadcast.message(m);
            setShowPoll(false);
          }}
        />
      )}
    </AnimatePresence>

    {/* Theme Picker */}
    <AnimatePresence>
      {showTheme && activeChatId && (
        <ThemePicker chatId={activeChatId} onClose={() => setShowTheme(false)}/>
      )}
    </AnimatePresence>

    {/* Gift Market - portal to body to escape stacking contexts */}
    {showMarket && createPortal(
      <AnimatePresence>
        <GiftMarket onClose={() => setShowMarket(false)}/>
      </AnimatePresence>,
      document.body
    )}

    {/* Gift Modal */}
    <AnimatePresence>
      {showGifts && chat && (() => {
        const toId = chat.participants?.find(p => p !== currentUserId) ?? chat.id;
        const toAcc = accounts.find(a => a.id === toId);
        return (
          <GiftModal
            chatId={activeChatId ?? ''}
            toUserId={toId}
            toName={toAcc?.name ?? chat.name}
            onClose={() => setShowGifts(false)}
            // Доставка в чат теперь идёт от сервера (server/gifts.mjs
            // сам создаёт сообщение и рассылает его по сокету) — второй,
            // клиентской отправки того же подарка здесь больше не нужно.
            onSent={() => setShowGifts(false)}
          />
        );
      })()}
    </AnimatePresence>

    </section>
  );
};
