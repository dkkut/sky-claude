import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw } from 'lucide-react';
import { getFx, setFx, subscribeFx, EQ_LABELS, EQ_RANGE, EQ_PRESETS, PROFILES, type FxSettings, type ProfileId } from './audioFx';
import { audioFxSupported, audioFxLive, ensureAudioGraph } from './audioLevels';

const useFx = () => {
  const [s, setS] = useState<FxSettings>(getFx());
  useEffect(() => subscribeFx(setS), []);
  return s;
};

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Окно «Звук»: профиль звука и десятиполосный эквалайзер. Работает только в этом устройстве. */
export const EqualizerDialog = ({ onClose }: { onClose: () => void }) => {
  const s = useFx();
  const supported = audioFxSupported();
  // Открытие окна — это касание страницы: самое подходящее время запустить звуковой граф.
  const [live, setLive] = useState(audioFxLive());
  useEffect(() => { if (supported) setLive(ensureAudioGraph() || audioFxLive()); }, [supported]);
  const touch = (patch: Partial<FxSettings>) => { setFx(patch); if (supported) setLive(ensureAudioGraph() || audioFxLive()); };
  const preset = EQ_PRESETS.find((p) => same(p.bands, s.bands))?.id;

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" data-keep-dark
      style={{ background: 'rgba(0,0,0,0.6)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-[24px] sm:rounded-[24px] p-5"
        style={{ background: '#16181d', color: '#f2f3f5', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black">Звук</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"><X size={18} /></button>
        </div>

        {!supported && (
          <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(245,119,31,0.12)', color: '#f5a05a' }}>
            На этом устройстве (iPhone/iPad) браузер не позволяет обрабатывать звук плеера — настройки сохранятся, но не применятся.
          </p>
        )}
        {supported && !live && (
          <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: '#b6bac2' }}>
            Звук начнёт обрабатываться после первого нажатия на странице и запуска трека.
          </p>
        )}

        <p className="mt-4 text-[11px] font-bold tracking-widest" style={{ color: '#7c818c' }}>КАЧЕСТВО ЗВУКА</p>
        <div className="mt-2 grid gap-2">
          {(Object.keys(PROFILES) as ProfileId[]).map((id) => (
            <button key={id} type="button" onClick={() => touch({ profile: id })}
              className="rounded-xl px-3 py-2 text-left"
              style={{ background: s.profile === id ? 'rgba(245,119,31,0.18)' : 'rgba(255,255,255,0.05)', border: `1px solid ${s.profile === id ? '#f5771f' : 'transparent'}` }}>
              <p className="text-sm font-bold">{PROFILES[id].name}</p>
              <p className="text-[11px]" style={{ color: '#b6bac2' }}>{PROFILES[id].hint}</p>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px]" style={{ color: '#7c818c' }}>
          Файлы воспроизводятся в том виде, в каком загружены: Sky их не пережимает и битрейт не снижает.
        </p>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-[11px] font-bold tracking-widest" style={{ color: '#7c818c' }}>ЭКВАЛАЙЗЕР</p>
          <button type="button" role="switch" aria-checked={s.eqOn} onClick={() => touch({ eqOn: !s.eqOn })}
            className="relative h-6 w-11 rounded-full transition-colors" style={{ background: s.eqOn ? '#f5771f' : 'rgba(255,255,255,0.15)' }}>
            <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: s.eqOn ? 22 : 2 }} />
          </button>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {EQ_PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => touch({ bands: p.bands, eqOn: true })}
              className="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: preset === p.id ? '#f5771f' : 'rgba(255,255,255,0.07)', color: preset === p.id ? '#000' : '#b6bac2' }}>
              {p.name}
            </button>
          ))}
        </div>

        <div className="mt-4 flex justify-between gap-1" style={{ opacity: s.eqOn ? 1 : 0.45 }}>
          {s.bands.map((g, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[9px] tabular-nums" style={{ color: '#b6bac2' }}>{g > 0 ? `+${g}` : g}</span>
              <input type="range" min={-EQ_RANGE} max={EQ_RANGE} step={0.5} value={g}
                aria-label={`${EQ_LABELS[i]} Гц`}
                onChange={(e) => { const b = [...s.bands]; b[i] = Number(e.target.value); touch({ bands: b, eqOn: true }); }}
                style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 130, width: 24, accentColor: '#f5771f' } as React.CSSProperties} />
              <span className="text-[9px]" style={{ color: '#7c818c' }}>{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>

        <button type="button" onClick={() => touch({ bands: EQ_PRESETS[0].bands, profile: 'original' })}
          className="mt-4 flex items-center gap-1.5 text-xs font-bold" style={{ color: '#b6bac2' }}>
          <RotateCcw size={13} /> Сбросить всё
        </button>
        <p className="mt-2 text-[10px]" style={{ color: '#7c818c' }}>
          Настройки хранятся на этом устройстве и действуют на всё, что играет в плеере Sky (музыка и подкасты).
        </p>
      </div>
    </div>,
    document.body,
  );
};
