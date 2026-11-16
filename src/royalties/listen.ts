/**
 * Учёт прослушиваний для Sky Royalties. Клиент только сообщает «началось» и «всё ещё играет»;
 * засчитывает и считает время сервер (секунды от клиента не принимаются).
 */
import { apiCall } from '@/core/auth/api';
import { usePlayerStore } from '@/player/playerStore';

const MIN_SEC = 31;
let seq = 0;
const key = () => `p${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const beginRoyaltyListen = (trackId: string) => {
  const playKey = key();
  void apiCall('/api/royalties/listen/start', { method: 'POST', body: JSON.stringify({ trackId, playKey }) }).then((r) => {
    if (!r.ok) return;
    const finish = (retry: boolean) => {
      const st = usePlayerStore.getState();
      // Засчитываем, только если этот же трек всё ещё играет: пропущенный или оставленный на паузе — нет.
      if (st.item?.id !== trackId || !st.isPlaying) return;
      void apiCall<{ needSec?: number }>('/api/royalties/listen/finish', { method: 'POST', body: JSON.stringify({ playKey }) }).then((f) => {
        if (!f.ok && f.error === 'too_early' && retry) setTimeout(() => finish(false), ((f.data?.needSec ?? 2) + 1) * 1000);
      });
    };
    setTimeout(() => finish(true), MIN_SEC * 1000);
  });
};
