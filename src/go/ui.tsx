/** Sky GO: общие части интерфейса (светлая премиальная палитра поверх токенов приложения). */
import { visibleTick } from '@/shared/visibleTick';
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Loader2, ChevronLeft } from 'lucide-react';
import { C, fmt } from '@/marketplace/ui';
import { flash } from '@/shared/flash';
import { goError } from './api';

export { C, fmt };
export const GO = '#0ea5a4';          // фирменный бирюзовый Sky GO
export const GO_BG = 'rgba(14,165,164,.12)';

export const Card = ({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) => (
  <div onClick={onClick} {...(onClick ? { role: 'button', tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } } : {})}
    style={{ background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 18, padding: 14, cursor: onClick ? 'pointer' : undefined, ...style }}>{children}</div>
);

export const Btn = ({ children, onClick, kind = 'main', disabled, busy, style }: {
  children: ReactNode; onClick?: () => void; kind?: 'main' | 'soft' | 'danger'; disabled?: boolean; busy?: boolean; style?: CSSProperties;
}) => (
  <button type="button" disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick} style={{
    minHeight: 46, height: 46, borderRadius: 14, border: kind === 'soft' ? `1px solid ${C.brd}` : 'none', fontWeight: 700, fontSize: 15,
    background: kind === 'main' ? GO : kind === 'danger' ? 'rgba(239,68,68,.12)' : C.l2,
    color: kind === 'main' ? '#fff' : kind === 'danger' ? C.red : C.t1, opacity: disabled || busy ? 0.55 : 1,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 18px', cursor: 'pointer', ...style,
  }}>{busy && <Loader2 size={16} className="animate-spin" />}{children}</button>
);

export const Input = ({ label, value, onChange, placeholder, type = 'text', max, area }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: number; area?: boolean;
}) => (
  <label style={{ display: 'block' }}>
    {label && <div style={{ fontSize: 12.5, color: C.t2, margin: '0 0 5px 4px' }}>{label}</div>}
    {area
      ? <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max} rows={3}
          style={{ width: '100%', borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '10px 14px', fontSize: 15, resize: 'none' }} />
      : <input aria-label={label} value={value} type={type} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={max}
          style={{ width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 14px', fontSize: 15, textAlign: 'left' }} />}
  </label>
);

export const Chip = ({ children, color = GO }: { children: ReactNode; color?: string }) => (
  <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: `${color}22`, color }}>{children}</span>
);

/** Загрузка: бегущие плашки вместо пустого экрана; скринридер слышит «Загрузка». */
export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div role="status" aria-live="polite" aria-label="Загрузка" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 0' }}>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="go-skel" style={{ height: i === 0 ? 76 : 56, borderRadius: 18 }} />)}
  </div>
);

/** Пустое состояние. Текст «Загрузка…» рисуется как загрузка, остальное — спокойное пояснение (и действие, если есть). */
export const Empty = ({ text, hint, action }: { text: string; hint?: string; action?: ReactNode }) => (
  text === 'Загрузка…' ? <Loading /> : (
    <div style={{ textAlign: 'center', color: C.t3, padding: '36px 16px', fontSize: 14 }}>
      <div>{text}</div>
      {hint && <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.4 }}>{hint}</div>}
      {action && <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>{action}</div>}
    </div>)
);

/** Ошибка загрузки: понятный текст и «Повторить», а не вечное «Загрузка…». */
export const ErrorState = ({ text, onRetry }: { text: string; onRetry?: () => void }) => (
  <div role="alert" style={{ textAlign: 'center', padding: '32px 16px' }}>
    <div style={{ color: C.t2, fontSize: 14, lineHeight: 1.45 }}>{text}</div>
    {onRetry && <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}><Btn kind="soft" onClick={onRetry}>Повторить</Btn></div>}
  </div>
);

export const Notice = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) => (
  <div role={tone === 'warn' ? 'alert' : 'note'} style={{ fontSize: 13, lineHeight: 1.45, padding: '10px 12px', borderRadius: 12, color: tone === 'warn' ? C.amber : C.t2,
    background: tone === 'warn' ? 'rgba(245,158,11,.12)' : C.l2 }}>{children}</div>
);

export const Back = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
    <button type="button" onClick={onClick} aria-label="Назад" style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: C.l2, color: C.t1, display: 'grid', placeItems: 'center' }}><ChevronLeft size={20} /></button>
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
    const t = everyMs ? setInterval(visibleTick(() => fn().then((v) => { if (alive) setData(v); })), everyMs) : null;
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
  <select aria-label="Город" value={city} onChange={(e) => onChange(e.target.value)} style={{ height: 44, borderRadius: 12, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 10px', fontSize: 14 }}>
    {cities.map((c) => <option key={c} value={c}>{c}</option>)}
  </select>
);


/* ─── Заголовок экрана в стиле «Яндекс Go»: крупно, значок слева, закрытие справа ─── */
export const Head = ({ title, sub, icon, onBack }: { title: string; sub?: string; icon?: ReactNode; onBack: () => void }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
    {icon && <div style={{ width: 46, height: 46, borderRadius: '50%', background: GO_BG, color: GO, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</div>}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 900, color: C.t1, lineHeight: 1.1 }}>{title}</div>
      {sub && <div translate="no" style={{ fontSize: 13, color: C.t2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
    <button type="button" onClick={onBack} aria-label="Закрыть" style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: C.l2, color: C.t2, display: 'grid', placeItems: 'center', fontSize: 18 }}>✕</button>
  </div>
);

/** Крупная плитка-карточка: название, подпись, значок внизу. */
export const Tile = ({ title, hint, icon, onClick, disabled }: { title: string; hint: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} style={{ textAlign: 'left', minHeight: 132, borderRadius: 22, border: 'none', background: C.l2, padding: 14, display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', opacity: disabled ? 0.5 : 1, cursor: 'pointer' }}>
    <div><div style={{ fontSize: 17, fontWeight: 800, color: C.t1 }}>{title}</div><div style={{ fontSize: 12.5, color: C.t2, marginTop: 3, lineHeight: 1.3 }}>{hint}</div></div>
    <div style={{ color: GO, marginTop: 10 }}>{icon}</div>
  </button>
);

/** Сегмент-переключатель (S/M/L, «Нет/1/2», вкладки). */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', background: C.l2, borderRadius: 14, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} style={{ flex: 1, height: 44, minWidth: 48, borderRadius: 11, border: 'none', fontWeight: 700, fontSize: 15,
          background: value === o.v ? C.l1 : 'transparent', color: value === o.v ? C.t1 : C.t3, boxShadow: value === o.v ? '0 1px 4px rgba(0,0,0,.18)' : 'none' }}>{o.t}</button>))}
    </div>
  );
}

/** Строка формы: значок, подпись, значение, шеврон. */
export const PickRow = ({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: string; onClick?: () => void }) => (
  <button type="button" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '10px 0', color: C.t1, minHeight: 48 }}>
    <div style={{ width: 40, height: 40, borderRadius: 12, background: C.l2, display: 'grid', placeItems: 'center', color: C.t2, flexShrink: 0 }}>{icon}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, color: C.t3 }}>{label}</div>
      <div translate="no" style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</div>
    </div>
    <span aria-hidden style={{ color: C.t3, fontSize: 18 }}>›</span>
  </button>
);

/** Нижняя «липкая» панель с главным действием: остаётся видимой при прокрутке формы. */
export const StickyBar = ({ left, children }: { left?: ReactNode; children: ReactNode }) => (
  <div style={{ position: 'sticky', bottom: -24, margin: '14px -16px -24px', padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))', background: C.bg, borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 12, zIndex: 3 }}>
    {left && <div style={{ flexShrink: 0 }}>{left}</div>}
    <div style={{ flex: 1, display: 'flex' }}>{children}</div>
  </div>
);


/** «Сейчас / На потом» с выбором даты и времени. value — локальное значение datetime-local или '' (сейчас). */
export const ScheduleField = ({ later, when, onLater, onWhen, what }: { later: boolean; when: string; onLater: (v: boolean) => void; onWhen: (v: string) => void; what: 'ride' | 'delivery' }) => (
  <div>
    <Segmented value={later ? 'later' : 'now'} onChange={(v: string) => onLater(v === 'later')} options={[{ v: 'now', t: 'Сейчас' }, { v: 'later', t: 'На потом' }]} />
    {later && (<div style={{ marginTop: 10 }}>
      <input type="datetime-local" value={when} min={new Date(Date.now() + 31 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(e) => onWhen(e.target.value)}
        aria-label="Дата и время" style={{ width: '100%', height: 46, borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l1, color: C.t1, padding: '0 12px', fontSize: 15 }} />
      <div style={{ fontSize: 12.5, color: C.t3, marginTop: 6 }}>{what === 'ride'
        ? 'Цена зафиксирована сейчас. Водитель назначается ближе ко времени поездки — за 20 минут мы начнём поиск и пришлём уведомление. Отменить можно до начала поиска и после — по обычным правилам.'
        : 'Цена зафиксирована сейчас. Курьер назначается ближе ко времени — за 20 минут мы начнём поиск и пришлём уведомление. Отменить можно до начала поиска и после — по обычным правилам.'}</div>
    </div>)}
  </div>
);
