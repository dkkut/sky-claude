/**
 * Sky Ads — данные и права.
 *
 * Подключает уже существующий клиентский интерфейс (src/ads) к
 * реальному серверу: до этого файла кампании, модерация, показы и
 * клики целиком жили в localStorage (useAdsStore), а «показы»/«клики»
 * были Math.random(). Здесь — реальная модель поверх уже существующих
 * систем Sky: Sky ID (рекламодатель — обычный профиль, без отдельного
 * аккаунта), кошелёк (wallet.spend — то же списание, что у Market),
 * Prime (hasPrime), регионы (regions.mjs), admin_log, support-тикеты
 * (жалобы) и RBAC (право 'content' — то же, что у модерации музыки/
 * кино/ТВ/Bloom/SkyVideo).
 *
 * Деньги списываются один раз при создании кампании — весь budget
 * сразу, как и было в исходном клиентском сценарии («Списано: …» в
 * SkyAds.tsx). После этого budget — купленный охват, а не CPM-счётчик:
 * реальный потолок показов — max_impressions_per_day × duration_days,
 * снятый с цены площадки на момент оплаты. «Потрачено» для интерфейса
 * считается пропорционально реально показанному, а не выдумывается.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { hasPrime } from './skyid.mjs';
import { wallet } from './wallet.mjs';
import { regionOf, cleanRegionList } from './regions.mjs';
import { createTicket } from './support.mjs';
import { pushToOffline } from './webpush.mjs';

/* ─── Площадки и цены — единственный источник истины (сервер) ───────
   Та же таблица, что в src/ads/store.ts (AD_PLACEMENTS) — оставлена в
   клиенте для отображения, но ценам и лимитам оттуда сервер не верит:
   при создании кампании он всегда считает сам по этой копии. */
export const PLACEMENTS = {
  video_preroll:  { pricePerDay: 1500, minDays: 3, maxImpressions: 5000,  formats: ['video', 'image'] },
  video_banner:   { pricePerDay: 800,  minDays: 1, maxImpressions: 8000,  formats: ['image', 'text_image'] },
  bloom_feed:     { pricePerDay: 600,  minDays: 1, maxImpressions: 12000, formats: ['text', 'text_image', 'image'] },
  bloom_stories:  { pricePerDay: 1200, minDays: 1, maxImpressions: 7000,  formats: ['image', 'video'] },
  channel_post:   { pricePerDay: 400,  minDays: 1, maxImpressions: 3000,  formats: ['text', 'text_image'] },
  channel_pin:    { pricePerDay: 2500, minDays: 1, maxImpressions: 4000,  formats: ['text', 'text_image', 'image'] },
};
export const PLACEMENT_KEYS = Object.keys(PLACEMENTS);
const MAX_DAYS = 30;

/* ─── Частотные ограничения (пункт 14) ────────────────────────────────
   Значения — конфигурация сервера, не хардкод во frontend: их можно
   поменять здесь в любой момент, ничего на клиенте трогать не нужно. */
const FREQ_CAP = {
  /** Одному человеку — не больше стольки показов одной кампании в сутки. */
  maxImpressionsPerUserPerCampaignPerDay: 5,
  /** Не считать бесконечные обновления страницы честными показами. */
  minSecondsBetweenSamePlacementImpression: 20,
  /** Видеореклама перед роликом: не чаще раза в N секунд на человека (независимо от кампании), чтобы не превращать просмотр в рекламную ленту. */
  videoCooldownSec: Math.max(0, Number(process.env.AD_VIDEO_COOLDOWN_SEC ?? 240)),
};

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 400;
const MAX_LINK = 500;
const MAX_REASON = 500;

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

const newCampaignId = () => `ad-${generateId()}`;
const newEventId = () => `ade-${generateId()}`;
const newImpressionId = () => `adi-${generateId()}`;
const newClickId = () => `adc-${generateId()}`;

/** Ссылка перехода — только настоящий http(s) адрес. javascript:/data:
 * и подобные схемы отклоняются (защита от XSS через «ссылку рекламы»);
 * серверных запросов по ней никогда не делается (нет SSRF-поверхности:
 * переход выполняет браузер, не сервер). */
const cleanLink = (v) => {
  if (!v) return null;
  const s = clean(v, MAX_LINK);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
};

const AD_PUSH = {
  approved: 'Кампания одобрена и запущена', rejected: 'Кампания отклонена модератором',
  paused_by_admin: 'Кампания приостановлена администрацией', resumed_by_admin: 'Кампания возобновлена администрацией',
  completed_by_admin: 'Кампания завершена администрацией', cancelled_by_admin: 'Кампания отменена администрацией',
};

const logEvent = async (campaignId, kind, actorId, detail = '') => {
  await query(
    'INSERT INTO ad_campaign_events (id, campaign_id, kind, actor_id, detail) VALUES ($1,$2,$3,$4,$5)',
    [newEventId(), campaignId, kind, actorId ?? null, clean(detail, 300)],
  );
  /* Решения по кампании рекламодатель получает пушем, если приложение закрыто. */
  if (AD_PUSH[kind]) {
    const { rows } = await query('SELECT advertiser_id, title FROM ad_campaigns WHERE id = $1', [campaignId]);
    if (rows[0] && rows[0].advertiser_id !== actorId) {
      void pushToOffline([rows[0].advertiser_id], { title: 'Sky Ads', body: `${AD_PUSH[kind]}: ${rows[0].title}`, url: '/', tag: `ad:${campaignId}` });
    }
  }
};

/* ─── Представление наружу ────────────────────────────────────────── */

const toCampaign = (r, extra = {}) => ({
  id: r.id,
  userId: r.advertiser_id, // имя поля сохранено таким же, как в уже существующем клиентском типе AdCampaign
  title: r.title,
  description: r.description,
  mediaId: r.media_id ?? undefined,
  linkUrl: r.link_url ?? undefined,
  placement: r.placement,
  format: r.format,
  budget: Number(r.budget),
  dailyLimit: Number(r.daily_limit),
  durationDays: Number(r.duration_days),
  status: r.status,
  createdAt: r.created_at.toISOString(),
  moderatedAt: r.approved_at ? r.approved_at.toISOString() : undefined,
  rejectReason: r.reject_reason ?? undefined,
  startDate: r.starts_at ? r.starts_at.toISOString() : (r.requested_start_at ? r.requested_start_at.toISOString() : undefined),
  endDate: r.ends_at ? r.ends_at.toISOString() : undefined,
  targetRegions: r.target_regions ?? [],
  impressions: Number(extra.impressions ?? 0),
  clicks: Number(extra.clicks ?? 0),
  completedViews: Number(extra.completed ?? 0),
  ctr: Number(extra.impressions ?? 0) > 0
    ? Math.round((Number(extra.clicks ?? 0) / Number(extra.impressions)) * 1000) / 10
    : 0,
  spent: computeSpent(r, extra.impressions ?? 0),
});

/** «Потрачено» — реальная доля купленного охвата, а не выдуманное
 * число: budget × (сколько реально показано / сколько всего куплено). */
function computeSpent(r, impressions) {
  const totalBought = Number(r.max_impressions_per_day) * Number(r.duration_days);
  if (totalBought <= 0) return 0;
  const ratio = Math.min(1, Number(impressions) / totalBought);
  return Math.round(Number(r.budget) * ratio);
}

const impressionsAndClicks = async (campaignIds) => {
  if (!campaignIds.length) return new Map();
  const { rows } = await query(
    `SELECT c.id AS campaign_id,
            (SELECT count(*)::int FROM ad_impressions i WHERE i.campaign_id = c.id) AS impressions,
            (SELECT count(*)::int FROM ad_clicks k WHERE k.campaign_id = c.id) AS clicks,
            (SELECT count(*)::int FROM ad_impressions i WHERE i.campaign_id = c.id AND i.completed) AS completed
       FROM ad_campaigns c WHERE c.id = ANY($1::text[])`,
    [campaignIds],
  );
  return new Map(rows.map((r) => [r.campaign_id, { impressions: r.impressions, clicks: r.clicks, completed: r.completed }]));
};

/* ─── Создание кампании ───────────────────────────────────────────── */

export const createCampaign = async (actorId, body) => {
  const title = clean(body?.title, MAX_TITLE);
  if (!title) return { error: 'empty_title' };
  const description = clean(body?.description, MAX_DESCRIPTION);

  const placement = String(body?.placement ?? '');
  const spec = PLACEMENTS[placement];
  if (!spec) return { error: 'bad_placement' };

  const format = String(body?.format ?? '');
  if (!spec.formats.includes(format)) return { error: 'bad_format' };

  const mediaId = body?.mediaId ? String(body.mediaId) : null;
  if ((format === 'image' || format === 'video' || format === 'text_image') && !mediaId) {
    return { error: 'media_required' };
  }
  if (mediaId && !/^adm-[0-9a-f-]{36}$/.test(mediaId)) return { error: 'bad_media' };
  if (mediaId) {
    // Медиа должен быть загружен ЭТИМ рекламодателем и подходить формату: чужие файлы подставить нельзя.
    const meta = (await query('SELECT owner_id, kind FROM ad_media_meta WHERE media_id = $1', [mediaId])).rows[0];
    if (!meta || meta.owner_id !== actorId) return { error: 'bad_media' };
    if (format === 'video' && meta.kind !== 'video') return { error: 'bad_media' };
    if ((format === 'image' || format === 'text_image') && meta.kind !== 'image') return { error: 'bad_media' };
  }

  const linkUrl = cleanLink(body?.linkUrl);
  if (body?.linkUrl && !linkUrl) return { error: 'bad_link' };

  const days = Math.trunc(Number(body?.durationDays));
  if (!Number.isFinite(days) || days < spec.minDays || days > MAX_DAYS) return { error: 'bad_duration' };

  // Дневной лимит — не ниже цены площадки. Клиент предлагает выбрать
  // из готовых множителей (×1/2/5/10), но сервер не верит выбору —
  // проверяет только настоящую нижнюю границу.
  const dailyLimit = Math.trunc(Number(body?.dailyLimit));
  if (!Number.isFinite(dailyLimit) || dailyLimit < spec.pricePerDay) return { error: 'bad_daily_limit' };

  // Цена — целиком расчёт сервера, а не то, что прислал клиент.
  const budget = dailyLimit * days;

  const targetRegions = cleanRegionList(body?.targetRegions);

  let requestedStart = null;
  if (body?.startDate) {
    const d = new Date(body.startDate);
    if (Number.isNaN(d.getTime())) return { error: 'bad_start' };
    requestedStart = d;
  }

  const id = newCampaignId();

  // Списание — тем же кошельком, что и у Market/Prime (wallet.spend),
  // атомарно, с блокировкой строки счёта. Если создание записи кампании
  // после этого всё же не удастся — возвращаем деньги (wallet.refund),
  // а не оставляем списание висеть без кампании.
  const paid = await wallet.spend(actorId, budget, 'ads', `Реклама: ${title}`, id);
  if (paid.error) return { error: paid.error, balance: paid.balance };

  try {
    await query(
      `INSERT INTO ad_campaigns
         (id, advertiser_id, title, description, format, placement, media_id, link_url,
          target_regions, status, budget, daily_limit, duration_days, max_impressions_per_day,
          wallet_tx_ref, requested_start_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'moderation',$10,$11,$12,$13,$14,$15)`,
      [id, actorId, title, description, format, placement, mediaId, linkUrl,
        targetRegions, budget, dailyLimit, days, spec.maxImpressions, id, requestedStart],
    );
  } catch (err) {
    await wallet.refund(actorId, budget, `Возврат: не удалось создать кампанию «${title}»`, id).catch(() => {});
    throw err;
  }

  await logEvent(id, 'created', actorId, `Бюджет: ${budget} ₽, ${days} дн.`);
  await logEvent(id, 'submitted', actorId, 'Отправлена на модерацию');

  const { rows } = await query('SELECT * FROM ad_campaigns WHERE id = $1', [id]);
  return { campaign: toCampaign(rows[0]) };
};

/* ─── Рекламодатель: свои кампании ────────────────────────────────── */

export const myCampaigns = async (actorId) => {
  const { rows } = await query(
    'SELECT * FROM ad_campaigns WHERE advertiser_id = $1 ORDER BY created_at DESC', [actorId],
  );
  const stats = await impressionsAndClicks(rows.map((r) => r.id));
  return rows.map((r) => toCampaign(r, stats.get(r.id)));
};

const ownedOrModerator = async (actorId, id) => {
  const { rows } = await query('SELECT * FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.advertiser_id !== actorId && !(await can(actorId, 'content'))) return { error: 'not_allowed' };
  return { row };
};

export const campaignDetail = async (actorId, id) => {
  const r = await ownedOrModerator(actorId, id);
  if (r.error) return r;
  const stats = await impressionsAndClicks([id]);

  const [byRegion, byDay, events] = await Promise.all([
    query(
      `SELECT COALESCE(region,'—') AS region, count(*)::int AS n
         FROM ad_impressions WHERE campaign_id = $1 GROUP BY region ORDER BY n DESC LIMIT 20`,
      [id],
    ),
    query(
      `SELECT date_trunc('day', created_at) AS day, count(*)::int AS n
         FROM ad_impressions WHERE campaign_id = $1 GROUP BY day ORDER BY day DESC LIMIT 30`,
      [id],
    ),
    query(
      `SELECT e.id, e.kind, e.actor_id, e.detail, e.created_at, p.name AS actor_name, p.username AS actor_username
         FROM ad_campaign_events e LEFT JOIN profiles p ON p.id = e.actor_id
        WHERE e.campaign_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
      [id],
    ),
  ]);

  return {
    campaign: toCampaign(r.row, stats.get(id)),
    statsByRegion: byRegion.rows.map((x) => ({ region: x.region, impressions: x.n })),
    statsByDay: byDay.rows.map((x) => ({ day: x.day.toISOString().slice(0, 10), impressions: x.n })),
    events: events.rows.map((e) => ({
      id: e.id, kind: e.kind, actorName: e.actor_name ?? undefined, actorUsername: e.actor_username ?? undefined,
      detail: e.detail, createdAt: e.created_at.toISOString(),
    })),
  };
};

/* ─── Рекламодатель: управление своей кампанией ───────────────────── */

const advertiserTransition = async (actorId, id, allowedFrom, nextStatus, kind, extra = {}) => {
  const { rows } = await query('SELECT advertiser_id, status FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.advertiser_id !== actorId) return { error: 'not_allowed' };
  if (!allowedFrom.includes(row.status)) return { error: 'bad_status' };

  const sets = ['status = $2', 'updated_at = now()'];
  const args = [id, nextStatus];
  for (const [col, val] of Object.entries(extra)) { args.push(val); sets.push(`${col} = $${args.length}`); }
  const { rowCount } = await query(
    `UPDATE ad_campaigns SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($${args.length + 1}::text[])`,
    [...args, allowedFrom],
  );
  if (rowCount === 0) return { error: 'bad_status' };
  await logEvent(id, kind, actorId);
  return { ok: true };
};

export const pauseCampaign = (actorId, id) =>
  advertiserTransition(actorId, id, ['active'], 'paused', 'paused', { paused_at: new Date() });

export const resumeCampaign = (actorId, id) =>
  advertiserTransition(actorId, id, ['paused'], 'active', 'resumed', { paused_at: null });


/**
 * Перевод кампании в конечный статус И возврат бюджета — одной транзакцией.
 * Раньше статус менялся одним запросом, а возврат шёл следом отдельным
 * вызовом с `.catch(() => {})`: сбой кошелька после смены статуса молча
 * оставлял рекламодателя без денег и без кампании. Теперь либо оба шага,
 * либо ни одного (и статус не меняется, пока возврат не прошёл).
 * Возвращает { ok: true } или { error: 'bad_status' | 'refund_failed' }.
 */
const finishWithRefund = async ({ id, advertiserId, budget, title, fromStatuses, set, params, descr }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE ad_campaigns SET ${set}, updated_at = now() WHERE id = $1 AND status = ANY($2::text[])`,
      [id, fromStatuses, ...params]);
    if (rowCount === 0) { await client.query('ROLLBACK'); return { error: 'bad_status' }; }
    const credited = await wallet.creditIn(client, advertiserId, budget, 'refund', descr, id);
    if (credited.error) { await client.query('ROLLBACK'); return { error: 'refund_failed' }; }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Отмена — только пока кампания ещё не пошла в реальный показ; деньги
 * возвращаются (wallet.refund), как и при отклонении модерацией. */
export const cancelCampaign = async (actorId, id) => {
  const { rows } = await query('SELECT advertiser_id, status, budget, title FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.advertiser_id !== actorId) return { error: 'not_allowed' };
  if (!['draft', 'moderation', 'approved', 'scheduled'].includes(row.status)) return { error: 'bad_status' };

  const done = await finishWithRefund({
    id, advertiserId: row.advertiser_id, budget: Number(row.budget), title: row.title,
    fromStatuses: ['draft', 'moderation', 'approved', 'scheduled'],
    set: `status = 'cancelled', cancelled_by = $3, cancelled_at = now()`, params: [actorId],
    descr: `Возврат: отменена кампания «${row.title}»`,
  });
  if (done.error) return done;
  await logEvent(id, 'cancelled', actorId);
  return { ok: true };
};

/* ─── Жалоба на рекламу — существующая очередь поддержки ──────────── */

export const reportCampaign = async (actorId, id, reason) => {
  const { rows } = await query('SELECT title FROM ad_campaigns WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  const body = clean(reason, MAX_REASON) || 'Без комментария';
  return createTicket(actorId, {
    subject: `Жалоба на рекламу: ${rows[0].title}`,
    body: `Кампания ${id}\n${body}`,
    kind: 'report',
  });
};

/* ─── Настройки рекламы перед видео (правит администрация, кэш 15 с) ───────── */
let prerollCache = { at: 0, v: null };
const PREROLL_DEFAULTS = { enabled: true, cooldownSec: FREQ_CAP.videoCooldownSec, skipAfterSec: 5, maxPerUserDay: FREQ_CAP.maxImpressionsPerUserPerCampaignPerDay, label: 'Реклама' };
const prerollRow = (r) => r && ({ enabled: !!r.enabled, cooldownSec: Number(r.cooldown_sec), skipAfterSec: Number(r.skip_after_sec), maxPerUserDay: Number(r.max_per_user_day), label: r.label || 'Реклама', updatedAt: r.updated_at, updatedBy: r.updated_by });
export const prerollSettings = async () => {
  if (prerollCache.v && Date.now() - prerollCache.at < 15000) return prerollCache.v;
  let v = PREROLL_DEFAULTS;
  try { v = prerollRow((await query('SELECT * FROM ad_preroll_settings WHERE id = 1')).rows[0]) ?? PREROLL_DEFAULTS; } catch { /* таблицы ещё нет — прежние значения */ }
  prerollCache = { at: Date.now(), v }; return v;
};
export const adminGetPreroll = async (actorId) => { if (!(await can(actorId, 'content'))) return { error: 'not_allowed' }; prerollCache.at = 0; return { settings: await prerollSettings() }; };
export const adminSavePreroll = async (actorId, b = {}) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const int = (x, lo, hi) => { const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };
  const cd = int(b.cooldownSec, 0, 86400), sk = int(b.skipAfterSec, 0, 30), mx = int(b.maxPerUserDay, 1, 50);
  if (cd === null || sk === null || mx === null) return { error: 'bad_value' };
  const label = clean(b.label, 40) || 'Реклама';
  await query(`UPDATE ad_preroll_settings SET enabled=$1, cooldown_sec=$2, skip_after_sec=$3, max_per_user_day=$4, label=$5, updated_by=$6, updated_at=now() WHERE id=1`,
    [b.enabled !== false, cd, sk, mx, label, actorId]);
  prerollCache.at = 0; return { settings: await prerollSettings() };
};

/* ─── Показ рекламы пользователю (пункт 7) ────────────────────────── */

/**
 * 12-пунктовая проверка из брифа — авторизация и «пользователь»
 * проверены вызывающей стороной (requireProfile, до вызова этой
 * функции). Здесь — всё остальное: Prime/тариф, регион, площадка,
 * статус и период кампании, бюджет/лимит, частотные ограничения.
 */
export const resolveAdForPlacement = async (viewerId, placement) => {
  if (!PLACEMENTS[placement]) return null;
  if (await hasPrime(viewerId)) return null; // Prime — без рекламы, решает только сервер
  const pre = placement === 'video_preroll' ? await prerollSettings() : null;
  if (pre && !pre.enabled) return null;
  if (pre && pre.cooldownSec > 0) {
    const { rows: recent } = await query(
      "SELECT 1 FROM ad_impressions WHERE user_id = $1 AND placement = 'video_preroll' AND created_at > now() - ($2 || ' seconds')::interval LIMIT 1",
      [viewerId, String(pre.cooldownSec)]);
    if (recent.length) return null;
  }

  const region = await regionOf(viewerId);

  const { rows } = await query(
    `SELECT c.*,
            (SELECT count(*)::int FROM ad_impressions i
              WHERE i.campaign_id = c.id AND i.created_at > date_trunc('day', now())) AS today_impressions
       FROM ad_campaigns c
      WHERE c.placement = $1 AND c.status = 'active'
        AND c.starts_at <= now() AND c.ends_at > now()
        AND (cardinality(c.target_regions) = 0 OR $2::text IS NULL OR c.target_regions @> ARRAY[$2::text])
      ORDER BY today_impressions ASC, c.created_at ASC
      LIMIT 20`,
    [placement, region],
  );
  if (!rows.length) return null;

  for (const row of rows) {
    // Дневной и пожизненный потолок показов — тот самый «доступный
    // бюджет/лимит», без выдуманного CPM-счётчика.
    if (Number(row.today_impressions) >= Number(row.max_impressions_per_day)) continue;
    const { rows: total } = await query(
      'SELECT count(*)::int AS n FROM ad_impressions WHERE campaign_id = $1', [row.id],
    );
    if (Number(total[0].n) >= Number(row.max_impressions_per_day) * Number(row.duration_days)) continue;

    // Частота на этого зрителя.
    const { rows: mine } = await query(
      `SELECT count(*) FILTER (WHERE created_at > date_trunc('day', now())) AS today,
              max(created_at) FILTER (WHERE placement = $3) AS last_same_placement
         FROM ad_impressions WHERE campaign_id = $1 AND user_id = $2`,
      [row.id, viewerId, placement],
    );
    if (Number(mine[0].today) >= (pre ? pre.maxPerUserDay : FREQ_CAP.maxImpressionsPerUserPerCampaignPerDay)) continue;
    const last = mine[0].last_same_placement;
    if (last && (Date.now() - new Date(last).getTime()) / 1000 < FREQ_CAP.minSecondsBetweenSamePlacementImpression) continue;

    const dur = row.media_id ? (await query('SELECT duration_sec FROM ad_media_meta WHERE media_id = $1', [row.media_id])).rows[0]?.duration_sec : null;
    return {
      campaignId: row.id,
      title: row.title,
      description: row.description,
      mediaUrl: row.media_id ? `/api/ads/media/${row.media_id}` : undefined,
      format: row.format,
      linkUrl: row.link_url ?? undefined,
      durationSec: dur != null ? Number(dur) : undefined,
      ...(pre ? { skipAfterSec: pre.skipAfterSec, label: pre.label } : {}),
    };
  }
  return null;
};

/* ─── Показы и клики (пункты 8–9) ─────────────────────────────────── */

/** Записывает показ, только если ровно эта кампания сейчас реально
 * подходит этому зрителю на этой площадке — не доверяет самому факту
 * присланного campaignId: перепроверяет то же самое, чем отдавала бы
 * рекламу (regionOf с сервера, Prime, статус/период, частота). */
export const recordImpression = async (viewerId, campaignId, placement) => {
  const offer = await resolveAdForPlacement(viewerId, placement);
  if (!offer || offer.campaignId !== campaignId) return { error: 'not_eligible' };

  const { rows } = await query('SELECT advertiser_id FROM ad_campaigns WHERE id = $1', [campaignId]);
  if (!rows[0]) return { error: 'not_found' };

  const region = await regionOf(viewerId);
  const id = newImpressionId();
  await query(
    'INSERT INTO ad_impressions (id, campaign_id, advertiser_id, user_id, placement, region) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, campaignId, rows[0].advertiser_id, viewerId, placement, region],
  );
  return { impressionId: id };
};

/** Подтверждение просмотра: клиент сообщает, сколько секунд рекламы реально шло. Сервер не верит числу без проверки по времени:
 * нельзя «досмотреть» 30 секунд за 3, нельзя больше длительности ролика, нельзя уменьшить уже записанное. */
export const recordView = async (viewerId, impressionId, watchedSecRaw) => {
  const w = Number(watchedSecRaw);
  if (!Number.isFinite(w) || w < 0 || w > 600) return { error: 'bad_value' };
  const imp = (await query(
    `SELECT i.id, i.user_id, i.created_at, i.watched_sec, m.duration_sec
       FROM ad_impressions i JOIN ad_campaigns c ON c.id = i.campaign_id LEFT JOIN ad_media_meta m ON m.media_id = c.media_id
      WHERE i.id = $1`, [String(impressionId ?? '')])).rows[0];
  if (!imp || imp.user_id !== viewerId) return { error: 'not_found' };
  const elapsed = (Date.now() - new Date(imp.created_at).getTime()) / 1000;
  let watched = Math.min(w, elapsed + 1.5);                         // нельзя «посмотреть» дольше, чем прошло с показа
  if (imp.duration_sec != null) watched = Math.min(watched, Number(imp.duration_sec) + 0.5);
  watched = Math.max(Number(imp.watched_sec), Math.round(watched * 100) / 100);
  const completed = imp.duration_sec != null && watched >= Number(imp.duration_sec) - 1;
  await query('UPDATE ad_impressions SET watched_sec = $2, completed = completed OR $3 WHERE id = $1', [imp.id, watched, completed]);
  return { ok: true, watchedSec: watched, completed };
};

/** Клик — только на собственный, реально записанный показ этого же
 * зрителя по этой же кампании (см. UNIQUE(impression_id) в миграции —
 * повторный клик по тому же показу не учитывается дважды). */
export const recordClick = async (viewerId, campaignId, impressionId, placement) => {
  const { rows } = await query(
    'SELECT campaign_id, user_id FROM ad_impressions WHERE id = $1', [String(impressionId ?? '')],
  );
  const imp = rows[0];
  if (!imp || imp.campaign_id !== campaignId || imp.user_id !== viewerId) return { error: 'bad_impression' };

  const { rows: camp } = await query('SELECT advertiser_id, link_url, status FROM ad_campaigns WHERE id = $1', [campaignId]);
  if (!camp[0]) return { error: 'not_found' };

  const region = await regionOf(viewerId);
  try {
    await query(
      'INSERT INTO ad_clicks (id, campaign_id, impression_id, advertiser_id, user_id, placement, region) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [newClickId(), campaignId, impressionId, camp[0].advertiser_id, viewerId, placement, region],
    );
  } catch (err) {
    // UNIQUE(impression_id): повтор того же клика — не ошибка, просто
    // не считаем во второй раз (replay-защита, не сбой запроса).
    if (err.code !== '23505') throw err;
  }
  return { ok: true, linkUrl: camp[0].link_url ?? undefined };
};

/* ─── Уведомления рекламодателю (по образцу recentEvents у Bloom) ─── */

export const recentAdEvents = async (userId, sinceIso) => {
  const { rows } = await query(
    `SELECT e.id, e.kind, e.detail, e.created_at, c.title, c.id AS campaign_id
       FROM ad_campaign_events e JOIN ad_campaigns c ON c.id = e.campaign_id
      WHERE c.advertiser_id = $1 AND e.created_at > $2
        AND e.kind IN ('approved','rejected','paused_by_admin','resumed_by_admin','completed_by_admin','cancelled_by_admin')
      ORDER BY e.created_at ASC LIMIT 20`,
    [userId, sinceIso],
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, campaignId: r.campaign_id,
    detail: r.detail, createdAt: r.created_at.toISOString(),
  }));
};

/* ─── Админка (пункты 3, 15) ───────────────────────────────────────── */

export const adminListCampaigns = async (actorId, { status, q, limit } = {}) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`c.status = $${args.length}`); }
  if (q) {
    args.push(`%${String(q).toLowerCase()}%`);
    where.push(`(lower(c.title) LIKE $${args.length} OR lower(p.username) LIKE $${args.length} OR c.id = $${args.length + 1})`);
    args.push(String(q));
  }
  args.push(lim);
  const { rows } = await query(
    `SELECT c.*, p.name AS advertiser_name, p.username AS advertiser_username
       FROM ad_campaigns c JOIN profiles p ON p.id = c.advertiser_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC LIMIT $${args.length}`,
    args,
  );
  const stats = await impressionsAndClicks(rows.map((r) => r.id));
  return {
    items: rows.map((r) => ({
      ...toCampaign(r, stats.get(r.id)),
      advertiserName: r.advertiser_name, advertiserUsername: r.advertiser_username,
    })),
  };
};

const adminAction = async (actorId, id, allowedFrom, nextStatus, kind, extra = {}) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM ad_campaigns WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  if (!allowedFrom.includes(rows[0].status)) return { error: 'bad_status' };

  const sets = ['status = $2', 'updated_at = now()'];
  const args = [id, nextStatus];
  for (const [col, val] of Object.entries(extra)) { args.push(val); sets.push(`${col} = $${args.length}`); }
  const { rowCount } = await query(
    `UPDATE ad_campaigns SET ${sets.join(', ')} WHERE id = $1 AND status = ANY($${args.length + 1}::text[])`,
    [...args, allowedFrom],
  );
  if (rowCount === 0) return { error: 'bad_status' };
  await logEvent(id, kind, actorId);
  return { ok: true };
};

/** Одобрение: если запрошенный старт уже наступил (или не был указан) —
 * сразу 'active', иначе 'scheduled' — активирует worker по времени. */
export const adminApprove = async (actorId, id) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status, duration_days, requested_start_at FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.status !== 'moderation') return { error: 'bad_status' };

  const start = row.requested_start_at && row.requested_start_at.getTime() > Date.now() ? row.requested_start_at : new Date();
  const end = new Date(start.getTime() + Number(row.duration_days) * 86_400_000);
  const immediate = start.getTime() <= Date.now();

  const { rowCount } = await query(
    `UPDATE ad_campaigns
        SET status = $2, starts_at = $3, ends_at = $4, approved_by = $5, approved_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'moderation'`,
    [id, immediate ? 'active' : 'scheduled', start, end, actorId],
  );
  if (rowCount === 0) return { error: 'bad_status' };
  await logEvent(id, 'approved', actorId, immediate ? 'Запущена' : `Запланирована на ${start.toISOString()}`);
  return { ok: true };
};

export const adminReject = async (actorId, id, reason) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status, advertiser_id, budget, title FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.status !== 'moderation') return { error: 'bad_status' };

  const why = clean(reason, MAX_REASON);
  const done = await finishWithRefund({
    id, advertiserId: row.advertiser_id, budget: Number(row.budget), title: row.title,
    fromStatuses: ['moderation'],
    set: `status = 'rejected', reject_reason = $3`, params: [why || null],
    descr: `Возврат: отклонена кампания «${row.title}»`,
  });
  if (done.error) return done;
  await logEvent(id, 'rejected', actorId, why);
  return { ok: true };
};

export const adminPause = (actorId, id) => adminAction(actorId, id, ['active'], 'paused', 'paused_by_admin', { paused_at: new Date() });
export const adminResume = (actorId, id) => adminAction(actorId, id, ['paused'], 'active', 'resumed_by_admin', { paused_at: null });
export const adminComplete = (actorId, id) => adminAction(actorId, id, ['active', 'paused', 'scheduled'], 'completed', 'completed_by_admin');

export const adminCancel = async (actorId, id) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status, advertiser_id, budget, title FROM ad_campaigns WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (!['moderation', 'approved', 'scheduled', 'active', 'paused'].includes(row.status)) return { error: 'bad_status' };

  const done = await finishWithRefund({
    id, advertiserId: row.advertiser_id, budget: Number(row.budget), title: row.title,
    fromStatuses: ['moderation', 'approved', 'scheduled', 'active', 'paused'],
    set: `status = 'cancelled', cancelled_by = $3, cancelled_at = now()`, params: [actorId],
    descr: `Возврат: кампания «${row.title}» отменена администрацией`,
  });
  if (done.error) return done;
  await logEvent(id, 'cancelled_by_admin', actorId);
  return { ok: true };
};

/* ─── Worker: время (пункт 13) ─────────────────────────────────────── */

export const activateDueCampaigns = async () => {
  const { rows } = await query(
    `UPDATE ad_campaigns SET status = 'active', updated_at = now()
      WHERE status = 'scheduled' AND starts_at <= now() RETURNING id`,
  );
  for (const r of rows) await logEvent(r.id, 'activated_by_schedule', null);
};

export const completeExpiredCampaigns = async () => {
  const { rows } = await query(
    `UPDATE ad_campaigns SET status = 'completed', updated_at = now()
      WHERE status IN ('active','paused') AND ends_at <= now() RETURNING id`,
  );
  for (const r of rows) await logEvent(r.id, 'completed_by_schedule', null);
};

/* ─── Уборка медиа без кампании ────────────────────────────────────── */

export const sweepOrphanAdMedia = async () => {
  const { listStoredIds, remove } = await import('./adstore.mjs');
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const { rows } = await query('SELECT media_id FROM ad_campaigns WHERE media_id = ANY($1::text[])', [stored]);
  const used = new Set(rows.map((r) => r.media_id));
  const { rows: fresh } = await query("SELECT media_id FROM ad_media_meta WHERE media_id = ANY($1::text[]) AND created_at > now() - interval '2 hours'", [stored]);
  const young = new Set(fresh.map((r) => r.media_id));            // только что загруженное ещё ждёт создания кампании
  const orphans = stored.filter((id) => !used.has(id) && !young.has(id));
  for (const id of orphans) await remove(id);
  if (orphans.length) await query('DELETE FROM ad_media_meta WHERE media_id = ANY($1::text[])', [orphans]).catch(() => {});
  return { removed: orphans.length };
};
