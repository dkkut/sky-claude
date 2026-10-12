/* Вход на устройстве без клавиатуры (ТВ, консоль, машина): QR и код подключения.
   Человек подтверждает вход на телефоне, где уже выполнен вход в Sky ID (см. DeviceLinkPhone.tsx,
   server/devicelink.mjs). Здесь только показ и опрос; сессию выдаёт сервер, один раз. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { qrSvg } from '@/shared/qr';
import { useAuthStore } from '@/core/auth/store';
import { apiLinkStart, apiLinkPoll, apiLinkCancel, type LinkKind, type LinkStart } from '@/core/auth/api';

export type LinkAction = (label: string, onClick: () => void, id: string) => React.ReactNode;

const defaultAction: LinkAction = (label, onClick, id) => (
  <button key={id} type="button" onClick={onClick}
    className="rounded-2xl px-5 py-2.5 text-sm font-semibold"
    style={{ background: 'var(--bg-l3)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
    {label}
  </button>
);

const END_TEXT: Record<string, string> = {
  denied: 'Вход отклонён на телефоне',
  exhausted: 'Слишком много неверных чисел — запрос закрыт',
  expired: 'Код устарел',
  cancelled: 'Запрос отменён',
  consumed: 'Этот код уже использован',
};

export const DeviceLinkLogin = ({ kind, big = false, action = defaultAction, extra }: {
  kind: LinkKind; big?: boolean; action?: LinkAction; extra?: React.ReactNode;
}) => {
  const login = useAuthStore((s) => s.loginWithLinkedSession);
  const [link, setLink] = useState<LinkStart | null>(null);
  const [err, setErr] = useState<string>();
  const [ended, setEnded] = useState<string>();
  const [scanned, setScanned] = useState(false);
  const [left, setLeft] = useState(0);
  const cur = useRef<LinkStart | null>(null);
  const alive = useRef(true);

  const start = useCallback(async () => {
    setErr(undefined); setEnded(undefined); setScanned(false);
    const prev = cur.current;
    if (prev) void apiLinkCancel(prev.id, prev.pollKey);
    const res = await apiLinkStart(kind, undefined, document.documentElement.lang || undefined);
    if (!alive.current) return;
    if (!res.ok || !res.data) { cur.current = null; setLink(null); setErr(res.reason ?? 'Не удалось получить код'); return; }
    cur.current = res.data; setLink(res.data); setLeft(res.data.expiresIn);
  }, [kind]);

  useEffect(() => {
    alive.current = true;
    void start();
    return () => {
      alive.current = false;
      const c = cur.current; if (c) void apiLinkCancel(c.id, c.pollKey);
    };
  }, [start]);

  // Опрос раз в 2 с; сессию сервер отдаёт ровно один раз.
  useEffect(() => {
    if (!link || ended) return undefined;
    let stop = false; let busy = false;
    const tick = async () => {
      if (stop || busy) return; busy = true;
      const res = await apiLinkPoll(link.id, link.pollKey);
      busy = false;
      if (stop || !res.ok || !res.data) return;
      const d = res.data;
      if (d.status === 'approved') { stop = true; login(d.session); return; }
      if (d.status === 'pending') { if (d.scanned) setScanned(true); return; }
      stop = true; setEnded(d.status);
    };
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [link, ended, login]);

  useEffect(() => {
    if (!link || ended) return undefined;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [link, ended]);
  useEffect(() => { if (link && left === 0 && !ended) setEnded('expired'); }, [left, link, ended]);

  const svg = useMemo(() => (link ? qrSvg(link.url, { size: big ? 280 : 200, quietZone: 2 }) : ''), [link, big]);
  const mm = String(Math.floor(left / 60)); const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="flex flex-col items-center gap-4" style={{ maxWidth: big ? 760 : 380 }}>
      {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
      {!link && !err && <p className="text-sm" style={{ color: 'var(--t2)' }}>Готовим код…</p>}
      {link && (
        <div className={big ? 'flex items-center gap-10' : 'flex flex-col items-center gap-4'} style={{ opacity: ended ? 0.35 : 1 }}>
          <div className="rounded-2xl bg-white p-3" aria-label="QR-код для входа" role="img"
            dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Код подключения</p>
            <p translate="no" className={`${big ? 'text-5xl' : 'text-3xl'} font-extrabold tabular-nums`}
              style={{ color: 'var(--t1)', letterSpacing: '0.12em' }}>{link.code}</p>
            <p className="text-xs uppercase tracking-wider mt-2" style={{ color: 'var(--t3)' }}>Число для проверки</p>
            <p translate="no" className={`${big ? 'text-6xl' : 'text-4xl'} font-extrabold tabular-nums`}
              style={{ color: 'var(--accent)' }}>{link.verify}</p>
            {!ended && <p className="text-xs" style={{ color: 'var(--t3)' }}>Действует {mm}:{ss}</p>}
          </div>
        </div>
      )}
      <p className="text-center text-sm leading-snug" style={{ color: 'var(--t2)' }}>
        {scanned && !ended
          ? 'Код отсканирован. Подтвердите вход на телефоне.'
          : 'На телефоне откройте Sky → Профиль → Sky ID → Устройства → «Подключить устройство» и наведите камеру на QR или введите код. Телефон попросит число с этого экрана.'}
      </p>
      {ended && (
        <p className="text-sm font-semibold" style={{ color: 'var(--red)' }}>{END_TEXT[ended] ?? 'Запрос закрыт'}</p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {(ended || err) && action('Получить новый код', () => void start(), 'link-new')}
        {extra}
      </div>
    </div>
  );
};
