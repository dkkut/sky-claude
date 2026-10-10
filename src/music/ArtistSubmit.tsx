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
import { FileText, ShieldAlert, Trash2, Check, X } from 'lucide-react';
import {
  apiTracks, apiDeleteTrack, apiModerationQueue, apiModerate, type ServerTrack,
} from './musicApi';

const Card = ({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) => (
  <div className="flex h-full flex-col items-center justify-center px-8 text-center"
    style={{ background: 'var(--bg)' }}>
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
  <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
    <Card icon={<FileText size={26} style={{ color: 'var(--t3)' }} />}
      title="Подача на проверку пока не работает">
      <p>
        Отдельного мастера с документами о правах нет: он складывал их в
        память браузера, то есть никуда.
      </p>
      <p className="mt-3">
        Настоящий путь короче: Sky Music → «Загрузить», а потом у своего
        трека — «На проверку». Заявка уйдёт на сервер, и в каталог трек
        попадёт после решения проверяющего.
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
 * Панель проверки музыки.
 *
 * Сверху — заявки: трек попадает в общий каталог только после решения
 * здесь. Ниже — то, что уже опубликовано, чтобы можно было убрать
 * лишнее. Права проверяет сервер, а не эти кнопки: обычному человеку
 * очередь не отдаётся вовсе.
 */
export const AdminMusicPanel = () => {
  const [queue, setQueue] = useState<ServerTrack[] | null>(null);
  const [tracks, setTracks] = useState<ServerTrack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = () => {
    void apiModerationQueue().then(setQueue);
    void apiTracks({ limit: 200 }).then(setTracks);
  };
  useEffect(reload, []);

  const decide = async (t: ServerTrack, approve: boolean) => {
    setBusy(t.id);
    const ok = await apiModerate(t.id, approve, approve ? undefined : reason.trim());
    setBusy(null);
    if (!ok) { window.alert('Сервер не принял решение по этой заявке.'); return; }
    setRejecting(null); setReason('');
    reload();
  };

  const remove = async (t: ServerTrack) => {
    if (!window.confirm(`Убрать «${t.title}» из каталога навсегда?`)) return;
    setBusy(t.id);
    const ok = await apiDeleteTrack(t.id);
    setBusy(null);
    if (ok) setTracks((prev) => (prev ?? []).filter((x) => x.id !== t.id));
    else window.alert('Сервер не разрешил удалить этот трек.');
  };

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-start gap-3 rounded-2xl p-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            В общий каталог трек попадает только после решения здесь.
            Ниже заявок — весь опубликованный каталог: лишнее можно убрать.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="pb-2 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Заявки{queue && queue.length > 0 ? ` · ${queue.length}` : ''}
        </p>
        {queue === null && (
          <p className="pb-3 text-[13px]" style={{ color: 'var(--t3)' }}>Загружаем заявки…</p>
        )}
        {queue?.length === 0 && (
          <p className="pb-3 text-[13px]" style={{ color: 'var(--t3)' }}>Заявок нет</p>
        )}
        {(queue ?? []).map((t) => (
          <div key={t.id} className="mb-2 rounded-2xl p-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{t.title}</p>
            <p className="truncate text-[11.5px]" style={{ color: 'var(--t3)' }}>
              {t.artist}{t.ownerName ? ` · загрузил @${t.ownerName}` : ''}
            </p>
            <audio controls preload="none" src={`/api/music/track/${encodeURIComponent(t.id)}/audio`}
              className="mt-2 w-full" style={{ height: 32 }}/>
            {rejecting === t.id ? (
              <div className="mt-2 flex items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500}
                  placeholder="Причина отказа — её увидит владелец"
                  className="min-w-0 flex-1 rounded-xl px-3 py-2 text-[12.5px] outline-none"
                  style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}/>
                <button type="button" disabled={busy === t.id} onClick={() => void decide(t, false)}
                  className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold disabled:opacity-40"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                  Отклонить
                </button>
                <button type="button" onClick={() => { setRejecting(null); setReason(''); }}
                  className="shrink-0 p-1" style={{ color: 'var(--t3)' }}><X size={14}/></button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy === t.id} onClick={() => void decide(t, true)}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold disabled:opacity-40"
                  style={{ background: '#fff', color: '#0a0a0f' }}>
                  <Check size={13}/>В каталог
                </button>
                <button type="button" onClick={() => { setRejecting(t.id); setReason(''); }}
                  className="rounded-xl px-3 py-2 text-[12px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#c7ccd6', border: '1px solid rgba(255,255,255,0.07)' }}>
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}

        <p className="pb-2 pt-3 text-[10px] font-black uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Опубликовано
        </p>
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
