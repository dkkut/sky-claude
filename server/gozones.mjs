/**
 * Sky GO: зоны внутри города. Зона — круг (центр, радиус). Два вида:
 *  surcharge — доплата, если точка подачи или назначения попала в зону (одна доплата за зону);
 *  closed    — сервис в зоне недоступен (заказ с такой точкой не создаётся).
 * Зоны меняют только цену и допуск заказа; положение людей и исполнителей они не хранят и не отслеживают.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { newId, haversineKm, clean, goLog } from './gocore.mjs';

const SERVICES = ['taxi', 'delivery'];
let cache = { at: 0, rows: [] };
export const forgetZones = () => { cache = { at: 0, rows: [] }; };

const activeZones = async () => {
  if (Date.now() - cache.at < 15000) return cache.rows;
  const { rows } = await query(`SELECT * FROM go_zones WHERE active`);
  cache = { at: Date.now(), rows };
  return rows;
};

const inside = (z, p) => p && p.lat != null && haversineKm({ lat: z.lat, lng: z.lng }, p) <= z.radius_km;

/** Что зоны делают с этим заказом. hit — краткая подпись попавших зон (для версии тарифа: сменились зоны — цена пересчитывается). */
export const zoneEffect = async (city, service, from, to) => {
  const zones = (await activeZones()).filter((z) => z.city === city && z.services.includes(service));
  const hits = [];
  for (const z of zones) {
    const where = inside(z, from) && inside(z, to) ? 'both' : inside(z, from) ? 'from' : inside(z, to) ? 'to' : null;
    if (where) hits.push({ id: z.id, name: z.name, kind: z.kind, rub: z.kind === 'surcharge' ? z.surcharge_rub : 0, where, note: z.note });
  }
  const closed = hits.find((h) => h.kind === 'closed') ?? null;
  const surcharges = hits.filter((h) => h.kind === 'surcharge' && h.rub > 0);
  return { closed, surcharges, totalRub: surcharges.reduce((a, h) => a + h.rub, 0), hit: hits.map((h) => `${h.id}:${h.kind}:${h.rub}`).sort() };
};

const view = (z) => ({ id: z.id, city: z.city, name: z.name, services: z.services, kind: z.kind, lat: z.lat, lng: z.lng, radiusKm: z.radius_km, surchargeRub: z.surcharge_rub, note: z.note, active: z.active, createdAt: z.created_at.toISOString() });

export const listZones = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT * FROM go_zones ORDER BY city, active DESC, name`);
  return { ok: true, zones: rows.map(view) };
};

const parse = (b) => {
  const city = clean(b?.city, 60); const name = clean(b?.name, 80);
  const lat = Number(b?.lat); const lng = Number(b?.lng); const radius = Number(b?.radiusKm);
  const kind = b?.kind === 'closed' ? 'closed' : b?.kind === 'surcharge' ? 'surcharge' : null;
  const services = Array.isArray(b?.services) ? [...new Set(b.services.filter((s) => SERVICES.includes(s)))] : SERVICES;
  const rub = Math.round(Number(b?.surchargeRub) || 0);
  if (!city) return { error: 'city_required' };
  if (name.length < 2) return { error: 'name_required' };
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || !Number.isFinite(lat) || !Number.isFinite(lng)) return { error: 'bad_point' };
  if (!(radius > 0 && radius <= 100)) return { error: 'bad_radius' };
  if (!kind) return { error: 'bad_kind' };
  if (!services.length) return { error: 'bad_services' };
  if (kind === 'surcharge' && !(rub > 0 && rub <= 5000)) return { error: 'bad_surcharge' };
  return { v: { city, name, lat, lng, radius, kind, services, rub: kind === 'surcharge' ? rub : 0, note: clean(b?.note, 200) } };
};

export const saveZone = async (adminId, id, body) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };   // зона меняет цены — как и тарифы
  const p = parse(body); if (p.error) return p;
  const v = p.v; const zid = id || newId('gz');
  if (id) {
    const { rowCount } = await query(`UPDATE go_zones SET city=$2, name=$3, services=$4, kind=$5, lat=$6, lng=$7, radius_km=$8, surcharge_rub=$9, note=$10, updated_at=now() WHERE id=$1`,
      [id, v.city, v.name, v.services, v.kind, v.lat, v.lng, v.radius, v.rub, v.note]);
    if (!rowCount) return { error: 'not_found' };
  } else {
    await query(`INSERT INTO go_zones (id, city, name, services, kind, lat, lng, radius_km, surcharge_rub, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [zid, v.city, v.name, v.services, v.kind, v.lat, v.lng, v.radius, v.rub, v.note, adminId]);
  }
  forgetZones();
  await logAdmin({ actorId: adminId, type: 'go_zone', targetType: 'system', targetId: zid, detail: `${id ? 'изменена' : 'создана'} зона «${v.name}» (${v.city}, ${v.kind}${v.kind === 'surcharge' ? ` +${v.rub} ₽` : ''}, ${v.radius} км)`.slice(0, 220) });
  await goLog(adminId, id ? 'zone_update' : 'zone_create', zid, {});
  return { ok: true, id: zid };
};

export const setZoneActive = async (adminId, id, active) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  const { rowCount } = await query(`UPDATE go_zones SET active = $2, updated_at = now() WHERE id = $1`, [id, Boolean(active)]);
  if (!rowCount) return { error: 'not_found' };
  forgetZones();
  await logAdmin({ actorId: adminId, type: 'go_zone', targetType: 'system', targetId: id, detail: active ? 'зона включена' : 'зона выключена' });
  return { ok: true };
};

export const deleteZone = async (adminId, id) => {
  if (!(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  const { rowCount } = await query(`DELETE FROM go_zones WHERE id = $1`, [id]);
  if (!rowCount) return { error: 'not_found' };
  forgetZones();
  await logAdmin({ actorId: adminId, type: 'go_zone', targetType: 'system', targetId: id, detail: 'зона удалена' });
  return { ok: true };
};
