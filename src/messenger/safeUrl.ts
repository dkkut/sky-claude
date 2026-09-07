/**
 * Ссылка на вложение, пригодная для показа.
 *
 * Значение приходит из сообщения, а сообщение — от другого человека,
 * то есть от клиента, который мог быть переписан. Попав в href, строка
 * вида javascript:… выполняется как код, а ссылка на чужой сервер
 * сообщает ему адрес каждого, кто открыл переписку.
 *
 * Сервер уже отбрасывает всё, кроме картинки в самой строке и blob: из
 * вкладки отправителя (см. server/chats.mjs). Здесь та же проверка
 * повторяется на месте показа: одной проверки на пути данных мало —
 * достаточно однажды забыть её при добавлении новой ручки.
 */
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]{16,}={0,2}$/;

export const safeMediaUrl = (raw?: string): string | undefined => {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return undefined;
  if (value.startsWith('blob:')) return value;
  return DATA_IMAGE.test(value) ? value : undefined;
};
