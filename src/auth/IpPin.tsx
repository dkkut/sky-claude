/**
 * PIN-код при смене IP (server/ippin.mjs).
 *  - IpPinOverlay: закрывающий экран, когда сервер ответил 403 pin_required (сессия с нового адреса).
 *  - IpPinSettings: настройка в Профиль → Sky ID → Защита (включить, сменить, выключить, сбросить).
 * Сбросить забытый PIN можно только кодом с почты И кодом из аутентификатора вместе.
 */
import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { Lock, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { apiCall, setPinRequiredHandler, explain } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';

interface PinState { enabled: boolean; canEnable: boolean; missing: { email: boolean; authenticator: boolean }; lockedFor: number }

const usePinLock = create<{ locked: boolean; set: (v: boolean) => void }>((set) => ({ locked: false, set: (locked) => set({ locked }) }));

const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);
const mins = (sec?: number) => (sec ? ` Подождите ${Math.max(1, Math.ceil(sec / 60))} мин.` : '');
const why = (r: { error?: string; data?: unknown }) => {
  const d = (r.data ?? {}) as { left?: number; lockedFor?: number };
  return `${explain(r.error)}${r.error === 'wrong_pin' && d.left != null ? ` Осталось попыток: ${d.left}.` : ''}${r.error === 'locked' ? mins(d.lockedFor) : ''}`;
};

const inputCls = 'w-full rounded-full px-5 py-3 text-center text-[18px] font-bold tracking-[0.35em] outline-none';
const inputSt = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' } as const;
const btnCls = 'flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold disabled:opacity-50';

/** Сброс забытого PIN: код на почту + код аутентификатора (+ новый PIN или выключение). */
const ResetForm = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const [sent, setSent] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [totp, setTotp] = useState('');
  const [newPin, setNewPin] = useState('');
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const start = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ emailHint?: string }>('/api/skyid/pin/reset/start', { method: 'POST', body: '{}' });
    setBusy(false);
    if (r.ok) setSent(r.data?.emailHint ?? ''); else setErr(r.error === 'email_failed' ? 'Не удалось отправить письмо. Попробуйте ещё раз.' : explain(r.error));
  };
  const finish = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ left?: number }>('/api/skyid/pin/reset/finish', { method: 'POST', body: JSON.stringify({ emailCode, totp, newPin: off ? '' : newPin }) });
    setBusy(false);
    if (r.ok) { onDone(); return; }
    setErr(explain(r.error) + (r.error === 'bad_codes' && r.data?.left != null ? ` Осталось попыток: ${r.data.left}.` : ''));
  };

  return (
    <div className="space-y-3">
      {sent === null ? (
        <>
          <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>Для сброса понадобятся <b>оба</b> кода: из письма на вашу почту и из приложения-аутентификатора.</p>
          <button type="button" disabled={busy} onClick={() => void start()} className={btnCls} style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Отправить код на почту
          </button>
        </>
      ) : (
        <>
          <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>Код отправлен на <b translate="no">{sent || 'вашу почту'}</b> и действует 15 минут.</p>
          <input value={emailCode} onChange={(e) => setEmailCode(digits(e.target.value, 6))} inputMode="numeric" autoFocus placeholder="Код с почты" aria-label="Код с почты" className={inputCls} style={inputSt} />
          <input value={totp} onChange={(e) => setTotp(digits(e.target.value, 6))} inputMode="numeric" placeholder="Код из аутентификатора" aria-label="Код из аутентификатора" className={inputCls} style={inputSt} />
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--t2)' }}>
            <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> Просто выключить PIN
          </label>
          {!off && <input value={newPin} onChange={(e) => setNewPin(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Новый PIN" aria-label="Новый PIN" className={inputCls} style={inputSt} />}
          <button type="button" disabled={busy || emailCode.length !== 6 || totp.length !== 6 || (!off && newPin.length !== 4)} onClick={() => void finish()} className={btnCls} style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? 'Проверяем…' : off ? 'Выключить PIN' : 'Задать новый PIN'}
          </button>
        </>
      )}
      {err && <p className="text-[12.5px]" style={{ color: 'var(--red)' }}>{err}</p>}
      <button type="button" onClick={onCancel} className="w-full text-[12.5px]" style={{ color: 'var(--t3)' }}>Назад</button>
    </div>
  );
};

/** Закрывающий экран: сессия пришла с нового адреса, нужен PIN. */
export const IpPinOverlay = () => {
  const { locked, set } = usePinLock();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => { setPinRequiredHandler(() => set(true)); return () => setPinRequiredHandler(null); }, [set]);

  const submit = useCallback(async (value: string) => {
    setBusy(true); setErr('');
    const r = await apiCall('/api/skyid/pin/verify', { method: 'POST', body: JSON.stringify({ pin: value }) });
    setBusy(false);
    if (r.ok) { try { sessionStorage.setItem('sky:pin-reload', '1'); } catch { /* память недоступна */ } set(false); location.reload(); return; }
    if (r.error === 'session_ended') { set(false); logout(); return; }
    setPin(''); setErr(why(r));
  }, [set, logout]);

  if (!locked) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100003] grid place-items-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-[380px] rounded-[28px] p-6 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <Lock size={26} className="mx-auto" style={{ color: 'var(--accent)' }} />
        <p className="mt-3 text-[16px] font-bold">Подтвердите, что это вы</p>
        {!reset ? (
          <div className="mt-3 space-y-3">
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--t2)' }}>Вы зашли с нового адреса. Введите PIN-код из настроек Sky ID.</p>
            <input value={pin} onChange={(e) => { const v = digits(e.target.value, 4); setPin(v); if (v.length === 4) void submit(v); }} inputMode="numeric" type="password" autoFocus placeholder="••••" aria-label="PIN-код"
              className={inputCls} style={inputSt} />
            {busy && <Loader2 size={16} className="mx-auto animate-spin" style={{ color: 'var(--t3)' }} />}
            {err && <p className="text-[12.5px]" style={{ color: 'var(--red)' }}>{err}</p>}
            <button type="button" onClick={() => { setReset(true); setErr(''); }} className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>Забыли PIN?</button>
            <button type="button" onClick={() => { set(false); logout(); }} className="block w-full text-[12.5px]" style={{ color: 'var(--t3)' }}>Выйти из аккаунта</button>
          </div>
        ) : (
          <div className="mt-3 text-left">
            <ResetForm onDone={() => { set(false); location.reload(); }} onCancel={() => setReset(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

/** Настройка в Профиль → Sky ID → Защита. */
export const IpPinSettings = () => {
  const [st, setSt] = useState<PinState | null>(null);
  const [mode, setMode] = useState<'idle' | 'enable' | 'change' | 'disable' | 'reset'>('idle');
  const [pin, setPin] = useState(''); const [pin2, setPin2] = useState(''); const [old, setOld] = useState(''); const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => { const r = await apiCall<PinState>('/api/skyid/pin'); if (r.ok && r.data) setSt(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const close = () => { setMode('idle'); setPin(''); setPin2(''); setOld(''); setTotp(''); };
  const run = async (path: string, body: object, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await apiCall(path, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: okText }); close(); void load(); } else setMsg({ ok: false, text: why(r) });
  };

  const box = { background: 'var(--bg-l2)', border: '1px solid var(--border)' } as const;
  return (
    <div className="space-y-2 rounded-2xl p-3" style={box}>
      <div className="flex items-center gap-2">
        <Lock size={15} style={{ color: 'var(--accent)' }} />
        <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>PIN-код при смене IP</p>
        {st?.enabled && <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>включён</span>}
      </div>
      <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        По желанию: если запросы вашей сессии придут с адреса, где вы ещё не были, Sky попросит ввести четыре цифры, которые задали вы.
        Так украденный вход не откроет аккаунт. Забытый PIN сбрасывается кодом с почты и кодом из аутентификатора.
      </p>
      {!st ? <Loader2 size={15} className="animate-spin" style={{ color: 'var(--t3)' }} /> : (
        <>
          {!st.enabled && !st.canEnable && (
            <p className="text-[11.5px]" style={{ color: 'var(--red)' }}>
              Чтобы включить PIN, нужны {st.missing.email ? 'подтверждённая почта' : ''}{st.missing.email && st.missing.authenticator ? ' и ' : ''}{st.missing.authenticator ? 'аутентификатор (двухэтапная защита приложением)' : ''} — на случай, если PIN будет забыт.
            </p>
          )}
          {mode === 'idle' && (
            <div className="flex flex-wrap gap-2">
              {!st.enabled && <button type="button" disabled={!st.canEnable} onClick={() => setMode('enable')} className="rounded-full px-4 py-2 text-[12.5px] font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Включить PIN</button>}
              {st.enabled && <>
                <button type="button" onClick={() => setMode('change')} className="rounded-full px-4 py-2 text-[12.5px] font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Сменить PIN</button>
                <button type="button" onClick={() => setMode('disable')} className="rounded-full px-4 py-2 text-[12.5px] font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Выключить</button>
                <button type="button" onClick={() => setMode('reset')} className="rounded-full px-4 py-2 text-[12.5px] font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--accent)' }}>Забыл PIN</button>
              </>}
            </div>
          )}
          {mode === 'enable' && (
            <div className="space-y-2">
              <input value={pin} onChange={(e) => setPin(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Придумайте PIN (4 цифры)" aria-label="PIN" className={inputCls} style={inputSt} />
              <input value={pin2} onChange={(e) => setPin2(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Повторите PIN" aria-label="Повтор PIN" className={inputCls} style={inputSt} />
              <input value={totp} onChange={(e) => setTotp(digits(e.target.value, 6))} inputMode="numeric" placeholder="Код из аутентификатора" aria-label="Код из аутентификатора" className={inputCls} style={inputSt} />
              <button type="button" disabled={busy || pin.length !== 4 || pin !== pin2 || totp.length !== 6} onClick={() => void run('/api/skyid/pin/enable', { pin, totp }, 'PIN включён.')} className={btnCls} style={{ background: 'var(--accent)', color: '#fff' }}><ShieldCheck size={15} /> Включить</button>
              {pin.length === 4 && pin2.length === 4 && pin !== pin2 && <p className="text-[11.5px]" style={{ color: 'var(--red)' }}>PIN не совпадает с повтором.</p>}
              <button type="button" onClick={close} className="w-full text-[12px]" style={{ color: 'var(--t3)' }}>Отмена</button>
            </div>
          )}
          {mode === 'change' && (
            <div className="space-y-2">
              <input value={old} onChange={(e) => setOld(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Текущий PIN" aria-label="Текущий PIN" className={inputCls} style={inputSt} />
              <input value={pin} onChange={(e) => setPin(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Новый PIN" aria-label="Новый PIN" className={inputCls} style={inputSt} />
              <button type="button" disabled={busy || old.length !== 4 || pin.length !== 4} onClick={() => void run('/api/skyid/pin/change', { pin: old, newPin: pin }, 'PIN изменён.')} className={btnCls} style={{ background: 'var(--accent)', color: '#fff' }}>Сменить</button>
              <button type="button" onClick={close} className="w-full text-[12px]" style={{ color: 'var(--t3)' }}>Отмена</button>
            </div>
          )}
          {mode === 'disable' && (
            <div className="space-y-2">
              <input value={old} onChange={(e) => setOld(digits(e.target.value, 4))} inputMode="numeric" type="password" placeholder="Текущий PIN" aria-label="Текущий PIN" className={inputCls} style={inputSt} />
              <button type="button" disabled={busy || old.length !== 4} onClick={() => void run('/api/skyid/pin/disable', { pin: old }, 'PIN выключен.')} className={btnCls} style={{ background: 'var(--red)', color: '#fff' }}>Выключить PIN</button>
              <button type="button" onClick={close} className="w-full text-[12px]" style={{ color: 'var(--t3)' }}>Отмена</button>
            </div>
          )}
          {mode === 'reset' && <ResetForm onDone={() => { setMsg({ ok: true, text: 'PIN сброшен.' }); close(); void load(); }} onCancel={close} />}
        </>
      )}
      {msg && <p className="text-[12px]" style={{ color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</p>}
    </div>
  );
};
