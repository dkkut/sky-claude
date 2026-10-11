/* ===========================================================
   SKY TV — Профиль / Настройки
=========================================================== */
import { useEffect } from 'react';
import { User, LogOut, Tv, Users } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { useTVNavStore } from './tvNavStore';
import { useAuthStore } from '@/core/auth/store';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';
import { getTVModeSetting, setTVModeSetting, type TVModeSetting } from './useDeviceMode';

const OPTIONS: { key: TVModeSetting; label: string }[] = [
  { key: 'auto', label: 'Авто' },
  { key: 'on',   label: 'Всегда' },
  { key: 'off',  label: 'Выключен' },
];

export const TVProfileSettings = () => {
  const { accounts, currentUserId, logout } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);

  useEffect(() => { tvFocusManager.focusDefault('tv-switch'); }, []);

  /* Смена профиля: всё, что играет от имени прошлого, останавливаем; сессия Sky ID остаётся —
     дальше экран «Кто играет?» и серверная проверка доступа к новому профилю. */
  const switchProfile = () => {
    usePlayerStore.getState().clear();
    usePodcastPlayer.getState().close();
    useTVNavStore.getState().replaceHome();
    useAuthStore.getState().switchProfile();
  };

  return (
    <div className="px-10 pt-8 pb-10 max-w-[720px]">
      <div className="flex items-center gap-4 mb-10">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full" style={{ background: 'var(--bg-l2)' }}>
          {me?.avatar ? <img src={me.avatar} className="h-full w-full rounded-full object-cover" alt=""/> : <User size={26} color="var(--t2)"/>}
        </div>
        <div>
          <p className="text-[22px] font-extrabold" style={{ color: 'var(--t1)' }}>{me?.name ?? me?.username ?? 'Профиль'}</p>
          <p className="text-[14px]" style={{ color: 'var(--t3)' }}>@{me?.username}</p>
        </div>
      </div>

      <p className="mb-3 flex items-center gap-2 text-[16px] font-bold" style={{ color: 'var(--t1)' }}><Tv size={18}/> Режим Smart TV</p>
      <div className="flex gap-3 mb-10">
        {OPTIONS.map(o => (
          <TVFocusable key={o.key} id={`tv-mode-${o.key}`} onEnter={() => setTVModeSetting(o.key)}>
            {({ focused }) => (
              <div className="rounded-xl px-5 py-3 text-[15px] font-bold" style={{
                background: getTVModeSetting() === o.key ? 'var(--accent)' : focused ? 'rgba(255,255,255,0.14)' : 'var(--bg-l2)',
                color: getTVModeSetting() === o.key ? '#fff' : 'var(--t1)',
                boxShadow: focused ? '0 0 0 2px var(--accent)' : 'none',
              }}>
                {o.label}
              </div>
            )}
          </TVFocusable>
        ))}
      </div>
      <p className="mb-10 text-[13px]" style={{ color: 'var(--t3)' }}>«Выключен» вернёт обычную версию сайта при следующей загрузке страницы.</p>

      <div className="flex gap-4">
      <TVFocusable id="tv-switch" onEnter={switchProfile}>
        {({ focused }) => (
          <div className="flex items-center gap-2 rounded-xl px-6 py-4 text-[18px] font-bold" style={{ background: focused ? '#8b7cff' : 'var(--bg-l2)', color: '#fff', boxShadow: focused ? '0 0 0 3px rgba(179,167,255,0.9)' : 'none' }}>
            <Users size={20}/> Сменить профиль
          </div>
        )}
      </TVFocusable>
      <TVFocusable id="tv-logout" onEnter={() => { usePlayerStore.getState().clear(); usePodcastPlayer.getState().close(); useTVNavStore.getState().replaceHome(); logout(); }}>
        {({ focused }) => (
          <div className="flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-bold" style={{ background: focused ? 'var(--red)' : 'var(--bg-l2)', color: focused ? '#fff' : 'var(--red)', boxShadow: focused ? '0 0 0 2px var(--red)' : 'none' }}>
            <LogOut size={17}/> Выйти
          </div>
        )}
      </TVFocusable>
      </div>
    </div>
  );
};
