/* Какие аудиоустройства видит браузер. Названия появляются только после разрешения микрофона;
   как именно подключена колонка (Bluetooth, кабель), браузер не сообщает — это не выдумываем. */
import { useCallback, useEffect, useState } from 'react';

export interface AudioDevices { output: string | null; input: string | null; labelsHidden: boolean; supported: boolean }

export const useAudioDevices = (refreshKey: unknown): AudioDevices & { refresh: () => void } => {
  const [st, setSt] = useState<AudioDevices>({ output: null, input: null, labelsHidden: false, supported: true });
  const refresh = useCallback(() => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) { setSt({ output: null, input: null, labelsHidden: false, supported: false }); return; }
    md.enumerateDevices().then((list) => {
      const pick = (kind: MediaDeviceKind) => {
        const all = list.filter((d) => d.kind === kind);
        const d = all.find((x) => x.deviceId === 'default') ?? all[0];
        return d?.label ? d.label.replace(/^Default\s*-\s*/i, '') : null;
      };
      const hasAny = list.some((d) => d.kind === 'audiooutput' || d.kind === 'audioinput');
      const o = pick('audiooutput'), i = pick('audioinput');
      setSt({ output: o, input: i, labelsHidden: hasAny && !o && !i, supported: true });
    }).catch(() => setSt((s) => ({ ...s, supported: false })));
  }, []);
  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh, refreshKey]);
  return { ...st, refresh };
};
