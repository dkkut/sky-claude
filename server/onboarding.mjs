/**
 * Путеводитель для новых людей: состояние знакомства хранится на Sky ID (а не в браузере), поэтому не повторяется на другом устройстве.
 * Строка появляется только при регистрации нового Sky ID (`startOnboarding`); у людей, пришедших раньше, строки нет — автоматически им ничего не показывается.
 * Состояния: not_started → started → completed | skipped. Завершённое и пропущенное само не возобновляется; вручную — `restart`.
 */
import { query } from './db.mjs';

export const STEPS = 8;
export const INTERESTS = ['friends', 'video', 'teammates', 'create', 'business', 'wallet', 'all'];
const STALE_HOURS = 24;   // начатое и брошенное дольше суток больше не навязывается

const view = (r) => (r
  ? { status: r.status, step: r.step, interest: r.interest ?? null, auto: r.status === 'not_started' || r.status === 'started' }
  : { status: 'none', step: 0, interest: null, auto: false });

/** Регистрация нового Sky ID. Повтор безвреден. */
export const startOnboarding = async (skyId) => {
  await query('INSERT INTO onboarding_state (sky_id) VALUES ($1) ON CONFLICT DO NOTHING', [skyId]);
};

const skyIdOf = async (profileId) => (await query('SELECT sky_id FROM profiles WHERE id = $1', [profileId])).rows[0]?.sky_id ?? null;

export const getOnboarding = async (profileId) => {
  const sid = await skyIdOf(profileId); if (!sid) return view(null);
  // брошенное на середине давно — считаем пропущенным, чтобы не возвращаться при каждом входе
  await query(`UPDATE onboarding_state SET status='skipped', finished_at=now(), updated_at=now()
                WHERE sky_id=$1 AND status='started' AND updated_at < now() - ($2 || ' hours')::interval`, [sid, String(STALE_HOURS)]);
  return view((await query('SELECT status, step, interest FROM onboarding_state WHERE sky_id=$1', [sid])).rows[0]);
};

/** action: start | step | complete | skip | restart. Все переходы условные — параллельные и повторные запросы безвредны. */
export const actOnboarding = async (profileId, action, body = {}) => {
  const sid = await skyIdOf(profileId); if (!sid) return { error: 'not_found' };
  const step = Math.max(0, Math.min(STEPS, Math.floor(Number(body.step) || 0)));
  const interest = INTERESTS.includes(body.interest) ? body.interest : null;
  if (action === 'restart') {   // ручной запуск из профиля / путеводителя
    await query(`INSERT INTO onboarding_state (sky_id, status, step, started_at) VALUES ($1,'started',0,now())
                 ON CONFLICT (sky_id) DO UPDATE SET status='started', step=0, started_at=now(), finished_at=NULL, updated_at=now()`, [sid]);
  } else if (action === 'start') {
    await query(`UPDATE onboarding_state SET status='started', started_at=COALESCE(started_at, now()), updated_at=now() WHERE sky_id=$1 AND status='not_started'`, [sid]);
  } else if (action === 'step') {
    await query(`UPDATE onboarding_state SET step=GREATEST(step, $2), updated_at=now() WHERE sky_id=$1 AND status IN ('not_started','started')`, [sid, step]);
    await query(`UPDATE onboarding_state SET status='started', started_at=COALESCE(started_at, now()) WHERE sky_id=$1 AND status='not_started'`, [sid]);
  } else if (action === 'complete' || action === 'skip') {
    const st = action === 'complete' ? 'completed' : 'skipped';
    await query(`UPDATE onboarding_state SET status=$2, step=CASE WHEN $2='completed' THEN $3 ELSE step END, interest=COALESCE($4, interest), finished_at=now(), updated_at=now()
                  WHERE sky_id=$1 AND status IN ('not_started','started')`, [sid, st, STEPS, interest]);
  } else if (action === 'interest') {
    if (interest) await query(`UPDATE onboarding_state SET interest=$2, updated_at=now() WHERE sky_id=$1`, [sid, interest]);
  } else return { error: 'bad_action' };
  return { ok: true, ...(await getOnboarding(profileId)) };
};
