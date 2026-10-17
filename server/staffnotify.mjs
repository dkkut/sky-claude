/**
 * Уведомления сотрудникам и владельцу о НОВОМ, что ждёт их решения: заявка на пополнение, заявки продавцов и исполнителей,
 * обращения в поддержку, очереди модерации, споры, апелляции и т. д.
 *
 * Кому: сотрудникам, у кого есть право на очередь (любое из `rights` категории), и владельцу (у него всё). Автору события — нет.
 * Куда: раздел «Уведомления» и push (приходит, когда приложение закрыто) — у каждого по его переключателям
 * (Профиль → Настройки → «Уведомления о заявках»; по умолчанию всё включено, каждую категорию можно отключить).
 * Не чаще предела: сверх `PER_MIN` на человека лишние склеиваются в одно «Ещё N новых в очередях».
 * Одно событие — одно уведомление на человека (ключ `dedupe`, повтор молча пропускается).
 *
 * Содержимое заявок (тексты, документы, реквизиты) сюда не попадает — только название очереди и номер/короткая подпись.
 * Сбой уведомления никогда не мешает основному действию: все вызовы — `notifyStaff(...)` без ожидания результата.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';
import { generateId } from './security.mjs';
import { adminsWith } from './admin.mjs';
import { pushGiftNotification } from './signal.mjs';
import { pushToOffline } from './webpush.mjs';

/** key → подпись и права на очередь. `owner: true` — только владелец (шаг его решения). */
export const CATEGORIES = {
  topup:          { label: 'Заявки на пополнение (SkyKassa)', rights: ['skykassa'] },
  seller_app:     { label: 'Заявки продавцов', rights: ['seller_docs', 'market'] },
  pvz_app:        { label: 'Заявки на ПВЗ', rights: ['pvz_manage', 'market'] },
  product_mod:    { label: 'Карточки товаров на проверке', rights: ['market_moderation'] },
  market_report:  { label: 'Жалобы и апелляции Market', rights: ['market_moderation', 'market'] },
  courier_app:    { label: 'Заявки курьеров', rights: ['market', 'logistics'] },
  go_reg:         { label: 'Заявки исполнителей Sky GO', rights: ['go'] },
  go_dispute:     { label: 'Споры и возвраты Sky GO', rights: ['go'] },
  support:        { label: 'Обращения в поддержку', rights: ['support'] },
  recovery:       { label: 'Заявки на восстановление доступа', rights: ['security', 'support'] },
  site:           { label: 'Сайт: апелляции и заявки на релиз', rights: ['site'] },
  verification:   { label: 'Заявки на верификацию', rights: ['verification'] },
  partners:       { label: 'Партнёры на проверке', rights: ['partners_approve'] },
  content:        { label: 'Контент на проверке (музыка, кино, книги, подкасты)', rights: ['content'] },
  artist_claim:   { label: 'Заявки на владение карточкой музыканта', rights: ['content'] },
  blox:           { label: 'Sky Blox: проверка, жалобы, апелляции', rights: ['blox_moderation', 'blox'] },
  prime_reward:   { label: 'Награды Prime: заявки на выдачу', rights: ['prime'] },
  garant:         { label: 'Споры Sky Garant', rights: ['garant'] },
  violations:     { label: 'Апелляции на нарушения', rights: ['violations'] },
};

const PER_MIN = Number(process.env.STAFF_NOTIFY_PER_MIN) || 30;
const windows = new Map();   // profileId → { start, n, overflow, timer }

const ownerIds = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return [];
  const { rows } = await query('SELECT id FROM profiles WHERE lower(username) = $1', [name]);
  return rows.map((r) => r.id);
};

export const getPrefs = async (profileId) => {
  const { rows } = await query('SELECT in_app, push, muted FROM staff_notify_prefs WHERE profile_id = $1', [profileId]);
  return rows[0] ? { inApp: rows[0].in_app, push: rows[0].push, muted: rows[0].muted ?? [] } : { inApp: true, push: true, muted: [] };
};

export const setPrefs = async (profileId, b) => {
  const inApp = b?.inApp !== false, push = b?.push !== false;
  const muted = Array.isArray(b?.muted) ? [...new Set(b.muted.map(String).filter((k) => k in CATEGORIES))] : [];
  await query(`INSERT INTO staff_notify_prefs (profile_id, in_app, push, muted) VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT (profile_id) DO UPDATE SET in_app = $2, push = $3, muted = $4::jsonb, updated_at = now()`, [profileId, inApp, push, JSON.stringify(muted)]);
  return { ok: true, inApp, push, muted };
};

/** Категории, доступные человеку (по его правам; владельцу — все). */
export const categoriesFor = async (profileId, isOwner, rights) => Object.entries(CATEGORIES)
  .filter(([, c]) => isOwner || (!c.owner && c.rights.some((r) => rights.includes(r))))
  .map(([key, c]) => ({ key, label: c.label }));

const recipients = async (cat, except, skipOwner) => {
  const ids = new Set(skipOwner ? [] : await ownerIds());
  if (!cat.owner) for (const r of cat.rights) for (const a of await adminsWith(r)) ids.add(a.id);
  if (except) ids.delete(except);
  return [...ids];
};

/** Недавние ключи в памяти: для тех, кто отключил раздел «Уведомления» (строки в базе нет) и получает только push. */
const recent = new Map();
const seenRecently = (userId, key) => {
  const k = `${userId}|${key}`, now = Date.now();
  if (recent.size > 5000) for (const [kk, t] of recent) if (now - t > 3_600_000) recent.delete(kk);
  if (recent.has(k) && now - recent.get(k) < 3_600_000) return true;
  recent.set(k, now); return false;
};
const alreadySent = async (userId, key) => seenRecently(userId, key) ||
  (await query("SELECT 1 FROM gift_notifications WHERE user_id = $1 AND kind = 'staff_queue' AND ref_id = $2 LIMIT 1", [userId, key])).rows.length > 0;

const send = async (userId, prefs, title, body, key) => {
  const note = { id: `gnf-${generateId()}`, userId, kind: 'staff_queue', title, body, refId: key, read: false, createdAt: new Date().toISOString() };
  if (prefs.inApp) await query('INSERT INTO gift_notifications (id, user_id, kind, title, body, ref_id) VALUES ($1,$2,$3,$4,$5,$6)', [note.id, userId, 'staff_queue', title, body, key]);
  if (prefs.inApp) pushGiftNotification([userId], note, { inApp: true, push: false });
  if (prefs.push) void pushToOffline([userId], { title, body, url: '/', tag: `sq:${key}` }).catch(() => {});
};

/** Предел на человека: сверх PER_MIN в минуту — копим счётчик и шлём одно сводное уведомление, когда окно закончится. */
const withinLimit = (userId, prefs) => {
  const now = Date.now();
  let w = windows.get(userId);
  if (!w || now - w.start >= 60_000) { w = { start: now, n: 0, overflow: 0, timer: w?.timer ?? null }; windows.set(userId, w); }
  if (w.n < PER_MIN) { w.n += 1; return true; }
  w.overflow += 1;
  if (!w.timer) {
    w.timer = setTimeout(async () => {
      const cur = windows.get(userId); windows.delete(userId);
      if (cur?.overflow) await send(userId, prefs, 'Ещё новые заявки в очередях', `Ещё ${cur.overflow} новых за последнюю минуту — откройте админку.`, `sq-overflow:${userId}:${Date.now()}`).catch(() => {});
    }, Math.max(1000, 60_000 - (now - w.start))).unref?.();
  }
  return false;
};

/**
 * notifyStaff('topup', { title, body, dedupe, except })
 *   title/body — короткие, без личных данных и содержимого заявки; dedupe — ключ события (обязателен: повтор не шлём);
 *   except — профиль автора события (ему не шлём); skipOwner — не слать владельцу (он уже получает это через «заявки на подтверждение»).
 */
export const notifyStaff = async (category, { title, body = '', dedupe, except = null, skipOwner = false } = {}) => {
  try {
    const cat = CATEGORIES[category];
    if (!cat || !dedupe) return 0;
    let sent = 0;
    for (const id of await recipients(cat, except, skipOwner)) {
      const prefs = await getPrefs(id);
      if (prefs.muted.includes(category) || (!prefs.inApp && !prefs.push)) continue;
      const key = `${category}:${dedupe}`;
      if (await alreadySent(id, key)) continue;
      if (!withinLimit(id, prefs)) continue;
      await send(id, prefs, String(title ?? cat.label).slice(0, 120), String(body).slice(0, 240), key);
      sent += 1;
    }
    return sent;
  } catch (err) {
    console.error('[staffnotify]', err.message);
    return 0;
  }
};
