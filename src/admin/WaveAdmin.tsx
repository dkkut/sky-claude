import React, { useCallback, useEffect, useState } from 'react';
import { apiWaveAdmin, apiWaveAdminSave } from '@/mediahome/api';
import { apiTracks } from '@/music/musicApi';

const SHELVES: [string, string][] = [['for_you', 'Для тебя'], ['continue', 'Продолжить'], ['my_music', 'Твоя музыка'], ['new', 'Новое в Sky'], ['trending', 'В тренде'], ['similar', 'Похожие на любимые'], ['discover', 'Открой новое'], ['evening', 'На вечер'], ['short', 'Короткий перерыв'], ['collection', 'Твоя коллекция'], ['recent', 'Недавно добавлено'], ['return', 'Вернись к этому'], ['together', 'Вместе интереснее']];

/** Админка SkyWave: доступность подборок и диагностика (счётчики без личных данных). Право `content`. */
export const WaveAdmin = () => {
  const [d, setD] = useState<Awaited<ReturnType<typeof apiWaveAdmin>>>(null);
  const [err, setErr] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await apiWaveAdmin(); setErr(!r); setD(r); }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (id: string) => {
    if (!d) return; setBusy(true);
    const off = d.config.disabled.includes(id) ? d.config.disabled.filter((x) => x !== id) : [...d.config.disabled, id];
    await apiWaveAdminSave({ disabled: off }); await load(); setBusy(false);
  };
  if (err) return <p className="text-[12px]" style={{ color: 'var(--t3)' }}>SkyWave: не удалось загрузить. <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p>;
  if (!d) return <p className="text-[12px]" style={{ color: 'var(--t3)' }}>SkyWave: загрузка…</p>;
  return (
    <section className="mt-6 rounded-2xl border p-4" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-1 text-[15px] font-bold" style={{ color: 'var(--t1)' }}>SkyWave: подборки</h3>
      <p className="mb-3 text-[12px]" style={{ color: 'var(--t3)' }}>Отключённая подборка не показывается никому. Статистика — за {d.diagnostics.days} дн., только счётчики.</p>
      <table className="w-full text-left text-[12px]" style={{ color: 'var(--t2)' }}>
        <thead><tr><th>Подборка</th><th>Собрана</th><th>Пусто</th><th>Ошибки</th><th>Среднее, мс</th><th>Показ</th></tr></thead>
        <tbody>{SHELVES.map(([id, name]) => { const s = d.diagnostics.shelves.find((x) => x.shelf === id);
          return <tr key={id}><td>{name}</td><td>{s?.built ?? 0}</td><td>{s?.empty ?? 0}</td><td style={s?.errors ? { color: '#f87171' } : undefined}>{s?.errors ?? 0}</td><td>{s?.avg_ms ?? 0}</td>
            <td><input type="checkbox" disabled={busy} checked={!d.config.disabled.includes(id)} onChange={() => void toggle(id)} aria-label={`Показывать: ${name}`} /></td></tr>; })}</tbody>
      </table>
      <Editorial list={(d.config.editorial ?? []) as Ed[]} onSave={async (e) => { setBusy(true); await apiWaveAdminSave({ editorial: e }); await load(); setBusy(false); }} busy={busy} />
    </section>
  );
};

interface Ed { id?: string; title: string; items: { kind: 'music'; id: string; title: string; sub: string }[] }

/** Редакционные подборки (до 3 показываются всем с пометкой «Редакция Sky»). Пока — только музыка: поиск по каталогу. */
const Editorial = ({ list, onSave, busy }: { list: Ed[]; onSave: (e: Ed[]) => Promise<void>; busy: boolean }) => {
  const [title, setTitle] = useState(''); const [q, setQ] = useState(''); const [found, setFound] = useState<{ id: string; title: string; artist: string }[]>([]);
  const [items, setItems] = useState<Ed['items']>([]);
  const search = async () => { const r = await apiTracks({ q, limit: 10 }); setFound((r ?? []).map((t) => ({ id: t.id, title: t.title, artist: t.artist }))); };
  const inp = 'rounded-lg border bg-transparent px-2 py-1 text-[12px]'; const st = { borderColor: 'var(--border)', color: 'var(--t1)' } as const;
  return (
    <div className="mt-5">
      <h4 className="mb-2 text-[13px] font-bold" style={{ color: 'var(--t1)' }}>Редакционные подборки</h4>
      {list.map((e, i) => <div key={i} className="mb-1 flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}><span className="flex-1 truncate" translate="no">{e.title} · {e.items.length}</span><button type="button" disabled={busy} className="underline" onClick={() => void onSave(list.filter((_, j) => j !== i))}>Удалить</button></div>)}
      {list.length === 0 && <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Пока нет.</p>}
      <div className="mt-2 grid gap-2">
        <input className={inp} style={st} maxLength={60} placeholder="Название подборки" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex gap-2"><input className={`${inp} flex-1`} style={st} placeholder="Найти трек" value={q} onChange={(e) => setQ(e.target.value)} /><button type="button" className="underline text-[12px]" onClick={() => void search()}>Искать</button></div>
        {found.map((t) => <button key={t.id} type="button" className="truncate text-left text-[12px]" style={{ color: 'var(--t1)' }} translate="no" onClick={() => setItems((x) => (x.length < 12 && !x.some((y) => y.id === t.id) ? [...x, { kind: 'music', id: t.id, title: t.title, sub: t.artist }] : x))}>+ {t.title} · {t.artist}</button>)}
        {items.length > 0 && <p className="text-[12px]" style={{ color: 'var(--t2)' }} translate="no">В подборке: {items.map((i) => i.title).join(', ')}</p>}
        <button type="button" disabled={busy || !title.trim() || !items.length || list.length >= 3} className="w-fit rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}
          onClick={async () => { await onSave([...list, { id: `ed${Date.now()}`, title: title.trim(), items }]); setTitle(''); setItems([]); setFound([]); }}>Добавить подборку</button>
      </div>
    </div>
  );
};
