/**
 * Живая активность в играх: пульс отмеченной вручную игры, свои итоги, присутствие собеседников и
 * определение запущенных игр в Windows-приложении (по желанию, настройка gameDetect).
 * Сервер — server/gameactivity.mjs. Ничего не выдумывается: нет пульса — нет «играет».
 */
import { useAuthStore } from '@/core/auth/store';
import { useSettings } from '@/settings/store';
import { useMessengerStore } from '@/messenger/store';
import { isElectron } from '@/core/nativeApp';
import { apiGamePing, apiGameStop } from '@/extras/mediaActivityApi';
import { useGamingAccounts, KNOWN_GAMES } from './accounts';

const watched = new Set<string>();
/** Экран профиля/списка просит показывать присутствие этого человека. */
export const watchGamePresence = (id: string) => { if (id) watched.add(id); };

export const startGameActivity = () => {
  const me = () => useAuthStore.getState().currentUserId ?? '';
  const peers = () => {
    const ids = new Set<string>(watched);
    for (const c of useMessengerStore.getState().chats) {
      if (c.type === 'direct') for (const p of c.participants ?? []) if (p !== me()) ids.add(p);
    }
    return [...ids].slice(0, 60);
  };

  let detected: string | null = null;      // id игры, найденной Windows-приложением
  const tick = async () => {
    const st = useGamingAccounts.getState();
    if (st.manual && st.manual.until < Date.now()) st.stopPlaying(me());
    else if (st.manual) void apiGamePing('game', st.manual.id, st.manual.title);
    if (me()) await st.refreshOwn(me());
    const ids = peers();
    if (ids.length) await st.refreshPresence(ids);
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 30_000);

  // Windows: определение запущенных игр.
  let off: (() => void) | null = null;
  const bridge = isElectron() ? window.sky?.gameDetect : undefined;
  const applyDetect = (on: boolean) => {
    if (!bridge) return;
    bridge.set(on);
    off?.(); off = null;
    if (!on) { if (detected) { detected = null; void apiGameStop(); } return; }
    off = bridge.onDetected((id) => {
      const g = id ? KNOWN_GAMES.find(x => x.id === id) : null;
      if (g) { detected = g.id; void apiGamePing('game', g.id); }
      else if (detected) { detected = null; void apiGameStop(); }
    });
  };
  applyDetect(useSettings.getState().settings.gameDetect);
  const unsub = useSettings.subscribe((s, prev) => { if (s.settings.gameDetect !== prev.settings.gameDetect) applyDetect(s.settings.gameDetect); });

  return () => { clearInterval(timer); unsub(); off?.(); bridge?.set(false); };
};
