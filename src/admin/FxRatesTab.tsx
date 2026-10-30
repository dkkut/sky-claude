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
interface Row { code: string; name: string; symbol: string; rateRub: number | null; spreadPct: number; enabled: boolean; updatedAt: string | null }
const ERR: Record<string, string> = { owner_only: 'Только владелец.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', big_change: 'Курс изменился больше чем на 30 % — подтвердите ещё раз.', bad_rate: 'Неверный курс.', bad_spread: 'Спред — от 0 до 20 %.' };

export const FxRatesTab = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { rate: string; spread: string; enabled: boolean }>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<{ rates: Row[]; canEdit: boolean }>(A);
    if (!r.ok || !r.data) { setErr('Не удалось загрузить курсы'); return; }
    setRows(r.data.rates); setCanEdit(r.data.canEdit); setErr('');
    setEdit(Object.fromEntries(r.data.rates.map((x) => [x.code, { rate: x.rateRub == null ? '' : String(x.rateRub), spread: String(x.spreadPct), enabled: x.enabled }])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ask = async () => { const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' }); if (r.ok) { setAsked(true); flash('Код отправлен'); } else flash(ERR[r.error ?? ''] ?? 'Не удалось запросить код'); };
  const save = async () => {
    if (!rows) return;
    const list = rows.filter((x) => edit[x.code]?.rate).map((x) => ({ currency: x.code, rateRub: Number(edit[x.code].rate.replace(',', '.')), spreadPct: Number(edit[x.code].spread.replace(',', '.')), enabled: edit[x.code].enabled }));
    setBusy(true);
    const r = await apiCall(A, { method: 'PUT', body: JSON.stringify({ rates: list, stepUpCode: code.trim(), confirmBig: big }) });
    setBusy(false);
    if (r.ok) { flash('Курсы сохранены'); setCode(''); setAsked(false); setBig(false); await load(); }
    else { if (r.error === 'big_change') setBig(true); flash(ERR[r.error ?? ''] ?? `Не получилось (${r.error ?? ''})`); }
  };

  if (!rows) return <div className="grid place-items-center py-10">{err ? <p style={{ color: C.t3 }}>{err}</p> : <Loader2 className="animate-spin" size={20} />}</div>;
  const inp = 'w-full rounded-xl px-3 py-2 text-sm';
  const fld = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
  return (
    <div className="space-y-3">
      <section className="rounded-2xl p-3 text-xs leading-relaxed" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t3 }}>
        Курс — рублей за 1 единицу валюты (середина). Для покупки валюты пользователем курс повышается на спред, для продажи — понижается. Пока курс не задан или счёт выключен, валюта пользователям недоступна.
        Рыночных курсов Sky не берёт: их нужно выставлять вручную и обновлять самим.
      </section>
      <div className="space-y-2">
        {rows.map((x) => (
          <section key={x.code} className="grid grid-cols-2 gap-2 rounded-2xl p-3 sm:grid-cols-5 sm:items-center" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="col-span-2 sm:col-span-1"><p className="text-sm font-bold" style={{ color: C.t1 }}>{x.symbol} {x.code}</p><p className="text-[11px]" style={{ color: C.t3 }}>{x.name}{x.updatedAt ? ` · ${new Date(x.updatedAt).toLocaleDateString('ru')}` : ''}</p></div>
            <input value={edit[x.code]?.rate ?? ''} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], rate: e.target.value.replace(/[^\d.,]/g, '') } })} inputMode="decimal" placeholder="Курс, ₽" aria-label={`Курс ${x.code}`} className={inp} style={fld} />
            <input value={edit[x.code]?.spread ?? ''} disabled={!canEdit} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], spread: e.target.value.replace(/[^\d.,]/g, '') } })} inputMode="decimal" placeholder="Спред, %" aria-label={`Спред ${x.code}`} className={inp} style={fld} />
            <label className="col-span-2 flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!canEdit} checked={edit[x.code]?.enabled ?? false} onChange={(e) => setEdit({ ...edit, [x.code]: { ...edit[x.code], enabled: e.target.checked } })} />Доступна пользователям</label>
          </section>
        ))}
      </div>
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
