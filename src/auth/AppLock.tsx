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
import { useAuthStore } from '@/core/auth/store';

const KEY = 'sky:applock:v1';
const GRACE_SEC = 30;
const isMobileApp = () => typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const write = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* память устройства недоступна */ } };

const CODE_KEY = 'sky:applock:code:v1';
const MAX_BIO_TRIES = 3;
const bytesToHex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const derive = async (code: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' }, key, 256));
};
const hasCode = () => { try { return Boolean(localStorage.getItem(CODE_KEY)); } catch { return false; } };
const saveCode = async (code: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  try { localStorage.setItem(CODE_KEY, JSON.stringify({ salt: bytesToHex(salt), hash: await derive(code, salt) })); } catch { /* память устройства недоступна */ }
};
const checkCode = async (code: string) => {
  try {
    const { salt, hash } = JSON.parse(localStorage.getItem(CODE_KEY) ?? '');
    const s = Uint8Array.from((salt as string).match(/../g) ?? [], (h) => parseInt(h, 16));
    return (await derive(code, s)) === hash;
  } catch { return false; }
};
const clearCode = () => { try { localStorage.removeItem(CODE_KEY); } catch { /* ok */ } };

/** Только биометрия: неудачи считаем сами, после трёх открывается ввод кода приложения. Код устройства системы не подставляем. */
const ask = async (reason: string, deviceCredential = false) => {
  try { await BiometricAuth.authenticate({ reason, cancelTitle: 'Отмена', allowDeviceCredential: deviceCredential, androidTitle: 'Sky', androidSubtitle: reason }); return true; }
  catch { return false; }
};

/** Экран-замок. Монтируется один раз в main.tsx. */
export function AppLockGate() {
  const [locked, setLocked] = useState(() => isMobileApp() && read());
  const hiddenAt = useRef<number | null>(null);
  const busy = useRef(false);
  const [fails, setFails] = useState(0);
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [codeFails, setCodeFails] = useState(0);
  const [wait, setWait] = useState(0);

  const unlock = async () => {
    if (busy.current || codeMode) return; busy.current = true;
    // Замок включён до появления кода приложения: после двух неудач разрешаем код устройства, чтобы не запереть человека.
    const ok = await ask('Откройте Sky', !hasCode() && fails >= 2);
    busy.current = false;
    if (ok) { setFails(0); setLocked(false); return; }
    setFails((n) => { const next = n + 1; if (next >= MAX_BIO_TRIES && hasCode()) setCodeMode(true); return next; });
  };
  const submitCode = async () => {
    if (wait > 0 || code.length < 4) return;
    if (await checkCode(code)) { setCode(''); setCodeErr(''); setCodeFails(0); setFails(0); setCodeMode(false); setLocked(false); return; }
    const n = codeFails + 1; setCodeFails(n); setCode('');
    // Каждые 5 неверных кодов — пауза, растущая вдвое (30 с, 1 мин, 2 мин…).
    if (n % 5 === 0) setWait(30 * 2 ** (n / 5 - 1)); setCodeErr('Неверный код');
  };
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isMobileApp()) return undefined;
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (read() && hiddenAt.current && Date.now() - hiddenAt.current > GRACE_SEC * 1000) { setFails(0); setCodeMode(false); setLocked(true); }
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  useEffect(() => { if (locked && !hasCode()) { /* кода нет — работает только биометрия */ } if (locked) void unlock(); }, [locked]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!locked) return null;
  return (
    <div data-keep-dark role="dialog" aria-modal="true" aria-label="Приложение заблокировано"
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#0b0b12', color: '#fff', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'rgba(139,124,255,0.18)' }}><Lock size={34} /></div>
      <div><p className="text-xl font-bold">Sky заблокирован</p><p className="mt-1 text-sm opacity-60">Подтвердите, что это вы — Face ID или отпечатком.</p></div>
      {!codeMode ? (
        <>
          <button type="button" onClick={() => void unlock()} className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff' }}><ScanFace size={18} />Разблокировать</button>
          {fails > 0 && <p className="text-xs opacity-60">{`Не подошло. Попыток: ${fails} из ${MAX_BIO_TRIES}, затем — код приложения.`}</p>}
          {hasCode() && fails > 0 && <button type="button" onClick={() => setCodeMode(true)} className="text-sm underline opacity-80">Ввести код</button>}
        </>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <p className="text-sm opacity-70">Face ID не подошёл. Введите код приложения.</p>
          <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={code} disabled={wait > 0}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeErr(''); }} onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
            className="w-full rounded-2xl px-4 py-3 text-center text-2xl tracking-[0.5em]" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }} />
          {codeErr && <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{wait > 0 ? `Слишком много попыток. Подождите ${wait} с.` : codeErr}</p>}
          <button type="button" disabled={wait > 0 || code.length < 4} onClick={() => void submitCode()} className="w-full rounded-full py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff', opacity: wait > 0 || code.length < 4 ? 0.5 : 1 }}>Войти</button>
          <button type="button" onClick={() => { setCodeMode(false); setFails(0); void unlock(); }} className="text-sm underline opacity-80">Попробовать Face ID снова</button>
          <button type="button" onClick={() => { clearCode(); write(false); useAuthStore.getState().logout(); setLocked(false); }} className="block w-full text-xs opacity-60">Забыли код? Выйти из аккаунта (замок будет снят)</button>
        </div>
      )}
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
  const [setting, setSetting] = useState(false);
  const [c1, setC1] = useState(''); const [c2, setC2] = useState('');
  const toggle = async () => {
    if (on) { if (!(await ask('Отключить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка осталась включённой.'); return; } write(false); clearCode(); setOn(false); return; }
    if (!(await ask('Включить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка не включена.'); return; }
    setC1(''); setC2(''); setSetting(true);   // дальше — код приложения на случай, если Face ID не подойдёт
  };
  const finishSetup = async () => {
    if (!/^\d{4,6}$/.test(c1)) { flash('Код — от 4 до 6 цифр.'); return; }
    if (c1 !== c2) { flash('Коды не совпадают.'); return; }
    await saveCode(c1); write(true); setOn(true); setSetting(false); flash('Блокировка включена');
  };
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <ScanFace size={20} style={{ color: 'var(--accent)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Блокировка приложения</p>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          {avail === false ? 'На этом телефоне не настроены Face ID, отпечаток или код блокировки экрана.' : 'Face ID или отпечаток при запуске и после 30 секунд в фоне; после 3 неудач — код приложения. Замок только на этом телефоне.'}
        </p>
      </div>
      <button type="button" role="switch" aria-checked={on} disabled={avail === false} onClick={() => void toggle()}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? 'var(--accent)' : 'var(--bg-l3)', opacity: avail === false ? 0.5 : 1 }}>
        <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
      </button>
      {setting && (
        <div className="fixed inset-0 z-[100001] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div role="dialog" aria-modal="true" aria-label="Код приложения" className="w-full max-w-sm space-y-3 rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <p className="text-base font-bold">Придумайте код приложения</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Если Face ID или отпечаток не подойдут 3 раза, приложение откроется по этому коду. Он хранится только на этом телефоне.</p>
            <input className="sky-input" type="password" inputMode="numeric" maxLength={6} placeholder="Код (4–6 цифр)" value={c1} onChange={(e) => setC1(e.target.value.replace(/\D/g, ''))} />
            <input className="sky-input" type="password" inputMode="numeric" maxLength={6} placeholder="Повторите код" value={c2} onChange={(e) => setC2(e.target.value.replace(/\D/g, ''))} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setSetting(false)} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
              <button type="button" onClick={() => void finishSetup()} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Включить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
