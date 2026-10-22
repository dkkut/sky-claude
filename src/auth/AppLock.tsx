/**
 * Блокировка приложения кодом и Face ID / отпечатком — везде: .apk/.ipa, веб и Windows-приложение.
 * Это замок интерфейса на ЭТОМ устройстве: при запуске и после ухода в фон дольше GRACE_SEC закрывает экран,
 * пока не введён код приложения или не пройдена биометрия. Сервер об этом не знает и ничего не хранит.
 * Биометрия: в .apk/.ipa — системная (плагин); в браузере — Face ID / Touch ID / Windows Hello / отпечаток через
 * WebAuthn (ключ создаётся только на этом устройстве и никуда не отправляется; сверяется флаг «пользователь подтверждён»).
 * Где биометрии нет (например, Windows-приложение) — только код. Код обязателен всегда: по нему входят, если биометрия не подошла.
 * Это НЕ вход в аккаунт (он — Passkeys.tsx) и не защита от человека с доступом к браузеру разработчика.
 */
import { useEffect, useRef, useState } from 'react';
import { Lock, ScanFace } from 'lucide-react';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { flash } from '@/shared/flash';
import { useAuthStore } from '@/core/auth/store';

const KEY = 'sky:applock:v1';
const GRACE_SEC = 30;
const isMobileApp = () => typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());

/* ── Биометрия в браузере (WebAuthn, платформенный аутентификатор, только на этом устройстве) ── */
const WA_KEY = 'sky:applock:wa:v1';
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (t: string) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
const waId = () => { try { return localStorage.getItem(WA_KEY); } catch { return null; } };
const webBioAvailable = async () => {
  try { return !isMobileApp() && window.isSecureContext && 'PublicKeyCredential' in window && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
};
const uvOk = (resp: AuthenticatorResponse) => { const d = (resp as AuthenticatorAssertionResponse).authenticatorData ?? (resp as AuthenticatorAttestationResponse).getAuthenticatorData?.(); return d ? (new Uint8Array(d)[32] & 0x04) !== 0 : true; };
const enrollWebBio = async () => {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Sky' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'sky-app-lock', displayName: 'Sky' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none',
    } }) as PublicKeyCredential | null;
    if (!cred || !uvOk(cred.response)) return false;
    localStorage.setItem(WA_KEY, b64(new Uint8Array(cred.rawId)));
    return true;
  } catch { return false; }
};
const askWebBio = async () => {
  const id = waId(); if (!id) return false;
  try {
    const a = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(id) }],
      userVerification: 'required', timeout: 60000,
    } }) as PublicKeyCredential | null;
    return Boolean(a) && uvOk(a!.response);
  } catch { return false; }
};
const clearWebBio = () => { try { localStorage.removeItem(WA_KEY); } catch { /* ok */ } };
/** Какой способ биометрии настроен на этом устройстве: системный (приложение), браузерный или никакого. */
const bioMethod = (): 'native' | 'web' | null => (isMobileApp() ? 'native' : waId() ? 'web' : null);
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
  const [locked, setLocked] = useState(() => read());
  const hiddenAt = useRef<number | null>(null);
  const busy = useRef(false);
  const [fails, setFails] = useState(0);
  const [codeMode, setCodeMode] = useState(() => read() && !bioMethod());
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [codeFails, setCodeFails] = useState(0);
  const [wait, setWait] = useState(0);
  const method = bioMethod();

  const unlock = async (auto = false) => {
    if (busy.current || codeMode) return; busy.current = true;
    let ok = false;
    // Замок, включённый до появления кода приложения: после двух неудач разрешаем код устройства, чтобы не запереть человека.
    if (method === 'native') ok = await ask('Откройте Sky', !hasCode() && fails >= 2);
    else if (method === 'web') ok = await askWebBio();
    busy.current = false;
    if (ok) { setFails(0); setLocked(false); return; }
    // Автоматический запрос браузер мог отклонить без жеста пользователя — это не неудача.
    if (auto && method === 'web') return;
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
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      if (read() && hiddenAt.current && Date.now() - hiddenAt.current > GRACE_SEC * 1000) { setFails(0); setCodeMode(!bioMethod()); setLocked(true); }
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // Замок включён, а кода и биометрии нет (память очищена частично) — не запираем человека насмерть.
  useEffect(() => { if (locked && !hasCode() && !bioMethod()) { write(false); setLocked(false); } }, [locked]);
  useEffect(() => { if (locked) void unlock(true); }, [locked]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!locked) return null;
  return (
    <div data-keep-dark role="dialog" aria-modal="true" aria-label="Приложение заблокировано"
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#0b0b12', color: '#fff', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'rgba(139,124,255,0.18)' }}><Lock size={34} /></div>
      <div><p className="text-xl font-bold">Sky заблокирован</p><p className="mt-1 text-sm opacity-60">{method === 'native' ? 'Подтвердите, что это вы — Face ID или отпечатком.' : method ? 'Подтвердите, что это вы — Face ID, отпечатком или Windows Hello.' : 'Введите код приложения.'}</p></div>
      {!codeMode ? (
        <>
          <button type="button" onClick={() => void unlock()} className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff' }}><ScanFace size={18} />Разблокировать</button>
          {fails > 0 && <p className="text-xs opacity-60">{`Не подошло. Попыток: ${fails} из ${MAX_BIO_TRIES}, затем — код приложения.`}</p>}
          {hasCode() && <button type="button" onClick={() => setCodeMode(true)} className="text-sm underline opacity-80">Ввести код</button>}
        </>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <p className="text-sm opacity-70">{method ? 'Введите код приложения.' : 'Код приложения'}</p>
          <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={code} disabled={wait > 0}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeErr(''); }} onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
            className="w-full rounded-2xl px-4 py-3 text-center text-2xl tracking-[0.5em]" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }} />
          {codeErr && <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{wait > 0 ? `Слишком много попыток. Подождите ${wait} с.` : codeErr}</p>}
          <button type="button" disabled={wait > 0 || code.length < 4} onClick={() => void submitCode()} className="w-full rounded-full py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff', opacity: wait > 0 || code.length < 4 ? 0.5 : 1 }}>Войти</button>
          {method && <button type="button" onClick={() => { setCodeMode(false); setFails(0); void unlock(); }} className="text-sm underline opacity-80">Попробовать Face ID снова</button>}
          <button type="button" onClick={() => { clearCode(); clearWebBio(); write(false); useAuthStore.getState().logout(); setLocked(false); }} className="block w-full text-xs opacity-60">Забыли код? Выйти из аккаунта (замок будет снят)</button>
        </div>
      )}
    </div>
  );
}

/** Переключатели в Профиль → Sky ID: замок приложения и (где есть) Face ID / отпечаток. Работает в вебе, на телефоне и в Windows. */
export function AppLockSettings() {
  const [on, setOn] = useState(read);
  const [avail, setAvail] = useState<boolean | null>(null);       // биометрия доступна на устройстве
  const [bio, setBio] = useState(() => bioMethod() !== null);     // биометрия включена
  const [setting, setSetting] = useState(false);
  const [c1, setC1] = useState(''); const [c2, setC2] = useState('');
  const [confirmOff, setConfirmOff] = useState(false);
  const [offCode, setOffCode] = useState('');
  const native = isMobileApp();
  useEffect(() => {
    if (native) BiometricAuth.checkBiometry().then((r) => setAvail(Boolean(r.isAvailable || r.deviceIsSecure))).catch(() => setAvail(false));
    else void webBioAvailable().then(setAvail);
  }, [native]);

  const turnOff = () => { write(false); clearCode(); clearWebBio(); setOn(false); setBio(native); setConfirmOff(false); setOffCode(''); flash('Блокировка выключена'); };
  const toggle = async () => {
    if (on) {
      // Выключить может только тот, кто подтвердит себя: биометрией, если она есть, иначе кодом приложения.
      if (native) { if (!(await ask('Отключить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка осталась включённой.'); return; } turnOff(); return; }
      if (waId()) { if (!(await askWebBio())) { setConfirmOff(true); return; } turnOff(); return; }
      setConfirmOff(true); return;
    }
    if (native && !(await ask('Включить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка не включена.'); return; }
    setC1(''); setC2(''); setSetting(true);   // код приложения нужен всегда: по нему входят, если биометрия не подошла
  };
  const finishSetup = async () => {
    if (!/^\d{4,6}$/.test(c1)) { flash('Код — от 4 до 6 цифр.'); return; }
    if (c1 !== c2) { flash('Коды не совпадают.'); return; }
    await saveCode(c1); write(true); setOn(true); setSetting(false);
    if (!native && avail) {   // сразу предлагаем Face ID / отпечаток (браузер покажет системное окно)
      const ok = await enrollWebBio(); setBio(ok);
      flash(ok ? 'Блокировка включена: код и Face ID / отпечаток' : 'Блокировка включена по коду. Face ID / отпечаток не подключены.');
    } else flash('Блокировка включена');
  };
  const toggleBio = async () => {
    if (bio) { clearWebBio(); setBio(false); flash('Face ID / отпечаток выключены, остался код'); return; }
    const ok = await enrollWebBio(); setBio(ok); flash(ok ? 'Face ID / отпечаток подключены' : 'Не удалось подключить Face ID / отпечаток');
  };
  const submitOff = async () => { if (await checkCode(offCode)) turnOff(); else { setOffCode(''); flash('Неверный код'); } };

  const sw = (checked: boolean, onClick: () => void, disabled = false) => (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onClick}
      className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: checked ? 'var(--accent)' : 'var(--bg-l3)', opacity: disabled ? 0.5 : 1 }}>
      <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: checked ? 22 : 2 }} />
    </button>
  );
  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Блокировка приложения</p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            {avail
              ? 'Код приложения и Face ID / отпечаток при запуске и после 30 секунд в фоне. Замок только на этом устройстве, сервер о нём не знает.'
              : 'Код приложения при запуске и после 30 секунд в фоне. Замок только на этом устройстве, сервер о нём не знает.'}
            {avail === false && native ? ' На этом телефоне не настроены Face ID, отпечаток или код блокировки экрана.' : ''}
            {avail === false && !native ? ' Face ID и отпечаток здесь недоступны — будет только код.' : ''}
          </p>
        </div>
        {sw(on, () => void toggle(), native && avail === false)}
      </div>
      {on && !native && avail && (
        <div className="mt-3 flex items-center gap-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>Face ID / отпечаток / Windows Hello</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Открывать приложение без ввода кода. Данные биометрии остаются в устройстве.</p>
          </div>
          {sw(bio, () => void toggleBio())}
        </div>
      )}
      {setting && (
        <div className="fixed inset-0 z-[100001] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div role="dialog" aria-modal="true" aria-label="Код приложения" className="w-full max-w-sm space-y-3 rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <p className="text-base font-bold">Придумайте код приложения</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Этим кодом открывается приложение, если Face ID или отпечаток не подошли или недоступны. Он хранится только на этом устройстве.</p>
            <input className="sky-input" type="password" inputMode="numeric" maxLength={6} placeholder="Код (4–6 цифр)" value={c1} onChange={(e) => setC1(e.target.value.replace(/\D/g, ''))} />
            <input className="sky-input" type="password" inputMode="numeric" maxLength={6} placeholder="Повторите код" value={c2} onChange={(e) => setC2(e.target.value.replace(/\D/g, ''))} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setSetting(false)} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
              <button type="button" onClick={() => void finishSetup()} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Включить</button>
            </div>
          </div>
        </div>
      )}
      {confirmOff && (
        <div className="fixed inset-0 z-[100001] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div role="dialog" aria-modal="true" aria-label="Выключить блокировку" className="w-full max-w-sm space-y-3 rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <p className="text-base font-bold">Введите код приложения</p>
            <input className="sky-input" type="password" inputMode="numeric" maxLength={6} autoFocus placeholder="Код" value={offCode} onChange={(e) => setOffCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && void submitOff()} />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setConfirmOff(false); setOffCode(''); }} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
              <button type="button" onClick={() => void submitOff()} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Выключить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
