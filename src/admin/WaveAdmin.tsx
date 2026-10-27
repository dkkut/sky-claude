import React, { useCallback, useEffect, useState } from 'react';
import { apiWaveAdmin, apiWaveAdminSave } from '@/mediahome/api';

const SHELVES: [string, string][] = [['for_you', 'Для тебя'], ['continue', 'Продолжить'], ['my_music', 'Твоя музыка'], ['new', 'Новое в Sky'], ['trending', 'В тренде'], ['similar', 'Похожие на любимые'], ['discover', 'Открой новое'], ['evening', 'На вечер'], ['short', 'Короткий перерыв'], ['collection', 'Твоя коллекция'], ['recent', 'Недавно добавлено'], ['return', 'Вернись к этому']];

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
    </section>
  );
};
