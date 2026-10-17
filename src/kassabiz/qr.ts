/* QR-коды SkyKassa: рисуются на клиенте из адреса страницы (в QR только адрес, никаких секретов).
   Уровень коррекции H, логотип в центре занимает меньше 18 % площади — сканирование не страдает. */
import qrcode from 'qrcode-generator';

let logoCache: string | null | undefined;
const logoDataUrl = async (): Promise<string | null> => {
  if (logoCache !== undefined) return logoCache;
  try {
    const r = await fetch('/logo.png'); if (!r.ok) throw new Error('no logo');
    const b = await r.blob();
    logoCache = await new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = bad; f.readAsDataURL(b); });
  } catch { logoCache = null; }
  return logoCache;
};

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** SVG-строка QR с белой «тихой зоной» и логотипом (если он доступен). */
export const qrSvg = async (url: string, size = 320, withLogo = true): Promise<string> => {
  const q = qrcode(0, 'H'); q.addData(url); q.make();
  const n = q.getModuleCount(); const quiet = 4; const total = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const logo = withLogo ? await logoDataUrl() : null;
  const box = Math.floor(n * 0.2); const off = (total - box) / 2;
  const mid = logo ? `<rect x="${off - 0.5}" y="${off - 0.5}" width="${box + 1}" height="${box + 1}" rx="2" fill="#fff"/><image href="${logo}" x="${off}" y="${off}" width="${box}" height="${box}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#0b1020"/>${mid}</svg>`;
};

const download = (blob: Blob, name: string) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export const downloadSvg = async (url: string, name: string) => download(new Blob([await qrSvg(url, 1024)], { type: 'image/svg+xml' }), `${name}.svg`);

export const downloadPng = async (url: string, name: string) => {
  const svg = await qrSvg(url, 1024);
  const img = new Image();
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('png')); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const ctx = c.getContext('2d'); if (!ctx) return;
  ctx.drawImage(img, 0, 0, 1024, 1024);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (blob) download(blob, `${name}.png`);
};

/** Печатная табличка: название бизнеса, подпись и QR на отдельной странице (через скрытый iframe, без новых окон). */
export const printQr = async (url: string, title: string, subtitle = 'Наведите камеру или откройте сканер в SkyMoney') => {
  const svg = await qrSvg(url, 520);
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument; if (!d) { f.remove(); return; }
  d.open(); d.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;text-align:center;margin:40px}h1{font-size:34px;margin:0 0 8px}p{font-size:18px;color:#444}svg{margin:24px auto;display:block}small{color:#777;word-break:break-all}</style><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${svg}<small>${esc(url)}</small>`); d.close();
  f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 2000); };
  setTimeout(() => { try { f.contentWindow?.print(); } catch { /* ok */ } }, 400);
};
