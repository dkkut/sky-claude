/** Sky GO: общие части интерфейса (светлая премиальная палитра поверх токенов приложения). */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, ChevronLeft } from 'lucide-react';
import { C, fmt } from '@/marketplace/ui';
import { flash } from '@/shared/flash';
import { goError } from './api';

export { C, fmt };
export const GO = '#0ea5a4';          // фирменный бирюзовый Sky GO
export const GO_BG = 'rgba(14,165,164,.12)';

export const Card = ({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) => (
  <div onClick={onClick} style={{ background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 18, padding: 14, cursor: onClick ? 'pointer' : undefined, ...style }}>{children}</div>
);

export const Btn = ({ children, onClick, kind = 'main', disabled, busy, style }: {
  children: ReactNode; onClick?: () => void; kind?: 'main' | 'soft' | 'danger'; disabled?: boolean; busy?: boolean; style?: CSSProperties;
}) => (
  <button disabled={disabled || busy} onClick={onClick} style={{
    height: 46, borderRadius: 14, border: kind === 'soft' ? `1px solid ${C.brd}` : 'none', fontWeight: 700, fontSize: 15,
    background: kind === 'main' ? GO : kind === 'danger' ? 'rgba(239,68,68,.12)' : C.l2,
    color: kind === 'main' ? '#fff' : kind === 'danger' ? C.red : C.t1, opacity: disabled || busy ? 0.55 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 18px', cursor: 'pointer', ...style,
  }}>{busy && <Loader2 size={16} className="animate-spin" />}{children}</button>
);

export const Input = ({ label, value, onChange, placeholder, type = 'text', max, area }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: number; area?: boolean;
}) => (
  <label style={{ display: 'block' }}>
    {label && <div style={{ fontSize: 12, color: C.t2, margin: '0 0 5px 4px' }}>{label}</div>}
    {area
      ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max} rows={3}
          style={{ width: '100%', borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '10px 14px', fontSize: 15, resize: 'none' }} />
      : <input value={value} type={type} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max}
          style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 14px', fontSize: 15 }} />}
  </label>
);

export const Chip = ({ children, color = GO }: { children: ReactNode; color?: string }) => (
  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: `${color}22`, color }}>{children}</span>
);

export const Empty = ({ text }: { text: string }) => (
  <div style={{ textAlign: 'center', color: C.t3, padding: '36px 16px', fontSize: 14 }}>{text}</div>
);

export const Notice = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) => (
  <div style={{ fontSize: 13, lineHeight: 1.45, padding: '10px 12px', borderRadius: 12, color: tone === 'warn' ? C.amber : C.t2,
    background: tone === 'warn' ? 'rgba(245,158,11,.12)' : C.l2 }}>{children}</div>
);

export const Back = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
    <button onClick={onClick} aria-label="Назад" style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: C.l2, color: C.t1, display: 'grid', placeItems: 'center' }}><ChevronLeft size={20} /></button>
    <div style={{ fontSize: 19, fontWeight: 800, color: C.t1 }}>{title}</div>
  </div>
);

export const Col = ({ children, gap = 10 }: { children: ReactNode; gap?: number }) => <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>;

/** Любой отказ сервера — на экран. */
export const fail = (r: { error?: string; reason?: string; status?: number }) => flash(goError(r));

/** Загрузка с перечитыванием; повторяет по таймеру, пока экран открыт. */
export const useLoad = <T,>(fn: () => Promise<T>, deps: unknown[] = [], everyMs = 0) => {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void fn().then((v) => { if (alive) setData(v); });
    const t = everyMs ? setInterval(() => void fn().then((v) => { if (alive) setData(v); }), everyMs) : null;
    return () => { alive = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return [data, () => setTick((n) => n + 1)] as const;
};

/** Геолокация по нажатию: без разрешения честно остаётся пустой. */
export const locate = (): Promise<{ lat: number; lng: number } | null> => new Promise((ok) => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 8000, maximumAge: 60000 });
});

export const useCity = (cities: string[] | undefined) => {
  const [city, setCity] = useState(() => { try { return localStorage.getItem('sky:go:city') ?? ''; } catch { return ''; } });
  useEffect(() => { if (!city && cities?.length) setCity(cities[0]); }, [cities, city]);
  const set = (c: string) => { setCity(c); try { localStorage.setItem('sky:go:city', c); } catch { /* ok */ } };
  return [city, set] as const;
};

export const CitySelect = ({ cities, city, onChange }: { cities: string[]; city: string; onChange: (c: string) => void }) => (
  <select value={city} onChange={(e) => onChange(e.target.value)} style={{ height: 38, borderRadius: 12, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 10px', fontSize: 14 }}>
    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
  </select>
);
