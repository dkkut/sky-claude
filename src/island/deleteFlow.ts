/**
 * Удаление через Sky Island: карточка подтверждения (Удалить / Отмена),
 * затем 10 секунд с кнопкой «Отменить», затем действие. Материалы при этом
 * уходят в архив на 20 дней (сервер), а не стираются.
 * Без острова (ТВ, Car, режим «сбоку») — обычное подтверждение браузера.
 */
import { useIslandStore } from './islandStore';
import { useSettings } from '../settings/store';
import { tr, trf } from '../i18n';

export const DELETE_COUNTDOWN_SEC = 10;
const countdownSec = () => { const v = Number(useSettings.getState().settings.deleteCountdown); return v === 3 || v === 5 ? v : DELETE_COUNTDOWN_SEC; };
const KEY = (id: string) => `delete:${id}`;

export interface DeleteRequest {
  /** Уникальный ключ объекта (id материала). */
  id: string;
  /** Название материала — пользовательский текст. */
  title: string;
  /** Что это: «трек», «фильм»… — для заголовка. */
  noun: string;
  /** Материал уходит в архив (иначе — удаляется насовсем). */
  archive?: boolean;
  /** Само удаление; бросает ошибку при отказе сервера. */
  run: () => Promise<unknown>;
  /** После успешного удаления (обновить список). */
  done?: () => void;
  /** Подтверждение уже получено в самом экране — сразу отсчёт (без второй карточки). */
  confirmed?: boolean;
}

const active = new Set<string>();

export const requestDelete = (req: DeleteRequest): void => {
  if (active.has(req.id)) return;
  const isl = useIslandStore.getState();
  const islandOn = useSettings.getState().settings.islandMode !== 'side';
  const tail = tr(req.archive ? 'Материал будет в архиве 20 дней — его можно вернуть.' : 'Это нельзя отменить.');

  const execute = async () => {
    try {
      await req.run();
      req.done?.();
      if (islandOn && isl.mounted) {
        useIslandStore.getState().push({
          kind: 'system', title: req.archive ? 'Перенесено в архив' : 'Удалено', body: req.title, userText: true,
          ttl: 4000, mergeKey: KEY(req.id),
        });
      }
    } catch (e) {
      useIslandStore.getState().push({
        kind: 'system', title: 'Не удалось удалить', body: String((e as Error)?.message || 'Ошибка сервера'),
        ttl: 6000, mergeKey: KEY(req.id),
      });
    } finally { active.delete(req.id); }
  };

  if (!islandOn || !isl.mounted) {
    if (req.confirmed) { active.add(req.id); void execute(); return; }
    if (typeof window !== 'undefined' && window.confirm(trf('Удалить «{0}»? {1}', req.title, tail))) { active.add(req.id); void execute(); }
    return;
  }

  active.add(req.id);
  const cancelled = () => {
    active.delete(req.id);
    useIslandStore.getState().push({ kind: 'system', title: 'Удаление отменено', body: req.title, userText: true, ttl: 2500, mergeKey: KEY(req.id) });
  };

  const countdown = () => {
    let left = countdownSec();
    let timer: ReturnType<typeof setInterval> | null = null;
    const show = () => useIslandStore.getState().push({
      kind: 'system', title: trf('Удаление через {0} с', left), body: req.title, userText: true, ttl: 0, modal: true,
      mergeKey: KEY(req.id),
      actions: [{ label: 'Отменить', primary: true, run: () => { if (timer) clearInterval(timer); cancelled(); } }],
    });
    show();
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (timer) clearInterval(timer);
        useIslandStore.getState().resolve(KEY(req.id));
        void execute();
        return;
      }
      show();
    }, 1000);
  };

  if (req.confirmed) { countdown(); return; }

  useIslandStore.getState().push({
    kind: 'system', title: trf('Удалить {0}?', tr(req.noun)), body: `${req.title}. ${tail}`, userText: false, ttl: 0, modal: true,
    mergeKey: KEY(req.id),
    actions: [
      { label: 'Отмена', run: () => { active.delete(req.id); useIslandStore.getState().resolve(KEY(req.id)); } },
      { label: 'Удалить', primary: true, run: countdown },
    ],
  });
};
