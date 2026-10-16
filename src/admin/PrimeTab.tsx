/**
 * Вкладка «Sky Prime»: правила кэшбэка Prime Points, каталог наград, очередь ручной выдачи и журнал кэшбэка.
 * Сервер: server/primecashback.mjs, server/primerewards.mjs, право `prime`. Любое изменение — с подтверждением личности (код).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/prime';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов — запросите новый.',
  bad_field: 'Проверьте значение поля.', not_found: 'Не найдено.', not_pending: 'Уже обработано.', reason_required: 'Укажите причину (от 3 знаков).', too_many_requests: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string, f?: string) => ((e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`) + (f ? ` Поле: ${f}.` : '');
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>
);
const Num = ({ label, value, onChange, w = 'w-28' }: { label: string; value: unknown; onChange: (v: string) => void; w?: string }) => (
  <label className="text-[11px]" style={{ color: C.t3 }}>{label}
    <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} />
  </label>
);

export const PrimeTab = () => {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [s, setS] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Data | null>(null);
  const [ask, setAsk] = useState<null | ((code: string) => Promise<void>)>(null);
  const [method, setMethod] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setD(r.data ?? {}); setS(r.data?.settings ?? null); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Любое изменение: сначала код подтверждения личности, затем запрос с ним
  const guarded = async (fn: (code: string) => Promise<void>) => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'email')); setCode(''); setAsk(() => fn);
  };
  const write = async (method2: string, path: string, body: Data, ok: string, c: string) => {
    const r = await apiCall<Data>(`${A}${path}`, { method: method2, body: JSON.stringify({ ...body, stepUpCode: c }) });
    if (!r.ok) { flash(errText(r.error, r.data?.field)); return false; }
    flash(ok); await load(); return true;
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d || !s) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const set = (k: string, v: string) => setS({ ...s, [k]: v });
  const tot = d.cashback?.totals ?? {};

  return (
    <div className="space-y-4">
      {ask && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
          <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>{method === 'app' ? 'Код из приложения двухэтапной защиты.' : 'Код отправлен на почту, действует пять минут.'}</p>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
            <Btn disabled={code.length < 6} onClick={() => { const f = ask; const c = code; setAsk(null); void f(c); }}>Подтвердить</Btn>
          </div>
          <button type="button" onClick={() => setAsk(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
        </div>
      )}

      <Card title="Правила кэшбэка Prime Points">
        <p className="text-[11px] leading-relaxed" style={{ color: C.t3 }}>
          Кэшбэк начисляется баллами за завершённые заказы Sky Market (заказ оплачивается напрямую продавцу — Sky денег не видит). Баллы «созревают» несколько дней, чтобы хватило времени на спор и возврат.
          Один заказ — один кэшбэк; покупатель и продавец не могут быть одним аккаунтом. Правила — решение платформы, не юридическое заключение.
        </p>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(s.enabled)} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />Кэшбэк включён</label>
        <div className="flex flex-wrap gap-2">
          <Num label="% для Prime" value={s.primePercent} onChange={(v) => set('primePercent', v)} />
          <Num label="% для остальных" value={s.basePercent} onChange={(v) => set('basePercent', v)} />
          <Num label="Мин. заказ, ₽" value={s.minOrderRub} onChange={(v) => set('minOrderRub', v)} />
          <Num label="Макс. баллов с заказа" value={s.maxPointsPerOrder} onChange={(v) => set('maxPointsPerOrder', v)} />
          <Num label="Макс. в месяц на человека" value={s.maxPointsPerMonth} onChange={(v) => set('maxPointsPerMonth', v)} />
          <Num label="Макс. в месяц на продавца" value={s.maxPointsPerSellerMonth} onChange={(v) => set('maxPointsPerSellerMonth', v)} />
          <Num label="Холд, дней" value={s.holdDays} onChange={(v) => set('holdDays', v)} />
        </div>
        <Btn onClick={() => void guarded((c) => write('PUT', '/cashback/settings', { settings: s }, 'Правила сохранены', c).then(() => undefined))}>Сохранить правила</Btn>
        <p className="text-[11px]" style={{ color: C.t3 }}>
          {`Ожидает: ${tot.pending?.points ?? 0} б. (${tot.pending?.count ?? 0}) · Зачислено: ${tot.paid?.points ?? 0} б. (${tot.paid?.count ?? 0}) · Отменено: ${tot.cancelled?.count ?? 0}`}
        </p>
      </Card>

      <Card title="Каталог наград">
        <p className="text-[11px]" style={{ color: C.t3 }}>Награды «Prime на N дней» выдаются сразу; «Вручную» — оформляет сотрудник в очереди ниже. Пока нет активных наград, у людей каталог пуст.</p>
        {(d.rewards as Data[]).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no" className="font-bold" style={{ color: C.t1 }}>{r.title}</span>
            <span>{`${r.cost} б. · ${r.kind === 'prime_days' ? `Prime +${r.valueDays} дн.` : 'вручную'}${r.stock != null ? ` · осталось ${r.stock}` : ''}${r.perUserLimit ? ` · до ${r.perUserLimit} на человека` : ''}${r.minTier ? ` · от ${r.minTier}` : ''}`}</span>
            <span style={{ color: r.active ? C.green : C.t3 }}>{r.active ? 'включена' : 'выключена'}</span>
            <span className="ml-auto"><Btn tone="plain" onClick={() => setEdit({ ...r })}>Изменить</Btn></span>
          </div>
        ))}
        {!edit && <Btn tone="plain" onClick={() => setEdit({ title: '', description: '', cost: 100, kind: 'manual', valueDays: 30, stock: '', perUserLimit: '', minTier: '', active: false })}>Добавить награду</Btn>}
        {edit && (
          <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Название" aria-label="Название" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
            <input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Описание" aria-label="Описание" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />
            <div className="flex flex-wrap gap-2">
              <Num label="Цена, баллов" value={edit.cost} onChange={(v) => setEdit({ ...edit, cost: v })} />
              <label className="text-[11px]" style={{ color: C.t3 }}>Тип
                <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  <option value="manual">Вручную (сотрудник)</option><option value="prime_days">Prime на N дней</option>
                </select>
              </label>
              {edit.kind === 'prime_days' && <Num label="Дней Prime" value={edit.valueDays} onChange={(v) => setEdit({ ...edit, valueDays: v })} />}
              <Num label="Остаток (пусто — без предела)" value={edit.stock} onChange={(v) => setEdit({ ...edit, stock: v })} w="w-40" />
              <Num label="На человека (пусто — без предела)" value={edit.perUserLimit} onChange={(v) => setEdit({ ...edit, perUserLimit: v })} w="w-44" />
              <label className="text-[11px]" style={{ color: C.t3 }}>Мин. уровень
                <select value={edit.minTier ?? ''} onChange={(e) => setEdit({ ...edit, minTier: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>
                  <option value="">любой</option><option value="gold">Gold</option><option value="platinum">Platinum</option><option value="diamond">Diamond</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Показывать людям</label>
            <div className="flex gap-2">
              <Btn onClick={() => void guarded(async (c) => { if (await write(edit.id ? 'PUT' : 'POST', edit.id ? `/rewards/${edit.id}` : '/rewards', edit, 'Награда сохранена', c)) setEdit(null); })}>Сохранить</Btn>
              <Btn tone="plain" onClick={() => setEdit(null)}>Отмена</Btn>
            </div>
          </div>
        )}
      </Card>

      <Card title={`Очередь ручной выдачи (${(d.queue as Data[]).length})`}>
        {(d.queue as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Заявок нет.</p>}
        {(d.queue as Data[]).length > 0 && <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} placeholder="Комментарий / причина отказа" aria-label="Комментарий" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />}
        {(d.queue as Data[]).map((z) => (
          <div key={z.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no" className="font-bold" style={{ color: C.t1 }}>{z.title}</span><span translate="no">@{z.user}</span><span>{`${z.cost} б. · ${dt(z.createdAt)}`}</span>
            <span className="ml-auto flex gap-1.5">
              <Btn onClick={() => void guarded((c) => write('POST', `/redemptions/${z.id}/approve`, { note: reason }, 'Отмечено выданным', c).then(() => undefined))}>Выдано</Btn>
              <Btn tone="red" onClick={() => void guarded((c) => write('POST', `/redemptions/${z.id}/reject`, { note: reason }, 'Отказ, баллы возвращены', c).then(() => undefined))}>Отказать и вернуть баллы</Btn>
            </span>
          </div>
        ))}
      </Card>

      <Card title="Журнал кэшбэка">
        {(d.cashback?.items as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Начислений ещё не было.</p>}
        {(d.cashback?.items as Data[]).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span translate="no">@{c.buyer} ← @{c.seller}</span><span>{`${c.totalRub} ₽ · ${c.percent}% = `}<b style={{ color: C.t1 }}>{`${c.points} б.`}</b></span>
            <span>{c.status === 'pending' ? `ждёт до ${dt(c.releaseAt)}` : c.status === 'paid' ? 'зачислено' : `отменено${c.reason ? `: ${c.reason}` : ''}`}</span>
            {c.status === 'pending' && <span className="ml-auto"><Btn tone="red" onClick={() => void guarded((code2) => write('POST', `/cashback/${c.id}/cancel`, { reason: reason || 'отменено сотрудником' }, 'Кэшбэк отменён', code2).then(() => undefined))}>Отменить</Btn></span>}
          </div>
        ))}
      </Card>
    </div>
  );
};
