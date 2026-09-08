/**
 * QR-код рисуется на устройстве.
 *
 * Раньше картинку отдавал сторонний сервис api.qrserver.com, а данные
 * уходили к нему прямо в адресе запроса — вместе с кодом пропуска и
 * кодом отправления. Для пропуска код и есть секрет: кто его знает, тот
 * проходит. Отдавать такое чужому серверу нельзя, поэтому наружу больше
 * не ходит никто.
 */
import qrcode from 'qrcode-generator';

// По умолчанию библиотека кладёт в код младший байт каждого символа —
// латиница выживает, кириллица превращается в мусор. Проверено
// сканером: без этой строки «Концерт «Небо»» не читается вовсе.
// Готовой таблицы UTF-8 в ESM-сборке нет, поэтому берём TextEncoder.
qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));

export interface QrOptions {
  /** Сторона картинки в пикселях. */
  size?: number;
  /** Цвет модулей и фона. */
  color?: string;
  background?: string;
  /** Поля вокруг кода, в модулях. Меньше четырёх читается хуже. */
  quietZone?: number;
}

/**
 * SVG как строка: его можно и вставить в разметку, и положить в
 * печатную форму, и превратить в data-URI для <img>.
 *
 * Уровень коррекции M — золотая середина: код переживает грязь и блики
 * на экране, но не раздувается так, как при высоком уровне.
 */
export const qrSvg = (data: string, options: QrOptions = {}): string => {
  const {
    size = 200,
    color = '#000000',
    background = '#ffffff',
    quietZone = 4,
  } = options;

  // Нулевая версия — «подбери сам под длину данных».
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + quietZone * 2;

  // Один <path> на весь код: так разметка остаётся короткой даже для
  // длинных данных, а браузеру нечего склеивать.
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        path += `M${col + quietZone} ${row + quietZone}h1v1h-1z`;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="${background}"/>`,
    `<path d="${path}" fill="${color}"/>`,
    '</svg>',
  ].join('');
};

/**
 * Тот же код, но как data-URI — для мест, где нужен именно <img>
 * (например, печатная наклейка, которую собирают строкой HTML).
 *
 * Кодируем через encodeURIComponent, а не base64: btoa спотыкается на
 * не-латинице, а данные у нас бывают какие угодно.
 */
export const qrDataUri = (data: string, options: QrOptions = {}): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(data, options))}`;
