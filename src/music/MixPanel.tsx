/**
 * «Микс»: второй трек играет поверх текущего. Это НЕ разделение на дорожки (бит и голос из песни не вынуть без обработки на сервере),
 * а частотные фильтры на каждой деке: «Бит» оставляет низкие частоты (бас, бочка), «Голос» — полосу, где обычно слышен вокал.
 * Есть баланс между деками, темп второго трека, «стартовать вместе» и выбор, чей текст показывать. Всё — только на этом устройстве:
 * микс нигде не сохраняется и не публикуется, а второй трек в прослушивания авторов не засчитывается.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Pause, Search } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { apiTracks, apiLyrics, audioUrl, toClientTrack } from './musicApi';
import { parseTimedLyrics } from './lyrics';
import type { Track } from './types';

type Preset = 'full' | 'beat' | 'voice';
const PRESETS: Record<Preset, { hp: number; lp: number; label: string; hint: string }> = {
  full:  { hp: 20,  lp: 20000, label: 'Целиком', hint: 'Без фильтра' },
  beat:  { hp: 20,  lp: 220,   label: 'Бит',     hint: 'Низкие частоты: бас и бочка' },
  voice: { hp: 250, lp: 4500,  label: 'Голос',   hint: 'Полоса вокала, без баса' },
};
const card = { background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 22 } as const;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Deck { id: string; title: string; artist: string }
const Chips = ({ value, on, label }: { value: Preset; on: (p: Preset) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {(Object.keys(PRESETS) as Preset[]).map((k) => (
      <button key={k} type="button" role="radio" aria-checked={value === k} title={PRESETS[k].hint} onClick={() => on(k)}
        style={{ padding: '7px 14px', minHeight: 36, borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: '#fff', border: '1px solid rgba(255,255,255,.18)', background: value === k ? 'linear-gradient(135deg,#8b5cf6,#ec4899)' : 'rgba(255,255,255,.06)' }}>{PRESETS[k].label}</button>))}
  </div>
);

export const MixPanel = ({ a, onClose }: { a: Deck; onClose: () => void }) => {
  const [b, setB] = useState<Deck | null>(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [pb, setPb] = useState<Preset>('voice');
  const [bal, setBal] = useState(50);                 // 0 — только A, 100 — только B
  const [rate, setRate] = useState(1);
  const [textOf, setTextOf] = useState<'a' | 'b'>('a');
  const [tb, setTb] = useState(0);
  const [lines, setLines] = useState<{ t: number; text: string }[]>([]);
  const ta = usePlayerStore((s) => s.currentTime);
  const master = usePlayerStore((s) => s.volume);
  const audio = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ ctx: AudioContext; hp: BiquadFilterNode; lp: BiquadFilterNode; gain: GainNode } | null>(null);
  const origVol = useRef(master);

  // Поиск второго трека (без запроса — последние в каталоге).
  useEffect(() => {
    let alive = true; const h = setTimeout(() => { void apiTracks({ q: q.trim() || undefined, limit: 12 }).then((r) => { if (alive) setList((r ?? []).map(toClientTrack).filter((t) => t.id !== a.id)); }); }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(h); };
  }, [q, a.id]);

  // Движок второй деки: свой <audio> и цепочка фильтров. Создаётся при выборе трека.
  const ensure = useCallback(() => {
    if (graph.current && audio.current) return graph.current;
    const el = new Audio(); el.crossOrigin = 'anonymous'; el.preload = 'auto'; audio.current = el;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaElementSource(el);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    const gain = ctx.createGain();
    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    el.addEventListener('timeupdate', () => setTb(el.currentTime));
    el.addEventListener('ended', () => setPlaying(false));
    graph.current = { ctx, hp, lp, gain };
    return graph.current;
  }, []);

  useEffect(() => () => { audio.current?.pause(); void graph.current?.ctx.close().catch(() => {}); usePlayerStore.getState().setVolume(origVol.current); }, []);

  const pick = (t: Track) => {
    const g = ensure(); const el = audio.current!;
    setB({ id: t.id, title: t.title, artist: t.artist });
    el.src = audioUrl(t.id); el.load(); setPlaying(false); setTb(0);
    void g.ctx.resume().catch(() => {});
  };
  const toggleB = async () => {
    const g = graph.current; const el = audio.current; if (!g || !el || !b) return;
    await g.ctx.resume().catch(() => {});
    if (el.paused) { await el.play().catch(() => {}); setPlaying(!el.paused); } else { el.pause(); setPlaying(false); }
  };
  // «Стартовать вместе»: обе деки с начала.
  const together = async () => {
    const g = graph.current; const el = audio.current; if (!g || !el || !b) return;
    await g.ctx.resume().catch(() => {});
    el.currentTime = 0; usePlayerStore.setState({ seekTo: 0, cmdPlay: true });
    await el.play().catch(() => {}); setPlaying(!el.paused);
  };

  // Применение настроек: фильтры, темп, баланс (A — громкость общего плеера, B — усиление своей цепочки).
  useEffect(() => { const g = graph.current; if (!g) return; const p = PRESETS[pb]; g.hp.frequency.value = p.hp; g.lp.frequency.value = p.lp; }, [pb, b]);
  useEffect(() => { if (audio.current) { audio.current.playbackRate = rate; (audio.current as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true; } }, [rate, b]);
  useEffect(() => {
    const x = bal / 100; const gA = Math.cos(x * Math.PI / 2); const gB = Math.sin(x * Math.PI / 2);   // равномерная по мощности кривая
    usePlayerStore.getState().setVolume(Math.min(1, origVol.current * gA * 1.41));
    if (graph.current) graph.current.gain.gain.value = Math.min(1.4, gB * 1.41 * origVol.current / 0.85);
  }, [bal, b]);

  // Текст выбранной деки.
  const textId = textOf === 'a' ? a.id : b?.id;
  useEffect(() => {
    let alive = true; setLines([]);
    if (textId) void apiLyrics(textId).then((r) => { if (alive && r?.lyrics) setLines(parseTimedLyrics(r.lyrics)); });
    return () => { alive = false; };
  }, [textId]);
  const now = textOf === 'a' ? ta : tb;
  const timed = lines.some((l) => l.t > 0);
  const cur = useMemo(() => { if (!timed) return -1; let i = -1; for (let k = 0; k < lines.length; k++) if (lines[k].t <= now + 0.2) i = k; return i; }, [lines, now, timed]);

  return (
    <div role="dialog" aria-label="Микс" data-keep-dark style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(7,7,12,.92)', backdropFilter: 'blur(18px)', color: '#fff', overflowY: 'auto', padding: 'max(18px, env(safe-area-inset-top)) 18px 28px', fontFamily: "'Manrope','Nunito',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <p style={{ flex: 1, margin: 0, fontSize: 22, fontWeight: 900 }}>Микс</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} style={{ width: 44, height: 44, borderRadius: 22, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,.62)', lineHeight: 1.5 }}>Второй трек играет поверх текущего. Бит и голос здесь — это частотные фильтры, а не разделение песни на дорожки. Микс звучит только у вас и нигде не сохраняется.</p>

        <div style={{ ...card, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.6)' }}>ДЕКА A · СЕЙЧАС ИГРАЕТ (БЕЗ ФИЛЬТРА)</p>
          <p translate="no" style={{ margin: '4px 0 8px', fontSize: 16, fontWeight: 800 }}>{a.title} <span style={{ fontWeight: 600, color: 'rgba(255,255,255,.65)' }}>· {a.artist}</span></p>
        </div>

        <div style={{ ...card, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.6)' }}>ДЕКА B · НАКЛАДЫВАЕМЫЙ ТРЕК</p>
          {b ? <p translate="no" style={{ margin: '4px 0 8px', fontSize: 16, fontWeight: 800 }}>{b.title} <span style={{ fontWeight: 600, color: 'rgba(255,255,255,.65)' }}>· {b.artist}</span></p> : <p style={{ margin: '6px 0 8px', fontSize: 13, color: 'rgba(255,255,255,.6)' }}>Выберите трек из списка ниже.</p>}
          <Chips value={pb} on={setPb} label="Фильтр деки B" />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" disabled={!b} onClick={() => void toggleB()} style={{ minHeight: 40, padding: '0 16px', borderRadius: 999, border: 0, fontWeight: 800, fontSize: 14, cursor: 'pointer', color: '#0A0A10', background: '#fff', opacity: b ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 6 }}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'Пауза' : 'Играть B'}</button>
            <button type="button" disabled={!b} onClick={() => void together()} style={{ minHeight: 40, padding: '0 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,.2)', fontWeight: 800, fontSize: 14, cursor: 'pointer', color: '#fff', background: 'rgba(255,255,255,.08)', opacity: b ? 1 : 0.4 }}>Стартовать вместе</button>
            <span style={{ alignSelf: 'center', fontSize: 12.5, color: 'rgba(255,255,255,.6)' }}>{b ? fmt(tb) : ''}</span>
          </div>
        </div>

        <div style={{ ...card, padding: 14, display: 'grid', gap: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Баланс: A ←→ B<input type="range" min={0} max={100} value={bal} onChange={(e) => setBal(Number(e.target.value))} aria-label="Баланс дек" style={{ width: '100%', accentColor: '#a78bfa', display: 'block', marginTop: 6 }} /></label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Темп деки B: ×{rate.toFixed(2)}<input type="range" min={0.75} max={1.35} step={0.01} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Темп деки B" style={{ width: '100%', accentColor: '#a78bfa', display: 'block', marginTop: 6 }} />
            <span style={{ fontWeight: 500, fontSize: 11.5, color: 'rgba(255,255,255,.55)' }}>Темп подбирается на слух: автоматического определения BPM нет.</span></label>
        </div>

        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <p style={{ flex: 1, margin: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.6)' }}>ТЕКСТ</p>
            {(['a', 'b'] as const).map((k) => <button key={k} type="button" aria-pressed={textOf === k} disabled={k === 'b' && !b} onClick={() => setTextOf(k)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', color: '#fff', border: '1px solid rgba(255,255,255,.18)', background: textOf === k ? 'linear-gradient(135deg,#8b5cf6,#ec4899)' : 'rgba(255,255,255,.06)', opacity: k === 'b' && !b ? 0.4 : 1 }}>Дека {k.toUpperCase()}</button>)}
          </div>
          {lines.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.55)' }}>Текст для этого трека не добавлен.</p> : timed
            ? <div style={{ textAlign: 'center' }}>{[cur - 1, cur, cur + 1].map((i) => lines[i] && <p key={i} translate="no" style={{ margin: '6px 0', fontSize: i === cur ? 22 : 15, fontWeight: i === cur ? 900 : 600, color: i === cur ? '#fff' : 'rgba(255,255,255,.5)' }}>{lines[i].text}</p>)}{cur < 0 && <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 13 }}>…</p>}</div>
            : <div translate="no" style={{ maxHeight: 180, overflowY: 'auto', fontSize: 14.5, lineHeight: 1.6, color: 'rgba(255,255,255,.85)' }}>{lines.map((l, i) => <p key={i} style={{ margin: '2px 0' }}>{l.text}</p>)}</div>}
        </div>

        <div style={{ ...card, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, background: 'rgba(255,255,255,.06)', borderRadius: 999, padding: '0 14px' }}>
            <Search size={16} color="rgba(255,255,255,.6)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти трек для деки B" aria-label="Поиск трека" style={{ flex: 1, minWidth: 0, height: 42, background: 'transparent', border: 0, outline: 0, color: '#fff', fontSize: 14.5 }} />
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {list.map((t) => <button key={t.id} type="button" onClick={() => pick(t)} style={{ textAlign: 'left', padding: '9px 12px', borderRadius: 14, border: 0, cursor: 'pointer', color: '#fff', background: b?.id === t.id ? 'rgba(139,92,246,.3)' : 'transparent' }}>
              <span translate="no" style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{t.title}</span><span translate="no" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{t.artist}</span></button>)}
            {list.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.55)' }}>Ничего не найдено.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
