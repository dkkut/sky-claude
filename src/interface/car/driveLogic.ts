/**
 * Состояние автомобиля для Sky Car: «едет» / «стоит» / «неизвестно». Чистая логика без браузера (проверяется отдельным тестом).
 *
 * Источник один — скорость с геолокации устройства (`coords.speed`, м/с). Правила, в сторону безопасности:
 *  • скорость ≥ 2 м/с (7 км/ч) — «едет», сразу;
 *  • «стоит» — только если свежие замеры (не старше 15 с) держатся ниже 0,6 м/с не меньше 8 секунд подряд;
 *  • нет замеров 20 с, нет разрешения, нет геолокации, скорость null (устройство её не даёт) — «неизвестно»;
 *  • «неизвестно» НЕ закрывает разделы (решение владельца): показывается только баннер «состояние неизвестно» + обычное предупреждение;
 *    закрывает лишь подтверждённое движение.
 * Ограничение: это оценка по GPS телефона/экрана, а не данные автомобиля; интеграции с CAN/CarPlay/Android Auto нет.
 */
export type DriveState = 'driving' | 'parked' | 'unknown';

export const DRIVING_MPS = 2.0;
export const STILL_MPS = 0.6;
export const STILL_HOLD_MS = 8_000;
export const FIX_MAX_AGE_MS = 15_000;
export const SIGNAL_LOST_MS = 20_000;

export interface DriveMemory { state: DriveState; stillSince: number | null; lastFixAt: number | null }
export const initialDrive = (): DriveMemory => ({ state: 'unknown', stillSince: null, lastFixAt: null });

/** Учесть замер скорости (м/с или null, если устройство её не отдаёт) в момент `at`. */
export const onFix = (m: DriveMemory, speed: number | null, at: number): DriveMemory => {
  if (speed === null || !Number.isFinite(speed) || speed < 0) return { state: 'unknown', stillSince: null, lastFixAt: m.lastFixAt };
  if (speed >= DRIVING_MPS) return { state: 'driving', stillSince: null, lastFixAt: at };
  if (speed < STILL_MPS) {
    const since = m.stillSince ?? at;
    return { state: at - since >= STILL_HOLD_MS ? 'parked' : (m.state === 'parked' ? 'parked' : m.state === 'driving' ? 'driving' : 'unknown'), stillSince: since, lastFixAt: at };
  }
  // 0,6–2 м/с: медленно (парковка, пробка) — «стоящим» не считаем, но и «едущим» сразу не объявляем, если уже стояли.
  return { state: m.state === 'parked' ? 'parked' : 'driving', stillSince: null, lastFixAt: at };
};

/** Периодическая проверка: сигнал пропал → «неизвестно». */
export const onTick = (m: DriveMemory, now: number): DriveMemory => {
  if (m.lastFixAt === null || now - m.lastFixAt > SIGNAL_LOST_MS) return m.state === 'unknown' ? m : { state: 'unknown', stillSince: null, lastFixAt: m.lastFixAt };
  if (m.state === 'parked' && now - m.lastFixAt > FIX_MAX_AGE_MS) return { ...m, state: 'unknown', stillSince: null };
  return m;
};

/** Можно ли показывать видео и текст. Закрывает только подтверждённое движение; при «неизвестно» — баннер. */
export const mayShowVideo = (s: DriveState) => s !== 'driving';

export const WARNING_TEXT = 'Не отвлекайтесь от дороги. Смотрите видео и читайте только тогда, когда автомобиль стоит и это безопасно. Аудио включайте на своё усмотрение — следите за дорогой.';
