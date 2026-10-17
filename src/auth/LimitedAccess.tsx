/**
 * Ограниченный доступ на неподтверждённом устройстве (server/limitedaccess.mjs).
 *  - LimitedAccessGate: на ограниченной сессии — полоса сверху («только просмотр, чаты закрыты»), кнопка «Доступ утерян»
 *    (код на резервную почту); на полной — следит за запросами с новых устройств и показывает их на Sky Island с ползунком.
 *  - LimitedAccessSettings: переключатель в Профиль → Sky ID → Защита (нужна подтверждённая резервная почта).
 *  - LimitedLock: заглушка вместо чатов на ограниченной сессии.
 * Решения принимает сервер по сессии; жест лишь отправляет запрос.
 */
import { visibleTick } from '@/shared/visibleTick';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Loader2, Lock, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { useIslandStore } from '@/island/islandStore';
import { useSettings } from '@/settings/store';
import { SwipeConfirm } from '@/island/SwipeConfirm';

interface Pending { id: string; label: string; ip: string; createdAt: string }
interface Settings { enabled: boolean; canEnable: boolean; backupEmail: string | null; pending: Pending[] }

export const useLimited = create<{ limited: boolean; set: (v: boolean) => void }>((set) => ({ limited: false, set: (limited) => set({ limited }) }));

export const LIMITED_EVENT = 'sky:limited';
export const LIMITED_PENDING_EVENT = 'sky:limited-pending';

const deviceName = (ua: string) => {
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || 'Неизвестное устройство';
};

const btn = 'rounded-full px-4 py-2 text-[12px] font-bold disabled:opacity-50';

/** Окно «Доступ утерян»: код на резервную почту. */
const LostAccess = ({ onClose }: { onClose: () => void }) => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ sentTo?: string }>('/api/skyid/limited/lost/start', { method: 'POST', body: '{}' });
    setBusy(false);
    if (r.ok) setSentTo(r.data?.sentTo ?? ''); else setErr(r.error === 'no_backup_email' ? 'У этого Sky ID нет подтверждённой резервной почты. Подтвердите вход на доверенном устройстве или воспользуйтесь сайтом восстановления.' : (r.reason ?? 'Не получилось'));
  };
  const finish = async () => {
    setBusy(true); setErr('');
    const r = await apiCall('/api/skyid/limited/lost/finish', { method: 'POST', body: JSON.stringify({ code }) });
    setBusy(false);
    if (r.ok) window.location.reload(); else setErr(r.error === 'invalid_code' ? 'Код не подошёл или устарел' : (r.reason ?? 'Не получилось'));
  };
  return (
    <div className="fixed inset-0 z-[960] grid place-items-center px-4" style={{ background: 'rgba(0,0,0,.6)' }} role="dialog" aria-modal="true" aria-label="Доступ утерян">
      <div className="w-full max-w-[380px] rounded-[26px] p-5" style={{ background: 'var(--bg-l1, #14141f)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[15px] font-bold">Доступ к доверенным устройствам утерян</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><X size={15} /></button>
        </div>
        {!sentTo ? (
          <>
            <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--t2)' }}>Мы отправим код на подтверждённую резервную почту этого Sky ID. После ввода кода это устройство получит полный доступ и станет доверенным.</p>
            <button type="button" disabled={busy} onClick={() => void send()} className={`${btn} flex w-full items-center justify-center gap-2 py-3 text-[14px]`} style={{ background: 'var(--accent, #4f8cff)', color: '#fff' }}>
              {busy && <Loader2 size={14} className="animate-spin" />}Отправить код на резервную почту
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--t2)' }}>Код отправлен на <span translate="no" className="font-semibold">{sentTo}</span>. Он действует несколько минут.</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Код из письма"
              className="mb-3 w-full rounded-full px-5 py-3 text-center text-[18px] font-bold tracking-[0.35em] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
            <button type="button" disabled={busy || code.length !== 6} onClick={() => void finish()} className={`${btn} flex w-full items-center justify-center gap-2 py-3 text-[14px]`} style={{ background: 'var(--accent, #4f8cff)', color: '#fff' }}>
              {busy && <Loader2 size={14} className="animate-spin" />}Подтвердить вход
            </button>
            <button type="button" disabled={busy} onClick={() => void send()} className="mt-2 w-full text-center text-[12px] underline disabled:opacity-50" style={{ color: 'var(--t3)' }}>Отправить код ещё раз</button>
          </>
        )}
        {err && <p role="alert" className="mt-3 text-[12px]" style={{ color: '#ef4444' }}>{err}</p>}
      </div>
    </div>
  );
};

/** Ограниченная сессия: полоса сверху + опрос статуса (сервер сам снимет ограничение после подтверждения). */
const LimitedBar = () => {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const tick = async () => {
      const r = await apiCall<{ limited?: boolean; status?: string }>('/api/skyid/limited/status');
      if (r.ok && r.data && r.data.limited === false) window.location.reload();
      if (r.status === 401 || (r.ok && r.data?.status === 'denied')) window.location.reload();
    };
    const t = window.setInterval(() => { if (!document.hidden) void tick(); }, 4000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <>
      <div role="status" className="fixed inset-x-3 z-[955] mx-auto flex max-w-[520px] flex-wrap items-center justify-center gap-2 rounded-[22px] px-4 py-3 text-center text-[12px] font-semibold"
        style={{ bottom: 'calc(var(--safe-bottom, 0px) + 84px)', background: 'rgba(245,158,11,.97)', color: '#1f1300', boxShadow: '0 8px 28px rgba(0,0,0,.4)' }} data-keep-dark>
        <ShieldAlert size={14} />
        <span>Вход не подтверждён: можно только смотреть, чаты закрыты. Подтвердите вход на доверенном устройстве.</span>
        <button type="button" onClick={() => setLost(true)} className="rounded-full px-3 py-1 text-[12px] font-bold" style={{ background: '#1f1300', color: '#fff' }}>Доступ утерян</button>
      </div>
      {lost && <LostAccess onClose={() => setLost(false)} />}
    </>
  );
};

/** Полноценная сессия: запросы входа с новых устройств → остров с ползунком (или карточка, если острова нет). */
const ApprovalWatcher = () => {
  const [pending, setPending] = useState<Pending[]>([]);
  const mounted = useIslandStore((s) => s.mounted);
  const islandMode = useSettings((s) => s.settings.islandMode);
  const busy = useRef(false);
  const load = useCallback(async () => {
    const r = await apiCall<Settings>('/api/skyid/limited');
    if (r.ok) setPending(r.data?.pending ?? []);
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(visibleTick(() => load()), 15000);
    const h = () => { void load(); };
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener(LIMITED_PENDING_EVENT, h);
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(t); window.removeEventListener(LIMITED_PENDING_EVENT, h); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const decide = useCallback(async (id: string, approve: boolean) => {
    if (busy.current) return; busy.current = true;
    useIslandStore.getState().resolve(`limited:${id}`);
    await apiCall('/api/skyid/limited/decide', { method: 'POST', body: JSON.stringify({ id, approve }) });
    busy.current = false; void load();
  }, [load]);

  const onIsland = mounted && islandMode !== 'side';
  useEffect(() => {
    if (!onIsland) return undefined;
    for (const p of pending) {
      useIslandStore.getState().push({
        kind: 'system', mergeKey: `limited:${p.id}`, title: 'Подтвердите вход с нового устройства', body: `${deviceName(p.label)} · ${p.ip}`, userText: false,
        ttl: 0, swipe: { label: 'Проведите вправо, чтобы разрешить', onConfirm: () => { void decide(p.id, true); } },
        actions: [{ label: 'Это не я', run: () => { void decide(p.id, false); } }],
      });
    }
    return () => { for (const p of pending) useIslandStore.getState().resolve(`limited:${p.id}`); };
  }, [pending, onIsland, decide]);

  if (onIsland || !pending.length) return null;
  const p = pending[0];
  return (
    <div className="fixed inset-x-3 z-[955] mx-auto max-w-[420px] rounded-[26px] p-4" role="alertdialog" aria-label="Подтвердите вход с нового устройства"
      style={{ top: 'calc(var(--island-pad, 0px) + 12px)', background: 'rgba(20,20,34,.96)', color: '#fff', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 12px 40px rgba(0,0,0,.45)' }} data-keep-dark>
      <p className="mb-1 text-[14px] font-bold">Подтвердите вход с нового устройства</p>
      <p className="mb-3 text-[12px]" style={{ color: 'rgba(255,255,255,.7)' }}><span translate="no">{deviceName(p.label)} · {p.ip}</span></p>
      <SwipeConfirm label="Проведите вправо, чтобы разрешить" onConfirm={() => { void decide(p.id, true); }} />
      <button type="button" onClick={() => { void decide(p.id, false); }} className="mt-2 w-full text-center text-[12px] font-semibold underline" style={{ color: 'rgba(255,255,255,.75)' }}>Это не я</button>
    </div>
  );
};

export const LimitedAccessGate = () => {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.currentUserId);
  const limited = useLimited((s) => s.limited);
  const setLimited = useLimited((s) => s.set);
  useEffect(() => {
    if (!authed || !userId) { setLimited(false); return undefined; }
    let alive = true;
    void apiCall<{ limited?: boolean }>('/api/skyid/limited/status').then((r) => { if (alive) setLimited(Boolean(r.ok && r.data?.limited)); });
    const on = () => setLimited(true);
    window.addEventListener(LIMITED_EVENT, on);
    return () => { alive = false; window.removeEventListener(LIMITED_EVENT, on); };
  }, [authed, userId, setLimited]);
  if (!authed || !userId) return null;
  return limited ? <LimitedBar /> : <ApprovalWatcher />;
};

/** Вместо чатов на ограниченной сессии. */
export const LimitedLock = ({ children }: { children: ReactNode }) => {
  const limited = useLimited((s) => s.limited);
  if (!limited) return <>{children}</>;
  return (
    <div className="grid h-full min-h-[300px] place-items-center px-6 text-center" style={{ color: 'var(--t1)' }}>
      <div className="max-w-[320px]">
        <Lock size={30} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
        <p className="mb-1 text-[15px] font-bold">Чаты закрыты</p>
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--t2)' }}>Вход с этого устройства ещё не подтверждён. Подтвердите его на доверенном устройстве или кнопкой «Доступ утерян» внизу.</p>
      </div>
    </div>
  );
};

/** Профиль → Sky ID → Защита. */
export const LimitedAccessSettings = () => {
  const [st, setSt] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const limited = useLimited((s) => s.limited);
  const load = useCallback(async () => { const r = await apiCall<Settings>('/api/skyid/limited'); if (r.ok && r.data) setSt(r.data); }, []);
  useEffect(() => { if (!limited) void load(); }, [load, limited]);
  if (limited || !st) return null;
  const toggle = async () => {
    setBusy(true); setErr('');
    const r = await apiCall('/api/skyid/limited', { method: 'PUT', body: JSON.stringify({ enabled: !st.enabled }) });
    setBusy(false);
    if (!r.ok) setErr(r.error === 'backup_email_required' ? 'Сначала добавьте и подтвердите резервную почту (раздел «Восстановление»). Она начинает действовать через сутки после подтверждения.' : (r.reason ?? 'Не получилось'));
    void load();
  };
  return (
    <div className="rounded-[22px] p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <ShieldCheck size={20} style={{ color: 'var(--accent, #4f8cff)', flexShrink: 0, marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Ограничить вход с новых устройств</p>
          <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--t2)' }}>Пока вход с нового устройства не подтверждён с доверенного, там доступен только просмотр, а чаты закрыты. Подтверждение приходит на Sky Island и в push; если доверенных устройств нет — «Доступ утерян» через резервную почту.</p>
          {!st.canEnable && !st.enabled && <p className="mt-2 text-[12px]" style={{ color: '#f59e0b' }}>Нужна подтверждённая резервная почта (Профиль → Sky ID → Восстановление).</p>}
          {st.backupEmail && <p className="mt-2 text-[12px]" style={{ color: 'var(--t3)' }}>Резервная почта: <span translate="no">{st.backupEmail}</span></p>}
          {err && <p role="alert" className="mt-2 text-[12px]" style={{ color: '#ef4444' }}>{err}</p>}
        </div>
        <button type="button" role="switch" aria-checked={st.enabled} aria-label="Ограничить вход с новых устройств" disabled={busy || (!st.canEnable && !st.enabled)} onClick={() => void toggle()}
          className="relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50" style={{ background: st.enabled ? 'var(--accent, #4f8cff)' : 'var(--bg-l3)' }}>
          <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: st.enabled ? 22 : 2 }} />
        </button>
      </div>
    </div>
  );
};
