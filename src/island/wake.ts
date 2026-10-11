/**
 * Фраза «Привет, Скай». Включается только по желанию человека, слушает
 * только пока приложение открыто на экране, ничего не записывает и не
 * хранит. Распознаёт браузер: на устройстве, если он это умеет, иначе его
 * собственная служба — об этом честно сказано в настройках.
 */
import { create } from 'zustand';
import { speechLocale } from '@/i18n/lang';
import { getRecognitionCtor, recognitionMode, type BrowserRecognition } from '@/ai/speech';
import { useAiSession } from './aiSession';
import { isWakePhrase } from './wakeWord';

export type WakeState = 'off' | 'listening' | 'no-permission' | 'unsupported' | 'error';

export const useWake = create<{ state: WakeState; mode: 'local' | 'service' | 'none' }>(() => ({ state: 'off', mode: 'none' }));

let rec: BrowserRecognition | null = null;
let want = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let fails = 0;

const setState = (state: WakeState) => useWake.setState({ state });

const teardown = () => {
  if (timer) clearTimeout(timer); timer = null;
  if (rec) { rec.onend = null; rec.onerror = null; rec.onresult = null; try { rec.abort(); } catch { /* уже */ } rec = null; }
};

const micGranted = async (): Promise<boolean> => {
  try {
    const q = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return q?.state === 'granted';
  } catch { return false; }
};

const begin = async () => {
  if (!want || rec) return;
  if (document.visibilityState !== 'visible' || useAiSession.getState().phase !== 'off') return;
  const C = getRecognitionCtor();
  if (!C) { setState('unsupported'); return; }
  if (!(await micGranted())) { setState('no-permission'); return; }
  if (!want) return;
  const mode = await recognitionMode();
  useWake.setState({ mode });
  const r = new C();
  r.lang = speechLocale(); r.continuous = true; r.interimResults = true;
  if (mode === 'local') r.processLocally = true;
  r.onresult = (e) => {
    let text = '';
    for (let i = Math.max(0, e.results.length - 2); i < e.results.length; i += 1) text += ` ${e.results[i][0]?.transcript ?? ''}`;
    if (isWakePhrase(text)) {
      fails = 0;
      teardown();
      useAiSession.getState().start('wake');
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { want = false; teardown(); setState('no-permission'); return; }
    if (e.error === 'language-not-supported') { want = false; teardown(); setState('unsupported'); return; }
    fails += 1;
  };
  r.onend = () => {
    rec = null;
    if (!want) return;
    if (fails >= 5) { teardown(); setState('error'); return; }
    timer = setTimeout(() => { timer = null; void begin(); }, Math.min(5000, 400 + fails * 800));
  };
  rec = r;
  try { r.start(); setState('listening'); } catch { rec = null; fails += 1; }
};

/** Приводит слушание в соответствие с настройкой и видимостью вкладки. */
export const syncWake = (enabled: boolean) => {
  want = enabled;
  if (!enabled) { teardown(); setState('off'); return; }
  void begin();
};

export const pauseWake = () => { teardown(); if (want) setState('off'); };
export const resumeWake = () => { if (want) { fails = 0; void begin(); } };

/**
 * Разрешение микрофона спрашиваем в момент включения — с объяснением
 * в интерфейсе, а не неожиданно при запуске.
 */
export const requestMicForWake = async (): Promise<boolean> => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
};
