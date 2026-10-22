/**
 * Sky QR — обмен контактами через QR-код.
 *
 * В QR лежит только адрес с коротким случайным публичным кодом (`<origin>/?qr=КОД`): ни токена, ни сессии, ни закрытых данных.
 * Код привязан к профилю на сервере, его можно обновить (старый перестаёт работать) или отозвать. Что показывать после
 * сканирования сверх имени, ника и аватара (они и так видны в поиске людей), выбирает владелец (`fields`).
 * Карточку по коду видит только вошедший человек; перебор ограничен (лимиты в routes/skyqr.mjs). Добавление в контакты —
 * существующая дружба (friends.mjs), отдельной системы контактов нет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { friendStatus } from './friends.mjs';
import { logEvent as skyLog } from './skylog.mjs';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // без путаемых 0/O, 1/I/L
export const CODE_RE = /^[A-HJ-KM-NP-Z2-9]{12}$/;
/** Необязательные данные, которые владелец может показать по QR. Всё остальное через QR не отдаётся никогда. */
export const FIELDS = ['bio', 'links', 'status', 'country'];
const newCode = () => Array.from(crypto.randomBytes(12), (b) => ALPHA[b % ALPHA.length]).join('');
const err = (error, extra = {}) => ({ error, ...extra });

const cleanFields = (f) => Object.fromEntries(FIELDS.map((k) => [k, f?.[k] === true]));
export const urlFor = (code, origin) => `${(config.publicOrigin || origin || '').replace(/\/$/, '')}/?qr=${code}`;

const view = (r, origin) => ({ exists: true, code: r.code, url: urlFor(r.code, origin), enabled: r.enabled, fields: cleanFields(r.fields), scans: r.scans, rotatedAt: r.rotated_at?.toISOString?.() ?? null });

export const getMine = async (profileId, origin) => {
  const r = (await query('SELECT * FROM sky_qr_cards WHERE profile_id = $1', [profileId])).rows[0];
  return r ? view(r, origin) : { exists: false, fields: cleanFields({}), available: FIELDS };
};

/** Создать код или изменить настройки (включён / что показывать). */
export const saveMine = async (profileId, { enabled, fields }, origin) => {
  const cur = (await query('SELECT * FROM sky_qr_cards WHERE profile_id = $1', [profileId])).rows[0];
  if (!cur) {
    for (let i = 0; i < 5; i++) {
      const ins = await query(`INSERT INTO sky_qr_cards (profile_id, code, enabled, fields) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`,
        [profileId, newCode(), enabled !== false, JSON.stringify(cleanFields(fields))]);
      if (ins.rows[0]) { skyLog({ category: 'user', service: 'skyqr', type: 'qr_created', actorId: profileId }); return view(ins.rows[0], origin); }
      if ((await query('SELECT 1 FROM sky_qr_cards WHERE profile_id = $1', [profileId])).rowCount) break;   // параллельный запрос уже создал
    }
    return getMine(profileId, origin);
  }
  const next = { enabled: enabled === undefined ? cur.enabled : enabled === true, fields: fields === undefined ? cleanFields(cur.fields) : cleanFields(fields) };
  const up = await query('UPDATE sky_qr_cards SET enabled = $2, fields = $3, updated_at = now() WHERE profile_id = $1 RETURNING *', [profileId, next.enabled, JSON.stringify(next.fields)]);
  skyLog({ category: 'user', service: 'skyqr', type: 'qr_settings', actorId: profileId, detail: { enabled: next.enabled } });
  return view(up.rows[0], origin);
};

/** Новый код: прежний сразу перестаёт открывать карточку (напечатанные и сохранённые изображения становятся недействительными). */
export const rotate = async (profileId, origin) => {
  for (let i = 0; i < 5; i++) {
    const up = await query('UPDATE sky_qr_cards SET code = $2, rotated_at = now(), enabled = TRUE, updated_at = now() WHERE profile_id = $1 RETURNING *', [profileId, newCode()]).catch(() => null);
    if (up?.rows[0]) { skyLog({ category: 'user', service: 'skyqr', type: 'qr_rotated', actorId: profileId }); return view(up.rows[0], origin); }
    if (up && !up.rows[0]) return err('not_found');
  }
  return err('try_again');
};

/** Отозвать: код перестаёт работать, настройки остаются; включить снова — saveMine({enabled:true}) или rotate. */
export const revoke = async (profileId, origin) => {
  const up = await query('UPDATE sky_qr_cards SET enabled = FALSE, updated_at = now() WHERE profile_id = $1 RETURNING *', [profileId]);
  if (!up.rows[0]) return err('not_found');
  skyLog({ category: 'user', service: 'skyqr', type: 'qr_revoked', actorId: profileId });
  return view(up.rows[0], origin);
};

const publicPart = (p) => ({ id: p.id, name: p.name, username: p.username, avatar: p.avatar || null });

const extras = (p, fields) => {
  const x = p.profile_extra ?? {};
  const out = {};
  if (fields.bio && p.bio) out.bio = String(p.bio).slice(0, 300);
  if (fields.links && Array.isArray(x.links)) out.links = x.links.filter((l) => /^https?:\/\//i.test(String(l))).slice(0, 5).map((l) => String(l).slice(0, 200));
  if (fields.status && x.customStatus) out.status = String(x.customStatus).slice(0, 100);
  if (fields.country && x.country) out.country = String(x.country).slice(0, 60);
  return out;
};

const card = async (p, meId, fields) => ({
  profile: publicPart(p), shared: extras(p, fields), self: p.id === meId, friend: await friendStatus(meId, p.id),
});

/** Карточка по коду из QR. Неверный/отозванный/просроченный код неотличимы: not_found. */
export const lookupCode = async (code, meId) => {
  if (!CODE_RE.test(String(code ?? ''))) return err('not_found');
  const r = (await query(`SELECT c.fields, c.enabled, p.id, p.name, p.username, p.avatar, p.bio, p.profile_extra
                            FROM sky_qr_cards c JOIN profiles p ON p.id = c.profile_id
                           WHERE c.code = $1 AND p.deleted_at IS NULL`, [code])).rows[0];
  if (!r || !r.enabled) return err('not_found');
  if (r.id !== meId) await query('UPDATE sky_qr_cards SET scans = scans + 1 WHERE code = $1', [code]).catch(() => {});
  return card(r, meId, cleanFields(r.fields));
};

/** Ручной ввод ника: только то, что и так видно в поиске людей (без необязательных данных QR). */
export const lookupUsername = async (raw, meId) => {
  const u = String(raw ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.-]{2,32}$/.test(u)) return err('not_found');
  const r = (await query('SELECT id, name, username, avatar FROM profiles WHERE lower(username) = $1 AND deleted_at IS NULL', [u])).rows[0];
  if (!r) return err('not_found');
  return card({ ...r, bio: null, profile_extra: {} }, meId, {});
};

/** Из текста QR или ссылки достаёт код (клиенту не нужно доверять формату, но сервер ждёт только сам код). */
export const codeFromText = (text) => {
  const s = String(text ?? '').trim();
  const m = /[?&]qr=([A-Za-z0-9]{12})(?:$|[&#])/.exec(s);
  const c = (m ? m[1] : s).toUpperCase();
  return CODE_RE.test(c) ? c : null;
};
