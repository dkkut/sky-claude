/**
 * Позиция прослушивания для оболочек без экрана Sky Music (Sky TV, Sky Car).
 * В обычной Sky то же делает сам экран музыки; здесь — один общий хук:
 * сохраняет, где человек остановился, на сервер (раз в несколько секунд —
 * частоту держит store) и возвращает на это место, когда трек начинает играть.
 * Монтировать ровно один раз в оболочке: рядом с экраном SkyMusic его быть не должно.
 */
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/player/playerStore';
import { useMusicStore } from './serverStore';

export const useMusicSync = () => {
  const id = usePlayerStore((s) => (s.item?.kind === 'music' ? s.item.id : null));
  const playing = usePlayerStore((s) => s.isPlaying);
  const cur = usePlayerStore((s) => s.currentTime);
  const dur = usePlayerStore((s) => s.duration);
  const saveProgress = useMusicStore((s) => s.saveProgress);
  const restored = useRef<string | null>(null);

  useEffect(() => {
    if (!id || dur <= 0 || restored.current === id) return;
    restored.current = id;
    if (usePlayerStore.getState().currentTime > 3) return; // трек уже играет — не перематываем назад
    const at = useMusicStore.getState().progress[id] ?? 0;
    // Самое начало и хвост не восстанавливаем: возвращать некуда / трек уже дослушан.
    if (at > 5 && at < dur - 10) usePlayerStore.getState().requestSeek(at);
  }, [id, dur]);

  useEffect(() => {
    if (id && playing && cur > 0) saveProgress(id, cur);
  }, [id, playing, cur, saveProgress]);
};

/** Собрать очередь и запустить трек в ЕДИНОМ плеере; история — на сервер. */
export const playMusicQueue = (pool: { id: string; title: string; artist?: string; coverUrl?: string; sourceUrl?: string }[], trackId: string) => {
  const i = pool.findIndex((p) => p.id === trackId);
  if (i < 0) return;
  const queue = pool.map((p) => ({
    id: p.id, kind: 'music' as const, title: p.title, author: p.artist ?? '', coverUrl: p.coverUrl,
    hue: parseInt(p.id, 36) % 360, srcUrl: p.sourceUrl,
  }));
  usePlayerStore.getState().push({ ...queue[i], queue, qIdx: i });
  void useMusicStore.getState().notePlay(trackId);
};
