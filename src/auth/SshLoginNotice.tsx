/**
 * Владельцу: «Выполнен вход по SSH». 25 минут можно отменить вход ползунком «Это не я» (сессия на сервере обрывается)
 * или нажать «Это я». Карточка — на Sky Island (если она есть) или сверху экрана; приходит сразу по сокету (ssh:login),
 * запасной опрос раз в 15 секунд. У остальных людей сервер отвечает «не владелец», и опрос выключается.
 * Решение принимает сервер (server/routes/sshowner.mjs, не зависит от входа в панель и замка настроек).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { useIslandStore } from '@/island/islandStore';
import { useSettings } from '@/settings/store';
import { SwipeConfirm } from '@/island/SwipeConfirm';
import { visibleTick } from '@/shared/visibleTick';

export const SSH_LOGIN_EVENT = 'sky:ssh-login';
interface Login { id: string; device: string; ip: string; actor: string | null; createdAt: string; until: string }

export const SshLoginNotice = () => {
  const authed = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.currentUserId);
  const [list, setList] = useState<Login[]>([]);
  const owner = useRef<boolean | null>(null);
  const busy = useRef(false);
  const mounted = useIslandStore((s) => s.mounted);
  const islandMode = useSettings((s) => s.settings.islandMode);

  const load = useCallback(async () => {
    if (owner.current === false) return;
    const r = await apiCall<{ owner: boolean; pending: Login[] }>('/api/skyid/ssh-login');
    if (!r.ok) return;
    owner.current = Boolean(r.data?.owner);
    setList(r.data?.pending ?? []);
  }, []);

  useEffect(() => {
    if (!authed || !userId) { owner.current = null; setList([]); return undefined; }
    void load();
    const t = window.setInterval(visibleTick(() => load()), 15000);
    const h = () => { owner.current = owner.current === false ? null : owner.current; void load(); };
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener(SSH_LOGIN_EVENT, h);
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(t); window.removeEventListener(SSH_LOGIN_EVENT, h); document.removeEventListener('visibilitychange', vis); };
  }, [authed, userId, load]);

  const answer = useCallback(async (id: string, notMe: boolean) => {
    if (busy.current) return; busy.current = true;
    useIslandStore.getState().resolve(`ssh:${id}`);
    await apiCall('/api/skyid/ssh-login/answer', { method: 'POST', body: JSON.stringify({ id, notMe }) });
    busy.current = false; void load();
  }, [load]);

  const onIsland = mounted && islandMode !== 'side';
  useEffect(() => {
    if (!onIsland) return undefined;
    for (const p of list) {
      useIslandStore.getState().push({
        kind: 'system', mergeKey: `ssh:${p.id}`, title: 'Выполнен вход по SSH', body: `${p.device} · ${p.ip}${p.actor ? ` · @${p.actor}` : ''}`, userText: false,
        ttl: 0, swipe: { label: 'Это не я — проведите вправо', onConfirm: () => { void answer(p.id, true); } },
        actions: [{ label: 'Это я', run: () => { void answer(p.id, false); } }],
      });
    }
    return () => { for (const p of list) useIslandStore.getState().resolve(`ssh:${p.id}`); };
  }, [list, onIsland, answer]);

  if (onIsland || !list.length) return null;
  const p = list[0];
  return (
    <div className="fixed inset-x-3 z-[957] mx-auto max-w-[420px] rounded-[26px] p-4" role="alertdialog" aria-label="Выполнен вход по SSH"
      style={{ top: 'calc(var(--island-pad, 0px) + 12px)', background: 'rgba(20,20,34,.96)', color: '#fff', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 12px 40px rgba(0,0,0,.45)' }} data-keep-dark>
      <p className="mb-1 flex items-center gap-2 text-[14px] font-bold"><ShieldAlert size={16} style={{ color: '#fbbf24' }} />Выполнен вход по SSH</p>
      <p className="mb-1 text-[12px]" style={{ color: 'rgba(255,255,255,.7)' }}><span translate="no">{p.device} · {p.ip}{p.actor ? ` · @${p.actor}` : ''}</span></p>
      <p className="mb-3 text-[12px]" style={{ color: 'rgba(255,255,255,.7)' }}>Если это не вы, отмените вход: сессия на сервере будет закрыта.</p>
      <SwipeConfirm label="Это не я — проведите вправо" onConfirm={() => { void answer(p.id, true); }} />
      <button type="button" onClick={() => { void answer(p.id, false); }} className="mt-2 w-full rounded-full py-2 text-center text-[13px] font-semibold" style={{ background: 'rgba(255,255,255,.12)' }}>Это я</button>
    </div>
  );
};
