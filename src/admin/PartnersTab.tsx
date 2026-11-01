/**
 * Вкладка «Партнёры»: добавление и правка (право `partners`), проверка и подтверждение (право `partners_approve`, с кодом личности), журнал изменений.
 * Сервер: server/partners.mjs. Опубликованный партнёр при правке содержания возвращается на проверку; подтверждает другой человек (кроме владельца).
 * Внутренние контакты видны только здесь и людям не отдаются.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/partners';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const STATUS: Record<string, string> = { draft: 'Черновик', review: 'На проверке', active: 'Активен', suspended: 'Приостановлен', archive: 'Архив' };
const ACTION: Record<string, string> = { create: 'создан', update: 'изменён', submit: 'отправлен на проверку', approve: 'подтверждён', return: 'возвращён на доработку', suspend: 'приостановлен', resume: 'возобновлён', archive: 'в архив', logo: 'логотип' };
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  bad_field: 'Проверьте значение поля.', bad_state: 'В этом статусе так сделать нельзя.', self_approval: 'Подтверждает другой человек: вы правили этого партнёра последним.', incomplete: 'Заполнено не всё.',
  reason_required: 'Укажите причину (от 3 знаков).', bad_logo: 'Логотип: PNG, JPEG или WebP.', logo_too_large: 'Логотип больше 300 КБ.', archived: 'Партнёр в архиве.', not_found: 'Не найдено.',
};
const errText = (e?: string, d?: Data) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (d?.field ? ` Поле: ${d.field}.` : '') + (d?.need ? ` Нужно: ${d.need}.` : '');
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const In = ({ label, value, onChange, w = 'w-full', type = 'text', area = false }: { label: string; value: unknown; onChange: (v: string) => void; w?: string; type?: string; area?: boolean }) => (
  <label className="block text-[11px]" style={{ color: C.t3 }}>{label}
    {area
      ? <textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} />
      : <input type={type} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} />}
  </label>
);

const EMPTY = { name: '', category: 'other', website: '', description: '', conditions: '', contact: '', startsAt: '', endsAt: '', sort: 100, offers: [] as Data[] };

export const PartnersTab = () => {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [edit, setEdit] = useState<Data | null>(null);
  const [log, setLog] = useState<{ id: string; items: Data[] } | null>(null);
  const [ask, setAsk] = useState<null | { go: (code: string) => Promise<void> }>(null);
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setD(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: string, needCode: boolean) => {
    const run = async (c?: string) => {
      const r = await apiCall<Data>(`${A}/${id}/${action}`, { method: 'POST', body: JSON.stringify({ reason, stepUpCode: c }) });
      if (!r.ok) { flash(errText(r.error, r.data)); return; }
      flash('Готово'); setReason(''); await load();
    };
    if (!needCode) { await run(); return; }
    const s = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!s.ok) { flash(errText(s.error)); return; }
    setMethod(String(s.data?.method ?? 'app')); setCode(''); setAsk({ go: run });
  };

  const saveForm = async () => {
    if (!edit) return;
    const body = { ...edit, offers: (edit.offers as Data[]).map((o) => ({ title: o.title, terms: o.terms, promoCode: o.promoCode, endsAt: o.endsAt })) };
    const r = await apiCall<Data>(edit.id ? `${A}/${edit.id}` : A, { method: edit.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    if (!r.ok) { flash(errText(r.error, r.data)); return; }
    if (r.data?.status === 'review' && edit.id) flash('Сохранено. Партнёр возвращён на проверку и временно скрыт.'); else flash('Сохранено');
    setEdit(null); await load();
  };

  const pickLogo = (id: string, f: File | undefined) => {
    if (!f) return;
    if (f.size > 300 * 1024) { flash(errText('logo_too_large')); return; }
    const fr = new FileReader();
    fr.onload = async () => {
      const r = await apiCall<Data>(`${A}/${id}/logo`, { method: 'PUT', body: JSON.stringify({ dataUrl: String(fr.result) }) });
      flash(r.ok ? (r.data?.status === 'review' ? 'Логотип загружен, партнёр на проверке' : 'Логотип загружен') : errText(r.error)); await load();
    };
    fr.readAsDataURL(f);
  };
  const showLog = async (id: string) => { const r = await apiCall<Data>(`${A}/${id}/log`); if (r.ok) setLog({ id, items: r.data?.log ?? [] }); };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const cats = d.categories as Record<string, string>;
  const setOffer = (i: number, k: string, v: string) => setEdit({ ...edit!, offers: (edit!.offers as Data[]).map((o, j) => (j === i ? { ...o, [k]: v } : o)) });

  return (
    <div className="space-y-4">
      {ask && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
          <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{'Введите код из приложения-аутентификатора.'}</p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
            <Btn disabled={code.length < 6} onClick={() => { const a = ask; const c = code; setAsk(null); void a.go(c); }}>Подтвердить</Btn>
          </div>
          <button type="button" onClick={() => setAsk(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
        </div>
      )}

      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Партнёры</p>
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.t3 }}>
          Партнёр попадает к людям только после подтверждения уполномоченным администратором (не тем, кто правил последним; владелец может подтвердить сам).
          Изменение содержания опубликованного партнёра возвращает его на проверку. Контакты ниже — внутренние, людям не показываются.
        </p>
        <div className="mt-2 flex items-center gap-2">
          {!edit && <Btn onClick={() => setEdit({ ...EMPTY })}>Добавить партнёра</Btn>}
          <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} placeholder="Причина (для возврата, приостановки, архива)" aria-label="Причина" className="flex-1 rounded-lg px-3 py-1.5 text-xs" style={field} />
        </div>
      </div>

      {edit && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{edit.id ? 'Правка партнёра' : 'Новый партнёр (черновик)'}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <In label="Название" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <label className="block text-[11px]" style={{ color: C.t3 }}>Категория
              <select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className="mt-0.5 block w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
                {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <In label="Сайт (https://…)" value={edit.website} onChange={(v) => setEdit({ ...edit, website: v })} />
            <In label="Порядок показа" value={edit.sort} onChange={(v) => setEdit({ ...edit, sort: v })} />
            <In label="Начало сотрудничества" type="date" value={edit.startsAt ?? ''} onChange={(v) => setEdit({ ...edit, startsAt: v })} />
            <In label="Срок действия до" type="date" value={edit.endsAt ?? ''} onChange={(v) => setEdit({ ...edit, endsAt: v })} />
          </div>
          <In label="Описание (видно людям)" area value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
          <In label="Условия акции (видны людям)" area value={edit.conditions} onChange={(v) => setEdit({ ...edit, conditions: v })} />
          <In label="Внутренние контакты (людям НЕ показываются)" area value={edit.contact} onChange={(v) => setEdit({ ...edit, contact: v })} />
          <p className="text-[11px] font-bold" style={{ color: C.t2 }}>Предложения и промокоды</p>
          {(edit.offers as Data[]).map((o, i) => (
            <div key={i} className="grid gap-2 rounded-lg p-2 sm:grid-cols-4" style={{ background: C.l2 }}>
              <In label="Название" value={o.title} onChange={(v) => setOffer(i, 'title', v)} />
              <In label="Условия" value={o.terms} onChange={(v) => setOffer(i, 'terms', v)} />
              <In label="Промокод (необязательно)" value={o.promoCode} onChange={(v) => setOffer(i, 'promoCode', v)} />
              <In label="До" type="date" value={o.endsAt} onChange={(v) => setOffer(i, 'endsAt', v)} />
              <Btn tone="plain" onClick={() => setEdit({ ...edit, offers: (edit.offers as Data[]).filter((_, j) => j !== i) })}>Убрать</Btn>
            </div>
          ))}
          <Btn tone="plain" onClick={() => setEdit({ ...edit, offers: [...(edit.offers as Data[]), { title: '', terms: '', promoCode: '', endsAt: '' }] })}>Добавить предложение</Btn>
          <div className="flex gap-2"><Btn onClick={() => void saveForm()}>Сохранить</Btn><Btn tone="plain" onClick={() => setEdit(null)}>Отмена</Btn></div>
        </div>
      )}

      {(d.partners as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Партнёров ещё нет.</p>}
      {(d.partners as Data[]).map((p) => (
        <div key={p.id} className="space-y-1.5 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${p.status === 'review' ? C.amber : C.brd}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <span translate="no" className="text-sm font-bold" style={{ color: C.t1 }}>{p.name}</span>
            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: C.l2, color: p.status === 'active' ? C.green : p.status === 'review' ? C.amber : C.t3 }}>{STATUS[p.status] ?? p.status}</span>
            <span className="text-[11px]" style={{ color: C.t3 }}>{`${cats[p.category] ?? p.category}${p.startsAt ? ` · с ${p.startsAt}` : ''}${p.endsAt ? ` · до ${p.endsAt}` : ''}`}</span>
          </div>
          {p.contact && <p translate="no" className="text-[11px]" style={{ color: C.t3 }}>{`Контакты (внутренние): ${p.contact}`}</p>}
          <div className="flex flex-wrap gap-1.5">
            {p.status !== 'archive' && <Btn tone="plain" onClick={() => setEdit({ ...p, startsAt: p.startsAt ?? '', endsAt: p.endsAt ?? '' })}>Изменить</Btn>}
            {p.status !== 'archive' && (
              <label className="cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
                {p.hasLogo ? 'Сменить логотип' : 'Загрузить логотип'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickLogo(p.id, e.target.files?.[0])} />
              </label>
            )}
            {p.status === 'draft' && <Btn onClick={() => void act(p.id, 'submit', false)}>Отправить на проверку</Btn>}
            {p.status === 'review' && d.canApprove && <><Btn onClick={() => void act(p.id, 'approve', true)}>Подтвердить</Btn><Btn tone="plain" onClick={() => void act(p.id, 'return', false)}>Вернуть на доработку</Btn></>}
            {p.status === 'active' && d.canApprove && <Btn tone="red" onClick={() => void act(p.id, 'suspend', true)}>Приостановить</Btn>}
            {p.status === 'suspended' && d.canApprove && <Btn onClick={() => void act(p.id, 'resume', true)}>Возобновить</Btn>}
            {p.status !== 'archive' && d.canApprove && <Btn tone="red" onClick={() => void act(p.id, 'archive', true)}>В архив</Btn>}
            <Btn tone="plain" onClick={() => void showLog(p.id)}>Журнал</Btn>
          </div>
          {log && log.id === p.id && (
            <div className="rounded-lg p-2" style={{ background: C.l2 }}>
              {log.items.map((x, i) => (
                <p key={i} className="text-[11.5px]" style={{ color: C.t2 }}>{`${dt(x.at)} · ${x.actor ? `@${x.actor}` : '—'} · ${ACTION[x.action] ?? x.action}${x.detail?.fields ? `: ${x.detail.fields.join(', ')}` : ''}${x.detail?.reason ? ` — ${x.detail.reason}` : ''}`}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
