/**
 * Страница «Войти через Sky ID» (/oauth/authorize) — подтверждение входа в стороннем сервисе.
 * Сервер: server/oidc.mjs. Открывается из браузера/приложения сервиса; если человек не вошёл в Sky, сначала обычный вход.
 * Решение (подтвердить/отклонить) принимает СЕРВЕР по действующей сессии; жест «вправо» лишь отправляет его.
 * Тот же запрос показывается в Sky Island (если он включён) — подтвердить можно и там.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2, KeyRound, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { useIslandStore } from '@/island/islandStore';
import { SwipeConfirm } from '@/island/SwipeConfirm';

interface ScopeInfo { id: string; label: string; required: boolean; sensitive: boolean }
interface Init {
  requestId: string; expiresInSec: number;
  client: { id: string; name: string; description: string; homepage: string; returnTo: string };
  scopes: ScopeInfo[]; previouslyGranted: string[]; profile: { name: string; username: string };
}
type Fail = { message: string; redirectTo?: string };

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];
const go = (url: string) => { window.location.assign(url); };

export const OidcAuthorizeGate = () => {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const profileId = useAuthStore((s) => s.currentUserId);
  const [params, setParams] = useState<Record<string, string> | null>(() => {
    if (location.pathname !== '/oauth/authorize') return null;
    const q = new URLSearchParams(location.search); const o: Record<string, string> = {};
    for (const k of PARAMS) if (q.get(k) != null) o[k] = q.get(k)!;
    return o;
  });
  if (!params || !authed || !profileId) return null;
  return <Card params={params} onClose={() => { setParams(null); history.replaceState(null, '', '/'); }} />;
};

const Card = ({ params, onClose }: { params: Record<string, string>; onClose: () => void }) => {
  const [init, setInit] = useState<Init | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [granted, setGranted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const sent = useRef(false);
  const decided = useRef(false);
  const island = useIslandStore;

  // Запрос создаётся один раз; параметры убираем из адреса (повторное открытие/обновление не создаёт новых запросов).
  useEffect(() => {
    if (sent.current) return; sent.current = true;
    try { history.replaceState(null, '', '/oauth/authorize'); } catch { /* не критично */ }
    void apiCall<Init & { error?: string; message?: string; redirectTo?: string }>('/api/oidc/authorize/init', { method: 'POST', body: JSON.stringify(params) }).then((r) => {
      const d = r.data as (Init & { message?: string; redirectTo?: string; error?: string }) | undefined;
      if (r.ok && d?.requestId) { setInit(d); setGranted(d.scopes.filter((s) => s.required || d.previouslyGranted.includes(s.id)).map((s) => s.id)); setLeft(d.expiresInSec); return; }
      setFail({ message: d?.message ?? r.reason ?? 'Не удалось начать вход', redirectTo: d?.redirectTo });
    });
  }, [params]);

  const decide = useCallback(async (approve: boolean) => {
    if (!init || decided.current) return;
    decided.current = true; setBusy(true);
    island.getState().resolve(`oidc:${init.requestId}`);
    const r = await apiCall<{ redirectTo?: string }>('/api/oidc/authorize/decide', { method: 'POST', body: JSON.stringify({ requestId: init.requestId, approve, scopes: granted }) });
    if (r.ok && r.data?.redirectTo) { go(r.data.redirectTo); return; }
    decided.current = false; setBusy(false);
    setFail({ message: r.error === 'expired' ? 'Время на подтверждение вышло. Начните вход в сервисе заново.' : r.error === 'already_decided' ? 'Этот запрос уже обработан.' : (r.reason ?? 'Не удалось подтвердить вход') });
  }, [init, granted, island]);

  // Обратный отсчёт и показ запроса на Островке (тот же запрос подтверждается и там)
  useEffect(() => {
    if (!init) return undefined;
    const t = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(t);
  }, [init]);
  useEffect(() => {
    if (!init || fail) return undefined;
    island.getState().push({
      kind: 'system', title: `Вход через Sky ID: ${init.client.name}`, body: 'Подтвердите вход жестом или отклоните.', userText: true,
      ttl: 0, mergeKey: `oidc:${init.requestId}`,
      swipe: { label: 'Проведите вправо, чтобы войти', onConfirm: () => { void decide(true); } },
      actions: [{ label: 'Отклонить', run: () => { void decide(false); } }],
    });
    return () => island.getState().resolve(`oidc:${init.requestId}`);
  }, [init, fail, decide, island]);

  const expired = Boolean(init) && left === 0;
  const mm = String(Math.floor(left / 60)).padStart(2, '0'); const ss = String(left % 60).padStart(2, '0');
  const sensitive = init?.scopes.filter((s) => s.sensitive && granted.includes(s.id)) ?? [];

  return (
    <div className="fixed inset-0 z-[900] grid place-items-center overflow-y-auto px-4 py-8" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(139,124,255,0.28), transparent), radial-gradient(900px 500px at 100% 110%, rgba(56,189,248,0.22), transparent), var(--bg)' }} data-keep-dark>
      <div className="w-full max-w-[420px] rounded-[30px] p-6" style={{ background: 'rgba(20,20,34,0.72)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(24px)', color: '#fff', boxShadow: '0 20px 80px rgba(60,40,160,0.35)' }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2"><img src="/logo.png" alt="Sky" className="h-8 w-8 object-contain" /><p className="text-[15px] font-bold">Sky ID</p></div>
          {!busy && <button type="button" aria-label="Закрыть" onClick={() => void (init && !expired ? decide(false).then(onClose) : Promise.resolve(onClose()))} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}><X size={15} /></button>}
        </div>

        {!init && !fail && <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={22} /></div>}

        {fail && (
          <div className="space-y-4 text-center">
            <ShieldAlert size={36} className="mx-auto" style={{ color: '#f87171' }} />
            <p className="text-[14px]" style={{ color: 'rgba(255,255,255,0.85)' }}>{fail.message}</p>
            {fail.redirectTo
              ? <button type="button" onClick={() => go(fail.redirectTo!)} className="w-full rounded-full py-3 text-[14px] font-bold" style={{ background: 'rgba(255,255,255,0.12)' }}>Вернуться в сервис</button>
              : <button type="button" onClick={onClose} className="w-full rounded-full py-3 text-[14px] font-bold" style={{ background: 'rgba(255,255,255,0.12)' }}>Закрыть</button>}
          </div>
        )}

        {init && !fail && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(139,124,255,0.35), rgba(56,189,248,0.35))' }}><KeyRound size={24} /></div>
              <p className="text-[19px] font-bold" translate="no">{init.client.name}</p>
              <p className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,0.65)' }}>хочет, чтобы вы вошли с помощью Sky ID</p>
              {init.client.homepage && <p className="mt-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }} translate="no">{new URL(init.client.homepage).host}</p>}
            </div>

            <div className="rounded-2xl p-3 text-[12.5px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <p className="mb-2 font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>Вы входите как <span translate="no">{init.profile.name} @{init.profile.username}</span></p>
              <p className="mb-1.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Сервис получит:</p>
              <ul className="space-y-1.5">
                {init.scopes.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={granted.includes(s.id)} disabled={s.required || busy}
                        onChange={(e) => setGranted(e.target.checked ? [...granted, s.id] : granted.filter((x) => x !== s.id))} />
                      <span>{s.label}{s.sensitive && <em className="ml-1 not-italic" style={{ color: '#fbbf24' }}>· по вашему желанию</em>}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11.5px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {sensitive.length === 0
                  ? 'Ни имени, ни почты, ни телефона сервис не получит. Идентификатор случайный и свой для каждого сервиса: другие сервисы не смогут понять, что это один человек.'
                  : 'Передаются только отмеченные сведения. Пароль и данные других сервисов не передаются никогда.'}
              </p>
            </div>

            {expired
              ? <p className="text-center text-[13px]" style={{ color: '#f87171' }}>Время вышло. Начните вход в сервисе заново.</p>
              : (<>
                <SwipeConfirm label="Проведите вправо, чтобы войти" busy={busy} onConfirm={() => void decide(true)} />
                <button type="button" disabled={busy} onClick={() => void decide(false)} className="w-full rounded-full py-2.5 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.14)', color: '#fca5a5' }}>Отклонить</button>
                <p className="text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}><ShieldCheck size={11} className="mr-1 inline" />Запрос действует {mm}:{ss}. После подтверждения вы вернётесь на <span translate="no">{init.client.returnTo}</span></p>
              </>)}
          </div>
        )}
      </div>
    </div>
  );
};
