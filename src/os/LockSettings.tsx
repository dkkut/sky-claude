/** Профиль → Настройки → «Экран блокировки Sky»: обои, музыка, погода, уведомления. Всё только на этом устройстве. */
import React, { useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { prepareWallpaper, putWallpaperBlob, deleteWallpaperBlob } from '@/messenger/wallpapers';
import { flash } from '@/shared/flash';
import { useLockSettings, useLockScreen, refreshWeather, type LockWallpaper } from './lockStore';
import { LOCK_WALLPAPER_KEY } from './LockScreen';

const Row = ({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) => (
  <button type="button" role="switch" aria-checked={on} onClick={onToggle} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
    <span className="min-w-0 flex-1">
      <span className="block text-[13.5px] font-semibold" style={{ color: 'var(--t1)' }}>{label}</span>
      {hint && <span className="block text-[11.5px]" style={{ color: 'var(--t3)' }}>{hint}</span>}
    </span>
    <span className="relative h-6 w-11 shrink-0 rounded-full transition-colors" style={{ background: on ? 'var(--accent)' : 'rgba(255,255,255,0.18)' }}>
      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
    </span>
  </button>
);

export const LockScreenSettings = () => {
  const s = useLockSettings();
  const show = useLockScreen(st => st.show);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    const r = await prepareWallpaper(f);
    if (!r.ok) { setBusy(false); flash(r.reason); return; }
    const ok = await putWallpaperBlob(LOCK_WALLPAPER_KEY, r.blob);
    setBusy(false);
    if (!ok) { flash('Не удалось сохранить картинку на этом устройстве.'); return; }
    s.set({ wallpaper: 'custom' });
  };
  const setWall = (w: LockWallpaper) => { s.set({ wallpaper: w }); if (w !== 'custom') void deleteWallpaperBlob(LOCK_WALLPAPER_KEY); };
  const toggleWeather = async () => {
    if (!s.showWeather) {
      const w = await refreshWeather();
      if (!w) { flash('Погода недоступна: разрешите определение местоположения или повторите позже.'); return; }
    }
    s.set({ showWeather: !s.showWeather });
  };

  return (
    <div className="px-2 pb-2">
      <p className="px-3 pb-2 pt-1 text-[12px] leading-snug" style={{ color: 'var(--t3)' }}>
        Фирменный экран Sky с часами, музыкой и уведомлениями. Это экран внутри приложения, а не блокировка системы: пароль Windows, Android или iPhone он не заменяет.
        Чтобы закрывать его кодом или Face ID, включите «Замок приложения» в Sky ID.
      </p>
      <div className="px-3 pb-2">
        <p className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Обои</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Обои экрана блокировки">
          {([['space', 'Космос'], ['cover', 'Обложка трека'], ['custom', 'Своя картинка']] as [LockWallpaper, string][]).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={s.wallpaper === k} disabled={busy}
              onClick={() => (k === 'custom' ? fileRef.current?.click() : setWall(k))}
              className="rounded-2xl px-2 py-2.5 text-[12px] font-semibold"
              style={{ background: s.wallpaper === k ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: s.wallpaper === k ? '#fff' : 'var(--t2)', border: '1px solid rgba(255,255,255,0.1)' }}>{l}</button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        {s.wallpaper !== 'space' && (
          <label className="mt-3 block text-[12px]" style={{ color: 'var(--t3)' }}>Размытие: {s.blur} px
            <input type="range" min={0} max={40} value={s.blur} onChange={e => s.set({ blur: Number(e.target.value) })} className="mt-1 w-full" aria-label="Размытие обоев" />
          </label>
        )}
      </div>
      <Row label="Музыка" hint="Название трека и кнопки управления" on={s.showMusic} onToggle={() => s.set({ showMusic: !s.showMusic })} />
      <Row label="Погода" hint="По вашему местоположению; без разрешения не показывается" on={s.showWeather} onToggle={() => void toggleWeather()} />
      <Row label="Уведомления" on={s.showNotifs} onToggle={() => s.set({ showNotifs: !s.showNotifs })} />
      <Row label="Текст уведомлений" hint="Выключено: на закрытом экране видно только «Новое сообщение», без текста" on={s.showNotifText} onToggle={() => s.set({ showNotifText: !s.showNotifText })} />
      <div className="px-3 pt-1">
        <button type="button" onClick={show} className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-bold" style={{ background: 'rgba(255,255,255,0.09)', color: 'var(--t1)', border: '1px solid rgba(255,255,255,0.14)' }}>
          <Lock size={15} />Показать экран блокировки
        </button>
      </div>
    </div>
  );
};
