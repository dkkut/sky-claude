/**
 * Пометки и блокировки контента (видео-каналы, каналы мессенджера,
 * фильмы) — одна настоящая таблица вместо localStorage в браузере
 * администратора. Раньше «блокировка» была видна только тому, кто на
 * неё нажал: другой человек на платформе, включая другого
 * администратора, о ней просто не знал.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';

const DOMAINS = new Set(['video-channel', 'messenger-channel', 'movie']);
const WARNINGS = new Set(['casino', '18+', 'casino18']);

const toFlag = (r) => ({
  domain: r.domain,
  targetId: r.target_id,
  warning: r.warning ?? null,
  blocked: r.blocked,
  blockReason: r.block_reason ?? undefined,
  blockedAt: r.blocked_at ? r.blocked_at.toISOString() : undefined,
  blockedBy: r.blocked_by ?? undefined,
});

/** Все пометки разом — списки видео/фильмов/каналов проверяют сразу
 *  много целей, отдельный запрос на каждую был бы лишним. Только
 *  непустые строки (blocked или с warning) — молчаливое большинство
 *  контента без пометок сюда не попадает. */
export const listFlags = async () => {
  const { rows } = await query(
    `SELECT * FROM content_flags WHERE blocked OR warning IS NOT NULL`,
  );
  return rows.map(toFlag);
};

export const setWarning = async (actorId, domain, targetId, warning) => {
  if (!DOMAINS.has(domain)) return { error: 'bad_domain' };
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const w = warning && WARNINGS.has(warning) ? warning : null;
  await query(
    `INSERT INTO content_flags (domain, target_id, warning)
     VALUES ($1,$2,$3)
     ON CONFLICT (domain, target_id) DO UPDATE SET warning = $3, updated_at = now()`,
    [domain, String(targetId ?? ''), w],
  );
  return { ok: true };
};

export const setBlocked = async (actorId, domain, targetId, blocked, reason) => {
  if (!DOMAINS.has(domain)) return { error: 'bad_domain' };
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const id = String(targetId ?? '');
  if (blocked) {
    await query(
      `INSERT INTO content_flags (domain, target_id, blocked, block_reason, blocked_by, blocked_at)
       VALUES ($1,$2,TRUE,$3,$4,now())
       ON CONFLICT (domain, target_id) DO UPDATE
         SET blocked = TRUE, block_reason = $3, blocked_by = $4, blocked_at = now(), updated_at = now()`,
      [domain, id, String(reason ?? '').slice(0, 300) || null, actorId],
    );
  } else {
    await query(
      `INSERT INTO content_flags (domain, target_id, blocked, block_reason, blocked_by, blocked_at)
       VALUES ($1,$2,FALSE,NULL,NULL,NULL)
       ON CONFLICT (domain, target_id) DO UPDATE
         SET blocked = FALSE, block_reason = NULL, blocked_by = NULL, blocked_at = NULL, updated_at = now()`,
      [domain, id],
    );
  }
  return { ok: true };
};
