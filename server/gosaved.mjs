/**
 * Sky GO — сохранённые места пассажира. Видит и меняет только владелец (profile_id из токена). Адрес превращается в координаты на сервере
 * (resolvePoint: переданные координаты или геокодер); выдуманных координат нет — не нашлось, значит ошибка. «Дом» и «Работа» — по одному (повтор заменяет).
 */
import { query } from './db.mjs';
import { clean, newId, resolvePoint } from './gocore.mjs';

const MAX_PLACES = 20;
const KINDS = ['home', 'work', 'other'];
const view = (r) => ({ id: r.id, kind: r.kind, label: r.label, address: r.address, lat: r.lat, lng: r.lng });

export const list = async (profileId) => {
  const { rows } = await query(`SELECT * FROM go_saved_places WHERE profile_id = $1 ORDER BY (kind = 'home') DESC, (kind = 'work') DESC, created_at`, [profileId]);
  return { places: rows.map(view), max: MAX_PLACES };
};

export const save = async (profileId, input) => {
  const kind = String(input?.kind ?? '');
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  const label = clean(input?.label, 40) || ({ home: 'Дом', work: 'Работа' }[kind] ?? '');
  if (label.length < 1) return { error: 'label_required' };
  const p = await resolvePoint({ address: input?.address, lat: input?.lat, lng: input?.lng });
  if (p.error) return { error: p.error };
  if (kind === 'other') {
    const { rows } = await query(`SELECT count(*)::int AS n FROM go_saved_places WHERE profile_id = $1`, [profileId]);
    if (rows[0].n >= MAX_PLACES) return { error: 'too_many_places' };
  }
  const id = newId('gsp');
  const { rows } = await query(
    kind === 'other'
      ? `INSERT INTO go_saved_places (id, profile_id, kind, label, address, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`
      : `INSERT INTO go_saved_places (id, profile_id, kind, label, address, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (profile_id, kind) WHERE kind IN ('home','work') DO UPDATE SET label = $4, address = $5, lat = $6, lng = $7, updated_at = now() RETURNING *`,
    [id, profileId, kind, label, p.point.address, p.point.lat, p.point.lng]);
  return { ok: true, place: view(rows[0]) };
};

export const remove = async (profileId, id) => {
  const { rowCount } = await query('DELETE FROM go_saved_places WHERE id = $1 AND profile_id = $2', [String(id ?? ''), profileId]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};
