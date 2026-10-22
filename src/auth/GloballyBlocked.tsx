/**
 * Экран «Заблокировано глобальной блокировкой» + обжалование. Показывается поверх всего, когда сервер отказал во входе
 * (423 globally_blocked) или закрыл открытую сессию (403 account_blocked с пометкой global): событие `sky:globalblock`
 * (см. api.ts). Человек не вошёл, поэтому обжалование идёт по подписанному токену из ответа сервера (24 часа) через
 * публичные /api/blocked/status и /api/blocked/appeal. Решение принимает сотрудник администрации; ответ виден здесь же и приходит на почту.
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2, RefreshCw, Send } from 'lucide-react';
import { API_ORIGIN } from '../core/nativeApp';

interface Info { token: string; reason: string; since: string | null; until: string | null }
interface Status { block: { reason: string; since: string; until: string | null; active: boolean } | null; appeal: { status: 'pending' | 'accepted' | 'rejected'; decision: string; message: string; createdAt: string; decidedAt: string | null } | null }

const post = async (path: string, body: unknown) => {
  try {
    const r = await fetch(`${API_ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) as Record<string, unknown> };
  } catch { return { status: 0, data: { error: 'network' } as Record<string, unknown> }; }
};
const ERR: Record<string, string> = {
  bad_token: 'Срок обращения истёк. Закройте экран и попробуйте войти ещё раз.', message_too_short: 'Опишите ситуацию подробнее — не меньше 20 знаков.',
  appeal_pending: 'Ваша апелляция уже на рассмотрении.', appeal_limit: 'Достигнут предел апелляций: не больше трёх за 30 дней.', not_blocked: 'Блокировка уже снята — войдите заново.',
  too_many_requests: 'Слишком часто. Подождите минуту.', network: 'Нет связи с сервером.',
};
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

export function GloballyBlocked() {
  const [info, setInfo] = useState<Info | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState(''); const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<Info>).detail; if (d?.token) setInfo((cur) => ({ ...(cur ?? d), ...d })); };
    window.addEventListener('sky:globalblock', on);
    return () => window.removeEventListener('sky:globalblock', on);
  }, []);

  const refresh = useCallback(async () => {
    if (!info) return;
    const r = await post('/api/blocked/status', { token: info.token });
    if (r.data.error) { setErr(ERR[String(r.data.error)] ?? 'Не удалось проверить статус.'); return; }
    setErr(''); setSt(r.data as unknown as Status);
  }, [info]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!info) return null;
  const reason = st?.block?.reason || info.reason;
  const since = st?.block?.since ?? info.since; const until = st?.block ? st.block.until : info.until;
  const lifted = st?.block ? !st.block.active : false;

  const send = async () => {
    setBusy(true); setErr('');
    const r = await post('/api/blocked/appeal', { token: info.token, message: msg, contact });
    setBusy(false);
    if (r.data.error) { setErr(ERR[String(r.data.error)] ?? 'Не удалось отправить.'); return; }
    setMsg(''); void refresh();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Заблокировано глобальной блокировкой" data-keep-dark
      className="fixed inset-0 z-[100000] overflow-y-auto" style={{ background: 'rgba(8,10,18,0.96)', color: '#fff', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-5 py-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}><ShieldAlert size={30} /></span>
          <h1 className="text-xl font-bold">Заблокировано глобальной блокировкой</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>Доступ к Sky закрыт для этого устройства и связанных с ним аккаунтов.</p>
        </div>

        <div className="space-y-1.5 rounded-2xl p-4 text-sm" style={{ background: 'rgba(255,255,255,0.07)' }}>
          {reason && <p><span style={{ color: 'rgba(255,255,255,0.55)' }}>Причина: </span><span translate="no">{reason}</span></p>}
          {since && <p><span style={{ color: 'rgba(255,255,255,0.55)' }}>С: </span>{date(since)}</p>}
          <p><span style={{ color: 'rgba(255,255,255,0.55)' }}>До: </span>{until ? date(until) : 'бессрочно'}</p>
        </div>

        {lifted && (
          <div className="rounded-2xl p-4 text-sm" style={{ background: 'rgba(34,197,94,0.15)' }}>
            Блокировка снята. <button type="button" className="font-bold underline" onClick={() => window.location.reload()}>Войти заново</button>
          </div>
        )}

        {st?.appeal?.status === 'pending' && (
          <div role="status" className="rounded-2xl p-4 text-sm" style={{ background: 'rgba(245,158,11,0.15)' }}>
            <p className="font-bold">Апелляция на рассмотрении</p>
            <p className="mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>Отправлена {date(st.appeal.createdAt)}. Ответ придёт на почту аккаунта, если она подтверждена, и появится здесь.</p>
          </div>
        )}
        {st?.appeal?.status === 'accepted' && (
          <div className="rounded-2xl p-4 text-sm" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <p className="font-bold">Апелляция принята</p>
            {st.appeal.decision && <p className="mt-1" translate="no">{st.appeal.decision}</p>}
            <button type="button" className="mt-2 font-bold underline" onClick={() => window.location.reload()}>Войти заново</button>
          </div>
        )}
        {st?.appeal?.status === 'rejected' && (
          <div className="rounded-2xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.15)' }}>
            <p className="font-bold">Апелляция отклонена</p>
            {st.appeal.decision && <p className="mt-1" translate="no">{st.appeal.decision}</p>}
          </div>
        )}

        {!lifted && st?.appeal?.status !== 'pending' && st?.appeal?.status !== 'accepted' && (
          <div className="space-y-2 rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <p className="text-sm font-bold">Обжаловать блокировку</p>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} maxLength={2000} placeholder="Расскажите, почему считаете блокировку ошибочной"
              className="w-full min-w-0 rounded-2xl p-3 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }} />
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder="Как с вами связаться (необязательно)"
              className="w-full min-w-0 rounded-full px-4 py-3 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }} />
            <button type="button" disabled={busy || msg.trim().length < 20} onClick={() => void send()}
              className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-50" style={{ background: '#fff', color: '#111', minHeight: 44 }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Отправить апелляцию
            </button>
          </div>
        )}

        {err && <p role="alert" className="text-center text-sm" style={{ color: '#fca5a5' }}>{err}</p>}
        <div className="flex justify-center gap-4 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
          <button type="button" className="flex items-center gap-1.5 underline" onClick={() => void refresh()}><RefreshCw size={13} />Проверить статус</button>
          <button type="button" className="underline" onClick={() => { setInfo(null); setSt(null); }}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
