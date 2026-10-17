/**
 * Голосовая сессия Sky AI на острове.
 *
 * Не отдельный ассистент: реплики идут в тот же чат Sky AI (apiAiSend /
 * apiAiVoice), команды — из закрытого списка voiceCommands.ts. Звук не
 * записывается и не хранится: распознавание делает браузер (или, когда его
 * нет, короткая запись уходит на сервер ровно на один ход). Уровень волны —
 * настоящий, с анализатора микрофона; если микрофон недоступен — волны нет.
 */
import { create } from 'zustand';
import { speechLocale } from '@/i18n/lang';
import { useSettings } from '@/settings/store';
import { apiAiSend, apiAiVoice } from '@/ai/aiApi';
import { refreshAiState } from '@/ai/aiState';
import { matchVoiceCommand, type VoiceCommand } from '@/ai/voiceCommands';
import { getRecognitionCtor, speakable, chunks, pickVoice, type BrowserRecognition } from '@/ai/speech';
import { useIslandStore } from './islandStore';

export type AiPhase = 'off' | 'detected' | 'listening' | 'processing' | 'speaking' | 'followup' | 'confirm' | 'error';

interface AiSessionState {
  phase: AiPhase;
  heard: string;
  answer: string;
  error: string;
  /** 0..1 с реального микрофона; null — уровня нет (не рисуем волну). */
  level: number | null;
  textMode: boolean;
  confirmLabel: string;
  source: 'manual' | 'wake';
  start: (source: 'manual' | 'wake') => void;
  stop: () => void;
  submitText: (t: string) => void;
  setTextMode: (v: boolean) => void;
  answerConfirm: (yes: boolean) => void;
  /** Остановить только слушание/речь, оставив сессию (кнопка «стоп»). */
  interrupt: () => void;
}

const IDLE_MS = 12_000;
const HARD_IDLE_MS = 60_000;
const SILENCE_MS = 1400;
const NO_SPEECH_MS = 7000;
const MAX_REC_MS = 20_000;

let sid = 0;
let chatId: string | undefined;
let rec: BrowserRecognition | null = null;
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let raf = 0;
let recorder: MediaRecorder | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCmd: VoiceCommand | null = null;
let cancelVoice: (() => void) | null = null;
let unlocked = false;

const clearTimers = () => {
  if (idleTimer) clearTimeout(idleTimer);
  if (endTimer) clearTimeout(endTimer);
  idleTimer = null; endTimer = null;
};

const stopMeter = () => {
  cancelAnimationFrame(raf); raf = 0;
  ctx?.close().catch(() => {}); ctx = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
};

const killRecognition = () => {
  if (rec) { rec.onend = null; rec.onerror = null; rec.onresult = null; try { rec.abort(); } catch { /* уже остановлен */ } rec = null; }
  if (recorder) { recorder.onstop = null; try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* уже */ } recorder = null; }
  cancelVoice?.(); cancelVoice = null;
  stopMeter();
};

const killSpeech = () => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
};

/** iOS пускает озвучку только из касания — «будим» синтез в момент нажатия. */
const unlockSpeech = () => {
  if (unlocked) return;
  unlocked = true;
  try {
    if (typeof speechSynthesis !== 'undefined') {
      const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
    }
  } catch { /* нет синтеза */ }
};

export const useAiSession = create<AiSessionState>((set, get) => {
  const mine = (id: number) => id === sid && get().phase !== 'off';

  const armIdle = (id: number, ms: number) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (mine(id)) get().stop(); }, ms);
  };

  const finishSoon = (id: number, ms: number) => {
    if (endTimer) clearTimeout(endTimer);
    endTimer = setTimeout(() => { if (mine(id)) get().stop(); }, ms);
  };

  const fail = (id: number, msg: string) => {
    if (!mine(id)) return;
    killRecognition();
    set({ phase: 'error', error: msg, level: null });
    finishSoon(id, 7000);
  };

  const speak = (id: number, text: string): Promise<void> => new Promise((resolve) => {
    const st = useSettings.getState().settings;
    const clean = speakable(text);
    if (!st.aiVoiceAnswers || typeof speechSynthesis === 'undefined' || !clean) { resolve(); return; }
    set({ phase: 'speaking', level: null });
    const lang = speechLocale();
    const parts = chunks(clean);
    speechSynthesis.cancel();
    parts.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      u.lang = lang;
      const v = pickVoice(lang); if (v) u.voice = v;
      if (i === parts.length - 1) u.onend = () => resolve();
      u.onerror = () => resolve();
      if (!mine(id)) { resolve(); return; }
      speechSynthesis.speak(u);
    });
  });

  const afterAnswer = async (id: number, text: string) => {
    await speak(id, text);
    if (!mine(id)) return;
    const st = useSettings.getState().settings;
    if (st.aiContinue && /\?\s*$/.test(text.trim()) && !get().textMode) {
      set({ phase: 'followup', heard: '' });
      void listen(id);
      return;
    }
    finishSoon(id, st.aiVoiceAnswers ? 1500 : 9000);
  };

  const runCommand = async (id: number, cmd: VoiceCommand) => {
    set({ phase: 'processing' });
    try {
      const said = await cmd.run();
      if (!mine(id)) return;
      const text = typeof said === 'string' && said ? said : cmd.label;
      set({ phase: 'speaking', answer: text, error: '' });
      if (typeof said === 'string' && said) { await afterAnswer(id, text); return; }
      finishSoon(id, 1600);
    } catch (e) {
      fail(id, e instanceof Error && e.message ? e.message : 'Не получилось выполнить команду');
    }
  };

  const handleText = async (id: number, text: string) => {
    const t = text.trim();
    if (!mine(id)) return;
    if (!t) { if (get().phase === 'followup') armIdle(id, IDLE_MS); else get().stop(); return; }
    set({ heard: t, phase: 'processing', level: null, answer: '', error: '' });
    if (idleTimer) clearTimeout(idleTimer);

    const cmd = matchVoiceCommand(t);
    if (cmd) {
      if (cmd.confirm) {
        pendingCmd = cmd;
        set({ phase: 'confirm', confirmLabel: cmd.confirm });
        armIdle(id, IDLE_MS);
        return;
      }
      await runCommand(id, cmd);
      return;
    }

    const r = await apiAiSend(t, chatId, { voice: true, assist: true });
    if (!mine(id)) return;
    if (!r.ok || !r.answer) { fail(id, r.reason ?? 'Не получилось получить ответ'); return; }
    chatId = r.chatId ?? chatId;
    void refreshAiState();
    set({ answer: r.answer.text });
    await afterAnswer(id, r.answer.text);
  };

  const startMeter = async (id: number): Promise<boolean> => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mine(id)) { stopMeter(); return false; }
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      let lastPaint = 0;
      const tick = (now: number) => {
        an.getByteFrequencyData(data);
        if (now - lastPaint > 50) {
          lastPaint = now;
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          set({ level: Math.min(1, avg / 80) });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return true;
    } catch {
      return false;
    }
  };

  /** Запасной путь без распознавания в браузере: короткая запись на сервер. */
  const listenRecorded = async (id: number) => {
    if (typeof MediaRecorder === 'undefined' || !stream) { fail(id, 'Этот браузер не умеет распознавать речь — напишите текстом'); set({ textMode: true }); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const parts: Blob[] = [];
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = r;
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const started = Date.now();
    let spoke = false; let quietSince = 0;
    const watch = setInterval(() => {
      const lv = get().level ?? 0;
      const now = Date.now();
      if (lv > 0.12) { spoke = true; quietSince = 0; } else if (spoke && !quietSince) quietSince = now;
      const silent = spoke && quietSince && now - quietSince > SILENCE_MS;
      const noSpeech = !spoke && now - started > NO_SPEECH_MS;
      if (silent || noSpeech || now - started > MAX_REC_MS || !mine(id)) {
        clearInterval(watch);
        if (r.state !== 'inactive') r.stop();
      }
    }, 120);
    r.onstop = async () => {
      clearInterval(watch);
      const heard = spoke;
      stopMeter();
      if (!mine(id)) return;
      if (!heard || !parts.length) { if (get().phase === 'followup') armIdle(id, 2000); else get().stop(); return; }
      set({ phase: 'processing', level: null });
      const { promise, cancel } = apiAiVoice(new Blob(parts, { type: r.mimeType || mime || 'audio/webm' }), chatId);
      cancelVoice = cancel;
      const res = await promise;
      cancelVoice = null;
      if (!mine(id)) return;
      if (!res.ok) { fail(id, res.reason); return; }
      chatId = res.data.chatId || chatId;
      void refreshAiState();
      set({ heard: res.data.recognizedText });
      const cmd = matchVoiceCommand(res.data.recognizedText);
      if (cmd && !cmd.confirm) { await runCommand(id, cmd); return; }
      set({ answer: res.data.answer.text });
      await afterAnswer(id, res.data.answer.text);
    };
    r.start();
  };

  const listen = async (id: number) => {
    killRecognition();
    set({ level: null });
    const st = useSettings.getState().settings;
    armIdle(id, st.aiIdleEnd ? IDLE_MS : HARD_IDLE_MS);
    const hasMeter = await startMeter(id);
    if (!mine(id)) return;
    if (!hasMeter && !getRecognitionCtor()) { fail(id, 'Нет доступа к микрофону — разрешите его в настройках браузера или напишите текстом'); set({ textMode: true }); return; }
    if (!hasMeter) {
      // Распознавание может работать и без нашего анализатора, но разрешение обычно общее.
      set({ level: null });
    }
    if (get().phase !== 'followup') set({ phase: 'listening' });
    else set({ phase: 'listening' });

    const C = getRecognitionCtor();
    if (!C) { await listenRecorded(id); return; }
    const r = new C();
    r.lang = speechLocale(); r.continuous = false; r.interimResults = true;
    let text = '';
    r.onresult = (e) => {
      let finalText = ''; let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const part = e.results[i][0]?.transcript ?? '';
        if (e.results[i].isFinal) finalText += part; else interim += part;
      }
      text = finalText || interim;
      if (mine(id)) { set({ heard: text }); armIdle(id, HARD_IDLE_MS); }
    };
    r.onerror = (e) => {
      r.onend = null;
      if (e.error === 'no-speech' || e.error === 'aborted') { if (mine(id)) get().stop(); return; }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { fail(id, 'Нет доступа к микрофону'); set({ textMode: true }); return; }
      if (e.error === 'network') { fail(id, 'Служба распознавания речи браузера недоступна — напишите текстом'); set({ textMode: true }); return; }
      fail(id, 'Не удалось распознать речь');
    };
    r.onend = () => { stopMeter(); rec = null; void handleText(id, text); };
    rec = r;
    try { r.start(); } catch { fail(id, 'Не удалось включить микрофон'); }
  };

  return {
    phase: 'off', heard: '', answer: '', error: '', level: null, textMode: false, confirmLabel: '', source: 'manual',

    start: (source) => {
      if (get().phase !== 'off') return;
      const st = useSettings.getState().settings;
      if (source === 'manual' && !st.aiManualCall) return;
      sid += 1; const id = sid;
      clearTimers(); killSpeech(); unlockSpeech();
      set({ phase: source === 'wake' ? 'detected' : 'listening', heard: '', answer: '', error: '', level: null, textMode: false, source, confirmLabel: '' });
      useIslandStore.getState().push({
        kind: 'ai', mergeKey: 'ai', title: 'Sky AI', ttl: 0, color: '#8b7cff',
      });
      if (source === 'wake') setTimeout(() => { if (mine(id)) void listen(id); }, 450);
      else void listen(id);
    },

    stop: () => {
      sid += 1;
      clearTimers(); killRecognition(); killSpeech();
      pendingCmd = null;
      set({ phase: 'off', level: null, heard: '', answer: '', error: '', textMode: false });
      useIslandStore.getState().resolve('ai');
    },

    interrupt: () => {
      const id = sid;
      killRecognition(); killSpeech();
      if (get().phase === 'off') return;
      set({ phase: 'followup', level: null });
      armIdle(id, HARD_IDLE_MS);
    },

    setTextMode: (v) => {
      if (get().phase === 'off') return;
      if (v) { killRecognition(); killSpeech(); set({ textMode: true, phase: 'followup', level: null }); armIdle(sid, HARD_IDLE_MS); }
      else { set({ textMode: false }); void listen(sid); }
    },

    submitText: (t) => { if (get().phase === 'off') return; killRecognition(); killSpeech(); void handleText(sid, t); },

    answerConfirm: (yes) => {
      const cmd = pendingCmd; pendingCmd = null;
      const id = sid;
      if (!cmd || !mine(id)) return;
      if (yes) void runCommand(id, cmd);
      else { set({ phase: 'speaking', answer: 'Отменено' }); finishSoon(id, 1200); }
    },
  };
});

/** Забыть диалог (после выхода из аккаунта). */
export const resetAiSessionChat = () => { chatId = undefined; };
