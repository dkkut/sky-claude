/* Телефон: подтверждение входа на ТВ, консоли или в машине. Сканер QR (камера), ввод кода вручную,
   все данные об устройстве и подтверждение числом с его экрана (и кодом аутентификатора, если он включён).
   Серверная часть — server/devicelink.mjs. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tv, Gamepad2, Car, MonitorSmartphone, X, ScanLine, ShieldAlert, Check } from 'lucide-react';
import { apiLinkLookup, apiLinkDecide, apiLinkHistory, type LinkDevice, type LinkKind } from '@/core/auth/api';

const KIND: Record<LinkKind, { label: string; Icon: typeof Tv }> = {
  tv: { label: 'Телевизор', Icon: Tv },
  console: { label: 'Игровая консоль', Icon: Gamepad2 },
  car: { label: 'Автомобиль', Icon: Car },
  other: { label: 'Другое устройство', Icon: MonitorSmartphone },
};

/** Достаёт код из QR (ссылка с ?code=) или из набранного вручную текста. */
export const codeFromText = (text: string): string => {
  const t = text.trim();
  try { const c = new URL(t).searchParams.get('code'); if (c) return c; } catch { /* не ссылка */ }
  return t;
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const Row = ({ k, v }: { k: string; v: string }) => v ? (
  <div className="flex justify-between gap-4 py-1.5 text-sm" style={{ borderBottom: '1px solid var(--border)' }}>
    <span style={{ color: 'var(--t3)' }}>{k}</span>
    <span translate="no" className="text-right break-all" style={{ color: 'var(--t1)' }}>{v}</span>
  </div>
) : null;

const Scanner = ({ onCode }: { onCode: (text: string) => void }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let stop = false; let stream: MediaStream | null = null; let timer = 0;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('Камера недоступна в этом окне — введите код вручную'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch { setErr('Нет доступа к камере — разрешите её или введите код вручную'); return; }
      if (stop || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.current.srcObject = stream; await video.current.play().catch(() => {});
      const { default: jsQR } = await import('jsqr');
      const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        const v = video.current;
        if (stop || !v || !ctx) return;
        if (v.videoWidth) {
          const w = 480; const h = Math.round((v.videoHeight / v.videoWidth) * w);
          canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
          const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
          if (hit?.data) { stop = true; onCode(hit.data); return; }
        }
        timer = window.setTimeout(tick, 200);
      };
      tick();
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="space-y-2">
      {err ? <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p> : (
        <div className="relative overflow-hidden rounded-2xl" style={{ background: '#000', aspectRatio: '1 / 1' }}>
          <video ref={video} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-2xl" style={{ border: '2px solid rgba(255,255,255,0.7)' }} />
        </div>
      )}
    </div>
  );
};

const Confirm = ({ device, needsTotp, onDone }: { device: LinkDevice; needsTotp: boolean; onDone: (m: string) => void }) => {
  const [verify, setVerify] = useState(''); const [totp, setTotp] = useState('');
  const [err, setErr] = useState<string>(); const [busy, setBusy] = useState(false);
  const { label, Icon } = KIND[device.kind] ?? KIND.other;
  const decide = async (approve: boolean) => {
    if (busy) return; setBusy(true); setErr(undefined);
    const r = await apiLinkDecide(device.id, approve, verify, totp || undefined);
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не получилось'); if (r.error === 'exhausted' || r.error === 'not_found') onDone(r.reason ?? 'Запрос закрыт'); return; }
    onDone(approve ? 'Вход разрешён. Устройство подключится через пару секунд.' : 'Вход отклонён.');
  };
  const input = 'w-full rounded-2xl px-4 py-3 text-center text-2xl font-bold tabular-nums outline-none';
  const inStyle = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <Icon size={28} style={{ color: 'var(--accent)' }} />
        <div className="min-w-0">
          <p className="font-bold" style={{ color: 'var(--t1)' }}>{device.model || label}</p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Просит войти в ваш Sky ID</p>
        </div>
      </div>
      <div>
        <Row k="Тип" v={label} />
        <Row k="Название" v={device.label} />
        <Row k="Модель" v={device.model} />
        <Row k="Система" v={device.os} />
        <Row k="Браузер" v={device.browser} />
        <Row k="Приложение Sky" v={device.app ? 'да' : 'нет, браузер'} />
        <Row k="Адрес (IP)" v={device.ip} />
        <Row k="Язык" v={device.lang} />
        <Row k="Запрос создан" v={fmtTime(device.requestedAt)} />
        <Row k="Действует до" v={fmtTime(device.expiresAt)} />
        <Row k="User-Agent" v={device.ua} />
      </div>
      <div className="flex gap-2 rounded-2xl p-3 text-xs" style={{ background: 'var(--red-bg)', color: 'var(--t1)' }}>
        <ShieldAlert size={16} className="shrink-0" style={{ color: 'var(--red)' }} />
        <span>Разрешайте, только если вы сами сейчас видите этот код на своём устройстве. Если QR показал кто-то другой или он пришёл в сообщении — нажмите «Это не я».</span>
      </div>
      <div>
        <p className="mb-1 text-xs" style={{ color: 'var(--t3)' }}>Число, которое сейчас показано на устройстве</p>
        <input inputMode="numeric" maxLength={2} value={verify} onChange={(e) => setVerify(e.target.value.replace(/\D/g, '').slice(0, 2))}
          placeholder="00" className={input} style={inStyle} aria-label="Число с экрана устройства" />
      </div>
      {needsTotp && (
        <div>
          <p className="mb-1 text-xs" style={{ color: 'var(--t3)' }}>Код из приложения-аутентификатора</p>
          <input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000" className={input} style={inStyle} aria-label="Код аутентификатора" />
        </div>
      )}
      {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={busy} onClick={() => void decide(false)} className="rounded-2xl py-3 font-bold"
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}>Это не я</button>
        <button type="button" disabled={busy || verify.length !== 2 || (needsTotp && totp.length !== 6)} onClick={() => void decide(true)}
          className="rounded-2xl py-3 font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Разрешить вход</button>
      </div>
    </div>
  );
};

const History = () => {
  const [items, setItems] = useState<Awaited<ReturnType<typeof apiLinkHistory>>['data']>();
  useEffect(() => { void apiLinkHistory().then((r) => r.ok && setItems(r.data)); }, []);
  if (!items?.items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Недавние подключения</p>
      {items.items.slice(0, 8).map((x) => (
        <div key={x.id} className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <span translate="no" style={{ color: 'var(--t1)' }}>{x.model || KIND[x.kind]?.label}</span> · <span translate="no">{x.ip}</span> · {fmtTime(x.decidedAt ?? x.requestedAt)} ·{' '}
          {x.status === 'denied' ? 'отклонено' : x.status === 'exhausted' ? 'закрыто (неверное число)' : x.signedIn ? 'вошли' : 'разрешено, вход не завершён'}
        </div>
      ))}
    </div>
  );
};

export const DeviceLinkPhone = ({ initialCode, onClose }: { initialCode?: string; onClose: () => void }) => {
  const [code, setCode] = useState(initialCode ?? '');
  const [scan, setScan] = useState(!initialCode);
  const [found, setFound] = useState<{ device: LinkDevice; needsTotp: boolean }>();
  const [err, setErr] = useState<string>(); const [done, setDone] = useState<string>(); const [busy, setBusy] = useState(false);

  const look = useCallback(async (text: string) => {
    const c = codeFromText(text);
    if (!c) return;
    setBusy(true); setErr(undefined); setScan(false);
    const r = await apiLinkLookup(c);
    setBusy(false);
    if (!r.ok || !r.data) { setErr(r.error === 'not_found' ? 'Такой код не найден или уже устарел — обновите его на устройстве' : r.reason); return; }
    setFound({ device: r.data.device, needsTotp: r.data.needsTotp });
  }, []);
  useEffect(() => { if (initialCode) void look(initialCode); }, [initialCode, look]);

  return (
    <div className="fixed inset-0 z-[800] overflow-y-auto" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-md space-y-5 px-4 py-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Подключить устройство</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}><X size={18} /></button>
        </div>
        {done ? (
          <div className="space-y-4 text-center">
            <Check size={40} className="mx-auto" style={{ color: 'var(--accent)' }} />
            <p style={{ color: 'var(--t1)' }}>{done}</p>
            <button type="button" onClick={onClose} className="rounded-2xl px-6 py-3 font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Готово</button>
          </div>
        ) : found ? (
          <Confirm device={found.device} needsTotp={found.needsTotp} onDone={setDone} />
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--t2)' }}>На телевизоре, консоли или в машине выберите вход по QR. Наведите камеру на QR или введите код подключения с экрана.</p>
            {scan ? <Scanner onCode={(t) => void look(t)} /> : (
              <button type="button" onClick={() => setScan(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold"
                style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}><ScanLine size={18} /> Сканировать QR</button>
            )}
            <div className="space-y-2">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" translate="no" aria-label="Код подключения"
                className="w-full rounded-2xl px-4 py-3 text-center text-xl font-bold tracking-widest outline-none"
                style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
              <button type="button" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8} onClick={() => void look(code)}
                className="w-full rounded-2xl py-3 font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>{busy ? 'Проверяем…' : 'Продолжить'}</button>
            </div>
            {err && <p className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
            <History />
          </>
        )}
      </div>
    </div>
  );
};

/** Кнопка для раздела «Устройства». */
export const DeviceLinkButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
        style={{ background: 'var(--accent)', color: '#fff' }}><ScanLine size={16} /> Подключить ТВ, консоль или авто</button>
      {open && <DeviceLinkPhone onClose={() => setOpen(false)} />}
    </>
  );
};

/** Ссылка из QR (/link?code=…), открытая камерой телефона или ссылкой: после входа сразу показывает подтверждение. */
export const DeviceLinkDeepLink = () => {
  const [closed, setClosed] = useState(false);
  if (closed || location.pathname !== '/link') return null;
  const code = new URLSearchParams(location.search).get('code') ?? '';
  return <DeviceLinkPhone initialCode={code || undefined} onClose={() => { history.replaceState(null, '', '/'); setClosed(true); }} />;
};
