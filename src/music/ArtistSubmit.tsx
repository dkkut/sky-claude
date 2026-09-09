/* ===============================================================
   ARTIST SUBMIT + ADMIN MUSIC PANEL

   Здесь была подача песни «на модерацию» с приложением документов о
   правах — и панель модератора к ней. Всё это работало внутри одного
   браузера: файл, документы и заявка складывались в IndexedDB
   устройства, а очередь модерации читалась оттуда же. То есть артист
   отправлял заявку в собственный браузер, а модератор на своём
   устройстве всегда видел пустую очередь.

   Хуже того, экран собирал бумаги о правах — человек считал, что подал
   документы, хотя они никуда не уходили.

   Настоящая проверка прав — это серверная очередь заявок, хранение
   документов, права модератора и решения с историей. Пока её нет, оба
   экрана честно говорят, как обстоят дела.
=============================================================== */
import { useEffect, useState } from 'react';
import { FileText, ShieldAlert, Trash2 } from 'lucide-react';
import { apiTracks, apiDeleteTrack, type ServerTrack } from './musicApi';

const Card = ({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) => (
  <div className="flex h-full flex-col items-center justify-center px-8 text-center"
    style={{ background: '#0a0a0f' }}>
    <div className="grid h-16 w-16 place-items-center rounded-3xl"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
      {icon}
    </div>
    <p className="mt-5 text-[16px] font-bold" style={{ color: 'var(--t1)' }}>{title}</p>
    <div className="mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--t3)' }}>
      {children}
    </div>
  </div>
);

/** Подача трека артистом. */
export const ArtistSubmitTrack = ({ onDone }: { onDone: () => void }) => (
  <div className="flex h-full flex-col" style={{ background: '#0a0a0f' }}>
    <Card icon={<FileText size={26} style={{ color: 'var(--t3)' }} />}
      title="Подача на проверку пока не работает">
      <p>
        Заявку некуда отправить: очереди проверки на сервере ещё нет, а
        собирать документы о правах в память браузера — значит делать вид,
        что они поданы.
      </p>
      <p className="mt-3">
        Свои записи уже можно выложить: Sky Music → «Загрузить». Файл ляжет
        на сервер, и вы сами решаете, публиковать его или оставить закрытым.
      </p>
      <button type="button" onClick={onDone}
        className="mt-6 rounded-2xl px-5 py-2.5 text-[13px] font-bold"
        style={{ background: '#fff', color: '#0a0a0f' }}>
        Назад
      </button>
    </Card>
  </div>
);

/**
 * Панель модератора музыки.
 *
 * Очереди «на проверку» нет — и панель об этом прямо говорит, а не
 * показывает пустой список, который читается как «всё проверено».
 * Зато показывает то, что действительно опубликовано, и позволяет
 * убрать лишнее: право на удаление проверяет сервер (владелец или
 * администратор), а не эта кнопка.
 */
export const AdminMusicPanel = () => {
  const [tracks, setTracks] = useState<ServerTrack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = () => { void apiTracks({ limit: 200 }).then(setTracks); };
  useEffect(reload, []);

  const remove = async (t: ServerTrack) => {
    if (!window.confirm(`Убрать «${t.title}» из каталога навсегда?`)) return;
    setBusy(t.id);
    const ok = await apiDeleteTrack(t.id);
    setBusy(null);
    if (ok) setTracks((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    else window.alert('Сервер не разрешил удалить этот трек.');
  };

  return (
    <div className="flex h-full flex-col" style={{ background: '#0a0a0f' }}>
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-start gap-3 rounded-2xl p-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            Проверки до публикации нет: каждый выкладывает свои записи сам.
            Ниже — весь опубликованный каталог; лишнее можно убрать.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tracks === null && (
          <p className="py-10 text-center text-[13px]" style={{ color: 'var(--t3)' }}>Загружаем каталог…</p>
        )}
        {tracks?.length === 0 && (
          <p className="py-10 text-center text-[13px]" style={{ color: 'var(--t3)' }}>В каталоге пока пусто</p>
        )}
        {(tracks ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium" style={{ color: 'var(--t1)' }}>{t.title}</p>
              <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>
                {t.artist} · {t.plays} прослушиваний
              </p>
            </div>
            <button type="button" aria-label="Убрать из каталога"
              disabled={busy === t.id} onClick={() => void remove(t)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.16)', color: '#ef4444' }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
