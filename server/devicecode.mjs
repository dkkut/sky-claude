/**
 * Код аутентификатора для «выбить» чужие устройства: завершить сессию, завершить все, убрать доверенное устройство, очистка недавних входов.
 * Без него украденная сессия могла бы выкинуть владельца из аккаунта. Если у человека аутентификатор не включён — код неоткуда взять,
 * действие разрешено как раньше (интерфейс предлагает его включить). Попытку «без кода» не считаем неверной: подбор ограничивает verifySkyTwoFactor.
 */
import { query } from './db.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';

/** null — можно; иначе { status, body } для ответа. */
export const needDeviceCode = async (skyId, code) => {
  const { rows } = await query('SELECT two_factor_enabled FROM sky_ids WHERE id = $1', [skyId]);
  if (!rows[0]?.two_factor_enabled) return null;
  const c = String(code ?? '').trim();
  if (!c) return { status: 403, body: { error: 'two_factor_required' } };
  const r = await verifySkyTwoFactor(skyId, c);
  if (r?.ok) return null;
  if (r?.error === 'too_many_attempts') return { status: 429, body: { error: 'too_many_attempts' } };
  return { status: 403, body: { error: 'invalid_code' } };
};
