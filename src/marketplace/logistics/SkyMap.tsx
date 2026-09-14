/**
 * Карта логистики.
 *
 * Что здесь было раньше: нарисованная сетка «улиц» и точки, положение
 * которых выводилось из хэша идентификатора. Курьер «стоял» там, куда
 * его поставил остаток от деления, а транспорт «ехал» равномерным
 * скольжением между двумя такими же выдуманными точками. Выглядело
 * живо и означало ровно ничего: по этой карте нельзя было доехать.
 *
 * Теперь это настоящая карта Google, и на ней только то, что есть в
 * базе. Точки без координат на неё не попадают вовсе — вместо них
 * написано, сколько их и почему их не видно. Пустая карта честнее
 * полной выдуманных точек: по вымышленной поедут.
 *
 * Почему картинкой, а не живой картой Google, которую тянут мышью.
 * Её библиотека грузится в браузере со стороннего домена, а политика
 * безопасности приложения разрешает скрипты только со своего: пустить
 * туда Google значит ослабить её для всей страницы, где рядом живут
 * переписка и кошелёк. Картинку же собирает наш сервер своим ключом —
 * в браузер ключ не попадает ни разу. Двигают и приближают карту
 * кнопками: сервер присылает следующий кадр.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, MapPinOff, Plus, Minus, Crosshair } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';
import { C } from '@/marketplace/SkyMarket';
import type { GeoPoint } from './types';
import { apiMapsSettings, mapStillUrl, isRealPoint, type MapPin as Pin, type MapPinKind } from './mapsApi';

export interface MapPoint {
  id: string;
  pos: GeoPoint;
  label: string;
  Icon?: IconComponent;
  online?: boolean;
  highlight?: boolean;
  kind?: MapPinKind;
}

/* ─── Проекция ─────────────────────────────────────────────────────── */

/**
 * Меркатор — та же проекция, в которой Google рисует карту.
 *
 * Нужна, чтобы положить подписи ровно на метки: метки рисует Google
 * внутри картинки, а подписи мы кладём поверх. Считать их положение
 * можно только потому, что середину и приближение задаём мы сами.
 */
const WORLD = 256;

const project = (p: GeoPoint) => {
  const x = (p.lng + 180) / 360;
  const s = Math.sin((p.lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return { x: x * WORLD, y: y * WORLD };
};

/** Насколько приблизить, чтобы все точки поместились в кадр. */
const fitZoom = (points: GeoPoint[], width: number, height: number) => {
  if (points.length < 2) return 13;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of points) {
    const q = project(p);
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  /* Небольшой запас по краям: метка у самой кромки выглядит обрезанной. */
  const z = Math.min(
    Math.log2((width * 0.82) / spanX),
    Math.log2((height * 0.82) / spanY),
  );
  return Math.max(2, Math.min(17, Math.floor(z)));
};

const middle = (points: GeoPoint[]): GeoPoint => {
  let x = 0; let y = 0;
  for (const p of points) { const q = project(p); x += q.x; y += q.y; }
  const cx = x / points.length;
  const cy = y / points.length;
  const lng = (cx / WORLD) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * cy) / WORLD;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
};

/* ─── Карта ────────────────────────────────────────────────────────── */

export const SkyMap = ({
  points, height = 220, onPick,
}: {
  points: MapPoint[];
  height?: number;
  /** Выбор точки щелчком — для формы, где задают место склада. */
  onPick?: (p: GeoPoint) => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [broken, setBroken] = useState(false);

  /* Настоящие точки — те, у которых есть координаты. Остальные на карту
     не попадают, и об этом сказано под ней. */
  const real = useMemo(() => points.filter((p) => isRealPoint(p.pos)), [points]);
  const missing = points.length - real.length;

  const [view, setView] = useState<{ center: GeoPoint; zoom: number } | null>(null);

  useEffect(() => { void apiMapsSettings().then((s) => setEnabled(s.enabled)); }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    watch.observe(el);
    setWidth(Math.max(120, el.clientWidth));
    return () => watch.disconnect();
  }, []);

  /* Кадр по умолчанию — такой, чтобы поместились все точки. Пока его не
     трогали кнопками, он пересчитывается вслед за точками. */
  const auto = useMemo(() => {
    if (real.length === 0) return null;
    const list = real.map((p) => p.pos);
    return { center: middle(list), zoom: fitZoom(list, width, height) };
  }, [real, width, height]);

  const frame = view ?? auto;

  useEffect(() => { setBroken(false); }, [frame?.center.lat, frame?.center.lng, frame?.zoom]);

  const pins: Pin[] = real.map((p) => ({
    lat: p.pos.lat, lng: p.pos.lng, kind: p.kind ?? (p.highlight ? 'target' : 'default'),
  }));

  const note = (text: string, Icon: IconComponent = MapPinOff) => (
    <div ref={box} className="flex flex-col items-center justify-center gap-2 rounded-2xl"
      style={{ height, background: C.l2, border: `1px solid ${C.brd}` }}>
      <Icon size={22} style={{ color: C.t3 }} />
      <p className="px-6 text-center text-[11px]" style={{ color: C.t3 }}>{text}</p>
    </div>
  );

  if (enabled === null) return note('Карта загружается…', MapPin);
  if (!enabled) {
    return note('Карта не настроена: у сервера нет ключа Google Карт. '
      + 'Показывать вместо неё выдуманные точки нельзя — по ним поедут.');
  }
  if (!frame) {
    return note(points.length === 0
      ? 'Показывать на карте нечего.'
      : `Ни у одной из ${points.length} точек нет координат — на карту их не поставить.`);
  }
  if (broken) return note('Карта не пришла. Попробуйте ещё раз чуть позже.');

  const src = mapStillUrl(pins, {
    center: frame.center, zoom: frame.zoom, width, height,
  });

  /* Подписи кладутся поверх картинки: метки рисует Google, имена — мы. */
  const centrePx = project(frame.center);
  const scale = 2 ** frame.zoom;
  const place = (p: GeoPoint) => {
    const q = project(p);
    return {
      left: width / 2 + (q.x - centrePx.x) * scale,
      top: height / 2 + (q.y - centrePx.y) * scale,
    };
  };

  const step = () => 60 / (2 ** frame.zoom);
  const move = (dLat: number, dLng: number) => setView({
    zoom: frame.zoom,
    center: { lat: frame.center.lat + dLat, lng: frame.center.lng + dLng },
  });
  const zoomBy = (d: number) => setView({
    center: frame.center, zoom: Math.max(2, Math.min(20, frame.zoom + d)),
  });

  const btn = 'grid h-7 w-7 place-items-center rounded-lg';
  const btnStyle = { background: 'rgba(15,15,20,0.82)', color: '#fff' };

  return (
    <div>
      <div ref={box} className="relative overflow-hidden rounded-2xl"
        style={{ height, border: `1px solid ${C.brd}`, background: C.l2 }}>
        <img src={src} alt="Карта" width={width} height={height}
          onError={() => setBroken(true)}
          onClick={onPick ? (e) => {
            /* Щелчок в точку: обратный ход той же проекции. */
            const r = (e.target as HTMLImageElement).getBoundingClientRect();
            const dx = e.clientX - r.left - width / 2;
            const dy = e.clientY - r.top - height / 2;
            const wx = centrePx.x + dx / scale;
            const wy = centrePx.y + dy / scale;
            const lng = (wx / WORLD) * 360 - 180;
            const n = Math.PI - (2 * Math.PI * wy) / WORLD;
            const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
            onPick({ lat, lng });
          } : undefined}
          style={{
            display: 'block', width: '100%', height: '100%', objectFit: 'cover',
            cursor: onPick ? 'crosshair' : 'default',
          }} />

        {/* Имена точек поверх меток Google. */}
        {real.map((p) => {
          const at = place(p.pos);
          if (at.left < -40 || at.left > width + 40 || at.top < -30 || at.top > height + 30) return null;
          return (
            <span key={p.id}
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold"
              style={{
                left: at.left, top: at.top + 12,
                background: 'rgba(0,0,0,0.62)',
                color: p.online === false ? C.t3 : '#fff',
              }}>
              {p.label}
            </span>
          );
        })}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className={btn} style={btnStyle} onClick={() => zoomBy(1)} aria-label="Ближе">
            <Plus size={14} />
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => zoomBy(-1)} aria-label="Дальше">
            <Minus size={14} />
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => setView(null)} aria-label="Все точки">
            <Crosshair size={14} />
          </button>
        </div>

        <div className="absolute bottom-2 left-2 grid grid-cols-3 gap-0.5">
          <span />
          <button type="button" className={btn} style={btnStyle} onClick={() => move(step(), 0)} aria-label="Вверх">↑</button>
          <span />
          <button type="button" className={btn} style={btnStyle} onClick={() => move(0, -step())} aria-label="Влево">←</button>
          <span />
          <button type="button" className={btn} style={btnStyle} onClick={() => move(0, step())} aria-label="Вправо">→</button>
          <span />
          <button type="button" className={btn} style={btnStyle} onClick={() => move(-step(), 0)} aria-label="Вниз">↓</button>
          <span />
        </div>
      </div>

      {missing > 0 && (
        <p className="mt-1.5 text-[10px]" style={{ color: C.t3 }}>
          {missing === points.length
            ? 'Ни одна точка не передала координаты — на карте их нет.'
            : `Ещё ${missing} без координат — на карте их нет.`}
        </p>
      )}
    </div>
  );
};
