/**
 * Голосовой ввод текста.
 *
 * Два пути, и оба нужны:
 *  1. Речь самого браузера (Web Speech API) — работает в Chrome/Edge/Safari.
 *     В WebView приложений (Android, iOS) и в Electron её нет вовсе или она
 *     отвечает «network»/«service-not-allowed», потому что у встроенного
 *     движка нет облачного распознавания.
 *  2. Запись с микрофона и расшифровка на сервере (/api/ai/transcribe) —
 *     запасной путь там, где первого нет. Он требует Prime и подключённого
 *     владельцем поставщика расшифровки (STT_BASE_URL), поэтому причина
 *     отказа всегда называется человеку словами.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { speechLocale } from '@/i18n/lang';
import { apiAiState, apiAiUpload, apiAiTranscribe } from '@/ai/aiApi';
import { useAdminStore } from './adminStore';

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
const getCtor = (): (new () => Recognition) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
};

const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
};
const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

const MAX_RECORD_MS = 120_000;

export const useDictation = ({ onText, oneShot = false }: { onText: (text: string) => void; oneShot?: boolean }) => {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const mediaRef = useRef<{ rec: MediaRecorder; stream: MediaStream; timer: number } | null>(null);
  const wantRef = useRef(false);
  const brokenRef = useRef(false); // встроенное распознавание отвечает ошибкой — дальше только запись
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const say = (text: string) => useAdminStore.getState().notify(text);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    const m = mediaRef.current;
    if (m && m.rec.state !== 'inactive') m.rec.stop();
  }, []);
  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort?.();
    const m = mediaRef.current;
    if (m) { clearTimeout(m.timer); if (m.rec.state !== 'inactive') m.rec.stop(); m.stream.getTracks().forEach(t => t.stop()); }
  }, []);

  /** Запись на сервер: останавливается кнопкой или через две минуты. */
  const startRecording = async () => {
    const state = await apiAiState();
    if (!state?.transcription) { say('Распознавание речи на этом устройстве недоступно: на сервере не подключена расшифровка.'); return; }
    if (!state.prime) { say('Голосовой ввод на этом устройстве работает с Prime.'); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { say('Разрешите доступ к микрофону в настройках, чтобы диктовать голосом.'); return; }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      const m = mediaRef.current; if (m) { clearTimeout(m.timer); m.stream.getTracks().forEach(t => t.stop()); }
      mediaRef.current = null; setActive(false);
      if (!chunks.length) return;
      setBusy(true);
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        const ext = (rec.mimeType || mime).includes('mp4') ? 'm4a' : 'webm';
        const up = await apiAiUpload(blob, `dictation.${ext}`).promise;
        if (!up.ok || !up.fileId) { say(up.reason ?? 'Не удалось отправить запись'); return; }
        const tr = await apiAiTranscribe(up.fileId, undefined, speechLocale().slice(0, 2));
        if (!tr.ok) { say(tr.reason); return; }
        if (tr.text.trim()) onTextRef.current(tr.text.trim()); else say('Речь не распознана — попробуйте ещё раз.');
      } finally { setBusy(false); }
    };
    const timer = window.setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, MAX_RECORD_MS);
    mediaRef.current = { rec, stream, timer };
    rec.start();
    setActive(true);
  };

  const startBrowser = (Ctor: new () => Recognition) => {
    const rec = new Ctor();
    rec.lang = speechLocale();
    rec.continuous = !oneShot;
    rec.interimResults = false;
    let failed = false;
    rec.onresult = (e) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal !== false) chunk += e.results[i][0].transcript;
      if (chunk.trim()) onTextRef.current(chunk.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      failed = true;
      if (e.error === 'not-allowed') { say('Разрешите доступ к микрофону в настройках, чтобы диктовать голосом.'); return; }
      if (e.error === 'audio-capture') { say('Микрофон не найден или занят другим приложением.'); return; }
      // network / service-not-allowed / language-not-supported: у встроенного движка нет распознавания.
      brokenRef.current = true;
      if (canRecord()) { void startRecording(); } else say('Распознавание речи на этом устройстве недоступно.');
    };
    rec.onend = () => {
      // Chrome сам завершает непрерывную диктовку после паузы — продолжаем, пока человек не нажал стоп.
      if (wantRef.current && !failed && !oneShot) { try { rec.start(); return; } catch { /* упало — закрываем */ } }
      if (!mediaRef.current) { wantRef.current = false; setActive(false); }
    };
    recRef.current = rec;
    wantRef.current = true;
    try { rec.start(); setActive(true); } catch { wantRef.current = false; setActive(false); }
  };

  const toggle = useCallback(async () => {
    if (busy) return;
    if (active) { stop(); return; }
    const Ctor = getCtor();
    if (Ctor && !brokenRef.current) { startBrowser(Ctor); return; }
    if (canRecord()) { await startRecording(); return; }
    say('Голосовой ввод на этом устройстве недоступен.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, busy, stop, oneShot]);

  /** Кнопку показываем везде, где есть хоть один путь; причину отказа человек увидит при нажатии. */
  const available = getCtor() !== null || canRecord();
  return { available, active, busy, toggle };
};
