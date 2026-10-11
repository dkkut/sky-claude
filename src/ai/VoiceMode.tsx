/**
 * Sky AI — голосовой режим.
 *
 * Не отдельный ассистент: запись уходит на /api/ai/voice, который
 * распознаёт речь и отправляет её как обычную реплику в тот же
 * sendMessage() (aichat.mjs) — тот же диалог, та же история, тот же
 * профиль. Этот экран только записывает, показывает состояние и
 * проигрывает голосовой ответ, если сервер его прислал.
 */
import { speechLocale } from '@/i18n/lang';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Square, X, Loader2, AlertTriangle, Volume2, Check } from 'lucide-react';
import { apiAiVoice, apiAiSend, type VoiceTurnResult } from './aiApi';
import { refreshAiState } from './aiState';
import { matchVoiceCommand } from './voiceCommands';

type Phase = 'idle' | 'listening' | 'processing' | 'speaking' | 'error' | 'command';

// Проверка MediaRecorder — не при загрузке модуля: там, где его нет (часть
// встроенных браузеров), обращение на верхнем уровне роняло весь раздел.
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
};

/* Распознавание речи самого браузера — запасной путь, когда на сервере не
   подключён поставщик расшифровки: тогда кнопки голоса не было вовсе. */
interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
const getRecognitionCtor = (): (new () => BrowserRecognition) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => BrowserRecognition) | null;
};
export const browserVoiceAvailable = () => getRecognitionCtor() !== null;

export const VoiceMode = ({ chatId, onClose, onTurn, serverStt = true }: {
  chatId: string | null;
  /** Есть ли на сервере расшифровка речи; нет — работаем на речи браузера. */
  serverStt?: boolean;
  onClose: () => void;
  onTurn: (result: VoiceTurnResult) => void;
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [recognized, setRecognized] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [error, setError] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<BrowserRecognition | null>(null);
  const transcriptRef = useRef('');
  const mimeRef = useRef(pickMime());

  const stopVisualizer = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    stopVisualizer(); stopStream(); cancelRef.current?.();
    if (recogRef.current) { recogRef.current.onend = null; recogRef.current.abort(); }
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  const visualize = (stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(Math.min(1, avg / 90));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  /* Ассистент задал уточняющий вопрос — после реплики сразу слушаем
     ответ, не заставляя нажимать кнопку ещё раз. */
  const followUp = (text: string) => {
    setPhase('idle');
    if (/\?\s*$/.test(text.trim())) setTimeout(() => { void startListening().catch(() => {}); }, 350);
  };

  /* iOS Safari разрешает speechSynthesis и audio.play() только из обработчика
     касания. Ответ приходит после сетевого запроса, то есть уже вне касания,
     и озвучка молча не запускалась. Поэтому в момент нажатия «разбудить»:
     беззвучная реплика синтеза и один и тот же <audio>, который потом
     получает настоящий звук. */
  const unlockedRef = useRef(false);
  const unlockAudio = () => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    try {
      if (typeof speechSynthesis !== 'undefined') {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      }
    } catch { /* нет синтеза — не страшно */ }
    try {
      const el = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
      el.volume = 0;
      void el.play().catch(() => {});
      audioElRef.current = el;
    } catch { /* нет аудио — не страшно */ }
  };

  /* Что читать вслух: без кода и разметки, предложениями — длинную реплику
     Safari обрывает на середине. */
  const speakable = (text: string) => text
    .replace(/```[\s\S]*?```/g, speechLocale().toLowerCase().startsWith('ru') ? ' Код показан на экране. ' : ' The code is shown on screen. ')
    .replace(/[*_`#>|~]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ').trim();
  const chunks = (text: string) => {
    const parts = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
    const out: string[] = [];
    for (const part of parts) {
      let rest = part.trim();
      while (rest.length > 180) {
        const cut = rest.lastIndexOf(' ', 180);
        out.push(rest.slice(0, cut > 40 ? cut : 180)); rest = rest.slice(cut > 40 ? cut : 180).trim();
      }
      if (rest) out.push(rest);
    }
    return out.slice(0, 12);
  };
  const pickVoice = (lang: string) => {
    const voices = speechSynthesis.getVoices();
    const base = lang.slice(0, 2).toLowerCase();
    return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
      ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null;
  };

  const speakInBrowser = (text: string) => {
    const clean = speakable(text);
    if (typeof speechSynthesis === 'undefined' || !clean) { followUp(text); return; }
    setPhase('speaking');
    const lang = speechLocale();
    const queue = chunks(clean);
    speechSynthesis.cancel();
    queue.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      u.lang = lang;
      const v = pickVoice(lang); if (v) u.voice = v;
      if (i === queue.length - 1) { u.onend = () => followUp(text); }
      u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') setPhase('idle'); };
      speechSynthesis.speak(u);
    });
  };

  /* Ход без серверной расшифровки: слова уже распознал браузер, дальше —
     обычное сообщение в тот же чат Sky AI. */
  const handleBrowserText = async () => {
    const text = transcriptRef.current.trim();
    if (!text) { setPhase('idle'); return; }
    setRecognized(text);
    setPhase('processing');
    const r = await apiAiSend(text, chatId ?? undefined, { voice: true, assist: true });
    if (!r.ok || !r.answer) { setError(r.reason ?? 'Не получилось'); setPhase('error'); return; }
    void refreshAiState();
    const command = matchVoiceCommand(text);
    if (command) {
      setPhase('command');
      await command.run();
      setAnswerText(command.label);
      setTimeout(onClose, 1100);
      return;
    }
    setAnswerText(r.answer.text);
    onTurn({ chatId: r.chatId ?? '', chat: r.chat as VoiceTurnResult['chat'], recognizedText: text, answer: r.answer, audio: null, audioMime: null });
    speakInBrowser(r.answer.text);
  };

  const startBrowserListening = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { setError('Этот браузер не умеет распознавать речь'); setPhase('error'); return; }
    transcriptRef.current = '';
    const rec = new Ctor();
    rec.lang = speechLocale();
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = ''; let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const part = e.results[i][0]?.transcript ?? '';
        if (e.results[i].isFinal) finalText += part; else interim += part;
      }
      transcriptRef.current = finalText || interim;
      setRecognized(transcriptRef.current);
    };
    rec.onerror = (e) => {
      rec.onend = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Нет доступа к микрофону');
      else if (e.error === 'no-speech') { setPhase('idle'); return; }
      else if (e.error === 'network') setError('Служба распознавания речи браузера недоступна — проверьте интернет');
      else setError('Не удалось распознать речь');
      setPhase('error');
    };
    rec.onend = () => { void handleBrowserText(); };
    recogRef.current = rec;
    try { rec.start(); setPhase('listening'); }
    catch { setError('Не удалось включить микрофон'); setPhase('error'); }
  };

  const startListening = async () => {
    unlockAudio();
    setError(''); setRecognized(''); setAnswerText('');
    if (!serverStt) { startBrowserListening(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, mimeRef.current ? { mimeType: mimeRef.current } : undefined);
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => { void handleStop(); };
      rec.start();
      recRef.current = rec;
      visualize(stream);
      setPhase('listening');
    } catch {
      setError('Нет доступа к микрофону');
      setPhase('error');
    }
  };

  const stopListening = () => {
    if (!serverStt) { recogRef.current?.stop(); return; }
    recRef.current?.stop();
    stopStream();
    stopVisualizer();
  };

  const cancelListening = () => {
    if (!serverStt) {
      if (recogRef.current) { recogRef.current.onend = null; recogRef.current.abort(); }
      setPhase('idle');
      return;
    }
    if (recRef.current) recRef.current.onstop = null;
    recRef.current?.stop();
    stopStream();
    stopVisualizer();
    chunksRef.current = [];
    setPhase('idle');
  };

  const handleStop = async () => {
    stopVisualizer();
    if (!chunksRef.current.length) { setPhase('idle'); return; }
    setPhase('processing');
    // Тип — тот, что реально выбрал браузер: на iPhone это mp4, а не webm.
    const blob = new Blob(chunksRef.current, { type: recRef.current?.mimeType || mimeRef.current || 'audio/webm' });
    const { promise, cancel } = apiAiVoice(blob, chatId ?? undefined);
    cancelRef.current = cancel;
    const r = await promise;
    if (!r.ok) {
      setError(r.reason);
      setPhase('error');
      return;
    }
    setRecognized(r.data.recognizedText);
    void refreshAiState();

    /* Команда навигации/управления — закрытый список (voiceCommands.ts).
       Само распознавание и ответ модели уже ушли в обычную историю Sky
       AI на сервере; здесь просто выполняем действие вместо того, чтобы
       показывать и озвучивать болтовню модели поверх него. */
    const command = matchVoiceCommand(r.data.recognizedText);
    if (command) {
      setPhase('command');
      await command.run();
      setAnswerText(command.label);
      setTimeout(onClose, 1100);
      return;
    }

    setAnswerText(r.data.answer.text);
    onTurn(r.data);

    if (r.data.audio) {
      setPhase('speaking');
      const src = `data:${r.data.audioMime ?? 'audio/mpeg'};base64,${r.data.audio}`;
      // Тот же элемент, что «разбудили» по нажатию: новый <audio> iOS не пустил бы.
      const el = audioElRef.current ?? new Audio();
      audioElRef.current = el;
      el.pause(); el.volume = 1; el.src = src;
      el.onended = () => followUp(r.data.answer.text);
      el.onerror = () => speakInBrowser(r.data.answer.text);
      void el.play().catch(() => speakInBrowser(r.data.answer.text));
    } else {
      speakInBrowser(r.data.answer.text);
    }
  };

  const stopSpeaking = () => {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    audioElRef.current?.pause();
    audioElRef.current = null;
    setPhase('idle');
  };

  const orbScale = phase === 'listening' ? 1 + level * 0.35 : phase === 'speaking' ? [1, 1.08, 1] : 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'radial-gradient(circle at 50% 30%, rgba(99,60,180,0.35), rgba(8,6,20,0.97) 65%)',
        backdropFilter: 'blur(16px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
      <button type="button" onClick={onClose} aria-label="Закрыть голосовой режим"
        style={{ position: 'absolute', top: 20, right: 20, color: 'rgba(255,255,255,0.6)' }}>
        <X size={22}/>
      </button>

      <div className="flex flex-col items-center gap-8 px-6 text-center" style={{ maxWidth: 380 }}>
        <motion.div
          animate={{ scale: orbScale }}
          transition={phase === 'speaking' ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { type: 'spring', stiffness: 200, damping: 20 }}
          style={{
            width: 132, height: 132, borderRadius: '50%',
            background: 'linear-gradient(135deg,#a855f7,#6366f1)',
            boxShadow: `0 0 ${40 + level * 60}px rgba(168,85,247,${0.35 + level * 0.35})`,
            display: 'grid', placeItems: 'center',
          }}>
          {phase === 'processing'
            ? <Loader2 size={40} className="animate-spin" color="#fff"/>
            : phase === 'speaking'
              ? <Volume2 size={40} color="#fff"/>
              : phase === 'error'
                ? <AlertTriangle size={36} color="#fff"/>
                : phase === 'command'
                  ? <Check size={40} color="#fff"/>
                  : <Mic size={40} color="#fff"/>}
        </motion.div>

        {/* Волна — реальная амплитуда микрофона, не декорация */}
        {phase === 'listening' && (
          <div className="flex items-end gap-1" style={{ height: 28 }}>
            {Array.from({ length: 24 }).map((_, i) => {
              const jitter = 0.5 + Math.abs(Math.sin(i * 1.7 + Date.now() / 300)) * 0.5;
              const h = 4 + level * 24 * jitter;
              return <div key={i} style={{ width: 3, height: h, borderRadius: 2, background: 'rgba(255,255,255,0.7)' }}/>;
            })}
          </div>
        )}

        <div>
          <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {phase === 'idle' && 'Нажмите и говорите'}
            {phase === 'listening' && 'Слушаю...'}
            {phase === 'processing' && 'Распознаю...'}
            {phase === 'speaking' && 'Sky AI отвечает'}
            {phase === 'command' && `Открываю: ${answerText}`}
            {phase === 'error' && (error || 'Что-то пошло не так')}
          </p>
          {recognized && phase !== 'idle' && phase !== 'error' && phase !== 'command' && (
            <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.55)' }}>«{recognized}»</p>
          )}
          {answerText && (phase === 'speaking' || phase === 'idle') && (
            <p className="text-sm mt-3 leading-relaxed" style={{ color: 'rgba(255,255,255,0.9)' }}>{answerText}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {phase === 'idle' && (
            <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={() => void startListening()}
              className="rounded-full px-6 py-3 text-sm font-bold"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
              Говорить
            </motion.button>
          )}
          {phase === 'listening' && (
            <>
              <button type="button" onClick={cancelListening}
                className="rounded-full px-5 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Отмена
              </button>
              <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={stopListening}
                className="grid h-14 w-14 place-items-center rounded-full"
                style={{ background: '#ef4444' }}>
                <Square size={20} color="#fff" fill="#fff"/>
              </motion.button>
            </>
          )}
          {phase === 'speaking' && (
            <button type="button" onClick={stopSpeaking}
              className="rounded-full px-5 py-2.5 text-sm font-bold"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
              Стоп
            </button>
          )}
          {phase === 'error' && (
            <button type="button" onClick={() => setPhase('idle')}
              className="rounded-full px-6 py-3 text-sm font-bold"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}>
              Повторить
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
