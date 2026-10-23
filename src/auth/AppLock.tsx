/**
 * Блокировка приложения кодом и Face ID / отпечатком — везде: .apk/.ipa, веб и Windows-приложение.
 *
 * ЗАМОК ДЕРЖИТ СЕРВЕР (server/applock.mjs). Экран здесь только показывает его состояние и отправляет код/подпись на проверку:
 *   • закрытая сессия получает 423 `app_locked` на любой запрос и не получает сокет — стереть флаг в браузере или подменить заголовок
 *     эффекта не имеет, данные без кода не отдаются;
 *   • код проверяет сервер (перебор: паузы, после 15 неверных сессия завершается);
 *   • биометрия в браузере — WebAuthn: подпись проверяет сервер по ключу, сохранённому при включении; в .apk/.ipa — системная
 *     биометрия телефона (серверу её не доказать, отладка WebView в релизе выключена);
 *   • «давно не было пульса» (вкладка в фоне) закрывает сессию на сервере САМО — пульсом её потом не открыть.
 * Локально хранится только кэш «замок включён» и хеш кода — чтобы показать замок сразу при запуске и открыть приложение без сети
 * (офлайн-режим: данных сервера там нет; при появлении сети код отправится на сервер сам).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, ScanFace } from 'lucide-react';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { flash } from '@/shared/flash';
import { useAuthStore } from '@/core/auth/store';
import { apiCall } from '@/core/auth/api';

const KEY = 'sky:applock:v1';
const CODE_KEY = 'sky:applock:code:v1';
const GRACE_HIDDEN_SEC = 30;
const PING_MS = 25_000;
const isMobileApp = () => typeof window !== 'undefined' && Boolean((window as any).Capacitor?.isNativePlatform?.());
const lockKind = () => (isMobileApp() ? 'native' : (window as any).sky?.secureStorage ? 'desktop' : 'web');
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const write = (on: boolean) => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* память устройства недоступна */ } };

/* ── Код: локальный хеш — только для офлайн-входа ── */
const bytesToHex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const derive = async (code: string, salt: Uint8Array) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  return bytesToHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' }, key, 256));
};
const saveCode = async (code: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  try { localStorage.setItem(CODE_KEY, JSON.stringify({ salt: bytesToHex(salt), hash: await derive(code, salt) })); } catch { /* ok */ }
};
const checkLocalCode = async (code: string) => {
  try {
    const { salt, hash } = JSON.parse(localStorage.getItem(CODE_KEY) ?? '');
    const s = Uint8Array.from((salt as string).match(/../g) ?? [], (h) => parseInt(h, 16));
    return (await derive(code, s)) === hash;
  } catch { return false; }
};
const clearCode = () => { try { localStorage.removeItem(CODE_KEY); } catch { /* ok */ } };

/* ── Сервер ── */
const GET = () => apiCall<any>('/api/skyid/applock');
const POST = (p: string, body: unknown = {}) => apiCall<any>(`/api/skyid/applock${p}`, { method: 'POST', body: JSON.stringify(body) });
const REASON: Record<string, string> = {
  invalid_pin: 'Неверный код', too_many_attempts: 'Слишком много попыток', session_ended: 'Сессия завершена: слишком много неверных кодов',
  bad_signature: 'Face ID / отпечаток не подошли', challenge_expired: 'Время вышло, попробуйте ещё раз', no_biometric: 'Face ID / отпечаток не подключены',
  app_locked: 'Приложение заблокировано', method_not_allowed: 'Этот способ здесь недоступен', not_enabled: 'Замок не включён',
};
const reasonOf = (r: { error?: string; reason?: string; data?: any }) => REASON[r.error ?? ''] ?? r.reason ?? 'Не удалось. Попробуйте ещё раз.';

/* ── Биометрия: системная (приложение) и WebAuthn (браузер) ── */
const ask = async (reason: string) => {
  try { await BiometricAuth.authenticate({ reason, cancelTitle: 'Отмена', allowDeviceCredential: false, androidTitle: 'Sky', androidSubtitle: reason }); return true; }
  catch { return false; }
};
const b64 = (b: ArrayBuffer | Uint8Array) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; u.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (t: string) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));
const webBioAvailable = async () => {
  try { return !isMobileApp() && window.isSecureContext && 'PublicKeyCredential' in window && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
};
const webCreate = async (pk: any) => {
  try {
    const c = await navigator.credentials.create({ publicKey: { ...pk, challenge: unb64(pk.challenge), user: { ...pk.user, id: unb64(pk.user.id) } } }) as PublicKeyCredential | null;
    if (!c) return null;
    const r = c.response as AuthenticatorAttestationResponse;
    return { id: b64(c.rawId), response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject) } };
  } catch { return null; }
};
const webGet = async (pk: any) => {
  try {
    const a = await navigator.credentials.get({ publicKey: { ...pk, challenge: unb64(pk.challenge), allowCredentials: (pk.allowCredentials ?? []).map((x: any) => ({ ...x, id: unb64(x.id) })) } }) as PublicKeyCredential | null;
    if (!a) return null;
    const r = a.response as AuthenticatorAssertionResponse;
    return { id: b64(a.rawId), response: { clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) } };
  } catch { return null; }
};
/** Подпись биометрией для сервера (unlock/disable): begin → системное окно → готовая заготовка тела. */
const bioProof = async () => {
  const b = await POST('/unlock/begin');
  if (!b.ok) return null;
  const cred = await webGet(b.data.publicKey);
  return cred ? { method: 'bio', challengeId: b.data.challengeId, credential: cred } : null;
};

/** Код, введённый без сети: отправим на сервер, как только он снова ответит. */
let pendingPin: string | null = null;
/** Холодный запуск страницы: открыть сессию без кода нельзя, даже если сервер ещё не успел её закрыть (до "GRACE" секунд после закрытия вкладки). */
let coldChecked = false;

/** Экран-замок. Монтируется один раз в main.tsx. */
export function AppLockGate() {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const [locked, setLocked] = useState(() => read());       // кэш: замок включён — показываем сразу при запуске
  const [bio, setBio] = useState<'native' | 'web' | null>(isMobileApp() && read() ? 'native' : null);
  const [fails, setFails] = useState(0);
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [wait, setWait] = useState(0);
  const busy = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const lockedRef = useRef(locked); lockedRef.current = locked;

  const refresh = useCallback(async () => {
    const r = await GET();
    if (!r.ok) return;
    if (!r.data.enabled) { write(false); clearCode(); setLocked(false); return; }
    write(true);
    setBio(r.data.kind === 'native' ? 'native' : r.data.bio ? 'web' : null);
    if (r.data.blockedFor > 0) setWait(r.data.blockedFor);
    let isLocked = Boolean(r.data.locked);
    if (!coldChecked) {
      coldChecked = true;
      if (!isLocked && !r.data.fresh) { await POST('/lock'); isLocked = true; }
    }
    setLocked(isLocked);
    if (!isLocked) setCodeMode(false);
  }, []);
  const lockNow = useCallback(() => { setFails(0); setCode(''); setCodeErr(''); setLocked(true); void refresh(); }, [refresh]);
  const onUnlocked = () => { setFails(0); setCode(''); setCodeErr(''); setCodeMode(false); setLocked(false); window.dispatchEvent(new CustomEvent('sky:applock-unlocked')); };

  useEffect(() => { if (authed) void refresh(); }, [authed, refresh]);
  useEffect(() => {
    const on = () => { if (read() || authed) lockNow(); };
    window.addEventListener('sky:applock', on);
    return () => window.removeEventListener('sky:applock', on);
  }, [authed, lockNow]);

  // Пульс: пока приложение на виду и открыто, сервер знает, что оно живо. Без пульса он закроет сессию сам.
  useEffect(() => {
    if (!authed) return undefined;
    const beat = async () => {
      if (lockedRef.current || document.hidden || !read()) return;
      const r = await POST('/ping');
      if (r.ok && r.data.locked) {
        if (pendingPin) { const p = pendingPin; pendingPin = null; const u = await POST('/unlock', { pin: p }); if (u.ok) return; }
        lockNow();
      }
    };
    const t = setInterval(() => void beat(), PING_MS);
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return; }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (read() && away > GRACE_HIDDEN_SEC * 1000) { void POST('/lock'); lockNow(); } else void beat();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [authed, lockNow]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

  const unlockBio = async (auto = false) => {
    if (busy.current || codeMode || !bio) return; busy.current = true;
    let r: { ok: boolean; error?: string; reason?: string; data?: any } = { ok: false };
    if (bio === 'native') { if (await ask('Откройте Sky')) r = await POST('/unlock', { method: 'native' }); }
    else { const proof = await bioProof(); if (proof) r = await POST('/unlock', proof); }
    busy.current = false;
    if (r.ok) { onUnlocked(); return; }
    if (auto && bio === 'web') return;   // браузер мог отклонить запрос без жеста — это не неудача
    setFails((n) => { const next = n + 1; if (next >= 3) setCodeMode(true); return next; });
  };
  const submitCode = async () => {
    if (wait > 0 || code.length < 4 || busy.current) return; busy.current = true;
    const r = await POST('/unlock', { pin: code });
    if (r.status === 0) {   // сервер недоступен: сверяем с локальным хешем, на сервер отправим при первой возможности
      const okLocal = await checkLocalCode(code);
      busy.current = false;
      if (okLocal) { pendingPin = code; onUnlocked(); } else { setCode(''); setCodeErr('Неверный код'); }
      return;
    }
    busy.current = false;
    if (r.ok) { onUnlocked(); return; }
    setCode('');
    if (r.error === 'session_ended') { write(false); clearCode(); useAuthStore.getState().logout(); setLocked(false); return; }
    const retry = Number(r.data?.retryAfter) || 0;
    if (retry) setWait(retry);
    setCodeErr(reasonOf(r));
  };
  useEffect(() => { if (locked && bio) void unlockBio(true); }, [locked, bio]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (locked && !bio) setCodeMode(true); }, [locked, bio]);

  if (!locked) return null;
  return (
    <div data-keep-dark role="dialog" aria-modal="true" aria-label="Приложение заблокировано"
      className="fixed inset-0 z-[100000] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#0b0b12', color: '#fff', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'rgba(139,124,255,0.18)' }}><Lock size={34} /></div>
      <div><p className="text-xl font-bold">Sky заблокирован</p><p className="mt-1 text-sm opacity-60">{bio === 'native' ? 'Подтвердите, что это вы — Face ID или отпечатком.' : bio ? 'Подтвердите, что это вы — Face ID, отпечатком или Windows Hello.' : 'Введите код приложения.'}</p></div>
      {!codeMode ? (
        <>
          <button type="button" onClick={() => void unlockBio()} className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff' }}><ScanFace size={18} />Разблокировать</button>
          {fails > 0 && <p className="text-xs opacity-60">{`Не подошло. Попыток: ${fails} из 3, затем — код приложения.`}</p>}
          <button type="button" onClick={() => setCodeMode(true)} className="text-sm underline opacity-80">Ввести код</button>
        </>
      ) : (
        <div className="w-full max-w-xs space-y-3">
          <p className="text-sm opacity-70">{bio ? 'Введите код приложения.' : 'Код приложения'}</p>
          <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={code} disabled={wait > 0}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setCodeErr(''); }} onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
            className="w-full rounded-2xl px-4 py-3 text-center text-2xl tracking-[0.5em]" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }} />
          {(codeErr || wait > 0) && <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{wait > 0 ? `Слишком много попыток. Подождите ${wait} с.` : codeErr}</p>}
          <button type="button" disabled={wait > 0 || code.length < 4} onClick={() => void submitCode()} className="w-full rounded-full py-3 text-sm font-semibold" style={{ background: '#8b7cff', color: '#fff', opacity: wait > 0 || code.length < 4 ? 0.5 : 1 }}>Войти</button>
          {bio && <button type="button" onClick={() => { setCodeMode(false); setFails(0); void unlockBio(); }} className="text-sm underline opacity-80">Попробовать Face ID снова</button>}
          <button type="button" onClick={() => { write(false); clearCode(); useAuthStore.getState().logout(); setLocked(false); }} className="block w-full text-xs opacity-60">Забыли код? Выйти из аккаунта (после входа код можно задать заново)</button>
        </div>
      )}
    </div>
  );
}

type Mode = null | 'setup' | 'change' | 'off' | 'bio-on' | 'bio-off';
/** Переключатели в Профиль → Sky ID: замок приложения и (где есть) Face ID / отпечаток. Работает в вебе, на телефоне и в Windows. */
export function AppLockSettings() {
  const [st, setSt] = useState<{ enabled: boolean; bio: boolean; fresh: boolean } | null>(null);
  const [availBio, setAvailBio] = useState<boolean | null>(null);   // биометрия доступна на устройстве
  const [mode, setMode] = useState<Mode>(null);
  const [old, setOld] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [busy, setBusy] = useState(false);
  const native = isMobileApp();
  const reload = useCallback(async () => { const r = await GET(); if (r.ok) setSt({ enabled: Boolean(r.data.enabled), bio: Boolean(r.data.bio) || (native && Boolean(r.data.enabled)), fresh: Boolean(r.data.fresh) }); }, [native]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (native) BiometricAuth.checkBiometry().then((r) => setAvailBio(Boolean(r.isAvailable || r.deviceIsSecure))).catch(() => setAvailBio(false));
    else void webBioAvailable().then(setAvailBio);
  }, [native]);
  const close = () => { setMode(null); setOld(''); setN1(''); setN2(''); };
  const on = Boolean(st?.enabled);

  const enrollBio = async (pin: string) => {
    const b = await POST('/bio/begin', { pin });
    if (!b.ok) { flash(reasonOf(b)); return false; }
    const cred = await webCreate(b.data.publicKey);
    if (!cred) { flash('Не удалось подключить Face ID / отпечаток'); return false; }
    const f = await POST('/bio/finish', { challengeId: b.data.challengeId, credential: cred });
    if (!f.ok) { flash(reasonOf(f)); return false; }
    return true;
  };
  const startToggle = async () => {
    if (on) {
      if (native) { if (!(await ask('Отключить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка осталась включённой.'); return; }
        const r = await POST('/disable', { method: 'native' }); if (r.ok) { write(false); clearCode(); await reload(); flash('Блокировка выключена'); } else flash(reasonOf(r)); return; }
      if (st?.bio) { const proof = await bioProof(); if (proof) { const r = await POST('/disable', proof); if (r.ok) { write(false); clearCode(); await reload(); flash('Блокировка выключена'); return; } } }
      setMode('off'); return;
    }
    if (native && !(await ask('Включить блокировку Sky'))) { flash('Не удалось подтвердить. Блокировка не включена.'); return; }
    setMode('setup');
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'setup' || mode === 'change') {
        if (!/^\d{4,6}$/.test(n1)) { flash('Код — от 4 до 6 цифр.'); return; }
        if (n1 !== n2) { flash('Коды не совпадают.'); return; }
        const r = await POST('/enable', { pin: n1, kind: lockKind(), ...(mode === 'change' && !st?.fresh ? { oldPin: old } : {}) });
        if (!r.ok) { flash(reasonOf(r)); return; }
        await saveCode(n1); write(true);
        const wasSetup = mode === 'setup'; close(); await reload();
        if (wasSetup && !native && availBio) {   // сразу предлагаем Face ID / отпечаток (браузер покажет системное окно)
          const ok = await enrollBio(n1); await reload();
          flash(ok ? 'Блокировка включена: код и Face ID / отпечаток' : 'Блокировка включена по коду. Face ID / отпечаток не подключены.');
        } else flash(wasSetup ? 'Блокировка включена' : 'Код изменён');
        return;
      }
      if (!/^\d{4,6}$/.test(old)) { flash('Введите текущий код.'); return; }
      if (mode === 'off') { const r = await POST('/disable', { pin: old }); if (!r.ok) { flash(reasonOf(r)); return; } write(false); clearCode(); close(); await reload(); flash('Блокировка выключена'); }
      else if (mode === 'bio-on') { const ok = await enrollBio(old); close(); await reload(); flash(ok ? 'Face ID / отпечаток подключены' : 'Не удалось подключить Face ID / отпечаток'); }
      else if (mode === 'bio-off') { const r = await POST('/bio/remove', { pin: old }); if (!r.ok) { flash(reasonOf(r)); return; } close(); await reload(); flash('Face ID / отпечаток выключены, остался код'); }
    } finally { setBusy(false); }
  };

  const sw = (checked: boolean, onClick: () => void, disabled = false) => (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onClick}
      className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: checked ? 'var(--accent)' : 'var(--bg-l3)', opacity: disabled ? 0.5 : 1 }}>
      <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: checked ? 22 : 2 }} />
    </button>
  );
  const needsOld = mode === 'off' || mode === 'bio-on' || mode === 'bio-off' || (mode === 'change' && !st?.fresh);
  const title = mode === 'setup' ? 'Придумайте код приложения' : mode === 'change' ? 'Новый код приложения' : 'Введите код приложения';
  const input = 'sky-input';
  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <ScanFace size={20} style={{ color: 'var(--accent)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Блокировка приложения</p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            {availBio
              ? 'Код приложения и Face ID / отпечаток при запуске и после 30 секунд в фоне. Код проверяет сервер: стереть замок в браузере или инструментах разработчика нельзя.'
              : 'Код приложения при запуске и после 30 секунд в фоне. Код проверяет сервер: стереть замок в браузере или инструментах разработчика нельзя.'}
            {availBio === false && native ? ' На этом телефоне не настроены Face ID, отпечаток или код блокировки экрана.' : ''}
            {availBio === false && !native ? ' Face ID и отпечаток здесь недоступны — будет только код.' : ''}
          </p>
        </div>
        {sw(on, () => void startToggle(), st === null || (native && availBio === false))}
      </div>
      {on && (
        <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={() => setMode('change')} className="text-[13px] font-semibold underline" style={{ color: 'var(--accent)' }}>Сменить код</button>
          {!native && availBio && (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>Face ID / отпечаток / Windows Hello</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Открывать приложение без ввода кода. Данные биометрии остаются в устройстве.</p>
              </div>
              {sw(Boolean(st?.bio), () => setMode(st?.bio ? 'bio-off' : 'bio-on'))}
            </div>
          )}
        </div>
      )}
      {mode && (
        <div className="fixed inset-0 z-[100001] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm space-y-3 rounded-t-[28px] p-5 sm:rounded-[28px]" style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <p className="text-base font-bold">{title}</p>
            {mode === 'setup' && <p className="text-xs" style={{ color: 'var(--t3)' }}>Этим кодом открывается приложение, если Face ID или отпечаток не подошли или недоступны. Код проверяет сервер.</p>}
            {needsOld && <input className={input} type="password" inputMode="numeric" maxLength={6} autoFocus placeholder={mode === 'change' ? 'Текущий код' : 'Код'} value={old} onChange={(e) => setOld(e.target.value.replace(/\D/g, ''))} />}
            {(mode === 'setup' || mode === 'change') && <>
              <input className={input} type="password" inputMode="numeric" maxLength={6} placeholder="Код (4–6 цифр)" value={n1} onChange={(e) => setN1(e.target.value.replace(/\D/g, ''))} />
              <input className={input} type="password" inputMode="numeric" maxLength={6} placeholder="Повторите код" value={n2} onChange={(e) => setN2(e.target.value.replace(/\D/g, ''))} />
            </>}
            <div className="flex gap-2">
              <button type="button" onClick={close} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
              <button type="button" disabled={busy} onClick={() => void submit()} className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>{mode === 'off' || mode === 'bio-off' ? 'Выключить' : mode === 'bio-on' ? 'Подключить' : mode === 'change' ? 'Сохранить' : 'Включить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
