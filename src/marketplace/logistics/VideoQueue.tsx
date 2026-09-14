/**
 * Очередь видеообзоров — экран администрации.
 *
 * Общий склад нельзя открыть по анкете: зонирование, нумерацию мест и
 * запираемые ячейки с ключами проверяют глазами. Здесь человек смотрит
 * запись и решает.
 *
 * Экран ничего не решает сам. Кнопки он рисует всем, но очередь сервер
 * отдаёт только сотруднику, и решение принимает тоже он — нажатие
 * постороннего вернётся отказом.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, X, ShieldOff } from 'lucide-react';
import { C, fmtTs } from '@/marketplace/SkyMarket';
import { EmptyState } from './shared';
import { apiVideoQueue, apiDecideVideo, videoUrl, type VideoReview } from './sharedApi';

const inputStyle = { background: 'var(--bg-l2)', border: '1px solid var(--brd)', color: 'var(--t1)' };

const CHECKLIST = [
  'Помещение разделено на зоны: приём, хранение, выдача, возвраты (п. 2.1)',
  'Места хранения пронумерованы и обозначены (п. 2.2)',
  'Есть запираемые ячейки с индивидуальными ключами (п. 3.1)',
  'Ключи хранятся в отдельном месте, а не в замках (п. 3.3)',
  'Проходы и выходы свободны (п. 2.4)',
];

export const VideoQueue = () => {
  const [queue, setQueue] = useState<VideoReview[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    const r = await apiVideoQueue();
    if (!r.ok) { setDenied(true); setQueue([]); return; }
    setQueue(r.data?.reviews ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (review: VideoReview, approve: boolean) => {
    const why = (reason[review.id] ?? '').trim();
    if (!approve && !why) {
      setFailed('Причина отказа обязательна: без неё владелец снимет то же самое второй раз.');
      return;
    }
    setBusy(review.id); setFailed('');
    const r = await apiDecideVideo(review.id, approve, why);
    setBusy('');
    if (!r.ok) {
      setFailed(r.error === 'already_decided'
        ? 'По этому обзору уже решили — возможно, другой сотрудник.'
        : 'Решение не записалось.');
    }
    await load();
  };

  if (queue === null) {
    return <div className="grid place-items-center py-10"><Loader2 size={18} className="animate-spin" style={{ color: C.t3 }} /></div>;
  }

  if (denied) {
    return <EmptyState icon={ShieldOff} title="Очередь не открыта"
      sub="Видеообзоры складов разбирает администрация." />;
  }

  if (queue.length === 0) {
    return <EmptyState icon={Check} title="Очередь пуста" sub="Новых видеообзоров на проверке нет." />;
  }

  return (
    <div className="space-y-3 p-4">
      {failed && <p className="text-[11px]" style={{ color: C.red }}>{failed}</p>}

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-2 text-[10px] font-bold" style={{ color: C.t3 }}>ЧТО ДОЛЖНО БЫТЬ ВИДНО НА ЗАПИСИ</p>
        {CHECKLIST.map((t) => (
          <p key={t} className="text-[11px] leading-relaxed" style={{ color: C.t2 }}>— {t}</p>
        ))}
      </div>

      {queue.map((r) => (
        <div key={r.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>
              {r.subjectTitle || 'Склад без названия'}
            </p>
            <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTs(r.createdAt)}</span>
          </div>
          {r.subjectCity && <p className="text-[10px]" style={{ color: C.t3 }}>{r.subjectCity}</p>}

          <video src={videoUrl(r.id)} controls preload="metadata"
            className="mt-2 w-full rounded-xl" style={{ maxHeight: 260, background: '#000' }} />

          <input value={reason[r.id] ?? ''} onChange={(e) => setReason((w) => ({ ...w, [r.id]: e.target.value }))}
            placeholder="Причина отказа — обязательна при отклонении"
            className="mt-2 w-full rounded-xl px-3 py-2 text-xs outline-none" style={inputStyle} />

          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.green, color: '#fff' }}>
              {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Одобрить
            </button>
            <button type="button" disabled={busy === r.id} onClick={() => void decide(r, false)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: C.l2, color: C.red }}>
              <X size={12} /> Отклонить
            </button>
          </div>

          <p className="mt-1.5 text-[10px]" style={{ color: C.t3 }}>
            Одобрение снимает запрет, но склад не открывает: включает его владелец,
            и только приняв регламент.
          </p>
        </div>
      ))}
    </div>
  );
};
