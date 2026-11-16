/**
 * Вкладка «Ограничения Sky Media» (право `media_restrict`, каждое действие — с кодом подтверждения): ограничения на произведение или на
 * направление автора (кино / музыка / книги / подкасты — независимо), апелляции авторов, история. Сервер: server/mediarestrict.mjs.
 * Ограничение ничего не удаляет: избранное, плейлисты, история остаются. Ограничивший сам апелляцию не решает.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { DIR_LABEL } from '@/media/restrictions';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const A = '/api/admin/media-restrictions';
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  basis_required: 'Основание — от 10 знаков.', reason_required: 'Причина — от 5 знаков.', not_found: 'Не найдено.', self_review: 'Это решает другой человек.', owner_protected: 'Владельца сервиса ограничить нельзя.',
  already_active: 'Такое ограничение уже действует.', bad_scope: 'Выберите вид ограничения.', bad_direction: 'Выберите направление.',
};
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const In = ({ label, value, onChange, w = 'w-40' }: { label: string; value: string; onChange: (v: string) => void; w?: string }) => (
  <label className="text-[11px]" style={{ color: C.t3 }}>{label}<input value={value} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} /></label>
);

export const MediaRestrictionsTab = () => {
  const [rows, setRows] = useState<D[]>([]);
  const [appeals, setAppeals] = useState<D[]>([]);
  const [status, setStatus] = useState('active');
  const [code, setCode] = useState('');
  const [asked, setAsked] = useState(false);
  const [why, setWhy] = useState('');
  const [f, setF] = useState<D>({ scope: 'work', direction: 'music', targetId: '', basis: '', ref: '', publicNote: '' });
  const [hist, setHist] = useState<D | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([apiCall<{ restrictions: D[] }>(`${A}?status=${status}`), apiCall<{ appeals: D[] }>(`${A}/appeals`)]);
    if (a.ok) setRows(a.data!.restrictions); else flash(ERR[a.error ?? ''] ?? 'Не удалось загрузить');
    if (b.ok) setAppeals(b.data!.appeals);
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  /** Каждое действие — с кодом: первый нажим запрашивает код, второй (после ввода) выполняет. */
  const act = async (path: string, body: D, ok: string) => {
    if (code.length < 6) { const r = await apiCall(`${A}/step-up`, { method: 'POST' }); setAsked(true); flash(r.ok ? 'Код отправлен — введите его и нажмите ещё раз' : (ERR[r.error ?? ''] ?? 'Не удалось запросить код')); return; }
    const r = await apiCall<D>(path, { method: 'POST', body: JSON.stringify({ ...body, stepUpCode: code }) });
    setCode(''); setAsked(false);
    if (!r.ok) return flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? 'ошибка'})`);
    flash(ok); void load();
  };
  return (
    <div className="space-y-3 p-3">
      {asked && <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="rounded-lg px-3 py-2 text-sm tracking-widest" style={field} /><span className="self-center text-xs" style={{ color: C.t3 }}>Введите код и повторите действие</span></div>}

      <section className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-2 text-sm font-black" style={{ color: C.t1 }}>Новое ограничение</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px]" style={{ color: C.t3 }}>Что ограничиваем
            <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}><option value="work">Одно произведение</option><option value="author_direction">Направление автора</option></select></label>
          <label className="text-[11px]" style={{ color: C.t3 }}>Направление
            <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>{Object.entries(DIR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <In label={f.scope === 'work' ? 'id произведения' : 'id профиля автора'} value={f.targetId} onChange={(v) => setF({ ...f, targetId: v.trim() })} w="w-56" />
          <In label="№ обращения/жалобы" value={f.ref} onChange={(v) => setF({ ...f, ref: v })} w="w-32" />
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <In label="Основание (видят автор и сотрудники)" value={f.basis} onChange={(v) => setF({ ...f, basis: v })} w="w-80 max-w-full" />
          <In label="Текст на баннере (видят все, необязательно)" value={f.publicNote} onChange={(v) => setF({ ...f, publicNote: v })} w="w-64 max-w-full" />
          <Btn disabled={!f.targetId} onClick={() => void act(A, { scope: f.scope, direction: f.direction, targetId: f.targetId, basis: f.basis, ref: f.ref, publicNote: f.publicNote }, 'Ограничение создано')}>Ограничить</Btn>
        </div>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Автор музыки — правообладатель (владелец подтверждённой карточки музыканта). Направления закрываются независимо друг от друга. Избранное, плейлисты и история людей не удаляются.</p>
      </section>

      <In label="Причина решения (для снятия и решений по апелляциям, от 5 знаков, попадёт в журнал и к автору)" value={why} onChange={setWhy} w="w-full" />

      <section className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-2 text-sm font-black" style={{ color: C.t1 }}>Апелляции авторов ({appeals.length})</p>
        {appeals.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Очередь пуста.</p>}
        {appeals.map((a) => (
          <div key={a.id} className="mb-2 rounded-xl p-2.5 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <p className="font-bold" style={{ color: C.t1 }}>{a.scope === 'work' ? 'Произведение' : 'Направление'} · {DIR_LABEL[a.direction]} · <span translate="no">{a.authorId}</span></p>
            <p translate="no">Основание ограничения: {a.basis}</p>
            <p className="mt-0.5" translate="no">Апелляция: {a.body}</p>
            <div className="mt-1.5 flex gap-2">
              <Btn onClick={() => void act(`${A}/appeals/${a.id}/decide`, { accept: true, note: why }, 'Апелляция принята, ограничение снято')}>Принять и снять</Btn>
              <Btn tone="red" onClick={() => void act(`${A}/appeals/${a.id}/decide`, { accept: false, note: why }, 'Апелляция отклонена')}>Отклонить</Btn>
            </div>
          </div>))}
      </section>

      <section className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <div className="mb-2 flex items-center gap-2"><p className="flex-1 text-sm font-black" style={{ color: C.t1 }}>Ограничения</p>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус" className="rounded-lg px-2 py-1 text-xs" style={field}><option value="active">Действуют</option><option value="lifted">Сняты</option><option value="">Все</option></select></div>
        {rows.map((r) => (
          <div key={r.id} className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: C.t2 }}>
            <span><b style={{ color: C.t1 }}>{r.scope === 'work' ? 'Произведение' : 'Направление'} · {DIR_LABEL[r.direction]}</b> · <span translate="no">{r.author ?? r.authorId ?? '—'} · {r.targetId}</span> · {r.status === 'active' ? 'действует' : 'снято'}{r.openAppeal ? ' · есть апелляция' : ''}<br /><span translate="no">{r.basis}{r.ref ? ` (${r.ref})` : ''}</span></span>
            <span className="flex gap-1">
              <Btn tone="plain" onClick={() => void apiCall<{ log: D[] }>(`${A}/${r.id}/history`).then((h) => setHist({ id: r.id, log: h.data?.log ?? [] }))}>История</Btn>
              {r.status === 'active' && <Btn tone="red" onClick={() => void act(`${A}/${r.id}/lift`, { reason: why }, 'Ограничение снято')}>Снять</Btn>}
            </span>
          </div>))}
        {hist && <div className="mt-2 rounded-lg p-2 text-[11px]" style={{ background: C.l2, color: C.t2 }}>{hist.log.map((l: D, i: number) => <p key={i}>{new Date(l.at).toLocaleString('ru-RU')} · <span translate="no">{l.actor_id}</span> · {l.action}{l.detail ? ` — ${l.detail}` : ''}</p>)}</div>}
      </section>
    </div>
  );
};
