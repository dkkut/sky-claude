/** Ответы фильтров контента (server/contentfilter.mjs): отказ `content_blocked` и пометка `held` (на модерации). */
import { flash } from './flash';

export const BLOCKED_TEXT = 'Не опубликовано: в тексте есть запрещённое — мат, контент 18+, наркотики, запрещённые товары, призывы к насилию или мошенничество. Измените текст и попробуйте снова.';
export const HELD_TEXT = 'Отправлено на проверку модератору. Пока она идёт, публикацию никто не видит, о решении придёт уведомление.';

/** Удержание на проверку: true, если человеку об этом сказано. Отказ `content_blocked` показывает сам apiCall (общий перехват). */
export const reportFilter = (_error?: string, held?: boolean): boolean => {
  if (held) { flash(HELD_TEXT); return true; }
  return false;
};
