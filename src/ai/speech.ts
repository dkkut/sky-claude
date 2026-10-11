/**
 * Общие помощники голоса Sky AI: распознавание речи браузера и подготовка
 * текста к озвучке. Используются и голосовым экраном (VoiceMode), и
 * Sky Island — чтобы не было двух разных реализаций.
 */
import { speechLocale } from '@/i18n/lang';

export interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean;
  /** Chrome: распознавание на устройстве, без отправки звука в сервис. */
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecCtor = (new () => BrowserRecognition) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

export const getRecognitionCtor = (): RecCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecCtor | null;
};
export const browserVoiceAvailable = () => getRecognitionCtor() !== null;

/** 'local' — на устройстве; 'service' — сервис браузера; 'none' — нет вовсе. */
export const recognitionMode = async (): Promise<'local' | 'service' | 'none'> => {
  const C = getRecognitionCtor();
  if (!C) return 'none';
  try {
    if (typeof C.available === 'function') {
      const r = await C.available({ langs: [speechLocale()], processLocally: true });
      if (r === 'available') return 'local';
    }
  } catch { /* старый браузер — считаем сервисом */ }
  return 'service';
};

/** Что читать вслух: без кода и разметки. */
export const speakable = (text: string) => text
  .replace(/```[\s\S]*?```/g, speechLocale().toLowerCase().startsWith('ru') ? ' Код показан на экране. ' : ' The code is shown on screen. ')
  .replace(/[*_`#>|~]+/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\s+/g, ' ').trim();

/** Предложениями: длинную реплику Safari обрывает на середине. */
export const chunks = (text: string) => {
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

export const pickVoice = (lang: string) => {
  const voices = speechSynthesis.getVoices();
  const base = lang.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null;
};
