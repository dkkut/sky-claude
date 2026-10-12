/* Защита аккаунта: завершить недавние сессии и/или временно заморозить новые входы.
   Баннер «Разморозка аккаунта» появляется только после перехода по ссылке из письма.
   Серверная часть — server/accountfreeze.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Snowflake, Mail } from 'lucide-react';
import {
  apiFreezeState, apiProtectAccount, apiFreezeResend, apiUnfreeze, apiFreezeLink,
  type FreezeState, type ProtectRequest,
} from '@/core/auth/api';

const fmt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const REMOVE: { key: string; label: string; req: ProtectRequest }[] = [
  { key: 'none', label: 'Не завершать', req: { remove: 'none' } },
  { key: 'last', label: 'Только последний вход', req: { remove: 'last' } },
  { key: 'h1', label: 'Входы за последний час', req: { remove: 'period', hours: 1 } },
  { key: 'h24', label: 'Входы за последние 24 часа', req: { remove: 'period', hours: 24 } },
  { key: 'h168', label: 'Входы за последние 7 дней', req: { remove: 'period', hours: 168 } },
  { key: 'h720', label: 'Входы за последние 30 дней', req: { remove: 'period', hours: 720 } },
];
const FREEZE: { hours: number; label: string }[] = [
  { hours: 0, label: 'Не замораживать' },
  { hours: 1, label: 'На 1 час' },
  { hours: 24, label: 'На сутки' },
  { hours: 72, label: 'На 3 суток' },
  { hours: 168, label: 'На 7 суток' },
];

const EVENT_TEXT: Record<string, string> = {
  freeze: 'Заморожены новые входы',
  cleanup: 'Завершены сессии',
  link_opened: 'Открыта ссылка разморозки',
  unfreeze: 'Новые входы разморожены',
  blocked_login: 'Попытка входа во время заморозки',
};

const sel = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none';
const selStyle = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };

/** Баннер: виден, только пока ссылка из письма подтверждена и заморозка действует. */
const UnfreezeBanner = ({ st, onDone }: { st: FreezeState; onDone: () => void }) => {
  const [totp, setTotp] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const go = async () => {
    if (busy) return; setBusy(true); setErr(undefined);
    const r = await apiUnfreeze(totp || undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не получилось'); return; }
    onDone();
  };
  return (
    <div role="alert" className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--accent-bg)', border: '1px solid rgba(79,110,247,0.35)' }}>
      <div className="flex items-center gap-2"><Snowflake size={18} style={{ color: 'var(--accent)' }} />
        <p className="font-bold" style={{ color: 'var(--t1)' }}>Разморозка аккаунта</p></div>
      <p className="text-sm" style={{ color: 'var(--t2)' }}>Ссылка из письма подтверждена. Новые входы заморожены. Разморозить сейчас?</p>
      {st.until && <p className="text-xs" style={{ color: 'var(--t3)' }}>Заморозка до: <span translate="no">{fmt(st.until)}</span></p>}
      {st.linkUntil && <p className="text-xs" style={{ color: 'var(--t3)' }}>Ссылка действует до: <span translate="no">{fmt(st.linkUntil)}</span></p>}
      {st.needsTotp && (
        <input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Код аутентификатора" aria-label="Код аутентификатора" className={sel} style={selStyle} />
      )}
      {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
      <button type="button" disabled={busy || (st.needsTotp && totp.length !== 6)} onClick={() => void go()}
        className="w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Разморозить новые входы</button>
    </div>
  );
};

export const AccountProtection = ({ onChanged }: { onChanged: () => void }) => {
  const [st, setSt] = useState<FreezeState>();
  const [rem, setRem] = useState('none'); const [fz, setFz] = useState(0);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string[]>(); const [err, setErr] = useState<string>();
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => { const r = await apiFreezeState(); if (r.ok && r.data) setSt(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  // Пока заморозка действует, раз в 20 с проверяем, не открыли ли ссылку из письма (баннер появляется сам).
  useEffect(() => {
    if (!st?.frozen) return undefined;
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [st?.frozen, load]);

  const apply = async () => {
    const base = REMOVE.find((x) => x.key === rem)!.req;
    setBusy(true); setErr(undefined); setMsg(undefined);
    const r = await apiProtectAccount({ ...base, freezeHours: fz || undefined });
    setBusy(false); setConfirm(false);
    if (!r.ok || !r.data) { setErr(r.reason ?? 'Не получилось'); return; }
    const parts: string[] = [];
    if (base.remove !== 'none') parts.push(r.data.removed ? `Завершено сессий: ${r.data.removed}` : 'Других сессий для завершения не нашлось');
    if (r.data.frozenUntil) parts.push(`Новые входы заморожены до ${fmt(r.data.frozenUntil)}. Письмо со ссылкой на разморозку отправлено на почту.`);
    setMsg(parts);
    setRem('none'); setFz(0); void load(); onChanged();
  };

  if (!st) return null;
  const nothing = rem === 'none' && fz === 0;
  return (
    <div className="space-y-3">
      {st.frozen && st.linkConfirmed && <UnfreezeBanner st={st} onDone={() => { void load(); onChanged(); }} />}
      {st.frozen && !st.linkConfirmed && (
        <div className="space-y-2 rounded-2xl p-3 text-sm" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
          <p className="flex items-center gap-2 font-semibold" style={{ color: 'var(--t1)' }}><Snowflake size={16} style={{ color: 'var(--accent)' }} />
            Новые входы заморожены{st.until && <> · до <span translate="no">{fmt(st.until)}</span></>}</p>
          <p>Уже открытые сессии работают. Чтобы разморозить раньше срока, откройте ссылку из письма — здесь появится баннер «Разморозка аккаунта».</p>
          <button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent)' }}
            onClick={async () => { const r = await apiFreezeResend(); setMsg(r.ok ? ['Письмо отправлено ещё раз'] : undefined); setErr(r.ok ? undefined : r.reason); }}>
            <Mail size={13} /> Прислать письмо ещё раз
          </button>
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <span className="flex items-center gap-2"><ShieldAlert size={16} style={{ color: 'var(--red)' }} /> Защита аккаунта: завершить входы, заморозить</span>
        <span style={{ color: 'var(--t3)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Если подозреваете чужой вход. Это устройство остаётся в аккаунте — вы не потеряете доступ.</p>
          <div>
            <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--t2)' }}>Завершить сессии</p>
            <select value={rem} onChange={(e) => setRem(e.target.value)} className={sel} style={selStyle} aria-label="Завершить сессии">
              {REMOVE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--t2)' }}>Заморозить новые входы</p>
            <select value={fz} onChange={(e) => setFz(Number(e.target.value))} disabled={!st.hasEmail} className={sel} style={selStyle} aria-label="Заморозить новые входы">
              {FREEZE.map((x) => <option key={x.hours} value={x.hours}>{x.label}</option>)}
            </select>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>
              {st.hasEmail ? 'Пока заморозка действует, войти на новом устройстве нельзя никому, в том числе вам. Она заканчивается сама, а раньше её снимает ссылка из письма.'
                : 'Заморозка доступна только с подтверждённой почтой: на неё приходит ссылка на разморозку. Привяжите почту в Sky ID.'}
            </p>
          </div>
          {confirm ? (
            <div className="space-y-2 rounded-xl p-3" style={{ background: 'var(--red-bg)' }}>
              {rem !== 'none' && <p className="text-sm" style={{ color: 'var(--t1)' }}>Завершить сессии: <b>{REMOVE.find((x) => x.key === rem)!.label}</b></p>}
              {fz > 0 && <p className="text-sm" style={{ color: 'var(--t1)' }}>Заморозить новые входы: <b>{FREEZE.find((x) => x.hours === fz)!.label}</b></p>}
              <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Продолжить?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirm(false)} className="rounded-xl py-2 text-sm font-semibold" style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>Отмена</button>
                <button type="button" disabled={busy} onClick={() => void apply()} className="rounded-xl py-2 text-sm font-bold" style={{ background: 'var(--red)', color: '#fff' }}>Да, выполнить</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={nothing} onClick={() => setConfirm(true)}
              className="w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Применить</button>
          )}
          {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
          {msg?.map((m) => <p key={m} className="text-sm" style={{ color: 'var(--t1)' }}>{m}</p>)}
          {st.events.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Журнал защиты</p>
              {st.events.slice(0, 5).map((e, i) => (
                <p key={i} className="text-[11px]" style={{ color: 'var(--t2)' }}>
                  {fmt(e.at)} · {EVENT_TEXT[e.kind] ?? e.kind}{e.ip ? ' · ' : ''}<span translate="no">{e.ip}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Страница по ссылке из письма (/unfreeze?t=…). Сама ничего не размораживает — только подтверждает ссылку. */
export const UnfreezeLinkPage = () => {
  const t = new URLSearchParams(location.search).get('t') ?? '';
  const [state, setState] = useState<'ask' | 'busy' | 'ok' | 'bad'>('ask');
  const [minutes, setMinutes] = useState(30);
  const go = async () => {
    setState('busy');
    const r = await apiFreezeLink(t);
    if (r.ok && r.data) { setMinutes(r.data.minutes); setState('ok'); } else setState('bad');
  };
  return (
    <div className="grid min-h-screen place-items-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm space-y-4 text-center">
        <img src="/logo.png" alt="Sky" className="mx-auto h-14 w-14 object-contain" />
        <h1 className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Разморозка аккаунта</h1>
        {state === 'ok' ? (
          <p className="text-sm leading-snug" style={{ color: 'var(--t2)' }}>
            {`Ссылка подтверждена на ${minutes} минут. Откройте Sky на устройстве, где вы уже вошли: Профиль → Sky ID → Устройства. Там появится баннер «Разморозка аккаунта».`}
          </p>
        ) : state === 'bad' || !t ? (
          <p className="text-sm" style={{ color: 'var(--red)' }}>Ссылка недействительна, уже использована или заморозка закончилась.</p>
        ) : (
          <>
            <p className="text-sm leading-snug" style={{ color: 'var(--t2)' }}>Подтвердите, что это вы запросили разморозку. Сами новые входы откроются только после подтверждения в приложении на уже подключённом устройстве.</p>
            <button type="button" disabled={state === 'busy'} onClick={() => void go()} className="w-full rounded-2xl py-3 font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Подтвердить ссылку</button>
          </>
        )}
      </div>
    </div>
  );
};
