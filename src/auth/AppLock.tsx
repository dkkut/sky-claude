/**
 * Блокировка приложения Face ID / отпечатком (только Android и iOS, .apk/.ipa).
 * Это замок самого приложения на этом телефоне: при запуске и после ухода в фон дольше GRACE_SEC
 * закрывает экран, пока не пройдена биометрия (или код устройства). Сервер об этом не знает и ничего не хранит.
 * Это НЕ вход в аккаунт: вход по ключу доступа — в браузере (Passkeys.tsx); в Windows-приложении блокировки нет.
 */
import { useEffect, useRef, useState } from 'react';
import { Lock, ScanFace } from 'lucide-react';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { flash } from '@/shared/flash';

const KEY = 'sky:applock:v1';
const GRACE_SEC = 30;
const isMobileApp = () => typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const write = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* память устройства недоступна */ } };

const ask = async (reason: string) => {
  try { await BiometricAuth.authenticate({ reason, cancelTitle: 'Отмена', allowDeviceCredential: true, iosFallbackTitle: 'Код устройства', androidTitle: 'Sky', androidSubtitle: reason }); return true; }
  catch { return false; }
};

/** Экран-замок. Монтируется один раз в main.tsx. */
export function AppLockGate() {
  const [locked, setLocked] = useState(() => isMobileApp() && read());
  const hiddenAt = useRef<number | null>(null);
  const busy = useRef(false);

  const unlock = async () => {
    if (busy.current) return; busy.current = true;
    const ok = await ask('Откройте Sky');
    busy.current = false;
    if (ok) setLocked(false);
  };

  useEffect(() => {
    if (!isMobileApp()) return undefined;
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (read() && hiddenAt.current && Date.now() - hiddenAt.current > GRACE_SEC * 1000) setLocked(true);
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => { if (locked) void unlock(); }, [locked]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!locked) return null;
  return (
    <div data-keep-dark role="dialog" aria-modal="true" aria-label="Приложение заблокировано"
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#0b0b12', color: '#fff', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'rgba(139,124,255,0.18)' }}><Lock size={34} /></div>
      <div><p className="text-xl font-bold">Sky заблокирован</p><p className="mt-1 text-sm opacity-60">Подтвердите, что это вы — Face ID, отпечатком или кодом устройства.</p></div>
      <button type="button" onClick={() => void unlock()} className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff' }}><ScanFace size={18} />Разблокировать</button>
    </div>
  );
}

/** Переключатель в Профиль → Sky ID → Ключи доступа. В браузере и Windows-приложении не показывается. */
export function AppLockSettings() {
  const [on, setOn] = useState(read);
  const [avail, setAvail] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isMobileApp()) return;
    BiometricAuth.checkBiometry().then((r) => setAvail(Boolean(r.isAvailable || r.deviceIsSecure))).catch(() => setAvail(false));
  }, []);
  if (!isMobileApp()) return null;
  const toggle = async () => {
    if (on) { if (!(await ask('Отключить блокировку Sky'))) return; write(false); setOn(false); return; }
    if (!(await ask('Включить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка не включена.'); return; }
    write(true); setOn(true);
  };
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <ScanFace size={20} style={{ color: 'var(--accent)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Блокировка приложения</p>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          {avail === false ? 'На этом телефоне не настроены Face ID, отпечаток или код блокировки экрана.' : 'Face ID или отпечаток при запуске и после 30 секунд в фоне. Замок только на этом телефоне.'}
        </p>
      </div>
      <button type="button" role="switch" aria-checked={on} disabled={avail === false} onClick={() => void toggle()}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? 'var(--accent)' : 'var(--bg-l3)', opacity: avail === false ? 0.5 : 1 }}>
        <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
    </div>
  );
}
