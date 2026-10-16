/**
 * Sky Storage — фоновые задачи. Работают на сервере независимо от браузера и сессий.
 * Все ограничены по числу одновременных запусков (одна тяжёлая задача за раз — блокировка в skystoragebackup.mjs),
 * имеют тайм-ауты внутри своих операций и не запускаются во время аварийного отключения.
 *   каждые 30 с — расписание резервного копирования;
 *   каждую минуту — просрочка и письма по запросам подтверждения подключений;
 *   каждые 5 мин — проверка доступности площадки копий (с группировкой уведомлений) и порция проверки целостности;
 *   каждые 30 мин — обновление реестра/занятого места; раз в час — уборка (зависшие задачи, карантин, срок копий).
 */
import { snapshot, effective, logEvent, notifyOwners, loadState } from './skystoragestate.mjs';
import { runSchedules, sweepBackups, applyRetention, retentionPlan } from './skystoragebackup.mjs';
import { sweepConnections } from './skystorageaccess.mjs';
import { scanAll, hashPending, purgeQuarantine, refreshUsage } from './skystorageindex.mjs';
import { getTarget, describeTarget } from './skystoragetarget.mjs';
import * as primary from './skystorageprimary.mjs';
import { serviceRoots } from './skystoragelimits.mjs';

const timers = [];
let lastTargetOk = null;
const guard = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`[storage] ${name}:`, e.message); } };
const every = (ms, fn) => { const t = setInterval(fn, ms); t.unref?.(); timers.push(t); };

export const startStorageJobs = () => {
  if (timers.length) return;
  every(30_000, guard('расписание', async () => { if (effective(snapshot()).read) await runSchedules(); }));
  every(60_000, guard('подключения', async () => { await sweepConnections(); }));
  every(5 * 60_000, guard('площадка', async () => {
    const d = describeTarget(); if (!d.configured) return;
    const h = await getTarget().health();
    if (!h.ok && lastTargetOk !== false) { await logEvent('target_down', 'critical', { code: h.code }); await notifyOwners('target_down', 'Площадка резервных копий недоступна', `Код: ${h.code ?? 'ошибка'}. Копии не создаются, пока связь не восстановится.`, { critical: true }); }
    if (h.ok && lastTargetOk === false) await logEvent('target_up', 'info', {});
    lastTargetOk = h.ok;
  }));
  every(5 * 60_000, guard('целостность', async () => { if (effective(snapshot()).read) await hashPending(10); }));
  let syncing = false;
  every(10 * 60_000, guard('синхронизация S3', async () => {
    if (syncing || !primary.enabled()) return;
    syncing = true;
    try {
      const r = await primary.syncAndEvict(serviceRoots().map((x) => x.root), { maxFiles: 200 });
      if (r.uploaded || r.evicted || r.failed) await logEvent('primary_sync', r.failed ? 'warn' : 'info', r);
    } finally { syncing = false; }
  }));
  every(30 * 60_000, guard('реестр', async () => { await refreshUsage(); }));
  setTimeout(guard('первый проход', async () => { await refreshUsage(); await loadState(true); if (effective(snapshot()).read) await scanAll(); }), 45_000).unref?.();
};

/** Часовая уборка (вызывается из общей уборки server.mjs). */
export const sweepStorage = async () => {
  await sweepBackups();
  await purgeQuarantine();
  const p = await retentionPlan().catch(() => ({ plan: [] }));
  if (p.plan.length && effective(snapshot()).read) await applyRetention(null).then((r) => r.deleted && logEvent('retention_auto', 'info', { deleted: r.deleted })).catch(() => {});
};
