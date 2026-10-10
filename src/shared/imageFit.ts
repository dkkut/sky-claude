/**
 * Привести выбранную картинку к виду, который примет сервер профиля:
 * data:image/(jpeg|webp|png) не длиннее лимита. Фото с телефона весит
 * мегабайты, а сервер принимает аватар до ~190 КБ — раньше он молча
 * стирал слишком большой снимок, и аватар «пропадал после обновления».
 */
const load = (file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable_image')); };
    img.src = url;
  });

export const fitImageToDataUrl = async (
  file: Blob, opts: { maxSide: number; maxChars: number },
): Promise<string> => {
  if (!/^image\/(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(file.type || 'image/jpeg')) throw new Error('unsupported_image');
  const { img, w, h, done } = await load(file);
  try {
    if (!w || !h) throw new Error('unreadable_image');
    let side = opts.maxSide;
    for (let attempt = 0; attempt < 6; attempt++) {
      const k = Math.min(1, side / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('unreadable_image');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);   // JPEG без прозрачности
      ctx.drawImage(img, 0, 0, cw, ch);
      for (const q of [0.86, 0.74, 0.62, 0.5]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= opts.maxChars) return out;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('too_large');
  } finally { done(); }
};
