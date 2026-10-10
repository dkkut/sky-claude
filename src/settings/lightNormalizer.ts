/* ===============================================================
   Светлая тема: нормализация жёстко прописанных тёмных цветов.

   Большинство экранов берёт цвета из переменных (--bg, --t1 …), и
   светлая палитра из styles.css их подхватывает сама. Но в коде много
   мест, где тёмная панель или белый текст прописаны литералом
   (`#0a0a0f`, `text-white`, `rgba(255,255,255,.5)`): под светлым фоном
   они дают чёрные плашки и невидимый текст. Переписать каждое вручную
   нельзя без риска сломать тёмную тему, поэтому в светлой теме этот
   модуль ПО РЕЗУЛЬТАТУ расчёта стилей:

     1. тёмные нейтральные фоны (не градиенты, не подложки модалок, не
        видео) помечает data-ln-bg → CSS ниже красит их светлым;
     2. текст, который на светлом фоне получился почти белым, помечает
        data-ln-fg → CSS ниже красит его тёмным.

   Цветные кнопки, градиенты, видео/обложки и всё внутри
   [data-keep-dark] (плееры, тёмные темы чата) не трогаются. Выключили
   светлую тему — метки снимаются, всё возвращается как было.
=============================================================== */

type RGBA = { r: number; g: number; b: number; a: number };

const parse = (c: string): RGBA | null => {
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b, a = 1] = m.map(Number);
  return { r, g, b, a };
};
const lum = (c: RGBA) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
const sat = (c: RGBA) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

const BG_ATTR = 'data-ln-bg';
const FG_ATTR = 'data-ln-fg';
const MEDIA = 'video,canvas,img,iframe';

let observer: MutationObserver | null = null;
let dirty = new Set<Element>();
let scheduled = 0;

const keepDark = (el: Element) => !!el.closest('[data-keep-dark]');

const PAGE_BG: RGBA = { r: 244, g: 245, b: 247, a: 1 };

const over = (top: RGBA, base: RGBA): RGBA => ({
  r: top.r * top.a + base.r * (1 - top.a),
  g: top.g * top.a + base.g * (1 - top.a),
  b: top.b * top.a + base.b * (1 - top.a),
  a: 1,
});

/** Средний цвет градиента (полупрозрачные точки смешиваются с тем, что
 *  лежит под ним); null — это картинка или градиент разобрать не удалось. */
const gradientOver = (img: string, base: RGBA): RGBA | null => {
  if (!/gradient\(/.test(img) || /url\(/.test(img)) return null;
  const stops = img.match(/rgba?\([^)]*\)/g);
  if (!stops?.length) return null;
  let r = 0, g = 0, b = 0;
  for (const st of stops) {
    const c = parse(st); if (!c) return null;
    const m = over(c, base);
    r += m.r; g += m.g; b += m.b;
  }
  const n = stops.length;
  return { r: r / n, g: g / n, b: b / n, a: 1 };
};

/** Эффективный фон под элементом, слоями снизу вверх: цвет предков →
 *  свой цвет → свой градиент. null — неизвестен (картинка/видео/холст). */
const effectiveBg = (el: Element | null): RGBA | null => {
  if (!el) return PAGE_BG;
  if (el.tagName === 'VIDEO' || el.tagName === 'CANVAS') return null;
  const cs = getComputedStyle(el);
  const color = parse(cs.backgroundColor);
  const hasImg = cs.backgroundImage !== 'none';
  // непрозрачный цвет без картинки — дальше вверх идти не нужно
  if (color && color.a >= 0.95 && !hasImg) return color;
  let base: RGBA | null = (color && color.a >= 0.95) ? color : effectiveBg(el.parentElement);
  if (!base) return null;
  if (color && color.a > 0 && color.a < 0.95) base = over(color, base);
  if (hasImg) return gradientOver(cs.backgroundImage, base);
  return base;
};

const processBg = (el: Element, vw: number, vh: number) => {
  if (el.hasAttribute(BG_ATTR)) return;
  const cs = getComputedStyle(el);
  if (cs.backgroundImage !== 'none') return;
  const c = parse(cs.backgroundColor);
  if (!c || c.a < 0.35 || lum(c) >= 0.2 || sat(c) > 48) return;
  const r = el.getBoundingClientRect();
  if (r.width * r.height < 1500) return;
  // подложка модального окна (тёмная вуаль на весь экран) остаётся тёмной
  if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width * r.height > 0.5 * vw * vh) return;
  if (el.querySelector(MEDIA)) return;
  if (keepDark(el)) return;
  el.setAttribute(BG_ATTR, lum(c) < 0.075 ? '1' : '2');
};

const hasOwnText = (el: Element) => {
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 && (n.textContent ?? '').trim().length > 0) return true;
  return false;
};

const processFg = (el: Element) => {
  if (el.hasAttribute(FG_ATTR)) return;
  if (!hasOwnText(el) && !Array.from(el.children).some(ch => ch.tagName === 'svg')) return;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden') return;
  const col = parse(cs.color);
  if (!col || col.a < 0.2 || lum(col) < 0.72) return;
  if (keepDark(el)) return;
  const bg = effectiveBg(el);
  if (!bg || lum(bg) < 0.62) return;
  el.setAttribute(FG_ATTR, col.a < 0.75 ? '2' : '1');
};

const collect = (root: Element, into: Element[]) => {
  into.push(root);
  root.querySelectorAll('*').forEach(e => into.push(e));
};

const flush = () => {
  scheduled = 0;
  if (!observer) return;
  const roots = Array.from(dirty);
  dirty = new Set();
  const all: Element[] = [];
  for (const r of roots) if (r.isConnected) collect(r, all);
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const el of all) processBg(el, vw, vh);
  for (const el of all) processFg(el);
};

const schedule = () => {
  if (scheduled) return;
  scheduled = window.setTimeout(flush, 120);
};

const mark = (el: Node | null) => {
  if (el && el.nodeType === 1) { dirty.add(el as Element); schedule(); }
};

export const startLightNormalizer = () => {
  if (observer || typeof document === 'undefined') return;
  observer = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach(n => {
          mark(n);
          // холст/видео/картинка появились позже, чем предок получил
          // светлый фон, — предок снова должен считаться «медийным»
          if (n.nodeType === 1 && ((n as Element).matches(MEDIA) || (n as Element).querySelector(MEDIA))) {
            let up: Element | null = (n as Element).parentElement;
            for (let i = 0; up && i < 8; i++, up = up.parentElement) {
              if (up.hasAttribute(BG_ATTR)) {
                up.removeAttribute(BG_ATTR);
                // текст внутри уже получил тёмный цвет под светлый фон
                up.querySelectorAll(`[${FG_ATTR}]`).forEach(e => e.removeAttribute(FG_ATTR));
                mark(up);
              }
              if (up.hasAttribute(FG_ATTR)) up.removeAttribute(FG_ATTR);
            }
          }
        });
      }
      else if (m.type === 'attributes') {
        const t = m.target as Element;
        // собственные метки не считаем изменением
        if (m.attributeName === BG_ATTR || m.attributeName === FG_ATTR) continue;
        t.removeAttribute(BG_ATTR); t.removeAttribute(FG_ATTR);
        mark(t);
      } else if (m.type === 'characterData') mark(m.target.parentElement);
    }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['style', 'class'],
  });
  mark(document.body);
};

export const stopLightNormalizer = () => {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  dirty = new Set();
  if (scheduled) { clearTimeout(scheduled); scheduled = 0; }
  document.querySelectorAll(`[${BG_ATTR}],[${FG_ATTR}]`).forEach(e => {
    e.removeAttribute(BG_ATTR); e.removeAttribute(FG_ATTR);
  });
};
