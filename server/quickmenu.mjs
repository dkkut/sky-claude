/**
 * Quick Menu — настраиваемый набор разделов Sky для быстрого доступа
 * (сегодня это панель вкладок PC Quick Actions, см.
 * routes/quickmenu.mjs + QuickActionsShell.tsx). Список разделов и их
 * порядок задаёт зарегистрированный реестр ниже — единственный
 * источник правды о том, что вообще существует; настройка профиля —
 * это только порядок/включённость/закреп поверх него, никогда не
 * произвольные ключи от клиента.
 */
import { query } from './db.mjs';

export const ITEM_REGISTRY = [
  { key: 'player',    label: 'Музыка' },
  { key: 'messenger', label: 'Сообщения' },
  { key: 'watch',     label: 'Кино' },
  { key: 'ai',        label: 'Sky AI' },
  { key: 'podcasts',  label: 'Подкасты' },
  { key: 'pets',      label: 'Питомцы' },
  { key: 'gifts',     label: 'Подарки' },
  { key: 'skyvideo',  label: 'SkyVideo' },
  { key: 'library',   label: 'Библиотека' },
];
const VALID_KEYS = new Set(ITEM_REGISTRY.map(i => i.key));
// Сегодняшний захардкоженный набор вкладок QuickActionsShell — то, что
// включено по умолчанию, пока пользователь ничего не настраивал сам.
const DEFAULT_ENABLED = new Set(['player', 'messenger', 'watch', 'ai']);

const defaultItems = () => ITEM_REGISTRY.map(it => ({
  key: it.key, enabled: DEFAULT_ENABLED.has(it.key), pinned: false,
}));

const withLabels = (items) => items.map(it => ({
  ...it, label: ITEM_REGISTRY.find(r => r.key === it.key)?.label ?? it.key,
}));

/** Достаём настройку профиля, подмешивая новые пункты реестра, которых
 *  ещё не было, когда пользователь в последний раз сохранял список —
 *  иначе появление нового раздела Sky никогда не попадёт в список тем,
 *  кто уже успел его сохранить один раз. */
export const getConfig = async (profileId) => {
  const { rows } = await query('SELECT items FROM quick_menu_settings WHERE profile_id = $1', [profileId]);
  if (!rows.length) return withLabels(defaultItems());

  const saved = Array.isArray(rows[0].items) ? rows[0].items : [];
  const seen = new Set();
  const merged = [];
  for (const it of saved) {
    if (!it || typeof it.key !== 'string' || !VALID_KEYS.has(it.key) || seen.has(it.key)) continue;
    seen.add(it.key);
    merged.push({ key: it.key, enabled: !!it.enabled, pinned: !!it.pinned });
  }
  for (const it of ITEM_REGISTRY) {
    if (!seen.has(it.key)) merged.push({ key: it.key, enabled: false, pinned: false });
  }
  return withLabels(merged);
};

/** Полная замена списка — контракт нарочно строгий: ровно по одному
 *  разу каждый ключ реестра, ни больше ни меньше. Так порядок в теле
 *  запроса однозначно становится новым порядком, без догадок о том,
 *  что делать с пропущенным или незнакомым ключом. */
export const setConfig = async (profileId, rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length !== ITEM_REGISTRY.length) return { error: 'invalid' };
  const seen = new Set();
  const items = [];
  for (const it of rawItems) {
    if (!it || typeof it.key !== 'string' || !VALID_KEYS.has(it.key) || seen.has(it.key)) return { error: 'invalid' };
    seen.add(it.key);
    items.push({ key: it.key, enabled: !!it.enabled, pinned: !!it.pinned });
  }
  if (seen.size !== ITEM_REGISTRY.length) return { error: 'invalid' };

  await query(
    `INSERT INTO quick_menu_settings (profile_id, items, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (profile_id) DO UPDATE SET items = $2::jsonb, updated_at = now()`,
    [profileId, JSON.stringify(items)],
  );
  return { items: withLabels(items) };
};

export const resetConfig = async (profileId) => {
  await query('DELETE FROM quick_menu_settings WHERE profile_id = $1', [profileId]);
  return { items: withLabels(defaultItems()) };
};

/** Включить/выключить один пункт, не трогая остальной порядок —
 *  ровно то, что нужно голосовой команде вида «добавь питомцев в
 *  быстрое меню»: читаем текущий список этого же профиля и меняем в
 *  нём один флаг, тем же путём setConfig прошёл бы обычный клик. */
export const setItemEnabled = async (profileId, key, enabled) => {
  if (!VALID_KEYS.has(key)) return { error: 'unknown_item' };
  const current = await getConfig(profileId);
  const items = current.map(({ key: k, enabled: e, pinned }) => ({
    key: k, enabled: k === key ? !!enabled : e, pinned,
  }));
  return setConfig(profileId, items);
};
