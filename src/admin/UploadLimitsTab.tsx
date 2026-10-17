/**
 * Вкладка «Лимиты загрузки»: личная коллекция и публикация настраиваются раздельно (кино и музыка).
 * Пустое поле = значение по умолчанию. Всё применяет сервер (server/uploadlimits.mjs), право `upload_limits`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Limit {
  scope: 'personal' | 'public'; kind: 'film' | 'music' | 'all';
  maxFileBytes: number; maxFiles: number; totalBytes: number; totalBytesPrime: number; formats: string[] | null;
  maxDurationSec: number; maxConcurrent: number; speedKbps: number; custom: boolean;
  defaults: { maxFileBytes: number; maxFiles: number; totalBytes: number; totalBytesPrime: number; maxDurationSec: number; maxConcurrent: number; speedKbps: number };
}
interface Overview { limits: Limit[]; formats: { film: string[]; music: string[] } }

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const MB = 1024 ** 2; const GB = 1024 ** 3;
const TITLE: Record<string, string> = { film: 'Кино', music: 'Музыка', all: 'Общий объём личного хранилища (кино и музыка вместе)' };

const Num = ({ label, value, onChange, unit, hint }: { label: string; value: string; onChange: (v: string) => void; unit: string; hint?: string }) => (
  <label className="block text-[12px]" style={{ color: C.t2 }}>
    {label}
    <span className="mt-1 flex items-center gap-1.5">
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none" style={field} aria-label={label} />
      <span className="shrink-0 text-[11px]" style={{ color: C.t3 }}>{unit}</span>
    </span>
    {hint && <span className="mt-0.5 block text-[10.5px]" style={{ color: C.t3 }}>{hint}</span>}
  </label>
);

const LimitCard = ({ l, allFormats, onSaved }: { l: Limit; allFormats: string[]; onSaved: () => void }) => {
  const isAll = l.kind === 'all';
  const [f, setF] = useState(() => ({
    maxFileMb: String(Math.round(l.maxFileBytes / MB)), maxFiles: String(l.maxFiles), maxDur: String(Math.round(l.maxDurationSec / 60)),
    conc: String(l.maxConcurrent), speed: String(l.speedKbps), totalGb: String(+(l.totalBytes / GB).toFixed(2)), totalPrimeGb: String(+(l.totalBytesPrime / GB).toFixed(2)),
    formats: l.formats ?? allFormats,
  }));
  const [busy, setBusy] = useState(false);
  const toggle = (x: string) => setF((p) => ({ ...p, formats: p.formats.includes(x) ? p.formats.filter((y) => y !== x) : [...p.formats, x] }));

  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = { scope: l.scope, kind: l.kind };
    if (isAll) { body.totalBytes = Math.round(Number(f.totalGb) * GB); body.totalBytesPrime = Math.round(Number(f.totalPrimeGb) * GB); }
    else {
      body.maxFileBytes = Math.max(1, Math.round(Number(f.maxFileMb) * MB)); body.maxFiles = Math.round(Number(f.maxFiles) || 0);
      body.maxDurationSec = Math.round((Number(f.maxDur) || 0) * 60); body.speedKbps = Math.round(Number(f.speed) || 0);
      if (l.scope === 'personal') body.maxConcurrent = Math.max(1, Math.round(Number(f.conc) || 1));
      body.formats = f.formats;
      if (l.scope === 'public') { body.totalBytes = Math.round(Number(f.totalGb) * GB); body.totalBytesPrime = Math.round(Number(f.totalPrimeGb) * GB); }
    }
    const r = await apiCall('/api/admin/upload-limits', { method: 'PUT', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { flash(r.reason ?? 'Не удалось сохранить'); return; }
    flash('Сохранено'); onSaved();
  };
  const reset = async () => {
    setBusy(true);
    const body: Record<string, unknown> = { scope: l.scope, kind: l.kind, maxFileBytes: null, maxFiles: null, totalBytes: null, totalBytesPrime: null, maxDurationSec: null, maxConcurrent: null, speedKbps: null, formats: null };
    await apiCall('/api/admin/upload-limits', { method: 'PUT', body: JSON.stringify(body) });
    setBusy(false); flash('Возвращены значения по умолчанию'); onSaved();
  };

  return (
    <section className="space-y-3 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }} data-limit={`${l.scope}:${l.kind}`}>
      <p className="text-sm font-bold" style={{ color: C.t1 }}>{TITLE[l.kind]}{l.custom && <span className="ml-2 text-[10px] font-semibold" style={{ color: C.acc }}>изменено</span>}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {isAll ? (<>
          <Num label="Обычный пользователь" value={f.totalGb} onChange={(v) => setF({ ...f, totalGb: v })} unit="ГБ" hint={`по умолчанию ${l.defaults.totalBytes / GB} ГБ`} />
          <Num label="С подпиской Prime" value={f.totalPrimeGb} onChange={(v) => setF({ ...f, totalPrimeGb: v })} unit="ГБ" hint={`по умолчанию ${l.defaults.totalBytesPrime / GB} ГБ`} />
        </>) : (<>
          <Num label="Размер одного файла" value={f.maxFileMb} onChange={(v) => setF({ ...f, maxFileMb: v })} unit="МБ" hint={`по умолчанию ${Math.round(l.defaults.maxFileBytes / MB)} МБ`} />
          <Num label={l.scope === 'personal' ? 'Файлов в личной коллекции (0 — без ограничения)' : 'Опубликованных файлов у человека (0 — без ограничения)'} value={f.maxFiles} onChange={(v) => setF({ ...f, maxFiles: v })} unit="шт." />
          <Num label="Максимальная длительность (0 — без ограничения)" value={f.maxDur} onChange={(v) => setF({ ...f, maxDur: v })} unit="мин" />
          <Num label="Скорость загрузки (0 — без ограничения)" value={f.speed} onChange={(v) => setF({ ...f, speed: v })} unit="кбит/с" />
          {l.scope === 'personal' && <Num label="Одновременных загрузок" value={f.conc} onChange={(v) => setF({ ...f, conc: v })} unit="шт." />}
          {l.scope === 'public' && (<>
            <Num label="Общий объём опубликованного, обычный (0 — без ограничения)" value={f.totalGb} onChange={(v) => setF({ ...f, totalGb: v })} unit="ГБ" />
            <Num label="Общий объём опубликованного, Prime" value={f.totalPrimeGb} onChange={(v) => setF({ ...f, totalPrimeGb: v })} unit="ГБ" />
          </>)}
        </>)}
      </div>
      {!isAll && (
        <div>
          <p className="mb-1 text-[12px]" style={{ color: C.t2 }}>Разрешённые форматы</p>
          <div className="flex flex-wrap gap-2">
            {allFormats.map((x) => (
              <button key={x} type="button" aria-pressed={f.formats.includes(x)} onClick={() => toggle(x)} className="rounded-full px-3 py-1 text-xs font-semibold"
                style={f.formats.includes(x) ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t3 }}>{x}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: C.acc }}><Save size={13} />Сохранить</button>
        <button type="button" disabled={busy || !l.custom} onClick={() => void reset()} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t2 }}><RotateCcw size={13} />По умолчанию</button>
      </div>
    </section>
  );
};

export const UploadLimitsTab = () => {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string>();
  const [scope, setScope] = useState<'personal' | 'public'>('personal');
  const [rev, setRev] = useState(0);
  const load = useCallback(async () => {
    const r = await apiCall<Overview>('/api/admin/upload-limits');
    if (!r.ok || !r.data) { setErr(r.error === 'not_allowed' ? 'Недостаточно прав.' : (r.reason ?? 'Не удалось загрузить')); return; }
    setErr(undefined); setOv(r.data); setRev((x) => x + 1);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (err) return <p className="text-sm" style={{ color: C.red }}>{err}</p>;
  if (!ov) return <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;
  return (
    <div className="space-y-4">
      <p className="text-[12.5px]" style={{ color: C.t2 }}>
        Личная загрузка (закрытая коллекция) и публикация в общий каталог настраиваются отдельно. Личные лимиты проверяются при загрузке файла, публичные — когда человек отправляет файл на проверку. Изменения применяются сразу (в течение 15 секунд) и пишутся в журнал администрации.
      </p>
      <div className="flex gap-2">
        {(['personal', 'public'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setScope(s)} className="rounded-xl px-4 py-2 text-xs font-bold"
            style={scope === s ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t2 }}>{s === 'personal' ? 'Личная загрузка' : 'Публикация'}</button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {ov.limits.filter((l) => l.scope === scope).map((l) => (
          <LimitCard key={`${l.scope}:${l.kind}:${rev}`} l={l} allFormats={l.kind === 'all' ? [] : ov.formats[l.kind]} onSaved={() => void load()} />
        ))}
      </div>
    </div>
  );
};
