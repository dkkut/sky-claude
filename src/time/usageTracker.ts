/**
 * Sky Balance — клиентский учёт активного времени по разделам.
 * Работает только если человек сам включил учёт (Sky Time → Баланс). Считаются секунды по ключу раздела,
 * пока вкладка видна и были действия за последнюю минуту; пачка уходит раз в минуту. Ничего не блокируется:
 * при достижении лимита показывается одно напоминание в сутки на лимит (Sky Island), вне тихих часов.
 */
import { useAuthStore } from '@/core/auth/store';
import { useModuleStore } from '@/data/state/modules';
import { useIslandStore } from '@/island/islandStore';
import { timeApi, type BalanceSettings } from './api';

const TITLES: Record<string, string> = {
  stories: 'Истории', messages: 'Мессенджер', bloom: 'Bloom', extras: 'Sky Media', profile: 'Профиль', notifications: 'Уведомления',
  gaming: 'Игры', video: 'Sky Video', library: 'Библиотека', studio: 'Студия', business: 'Бизнес',
};
export const moduleTitle = (k: string) => TITLES[k] ?? k;

const TICK_MS = 5_000, ACTIVE_WINDOW_MS = 60_000, FLUSH_MS = 60_000;
let started = false;

export const startUsageTracker = () => {
  if (started) return; started = true;
  let settings: BalanceSettings | null = null;
  let todayBase: Record<string, number> = {};
  const pending: Record<string, number> = {};
  const local: Record<string, number> = {};
  let lastActive = Date.now();
  const bump = () => { lastActive = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, bump, { passive: true, capture: true });

  const uid = () => useAuthStore.getState().currentUserId;
  const dayKey = () => new Date().toISOString().slice(0, 10);
  let day = dayKey();

  const reload = async () => {
    if (!uid()) { settings = null; return; }
    const r = await timeApi.balance();
    settings = r.ok && r.data ? r.data : null;
    if (settings?.tracking) {
      const rep = await timeApi.report(1);
      todayBase = rep.ok && rep.data ? rep.data.today : {};
      for (const k of Object.keys(local)) delete local[k];
    }
  };
  window.addEventListener('sky:balance-changed', () => void reload());

  const quiet = () => {
    if (!settings || settings.quietFrom == null || settings.quietTo == null) return false;
    const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    const { quietFrom: f, quietTo: t } = settings;
    return f <= t ? m >= f && m < t : m >= f || m < t;
  };
  const nudge = (key: string, title: string, body: string) => {
    const mark = `sky:balance:nudged:${dayKey()}:${key}`;
    if (localStorage.getItem(mark) || quiet()) return;
    localStorage.setItem(mark, '1');
    useIslandStore.getState().push({ kind: 'system', title, body, ttl: 8000, mergeKey: `balance:${key}`, letter: '⏱' });
  };
  const check = (mod: string) => {
    if (!settings?.tracking) return;
    const total = Object.keys({ ...todayBase, ...local }).reduce((a, k) => a + (todayBase[k] ?? 0) + (local[k] ?? 0), 0);
    const modSec = (todayBase[mod] ?? 0) + (local[mod] ?? 0);
    const lim = settings.limits[mod];
    if (lim && modSec >= lim * 60) nudge(`m:${mod}`, 'Лимит раздела достигнут', `Сегодня в разделе «${moduleTitle(mod)}» уже ${Math.round(modSec / 60)} мин — вы сами задали лимит ${lim} мин.`);
    if (settings.dailyTotal && total >= settings.dailyTotal * 60) nudge('total', 'Дневной лимит достигнут', `Сегодня в Sky уже ${Math.round(total / 60)} мин — вы задали лимит ${settings.dailyTotal} мин. Решайте сами: можно сделать перерыв.`);
  };

  window.setInterval(() => {
    if (document.hidden || !uid() || !settings?.tracking) return;
    if (dayKey() !== day) { day = dayKey(); todayBase = {}; for (const k of Object.keys(local)) delete local[k]; }
    if (Date.now() - lastActive > ACTIVE_WINDOW_MS) return;
    const mod = useModuleStore.getState().activeModule;
    const s = TICK_MS / 1000;
    pending[mod] = (pending[mod] ?? 0) + s; local[mod] = (local[mod] ?? 0) + s;
    check(mod);
  }, TICK_MS);

  const flush = () => {
    const entries = Object.entries(pending).filter(([, s]) => s > 0).map(([module, seconds]) => ({ module, seconds }));
    if (!entries.length || !uid()) return;
    for (const k of Object.keys(pending)) delete pending[k];
    void timeApi.sendUsage(entries.slice(0, 12));
  };
  window.setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  let lastUid: string | null = null;
  useAuthStore.subscribe((s) => { if (s.currentUserId !== lastUid) { lastUid = s.currentUserId; settings = null; if (lastUid) void reload(); } });
  if (uid()) { lastUid = uid(); void reload(); }
};
