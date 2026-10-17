/**
 * Окно игры Sky Blox.
 *
 * Игра открывается в изолированном iframe с sandbox и без доступа к
 * камере, микрофону и геолокации. Страница игры живёт на чужом
 * домене, поэтому она не видит ни токена Sky, ни данных этой вкладки.
 * Разговор идёт через postMessage:
 *   игра → Sky: {source:'sky-blox', type:'hello'}
 *   Sky → игра: {source:'sky-host', type:'session', token, user, gameId, placeId}
 * Сообщения принимаются только от окна игры и её адреса (event.source и
 * event.origin), а токен отправляется только на этот origin.
 * Покупки: игровой сервер создаёт запрос, а здесь игрок видит окно
 * «Покупка» и сам подтверждает оплату — баланс меняет только сервер Sky.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Maximize2, ShieldCheck, X } from 'lucide-react';
import { Alert, C, errText, glass } from './ui';
import { apiCancelIntent, apiConfirm, apiLaunch, apiPending, type Game, type Launch, type Place, type Purchase } from './bloxApi';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';
import { apiGamePing } from '@/extras/mediaActivityApi';

export const PlayerScreen = ({ place, game, onClose }: { place: Place; game: Game; onClose: () => void }) => {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const [pending, setPending] = useState<Purchase[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const userId = useAuthStore((s) => s.currentUserId);
  const refresh = useMoney((s) => s.refresh);

  const start = useCallback(async () => {
    setLoading(true); setError('');
    const r = await apiLaunch(place.id);
    setLoading(false);
    if (!r.ok) { setError(errText(r)); return; }
    setLaunch(r.data);
  }, [place.id]);
  useEffect(() => { void start(); }, [start]);

  /* Учёт времени в игре: пульс, пока игра открыта. В фоне (свёрнутое окно, другое приложение) таймер идёт реже,
     но сервер склеивает пульсы с разрывом до 150 с в одну сессию. */
  useEffect(() => {
    if (!launch) return;
    void apiGamePing('blox', place.id);
    const t = setInterval(() => void apiGamePing('blox', place.id), 30_000);
    return () => clearInterval(t);
  }, [launch, place.id]);

  /* Рукопожатие: токен уходит игре только по её запросу и только на её origin. */
  useEffect(() => {
    if (!launch) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== launch.origin) return;
      const d = e.data;
      if (!d || d.source !== 'sky-blox') return;
      if (d.type === 'hello') {
        frame.current?.contentWindow?.postMessage({
          source: 'sky-host', type: 'session', token: launch.token, user: launch.user, gameId: launch.gameId, placeId: launch.placeId,
        }, launch.origin);
      }
      if (d.type === 'fullscreen') void frame.current?.requestFullscreen?.().catch(() => {});
      if (d.type === 'close') onClose();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [launch, onClose]);

  /* Запросы на покупку, которые создал сервер игры или магазин на странице игры. */
  const poll = useCallback(async () => {
    const r = await apiPending();
    if (r.ok) setPending(r.data.items.filter((p) => p.gameId === game.id));
  }, [game.id]);
  useEffect(() => {
    void poll();
    const t = setInterval(() => { if (!document.hidden) void poll(); }, 3000);
    const h = () => void poll();
    window.addEventListener('blox:purchase-created', h);
    return () => { clearInterval(t); window.removeEventListener('blox:purchase-created', h); };
  }, [poll]);

  const current = pending[0];
  const confirm = async (p: Purchase) => {
    setBusy(true); setMsg('');
    const r = await apiConfirm(p.id, p.price);
    setBusy(false);
    if (!r.ok) { setMsg(errText(r)); void poll(); return; }
    setMsg(`Готово: списано ${r.data.price.toLocaleString('ru-RU')} баллов.`);
    if (userId) void refresh();
    void poll();
  };
  const cancel = async (p: Purchase) => { await apiCancelIntent(p.id); void poll(); };

  return (
    <div className="relative flex h-full flex-col" style={{ background: '#000' }}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onClose} aria-label="Закрыть игру" className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t2 }}><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold" style={{ color: C.t1 }} translate="no">{game.title} · {place.title}</p>
          <p className="flex items-center gap-1 truncate text-[10px]" style={{ color: C.t3 }}><ShieldCheck size={10} /> Игра работает в изолированном окне на стороне разработчика</p>
        </div>
        <button type="button" aria-label="На весь экран" onClick={() => void frame.current?.requestFullscreen?.().catch(() => {})} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t2 }}><Maximize2 size={15} /></button>
        <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: C.t2 }}><X size={16} /></button>
      </div>

      <div className="relative min-h-0 flex-1">
        {loading && <div className="absolute inset-0 grid place-items-center"><Loader2 className="animate-spin" style={{ color: C.t3 }} /></div>}
        {error && <div className="absolute inset-0 grid place-items-center p-6"><div className="max-w-sm space-y-3"><Alert text={error} /><button type="button" onClick={() => void start()} className="rounded-xl px-4 py-2 text-[12px] font-bold text-white" style={{ background: C.acc }}>Повторить</button></div></div>}
        {launch && (
          <iframe ref={frame} title={game.title} src={launch.url} className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"
            allow="fullscreen; gamepad; autoplay" referrerPolicy="no-referrer" />
        )}
      </div>

      {current && (
        <div className="absolute inset-0 z-20 grid place-items-center p-4" style={{ background: 'rgba(0,0,0,.6)' }}>
          <div className="w-full max-w-sm space-y-3 rounded-3xl p-5" style={{ ...glass, background: 'var(--bg-l1)' }} role="dialog" aria-label="Покупка">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.t3 }}>Покупка в игре</p>
            <p className="text-lg font-black" style={{ color: C.t1 }} translate="no">{current.title}</p>
            <p className="text-[12px]" style={{ color: C.t2 }}><span translate="no">{current.gameTitle}</span> · цена определена сервером Sky</p>
            <p className="text-2xl font-black" style={{ color: C.amber }}>{current.price.toLocaleString('ru-RU')} Prime Points</p>
            {msg && <Alert kind="info" text={msg} />}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void cancel(current)} className="flex-1 rounded-xl py-2.5 text-[13px] font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
              <button type="button" disabled={busy} onClick={() => void confirm(current)} className="flex-1 rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>{busy ? 'Оплата…' : 'Подтвердить'}</button>
            </div>
            <p className="text-[10px]" style={{ color: C.t3 }}>Баллы спишутся один раз. Если игра не выдаст предмет, баллы вернутся.</p>
          </div>
        </div>
      )}
      {!current && msg && <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2"><Alert kind="info" text={msg} /></div>}
    </div>
  );
};
