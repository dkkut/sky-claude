/**
 * Вывод звука на другое устройство (колонка, наушники, магнитола по Bluetooth).
 * ЧЕСТНО об ограничениях: Bluetooth передаёт ЗВУК, а не состояние приложения и не видео. Страница может выбрать устройство вывода,
 * только если браузер даёт `selectAudioOutput` и `setSinkId` (Chrome/Edge на ПК и Android). В iOS/Safari и в части приложений выбор делает система:
 * подключите устройство в настройках Bluetooth — Sky зазвучит на нём. Видео по Bluetooth так не передаётся.
 */
const KEY = 'sky:audio-sink';
type SinkEl = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

export const canPickOutput = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'selectAudioOutput' in navigator.mediaDevices && typeof (HTMLMediaElement.prototype as SinkEl).setSinkId === 'function';

const apply = (el: SinkEl, id: string) => { if (id && typeof el.setSinkId === 'function') void el.setSinkId(id).catch(() => { /* устройство пропало — остаётся системное */ }); };
export const currentSink = (): { id: string; label: string } | null => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v?.id ? v : null; } catch { return null; } };

/** Спросить у человека устройство вывода (нужен жест) и применить ко всем <audio>/<video>. */
export const pickOutput = async (): Promise<{ ok: boolean; label?: string; reason?: 'unsupported' | 'denied' | 'failed' }> => {
  if (!canPickOutput()) return { ok: false, reason: 'unsupported' };
  try {
    const d = await (navigator.mediaDevices as unknown as { selectAudioOutput: () => Promise<MediaDeviceInfo> }).selectAudioOutput();
    try { localStorage.setItem(KEY, JSON.stringify({ id: d.deviceId, label: d.label })); } catch { /* приватный режим */ }
    document.querySelectorAll('audio,video').forEach((e) => apply(e as SinkEl, d.deviceId));
    return { ok: true, label: d.label };
  } catch (e) {
    return { ok: false, reason: (e as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'failed' };
  }
};
export const resetOutput = () => {
  try { localStorage.removeItem(KEY); } catch { /* */ }
  document.querySelectorAll('audio,video').forEach((e) => apply(e as SinkEl, 'default'));
};

/** Новые плееры создают свои элементы позже: при их запуске применяем сохранённое устройство. Подключается один раз. */
let hooked = false;
export const hookOutput = () => {
  if (hooked || typeof document === 'undefined' || !(HTMLMediaElement.prototype as SinkEl).setSinkId) return;
  hooked = true;
  document.addEventListener('play', (e) => { const s = currentSink(); if (s && e.target instanceof HTMLMediaElement) apply(e.target as SinkEl, s.id); }, true);
};
