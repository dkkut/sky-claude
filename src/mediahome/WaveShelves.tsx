import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Play, Eye, EyeOff } from 'lucide-react';
import { apiWave, apiWaveFeedback, apiWaveClear, apiWavePrefs, apiWaveWhy, type Shelf, type WaveItem, type WaveState } from './api';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import { useModuleStore } from '@/data/state/modules';
import { visibleTick } from '@/shared/visibleTick';

const KIND_LABEL: Record<string, string> = { music: 'Музыка', film: 'Кино', video: 'Видео', podcast: 'Подкаст', book: 'Книга' };
const KIND_TAB: Record<string, string> = { music: 'music', film: 'movies', podcast: 'podcasts', book: 'books' };

/** Открыть элемент подборки: трек играет сразу (если он есть в загруженном каталоге), остальное — раздел сервиса. */
export const useOpenWaveItem = (onNav: (tab: string) => void) => {
  const { tracks } = useMusicStore();
  const setActiveModule = useModuleStore((s) => s.setActiveModule);
  return useCallback((it: WaveItem) => {
    if (it.kind === 'music') {
      const pool = tracks as unknown as Parameters<typeof playMusicQueue>[0];
      if (pool.some((p) => p.id === it.id)) { playMusicQueue(pool, it.id); return; }
    }
    if (it.kind === 'video') { setActiveModule('video'); return; }
    onNav(KIND_TAB[it.kind] ?? 'home');
  }, [tracks, onNav, setActiveModule]);
};

const ItemMenu = ({ shelf, it, onDone, onNav }: { shelf: string; it: WaveItem; onDone: () => void; onNav?: () => void }) => {
  const [why, setWhy] = useState<string | null>(null);
  const send = async (signal: 'more' | 'less' | 'hide' | 'mute_author') => { await apiWaveFeedback({ kind: it.kind, itemId: it.id, signal, authorKey: it.authorKey }); onDone(); };
  const btn = 'block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/10';
  void onNav;
  return (
    <div role="menu" className="absolute right-0 top-8 z-30 w-60 rounded-2xl border p-1.5 shadow-xl" style={{ background: 'var(--bg-l2, #14141c)', borderColor: 'var(--border)', color: 'var(--t1)' }}>
      <button type="button" className={btn} onClick={() => void send('more')}>Больше такого</button>
      <button type="button" className={btn} onClick={() => void send('less')}>Меньше такого</button>
      <button type="button" className={btn} onClick={() => void send('hide')}>Не интересно</button>
      {it.authorKey && <button type="button" className={btn} onClick={() => void send('mute_author')}>Не рекомендовать автора</button>}
      <button type="button" className={btn} onClick={async () => { const w = await apiWaveWhy(shelf, it.kind, it.id); setWhy(w ? (w.reason || (w.fallback ? 'Недостаточно данных о ваших интересах — это популярное.' : 'Подборка собрана по вашей истории.')) : 'Не удалось определить причину.'); }}>Почему я это вижу?</button>
      {why && <p className="px-3 py-2 text-[12px]" style={{ color: 'var(--t2)' }}>{why}</p>}
    </div>
  );
};

const Card = ({ shelf, it, open, reload }: { shelf: string; it: WaveItem; open: (i: WaveItem) => void; reload: () => void }) => {
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative w-40 shrink-0 rounded-[20px] border-[0.5px] p-3.5" style={{ borderColor: 'var(--border)', background: 'var(--glass-bg, rgba(255,255,255,.04))' }}>
      <button type="button" onClick={() => open(it)} className="block w-full text-left">
        <div className="mb-2 grid h-20 place-items-center rounded-xl" style={{ background: 'var(--accent-bg, rgba(99,102,241,.15))' }}>
          <Play size={20} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{it.title}</div>
        <div className="truncate text-[11px]" style={{ color: 'var(--t3)' }}><span>{KIND_LABEL[it.kind]}</span>{it.sub ? <span translate="no"> · {it.sub}</span> : null}</div>
        {typeof it.progress === 'number' && <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.round(it.progress * 100)}%`, background: 'var(--accent)' }} /></div>}
      </button>
      <button type="button" aria-label="Ещё" onClick={() => setMenu((v) => !v)} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/30" style={{ color: '#fff' }}><MoreHorizontal size={14} /></button>
      {menu && <ItemMenu shelf={shelf} it={it} onDone={() => { setMenu(false); reload(); }} />}
    </div>
  );
};

/** Ряд подборок SkyWave. `only` — одна подборка (виджет), иначе все. */
export const WaveShelves = ({ onNav, only, manage }: { onNav: (tab: string) => void; only?: string; manage?: boolean }) => {
  const [w, setW] = useState<WaveState | null>(null);
  const [err, setErr] = useState(false);
  const open = useOpenWaveItem(onNav);
  const alive = useRef(true);
  const load = useCallback(async () => { const r = await apiWave(only); if (!alive.current) return; setErr(!r); if (r) setW(r); }, [only]);
  useEffect(() => { alive.current = true; void load(); const t = window.setInterval(visibleTick(() => void load()), 120000); return () => { alive.current = false; window.clearInterval(t); }; }, [load]);

  if (err && !w) return <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Не удалось загрузить подборки. <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p>;
  if (!w) return <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Загрузка подборок…</p>;
  const shown = w.shelves.filter((s) => only || !w.hidden.includes(s.id));
  const hiddenShelves = w.shelves.filter((s) => w.hidden.includes(s.id));
  const toggleHide = async (id: string) => { const hidden = w.hidden.includes(id) ? w.hidden.filter((x) => x !== id) : [...w.hidden, id]; await apiWavePrefs({ hidden }); void load(); };
  const move = async (id: string, dir: -1 | 1) => { const ids = w.shelves.map((s) => s.id); const i = ids.indexOf(id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await apiWavePrefs({ order: ids }); void load(); };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!w.prime && <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Музыка, кино, подкасты и книги входят в Sky Prime — без подписки в подборках только Sky Video.</p>}
      {shown.length === 0 && <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Пока нечего показать: подборки появятся, когда в Sky будет что рекомендовать.</p>}
      {[...w.editorial, ...shown].map((s: Shelf) => (
        <section key={s.id} aria-label={s.title}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[17px] font-semibold" style={{ color: 'var(--t1)', letterSpacing: '-0.02em' }}>{s.title}</h3>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--accent-bg, rgba(99,102,241,.15))', color: 'var(--t2)' }}>
              {s.editorial ? 'Редакция Sky' : s.personal ? 'Персонально' : s.fallback ? 'Популярное' : 'Общая подборка'}
            </span>
            {manage && !s.editorial && (<>
              <button type="button" aria-label="Выше" onClick={() => void move(s.id, -1)} className="text-[12px]" style={{ color: 'var(--t3)' }}>↑</button>
              <button type="button" aria-label="Ниже" onClick={() => void move(s.id, 1)} className="text-[12px]" style={{ color: 'var(--t3)' }}>↓</button>
            </>)}
            {!only && !s.editorial && <button type="button" aria-label="Скрыть подборку" title="Скрыть подборку" onClick={() => void toggleHide(s.id)} style={{ color: 'var(--t3)' }}><EyeOff size={14} /></button>}
          </div>
          {s.reason && <p className="mb-2 text-[11px]" style={{ color: 'var(--t3)' }}>{s.reason}</p>}
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {s.items.map((it) => <Card key={`${it.kind}:${it.id}`} shelf={s.id} it={it} open={open} reload={() => void load()} />)}
          </div>
        </section>
      ))}
      {!only && manage && hiddenShelves.length > 0 && <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Скрытые подборки: {hiddenShelves.map((s) => <button key={s.id} type="button" className="mr-2 underline" onClick={() => void toggleHide(s.id)}><Eye size={11} className="inline" /> {s.title}</button>)}</p>}
      {!only && manage && (
        <div className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>
          <label className="flex items-center gap-2"><input type="checkbox" checked={w.personalize} onChange={async (e) => { await apiWavePrefs({ personalize: e.target.checked }); void load(); }} /> Учитывать мою историю</label>
          <button type="button" className="underline" onClick={async () => { if (window.confirm('Очистить историю рекомендаций (оценки «больше/меньше/не интересно»)?')) { await apiWaveClear(); void load(); } }}>Очистить историю рекомендаций</button>
        </div>
      )}
    </div>
  );
};
