/**
 * Состояние Sky AI, общее на всё приложение.
 *
 * Нужно вот зачем. Кнопки Sky AI стоят под каждым длинным сообщением
 * в переписке; если бы каждая спрашивала сервер сама, открытый чат на
 * тридцать сообщений начинался бы с тридцати одинаковых запросов.
 * Поэтому спрашиваем один раз и раздаём всем.
 *
 * Что здесь хранится — это ОТВЕТ СЕРВЕРА, а не мнение браузера.
 * Поправить `prime` в этом объекте через инструменты разработчика
 * можно, и кнопки даже станут активными. Дальше ничего не произойдёт:
 * каждая Prime-ручка спрашивает базу заново, и на запрос от человека
 * без подписки отвечает отказом. Здесь решается только то, что
 * показать, — но не то, что можно.
 */
import { useEffect, useState } from 'react';
import { apiAiState, type AiState } from './aiApi';

let cached: AiState | null = null;
let loading: Promise<AiState | null> | null = null;
const listeners = new Set<() => void>();

const notify = () => { for (const f of listeners) f(); };

/** Спросить сервер заново — после покупки Prime или после расхода. */
export const refreshAiState = async (): Promise<AiState | null> => {
  loading ??= apiAiState().finally(() => { loading = null; });
  cached = await loading;
  notify();
  return cached;
};

/** То, что уже известно, без запроса. */
export const peekAiState = () => cached;

/**
 * Признак подписки для показа.
 *
 * Отдельным именем, чтобы в коде было видно: это «показывать ли
 * кнопку», а не «можно ли выполнить». Второе решает сервер.
 */
export const useAiState = () => {
  const [, force] = useState(0);

  useEffect(() => {
    const tick = () => force((n) => n + 1);
    listeners.add(tick);
    if (!cached && !loading) void refreshAiState();
    return () => { listeners.delete(tick); };
  }, []);

  return cached;
};

/** Сбросить при смене профиля: у другого профиля другая подписка. */
export const clearAiState = () => { cached = null; notify(); };
