/** Метки контента: «E» (Explicit), «Старая версия», окно «Сведения о материале» (источник; правка владельцем и модератором). Сервер: server/contentlabels.mjs. */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Info, X } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

export type LabelKind = 'track' | 'movie' | 'book';

interface Texts { legacyText: string; explicitText: string; legacyEnabled: boolean }
const useTexts = create<{ t: Texts | null; load: () => void }>((set, get) => ({
  t: null,
  load: () => {
    if (get().t) return;
    void apiCall<Texts>('/api/labels/settings').then((r) => { if (r.ok && r.data) set({ t: r.data }); });
  },
}));
export const useLabelTexts = () => { const t = useTexts((s) => s.t); useEffect(() => useTexts.getState().load(), []); return t; };

/** Квадратик «E». Рисуется, только если сервер вернул explicit. */
export const ExplicitBadge = ({ show, size = 14 }: { show?: boolean; size?: number }) => {
  const t = useLabelTexts();
  if (!show) return null;
  return (
    <span role="img" aria-label="Explicit" title={t?.explicitText ?? 'Explicit'} data-explicit
      className="ml-1 inline-grid shrink-0 place-items-center rounded-[3px] align-middle font-black leading-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.68), background: 'var(--t3)', color: 'var(--bg)' }}>E</span>
  );
};

/** Подпись «Старая версия — до вступления в силу законодательства о цензуре» (текст настраивает администрация). */
export const LegacyChip = ({ show }: { show?: boolean }) => {
  const t = useLabelTexts();
  if (!show || !t || !t.legacyEnabled) return null;
  return <span data-legacy-label className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--amber, #f59e0b)' }}>{t.legacyText}</span>;
};

interface Labels {
  explicit: boolean; explicitBy: 'author' | 'moderator'; legacy: boolean; legacyText: string; explicitText: string;
  source: { addedBy?: string; addedAt?: string; source?: string; author?: string; rightsholder?: string; license?: string };
  canEditOwn: boolean; canModerate: boolean;
  history?: { field: string; from: string | null; to: string | null; reason?: string; by: string; actor?: string; at: string }[];
}
const FIELD: Record<string, string> = { explicit: 'Explicit (автор)', mod_explicit: 'Explicit (решение модератора)', legacy: 'Старая версия', source: 'Источник', rightsholder: 'Правообладатель' };
const LICENSE: Record<string, string> = { own: 'Собственное произведение', cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA', 'cc-by-nc': 'CC BY-NC', 'cc-by-nd': 'CC BY-ND', 'cc-by-nc-sa': 'CC BY-NC-SA', 'cc-by-nc-nd': 'CC BY-NC-ND', 'public-domain': 'Общественное достояние', open: 'Открытая', personal: 'Личная' };
const box = { background: 'var(--bg-l1)', border: '1px solid var(--border)' };
const field = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };

const Row = ({ k, v }: { k: string; v?: string }) => (v ? <div className="flex justify-between gap-3 text-[12.5px]"><span style={{ color: 'var(--t3)' }}>{k}</span><span className="text-right" style={{ color: 'var(--t1)' }} translate="no">{v}</span></div> : null);

/** Кнопка «ⓘ» и окно со сведениями. */
export const LabelsButton = ({ kind, id, size = 16 }: { kind: LabelKind; id: string; size?: number }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Сведения о материале" title="Сведения о материале" onClick={(e) => { e.stopPropagation(); setOpen(true); }} style={{ color: 'var(--t3)' }}><Info size={size} /></button>
      {open && <LabelsSheet kind={kind} id={id} onClose={() => setOpen(false)} />}
    </>
  );
};

export const LabelsSheet = ({ kind, id, onClose }: { kind: LabelKind; id: string; onClose: () => void }) => {
  const [d, setD] = useState<Labels | null>(null);
  const [missing, setMissing] = useState(false);
  const [f, setF] = useState({ explicit: false, sourceNote: '', rightsholder: '' });
  const [m, setM] = useState({ explicit: 'keep' as 'keep' | 'true' | 'false' | 'clear', legacy: 'keep' as 'keep' | 'on' | 'off', reason: '' });
  const load = () => apiCall<Labels>(`/api/labels/${kind}/${encodeURIComponent(id)}`).then((r) => {
    if (!r.ok || !r.data) { setMissing(true); return; }
    setD(r.data); setF({ explicit: r.data.explicit && r.data.explicitBy === 'author', sourceNote: r.data.source.source ?? '', rightsholder: r.data.source.rightsholder ?? '' });
  });
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind, id]);

  const saveOwn = async () => {
    const r = await apiCall(`/api/labels/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(f) });
    flash(r.ok ? 'Сохранено' : 'Не получилось сохранить'); if (r.ok) void load();
  };
  const saveMod = async () => {
    const body: Record<string, unknown> = { reason: m.reason, sourceNote: f.sourceNote, rightsholder: f.rightsholder };
    if (m.explicit !== 'keep') body.explicit = m.explicit === 'clear' ? null : m.explicit === 'true';
    if (m.legacy !== 'keep') body.legacy = m.legacy === 'on';
    const r = await apiCall(`/api/labels/${kind}/${encodeURIComponent(id)}/moderate`, { method: 'PUT', body: JSON.stringify(body) });
    flash(r.ok ? 'Сохранено' : r.error === 'reason_required' ? 'Укажите причину (не короче 5 знаков)' : 'Не получилось сохранить');
    if (r.ok) { setM({ explicit: 'keep', legacy: 'keep', reason: '' }); void load(); }
  };

  return (
    <div className="fixed inset-0 z-[120] grid place-items-end sm:place-items-center" style={{ background: 'rgba(0,0,0,0.6)' }} role="dialog" aria-modal="true" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={box} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><p className="text-base font-bold" style={{ color: 'var(--t1)' }}>Сведения о материале</p><button type="button" aria-label="Закрыть" onClick={onClose} style={{ color: 'var(--t3)' }}><X size={18} /></button></div>
        {missing && <p className="text-sm" style={{ color: 'var(--t2)' }}>Сведения недоступны.</p>}
        {!d && !missing && <p className="text-sm" style={{ color: 'var(--t3)' }}>Загрузка…</p>}
        {d && (<>
          <div className="flex flex-wrap items-center gap-2"><ExplicitBadge show={d.explicit} size={18} />{d.explicit && <span className="text-[12px]" style={{ color: 'var(--t2)' }}>{d.explicitText}{d.explicitBy === 'moderator' ? ' (решение модератора)' : ''}</span>}<LegacyChip show={d.legacy} /></div>
          <div className="space-y-1.5">
            <Row k="Добавил" v={d.source.addedBy} /><Row k="Дата" v={d.source.addedAt ? new Date(d.source.addedAt).toLocaleDateString() : undefined} />
            <Row k="Источник" v={d.source.source} /><Row k="Автор" v={d.source.author} /><Row k="Правообладатель" v={d.source.rightsholder} />
            <Row k="Лицензия" v={d.source.license ? LICENSE[d.source.license] ?? d.source.license : undefined} />
          </div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Сведения указывает загрузивший; Sky не сверяет их с реестрами. Пожаловаться на материал можно через Тех. поддержку.</p>
          {(d.canEditOwn || d.canModerate) && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l2)' }}>
              <p className="text-[12px] font-bold" style={{ color: 'var(--t1)' }}>{d.canModerate ? 'Правка (модератор)' : 'Ваши отметки'}</p>
              {d.canEditOwn && !d.canModerate && <label className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} />Содержит ненормативную лексику / 18+ (Explicit)</label>}
              <input value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} placeholder="Источник (откуда материал)" className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Источник" />
              <input value={f.rightsholder} onChange={(e) => setF({ ...f, rightsholder: e.target.value })} placeholder="Правообладатель" className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Правообладатель" />
              {d.canModerate ? (<>
                <label className="block text-[12px]" style={{ color: 'var(--t2)' }}>Explicit
                  <select value={m.explicit} onChange={(e) => setM({ ...m, explicit: e.target.value as typeof m.explicit })} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
                    <option value="keep">Не менять</option><option value="true">Поставить «E»</option><option value="false">Снять «E»</option><option value="clear">Убрать решение модератора (как у автора)</option>
                  </select></label>
                <label className="block text-[12px]" style={{ color: 'var(--t2)' }}>«Старая версия» (только по подтверждённым данным)
                  <select value={m.legacy} onChange={(e) => setM({ ...m, legacy: e.target.value as typeof m.legacy })} className="mt-1 w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
                    <option value="keep">Не менять</option><option value="on">Поставить</option><option value="off">Снять</option>
                  </select></label>
                <input value={m.reason} onChange={(e) => setM({ ...m, reason: e.target.value })} placeholder="Причина (обязательна)" className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label="Причина" />
                <button type="button" onClick={() => void saveMod()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>Сохранить</button>
              </>) : <button type="button" onClick={() => void saveOwn()} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>Сохранить</button>}
              {d.history && d.history.length > 0 && (
                <ul className="space-y-0.5 text-[11px]" style={{ color: 'var(--t3)' }}>{d.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleDateString()} · {FIELD[h.field] ?? h.field}: {h.from ?? '—'} → {h.to ?? '—'}{h.reason ? ` · ${h.reason}` : ''}{h.actor ? ` (${h.actor})` : ''}</li>)}</ul>
              )}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
};
