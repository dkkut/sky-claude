/**
 * Окно «Введите код аутентификатора» для действий, которые выбивают устройства из аккаунта (сервер отвечает two_factor_required / invalid_code).
 * Использование: `await withAuthCode((code) => apiRevokeDevice(id, code))` — сначала без кода, при отказе спрашиваем код и повторяем.
 * Если аутентификатор не включён, сервер код не просит и окно не появляется.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X } from 'lucide-react';

type Asker = (title: string, hint: string) => Promise<string | null>;
let asker: Asker | null = null;

export const askAuthCode = (title = 'Подтвердите действие', hint = ''): Promise<string | null> => (asker ? asker(title, hint) : Promise.resolve(null));

/** Выполнить действие; если сервер просит код аутентификатора — спросить и повторить (пока не отменят). */
export const withAuthCode = async <T extends { ok: boolean; error?: string }>(run: (code?: string) => Promise<T>, title = 'Подтвердите действие'): Promise<T> => {
  let r = await run();
  while (!r.ok && (r.error === 'two_factor_required' || r.error === 'invalid_code')) {
    const code = await askAuthCode(title, r.error === 'invalid_code' ? 'Неверный код. Попробуйте ещё раз.' : '');
    if (!code) return r;
    r = await run(code);
  }
  return r;
};

export function AuthCodeAsk() {
  const [req, setReq] = useState<{ title: string; hint: string; done: (v: string | null) => void } | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => {
    asker = (title, hint) => new Promise((resolve) => { setCode(''); setReq((prev) => { prev?.done(null); return { title, hint, done: resolve }; }); });
    return () => { asker = null; };
  }, []);
  if (!req) return null;
  const finish = (v: string | null) => { req.done(v); setReq(null); setCode(''); };
  const ok = code.length >= 6;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={req.title} className="fixed inset-0 z-[10075] flex items-center justify-center p-4" style={{ background: 'rgba(5,5,14,.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(null); }}>
      <div className="w-full max-w-[360px] rounded-3xl p-5" style={{ background: 'var(--bg-l1, #14142a)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
          <p className="flex-1 text-[15px] font-bold">{req.title}</p>
          <button type="button" onClick={() => finish(null)} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><X size={16} /></button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>Введите код из приложения-аутентификатора (или резервный код).</p>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11))} autoFocus autoComplete="one-time-code" inputMode="text" aria-label="Код аутентификатора" translate="no"
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) finish(code.trim()); }}
          className="w-full rounded-xl px-3 py-2.5 text-center text-[18px] font-bold tracking-[0.25em] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
        {req.hint && <p className="mt-2 text-[12px]" style={{ color: 'var(--red)' }} role="alert">{req.hint}</p>}
        <button type="button" disabled={!ok} onClick={() => finish(code.trim())} className="mt-3 w-full rounded-full px-5 py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Подтвердить</button>
      </div>
    </div>, document.body);
}
