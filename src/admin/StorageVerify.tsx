/**
 * Страница ссылки из письма: /storage-verify?t=… (без входа в аккаунт, отдельный verify.html).
 * Сервер: server/skystorageaccess.mjs. Открытие ссылки ничего не подтверждает: страница только показывает сведения
 * о запросе. Решение — явное нажатие кнопки и код подтверждения личности владельца (аутентификатор или код на почту).
 */
import { useEffect, useRef, useState } from 'react';
import { Shield, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

interface ReqInfo { when: string; ua?: string; net?: string; reasons?: string[]; expiresAt: string }
interface Lookup { request?: ReqInfo; method?: 'app' | 'email'; error?: string }

const GONE: Record<string, string> = {
  invalid: 'Ссылка недействительна. Откройте письмо ещё раз или дождитесь нового запроса.',
  used: 'Ссылка уже использована.', expired: 'Время на подтверждение вышло — запрос закрыт, доступ не выдан.',
  approved: 'Это подключение уже подтверждено.', denied: 'Это подключение уже отклонено.', revoked: 'Это подключение уже отозвано.',
  no_owner: 'Владелец не найден — подтвердить нельзя.',
};
const DECIDE_ERR: Record<string, string> = {
  admin_token_required: 'Введите токен администратора.', admin_token_invalid: 'Токен администратора не подошёл.', admin_token_missing: 'Токен ещё не создан: Профиль → Sky ID → «Токен администратора».', admin_token_blocked: 'Слишком много неверных токенов — подождите.',
  step_up_required: 'Введите код подтверждения.', step_up_invalid: 'Код не подошёл.', too_many_attempts: 'Слишком много попыток. Подождите минуту.',
};

const fmt = (iso: string) => new Date(iso).toLocaleString();

export const StorageVerifyPage = () => {
  // Токен берём из адреса один раз и сразу убираем из строки браузера, чтобы он не оказался в истории и не ушёл в Referer
  const token = useRef(new URLSearchParams(location.search).get('t') ?? '');
  const [phase, setPhase] = useState<'loading' | 'gone' | 'ready' | 'done'>('loading');
  const [goneMsg, setGoneMsg] = useState('');
  const [info, setInfo] = useState<ReqInfo | null>(null);
  const [method, setMethod] = useState<'app' | 'email'>('email');
  const [code, setCode] = useState('');
  const [tok, setTok] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'approved' | 'denied' | ''>('');

  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    try { history.replaceState(null, '', location.pathname); } catch { /* не критично */ }
    void apiCall<Lookup>('/api/storage/verify/lookup', { method: 'POST', body: JSON.stringify({ token: token.current }) }).then((r) => {
      const d = r.data;
      if (d?.request) { setInfo(d.request); setMethod(d.method ?? 'email'); setPhase('ready'); return; }
      setGoneMsg(GONE[d?.error ?? r.error ?? 'invalid'] ?? GONE.invalid); setPhase('gone');
    });
    return () => { meta.remove(); };
  }, []);

  const decide = async (approve: boolean) => {
    if (approve && code.length !== 6) { setErr('Введите шестизначный код.'); return; }
    if (approve && !tok.trim()) { setErr('Введите токен администратора.'); return; }
    if (!approve && !window.confirm('Отклонить подключение? Сессия этой попытки будет закрыта.')) return;
    setBusy(true); setErr('');
    const r = await apiCall<{ status?: string }>('/api/storage/verify/decide', { method: 'POST', body: JSON.stringify({ token: token.current, approve, code: code.trim(), adminToken: tok.trim() }) });
    setBusy(false);
    if (r.ok) { setResult(approve ? 'approved' : 'denied'); setPhase('done'); return; }
    const e = r.error ?? '';
    if (GONE[e]) { setGoneMsg(GONE[e]); setPhase('gone'); return; }
    setErr(DECIDE_ERR[e] ?? 'Не удалось выполнить. Попробуйте ещё раз.');
  };

  const btn = 'flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold disabled:opacity-50';
  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-10" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[28px] p-6" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="mb-4 flex items-center gap-2"><Shield size={20} style={{ color: 'var(--accent)' }} /><p className="text-[16px] font-bold">Подключение к Sky Storage</p></div>
        {phase === 'loading' && <Loader2 size={18} className="animate-spin" />}
        {phase === 'gone' && <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{goneMsg}</p>}
        {phase === 'ready' && info && (
          <div className="space-y-3">
            <div className="space-y-1 rounded-2xl p-3 text-[12.5px]" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
              <p>Запрошено: <b>{fmt(info.when)}</b></p>
              <p>Устройство: <b translate="no">{info.ua || 'неизвестно'}</b></p>
              <p>Сеть: <b translate="no">{info.net || 'неизвестна'}</b></p>
              {info.reasons?.length ? <p>Почему проверка: <b translate="no">{info.reasons.join(', ')}</b></p> : null}
              <p>Запрос закроется сам: <b>{fmt(info.expiresAt)}</b>. Молчание — это отказ.</p>
            </div>
            <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>
              {'Введите код из приложения-аутентификатора.'} Само открытие этой страницы ничего не подтвердило.
            </p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus placeholder="000000" aria-label="Код подтверждения"
              className="w-full rounded-full px-5 py-3 text-center text-[20px] font-bold tracking-[0.4em] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void decide(true); }} />
            <input value={tok} onChange={(e) => setTok(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Токен администратора" aria-label="Токен администратора" translate="no"
              className="w-full rounded-full px-4 py-3 text-center text-[15px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && tok.trim()) void decide(true); }} />
            <button type="button" disabled={busy || code.length !== 6 || !tok.trim()} onClick={() => void decide(true)} className={btn} style={{ background: 'var(--accent)', color: '#fff' }}><ShieldCheck size={16} /> {busy ? 'Проверяем…' : 'Это я, подтвердить'}</button>
            <button type="button" disabled={busy} onClick={() => void decide(false)} className={btn} style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}><ShieldAlert size={16} /> Это не я, отклонить</button>
            {err && <p className="text-[12.5px]" style={{ color: 'var(--red)' }}>{err}</p>}
          </div>
        )}
        {phase === 'done' && <p className="text-[13.5px]">{result === 'approved' ? 'Подключение подтверждено. Вернитесь в панель — доступ откроется сам.' : 'Подключение отклонено. Сессия этой попытки закрыта, владелец уведомлён.'}</p>}
      </div>
    </div>
  );
};
