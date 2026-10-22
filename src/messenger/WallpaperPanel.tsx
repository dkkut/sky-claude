/* Вкладка «Обои» в окне «Тема чата»: готовые обои, своя картинка, затемнение и размытие; для этого чата или для всех. */
import { useRef, useState } from 'react';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import {
  DEFAULT_SPEC, WALLPAPERS, deleteWallpaperBlob, effectiveWallpaper, prepareWallpaper, putWallpaperBlob, useWallpapers, type WallpaperSpec,
} from './wallpapers';

export const WallpaperPanel = ({ chatId }: { chatId: string }) => {
  const st = useWallpapers();
  const [forAll, setForAll] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { spec } = effectiveWallpaper(st, chatId);
  const scope = forAll ? 'global' : 'chat';
  const key = forAll ? 'global' : chatId;
  const apply = (next: WallpaperSpec) => st.set(scope, chatId, next);
  const accent = 'var(--accent)';

  const pick = async (f?: File) => {
    if (!f) return;
    setErr(''); setBusy(true);
    const r = await prepareWallpaper(f);
    if (!r.ok) { setErr(r.reason); setBusy(false); return; }
    if (!(await putWallpaperBlob(key, r.blob))) { setErr('Не удалось сохранить картинку на устройстве (нет места или хранилище закрыто).'); setBusy(false); return; }
    apply({ kind: 'image', dim: spec.kind === 'none' ? 25 : spec.dim, blur: spec.blur });
    st.bumpImg(); setBusy(false);
  };
  const remove = async () => {
    if (forAll) { await deleteWallpaperBlob('global'); st.reset('global'); } else { await deleteWallpaperBlob(chatId); st.reset('chat', chatId); }
    st.bumpImg();
  };

  const tile = (active: boolean): React.CSSProperties => ({
    borderRadius: 14, aspectRatio: '1/1.3', position: 'relative', overflow: 'hidden',
    border: active ? `2.5px solid ${accent}` : '2px solid rgba(255,255,255,0.08)',
  });

  return (
    <div className="p-5">
      <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Куда применить обои">
        {([[false, 'Только этот чат'], [true, 'Все чаты']] as [boolean, string][]).map(([v, label]) => (
          <button key={label} type="button" role="radio" aria-checked={forAll === v} onClick={() => setForAll(v)}
            className="rounded-xl py-2 text-[12px] font-semibold"
            style={{ background: forAll === v ? 'var(--accent-bg)' : 'rgba(255,255,255,0.04)', color: forAll === v ? accent : 'var(--t2)', border: `1.5px solid ${forAll === v ? accent : 'var(--border)'}` }}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <button type="button" onClick={() => apply({ ...DEFAULT_SPEC, kind: 'none' })} style={tile(spec.kind === 'none')}
          className="grid place-items-center text-[10px] font-medium" aria-label="Без обоев">
          <span style={{ color: 'var(--t2)' }}>Без обоев</span>
          {spec.kind === 'none' && <Check size={12} className="absolute right-1 top-1" style={{ color: accent }} />}
        </button>
        <button type="button" onClick={() => file.current?.click()} disabled={busy} style={tile(spec.kind === 'image')}
          className="grid place-items-center text-[10px] font-medium" aria-label="Своя картинка">
          <span className="flex flex-col items-center gap-1" style={{ color: 'var(--t2)' }}><ImagePlus size={18} />{busy ? 'Загрузка…' : 'Своя'}</span>
          {spec.kind === 'image' && <Check size={12} className="absolute right-1 top-1" style={{ color: accent }} />}
        </button>
        {WALLPAPERS.map((w) => {
          const on = spec.kind === 'preset' && spec.id === w.id;
          return (
            <button key={w.id} type="button" onClick={() => apply({ kind: 'preset', id: w.id, dim: spec.dim, blur: spec.blur })}
              style={{ ...tile(on), background: w.background, backgroundSize: w.size ?? 'cover' }} aria-label={w.name} aria-pressed={on}>
              <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.35)' }}>{w.name}</span>
              {on && <Check size={12} className="absolute right-1 top-1 text-white" />}
            </button>
          );
        })}
      </div>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {err && <p role="alert" className="mt-3 text-xs" style={{ color: 'var(--red)' }}>{err}</p>}

      {spec.kind !== 'none' && (
        <div className="mt-5 space-y-3">
          {([['Затемнение', 'dim', 0, 80], ['Размытие', 'blur', 0, 20]] as const).map(([label, k, lo, hi]) => (
            <label key={k} className="block">
              <span className="mb-1 flex justify-between text-[12px] font-semibold" style={{ color: 'var(--t2)' }}><span>{label}</span><span>{spec[k]}{k === 'dim' ? ' %' : ' px'}</span></span>
              <input type="range" min={lo} max={hi} value={spec[k]} onChange={(e) => apply({ ...spec, [k]: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--accent)' }} />
            </label>
          ))}
          <button type="button" onClick={() => void remove()} className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--red)' }}>
            <Trash2 size={13} /> Сбросить {forAll ? 'общие обои' : 'обои этого чата'}
          </button>
        </div>
      )}

      <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--t2)' }}>
        Обои видны только вам и хранятся на этом устройстве. Свою картинку мы уменьшаем до 1600 px. «Без обоев» у чата перекрывает общие обои.
      </p>
    </div>
  );
};
