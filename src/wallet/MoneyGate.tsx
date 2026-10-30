/**
 * Замок SkyMoney (клиентская часть). Решает СЕРВЕР (server/moneyguard.mjs): пока в этой сессии не подтверждены устройство и пароль,
 * финансовые запросы получают 403 `money_locked`. Здесь — только экран: ни один финансовый компонент не монтируется, пока сервер не сказал «открыто»
 * (поэтому даже на мгновение при загрузке данных не видно). Что подтверждать, говорит сервер.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Lock, ShieldCheck, Loader2, KeyRound, Mail } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useMoney } from './store';
import { visibleTick } from '@/shared/visibleTick';

interface MoneyStatus {
  unlocked: boolean; needPassword: boolean; needDevice: boolean; passwordSet?: boolean; trustedDevice?: boolean;
  deviceProof?: 'authenticator' | 'email' | 'phone' | null; destination?: string | null; expiresInSec?: number;
}

const TEXT: Record<string, string> = {
  invalid_credentials: 'Неверный пароль', password_required: 'Введите пароль', device_code_required: 'Введите код',
  invalid_code: 'Неверный код', code_expired: 'Код устарел — запросите новый', too_many_attempts: 'Слишком много попыток — попробуйте позже',
  too_many_requests: 'Слишком много попыток — попробуйте позже', too_soon: 'Код уже отправлен — подождите немного',
  no_contact: 'Нет подтверждённой почты или номера для кода', unauthorized: 'Сессия истекла, войдите заново',
};

const wipeFinancialMemory = () => useMoney.setState({ transactions: [] });

export const MoneyGate = ({ children }: { children: ReactNode }) => {
  const [st, setSt] = useState<MoneyStatus | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwd, setPwd] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const alive = useRef(true);

  // Запросы статуса не плодим: каждый финансовый запрос с money_locked присылает событие, и их приходит десяток разом —
  // раньше каждое запускало свой запрос статуса, упираясь в предел и показывая «Не удалось проверить доступ».
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const load = useCallback((): Promise<void> => {
    if (inflight.current) { again.current = true; return inflight.current; }
    const run = async () => {
      let r = await apiCall<MoneyStatus>('/api/skyid/money/status');
      // сеть моргнула, сервер перезапускается или предел — повторяем с паузами, а не сразу показываем ошибку
      for (const wait of [800, 2000, 5000]) {
        if (!alive.current || (r.ok && r.data) || r.error === 'unauthorized') break;
        await new Promise((res) => setTimeout(res, wait));
        r = await apiCall<MoneyStatus>('/api/skyid/money/status');
      }
      if (!alive.current) return;
      if (!r.ok || !r.data) { setErr(TEXT[r.error ?? ''] ?? 'Не удалось проверить доступ. Повторите.'); setSt((p) => p ?? { unlocked: false, needPassword: true, needDevice: false }); return; }
      if (!r.data.unlocked) wipeFinancialMemory();
      setErr(''); setSt(r.data);
    };
    inflight.current = run().finally(() => { inflight.current = null; if (again.current) { again.current = false; void load(); } });
    return inflight.current;
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(visibleTick(() => void load()), 30_000);
    // Любой финансовый запрос, получивший money_locked, сразу возвращает экран блокировки.
    const onLocked = () => { wipeFinancialMemory(); setSt((p) => (p ? { ...p, unlocked: false } : p)); void load(); };
    window.addEventListener('sky:money-locked', onLocked);
    return () => { alive.current = false; clearInterval(t); window.removeEventListener('sky:money-locked', onLocked); };
  }, [load]);

  if (!st) return <div role="status" aria-label="Проверка доступа" className="grid h-full place-items-center"><Loader2 className="animate-spin" size={22} style={{ color: 'var(--t3)' }} /></div>;
  if (st.unlocked) return <>{children}</>;

  const sendCode = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ ok: boolean }>('/api/skyid/money/code', { method: 'POST', body: '{}' });
    setBusy(false);
    if (r.ok) setSent(true); else setErr(TEXT[r.error ?? ''] ?? 'Не удалось отправить код');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await apiCall<MoneyStatus>('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ password: pwd || undefined, code: code || undefined }) });
    setBusy(false);
    if (r.ok && r.data?.unlocked) { setPwd(''); setCode(''); setSt(r.data); return; }
    if (r.ok && r.data) { setSt(r.data); return; }
    setErr(TEXT[r.error ?? ''] ?? 'Не получилось подтвердить доступ'); setPwd('');
  };
  const inp = 'w-full rounded-2xl px-4 py-3 text-base outline-none';
  const sty = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-5" role="region" aria-label="SkyMoney закрыт">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-3xl p-6" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgba(99,102,241,.16)', border: '1px solid rgba(99,102,241,.35)' }}><Lock size={22} style={{ color: 'var(--accent)' }} /></span>
          <div><h2 className="text-lg font-extrabold" style={{ color: 'var(--t1)' }}>SkyMoney закрыт</h2>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Подтвердите доступ, чтобы открыть кошелёк</p></div>
        </div>

        {st.needDevice && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--t1)' }}><ShieldCheck size={15} />Это устройство не подтверждено</p>
            {st.deviceProof === 'authenticator'
              ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Введите код из приложения-аутентификатора.</p>
              : <>
                  <p className="text-xs" style={{ color: 'var(--t3)' }}>Мы отправим код на <span translate="no">{st.destination ?? 'вашу почту'}</span>.</p>
                  <button type="button" disabled={busy} onClick={() => void sendCode()} className="flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}><Mail size={13} />{sent ? 'Отправить ещё раз' : 'Отправить код'}</button>
                </>}
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder="Код" aria-label="Код подтверждения" className={inp} style={sty} />
          </div>
        )}

        {st.needPassword && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--t1)' }}><KeyRound size={15} />Пароль Sky ID</p>
            <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" placeholder="Пароль" aria-label="Пароль Sky ID" className={inp} style={sty} />
          </div>
        )}

        {err && <p role="alert" className="rounded-xl p-3 text-sm" style={{ background: 'rgba(224,90,90,.12)', color: '#e05a5a' }}>{err}</p>}
        {err.startsWith('Не удалось проверить') && <button type="button" onClick={() => { setErr(''); void load(); }} className="w-full rounded-2xl py-2.5 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Повторить проверку</button>}
        <button type="submit" disabled={busy || (st.needPassword && !pwd) || (st.needDevice && !code)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}Открыть SkyMoney
        </button>
        <p className="text-[11px] leading-snug" style={{ color: 'var(--t3)' }}>Доступ проверяет сервер и действует в этой сессии, пока вы пользуетесь SkyMoney. После долгого бездействия кошелёк закроется снова.</p>
      </form>
    </div>
  );
};
