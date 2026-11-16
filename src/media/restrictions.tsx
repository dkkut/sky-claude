/**
 * Sky Media: баннер ограничения (облачко с табличкой), панель автора «Ограничения и апелляции» и проверка статуса работы.
 * Решает сервер (server/mediarestrict.mjs); здесь только показ и подача апелляции.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { SkyCloud } from '@/os/SkyCloud';

export const DIR_LABEL: Record<string, string> = { music: 'Музыка', film: 'Кино', books: 'Книги', podcasts: 'Подкасты' };
export interface PublicRestriction { id: number; scope: 'work' | 'author_direction'; direction: string; note?: string | null }

/** Баннер: облачко с табличкой и текст. Основание людям не показывается — только короткая заметка, если её задала администрация. */
export const BlockedBanner = ({ r, compact = false }: { r: Pick<PublicRestriction, 'scope' | 'direction' | 'note'>; compact?: boolean }) => (
  <div role="status" className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
    <SkyCloud state="blocked" size={compact ? 52 : 72} />
    <div className="min-w-0 flex-1">
      <p className="text-[13px] font-black" style={{ color: 'var(--t1)' }}>{r.scope === 'work' ? 'Доступ к этому произведению ограничен' : `Доступ к направлению «${DIR_LABEL[r.direction] ?? r.direction}» ограничен`}</p>
      {r.note && <p className="mt-0.5 text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{r.note}</p>}
      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--t3)' }}>Избранное, плейлисты и история сохранены — они вернутся, когда ограничение будет снято.</p>
    </div>
  </div>
);

/** Спросить сервер, закрыта ли работа (для плееров после ошибки загрузки). */
export const checkBlocked = async (direction: string, id: string, kind = 'work'): Promise<PublicRestriction | null> => {
  const r = await apiCall<{ blocked: boolean; restriction: PublicRestriction | null }>(`/api/media-restrictions/status?direction=${direction}&id=${encodeURIComponent(id)}&kind=${kind}`);
  return r.ok && r.data?.blocked ? r.data.restriction : null;
};

interface Mine { id: number; scope: string; direction: string; targetId: string; basis: string; ref?: string | null; note?: string | null; status: string; since: string;
  appeals: { id: number; status: string; body: string; note?: string | null; at: string }[] }
const ERR: Record<string, string> = { too_short: 'Опишите причину подробнее (от 20 знаков).', appeal_open: 'Апелляция уже на рассмотрении.', appeal_limit: 'Достигнут предел апелляций по этому ограничению.', not_active: 'Ограничение уже снято.', not_found: 'Не найдено.' };
const AP: Record<string, string> = { open: 'на рассмотрении', accepted: 'принята', rejected: 'отклонена' };

/** Для автора: свои ограничения и апелляции. Пусто — панель не показывается. */
export const MyRestrictionsPanel = () => {
  const [rows, setRows] = useState<Mine[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(() => apiCall<{ restrictions: Mine[] }>('/api/media-restrictions/mine').then((r) => setRows(r.ok ? r.data!.restrictions : [])), []);
  useEffect(() => { void load(); }, [load]);
  if (!rows?.length) return null;
  const send = async (id: number) => {
    const r = await apiCall(`/api/media-restrictions/${id}/appeal`, { method: 'POST', body: JSON.stringify({ body: text }) });
    if (!r.ok) return flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? 'ошибка'})`);
    flash('Апелляция отправлена'); setOpen(null); setText(''); void load();
  };
  return (
    <div className="mb-4 space-y-2 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Ограничения и апелляции</p>
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl p-2.5 text-xs" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
          <p className="font-bold" style={{ color: 'var(--t1)' }}>{r.scope === 'work' ? 'Произведение' : 'Направление'} · {DIR_LABEL[r.direction] ?? r.direction} · {r.status === 'active' ? 'действует' : 'снято'}</p>
          <p className="mt-0.5" translate="no">Основание: {r.basis}{r.ref ? ` (${r.ref})` : ''}</p>
          {r.appeals.map((a) => <p key={a.id} className="mt-0.5" style={{ color: 'var(--t3)' }}>Апелляция: {AP[a.status] ?? a.status}{a.note ? ` — ${a.note}` : ''}</p>)}
          {r.status === 'active' && !r.appeals.some((a) => a.status === 'open') && (open === r.id ? (
            <div className="mt-1.5 space-y-1.5">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Почему ограничение нужно снять (документы, права, обстоятельства)" aria-label="Текст апелляции" className="w-full resize-none rounded-lg px-2 py-1.5 text-sm" style={{ background: 'var(--bg-l1)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
              <div className="flex gap-2"><button type="button" onClick={() => void send(r.id)} className="min-h-[36px] rounded-lg px-3 font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Отправить</button>
                <button type="button" onClick={() => setOpen(null)} className="rounded-lg px-3" style={{ color: 'var(--t2)' }}>Отмена</button></div>
            </div>) : <button type="button" onClick={() => { setOpen(r.id); setText(''); }} className="mt-1.5 font-bold underline" style={{ color: 'var(--accent)' }}>Оспорить</button>)}
        </div>))}
    </div>
  );
};

/** Пометки «недоступен» в списках треков: id собираются пачкой (до 100 за запрос, раз в 200 мс) и спрашиваются у сервера один раз. */
const blockedSet = new Set<string>(); const asked = new Set<string>(); const pending = new Set<string>(); const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
const flushBlocked = async () => {
  timer = null; const ids = [...pending].slice(0, 100); ids.forEach((i) => pending.delete(i));
  if (ids.length) {
    const r = await apiCall<{ ids: string[] }>(`/api/media-restrictions/blocked-music?ids=${encodeURIComponent(ids.join(','))}`);
    if (r.ok) { r.data?.ids.forEach((i) => blockedSet.add(i)); subs.forEach((f) => f()); }
  }
  if (pending.size) timer = setTimeout(() => { void flushBlocked(); }, 200);
};
export const useTrackBlocked = (id: string): boolean => {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1); subs.add(f);
    if (!asked.has(id)) { asked.add(id); pending.add(id); if (!timer) timer = setTimeout(() => { void flushBlocked(); }, 200); }
    return () => { subs.delete(f); };
  }, [id]);
  return blockedSet.has(id);
};
