/**
 * Вкладка «Валютные курсы»: курсы и спред для валютных счетов SkyMoney. Смотреть — право finance; менять — только владелец с кодом подтверждения
 * (step-up `fx_rates`). Рыночных курсов Sky не берёт: пока курс не задан, валюта пользователям недоступна. Сервер — server/walletfx.mjs.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t3: 'var(--t3)', acc: 'var(--accent)' };
const A = '/api/admin/fx-rates';
interface Row { code: string; name: string; symbol: string; rateRub: number | null; spreadPct: number; enabled: boolean; source: 'manual' | 'cbr'; updatedAt: string | null }
interface An { points: { t: number; rate: number }[]; change1d: number | null; change30d: number | null; min: number; max: number }
const ERR: Record<string, string> = { owner_only: 'Только владелец.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', big_change: 'Курс изменился больше чем на 30 % — подтвердите ещё раз.', bad_rate: 'Неверный курс.', bad_spread: 'Спред — от 0 до 20 %.', source_unavailable: 'Источник курсов (ЦБ РФ) сейчас недоступен.', source_no_data: 'У источника нет курса этой валюты.' };

export const FxRatesTab = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { rate: string; spread: string; enabled: boolean; source: 'manual' | 'cbr' }>>({});
  const [an, setAn] = useState<Record<string, An>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<{ rates: Row[]; canEdit: boolean; analytics: Record<string, An> }>(A);
    if (!r.ok || !r.data) { setErr('Не удалось загрузить курсы'); return; }
    setRows(r.data.rates); setCanEdit(r.data.canEdit); setAn(r.data.analytics ?? {}); setErr('');
    setEdit(Object.fromEntries(r.data.rates.map((x) => [x.code, { rate: x.rateRub == null ? '' : String(x.rateRub), spread: String(x.spreadPct), enabled: x.enabled, source: x.source }])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ask = async () => { const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' }); if (r.ok) { setAsked(true); flash('Введите код из приложения-аутентификатора'); } else flash(ERR[r.error ?? ''] ?? 'Не удалось запросить код'); };
  const save = async () => {
    if (!rows) return;
    const list = rows.filter((x) => edit[x.code]?.rate || edit[x.code]?.source === 'cbr').map((x) => ({ currency: x.code, source: edit[x.code].source, rateRub: Number((edit[x.code].rate || '0').replace(',', '.')), spreadPct: Number(edit[x.code].spread.replace(',', '.')), enabled: edit[x.code].enabled }));
    setBusy(true);
    const r = await apiCall(A, { method: 'PUT', body: JSON.stringify({ rates: list, stepUpCode: code.trim(), confirmBig: big }) });
    setBusy(false);
    if (r.ok) { flash('Курсы сохранены'); setCode(''); setAsked(false); setBig(false); await load(); }
    else { if (r.error === 'big_change') setBig(true); flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? ''})`); }
  };
  const refresh = async () => {
    setBusy(true); const r = await apiCall<{ updated?: string[] }>(`${A}/refresh`, { method: 'POST', body: '{}' }); setBusy(false);
    if (r.ok) { flash(r.data?.updated?.length ? `Обновлено: ${r.data.updated.join(', ')}` : 'Нечего обновлять'); await load(); } else flash(ERR[r.error ?? ''] ?? 'Источник курсов недоступен');
  };

  if (!rows) return <div className="grid place-items-center py-10">{err ? <p style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  const inp = 'w-full rounded-xl px-3 py-2 text-sm';
  const fld = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
  return (
    <div className="space-y-3">
      <section className="rounded-2xl p-3 text-xs leading-relaxed" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t3 }}>
        Курс — рублей за 1 единицу валюты (середина). Для покупки валюты пользователем курс повышается на спред, для продажи — понижается. Пока курс не задан или счёт выключен, валюта пользователям недоступна.
        Источник — вручную или курс ЦБ РФ (обновляется автоматически раз в 3 часа; ЦБ публикует курс раз в рабочий день; скачок больше 30 % автоматически не применяется). Курс ЦБ — официальный курс дня, а не биржевая котировка: спред остаётся.
      </section>
      <div className="space-y-2">
        {rows.map((x) => (
          <section key={x.code} className="grid grid-cols-2 gap-2 rounded-2xl p-3 sm:grid-cols-5 sm:items-center" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="col-span-2 sm:col-span-1"><p className="text-sm font-bold" style={{ color: C.t1 }}>{x.symbol} {x.code}</p><p className="text-[11px]" style={{ color: C.t3 }}>{x.name}{x.updatedAt ? ` · ${new Date(x.updatedAt).toLocaleDateString('ru')}` : ''}</p></div>
            <select value={edit[x.code]?.source ?? 'manual'} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], source: e.target.value as 'manual' | 'cbr' } })} aria-label={`Источник ${x.code}`} className={inp} style={fld}><option value="manual">Вручную</option><option value="cbr">ЦБ РФ (автоматически)</option></select>
            <input value={edit[x.code]?.rate ?? ''} disabled={!canEdit || edit[x.code]?.source === 'cbr'} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], rate: e.target.value.replace(/[^\d.,]/g, '') } })} inputMode="decimal" placeholder="Курс, ₽" aria-label={`Курс ${x.code}`} className={inp} style={fld} />
            <input value={edit[x.code]?.spread ?? ''} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], spread: e.target.value.replace(/[^\d.,]/g, '') } })} inputMode="decimal" placeholder="Спред, %" aria-label={`Спред ${x.code}`} className={inp} style={fld} />
            {an[x.code] && <p className="col-span-2 text-[11px] sm:col-span-5" style={{ color: C.t3 }}>За сутки {an[x.code].change1d == null ? '—' : `${an[x.code].change1d} %`} · за 30 дней {an[x.code].change30d == null ? '—' : `${an[x.code].change30d} %`} · диапазон {an[x.code].min}–{an[x.code].max} ₽ · точек: {an[x.code].points.length}</p>}
            <label className="col-span-2 flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!canEdit} checked={edit[x.code]?.enabled ?? false} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], enabled: e.target.checked } })} />Доступна пользователям</label>
          </section>
        ))}
      </div>
      {canEdit && <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>Обновить курсы ЦБ сейчас</button>}
      {canEdit ? (
        <section className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          {!asked ? <button type="button" onClick={() => void ask()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>Запросить код подтверждения</button>
            : <><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Код подтверждения" className={inp} style={fld} />
              {big && <p className="text-xs" style={{ color: '#f59e0b' }}>Курс изменился больше чем на 30 %. Нажмите «Сохранить» ещё раз, чтобы подтвердить.</p>}
              <button type="button" disabled={busy || code.length < 6} onClick={() => void save()} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></>}
        </section>
      ) : <p className="text-xs" style={{ color: C.t3 }}>Менять курсы может только владелец.</p>}
    </div>
  );
};
